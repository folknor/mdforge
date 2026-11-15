import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig } from "../src/lib/config.ts";
import {
  type LayoutReader,
  type PrintablePage,
  printResolvingPageRefs,
} from "../src/lib/page-refs.ts";
import { prepareConversion } from "../src/lib/prepare.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function prepare(content: string) {
  return prepareConversion({ content }, structuredClone(defaultConfig), {
    format: "pdf",
    output: { kind: "none" },
  });
}

/** Number text after the hidden link in each page-reference span. */
const SPAN = /(data-mdforge-pageref="([^"]*)"><a [^>]*><\/a>)([^<]*)</g;

/**
 * A page that is the prepared HTML and whose "PDF" is that page's current
 * HTML, recording every print.
 */
function fakePage(source: string) {
  const rendered: string[] = [];
  let html = source;

  const page: PrintablePage = {
    print: async () => {
      rendered.push(html);

      return encoder.encode(html);
    },
    readPageRefs: async () =>
      [...html.matchAll(SPAN)].map((m) => ({ slug: m[2] ?? "", text: m[3] ?? "" })),
    writePageRefs: async (texts) => {
      html = html.replace(SPAN, (match, opening: string, slug: string) => {
        const text = texts.get(slug);

        return text === undefined ? match : `${opening}${text}<`;
      });
    },
  };

  return { page, rendered };
}

/** Page each rendered number shows for the heading, by render. */
function shownPage(html: string): string | undefined {
  return /data-mdforge-pageref="[^"]*"><a [^>]*><\/a>([^<]*)</.exec(html)?.[1];
}

/**
 * A destination reader answering from a fixed page for `alpha` per render (none
 * when undefined), the last repeating.
 */
function scriptedDestinations(pages: (number | undefined)[]) {
  let call = 0;

  const read: LayoutReader = async () => {
    const page = pages[Math.min(call, pages.length - 1)];
    call++;

    return { pageCount: 5, destinations: new Map(page === undefined ? [] : [["alpha", page]]) };
  };

  return { read, calls: () => call };
}

describe("printResolvingPageRefs", () => {
  it("prints once with no layout read when there are no page references", async () => {
    const prepared = await prepare("# Alpha\n\nNo references.\n");
    const { page, rendered } = fakePage(prepared.html);
    const dests = scriptedDestinations([1]);

    const result = await printResolvingPageRefs(prepared, page, dests.read);

    assert.equal(rendered.length, 1);
    assert.equal(dests.calls(), 0);
    assert.equal(result.layout, undefined);
  });

  it("re-prints with the number and checks that print too", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n");
    const original = prepared.html;
    const { page, rendered } = fakePage(prepared.html);
    const dests = scriptedDestinations([3]);

    const result = await printResolvingPageRefs(prepared, page, dests.read);

    assert.equal(rendered.length, 2);
    assert.equal(dests.calls(), 2);
    assert.equal(shownPage(decoder.decode(result.pdf)), "3");
    assert.equal(result.layout?.destinations.get("alpha"), 3, "returns the last print's layout");
    assert.equal(prepared.html, original, "the caller's html is not reassigned");
    assert.deepEqual(prepared.info.warnings, []);
  });

  it("returns the last print with a warning when numbers never settle", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n");
    const { page, rendered } = fakePage(prepared.html);
    const dests = scriptedDestinations([1, 2, 3]);

    const result = await printResolvingPageRefs(prepared, page, dests.read);

    assert.equal(rendered.length, 3);
    assert.equal(dests.calls(), 3);
    assert.equal(shownPage(decoder.decode(result.pdf)), "2");
    assert.equal(prepared.info.warnings.length, 1);
    assert.match(prepared.info.warnings[0] ?? "", /did not settle/);
  });

  it("warns about references the final destinations cannot answer", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n");
    const { page, rendered } = fakePage(prepared.html);
    const dests = scriptedDestinations([undefined]);

    const result = await printResolvingPageRefs(prepared, page, dests.read);

    assert.equal(rendered.length, 1);
    assert.equal(shownPage(decoder.decode(result.pdf)), "??");
    assert.deepEqual(prepared.info.warnings, ["Could not resolve page references for: alpha."]);
  });

  it("drops a number whose heading lost its destination, and warns only about the final pass", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n");
    const { page, rendered } = fakePage(prepared.html);
    const dests = scriptedDestinations([4, undefined]);

    const result = await printResolvingPageRefs(prepared, page, dests.read);

    assert.equal(rendered.length, 3);
    assert.equal(shownPage(decoder.decode(result.pdf)), "??");
    assert.deepEqual(prepared.info.warnings, ["Could not resolve page references for: alpha."]);
  });

  it("passes a print failure through", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n");
    const { page } = fakePage(prepared.html);

    const failing: PrintablePage = {
      ...page,
      print: async () => {
        throw new Error("print failed");
      },
    };

    await assert.rejects(
      printResolvingPageRefs(prepared, failing, scriptedDestinations([1]).read),
      /print failed/,
    );
  });
});
