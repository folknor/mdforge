import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPuppeteerTemplate,
  cssString,
  generatePagedCss,
  hasBackground,
  hasContent,
} from "../src/lib/paged-css.ts";

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

describe("buildPuppeteerTemplate", () => {
  it("shows column text and the title as written", async () => {
    const html = await buildPuppeteerTemplate(
      { left: "a < b & <b>x</b> {url}", right: "{title}: {page}/{pages} {page:x}" },
      "header",
      process.cwd(),
      "T <i>&</i> {page}",
    );

    assert.match(html, /hf-left">a &lt; b &amp; &lt;b&gt;x&lt;\/b&gt; \{url\}<\/span>/);
    assert.match(
      html,
      /hf-right">T &lt;i&gt;&amp;&lt;\/i&gt; \{page\}: <span class="pageNumber"><\/span>\/<span class="totalPages"><\/span> \{page:x\}<\/span>/,
    );
  });

  it("treats emphasis as the margin boxes do", async () => {
    const html = await buildPuppeteerTemplate(
      { left: "**<all>**", right: "some **mixed** text" },
      "footer",
      process.cwd(),
      "",
    );

    assert.match(html, /hf-left"><span style="font-weight: bold">&lt;all&gt;<\/span><\/span>/);
    assert.match(html, /hf-right">some mixed text<\/span>/);
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

function decodeSvg(output: string): string {
  return Buffer.from(output.match(/base64,([A-Za-z0-9+/=]+)/)?.[1] ?? "", "base64").toString();
}

describe("scaled SVG columns", () => {
  it("shares proportional SVG sizing between margin boxes and templates", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "mdforge-svg-"));

    try {
      const cases = [
        { attrs: 'width="1920mm" height="120mm" viewBox="0 0 1920 120"', height: 2.25 },
        { attrs: "viewBox='0,0,200,100'", height: 18 },
        { attrs: "width = '2in' height = '72pt'", height: 18 },
        { attrs: 'width="200" height="100"', height: 18 },
        { attrs: 'width="100%" height="100%" viewBox="0 0 200 100"', height: 18 },
        { attrs: 'width="100%" height="100%"', height: undefined },
        { attrs: 'width="20em" height="10em"', height: undefined },
      ];

      for (const { attrs, height } of cases) {
        await fs.writeFile(
          join(dir, "logo.svg"),
          `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="20" height="10"/></svg>`,
        );
        const unscaled = await generatePagedCss({ footer: { right: "logo.svg" } }, dir);

        assert.match(decodeSvg(unscaled), /<rect width="20" height="10"/);
        assert.ok(decodeSvg(unscaled).includes(attrs));

        const column = { left: "logo.svg 60% Following text" };
        const css = await generatePagedCss({ header: column }, dir);
        const html = await buildPuppeteerTemplate(column, "header", dir, "");

        const svg = decodeSvg(css);
        assert.equal(decodeSvg(html), svg);
        const root = svg.match(/<svg[^>]*>/)?.[0] ?? "";
        assert.match(root, /width="36"/);

        if (height === undefined) assert.doesNotMatch(root, /height=/);
        else assert.match(root, new RegExp(`height="${height}"`));
        assert.match(svg, /<rect width="20" height="10"/);

        if (attrs.includes("2in") || attrs === 'width="200" height="100"')
          assert.match(root, /viewBox="0 0 /);
        assert.match(css, /Following text/);
        assert.match(html, /Following text/);
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps preserveAspectRatio and leaves nested svg elements alone", async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), "mdforge-svg-"));

    try {
      const nested =
        '<svg width="5" height="7" viewBox="0 0 5 7"><rect width="1" height="2"/></svg>';

      await fs.writeFile(
        join(dir, "logo.svg"),
        `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMinYMid slice" width="200" height="100">${nested}</svg>`,
      );
      const svg = decodeSvg(await generatePagedCss({ header: { left: "logo.svg 60%" } }, dir));

      assert.match(svg, /preserveAspectRatio="xMinYMid slice"/);
      assert.ok(svg.includes(nested));
      assert.match(svg.match(/<svg[^>]*>/)?.[0] ?? "", /width="36"/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
