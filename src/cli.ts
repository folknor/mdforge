#!/usr/bin/env node

// --
// Packages

import { createRequire } from "node:module";
import path from "node:path";
import arg from "arg";
import type { ChokidarOptions as WatchOptions } from "chokidar";
import { watch } from "chokidar";
import getPort from "get-port";
import getStdin from "get-stdin";
import Listr from "listr";
import { type Config, defaultConfig } from "./lib/config.js";
import { closeBrowser } from "./lib/generate-output.js";
import { help } from "./lib/help.js";
import { convertMdToPdf } from "./lib/md-to-pdf.js";
import { closeServer, serveDirectory } from "./lib/serve-dir.js";
import { validateNodeVersion } from "./lib/validate-node-version.js";

// --
// Configure CLI Arguments

export const cliFlags = arg({
	"--help": Boolean,
	"--version": Boolean,
	"--basedir": String,
	"--watch": Boolean,
	"--watch-options": String,
	"--stylesheet": [String],
	"--css": String,
	"--document-title": String,
	"--body-class": [String],
	"--page-media-type": String,
	"--highlight-style": String,
	"--marked-options": String,
	"--html-pdf-options": String,
	"--pdf-options": String,
	"--launch-options": String,
	"--gray-matter-options": String,
	"--port": Number,
	"--stylesheet-encoding": String,
	"--as-html": Boolean,
	"--config-file": String,
	"--devtools": Boolean,

	// aliases
	"-h": "--help",
	"-v": "--version",
	"-w": "--watch",
});

// --
// Run

main(cliFlags, defaultConfig).catch((error) => {
	console.error(error);
	process.exit(1);
});

// --
// Define Main Function

async function main(args: typeof cliFlags, config: Config) {
	process.title = "md-to-pdf";

	if (!validateNodeVersion()) {
		throw new Error(
			"Please use a Node.js version that satisfies the version specified in the engines field.",
		);
	}

	if (args["--version"]) {
		const require = createRequire(import.meta.url);
		const { version } = require("../package.json");
		return console.log(version);
	}

	if (args["--help"]) {
		return help();
	}

	/**
	 * 1. Get input.
	 */

	const files = args._;

	const stdin = await getStdin();

	if (files.length === 0 && !stdin) {
		return help();
	}

	/**
	 * 2. Read config file and merge it into the config object.
	 */

	if (args["--config-file"]) {
		try {
			const configFilePath = path.resolve(args["--config-file"]);

			// Handle both ES modules and CommonJS config files
			let configFile: Partial<Config>;

			if (configFilePath.endsWith('.cjs')) {
				// For .cjs files, use CommonJS require
				const require = createRequire(import.meta.url);
				configFile = require(configFilePath);
			} else if (configFilePath.endsWith('.js')) {
				// For .js files, try CommonJS require first (since most config files use CommonJS)
				// If that fails, fall back to ES module import
				try {
					const require = createRequire(import.meta.url);
					configFile = require(configFilePath);
				} catch (requireError) {
					// If CommonJS require fails, try ES module import
					try {
						const importedModule = await import(configFilePath);
						configFile = (importedModule as any).default || importedModule;
					} catch (importError) {
						// If both fail, rethrow the original require error
						throw requireError;
					}
				}
			} else {
				// For non-.js files, try to import with .js extension first, then .cjs
				try {
					const importPath = `${configFilePath}.js`;
					try {
						const require = createRequire(import.meta.url);
						configFile = require(importPath);
					} catch (requireError) {
						// If CommonJS require fails, try ES module import
						try {
							const importedModule = await import(importPath);
							configFile = (importedModule as any).default || importedModule;
						} catch (importError) {
							// Try .cjs extension
							const cjsImportPath = `${configFilePath}.cjs`;
							const require = createRequire(import.meta.url);
							configFile = require(cjsImportPath);
						}
					}
				} catch (error) {
					// If all attempts fail, rethrow
					throw error;
				}
			}

			config = {
				...config,
				...configFile,
				pdf_options: { ...config.pdf_options, ...configFile.pdf_options },
			};
		} catch (error) {
			console.warn(
				`Warning: couldn't read config file: ${path.resolve(args["--config-file"])}`,
			);
			console.warn(error instanceof SyntaxError ? error.message : error);
		}
	}

	/**
	 * 3. Start the file server.
	 */

	if (args["--basedir"]) {
		config.basedir = args["--basedir"];
	}

	config.port = args["--port"] ?? (await getPort());

	const server = await serveDirectory(config);

	/**
	 * 4. Either process stdin or create a Listr task for each file.
	 */

	if (stdin) {
		await convertMdToPdf({ content: stdin }, config, { args })
			.finally(async () => {
				await closeBrowser();
				await closeServer(server);
			})
			.catch((error: Error) => {
				throw error;
			});

		return;
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
		.then(async () => {
			if (args["--watch"]) {
				console.log("\n watching for changes \n");

				const watchOptions = args["--watch-options"]
					? (JSON.parse(args["--watch-options"]) as WatchOptions)
					: config.watch_options;

				watch(files, watchOptions).on("change", async (file) =>
					new Listr([getListrTask(file)], { exitOnError: false })
						.run()
						.catch(console.error),
				);
			} else {
				await closeBrowser();
				await closeServer(server);
			}
		})
		.catch((error: Error) => {
			/**
			 * In watch mode the error needs to be shown immediately because the `main` function's catch handler will never execute.
			 *
			 * @todo is this correct or does `main` actually finish and the process is just kept alive because of the file server?
			 */
			if (args["--watch"]) {
				return console.error(error);
			}

			throw error;
		});
}
