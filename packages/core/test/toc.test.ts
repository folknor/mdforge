import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HeadingNumbersConfig } from "../dist/lib/heading-numbers.js";
import { insertToc, type TOCOptions } from "../dist/lib/toc.js";

/** Everything between the two TOC markers, without the markers themselves. */
function tocBody(
  markdown: string,
  options: TOCOptions = {},
  headingNumbers?: HeadingNumbersConfig | false,
): string {
  const result = insertToc(markdown, options, headingNumbers);
  const start = result.indexOf("<!-- toc -->");
  const stop = result.indexOf("<!-- tocstop -->");
  assert.notEqual(start, -1, "no <!-- toc --> marker in output");
  assert.notEqual(stop, -1, "no <!-- tocstop --> marker in output");
  return result.slice(start + "<!-- toc -->".length, stop).trim();
}

const DOC = [
  "# Title",
  "",
  "<!-- toc -->",
  "",
  "## Alpha",
  "",
  "### Beta",
  "",
  "## Gamma",
  "",
].join("\n");

describe("insertToc", () => {
  it("returns the input unchanged when there is no marker", () => {
    const markdown = "# Title\n\n## Alpha\n";
    assert.equal(insertToc(markdown), markdown);
  });

  it("inserts a TOC and a stop marker for the single-marker form", () => {
    const result = insertToc(DOC);
    assert.match(result, /<!-- toc -->/);
    assert.match(result, /<!-- tocstop -->/);
    // The document content survives on both sides of the TOC.
    assert.ok(result.startsWith("# Title"));
    assert.ok(result.includes("## Alpha"));
  });

  it("regenerates over an existing TOC for the three-marker form", () => {
    const withStale = [
      "# Title",
      "",
      "<!-- toc -->",
      "",
      "- [Stale entry](#stale-entry)",
      "",
      "<!-- tocstop -->",
      "",
      "## Alpha",
      "",
    ].join("\n");
    const result = insertToc(withStale);
    assert.ok(!result.includes("Stale entry"));
    assert.ok(result.includes("- [Alpha](#alpha)"));
    // Still exactly one TOC block.
    assert.equal(result.match(/<!-- toc -->/g)?.length, 1);
    assert.equal(result.match(/<!-- tocstop -->/g)?.length, 1);
  });

  it("rejects documents with more than one TOC", () => {
    const twoTocs =
      "<!-- toc -->\n\n<!-- tocstop -->\n\n<!-- toc -->\n\n<!-- tocstop -->\n";
    assert.throws(
      () => insertToc(twoTocs),
      /only supports one Table of Contents/,
    );
  });

  it("preserves trailing newlines", () => {
    const result = insertToc("<!-- toc -->\n\n## Alpha\n\n\n");
    assert.ok(result.endsWith("\n\n\n"));
  });
});

describe("TOC styles", () => {
  it("renders a bullet list indented by heading depth", () => {
    assert.equal(
      tocBody(DOC),
      ["- [Alpha](#alpha)", "  - [Beta](#beta)", "- [Gamma](#gamma)"].join(
        "\n",
      ),
    );
  });

  it("indents relative to the shallowest heading in the TOC", () => {
    const markdown = "<!-- toc -->\n\n### Deep\n\n#### Deeper\n";
    assert.equal(
      tocBody(markdown),
      ["- [Deep](#deep)", "  - [Deeper](#deeper)"].join("\n"),
    );
  });

  it("renders an ordered list", () => {
    assert.equal(
      tocBody(DOC, { style: "ordered" }),
      ["1. [Alpha](#alpha)", "  1. [Beta](#beta)", "1. [Gamma](#gamma)"].join(
        "\n",
      ),
    );
  });

  it("renders a headerless two-column table by default", () => {
    assert.equal(
      tocBody(DOC, { style: "table" }),
      [
        "|  |  |",
        "| --- | --- |",
        "| [Alpha](#alpha) |  |",
        "| &nbsp;&nbsp;[Beta](#beta) |  |",
        "| [Gamma](#gamma) |  |",
      ].join("\n"),
    );
  });

  it("uses configured table headers", () => {
    const body = tocBody(DOC, {
      style: "table",
      table_headers: ["Innhold", "Side"],
    });
    assert.ok(body.startsWith("| Innhold | Side |\n| --- | --- |\n"));
  });
});

