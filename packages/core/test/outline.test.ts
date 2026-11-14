import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Config, defaultConfig } from "../src/lib/config.ts";
import type { HeadingNumbersConfig } from "../src/lib/heading-numbers.ts";
import { getHtml } from "../src/lib/markdown.ts";
import type { TOCOptions } from "../src/lib/toc.ts";

function render(markdown: string, overrides: Partial<Config> = {}): string {
  return getHtml(markdown, { ...defaultConfig, ...overrides });
}

/** Ids of the rendered headings, in document order. */
function headingIds(html: string): string[] {
  return [...html.matchAll(/<h[1-6] id="([^"]*)"/g)].map((m) => m[1] ?? "");
}

/** The generated TOC: the first list or table in the body. */
function toc(html: string): string {
  const match = /<(ul|ol|table)>[\s\S]*?<\/\1>\n(?!<\/li>)/.exec(html);
  assert.ok(match, `no TOC in: ${html}`);

  return match[0];
}

/** Link targets of the TOC, in order. */
function tocTargets(html: string): string[] {
  return [...toc(html).matchAll(/<a href="#([^"]*)">/g)].map((m) => m[1] ?? "");
}

function withToc(body: string, options: TOCOptions = {}, numbering?: HeadingNumbersConfig) {
  return render(`# Title\n\n<!-- toc -->\n\n${body}`, {
    toc_options: options,
    heading_numbers: numbering ?? false,
  });
}

describe("TOC links use the rendered heading ids", () => {
  it("links a heading with an inline link by its rendered id", () => {
    const html = withToc("## [Alpha](https://example.org)\n\n## Beta\n");
    assert.deepEqual(headingIds(html), ["title", "alpha", "beta"]);
    assert.deepEqual(tocTargets(html), ["alpha", "beta"]);
    // The label is the link text, unwrapped: no nested link.
    assert.ok(toc(html).includes('<a href="#alpha">Alpha</a>'));
  });

  it("points TOC page references at the rendered id", () => {
    const html = withToc("## [Alpha](https://example.org)\n", { page_numbers: true });
    assert.ok(toc(html).includes('data-mdforge-pageref="alpha"'));
  });

  it("counts headings nested in containers, without listing them", () => {
    const html = withToc("> ## Same\n\n## Same\n");
    assert.deepEqual(headingIds(html), ["title", "same", "same-1"]);
    assert.deepEqual(tocTargets(html), ["same-1"]);
  });

  it("counts headings before the marker for de-duplication", () => {
    const html = render("# Intro\n\n<!-- toc -->\n\n## Intro\n");
    assert.deepEqual(tocTargets(html), ["intro-1"]);
  });

  it("de-duplicates within the TOC", () => {
    assert.deepEqual(tocTargets(withToc("## Notes\n\n## Notes\n")), ["notes", "notes-1"]);
  });

  it("names a heading without sluggable text `section`", () => {
    const html = withToc("## !!!\n\n## ![](x.png)\n");
    assert.deepEqual(headingIds(html), ["title", "section", "section-1"]);
    assert.ok(toc(html).includes('<a href="#section-1">(untitled)</a>'));
  });
});

describe("TOC labels", () => {
  it("keeps formatting but no ids, links or footnote references", () => {
    const html = withToc(
      '## *Em* `a<b` <span id="badge">B</span>[^n]\n\n[^n]: Note\n\n## ![alt *x*](i.png)\n',
    );

    const list = toc(html);
    assert.ok(list.includes("<em>Em</em> <code>a&lt;b</code> B</a>"), list);
    assert.ok(!list.includes("badge"));
    assert.ok(!list.includes("footnote"));
    assert.ok(list.includes(">alt x</a>"), list);
  });

  it("drops the content of script elements", () => {
    const list = toc(withToc("## <script>secret</script>Alpha\n"));
    assert.ok(list.includes(">Alpha</a>"), list);
  });

  it("keeps the content of custom elements that only start like script", () => {
    const list = toc(withToc("## <script-widget>Visible</script-widget> Alpha\n"));
    assert.ok(list.includes(">Visible Alpha</a>"), list);
  });

  it("does not let raw HTML in image alt text hide the rest of the label", () => {
    const list = toc(withToc("## ![<script>secret](x.png) Alpha\n"));
    assert.ok(list.includes("Alpha</a>"), list);
  });

  it("keeps encoded markup in image alt text escaped", () => {
    const list = toc(withToc("## ![&#60;span id=badge&#62;Alt&#60;/span&#62;](x.png)\n"));
    assert.ok(!list.includes("<span"), list);
  });

  it("calls a heading with only a non-breaking space (untitled)", () => {
    for (const blank of ["&nbsp;", "&#9;", "&#x2003;", "&#0160;"]) {
      const list = toc(withToc(`## ${blank}\n`));
      assert.ok(list.includes(">(untitled)</a>"), `${blank}: ${list}`);
    }
  });

  it("does not re-interpret escaped markdown", () => {
    const list = toc(withToc("## \\*not em\\*\n"));
    assert.ok(list.includes(">*not em*</a>"), list);
  });

  it("carries the heading numbers", () => {
    const html = withToc("## Alpha\n\n### Beta\n", {}, {});
    assert.ok(toc(html).includes('<a href="#alpha">1. Alpha</a>'));
    assert.ok(toc(html).includes('<a href="#beta">1.1. Beta</a>'));
  });

  it("is processed by smartypants with the rest of the document", () => {
    const list = toc(withToc('## "Alpha" -- Beta\n'));
    assert.ok(list.includes(">&#8220;Alpha&#8221; &#8211; Beta</a>"), list);
  });
});

