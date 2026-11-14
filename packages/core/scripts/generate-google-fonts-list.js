#!/usr/bin/env node
/**
 * Extract Google Fonts family names from google-font-metadata
 * Run at build time to generate a small JSON file for runtime use
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { APIDirect } from "google-font-metadata";

const outputPath = join(
  import.meta.dirname,
  "..",
  "src",
  "data",
  "google-fonts.json",
);

// Extract just the family names (lowercase for case-insensitive lookup)
const fontNames = APIDirect.map((f) => f.family.toLowerCase());

// Write as a JSON array
writeFileSync(outputPath, JSON.stringify(fontNames), "utf-8");

console.log(
  `Generated ${outputPath} with ${fontNames.length} fonts (${(JSON.stringify(fontNames).length / 1024).toFixed(1)}KB)`,
);