describe("TOC filtering", () => {
  it("drops headings deeper than maxdepth", () => {
    const body = tocBody(DOC, { maxdepth: 2 });
    assert.equal(body, ["- [Alpha](#alpha)", "- [Gamma](#gamma)"].join("\n"));
  });

  it("drops the leading h1 when skip_first_h1 is set", () => {
    const markdown = [
      "<!-- toc -->",
      "",
      "# Title",
      "",
      "## Alpha",
      "",
      "## Gamma",
      "",
    ].join("\n");
    assert.equal(
      tocBody(markdown, { skip_first_h1: true }),
      ["- [Alpha](#alpha)", "- [Gamma](#gamma)"].join("\n"),
    );
  });

  it("keeps the leading h1 by default", () => {
    const markdown = "<!-- toc -->\n\n# Title\n\n## Alpha\n";
    assert.equal(
      tocBody(markdown),
      ["- [Title](#title)", "  - [Alpha](#alpha)"].join("\n"),
    );
  });
});

describe("TOC page numbers", () => {
  const pageRef = (slug: string): string =>
    `<span class="mdforge-pageref" data-mdforge-pageref="${slug}">??</span>`;

  it("appends a page reference span pointing at the heading slug", () => {
    const body = tocBody(DOC, { page_numbers: true, maxdepth: 2 });
    assert.equal(
      body,
      [
        `- [Alpha](#alpha) — ${pageRef("alpha")}`,
        `- [Gamma](#gamma) — ${pageRef("gamma")}`,
      ].join("\n"),
    );
  });

  it("uses page_label and page_separator", () => {
    const body = tocBody(DOC, {
      page_numbers: true,
      maxdepth: 2,
      page_label: "Side ",
      page_separator: " ... ",
    });
    assert.ok(body.includes(`- [Alpha](#alpha) ... Side ${pageRef("alpha")}`));
  });

  it("puts the page reference in the second table column", () => {
    const body = tocBody(DOC, {
      style: "table",
      page_numbers: true,
      maxdepth: 2,
    });
    assert.ok(body.includes(`| [Alpha](#alpha) | ${pageRef("alpha")} |`));
  });

  it("emits no page reference when page_numbers is off", () => {
    assert.ok(!tocBody(DOC).includes("mdforge-pageref"));
  });
});

describe("TOC heading numbering", () => {
  it("numbers entries but links to the un-numbered slug", () => {
    const body = tocBody(DOC, {}, {});
    assert.equal(
      body,
      [
        "- [1. Alpha](#alpha)",
        "  - [1.1. Beta](#beta)",
        "- [2. Gamma](#gamma)",
      ].join("\n"),
    );
  });

  it("does not number entries when heading numbering is disabled", () => {
    assert.ok(!tocBody(DOC, {}, false).includes("1."));
  });

  it("counts headings before the marker so numbers stay in step", () => {
    const markdown = [
      "# Title",
      "",
      "## Before",
      "",
      "<!-- toc -->",
      "",
      "## After",
      "",
      "### Deeper",
      "",
    ].join("\n");
    assert.equal(
      tocBody(markdown, {}, {}),
      ["- [2. After](#after)", "  - [2.1. Deeper](#deeper)"].join("\n"),
    );
  });

  it("counts headings before the marker so slugs stay de-duplicated", () => {
    const markdown = ["# Intro", "", "<!-- toc -->", "", "## Intro", ""].join(
      "\n",
    );
    assert.equal(tocBody(markdown), "- [Intro](#intro-1)");
  });

  it("de-duplicates slugs within the TOC itself", () => {
    const markdown = "<!-- toc -->\n\n## Notes\n\n## Notes\n";
    assert.equal(
      tocBody(markdown),
      ["- [Notes](#notes)", "- [Notes](#notes-1)"].join("\n"),
    );
  });

  it("keeps numbering in step when regenerating over an existing TOC", () => {
    const markdown = [
      "# Title",
      "",
      "## Before",
      "",
      "<!-- toc -->",
      "",
      "- [stale](#stale)",
      "",
      "<!-- tocstop -->",
      "",
      "## After",
      "",
    ].join("\n");
    assert.equal(tocBody(markdown, {}, {}), "- [2. After](#after)");
  });
});

describe("TOC escaping", () => {
  it("escapes pipes in table cells", () => {
    const markdown = "<!-- toc -->\n\n## Pipe | Char\n";
    const body = tocBody(markdown, { style: "table" });
    assert.ok(body.includes("[Pipe \\| Char]"), `pipe not escaped in: ${body}`);
  });

  it("escapes brackets in link text", () => {
    const markdown = "<!-- toc -->\n\n## Note [draft]\n";
    const body = tocBody(markdown);
    // An unescaped "]" would terminate the link text early and break the link.
    assert.ok(
      body.includes("[Note \\[draft\\]]("),
      `brackets not escaped in: ${body}`,
    );
  });
});
