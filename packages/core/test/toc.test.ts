import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToc, type TocEntry } from "../src/lib/toc.ts";

function entry(depth: number, id: string, label = id): TocEntry {
  return { depth, id, label };
}

const ENTRIES = [entry(2, "alpha", "Alpha"), entry(3, "beta", "Beta"), entry(2, "gamma", "Gamma")];

/** The unresolved page-reference span the TOC emits for a heading id. */
function pageRef(id: string): string {
  const target = `<a href="#${id}" style="display:none" aria-hidden="true"></a>`;

  return `<span class="mdforge-pageref" data-mdforge-pageref="${id}">${target}??</span>`;
}

describe("renderToc lists", () => {
  it("nests a bullet list by heading depth", () => {
    assert.equal(
      renderToc(ENTRIES),
      [
        "<ul>",
        '<li><a href="#alpha">Alpha</a>',
        "<ul>",
        '<li><a href="#beta">Beta</a></li>',
        "</ul></li>",
        '<li><a href="#gamma">Gamma</a></li>',
        "</ul>",
        "",
      ].join("\n"),
    );
  });

  it("nests an ordered list the same way", () => {
    const html = renderToc(ENTRIES, { style: "ordered" });
    assert.equal(html.match(/<ol>/g)?.length, 2);
    assert.ok(!html.includes("<ul>"));
  });

  it("nests a jump of several levels by one level, keeping later siblings in that list", () => {
    const html = renderToc([entry(2, "a"), entry(4, "b"), entry(3, "c"), entry(2, "d")]);
    assert.equal(
      html,
      [
        "<ul>",
        '<li><a href="#a">a</a>',
        "<ul>",
        '<li><a href="#b">b</a></li>',
        '<li><a href="#c">c</a></li>',
        "</ul></li>",
        '<li><a href="#d">d</a></li>',
        "</ul>",
        "",
      ].join("\n"),
    );
  });

  it("puts an entry shallower than the first one in the outer list", () => {
    const html = renderToc([entry(3, "a"), entry(2, "b")]);
    assert.equal(html.match(/<ul>/g)?.length, 1);
  });

  it("is empty when nothing is listed", () => {
    assert.equal(renderToc([]), "");
  });
});

describe("renderToc table", () => {
  it("renders a headerless two-column table with indented titles", () => {
    const html = renderToc(ENTRIES, { style: "table" });
    assert.ok(html.startsWith("<table>\n<thead>\n<tr>\n<th></th>\n<th></th>\n</tr>\n</thead>"));
    assert.ok(html.includes('<td>&nbsp;&nbsp;<a href="#beta">Beta</a></td>'));
    assert.ok(html.includes('<td><a href="#alpha">Alpha</a></td>'));
  });

  it("escapes configured table headers as text", () => {
    const html = renderToc(ENTRIES, { style: "table", table_headers: ["Innhold & mer", "Side"] });
    assert.ok(html.includes("<th>Innhold &amp; mer</th>\n<th>Side</th>"));
  });
});

describe("renderToc filtering", () => {
  it("drops entries deeper than maxdepth", () => {
    assert.ok(!renderToc(ENTRIES, { maxdepth: 2 }).includes("beta"));
  });

  it("drops a leading h1 when skip_first_h1 is set, and keeps it by default", () => {
    const withTitle = [entry(1, "title"), ...ENTRIES];
    assert.ok(!renderToc(withTitle, { skip_first_h1: true }).includes("#title"));
    assert.ok(renderToc(withTitle).includes("#title"));
  });

  it("only skips the first entry, and only if it is an h1", () => {
    const html = renderToc([entry(2, "a"), entry(1, "b")], { skip_first_h1: true });
    assert.ok(html.includes("#a") && html.includes("#b"));
  });
});

describe("renderToc page numbers", () => {
  it("appends a page reference to each entry after the separator", () => {
    const html = renderToc(ENTRIES, { page_numbers: true, maxdepth: 2 });
    assert.ok(html.includes(`<a href="#alpha">Alpha</a> — ${pageRef("alpha")}`));
    assert.ok(html.includes(`<a href="#gamma">Gamma</a> — ${pageRef("gamma")}`));
  });

  it("uses page_label and page_separator as text", () => {
    const html = renderToc(ENTRIES, {
      page_numbers: true,
      page_label: "Side ",
      page_separator: " <> ",
    });

    assert.ok(html.includes(`<a href="#alpha">Alpha</a> &lt;&gt; Side ${pageRef("alpha")}`));
  });

  it("puts the page reference in the second table column", () => {
    const html = renderToc(ENTRIES, { style: "table", page_numbers: true });
    assert.ok(html.includes(`<td>${pageRef("alpha")}</td>`));
  });

  it("emits no page reference when page_numbers is off", () => {
    assert.ok(!renderToc(ENTRIES).includes("mdforge-pageref"));
  });
});
