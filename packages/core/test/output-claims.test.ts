import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { OutputClaims } from "../src/lib/output-claims.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

async function scratch(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "mdforge-claims-test-"));
}

test("inputs with distinct outputs are all written", async () => {
  const dir = await scratch();
  const claims = new OutputClaims();

  await claims.write(join(dir, "a.pdf"), "a.md", bytes("a"));
  await claims.write(join(dir, "b.html"), "b.md", "<p>b</p>");

  assert.equal(await fs.readFile(join(dir, "a.pdf"), "utf8"), "a");
  assert.equal(await fs.readFile(join(dir, "b.html"), "utf8"), "<p>b</p>");
});

test("a second input with the same output is refused and the first kept", async () => {
  const dir = await scratch();
  const claims = new OutputClaims();
  const out = join(dir, "notes.pdf");

  await claims.write(out, "a/notes.md", bytes("first"));
  await assert.rejects(claims.write(out, "b/notes.md", bytes("second")), /a\/notes\.md/);
  assert.equal(await fs.readFile(out, "utf8"), "first");
});

test("concurrent writes to one output: the first call wins", async () => {
  const dir = await scratch();
  const claims = new OutputClaims();
  const out = join(dir, "a.pdf");

  const results = await Promise.allSettled([
    claims.write(out, "a.md", bytes("first")),
    claims.write(out, "a.markdown", bytes("second")),
  ]);

  assert.equal(results[0]?.status, "fulfilled");
  assert.equal(results[1]?.status, "rejected");
  assert.equal(await fs.readFile(out, "utf8"), "first");
});

test("the owner keeps its output across rewrites", async () => {
  const dir = await scratch();
  const claims = new OutputClaims();
  const out = join(dir, "a.pdf");

  await claims.write(out, "a.md", bytes("1"));
  await claims.write(out, "a.md", bytes("2"));
  await assert.rejects(claims.write(out, "a.markdown", bytes("x")));
  await claims.write(out, "a.md", bytes("3"));
  assert.equal(await fs.readFile(out, "utf8"), "3");
});

test("a refused write does not stop later writes", async () => {
  const dir = await scratch();
  const claims = new OutputClaims();

  await claims.write(join(dir, "a.pdf"), "a.md", bytes("a"));
  await assert.rejects(claims.write(join(dir, "a.pdf"), "a.markdown", bytes("x")));
  await claims.write(join(dir, "b.pdf"), "b.md", bytes("b"));
  assert.equal(await fs.readFile(join(dir, "b.pdf"), "utf8"), "b");
});

test("an output that is a symlink to an earlier output is refused", async () => {
  const dir = await scratch();
  const claims = new OutputClaims();

  await fs.symlink("a.pdf", join(dir, "b.pdf"));
  await claims.write(join(dir, "a.pdf"), "a.md", bytes("a"));
  await assert.rejects(claims.write(join(dir, "b.pdf"), "b.md", bytes("b")));
  assert.equal(await fs.readFile(join(dir, "a.pdf"), "utf8"), "a");
});

test("files from before the run are replaced", async () => {
  const dir = await scratch();
  const out = join(dir, "notes.pdf");

  await fs.writeFile(out, "old");
  await new OutputClaims().write(out, "notes.md", bytes("new"));
  assert.equal(await fs.readFile(out, "utf8"), "new");
});
