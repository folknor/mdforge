#!/usr/bin/env node

import { type FSWatcher, promises as fs, statSync, watch } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import {
  type Config,
  type ConvertOptions,
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

  // Launch options of the last load, to notice when they change under watch
  let launchOptions: string | undefined;

  /**
   * Build the run's config: defaults, then the config file.
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

    // The browser is shared across renders; relaunch it when the config file
    // changed how it should be launched.
    const launch = JSON.stringify(config.launch_options);

    if (launchOptions !== undefined && launch !== launchOptions) {
      await closeBrowser();
    }

    launchOptions = launch;

    return config;
  };

  const render = async (targets: string[]): Promise<Map<string, ConvertResult>> => {
    const config = await loadConfig();

    // Store results for info display
    const results: Map<string, ConvertResult> = new Map();

    const getListrTask = (file: string): Listr.ListrTask => ({
      title: `generating ${convertOptions.format === "html" ? "HTML" : "PDF"} from ${basename(file)}`,
      task: async (): Promise<ConvertResult> => {
        const result = await convertMdToPdf({ path: file }, config, convertOptions);
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

      if (result.info.output) {
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

/** The directory's identity, or undefined when it is not a directory. */
function identity(dir: string): { dev: number; ino: number } | undefined {
  try {
    const stats = statSync(dir);

    return stats.isDirectory() ? { dev: stats.dev, ino: stats.ino } : undefined;
  } catch {
    return undefined;
  }
}

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

  // input -> absolute paths it depends on: itself plus info.dependencies of its
  // last completed render (a render that throws keeps the previous set)
  const inputTargets = new Map<string, Set<string>>();
  // The config file and its @file references as of the last config load;
  // every input depends on them
  let configTargets = new Set<string>();

  // Each target is armed by watching the deepest directory on its path that
  // exists, so a missing file — or a missing directory above it — is still
  // watched for. A directory's identity is kept to notice it being replaced.
  interface DirWatch {
    watcher: FSWatcher;
    dev: number;
    ino: number;
    targets: Set<string>;
  }

  const dirs = new Map<string, DirWatch>();
  // target -> the directory it is armed at
  const armedAt = new Map<string, string>();
  // Directories that failed to watch are skipped in favour of an ancestor
  // until a retry timer, independent of renders, makes them eligible again.
  // The delay doubles with each failure of the same directory, so one that
  // keeps failing costs at most a render per (growing) retry interval.
  const failed = new Set<string>();
  const failures = new Map<string, number>();
  // Targets watched more coarsely than intended because of a failure; a
  // change during that time may have gone unseen, so the next retry renders
  // their inputs once whether or not their arm moves
  const degraded = new Set<string>();
  const retryBaseMs = 5000;
  const retryMaxMs = 300_000;
  const warned = new Set<string>();

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
        const result = results.get(file);

        if (result) setInputTargets(file, result);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    } finally {
      // The config was reloaded even if the render then failed
      configTargets = new Set(configFiles());
      sync();
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

  /** The deepest existing, watchable directory on the target's path. */
  const deepestDir = (target: string): string | undefined => {
    let dir = dirname(target);

    for (;;) {
      if (identity(dir)) {
        if (!failed.has(dir)) return dir;
        // Skipping an existing directory watches the target too coarsely
        degraded.add(target);
      }

      const parent = dirname(dir);

      if (parent === dir) return undefined;
      dir = parent;
    }
  };

  const release = (dir: string): void => {
    const entry = dirs.get(dir);

    if (entry && entry.targets.size === 0) {
      entry.watcher.close();
      dirs.delete(dir);
    }
  };

  const detach = (target: string): void => {
    const dir = armedAt.get(target);

    if (dir === undefined) return;
    armedAt.delete(target);
    dirs.get(dir)?.targets.delete(target);
    release(dir);
  };

  /** The config's targets plus every input's. */
  const wantedTargets = (): Set<string> => {
    const wanted = new Set(configTargets);

    for (const targets of inputTargets.values()) {
      for (const target of targets) wanted.add(target);
    }

    return wanted;
  };

  const markFailed = (dir: string): void => {
    if (failed.has(dir)) return;
    const count = (failures.get(dir) ?? 0) + 1;

    failures.set(dir, count);
    failed.add(dir);

    const delay = Math.min(retryBaseMs * 2 ** (count - 1), retryMaxMs);

    setTimeout(() => {
      failed.delete(dir);

      // Every wanted target, unarmed ones included, moves back down if it
      // can; its file may have changed while it was watched too coarsely.
      // The timer stays referenced so watch mode outlives a moment with no
      // watcher at all.
      for (const target of wantedTargets()) {
        // Cleared first: arming may fail again and re-mark it
        const wasDegraded = degraded.delete(target);
        const moved = arm(target);

        if (moved || wasDegraded) scheduleDependentsOf(target);
      }
    }, delay);
  };

  const openWatch = (dir: string): DirWatch | undefined => {
    const id = identity(dir);

    if (!id) return undefined;

    let watcher: FSWatcher;

    try {
      watcher = watch(dir, { persistent: true }, (_event, filename) => {
        // Callbacks from a watcher that has since been replaced are stale
        if (dirs.get(dir)?.watcher !== watcher) return;
        reconcile(dir, filename ? resolve(dir, filename.toString()) : undefined);
      });
    } catch (error) {
      if (identity(dir)) warnOnce(dir, error instanceof Error ? error.message : String(error));
      markFailed(dir);

      return undefined;
    }

    watcher.on("error", (error: Error) => {
      const entry = dirs.get(dir);

      if (entry?.watcher !== watcher) return;
      warnOnce(dir, error.message);
      markFailed(dir);
      watcher.close();
      dirs.delete(dir);

      // Fall back to an ancestor without rendering: a watch that keeps
      // failing must not keep producing renders. The retry renders if
      // coverage comes back.
      for (const target of entry.targets) {
        armedAt.delete(target);
        degraded.add(target);
        arm(target);
      }
    });

    const entry: DirWatch = { watcher, ...id, targets: new Set() };
    dirs.set(dir, entry);

    return entry;
  };

  const warnOnce = (path: string, reason: string): void => {
    if (warned.has(path)) return;
    warned.add(path);
    console.warn(`Warning: cannot watch ${path}: ${reason}`);
  };

  /**
   * Watch for the target at the deepest directory on its path that exists,
   * reusing a healthy watcher there. Walks to a fixed point, because a deeper
   * directory can appear while a watcher is being registered; the old watcher
   * is released only after the new one is in place. Returns whether the
   * directory the target is armed at changed.
   */
  const arm = (target: string): boolean => {
    const before = armedAt.get(target);

    for (;;) {
      const dir = deepestDir(target);

      if (dir === undefined) {
        detach(target);
        warnOnce(target, "no watchable directory on its path");

        return before !== undefined;
      }

      if (!dirs.has(dir) && !openWatch(dir)) {
        degraded.add(target);
        continue;
      }

      if (deepestDir(target) !== dir) {
        // A deeper directory appeared meanwhile; drop the watcher if it was
        // opened for this target alone
        release(dir);
        continue;
      }

      const entry = dirs.get(dir);

      if (!entry) continue;

      if (before !== dir) {
        entry.targets.add(target);
        armedAt.set(target, dir);

        if (before !== undefined) {
          dirs.get(before)?.targets.delete(target);
          release(before);
        }
      }

      return before !== dir;
    }
  };

  /**
   * Respond to an event in a watched directory: re-validate the directory and
   * re-arm everything armed there, then schedule the inputs of the entry that
   * changed and of every target whose arm moved (a directory appeared or
   * went away). An event that names no entry schedules all of them.
   */
  const reconcile = (dir: string, changed: string | undefined): void => {
    const entry = dirs.get(dir);

    if (!entry) return;
    const snapshot = [...entry.targets];
    const id = identity(dir);

    if (!id || id.dev !== entry.dev || id.ino !== entry.ino) {
      // The directory was deleted or replaced: drop its watcher so arming
      // starts from what is on disk now
      entry.watcher.close();
      dirs.delete(dir);

      for (const target of snapshot) armedAt.delete(target);
    }

    for (const target of snapshot) {
      const moved = arm(target);

      if (moved || changed === undefined) scheduleDependentsOf(target);
    }

    if (changed !== undefined) scheduleDependentsOf(changed);
  };

  /**
   * Arm every current target and drop the ones no input needs any more.
   * A watched directory replaced without an event is noticed here.
   */
  const sync = (): void => {
    for (const [dir, entry] of dirs) {
      const id = identity(dir);

      if (!id || id.dev !== entry.dev || id.ino !== entry.ino) reconcile(dir, undefined);
    }

    const wanted = wantedTargets();

    for (const target of armedAt.keys()) {
      if (!wanted.has(target)) detach(target);
    }

    for (const target of wanted) arm(target);
  };

  for (const file of files) {
    setInputTargets(file, initial.get(file));
  }

  configTargets = new Set(configFiles());
  sync();

  const shutdown = (): void => {
    for (const { watcher } of dirs.values()) {
      watcher.close();
    }

    void closeBrowser().then(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const first = files[0];

  const what = files.length === 1 && first ? basename(first) : `${files.length} files`;

  console.log(`\nwatching ${what} — ctrl-c to stop`);
}
