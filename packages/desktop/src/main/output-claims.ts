import { promises as fs } from "node:fs";
import { basename, join, parse } from "node:path";
import { writeOutput } from "@mdforge/core";

// A desktop batch writes every PDF into one folder, named after its input.
// Different inputs can land on one file: a/notes.md and b/notes.md,
// a.md and a.markdown, Notes.md and notes.md on a case-insensitive volume,
// or a name that is an existing symlink to another output. Comparing names
// cannot tell which of those alias on the destination, so a batch compares
// the files themselves: each write records the identity of the file it
// produced, and a later write in the same batch that would replace one of
// them is refused. The first input wins; the later one is reported failed.
//
// The protection holds where the filesystem gives files a stable identity
// (device and inode). Where it reports no inode, the key falls back to the
// lowercased, normalised real path, which suits the case-insensitive
// filesystems that do this but is best effort. Other processes changing the
// folder during a batch are not defended against. Replacing files from
// before the batch began is the documented silent replace of file output.

/** The PDF path for an input: its name without extension, in the folder. */
export function outputPathFor(inputPath: string, outputDir: string): string {
  const { name } = parse(inputPath);

  return join(outputDir, `${name || "output"}.pdf`);
}

async function identityOf(path: string): Promise<string | undefined> {
  let stats;

  try {
    stats = await fs.stat(path, { bigint: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;

    throw error;
  }

  if (stats.ino !== 0n) return `${stats.dev}:${stats.ino}`;

  return `path:${(await fs.realpath(path)).normalize("NFC").toLowerCase()}`;
}

/** The outputs one batch has written, by destination file identity. */
export class OutputClaims {
  readonly #owners = new Map<string, string>();

  /**
   * Write `content` to `destination` for `inputPath`, unless that would
   * replace a file this batch already wrote for another input.
   */
  async write(destination: string, inputPath: string, content: Uint8Array): Promise<void> {
    const existing = await identityOf(destination);
    const owner = existing === undefined ? undefined : this.#owners.get(existing);

    if (owner !== undefined && owner !== inputPath) {
      throw new Error(
        `${basename(destination)} was already written by ${owner} in this batch; ` +
          "rename one of the files or convert them separately",
      );
    }

    await writeOutput({ kind: "file", path: destination }, content);

    const written = await identityOf(destination);

    if (written !== undefined) this.#owners.set(written, inputPath);
  }
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Run batches one at a time, so a batch's claims cover every write made
 * while it runs (a batch survives a renderer reload, and the reloaded page
 * can start another). A failed batch does not stop the next.
 */
export function oneAtATime<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run);

  queue = next.catch(() => undefined);

  return next;
}
