/**
 * The render passes that resolve page references, shared by every renderer.
 *
 * A page reference (`@pageof(...)` or a TOC page number) can only be filled in
 * once the document has been laid out, so the PDF is rendered, its named
 * destinations read back for the page each referenced element landed on, and
 * rendered again with the numbers in place, until they settle.
 */

import type { PreparedConversion } from "./prepare.ts";
import { hasPageRefs, resolvePageRefs } from "./xref.ts";

/**
 * Reads a PDF's named destinations: element id to 1-based page. Renderers pass
 * `readDestinations` from `@mdforge/pdf`; it is a parameter so core carries no
 * runtime dependency on the PDF library.
 */
export type DestinationReader = (pdf: Uint8Array) => Promise<ReadonlyMap<string, number>>;

/**
 * The most renders spent on one document while page references settle.
 *
 * Filling in a number can change line breaking and therefore pagination, which
 * can change the number. In practice one extra pass is enough; the cap stops a
 * pathological document from looping.
 */
const MAX_RENDERS = 3;

/**
 * Render a prepared conversion, re-rendering until its page references match
 * the pages their targets landed on.
 *
 * HTML output, or a document without page references, is rendered exactly
 * once. Otherwise every render's destinations are read back, including the last, so
 * the result is a render whose numbers were checked against its own layout.
 *
 * This is best effort. If the numbers are still changing after the last
 * allowed render, that render is returned anyway, with a warning that its page
 * numbers may be wrong. References no destination answered for in the returned
 * render are named in a warning; in a settled render they print `??`.
 * Warnings are added to `prepared.info`, so call this once per prepared
 * conversion.
 *
 * @param prepared - The prepared conversion; its `html` is never reassigned
 * @param render - Renders the conversion it is given, freshly, every call
 * @param readDestinations - Reads the rendered PDF's named destinations
 * @returns The last complete render result
 */
export async function renderResolvingPageRefs<R extends { content: Buffer | Uint8Array | string }>(
  prepared: PreparedConversion,
  render: (prepared: PreparedConversion) => Promise<R>,
  readDestinations: DestinationReader,
): Promise<R> {
  let output = await render(prepared);

  if (prepared.format !== "pdf" || !hasPageRefs(prepared.html)) {
    return output;
  }

  // The HTML the latest render was given
  let { html } = prepared;

  for (let renders = 1; ; renders++) {
    // Buffer extends Uint8Array, so this only rejects HTML output, which the
    // format check above already rules out.
    if (!(output.content instanceof Uint8Array)) {
      throw new Error("Expected PDF output while resolving page references");
    }

    const resolved = resolvePageRefs(html, await readDestinations(output.content));

    // The numbers in this render already match its own layout.
    const settled = !resolved.changed;

    if (settled || renders === MAX_RENDERS) {
      if (!settled) {
        prepared.info.warnings.push(
          `Page references did not settle after ${MAX_RENDERS} renders; some page numbers may be wrong.`,
        );
      }

      if (resolved.unresolved.length > 0) {
        prepared.info.warnings.push(
          `Could not resolve page references for: ${resolved.unresolved.join(", ")}.`,
        );
      }

      return output;
    }

    ({ html } = resolved);
    // A copy sharing `info`, so the caller's html is never reassigned
    output = await render({ ...prepared, html });
  }
}
