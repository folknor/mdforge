#!/usr/bin/env node

import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const examplesDir = join(__dirname, "..", "examples");
const cliPath = join(__dirname, "..", "packages", "cli", "dist", "cli.js");

/**
 * Get all outputs to generate for an example directory.
 * Returns array of { input, output, configFile, name } paths.
 *
 * For each .md file:
 * - Generate default output (using config.yaml if present)
 * - Generate variant outputs for each {name}.yaml file (e.g., fillable.yaml -> document-fillable.pdf)
 */
async function getExampleOutputs(examplePath) {
  const entries = await fs.readdir(examplePath, { withFileTypes: true });

  // Check for config.yaml in this example directory (default config)
  const hasDefaultConfig = entries.some((e) => e.isFile() && e.name === "config.yaml");

  const defaultConfigFile = hasDefaultConfig ? join(examplePath, "config.yaml") : null;

  // Find variant config files (*.yaml but not config.yaml)
  const variantConfigs = await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.endsWith(".yaml") && e.name !== "config.yaml")
      .map(async (e) => {
        const configPath = join(examplePath, e.name);
        const configContent = await fs.readFile(configPath, "utf-8");
        // Simple check for as_html: true (avoid adding yaml dependency)
        const isHtml = /^as_html:\s*true\s*$/m.test(configContent);

        return {
          name: e.name.replace(/\.yaml$/, ""),
          path: configPath,
          isHtml,
        };
      }),
  );

  const outputs = [];

  // For each markdown file
  for (const entry of entries) {
    if (!(entry.isFile() && entry.name.endsWith(".md"))) continue;

    const baseName = entry.name.replace(/\.md$/, "");
    const input = join(examplePath, entry.name);

    // Default output
    outputs.push({
      input,
      output: join(examplePath, `${baseName}.pdf`),
      name: entry.name,
      configFile: defaultConfigFile,
    });

    // Variant outputs (e.g., fillable.yaml -> document-fillable.pdf, html.yaml -> document-html.html)
    for (const variant of variantConfigs) {
      const ext = variant.isHtml ? "html" : "pdf";
      outputs.push({
        input,
        output: join(examplePath, `${baseName}-${variant.name}.${ext}`),
        name: `${entry.name} (${variant.name})`,
        configFile: variant.path,
      });
    }
  }

  return outputs;
}

async function regenerateExamples() {
  const filterExample = process.argv[2]; // Optional: single example name

  try {
    // Read all directories in examples
    const entries = await fs.readdir(examplesDir, { withFileTypes: true });

    let exampleDirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    // Filter to single example if specified
    if (filterExample) {
      const match = exampleDirs.find((d) => d === filterExample || d.startsWith(filterExample));

      if (!match) {
        console.error(`Example "${filterExample}" not found`);
        console.error(`Available: ${exampleDirs.join(", ")}`);
        process.exit(1);
      }

      exampleDirs = [match];
    }

    console.log(`Found ${exampleDirs.length} example(s)\n`);

    let totalGenerated = 0;
    let totalFailed = 0;

    for (const dir of exampleDirs) {
      const examplePath = join(examplesDir, dir);
      const outputs = await getExampleOutputs(examplePath);

      if (outputs.length === 0) {
        console.log(`⚠ Skipping ${dir}: no .md files found`);
        continue;
      }

      console.log(`${dir}/`);

      for (const { input, output, name, configFile } of outputs) {
        try {
          const configArg = configFile ? `--config-file "${configFile}"` : "";

          const result = execSync(`node "${cliPath}" ${configArg} "${input}" -o "${output}"`, {
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          });

          // Print CLI output (skip the "generating" lines, show the info)
          const lines = result
            .split("\n")
            .filter(
              (line) => line.trim() && !line.includes("[started]") && !line.includes("[completed]"),
            );

          for (const line of lines) {
            console.log(`  ${line.trim()}`);
          }

          if (lines.length === 0) {
            console.log(`  ✓ ${name}`);
          }

          totalGenerated++;
        } catch (error) {
          totalFailed++;

          // Extract error message (format: "[time] → Error message") - may be in stdout or stderr
          const errorOutput = (error.stdout?.toString() || "") + (error.stderr?.toString() || "");

          const errorMatch = errorOutput.match(/\] → (.+)/);

          if (errorMatch) {
            console.log(`  ✗ ${name}: ${errorMatch[1]}`);
          } else {
            console.log(`  ✗ ${name}: conversion failed`);
          }
        }
      }

      console.log("");
    }

    console.log(`Done! Generated ${totalGenerated} PDF(s), ${totalFailed} failed.`);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

regenerateExamples().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
