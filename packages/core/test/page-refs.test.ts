import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig } from "../src/lib/config.ts";
import {
  type DestinationReader,
  type LoadedPage,
  renderResolvingPageRefs,
} from "../src/lib/page-refs.ts";
import { type PreparedConversion, prepareConversion } from "../src/lib/prepare.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function prepare(content: string, format: "pdf" | "html" = "pdf") {
  return prepareConversion({ content }, structuredClone(defaultConfig), {
    format,
    output: { kind: "none" },
  });
}

/** Number text after the hidden link in each page-reference span. */
const SPAN = /(data-mdforge-pageref="([^"]*)"><a [^>]*><\/a>)([^<]*)</g;

/**
 * A renderer whose page is the prepared HTML and whose "PDF" is that page's
 * current HTML, recording every load and print.
 */
function fakeRenderer() {
  const rendered: string[] = [];
  let opened = 0;
  let closed = 0;

  const open = async (prepared: PreparedConversion) => {
    opened++;
    let html = prepared.html;

    const page: LoadedPage<{ content: Uint8Array; extra: number }> = {
      print: async () => {
        rendered.push(html);

        return { content: encoder.encode(html), extra: rendered.length };
      },
      readPageRefs: async () =>
        [...html.matchAll(SPAN)].map((m) => ({ slug: m[2] ?? "", text: m[3] ?? "" })),
      writePageRefs: async (texts) => {
        html = html.replace(SPAN, (match, opening: string, slug: string) => {
          const text = texts.get(slug);

          return text === undefined ? match : `${opening}${text}<`;
        });
      },
      close: async () => {
        closed++;
      },
    };

    return page;
  };

  return { open, rendered, opened: () => opened, closed: () => closed };
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

  const read: DestinationReader = async () => {
    const page = pages[Math.min(call, pages.length - 1)];
    call++;

    return new Map(page === undefined ? [] : [["alpha", page]]);
  };

  return { read, calls: () => call };
}

describe("renderResolvingPageRefs", () => {
  it("renders once with no destinations read when there are no page references", async () => {
    const prepared = await prepare("# Alpha\n\nNo references.\n");
    const { open, rendered } = fakeRenderer();
    const dests = scriptedDestinations([1]);

    await renderResolvingPageRefs(prepared, open, dests.read);

    assert.equal(rendered.length, 1);
    assert.equal(dests.calls(), 0);
  });

  it("renders HTML once with no destinations read", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n", "html");
    const { open, rendered } = fakeRenderer();
    const dests = scriptedDestinations([1]);

    await renderResolvingPageRefs(prepared, open, dests.read);

    assert.equal(rendered.length, 1);
    assert.equal(dests.calls(), 0);
  });

  it("re-renders with the number and checks that render too", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n");
    const original = prepared.html;
    const fake = fakeRenderer();
    const { rendered } = fake;
    const dests = scriptedDestinations([3]);

    const result = await renderResolvingPageRefs(prepared, fake.open, dests.read);

    assert.equal(fake.opened(), 1, "every pass prints the one loaded page");
    assert.equal(fake.closed(), 1);
    assert.equal(rendered.length, 2);
    assert.equal(dests.calls(), 2);
    assert.equal(shownPage(decoder.decode(result.content)), "3");
    assert.equal(result.extra, 2, "returns the complete last render result");
    assert.equal(prepared.html, original, "the caller's html is not reassigned");
    assert.deepEqual(prepared.info.warnings, []);
  });

  it("returns the last render with a warning when numbers never settle", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n");
    const { open, rendered } = fakeRenderer();
    const dests = scriptedDestinations([1, 2, 3]);

    const result = await renderResolvingPageRefs(prepared, open, dests.read);

    assert.equal(rendered.length, 3);
    assert.equal(dests.calls(), 3);
    assert.equal(shownPage(decoder.decode(result.content)), "2");
    assert.equal(prepared.info.warnings.length, 1);
    assert.match(prepared.info.warnings[0] ?? "", /did not settle/);
  });

  it("warns about references the final destinations cannot answer", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n");
    const { open, rendered } = fakeRenderer();
    const dests = scriptedDestinations([undefined]);

    const result = await renderResolvingPageRefs(prepared, open, dests.read);

    assert.equal(rendered.length, 1);
    assert.equal(shownPage(decoder.decode(result.content)), "??");
    assert.deepEqual(prepared.info.warnings, ["Could not resolve page references for: alpha."]);
  });

  it("drops a number whose heading lost its destination, and warns only about the final pass", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n");
    const { open, rendered } = fakeRenderer();
    const dests = scriptedDestinations([4, undefined]);

    const result = await renderResolvingPageRefs(prepared, open, dests.read);

    assert.equal(rendered.length, 3);
    assert.equal(shownPage(decoder.decode(result.content)), "??");
    assert.deepEqual(prepared.info.warnings, ["Could not resolve page references for: alpha."]);
  });

  it("closes the page when printing fails", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n");
    const fake = fakeRenderer();

    const failing = async (conversion: PreparedConversion) => {
      const page = await fake.open(conversion);

      return {
        ...page,
        print: async () => {
          throw new Error("print failed");
        },
      };
    };

    await assert.rejects(
      renderResolvingPageRefs(prepared, failing, scriptedDestinations([1]).read),
      /print failed/,
    );
    assert.equal(fake.closed(), 1);
  });
});
