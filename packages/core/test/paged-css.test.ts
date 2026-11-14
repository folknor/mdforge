import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generatePagedCss, hasBackground, hasContent } from "../src/lib/paged-css.ts";

describe("generatePagedCss", () => {
  it("gives every margin box the common styles, emphasised ones included", async () => {
    const css = await generatePagedCss(
      { header: { left: "**Bold**", right: "Plain" } },
      process.cwd(),
    );

    const boxes = css.match(/@top-(left|right) \{[^}]*\}/g) ?? [];

    assert.equal(boxes.length, 2);

    for (const box of boxes) {
      assert.match(box, /font-family:/);
      assert.match(box, /color:/);
    }

    assert.match(boxes[0] ?? "", /font-weight: bold/);
  });
});

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
