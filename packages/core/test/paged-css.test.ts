import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasBackground, hasContent } from "../dist/lib/paged-css.js";

describe("header/footer activity", () => {
  it("counts only non-empty columns and backgrounds as content", () => {
    assert.equal(hasContent(undefined), false);
    assert.equal(hasContent({}), false);
    assert.equal(hasContent({ center: "" }), false);
    assert.equal(hasContent({ firstPage: false }), false);
    assert.equal(hasContent({ right: "{page}" }), true);
    assert.equal(hasContent({ background: "bg.png" }), true);
  });

  it("ignores an empty background when choosing the renderer", () => {
    assert.equal(hasBackground({ header: { background: "" }, footer: { center: "x" } }), false);
    assert.equal(hasBackground({ footer: { background: "bg.png" } }), true);
  });
});
