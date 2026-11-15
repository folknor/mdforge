import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { oneAtATime, outputPathFor } from "../src/main/output-claims.ts";

// The claims themselves are tested in packages/core/test/output-claims.test.ts.

test("outputPathFor strips only the file's own extension", () => {
  assert.equal(outputPathFor(join("a", "notes.md"), "out"), join("out", "notes.pdf"));
  assert.equal(outputPathFor(join("proj.d", "README"), "out"), join("out", "README.pdf"));
  assert.equal(outputPathFor(join("a", "x.y.markdown"), "out"), join("out", "x.y.pdf"));
});

test("batches run one at a time and a failure does not stop the next", async () => {
  const order: string[] = [];
  const { promise: gate, resolve: release } = Promise.withResolvers<void>();

  const first = oneAtATime(async () => {
    order.push("first start");
    await gate;
    order.push("first end");
    throw new Error("boom");
  });

  const second = oneAtATime(async () => {
    order.push("second");

    return 2;
  });

  release();
  await assert.rejects(first, /boom/);
  assert.equal(await second, 2);
  assert.deepEqual(order, ["first start", "first end", "second"]);
});
