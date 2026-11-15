import { promises as fs } from "node:fs";
import { basename } from "node:path";
import { writeOutput } from "./prepare.ts";

// One run (a desktop batch, a CLI invocation including its watch) can send
// several inputs to one output file: a/notes.md and b/notes.md into one
// folder, a.md and a.markdown beside each other, Notes.md and notes.md on a
// case-insensitive volume, or a name that is an existing symlink to another
// output. Comparing names cannot tell which of those alias on the
// destination, so the run compares the files themselves: each write records
// the identity of the file it produced, and a write that would replace a file
// the run wrote for another input is refused.
//
// The protection holds where the filesystem gives files a stable identity
// (device and inode). Where it reports no inode, the key falls back to the
// lowercased, normalised real path, which suits the case-insensitive
// filesystems that do this but is best effort. Other processes changing the
// folder during a run are not defended against: deleting or replacing an
// output releases it, and a reused inode could be mistaken for a claimed
// one. Replacing files from before the run began is the documented silent
// replace of file output.
//
// Which input wins is the caller's order of writes: the first to write a
// file owns it. A caller that converts concurrently must commit in its input
// order to keep that order meaningful.

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

/** The outputs one run has written, by destination file identity. */
export class OutputClaims {
  /** file identity -> the input that wrote it */
  readonly #owners = new Map<string, string>();
  /** input -> the identity of the file it last wrote */
  readonly #written = new Map<string, string>();
  #queue: Promise<unknown> = Promise.resolve();

  /**
   * Write `content` to `destination` for `inputPath`, unless that would
   * replace a file this run already wrote for another input. Calls are
   * serialised, so concurrent callers cannot both pass the check.
   */
  write(destination: string, inputPath: string, content: Uint8Array | string): Promise<void> {
    const next = this.#queue.then(() => this.#write(destination, inputPath, content));

    this.#queue = next.catch(() => undefined);

    return next;
  }

  async #write(
    destination: string,
    inputPath: string,
    content: Uint8Array | string,
  ): Promise<void> {
    const existing = await identityOf(destination);
    const owner = existing === undefined ? undefined : this.#owners.get(existing);

    if (owner !== undefined && owner !== inputPath) {
      throw new Error(
        `${basename(destination)} was already written by ${owner} in this run; ` +
          "rename one of the files or convert them separately",
      );
    }

    await writeOutput({ kind: "file", path: destination }, content);

    const written = await identityOf(destination);

    // A replacement gets a new inode; the old one is free for reuse, so it
    // must stop counting as this input's. Only after the write succeeded: a
    // failed write leaves the previous output, still claimed.
    const previous = this.#written.get(inputPath);

    if (previous !== undefined && this.#owners.get(previous) === inputPath) {
      this.#owners.delete(previous);
    }

    this.#written.delete(inputPath);

    if (written !== undefined) {
      this.#owners.set(written, inputPath);
      this.#written.set(inputPath, written);
    }
  }
}
