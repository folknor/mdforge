#!/usr/bin/env node

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import os from "node:os";
import process from "node:process";
import { getOutputFilePath, OutputClaims } from "@mdforge/core";
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

/**
 * The run's owner for process signals. The CLI handles SIGINT, SIGTERM and
 * SIGHUP itself for its whole life, in both modes, and launches every browser
 * with Puppeteer's own handlers off: Puppeteer's SIGINT handler kills the
 * browser and calls `process.exit(130)` at once, which pre-empts any cleanup
 * and every in-flight render's `finally` (scratch pages, output writes).
 *
 * On the first signal: stop taking work (the stop hooks), close every browser
 * pool, wait for the renders in flight to settle, then end the process by the
 * same signal so a calling shell sees the interruption (130/143/129). A second
 * signal, or the grace period running out, exits at once with that status.
 * The grace period counts event-loop time: a synchronous slice of conversion
 * work already running when the signal arrives finishes first.
 */
class Run {
  signal: NodeJS.Signals | undefined;
  readonly #pools = new Set<BrowserPool>();
  readonly #work = new Set<Promise<unknown>>();
  readonly #stopHooks: (() => void)[] = [];
  readonly #onSignal = (signal: NodeJS.Signals): void => this.#stop(signal);

  static readonly signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  static readonly graceMs = 10_000;

