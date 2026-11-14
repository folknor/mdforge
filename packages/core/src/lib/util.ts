import { join, parse, resolve } from "node:path";

/**
 * Get the directory that a file is in.
 */
export const getDir = (filePath: string): string => resolve(parse(filePath).dir);

/**
 * Derive the output file path from a source file.
 */
export const getOutputFilePath = (mdFilePath: string, extension: "html" | "pdf"): string => {
  const { dir, name } = parse(mdFilePath);

  return join(dir, `${name}.${extension}`);
};

/**
 * Escape text for HTML element content or a double-quoted attribute value.
 * A file URL keeps `&` and `'` as they are, and `&` would start a character
 * reference.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Check whether the input is a URL.
 */
export const isHttpUrl = (input: string): boolean => {
  try {
    return new URL(input).protocol.startsWith("http");
  } catch {
    return false;
  }
};

/**
 * Extract the first heading (h1 or h2) from markdown content.
 */
export function extractFirstHeading(md: string): string | null {
  const match = /^#{1,2}\s+(.+)$/m.exec(md);

  return match?.[1]?.trim() ?? null;
}
