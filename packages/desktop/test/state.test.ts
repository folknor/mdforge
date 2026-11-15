import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversionResult } from "../src/types.ts";
import { type AppAction, type AppState, initialState, reducer } from "../src/renderer/state.ts";

function run(state: AppState, ...actions: AppAction[]): AppState {
  return actions.reduce(reducer, state);
}

function result(inputPath: string, warnings: string[] = []): ConversionResult {
  return { success: true, inputPath, outputPath: `${inputPath}.pdf`, warnings };
}

function file(state: AppState, path: string) {
  const found = state.files.find((f) => f.path === path);

  assert.ok(found, `no entry for ${path}`);

  return found;
}

function started(paths: string[], token = "t1"): AppState {
  const added = run(initialState, { type: "filesAdded", paths });

  return run(added, { type: "conversionStarted", token, members: added.files });
}

test("an entry removed and re-added mid-batch does not inherit the batch", () => {
  let state = started(["/a.md", "/b.md"]);

  state = run(
    state,
    { type: "fileRemoved", path: "/a.md" },
    { type: "filesAdded", paths: ["/a.md"] },
    { type: "conversionProgressed", progress: { batch: "t1", file: "/a.md", progress: 50 } },
    {
      type: "conversionFinished",
      token: "t1",
      results: [result("/a.md", ["warned"]), result("/b.md")],
    },
  );

  assert.deepEqual(file(state, "/a.md"), {
    id: 2,
    path: "/a.md",
    name: "a.md",
    status: "pending",
    progress: 0,
    warnings: [],
  });
  assert.equal(file(state, "/b.md").status, "done");
  assert.equal(state.batch, null);
});

test("entries added mid-batch stay pending", () => {
  const state = run(
    started(["/a.md"]),
    { type: "filesAdded", paths: ["/c.md"] },
    { type: "conversionFinished", token: "t1", results: [result("/a.md")] },
  );

  assert.equal(file(state, "/c.md").status, "pending");
  assert.equal(file(state, "/a.md").status, "done");
});

test("events from another batch are ignored, including its finish", () => {
  let state = started(["/a.md"], "new");

  state = run(
    state,
    { type: "conversionProgressed", progress: { batch: "old", file: "/a.md", progress: 50 } },
    { type: "conversionFinished", token: "old", results: [result("/a.md")] },
    { type: "conversionFailed", token: "old", error: "x" },
  );

  assert.equal(file(state, "/a.md").status, "converting");
  assert.equal(file(state, "/a.md").progress, 0);
  assert.equal(state.batch?.token, "new");
});

test("a second start while a batch runs is rejected", () => {
  const state = run(started(["/a.md"]), {
    type: "conversionStarted",
    token: "t2",
    members: [],
  });

  assert.equal(state.batch?.token, "t1");
});

test("a failed invocation ends the batch and marks its members failed", () => {
  const state = run(
    started(["/a.md"]),
    { type: "filesAdded", paths: ["/c.md"] },
    { type: "conversionFailed", token: "t1", error: "IPC gone" },
  );

  assert.equal(state.batch, null);
  assert.equal(file(state, "/a.md").status, "error");
  assert.equal(file(state, "/a.md").error, "IPC gone");
  assert.equal(file(state, "/c.md").status, "pending");
});

test("a member with no result is not left converting", () => {
  const state = run(started(["/a.md"]), { type: "conversionFinished", token: "t1", results: [] });

  assert.equal(file(state, "/a.md").status, "error");
});

test("one addition with a repeated path adds it once, and ids are never reused", () => {
  let state = run(initialState, { type: "filesAdded", paths: ["/a.md", "/a.md", "/b.md"] });

  assert.deepEqual(
    state.files.map((f) => [f.id, f.path]),
    [
      [0, "/a.md"],
      [1, "/b.md"],
    ],
  );

  state = run(state, { type: "filesCleared" }, { type: "filesAdded", paths: ["/a.md"] });

  assert.equal(file(state, "/a.md").id, 2);
});
