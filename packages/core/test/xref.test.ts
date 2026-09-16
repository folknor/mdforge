import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageRefSpan, resolvePageRefs } from "../dist/lib/xref.js";

/** Resolve a single page reference and return the text it ended up showing. */
function resolve(
  slug: string,
  headings: Record<string, number>,
): { text: string; changed: boolean } {
  const { html, changed } = resolvePageRefs(
    pageRefSpan(slug),
    new Map(Object.entries(headings)),
  );
  const match = /<span[^>]*>([^<]*)<\/span>/.exec(html);
  assert.ok(match, `no page-reference span left in: ${html}`);
  return { text: match[1] as string, changed };
}

describe("resolvePageRefs", () => {
  it("fills in the page of a directly matching heading", () => {
    assert.deepEqual(resolve("avvik", { Avvik: 5 }), {
      text: "5",
      changed: true,
    });
  });

  it("leaves the placeholder alone when nothing matches", () => {
    assert.deepEqual(resolve("mangler", { Avvik: 5 }), {
      text: "??",
      changed: false,
    });
  });

  it("reports no change when the number is already correct", () => {
    const { html, changed } = resolvePageRefs(
      pageRefSpan("avvik").replace(">??<", ">5<"),
      new Map([["Avvik", 5]]),
    );
    assert.equal(changed, false);
    assert.ok(html.includes(">5<"));
  });

  it("resolves every reference in the document", () => {
    const { html } = resolvePageRefs(
      `<p>See ${pageRefSpan("alpha")} and ${pageRefSpan("beta")}.</p>`,
      new Map([
        ["Alpha", 2],
        ["Beta", 7],
      ]),
    );
    assert.ok(html.includes(">2</span> and "));
    assert.ok(html.includes(">7</span>."));
  });

  it("prefers a direct slug match over a numbered fallback", () => {
    assert.equal(resolve("avvik", { Avvik: 5, "8. Avvik": 9 }).text, "5");
  });

  it("prefers a direct slug match regardless of map order", () => {
    assert.equal(resolve("avvik", { "8. Avvik": 9, Avvik: 5 }).text, "5");
  });

  it("resolves a repeated heading to its first occurrence", () => {
    assert.equal(resolve("notes", { Notes: 3, "Notes.": 8 }).text, "3");
  });

  it("resolves an un-numbered slug from a numbered outline title", () => {
    assert.equal(resolve("avvik", { "8. Avvik": 9 }).text, "9");
  });

  it("resolves an un-numbered slug from a multi-level numbered title", () => {
    assert.equal(resolve("detaljer", { "3.1. Detaljer": 12 }).text, "12");
  });

  it("strips a single-letter list label", () => {
    assert.equal(resolve("skjema", { "A) Skjema": 4 }).text, "4");
  });

  it("strips a roman-numeral label", () => {
    assert.equal(resolve("forord", { "iv. Forord": 2 }).text, "2");
  });

  it("does not strip a word that merely looks like a label", () => {
    assert.deepEqual(resolve("viktig", { "NB. Viktig": 3 }), {
      text: "??",
      changed: false,
    });
  });

  it("undoes Chrome's doubled outline title", () => {
    assert.equal(resolve("intro", { "2. Intro2. Intro": 4 }).text, "4");
  });

  it("undoes a doubled and numbered outline title", () => {
    assert.equal(resolve("late", { "3.1. Late3.1. Late": 11 }).text, "11");
  });

  it("resolves a doubled title by its own slug too", () => {
    assert.equal(
      resolve("2-intro2-intro", { "2. Intro2. Intro": 4 }).text,
      "4",
    );
  });

  it("does not undouble a heading that is genuinely repetitive", () => {
    assert.equal(resolve("blahblah", { blahblah: 6 }).text, "6");
    assert.deepEqual(resolve("blah", { blahblah: 6 }), {
      text: "??",
      changed: false,
    });
  });
});
