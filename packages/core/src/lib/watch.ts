/**
 * Watching a set of files for changes, robust to the ways editors and tools
 * replace them.
 *
 * Watches the containing *directories* rather than the files themselves: many
 * editors save by writing a temp file and renaming it over the original, which
 * leaves a file-level watcher bound to a deleted inode. Each target is armed
 * at the deepest directory on its path that exists, so a missing file - or a
 * missing directory above it - is still watched for, and a directory's
 * identity is kept to notice it being deleted or replaced.
 *
 * Node-only: this module uses `node:fs`.
 */

import { type FSWatcher, statSync, watch } from "node:fs";
import { dirname, resolve } from "node:path";

export interface TargetWatcherOptions {
  /**
   * A watched target changed, appeared, disappeared, or may have changed
   * unseen while it was watched too coarsely. Only targets in the current set
   * are reported. Called asynchronously (never from inside `setTargets`), so
   * it may call `setTargets` or `close`.
   */
  onChange: (target: string) => void;
  /**
   * Each failure to watch a path (the same path can fail repeatedly),
   * delivered asynchronously like `onChange`. For logging; `onHealth` is the
   * current state.
   */
  onWarning?: (path: string, reason: string) => void;
  /**
   * The targets currently watched more coarsely than intended, or not at all,
   * with the reason. Delivered when it differs from the last delivery; an
   * empty map means every target has full coverage again.
   */
  onHealth?: (problems: ReadonlyMap<string, string>) => void;
  /** Whether the watchers and retry timers keep the process alive. Default true. */
  persistent?: boolean;
}

export interface TargetWatcher {
  /** Replace the watched set with these absolute paths. */
  setTargets: (targets: Iterable<string>) => void;
  /** Stop watching; no callback runs afterwards. */
  close: () => void;
}

/** The directory's identity, or undefined when it is not a directory. */
function identity(dir: string): { dev: number; ino: number } | undefined {
  try {
    const stats = statSync(dir);

    return stats.isDirectory() ? { dev: stats.dev, ino: stats.ino } : undefined;
  } catch {
    return undefined;
  }
}

const noWatchableDir = "no watchable directory on its path";