  constructor() {
    for (const signal of Run.signals) process.on(signal, this.#onSignal);
  }

  get stopped(): boolean {
    return this.signal !== undefined;
  }

  /** Throw when stopping, so no new work or browser starts. */
  check(): void {
    if (this.stopped) throw new Stopped();
  }

  /** A browser pool with Puppeteer's signal handling off, closed on a stop. */
  pool(settings: LaunchSettings): BrowserPool {
    this.check();

    const pool = new BrowserPool({
      ...settings,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });

    this.#pools.add(pool);

    return pool;
  }

  /** Close a pool and forget it once closed. */
  async closePool(pool: BrowserPool): Promise<void> {
    try {
      await pool.close();
    } finally {
      this.#pools.delete(pool);
    }
  }

  /** Track work a stop waits for. Registered before the caller yields. */
  track<T>(work: Promise<T>): Promise<T> {
    this.#work.add(work);

    const forget = (): void => {
      this.#work.delete(work);
    };

    work.then(forget, forget);

    return work;
  }

  onStop(hook: () => void): void {
    this.#stopHooks.push(hook);
  }

  /** Normal completion: the handlers go, so default signal handling returns. */
  dispose(): void {
    for (const signal of Run.signals) process.off(signal, this.#onSignal);
  }

  #stop(signal: NodeJS.Signals): void {
    const status = 128 + (os.constants.signals[signal] ?? 0);

    if (this.stopped) process.exit(status);

    this.signal = signal;

    // Referenced, so the process lives until it either fires or is cleared
    const deadline = setTimeout(() => process.exit(status), Run.graceMs);

    const settle = async (): Promise<void> => {
      for (const hook of this.#stopHooks) {
        try {
          hook();
        } catch (error) {
          console.error(error);
        }
      }

      await Promise.allSettled([
        ...[...this.#pools].map((pool) => this.closePool(pool)),
        ...this.#work,
      ]);
    };

    // Cannot reject: hooks are caught one by one and the rest is allSettled
    void settle().finally(() => {
      clearTimeout(deadline);
      this.dispose();
      // Another listener could swallow the re-raised signal
      setTimeout(() => process.exit(status), 1000);
      process.kill(process.pid, signal);
    });
  }
}

/** Work refused because the run is stopping on a signal. */
class Stopped extends Error {
  constructor() {
    super("Stopped by a signal");
  }
}

const run = new Run();

main().catch((error) => {
  // A signal's stop finishes the process
  if (run.stopped) return;

  run.dispose();

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

  // One entry per resolved path, so `a.md ./a.md` is one input rendered once.
  // Only lexical duplicates: inputs that alias through links stay separate,
  // and their shared output is caught by the claims below.
  const seen = new Set<string>();

  const files = args._.filter((file) => {
    const path = resolve(file);

    if (seen.has(path)) return false;
    seen.add(path);

    return true;
  });

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
  // The CLI writes the output itself (see render), so the conversion is
  // asked for the content only.
  const format = args["--as-html"] ? "html" : "pdf";
  const convertOptions: ConvertOptions = { format, output: { kind: "none" } };

  const output = args["--output"];

  /** Where an input is written: `-o`, else beside itself. */
  const destinationOf = (file: string): string =>
    output ? resolve(output) : getOutputFilePath(resolve(file), format);

  // Every output this run wrote, watch re-renders included: an input never
  // replaces a file another input of the run wrote (a.md and a.markdown,
  // case-only names on a case-insensitive volume, a symlinked output).
  const claims = new OutputClaims();

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

    run.check();

    if (pool === undefined || settings !== poolSettings) {
      const old = pool;
      pool = undefined;

      if (old) await run.closePool(old);
      // Checked again after the await: a stop closes only the pools it sees
      pool = run.pool(launchSettings);
      poolSettings = settings;
    }

    return { config, browser: pool };
  };

  const closeBrowser = async (): Promise<void> => {
    const closing = pool;
    pool = undefined;

    if (closing) await run.closePool(closing);
  };

  /**
   * Render the targets. An input that fails to convert is an outcome, not an
   * exception: it lands in `failures`, and the inputs that succeeded beside it
   * are still reported and returned. Only something else going wrong throws.
   */
  const render = async (targets: string[]): Promise<RenderOutcome> => {
    const { config, browser } = await loadConfig();

    run.check();

    // Store results for info display
    const results: Map<string, ConvertResult> = new Map();
    const failures: Map<string, Error> = new Map();

    // Inputs convert concurrently but write in input order, so the first
    // input, not the first to finish, owns a shared output. Each task's
    // commit slot settles only after its predecessor's has, whether it wrote,
    // failed or was stopped, so a failed input never lets a later one jump
    // ahead of an earlier one still converting.
    let previous: Promise<void> = Promise.resolve();

    const getListrTask = (file: string): Listr.ListrTask => {
      const prior = previous;
      const slot = Promise.withResolvers<void>();
      previous = slot.promise;

      return {
        title: `generating ${format === "html" ? "HTML" : "PDF"} from ${basename(file)}`,
        task: async (): Promise<void> => {
          try {
            const result = await browser.convertMdToPdf({ path: file }, config, convertOptions);

            await prior;
            run.check();

            const destination = destinationOf(file);

            await claims.write(destination, resolve(file), result.content);
            result.info.output = { path: destination };
            results.set(file, result);
          } catch (thrown) {
            const error = thrown instanceof Error ? thrown : new Error(String(thrown));
            failures.set(file, error);
            // Rethrown so Listr shows the task as failed
            throw error;
          } finally {
            await prior;
            slot.resolve();
          }
        },
      };
    };

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

    // Failures after a signal are the interruption, not the inputs'
    if (run.stopped) return { results, failures };

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
    initial = await run.track(render(files));
  } catch (error) {
    if (run.stopped) return;
    await closeBrowser();
    throw error;
  }

  // A signal mid-render: the stop finishes the process, and its failures
  // are the interruption, not the inputs
  if (run.stopped) return;

  if (!args["--watch"]) {
    await closeBrowser();
    run.dispose();

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
    if (run.stopped || rendering || queued.size === 0) return;
    rendering = true;
    // In input order: the first input wins an output neither currently owns
    const targets = files.filter((file) => queued.has(file));
    queued.clear();

    try {
      // A failed input keeps its previous targets
      const { results } = await run.track(render(targets));

      for (const [file, result] of results) setInputTargets(file, result);
    } catch (error) {
      // Not an input failure (those render reports itself)
      if (!run.stopped) console.error(error instanceof Error ? error.message : error);
    } finally {
      rendering = false;
    }

    if (!run.stopped) {
      // The config was reloaded even if the render then failed
      configTargets = new Set(configFiles());
      watcher.setTargets(wantedTargets());
      // Changes that landed mid-render
      void rerender();
    }
  };

  const schedule = (file: string): void => {
    if (run.stopped) return;
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

  // A stop ends watching and any debounced re-render; the run closes the
  // browser and waits for a render in flight
  run.onStop(() => watcher.close());
  run.onStop(() => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    queued.clear();
  });

  const first = files[0];

  const what = files.length === 1 && first ? basename(first) : `${files.length} files`;

  console.log(`\nwatching ${what} — ctrl-c to stop`);
}
