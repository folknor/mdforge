import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pageRefSpan, resolvePageRefs, type ShownPageRef } from "../src/lib/xref.ts";

/** Destinations from element id to page. */
function pages(byId: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(byId));
}

/** References as a page shows them, each `slug` or `slug=text` (default `??`). */
function shown(...refs: string[]): ShownPageRef[] {
  return refs.map((ref) => {
    const [slug = "", text = "??"] = ref.split("=");

    return { slug, text };
  });
}

describe("pageRefSpan", () => {
  it("carries a hidden link to its target, so the PDF gets a destination for it", () => {
    assert.ok(pageRefSpan("notes-1").includes('<a href="#notes-1" style="display:none"'));
  });

  it("starts with the placeholder after the link", () => {
    assert.ok(pageRefSpan("alpha").endsWith("</a>??</span>"));
  });
});

describe("resolvePageRefs", () => {
  it("fills in the page of the target's destination", () => {
    const result = resolvePageRefs(shown("avvik"), pages({ avvik: 5 }));

    assert.deepEqual([...result.texts], [["avvik", "5"]]);
    assert.equal(result.changed, true);
  });

  it("leaves the placeholder alone when nothing matches", () => {
    const result = resolvePageRefs(shown("mangler"), pages({ avvik: 5 }));

    assert.deepEqual([...result.texts], [["mangler", "??"]]);
    assert.equal(result.changed, false);
  });

  it("reports no change when the page already shows the right number", () => {
    const result = resolvePageRefs(shown("avvik=5"), pages({ avvik: 5 }));

    assert.equal(result.changed, false);
  });

  it("reports a change when any reference to a slug shows something else", () => {
    const result = resolvePageRefs(shown("avvik=5", "avvik=4"), pages({ avvik: 5 }));

    assert.equal(result.changed, true);
    assert.deepEqual([...result.texts], [["avvik", "5"]]);
  });

  it("tells headings with repeated titles apart by id", () => {
    // "Notes", "Notes", "Notes-1" get the ids notes, notes-1, notes-1-1.
    const result = resolvePageRefs(
      shown("notes", "notes-1", "notes-1-1"),
      pages({ notes: 1, "notes-1": 2, "notes-1-1": 3 }),
    );

    assert.deepEqual(
      [...result.texts],
      [
        ["notes", "1"],
        ["notes-1", "2"],
        ["notes-1-1", "3"],
      ],
    );
    assert.deepEqual(result.unresolved, []);
  });

  it("resets a stale number to the placeholder once its target is gone", () => {
    const result = resolvePageRefs(shown("gone=4"), pages({}));

    assert.deepEqual(result.unresolved, ["gone"]);
    assert.equal(result.changed, true);
    assert.deepEqual([...result.texts], [["gone", "??"]]);
  });

  it("lists each unresolved reference once", () => {
    const result = resolvePageRefs(shown("x", "x", "alpha"), pages({ alpha: 1 }));

    assert.deepEqual(result.unresolved, ["x"]);
    assert.equal(result.changed, true);
  });
});
