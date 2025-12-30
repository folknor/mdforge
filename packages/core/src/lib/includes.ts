import { promises as fs } from "node:fs";
import { dirname, isAbsolute, normalize, resolve } from "node:path";

/**
 * Templates configuration: map of template names to file paths
 */
export type TemplatesConfig = Record<string, string>;

/**
 * Regex to match @include directives:
 * - @include ./relative/path.md
 * - @include /absolute/path.md
 * - @include "path with spaces/file.md"
 * - @include 'path with spaces/file.md'
 */
const INCLUDE_REGEX = /^@include\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/gm;

/**
 * Regex to match @template directives:
 * - @template template-name
 */
const TEMPLATE_REGEX = /^@template\s+(\S+)\s*$/gm;

/**
 * Normalize a path for cross-platform support.
 * Converts backslashes to forward slashes on all platforms.
 */
function normalizePath(path: string): string {
	// Replace backslashes with forward slashes for consistency
	return normalize(path).replace(/\\/g, "/");
}

/**
 * Resolve a path relative to a base directory.
 */
function resolvePath(path: string, baseDir: string): string {
	// Normalize first
	const normalizedPath = normalizePath(path);

	if (isAbsolute(normalizedPath)) {
		return normalizedPath;
	}

	return resolve(baseDir, normalizedPath);
}

/**
 * Read a file and return its contents.
 * Throws an error if the file cannot be read.
 */
async function readFile(filePath: string): Promise<string> {
	try {
		return await fs.readFile(filePath, "utf-8");
	} catch (error) {
		const err = error as NodeJS.ErrnoException;
		if (err.code === "ENOENT") {
			throw new Error(`Include file not found: ${filePath}`);
		}
		throw new Error(
			`Failed to read include file: ${filePath} - ${err.message}`,
		);
	}
}

/**
 * Process @include and @template directives in markdown content.
 *
 * @param content - The markdown content to process
 * @param baseDir - The base directory for resolving relative paths
 * @param templates - Optional templates configuration
 * @param depth - Current recursion depth (to prevent infinite loops)
 * @returns The processed content with includes expanded
 */
export async function processIncludes(
	content: string,
	baseDir: string,
	templates?: TemplatesConfig,
	depth = 0,
): Promise<string> {
	const MAX_DEPTH = 10;

	if (depth >= MAX_DEPTH) {
		throw new Error(
			`Maximum include depth (${MAX_DEPTH}) exceeded. Check for circular includes.`,
		);
	}

	// Process @template directives first
	if (templates) {
		const templateMatches = [...content.matchAll(TEMPLATE_REGEX)];
		for (const match of templateMatches) {
			const fullMatch = match[0];
			const templateName = match[1];
			if (!templateName) continue;

			const templatePath = templates[templateName];

			if (!templatePath) {
				throw new Error(
					`Unknown template "${templateName}". Available: ${Object.keys(templates).join(", ")}`,
				);
			}

			const resolvedPath = resolvePath(templatePath, baseDir);
			const templateContent = await readFile(resolvedPath);

			// Recursively process includes in the template
			const processedContent = await processIncludes(
				templateContent,
				dirname(resolvedPath),
				templates,
				depth + 1,
			);

			content = content.replace(fullMatch, processedContent);
		}
	}

	// Process @include directives
	const includeMatches = [...content.matchAll(INCLUDE_REGEX)];
	for (const match of includeMatches) {
		const fullMatch = match[0];
		const includePath = match[1] || match[2] || match[3];
		if (!includePath) continue;

		const resolvedPath = resolvePath(includePath, baseDir);
		const includeContent = await readFile(resolvedPath);

		// Recursively process includes in the included file
		const processedContent = await processIncludes(
			includeContent,
			dirname(resolvedPath),
			templates,
			depth + 1,
		);

		content = content.replace(fullMatch, processedContent);
	}

	return content;
}
