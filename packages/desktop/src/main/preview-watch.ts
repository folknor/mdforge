import { dirname, resolve } from "node:path";
import { createTargetWatcher, type TargetWatcher } from "@mdforge/core/watch";
import type { WebContents } from "electron";

/**
 * Live preview watching, owned by the main process and driven by preview
 * requests: the file a renderer asks to preview is watched, together with the
 * dependencies its last successful preview recorded (stylesheets, `@file`
 * targets, missing ones included). A change reaches the renderer as
 * "preview-source-changed"; the current watch problems as "watch-problems".
 *
 * The renderer never manages watches. Each webContents has at most one
 * subscription, reset when the renderer stops previewing, navigates or
 * reloads, crashes, or is destroyed.
 */

interface Subscription {
  watcher: TargetWatcher;
  file: string;
  /** Absolute dependency paths from the latest committed preview of `file`. */
  dependencies: string[];
  /** Id of the latest preview request; only it may commit dependencies. */
  latestRequest: number;
  debounce: NodeJS.Timeout | undefined;
}

const debounceMs = 150;
const subscriptions = new Map<number, Subscription>();
const lifecycleHooked = new Set<number>();
let requestCounter = 0;

function send(contents: WebContents, channel: string, ...args: unknown[]): void {
  if (!contents.isDestroyed()) contents.send(channel, ...args);
}

function reset(contents: WebContents): void {
  const sub = subscriptions.get(contents.id);

  if (!sub) return;
  subscriptions.delete(contents.id);
  clearTimeout(sub.debounce);
  sub.watcher.close();
  send(contents, "watch-problems", []);
}

/** Reset the subscription whenever the renderer that owns it goes away. */
function hookLifecycle(contents: WebContents): void {
  const { id } = contents;

  if (lifecycleHooked.has(id)) return;
  lifecycleHooked.add(id);

  contents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) reset(contents);
  });

  contents.on("render-process-gone", () => reset(contents));

  contents.once("destroyed", () => {
    // `contents` must not be touched once destroyed; drop state by id
    const sub = subscriptions.get(id);

    subscriptions.delete(id);
    lifecycleHooked.delete(id);

    if (sub) {
      clearTimeout(sub.debounce);
      sub.watcher.close();
    }
  });
}

/** Tell the renderer its preview is stale, once per burst of changes. */
function notify(contents: WebContents, sub: Subscription): void {
  if (subscriptions.get(contents.id) !== sub) return;
  clearTimeout(sub.debounce);
  sub.debounce = setTimeout(() => {
    sub.debounce = undefined;

    if (subscriptions.get(contents.id) === sub) send(contents, "preview-source-changed");
  }, debounceMs);
}

function subscribe(contents: WebContents, file: string): Subscription {
  const sub: Subscription = {
    watcher: createTargetWatcher({
      persistent: false,
      onChange: () => notify(contents, sub),
      onHealth: (problems) => {
        if (subscriptions.get(contents.id) !== sub) return;
        send(
          contents,
          "watch-problems",
          [...problems].map(([path, reason]) => ({ path, reason })),
        );
      },
    }),
    file,
    dependencies: [],
    latestRequest: 0,
    debounce: undefined,
  };

  subscriptions.set(contents.id, sub);

  return sub;
}

export interface PreviewRequest {
  /** Commit the dependencies of a finished preview; undefined when it failed. */
  complete: (dependencies: string[] | undefined) => void;
}

/**
 * Called synchronously when a preview request arrives, before conversion
 * starts, so the file is watched while it is being converted. Switching files
 * drops the previous file's watches at once.
 */
export function beginPreview(contents: WebContents, filePath: string): PreviewRequest {
  hookLifecycle(contents);

  const file = resolve(filePath);
  let sub = subscriptions.get(contents.id);

  if (sub?.file !== file) {
    if (sub) reset(contents);
    sub = subscribe(contents, file);
    sub.watcher.setTargets([file]);
  }

  const owner = sub;
  const request = ++requestCounter;

  owner.latestRequest = request;

  return {
    complete: (dependencies) => {
      // A superseded request, or one for a subscription since reset, must not
      // commit. Within the moment between a selection change in the renderer
      // and its new request arriving, a stale completion can still commit;
      // that costs at most one redundant preview.
      if (subscriptions.get(contents.id) !== owner || owner.latestRequest !== request) return;

      if (dependencies === undefined) return;

      const resolved = dependencies.map((dep) => resolve(dirname(file), dep));
      const before = new Set([file, ...owner.dependencies]);

      owner.dependencies = resolved;
      owner.watcher.setTargets([file, ...resolved]);

      // A newly watched dependency may have changed after the conversion read
      // it and before its watch was armed; one more preview settles it. A
      // stable dependency set does not trigger this again.
      const added = resolved.find((dep) => !before.has(dep));

      if (added !== undefined) notify(contents, owner);
    },
  };
}

/** The renderer has nothing selected: stop watching for it. */
export function stopPreviewWatch(contents: WebContents): void {
  reset(contents);
}
