#!/usr/bin/env node

import { existsSync, type FSWatcher, promises as fs, watch } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import {
  type Config,
  type ConvertResult,
  closeBrowser,
  convertMdToPdf,
  defaultConfig,
  formatConfigIssues,
  formatConversionInfo,
  parseConfigYaml,
} from "@mdforge/renderer-puppeteer";
import arg from "arg";
import Listr from "listr";

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
    -w, --watch             Re-render when an input file or its stylesheet changes

  Examples:

    $ mdforge file.md
    $ mdforge file1.md file2.md file3.md
    $ mdforge *.md
    $ mdforge --as-html README.md
    $ mdforge --config-file config.yaml docs/*.md
    $ mdforge --watch doc.md

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
  "--watch": Boolean,

  // aliases
  "-h": "--help",
  "-v": "--version",
  "-o": "--output",
  "-w": "--watch",
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

  // Files the config file read through @file references; watch mode
  // re-renders every input when one of them changes.
  const configDependencies: string[] = [];

  // Launch options of the last load, to notice when they change under watch
  let launchOptions: string | undefined;

  /**
   * Build the run's config: defaults, then the config file, then --output.
   * Called before every render so watch mode picks up config file edits.
   */
  const loadConfig = async (): Promise<Config> => {
    const configFileArg = args["--config-file"];
    let config: Config = { ...defaultConfig };

    configDependencies.length = 0;

    if (configFileArg) {
      const configFilePath = resolve(configFileArg);
      const configDir = dirname(configFilePath);

      try {
        const configContent = await fs.readFile(configFilePath, "utf-8");

        const configFile = await parseConfigYaml(configContent, {
          source: "config-file",
          baseDir: configDir,
          dependencies: configDependencies,
        });

        if (configFile.issues.length > 0) {
          console.warn(formatConfigIssues(configFile.issues, configFilePath));
        }

        config = {
          ...config,
          // basedir defaults to the config file's directory
          basedir: configDir,
          ...configFile.config,
          pdf_options: {
            ...config.pdf_options,
            ...configFile.config.pdf_options,
          },
        };
      } catch (error) {
        console.warn(`Warning: couldn't read config file: ${configFilePath}`);
        console.warn(error instanceof Error ? error.message : error);
      }
    }

    // CLI --output flag overrides config dest
    if (args["--output"]) {
      config.dest = resolve(args["--output"]);
    }

    // The browser is shared across renders; relaunch it when the config file
    // changed how it should be launched.
    const launch = JSON.stringify(config.launch_options);

    if (launchOptions !== undefined && launch !== launchOptions) {
      await closeBrowser();
    }

    launchOptions = launch;

    return config;
  };

  const render = async (
    targets: string[],
  ): Promise<Map<string, ConvertResult>> => {
    const config = await loadConfig();

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

    await new Listr(targets.map(getListrTask), {
      concurrent: true,
      exitOnError: false,
    }).run();

    // Display conversion info for each file
    for (const [file, result] of results) {
      if (targets.length > 1) {
        console.log(`\n${basename(file)}:`);
      }

      // Display any warnings
      if (result.info.warnings.length > 0) {
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

    return results;
  };

  let initial: Map<string, ConvertResult>;

  try {
    initial = await render(files);
  } catch (error) {
    await closeBrowser();
    throw error;
  }

  if (!args["--watch"]) {
    await closeBrowser();

    return;
  }

  const configFile = args["--config-file"];

  watchAndRerender(
    files,
    initial,
    () => (configFile ? [resolve(configFile), ...configDependencies] : []),
    render,
  );
}

// --
// Watch Mode

/**
 * Re-render inputs whenever they — or a file they depend on — change.
 *
 * Watches the containing *directories* rather than the files themselves: many
 * editors save by writing a temp file and renaming it over the original, which
 * leaves a file-level watcher bound to a deleted inode.
 */
function watchAndRerender(
  files: string[],
  initial: Map<string, ConvertResult>,
  /** The config file and the files it references, as of the last render. */
  configFiles: () => string[],
  render: (targets: string[]) => Promise<Map<string, ConvertResult>>,
): void {
  const debounceMs = 150;

  // absolute path of a watched file -> inputs that must be re-rendered
  const dependents = new Map<string, Set<string>>();
  const watchedDirs = new Map<string, FSWatcher>();
  const timers = new Map<string, NodeJS.Timeout>();
  const queued = new Set<string>();
  let rendering = false;

  const rerender = async (): Promise<void> => {
    if (rendering || queued.size === 0) return;
    rendering = true;
    const targets = [...queued];
    queued.clear();

    try {
      const results = await render(targets);

      for (const file of targets) {
        trackDeps(file, results.get(file));
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    } finally {
      rendering = false;
      // Changes that landed mid-render
      void rerender();
    }
  };

  const schedule = (file: string): void => {
    clearTimeout(timers.get(file));
    timers.set(
      file,
      setTimeout(() => {
        timers.delete(file);
        queued.add(file);
        void rerender();
      }, debounceMs),
    );
  };

  const watchDir = (dir: string): void => {
    if (watchedDirs.has(dir)) return;

    const watcher = watch(dir, { persistent: true }, (_event, filename) => {
      if (!filename) return;
      const changed = resolve(dir, filename.toString());

      for (const file of dependents.get(changed) ?? []) {
        schedule(file);
      }
    });

    watcher.on("error", (error: Error) => {
      console.warn(`Warning: stopped watching ${dir}: ${error.message}`);
      watchedDirs.delete(dir);
    });
    watchedDirs.set(dir, watcher);
  };

  const addDep = (target: string, file: string): void => {
    if (!existsSync(target)) return;
    const set = dependents.get(target) ?? new Set<string>();
    set.add(file);
    dependents.set(target, set);
    watchDir(dirname(target));
  };

  /** Track a rendered file's own path plus every file that render read. */
  const trackDeps = (file: string, result?: ConvertResult): void => {
    const path = resolve(file);
    addDep(path, file);

    for (const configDep of configFiles()) {
      addDep(configDep, file);
    }

    for (const dep of result?.info.dependencies ?? []) {
      addDep(resolve(dirname(path), dep), file);
    }
  };

  for (const file of files) {
    trackDeps(file, initial.get(file));
  }

  const shutdown = (): void => {
    for (const watcher of watchedDirs.values()) {
      watcher.close();
    }

    void closeBrowser().then(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const first = files[0];

  const what =
    files.length === 1 && first ? basename(first) : `${files.length} files`;

  console.log(`\nwatching ${what} — ctrl-c to stop`);
}
