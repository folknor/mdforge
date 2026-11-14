import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageRefSpan, resolvePageRefs } from "../src/lib/xref.ts";

/** Destinations from element id to page. */
function pages(byId: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(byId));
}

/** The number text each page-reference span shows, in document order. */
function shown(html: string): string[] {
  return [...html.matchAll(/<span[^>]*><a [^>]*><\/a>([^<]*)<\/span>/g)].map((m) => m[1] ?? "");
}

/** Resolve a single page reference and return the text it ended up showing. */
function resolve(slug: string, byId: Record<string, number>) {
  const { html, changed } = resolvePageRefs(pageRefSpan(slug), pages(byId));
  const [text] = shown(html);
  assert.ok(text !== undefined, `no page-reference span left in: ${html}`);

  return { text, changed };
}

describe("pageRefSpan", () => {
  it("carries a hidden link to its target, so the PDF gets a destination for it", () => {
    assert.ok(pageRefSpan("notes-1").includes('<a href="#notes-1" style="display:none"'));
  });
});

describe("resolvePageRefs", () => {
  it("fills in the page of the target's destination", () => {
    assert.deepEqual(resolve("avvik", { avvik: 5 }), { text: "5", changed: true });
  });

  it("leaves the placeholder alone when nothing matches", () => {
    assert.deepEqual(resolve("mangler", { avvik: 5 }), { text: "??", changed: false });
  });

  it("reports no change when the number is already correct", () => {
    const { html, changed } = resolvePageRefs(
      pageRefSpan("avvik").replace(">??<", ">5<"),
      pages({ avvik: 5 }),
    );

    assert.equal(changed, false);
    assert.deepEqual(shown(html), ["5"]);
  });

  it("resolves every reference in the document", () => {
    const { html } = resolvePageRefs(
      `<p>See ${pageRefSpan("alpha")} and ${pageRefSpan("beta")}.</p>`,
      pages({ alpha: 2, beta: 7 }),
    );

    assert.deepEqual(shown(html), ["2", "7"]);
  });

  it("tells headings with repeated titles apart by id", () => {
    // "Notes", "Notes", "Notes-1" get the ids notes, notes-1, notes-1-1.
    const { html, unresolved } = resolvePageRefs(
      `${pageRefSpan("notes")} ${pageRefSpan("notes-1")} ${pageRefSpan("notes-1-1")}`,
      pages({ notes: 1, "notes-1": 2, "notes-1-1": 3 }),
    );

    assert.deepEqual(shown(html), ["1", "2", "3"]);
    assert.deepEqual(unresolved, []);
  });

  it("keeps the hidden target link through repeated passes", () => {
    const first = resolvePageRefs(pageRefSpan("alpha"), pages({ alpha: 2 }));
    const second = resolvePageRefs(first.html, pages({ alpha: 3 }));

    assert.ok(second.html.includes('<a href="#alpha"'));
    assert.deepEqual(shown(second.html), ["3"]);
  });

  it("resets a stale number to the placeholder once its target is gone", () => {
    const result = resolvePageRefs(pageRefSpan("gone").replace(">??<", ">4<"), pages({}));

    assert.deepEqual(result.unresolved, ["gone"]);
    assert.equal(result.changed, true);
    assert.deepEqual(shown(result.html), ["??"]);
  });

  it("lists each unresolved reference once", () => {
    const result = resolvePageRefs(
      `${pageRefSpan("x")} ${pageRefSpan("x")} ${pageRefSpan("alpha")}`,
      pages({ alpha: 1 }),
    );

    assert.deepEqual(result.unresolved, ["x"]);
    assert.equal(result.changed, true);
  });
});
