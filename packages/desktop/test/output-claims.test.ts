import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { OutputClaims, oneAtATime, outputPathFor } from "../src/main/output-claims.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

async function scratch(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "mdforge-desktop-test-"));
}

test("outputPathFor strips only the file's own extension", () => {
  assert.equal(outputPathFor(join("a", "notes.md"), "out"), join("out", "notes.pdf"));
  assert.equal(outputPathFor(join("proj.d", "README"), "out"), join("out", "README.pdf"));
  assert.equal(outputPathFor(join("a", "x.y.markdown"), "out"), join("out", "x.y.pdf"));
});

test("inputs with distinct outputs are all written", async () => {
  const dir = await scratch();
  const claims = new OutputClaims();

  await claims.write(join(dir, "a.pdf"), "a.md", bytes("a"));
  await claims.write(join(dir, "b.pdf"), "b.md", bytes("b"));

  assert.equal(await fs.readFile(join(dir, "a.pdf"), "utf8"), "a");
  assert.equal(await fs.readFile(join(dir, "b.pdf"), "utf8"), "b");
});

test("a second input with the same output is refused and the first kept", async () => {
  const dir = await scratch();
  const claims = new OutputClaims();
  const out = join(dir, "notes.pdf");

  await claims.write(out, "a/notes.md", bytes("first"));
  await assert.rejects(claims.write(out, "b/notes.md", bytes("second")), /a\/notes\.md/);
  assert.equal(await fs.readFile(out, "utf8"), "first");
});

test("an output that is a symlink to an earlier output is refused", async () => {
  const dir = await scratch();
  const claims = new OutputClaims();

  await fs.symlink("a.pdf", join(dir, "b.pdf"));
  await claims.write(join(dir, "a.pdf"), "a.md", bytes("a"));
  await assert.rejects(claims.write(join(dir, "b.pdf"), "b.md", bytes("b")));
  assert.equal(await fs.readFile(join(dir, "a.pdf"), "utf8"), "a");
});

test("files from before the batch are replaced", async () => {
  const dir = await scratch();
  const out = join(dir, "notes.pdf");

  await fs.writeFile(out, "old");
  await new OutputClaims().write(out, "notes.md", bytes("new"));
  assert.equal(await fs.readFile(out, "utf8"), "new");
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