describe("TOC markers", () => {
  it("replaces a stale TOC body without lexing it", () => {
    const html = render(
      "<!-- toc -->\n\nOld[^n]\n\n[^n]: ## Ghost\n\n<!-- tocstop -->\n\n## Real\n",
    );

    assert.ok(!html.includes("Ghost"));
    assert.deepEqual(headingIds(html), ["real"]);
    assert.deepEqual(tocTargets(html), ["real"]);
  });

  it("ignores a marker inside a code block or a blockquote", () => {
    const html = render("```\n<!-- toc -->\n```\n\n> <!-- toc -->\n\n## Alpha\n");
    assert.ok(!html.includes('<a href="#alpha">'));
    assert.ok(html.includes("&lt;!-- toc --&gt;"));
  });

  it("finds the marker after footnotes", () => {
    const html = render("Footnotes intro[^n]\n\n[^n]: Note\n\n<!-- toc -->\n\n## Real\n");
    assert.deepEqual(tocTargets(html), ["real"]);
  });

  it("rejects more than one TOC", () => {
    assert.throws(() => render("<!-- toc -->\n\n## A\n\n<!-- toc -->\n"), {
      message: "mdforge only supports one Table of Contents per file.",
    });
  });

  it("finds the marker when the source starts with blank lines", () => {
    assert.deepEqual(tocTargets(render("\n\n<!-- toc -->\n\n## Real\n")), ["real"]);
  });
});

describe("@numberof", () => {
  const DOC = "# Avtale\n\n## Ansettelse\n\n## Arbeidstid\n\n### Overtid\n";

  function numberOf(reference: string, numbering: HeadingNumbersConfig | false = {}, doc = DOC) {
    const html = render(`${doc}\nse punkt @numberof(${reference}).\n`, {
      heading_numbers: numbering,
    });

    const match = /se punkt ([^<]*)\./.exec(html);
    assert.ok(match, `no reference sentence in: ${html}`);

    return match[1];
  }

  it("resolves a heading to its number without the trailing separator", () => {
    assert.equal(numberOf("Ansettelse"), "1");
    assert.equal(numberOf("Overtid"), "2.1");
  });

  it("accepts an explicit #id the same way @pageof does", () => {
    assert.equal(numberOf("#overtid"), "2.1");
  });

  it("respects format and separator", () => {
    assert.equal(numberOf("Overtid", { format: "roman-upper", separator: "-" }), "II-I");
  });

  it("leaves unnumbered, unknown and disabled references verbatim", () => {
    assert.equal(numberOf("Overtid", { max_depth: 2 }), "@numberof(Overtid)");
    assert.equal(numberOf("Avtale"), "@numberof(Avtale)");
    assert.equal(numberOf("Finnes Ikke"), "@numberof(Finnes Ikke)");
    assert.equal(numberOf("Ansettelse", false), "@numberof(Ansettelse)");
  });

  it("matches headings through their transliterated id", () => {
    assert.equal(numberOf("Årsverk", {}, "# Avtale\n\n## Årsverk\n"), "1");
  });

  it("resolves headings with inline markup by their rendered id", () => {
    assert.equal(
      numberOf("Alpha", {}, "# T\n\n## Intro\n\n## [Alpha](https://example.org)\n"),
      "2",
    );
  });

  it("counts headings nested in containers like the renderer does", () => {
    assert.equal(numberOf("Same-1", {}, "# T\n\n> ## Same\n\n## Same\n"), "2");
  });

  it("names the second of two repeated headings by its suffixed id", () => {
    assert.equal(numberOf("Notes-1", {}, "# T\n\n## Notes\n\n## Notes\n"), "2");
  });

  it("is not resolved inside code", () => {
    const html = render(`${DOC}\n\`@numberof(Overtid)\`\n`, { heading_numbers: {} });
    assert.ok(html.includes("<code>@numberof(Overtid)</code>"));
  });

  it("keeps heading ids independent of references inside headings", () => {
    const html = render("# T\n\n## @numberof(2)\n\n## 2\n\nRef @numberof(2).\n", {
      heading_numbers: {},
    });

    assert.deepEqual(headingIds(html), ["t", "section", "2"]);
    assert.ok(html.includes("Ref 2."));
    assert.ok(html.includes('<h2 id="section">1. 2</h2>'));
  });

  it("resolves references in image alt text", () => {
    const html = render(`${DOC}\n![See @numberof(Overtid)](x.png)\n`, { heading_numbers: {} });
    assert.ok(html.includes('alt="See 2.1"'), html);
  });
});
