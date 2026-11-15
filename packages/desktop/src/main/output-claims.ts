import { join, parse } from "node:path";

// A desktop batch writes every PDF into one folder, named after its input, so
// different inputs can land on one file. Each batch writes through one core
// OutputClaims, which refuses a write that would replace a file the batch
// wrote for another input (see packages/core/src/lib/output-claims.ts); the
// batch writes sequentially in list order, so the first input wins.

export { OutputClaims } from "@mdforge/core";

/** The PDF path for an input: its name without extension, in the folder. */
export function outputPathFor(inputPath: string, outputDir: string): string {
  const { name } = parse(inputPath);

  return join(outputDir, `${name || "output"}.pdf`);
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
