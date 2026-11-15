#!/usr/bin/env node

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { createTargetWatcher } from "@mdforge/core/watch";
import {
  BrowserPool,
  type Config,
  type ConvertOptions,
  type ConvertResult,
  defaultConfig,
  type LaunchSettings,
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

  Front-matter in markdown files can override config settings, but not
  the output path or format, which only the options above choose.
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

// --
// Run

main().catch((error) => {
  if (error instanceof arg.ArgError) {
    console.error(`Error: ${error.message}. See --help for usage.`);
  } else {
    console.error(error);
  }

  process.exit(1);
});

// --
// Define Main Function

async function main(): Promise<void> {
  const args = arg(cliSpec);

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

  // The invocation's output choices; neither the config file nor front matter
  // can change them.
  const convertOptions: ConvertOptions = {
    format: args["--as-html"] ? "html" : "pdf",
  };

  const output = args["--output"];

  if (output) {
    convertOptions.output = { kind: "file", path: resolve(output) };
  }

  // Left unset when the flag is absent, so a document can still ask for forms
  if (args["--fillable"]) {
    convertOptions.fillable = true;
  }

  // The browser every render shares, and the config file launch settings it
  // was made for, to notice when they change under watch
  let pool: BrowserPool | undefined;
  let poolSettings: string | undefined;

  /**
   * Build the run's config: defaults, then the config file, and the browser
   * pool for its launch settings. Called before every render so watch mode
   * picks up config file edits.
   */
  const loadConfig = async (): Promise<{ config: Config; browser: BrowserPool }> => {
    const configFileArg = args["--config-file"];
    let config: Config = { ...defaultConfig };
    let launchSettings: LaunchSettings = {};

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

        launchSettings = configFile.launchOptions ?? {};

        if (configFile.issues.length > 0) {
          console.warn(formatConfigIssues(configFile.issues, configFilePath));
        }

        config = {
          ...config,
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

    // The browser is shared across renders; relaunch it when the config file
    // changed how it should be launched. The settings are plain YAML data, so
    // their JSON identifies them.
    const settings = JSON.stringify(launchSettings);

    if (pool === undefined || settings !== poolSettings) {
      await pool?.close();
      pool = new BrowserPool(launchSettings);
      poolSettings = settings;
    }

    return { config, browser: pool };
  };

  const closeBrowser = async (): Promise<void> => {
    await pool?.close();
    pool = undefined;
  };

  /**
   * Render the targets. An input that fails to convert is an outcome, not an
   * exception: it lands in `failures`, and the inputs that succeeded beside it
   * are still reported and returned. Only something else going wrong throws.
   */
  const render = async (targets: string[]): Promise<RenderOutcome> => {
    const { config, browser } = await loadConfig();

    // Store results for info display
    const results: Map<string, ConvertResult> = new Map();
    const failures: Map<string, Error> = new Map();

    const getListrTask = (file: string): Listr.ListrTask => ({
      title: `generating ${convertOptions.format === "html" ? "HTML" : "PDF"} from ${basename(file)}`,
      task: async (): Promise<void> => {
        let result: ConvertResult;

        try {
          result = await browser.convertMdToPdf({ path: file }, config, convertOptions);
        } catch (thrown) {
          const error = thrown instanceof Error ? thrown : new Error(String(thrown));
          failures.set(file, error);
          // Rethrown so Listr shows the task as failed
          throw error;
        }

        results.set(file, result);
      },
    });

    try {
      await new Listr(targets.map(getListrTask), {
        concurrent: true,
        exitOnError: false,
      }).run();
    } catch (error) {
      // Listr rejects with an aggregate (`errors: Error[]`) once any task
      // failed. One made only of errors the tasks recorded is already in
      // `failures`; anything else, an empty aggregate included, is not an
      // input failure.
      const recorded = new Set<unknown>(failures.values());
      const errors = error instanceof Error && "errors" in error ? error.errors : undefined;

      const isInputFailures =
        Array.isArray(errors) && errors.length > 0 && errors.every((each) => recorded.has(each));

      if (!isInputFailures) throw error;
    }

    for (const [file, error] of failures) {
      console.error(`${basename(file)}: ${error.message}`);
    }

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

      if (result.info.output) {
        console.log(`  → ${result.info.output.path}`);
      }
    }

    return { results, failures };
  };

  let initial: RenderOutcome;

  try {
    initial = await render(files);
  } catch (error) {
    await closeBrowser();
    throw error;
  }

  if (!args["--watch"]) {
    await closeBrowser();

    if (initial.failures.size > 0) process.exitCode = 1;

    return;
  }

  // Watch mode starts even when inputs failed: fixing them is what the user
  // is about to do, and a failed input is watched for that edit.

  const configFile = args["--config-file"];

  watchAndRerender(
    files,
    initial.results,
    () => (configFile ? [resolve(configFile), ...configDependencies] : []),
    render,
    closeBrowser,
  );
}

/** One render's per-input results, and the inputs that failed to convert. */
interface RenderOutcome {
  results: Map<string, ConvertResult>;
  failures: Map<string, Error>;
}

// --
// Watch Mode

/**
 * Re-render inputs whenever they — or a file they depend on — change. The
 * watching itself (directories, atomic saves, missing files, retries) is
 * core's target watcher; this owns which inputs each target re-renders.
 */
function watchAndRerender(
  files: string[],
  initial: Map<string, ConvertResult>,
  /** The config file and the files it references, as of the last render. */
  configFiles: () => string[],
  render: (targets: string[]) => Promise<RenderOutcome>,
  closeBrowser: () => Promise<void>,
): void {
  const debounceMs = 150;

  // input -> absolute paths it depends on: itself plus info.dependencies of its
  // last successful render (a failed input keeps the previous set, and one
  // that never succeeded watches only itself)
  const inputTargets = new Map<string, Set<string>>();
  // The config file and its @file references as of the last config load;
  // every input depends on them
  let configTargets = new Set<string>();

  const warned = new Set<string>();

  // Watch failures recover on the watcher's own retry timer, independent of
  // renders, and a failure never reports a change by itself
  const watcher = createTargetWatcher({
    onChange: (target) => scheduleDependentsOf(target),
    onWarning: (path, reason) => {
      if (warned.has(path)) return;
      warned.add(path);
      console.warn(`Warning: cannot watch ${path}: ${reason}`);
    },
  });

  /** The config's targets plus every input's. */
  const wantedTargets = (): Set<string> => {
    const wanted = new Set(configTargets);

    for (const targets of inputTargets.values()) {
      for (const target of targets) wanted.add(target);
    }

    return wanted;
  };

  const timers = new Map<string, NodeJS.Timeout>();
  const queued = new Set<string>();
  let rendering = false;

  const rerender = async (): Promise<void> => {
    if (rendering || queued.size === 0) return;
    rendering = true;
    const targets = [...queued];
    queued.clear();

    try {
      // A failed input keeps its previous targets
      const { results } = await render(targets);

      for (const [file, result] of results) setInputTargets(file, result);
    } catch (error) {
      // Not an input failure (those render reports itself)
      console.error(error instanceof Error ? error.message : error);
    } finally {
      // The config was reloaded even if the render then failed
      configTargets = new Set(configFiles());
      watcher.setTargets(wantedTargets());
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

  const scheduleDependentsOf = (target: string): void => {
    if (configTargets.has(target)) {
      for (const file of files) schedule(file);

      return;
    }

    for (const [file, targets] of inputTargets) {
      if (targets.has(target)) schedule(file);
    }
  };

  const setInputTargets = (file: string, result?: ConvertResult): void => {
    const path = resolve(file);
    const deps = (result?.info.dependencies ?? []).map((dep) => resolve(dirname(path), dep));

    inputTargets.set(file, new Set([path, ...deps]));
  };

  for (const file of files) {
    setInputTargets(file, initial.get(file));
  }

  configTargets = new Set(configFiles());
  watcher.setTargets(wantedTargets());

  const shutdown = (): void => {
    watcher.close();

    void closeBrowser().then(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const first = files[0];

  const what = files.length === 1 && first ? basename(first) : `${files.length} files`;

  console.log(`\nwatching ${what} — ctrl-c to stop`);
}
