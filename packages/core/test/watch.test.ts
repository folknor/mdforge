import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createTargetWatcher } from "../src/lib/watch.ts";

// Scratch directories live beside the tests, not in the system temp dir
const scratchRoot = join(import.meta.dirname, ".scratch");

mkdirSync(scratchRoot, { recursive: true });

after(() => rmSync(scratchRoot, { recursive: true, force: true }));

/** Resolves with the first reported target, or rejects after a timeout. */
function nextChange(changes: string[], timeoutMs = 3000): Promise<string> {
  const start = changes.length;

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    const poll = (): void => {
      const change = changes[start];

      if (change !== undefined) resolve(change);
      else if (Date.now() > deadline) reject(new Error("no change reported"));
      else setTimeout(poll, 20);
    };

    poll();
  });
}

/** Let pending fs events and microtasks drain. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 200));

describe("createTargetWatcher", () => {
  it("keeps reporting a file saved by renaming a temp file over it", async () => {
    const dir = mkdtempSync(join(scratchRoot, "atomic-"));
    const file = join(dir, "doc.md");
    const changes: string[] = [];

    writeFileSync(file, "one");

    const watcher = createTargetWatcher({ onChange: (t) => changes.push(t) });

    watcher.setTargets([file]);
    await settle();

    for (const text of ["two", "three"]) {
      const pending = nextChange(changes);
      const temp = join(dir, `.doc.md.${text}`);

      writeFileSync(temp, text);
      renameSync(temp, file);
      assert.equal(await pending, file);
      await settle();
    }

    watcher.close();
  });

  it("reports a missing file when it is created", async () => {
    const dir = mkdtempSync(join(scratchRoot, "missing-"));
    const file = join(dir, "sub", "style.css");
    const changes: string[] = [];
    const watcher = createTargetWatcher({ onChange: (t) => changes.push(t) });

    watcher.setTargets([file]);
    await settle();

    const pending = nextChange(changes);

    mkdirSync(join(dir, "sub"));
    writeFileSync(file, "body {}");
    assert.equal(await pending, file);

    watcher.close();
  });

  it("does not report targets that were removed from the set or after close", async () => {
    const dir = mkdtempSync(join(scratchRoot, "removed-"));
    const kept = join(dir, "kept.md");
    const dropped = join(dir, "dropped.md");
    const changes: string[] = [];

    writeFileSync(kept, "");
    writeFileSync(dropped, "");

    const watcher = createTargetWatcher({ onChange: (t) => changes.push(t) });

    watcher.setTargets([kept, dropped]);
    watcher.setTargets([kept]);
    await settle();

    writeFileSync(dropped, "changed");
    await settle();
    assert.deepEqual(changes, []);

    watcher.close();
    writeFileSync(kept, "changed");
    await settle();
    assert.deepEqual(changes, []);
  });

  it("reports health as current state", async () => {
    const dir = mkdtempSync(join(scratchRoot, "health-"));
    const file = join(dir, "doc.md");
    const reports: Array<ReadonlyMap<string, string>> = [];

    writeFileSync(file, "");

    const watcher = createTargetWatcher({
      onChange: () => {},
      onHealth: (problems) => reports.push(problems),
    });

    watcher.setTargets([file]);
    await settle();
    // Full coverage from the start is the initial state, so nothing to report
    assert.deepEqual(reports, []);

    watcher.close();
  });
});
