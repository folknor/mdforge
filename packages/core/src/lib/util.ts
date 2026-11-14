import { join, parse, resolve } from "node:path";

/**
 * Get the directory that a file is in.
 */
export const getDir = (filePath: string): string =>
  resolve(parse(filePath).dir);

/**
 * Derive the output file path from a source file.
 */
export const getOutputFilePath = (
  mdFilePath: string,
  extension: "html" | "pdf",
): string => {
  const { dir, name } = parse(mdFilePath);

  return join(dir, `${name}.${extension}`);
};

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
