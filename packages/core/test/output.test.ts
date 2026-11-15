import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { writeOutput } from "../src/lib/prepare.ts";

it("publishes complete HTML and PDF bytes by replacement, preserving mode", async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "mdforge-output-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const path = join(dir, "result");
  await fs.writeFile(path, "old");
  await fs.chmod(path, 0o640);

  const oldHandle = await fs.open(path, "r");
  t.after(() => oldHandle.close());

  await writeOutput({ kind: "file", path }, "<html>new</html>");
  assert.equal(await fs.readFile(path, "utf8"), "<html>new</html>");
  assert.equal(await oldHandle.readFile("utf8"), "old");

  if (process.platform !== "win32") assert.equal((await fs.stat(path)).mode & 0o777, 0o640);
  const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 255]);
  await writeOutput({ kind: "file", path }, pdf);
  assert.deepEqual(await fs.readFile(path), pdf);
  assert.deepEqual(await fs.readdir(dir), ["result"]);
});

it("cleans a partial temp write and keeps the old output", async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "mdforge-output-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const path = join(dir, "result");
  await fs.writeFile(path, "old");
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const file = await open(...args);
    t.mock.method(file, "writeFile", async () => {
      await file.write("partial");
      throw new Error("disk full");
    });

    return file;
  });
  await assert.rejects(writeOutput({ kind: "file", path }, "new"), /disk full/);
  assert.equal(await fs.readFile(path, "utf8"), "old");
  assert.deepEqual(await fs.readdir(dir), ["result"]);
});

it("keeps the destination and removes the temp when rename fails", async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "mdforge-output-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const path = join(dir, "result");
  await fs.writeFile(path, "old");
  t.mock.method(fs, "rename", async (temp: string) => {
    assert.equal(await fs.readFile(temp, "utf8"), "new");
    assert.equal(await fs.readFile(path, "utf8"), "old");
    throw new Error("replacement denied");
  });
  await assert.rejects(writeOutput({ kind: "file", path }, "new"), /replacement denied/);
  assert.equal(await fs.readFile(path, "utf8"), "old");
  assert.deepEqual(await fs.readdir(dir), ["result"]);
});

it("fails without fallback when the directory denies temp creation", async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "mdforge-output-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const path = join(dir, "result");
  await fs.writeFile(path, "old");
  t.mock.method(fs, "open", async () => {
    throw Object.assign(new Error("permission denied"), { code: "EACCES" });
  });
  await assert.rejects(writeOutput({ kind: "file", path }, "new"), /permission denied/);
  assert.equal(await fs.readFile(path, "utf8"), "old");
  assert.deepEqual(await fs.readdir(dir), ["result"]);
});

it("uses unique temp files for concurrent writes to a new destination", async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "mdforge-output-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const path = join(dir, "result");
  const contents = ["a".repeat(100_000), "b".repeat(100_000)];
  await Promise.all(contents.map((content) => writeOutput({ kind: "file", path }, content)));
  assert.ok(contents.includes(await fs.readFile(path, "utf8")));
  assert.deepEqual(await fs.readdir(dir), ["result"]);
});

it("writes through a destination symlink, keeping the link", async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "mdforge-output-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const real = join(dir, "real.html");
  const link = join(dir, "link.html");
  await fs.writeFile(real, "old");

  try {
    await fs.symlink(real, link);
  } catch {
    t.skip("symlinks unavailable");

    return;
  }

  await writeOutput({ kind: "file", path: link }, "new");
  assert.ok((await fs.lstat(link)).isSymbolicLink());
  assert.equal(await fs.readFile(real, "utf8"), "new");
  assert.deepEqual((await fs.readdir(dir)).toSorted(), ["link.html", "real.html"]);
});
