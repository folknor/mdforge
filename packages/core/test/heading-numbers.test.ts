import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig } from "../src/lib/config.ts";
import { HeadingNumberer, type HeadingNumbersConfig } from "../src/lib/heading-numbers.ts";
import { getHtml } from "../src/lib/markdown.ts";

/** Render through the full pipeline with heading numbering on. */
function render(markdown: string, config: HeadingNumbersConfig = {}): string {
  return getHtml(markdown, { ...defaultConfig, heading_numbers: config });
}

/** Feed a sequence of heading depths to a numberer and collect the prefixes. */
function numbersFor(depths: number[], config: HeadingNumbersConfig = {}): (string | undefined)[] {
  const numberer = new HeadingNumberer(config);

  return depths.map((depth) => numberer.next(depth));
}

/**
 * Render headings through the marked extension and pull the visible text of
 * each heading back out, so extension output can be compared to the class.
 */
function renderedHeadingTexts(markdown: string, config: HeadingNumbersConfig = {}): string[] {
  const html = render(markdown, config);
  const texts: string[] = [];
  const regex = /<h[1-6][^>]*>(.*?)<\/h[1-6]>/g;
  let match = regex.exec(html);

  while (match !== null) {
    const text = match[1];
    assert.ok(text !== undefined, "heading without captured text");
    texts.push(text);
    match = regex.exec(html);
  }

  return texts;
}

describe("HeadingNumberer", () => {
  it("numbers from h2 by default and leaves h1 alone", () => {
    assert.deepEqual(numbersFor([1, 2, 3]), [undefined, "1.", "1.1."]);
  });

  it("nests counters and resets deeper levels on a shallower heading", () => {
    assert.deepEqual(numbersFor([2, 3, 3, 2, 3, 4]), [
      "1.",
      "1.1.",
      "1.2.",
      "2.",
      "2.1.",
      "2.1.1.",
    ]);
  });

  it("restarts a deeper counter after it was reset", () => {
    assert.deepEqual(numbersFor([2, 3, 4, 3]), ["1.", "1.1.", "1.1.1.", "1.2."]);
  });

  it("honours start_depth by numbering from that level", () => {
    assert.deepEqual(numbersFor([1, 2, 2, 3], { start_depth: 1, skip_first_h1: false }), [
      "1.",
      "1.1.",
      "1.2.",
      "1.2.1.",
    ]);
  });

  it("skips only the first h1 when start_depth is 1", () => {
    // Sections under the skipped h1 sit in an implicit section 1 ("1.1.",
    // never "0.1."), which is consumed, so the next real h1 is "2." and its
    // sections never repeat "1.1.". With no sections before it, it is "1.".
    assert.deepEqual(numbersFor([1, 2, 1, 2], { start_depth: 1 }), [
      undefined,
      "1.1.",
      "2.",
      "2.1.",
    ]);
    assert.deepEqual(numbersFor([1, 1], { start_depth: 1 }), [undefined, "1."]);
  });

  it("numbers a skipped level as an implicit, consumed section 1", () => {
    assert.deepEqual(numbersFor([2, 4, 4, 3, 4]), ["1.", "1.1.1.", "1.1.2.", "1.2.", "1.2.1."]);
    assert.deepEqual(numbersFor([4, 3, 2]), ["1.1.1.", "1.2.", "2."]);
    assert.deepEqual(numbersFor([2, 4, 3], { format: "roman-upper", separator: "-" }), [
      "I-",
      "I-I-I-",
      "I-II-",
    ]);
  });

  it("lets a heading deeper than max_depth consume nothing", () => {
    assert.deepEqual(numbersFor([2, 4, 3], { max_depth: 3 }), ["1.", undefined, "1.1."]);
  });

  it("numbers the first h1 when skip_first_h1 is false", () => {
    assert.deepEqual(numbersFor([1, 1], { start_depth: 1, skip_first_h1: false }), ["1.", "2."]);
  });

  it("does not number headings deeper than max_depth", () => {
    assert.deepEqual(numbersFor([2, 3, 4], { max_depth: 3 }), ["1.", "1.1.", undefined]);
  });

  it("uses the configured separator between and after levels", () => {
    assert.deepEqual(numbersFor([2, 3], { separator: "-" }), ["1-", "1-1-"]);
  });

  it("formats numbers as lowercase roman numerals", () => {
    assert.deepEqual(numbersFor([2, 2, 2, 2], { format: "roman" }), ["i.", "ii.", "iii.", "iv."]);
  });

  it("formats numbers as uppercase roman numerals", () => {
    assert.deepEqual(numbersFor([2, 2], { format: "roman-upper" }), ["I.", "II."]);
  });

  it("formats numbers as letters", () => {
    assert.deepEqual(numbersFor([2, 3], { format: "alpha" }), ["a.", "a.a."]);
  });

  it("formats numbers as uppercase letters and wraps past z", () => {
    const depths = Array.from({ length: 27 }, () => 2);
    const numbers = numbersFor(depths, { format: "alpha-upper" });
    assert.equal(numbers[0], "A.");
    assert.equal(numbers[25], "Z.");
    assert.equal(numbers[26], "AA.");
  });

  it("apply() prefixes the heading text with a space after the number", () => {
    const numberer = new HeadingNumberer();
    assert.equal(numberer.apply(1, "Title"), "Title");
    assert.equal(numberer.apply(2, "Avvik"), "1. Avvik");
    assert.equal(numberer.apply(3, "Detaljer"), "1.1. Detaljer");
  });
});

describe("numbered heading rendering", () => {
  it("derives heading ids from the un-numbered text", () => {
    const html = render("## Avvik\n");
    assert.match(html, /<h2 id="avvik">1\. Avvik<\/h2>/);
  });

  it("de-duplicates ids for repeated heading text", () => {
    const html = render("## Notes\n\n## Notes\n");

    assert.match(html, /<h2 id="notes">1\. Notes<\/h2>/);
    assert.match(html, /<h2 id="notes-1">2\. Notes<\/h2>/);
  });

  it("produces the same numbers as HeadingNumberer for the same headings", () => {
    const headings: [depth: number, title: string][] = [
      [1, "Title"],
      [2, "Alpha"],
      [3, "Beta"],
      [3, "Gamma"],
      [2, "Delta"],
      [4, "Deep"],
      [3, "Epsilon"],
    ];

    const markdown = headings.map(([depth, title]) => `${"#".repeat(depth)} ${title}`).join("\n\n");

    for (const config of [
      {},
      { start_depth: 1, skip_first_h1: false },
      { max_depth: 3 },
      // The h2-then-h4 skip leaves no empty level for smartypants to dash.
      { format: "roman-upper" as const, separator: "-" },
    ] satisfies HeadingNumbersConfig[]) {
      const numberer = new HeadingNumberer(config);

      const expected = headings.map(([depth, title]) => numberer.apply(depth, title));

      assert.deepEqual(
        renderedHeadingTexts(markdown, config),
        expected,
        `config ${JSON.stringify(config)}`,
      );
    }
  });
});
