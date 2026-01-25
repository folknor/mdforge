#!/usr/bin/env node

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import {
	type Config,
	type ConvertResult,
	closeBrowser,
	convertMdToPdf,
	defaultConfig,
	formatConversionInfo,
	resolveFileRefs,
} from "@mdforge/core";
import arg from "arg";
import Listr from "listr";
import YAML from "yaml";

const help = (): void =>
	console.log(`
  Usage: mdforge [options] <files...>

  Options:

    -h, --help              Output usage information
    -v, --version           Output version
    -o, --output <path>     Output file path (only for single file)
    --as-html               Output as HTML instead of PDF
    --fillable              Generate fillable PDF with AcroForm fields
    --config-file <path>    Path to a YAML configuration file

  Examples:

    $ mdforge file.md
    $ mdforge file1.md file2.md file3.md
    $ mdforge *.md
    $ mdforge --as-html README.md
    $ mdforge --config-file config.yaml docs/*.md

  Config files use YAML format:

    stylesheet: custom.css
    header:
      right: Page {page}/{pages}
    footer:
      center: "{title}"

  Front-matter in markdown files can override config settings.
`);

// --
// Configure CLI Arguments

const cliSpec = {
	"--help": Boolean,
	"--version": Boolean,
	"--output": String,
	"--as-html": Boolean,
	"--fillable": Boolean,
	"--config-file": String,

	// aliases
	"-h": "--help",
	"-v": "--version",
	"-o": "--output",
} as const;

export const cliFlags: arg.Result<typeof cliSpec> = arg(cliSpec);

// --
// Run

main(cliFlags).catch((error) => {
	console.error(error);
	process.exit(1);
});

// --
// Define Main Function

async function main(args: typeof cliFlags): Promise<void> {
	process.title = "mdforge";

	if (args["--version"]) {
		const require = createRequire(import.meta.url);
		const { version } = require("../package.json");
		return console.log(version);
	}

	if (args["--help"]) {
		return help();
	}

	const files = args._;

	if (files.length === 0) {
		return help();
	}

	if (args["--output"] && files.length > 1) {
		console.error("Error: --output can only be used with a single input file");
		process.exit(1);
	}

	let config: Config = { ...defaultConfig };

	if (args["--config-file"]) {
		try {
			const configFilePath = resolve(args["--config-file"]);
			const configDir = dirname(configFilePath);
			const configContent = await fs.readFile(configFilePath, "utf-8");
			const configFile = await resolveFileRefs(
				YAML.parse(configContent) as Partial<Config>,
				configDir,
			);

			// Set basedir from config file location if not explicitly set
			if (!configFile.basedir) {
				configFile.basedir = configDir;
			}

			// Resolve relative stylesheet path to config directory
			if (typeof configFile.stylesheet === "string") {
				configFile.stylesheet = [resolve(configDir, configFile.stylesheet)];
			} else if (Array.isArray(configFile.stylesheet)) {
				configFile.stylesheet = configFile.stylesheet.map((s) =>
					typeof s === "string" && !s.startsWith("/") && !s.includes("\n")
						? resolve(configDir, s)
						: s,
				);
			}

			config = {
				...config,
				...configFile,
				pdf_options: { ...config.pdf_options, ...configFile.pdf_options },
			};
		} catch (error) {
			console.warn(
				`Warning: couldn't read config file: ${resolve(args["--config-file"])}`,
			);
			console.warn(error instanceof Error ? error.message : error);
		}
	}

	// CLI --output flag overrides config dest
	if (args["--output"]) {
		config.dest = resolve(args["--output"]);
	}

	// Store results for info display
	const results: Map<string, ConvertResult> = new Map();

	const getListrTask = (file: string): Listr.ListrTask => ({
		title: `generating ${args["--as-html"] ? "HTML" : "PDF"} from ${basename(file)}`,
		task: async (): Promise<ConvertResult> => {
			const result = await convertMdToPdf({ path: file }, config, { args });
			results.set(file, result);
			return result;
		},
	});

	await new Listr(files.map(getListrTask), {
		concurrent: true,
		exitOnError: false,
	})
		.run()
		.finally(async () => {
			await closeBrowser();
		});

	// Display conversion info for each file
	for (const [file, result] of results) {
		if (files.length > 1) {
			console.log(`\n${basename(file)}:`);
		}

		// Display any warnings
		if (result.info.warnings?.length > 0) {
			for (const warning of result.info.warnings) {
				console.warn(warning);
			}
		}

		const infoText = formatConversionInfo(result.info);
		if (infoText) {
			console.log(infoText);
		}
		if (result.info.output?.path && result.info.output.path !== "stdout") {
			console.log(`  → ${result.info.output.path}`);
		}
	}
}
