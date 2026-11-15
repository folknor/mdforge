import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cssString, generatePagedCss, hasBackground, hasContent } from "../src/lib/paged-css.ts";

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

  it("builds content from strings, counters and the title variable", async () => {
    const css = await generatePagedCss(
      { footer: { center: "Page {page} of {pages}", left: "{title}" } },
      process.cwd(),
    );

    assert.match(css, /content: "Page " counter\(page\) " of " counter\(pages\);/);
    assert.match(css, /content: var\(--doc-title\);/);
  });

  it("keeps any header text and title inside its CSS string", async () => {
    const css = await generatePagedCss(
      {
        header: { left: 'Say "hi" \\ </style><p>\nnext' },
        title: "A </style> title",
      },
      process.cwd(),
    );

    assert.doesNotMatch(css, /<\/style/i);
    assert.match(css, /content: "Say \\"hi\\" \\\\ \\3c \/style>\\3c p>\\a next";/);
    assert.match(css, /--doc-title: "A \\3c \/style> title";/);
  });
});

describe("cssString", () => {
  it("serialises as CSSOM does, with < escaped", () => {
    assert.equal(cssString(`a"\\<\u0000\u007f\tb`), `"a\\"\\\\\\3c \uFFFD\\7f \\9 b"`);
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
