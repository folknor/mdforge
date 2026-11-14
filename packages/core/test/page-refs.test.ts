import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig } from "../src/lib/config.ts";
import { type OutlineReader, renderResolvingPageRefs } from "../src/lib/page-refs.ts";
import { type PreparedConversion, prepareConversion } from "../src/lib/prepare.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function prepare(content: string, format: "pdf" | "html" = "pdf") {
  return prepareConversion({ content }, structuredClone(defaultConfig), {
    format,
    output: { kind: "none" },
  });
}

/** A renderer whose "PDF" is the HTML it was given, recording every call. */
function fakeRenderer() {
  const rendered: string[] = [];

  const render = async (prepared: PreparedConversion) => {
    rendered.push(prepared.html);

    return { content: encoder.encode(prepared.html), extra: rendered.length };
  };

  return { render, rendered };
}

/** Page each rendered number shows for the heading, by render. */
function shownPage(html: string): string | undefined {
  return /data-mdforge-pageref="[^"]*">([^<]*)</.exec(html)?.[1];
}

/** An outline reader answering from a fixed list per render, the last repeating. */
function scriptedOutline(pages: number[][]) {
  let call = 0;

  const read: OutlineReader = async () => {
    const pagesNow = pages[Math.min(call, pages.length - 1)] ?? [];
    call++;

    return pagesNow.map((page) => ({ title: "Alpha", page }));
  };

  return { read, calls: () => call };
}

describe("renderResolvingPageRefs", () => {
  it("renders once with no outline read when there are no page references", async () => {
    const prepared = await prepare("# Alpha\n\nNo references.\n");
    const { render, rendered } = fakeRenderer();
    const outline = scriptedOutline([[1]]);

    await renderResolvingPageRefs(prepared, render, outline.read);

    assert.equal(rendered.length, 1);
    assert.equal(outline.calls(), 0);
  });

  it("renders HTML once with no outline read", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n", "html");
    const { render, rendered } = fakeRenderer();
    const outline = scriptedOutline([[1]]);

    await renderResolvingPageRefs(prepared, render, outline.read);

    assert.equal(rendered.length, 1);
    assert.equal(outline.calls(), 0);
  });

  it("re-renders with the number and checks that render too", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n");
    const original = prepared.html;
    const { render, rendered } = fakeRenderer();
    const outline = scriptedOutline([[3]]);

    const result = await renderResolvingPageRefs(prepared, render, outline.read);

    assert.equal(rendered.length, 2);
    assert.equal(outline.calls(), 2);
    assert.equal(shownPage(decoder.decode(result.content)), "3");
    assert.equal(result.extra, 2, "returns the complete last render result");
    assert.equal(prepared.html, original, "the caller's html is not reassigned");
    assert.deepEqual(prepared.info.warnings, []);
  });

  it("returns the last render with a warning when numbers never settle", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n");
    const { render, rendered } = fakeRenderer();
    const outline = scriptedOutline([[1], [2], [3]]);

    const result = await renderResolvingPageRefs(prepared, render, outline.read);

    assert.equal(rendered.length, 3);
    assert.equal(outline.calls(), 3);
    assert.equal(shownPage(decoder.decode(result.content)), "2");
    assert.equal(prepared.info.warnings.length, 1);
    assert.match(prepared.info.warnings[0] ?? "", /did not settle/);
  });

  it("warns about references the final outline cannot answer", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n");
    const { render, rendered } = fakeRenderer();
    const outline = scriptedOutline([[]]);

    const result = await renderResolvingPageRefs(prepared, render, outline.read);

    assert.equal(rendered.length, 1);
    assert.equal(shownPage(decoder.decode(result.content)), "??");
    assert.deepEqual(prepared.info.warnings, ["Could not resolve page references for: alpha."]);
  });

  it("drops a number whose heading left the outline, and warns only about the final pass", async () => {
    const prepared = await prepare("# Alpha\n\nSee @pageof(Alpha).\n");
    const { render, rendered } = fakeRenderer();
    const outline = scriptedOutline([[4], []]);

    const result = await renderResolvingPageRefs(prepared, render, outline.read);

    assert.equal(rendered.length, 3);
    assert.equal(shownPage(decoder.decode(result.content)), "??");
    assert.deepEqual(prepared.info.warnings, ["Could not resolve page references for: alpha."]);
  });
});
