#!/usr/bin/env node

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import {
	type Config,
	closeBrowser,
	convertMdToPdf,
	defaultConfig,
	resolveFileRefs,
} from "@mdforge/core";
import arg from "arg";
import Listr from "listr";
import YAML from "yaml";

const help = () =>
	console.log(`
  Usage: mdforge [options] <files...>

  Options:

    -h, --help              Output usage information
    -v, --version           Output version
    -o, --output <path>     Output file path (only for single file)
    --as-html               Output as HTML instead of PDF
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

export const cliFlags = arg({
	"--help": Boolean,
	"--version": Boolean,
	"--output": String,
	"--as-html": Boolean,
	"--config-file": String,

	// aliases
	"-h": "--help",
	"-v": "--version",
	"-o": "--output",
});

// --
// Run

main(cliFlags).catch((error) => {
	console.error(error);
	process.exit(1);
});

// --
// Define Main Function

async function main(args: typeof cliFlags) {
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

	const getListrTask = (file: string) => ({
		title: `generating ${args["--as-html"] ? "HTML" : "PDF"} from ${file}`,
		task: async () => convertMdToPdf({ path: file }, config, { args }),
	});

	await new Listr(files.map(getListrTask), {
		concurrent: true,
		exitOnError: false,
	})
		.run()
		.finally(async () => {
			await closeBrowser();
		});
}
