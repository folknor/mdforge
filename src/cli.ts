#!/usr/bin/env node

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import arg from "arg";
import Listr from "listr";
import YAML from "yaml";
import { type Config, defaultConfig } from "./lib/config.js";
import { closeBrowser } from "./lib/generate-output.js";
import { convertMdToPdf } from "./lib/md-to-pdf.js";
import { resolveFileRefs } from "./lib/util.js";

const help = () =>
	console.log(`
  Usage: md-to-pdf [options] <files...>

  Options:

    -h, --help              Output usage information
    -v, --version           Output version
    -o, --output <path>     Output file path (only for single file)
    --as-html               Output as HTML instead of PDF
    --config-file <path>    Path to a YAML configuration file

  Examples:

    $ md-to-pdf file.md
    $ md-to-pdf file1.md file2.md file3.md
    $ md-to-pdf *.md
    $ md-to-pdf --as-html README.md
    $ md-to-pdf --config-file config.yaml docs/*.md

  Config files use YAML format. Use @filename to reference external files:

    pdf_options:
      headerTemplate: "@header.html"
      footerTemplate: "@footer.html"
    stylesheet:
      - "@style.css"

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
	process.title = "md-to-pdf";

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
			let configFile: Partial<Config>;

			if (configFilePath.endsWith(".js") || configFilePath.endsWith(".cjs")) {
				// Load JS/CJS config via dynamic import
				const { pathToFileURL } = await import("node:url");
				const { createRequire } = await import("node:module");
				let rawConfig: Partial<Config>;

				if (configFilePath.endsWith(".cjs")) {
					// CommonJS config
					const require = createRequire(import.meta.url);
					rawConfig = require(configFilePath);
				} else {
					// ES module config
					const module = await import(pathToFileURL(configFilePath).href);
					rawConfig = module.default || module;
				}

				configFile = await resolveFileRefs(rawConfig, dirname(configFilePath));
			} else {
				// Load YAML config
				const configContent = await fs.readFile(configFilePath, "utf-8");
				configFile = await resolveFileRefs(
					YAML.parse(configContent) as Partial<Config>,
					dirname(configFilePath),
				);
			}

			// Set basedir from config file location if not explicitly set
			const configDir = dirname(configFilePath);
			if (!configFile.basedir) {
				configFile.basedir = configDir;
			}

			// Resolve relative stylesheet paths to config directory
			if (Array.isArray(configFile.stylesheet)) {
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
