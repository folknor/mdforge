import { promises as fs } from "node:fs";
import { join, parse, resolve } from "node:path";
import type { PDFOptions } from "puppeteer";
import YAML from "yaml";

/**
 * Get the directory that a file is in.
 */
export const getDir = (filePath: string) => resolve(parse(filePath).dir);

/**
 * Derive the output file path from a source file.
 */
export const getOutputFilePath = (
	mdFilePath: string,
	extension: "html" | "pdf",
) => {
	const { dir, name } = parse(mdFilePath);
	return join(dir, `${name}.${extension}`);
};

/**
 * Check whether the input is a URL.
 */
export const isHttpUrl = (input: string) => {
	try {
		return new URL(input).protocol.startsWith("http");
	} catch {
		return false;
	}
};

/**
 * Get a margin object from a CSS-like margin string.
 */
export const getMarginObject = (margin: string): PDFOptions["margin"] => {
	if (typeof margin !== "string") {
		throw new TypeError(`margin needs to be a string.`);
	}

	const [top, right, bottom, left, ...remaining] = margin.split(" ");

	if (remaining.length > 0) {
		throw new Error(`invalid margin input "${margin}": can have max 4 values.`);
	}

	return left
		? { top, right, bottom, left }
		: bottom
			? { top, right, bottom, left: right }
			: right
				? { top, right, bottom: top, left: right }
				: top
					? { top, right: top, bottom: top, left: top }
					: undefined;
};

/**
 * Recursively resolve @filename references in config values.
 * References are resolved relative to the baseDir.
 */
export async function resolveFileRefs<T>(
	value: T,
	baseDir: string,
): Promise<T> {
	if (typeof value === "string" && value.startsWith("@")) {
		const filePath = resolve(baseDir, value.slice(1));
		return (await fs.readFile(filePath, "utf-8")) as T;
	}

	if (Array.isArray(value)) {
		return Promise.all(
			value.map((item) => resolveFileRefs(item, baseDir)),
		) as Promise<T>;
	}

	if (value !== null && typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value)) {
			result[key] = await resolveFileRefs(val, baseDir);
		}
		return result as T;
	}

	return value;
}

/**
 * Extract the first heading (h1 or h2) from markdown content.
 */
export function extractFirstHeading(md: string): string | null {
	const match = /^#{1,2}\s+(.+)$/m.exec(md);
	return match?.[1]?.trim() ?? null;
}

/**
 * Parse YAML front-matter from markdown content.
 */
export function parseFrontMatter(content: string): { data: Record<string, unknown>; content: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
	if (!match) return { data: {}, content };
	try {
		return {
			data: YAML.parse(match[1]!) || {},
			content: match[2]!,
		};
	} catch (error) {
		console.warn("Warning: front-matter could not be parsed:", error);
		return { data: {}, content };
	}
}