export function createTargetWatcher(options: TargetWatcherOptions): TargetWatcher {
  const { onChange, onWarning, onHealth } = options;
  const persistent = options.persistent ?? true;

  interface DirWatch {
    watcher: FSWatcher;
    dev: number;
    ino: number;
    targets: Set<string>;
  }

  let closed = false;
  let wanted = new Set<string>();
  const dirs = new Map<string, DirWatch>();
  // target -> the directory it is armed at
  const armedAt = new Map<string, string>();
  // Directories that failed to watch, with the reason, are skipped in favour
  // of an ancestor until a retry timer makes them eligible again. The delay
  // doubles with each failure of the same directory, so one that keeps
  // failing costs at most one change report per (growing) retry interval.
  const failed = new Map<string, string>();
  const failures = new Map<string, number>();
  const retryTimers = new Set<NodeJS.Timeout>();
  // Targets watched more coarsely than intended since the last retry; a
  // change during that time may have gone unseen, so the next retry reports
  // them once whether or not their arm moves. This is retry bookkeeping, not
  // health: health is derived from the current arms and failures.
  const degraded = new Set<string>();
  const retryBaseMs = 5000;
  const retryMaxMs = 300_000;

  // Reports are queued and delivered on a microtask, so a callback never runs
  // while the watch state is mid-update and may itself change the target set.
  const pending = new Set<string>();
  const warnings: Array<[string, string]> = [];
  let flushQueued = false;
  let lastHealth = "[]";

  const health = (): Map<string, string> => {
    const problems = new Map<string, string>();

    for (const target of wanted) {
      const armed = armedAt.get(target);

      if (armed === undefined) {
        problems.set(target, noWatchableDir);
        continue;
      }

      // A failed directory between the target and its arm is coverage lost
      for (let dir = dirname(target); dir !== armed; dir = dirname(dir)) {
        const reason = failed.get(dir);

        if (reason !== undefined && identity(dir)) {
          problems.set(target, `cannot watch ${dir}: ${reason}`);
          break;
        }

        if (dirname(dir) === dir) break;
      }
    }

    return problems;
  };

  const flush = (): void => {
    flushQueued = false;

    for (let warning = warnings.shift(); warning; warning = warnings.shift()) {
      if (closed) return;
      onWarning?.(...warning);
    }

    // Deleting the current entry, or a callback adding one, is safe while
    // iterating a Set
    for (const target of pending) {
      if (closed) return;
      pending.delete(target);

      // The set may have changed since the report was queued, including by
      // an earlier callback in this flush
      if (wanted.has(target)) onChange(target);
    }

    if (closed || !onHealth) return;
    const problems = health();
    const key = JSON.stringify([...problems]);

    if (key !== lastHealth) {
      lastHealth = key;
      onHealth(problems);
    }
  };

  const queueFlush = (): void => {
    if (flushQueued || closed) return;
    flushQueued = true;
    queueMicrotask(flush);
  };

  const report = (target: string): void => {
    pending.add(target);
    queueFlush();
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

  const markFailed = (dir: string, reason: string): void => {
    if (failed.has(dir)) return;
    const count = (failures.get(dir) ?? 0) + 1;

    failures.set(dir, count);
    failed.set(dir, reason);

    const delay = Math.min(retryBaseMs * 2 ** (count - 1), retryMaxMs);

    const timer = setTimeout(() => {
      retryTimers.delete(timer);

      if (closed) return;
      failed.delete(dir);

      // Every wanted target, unarmed ones included, moves back down if it
      // can; its file may have changed while it was watched too coarsely.
      for (const target of wanted) {
        // Cleared first: arming may fail again and re-mark it
        const wasDegraded = degraded.delete(target);
        const moved = arm(target);

        if (moved || wasDegraded) report(target);
      }

      queueFlush();
    }, delay);

    // A persistent watch outlives a moment with no watcher at all
    if (!persistent) timer.unref();
    retryTimers.add(timer);
  };

  const fail = (path: string, reason: string): void => {
    if (!onWarning) return;
    warnings.push([path, reason]);
    queueFlush();
  };

  const openWatch = (dir: string): DirWatch | undefined => {
    const id = identity(dir);

    if (!id) return undefined;

    let watcher: FSWatcher;

    try {
      watcher = watch(dir, { persistent }, (_event, filename) => {
        // Callbacks from a watcher that has since been replaced are stale
        if (closed || dirs.get(dir)?.watcher !== watcher) return;
        reconcile(dir, filename ? resolve(dir, filename.toString()) : undefined);
        queueFlush();
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      if (identity(dir)) fail(dir, reason);
      markFailed(dir, reason);

      return undefined;
    }

    watcher.on("error", (error: Error) => {
      const entry = dirs.get(dir);

      if (closed || entry?.watcher !== watcher) return;
      fail(dir, error.message);
      markFailed(dir, error.message);
      watcher.close();
      dirs.delete(dir);

      // Fall back to an ancestor without reporting a change: a watch that
      // keeps failing must not keep producing reports. The retry reports if
      // coverage comes back.
      for (const target of entry.targets) {
        armedAt.delete(target);
        degraded.add(target);
        arm(target);
      }

      queueFlush();
    });

    const entry: DirWatch = { watcher, ...id, targets: new Set() };
    dirs.set(dir, entry);

    return entry;
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
        if (before === undefined) fail(target, noWatchableDir);
        detach(target);

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
   * re-arm everything armed there, then report the entry that changed and
   * every target whose arm moved (a directory appeared or went away). An
   * event that names no entry reports all of them.
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

      if (moved || changed === undefined) report(target);
    }

    if (changed !== undefined) report(changed);
  };

  const setTargets = (targets: Iterable<string>): void => {
    if (closed) return;
    wanted = new Set(targets);

    // Drop what is no longer wanted first, so re-validation below reports
    // only targets still in the set
    for (const target of armedAt.keys()) {
      if (!wanted.has(target)) detach(target);
    }

    for (const target of degraded) {
      if (!wanted.has(target)) degraded.delete(target);
    }

    // A watched directory replaced without an event is noticed here
    for (const [dir, entry] of dirs) {
      const id = identity(dir);

      if (!id || id.dev !== entry.dev || id.ino !== entry.ino) reconcile(dir, undefined);
    }

    // Arming a target is not a change to it
    for (const target of wanted) arm(target);

    queueFlush();
  };

  const close = (): void => {
    if (closed) return;
    closed = true;

    for (const timer of retryTimers) clearTimeout(timer);
    retryTimers.clear();

    for (const { watcher } of dirs.values()) watcher.close();
    dirs.clear();
    armedAt.clear();
    pending.clear();
    warnings.length = 0;
  };

  return { setTargets, close };
}
