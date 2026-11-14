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
 * - @include template-name (if defined in templates config)
 */
const INCLUDE_REGEX = /^@include\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/gm;

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
      throw new Error(`Include file not found: ${filePath}`, { cause: error });
    }

    throw new Error(
      `Failed to read include file: ${filePath} - ${err.message}`,
    );
  }
}

/**
 * Process @include directives in markdown content.
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
  depth: number = 0,
): Promise<string> {
  const MAX_DEPTH = 10;

  if (depth >= MAX_DEPTH) {
    throw new Error(
      `Maximum include depth (${MAX_DEPTH}) exceeded. Check for circular includes.`,
    );
  }

  // Process @include directives
  // If the argument matches a template name, use the template path
  // Otherwise treat it as a file path
  const includeMatches = [...content.matchAll(INCLUDE_REGEX)];

  for (const match of includeMatches) {
    const fullMatch = match[0];
    const includeArg = match[1] || match[2] || match[3];

    if (!includeArg) continue;

    // Check if it's a template name first
    let includePath = includeArg;
    const includeBaseDir = baseDir;

    if (templates?.[includeArg]) {
      includePath = templates[includeArg];
      // Template paths are relative to config file (baseDir)
    }

    const resolvedPath = resolvePath(includePath, includeBaseDir);
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
