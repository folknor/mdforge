import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Marked } from "marked";
import {
  HeadingNumberer,
  type HeadingNumbersConfig,
  headingNumbers,
} from "../dist/lib/heading-numbers.js";

/** Feed a sequence of heading depths to a numberer and collect the prefixes. */
function numbersFor(
  depths: number[],
  config: HeadingNumbersConfig = {},
): (string | undefined)[] {
  const numberer = new HeadingNumberer(config);
  return depths.map((depth) => numberer.next(depth));
}

/**
 * Render headings through the marked extension and pull the visible text of
 * each heading back out, so extension output can be compared to the class.
 */
function renderedHeadingTexts(
  markdown: string,
  config: HeadingNumbersConfig = {},
): string[] {
  const marked = new Marked(headingNumbers(config));
  const html = marked.parse(markdown, { async: false }) as string;
  const texts: string[] = [];
  const regex = /<h[1-6][^>]*>(.*?)<\/h[1-6]>/g;
  let match = regex.exec(html);
  while (match !== null) {
    texts.push(match[1] as string);
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
    assert.deepEqual(numbersFor([2, 3, 4, 3]), [
      "1.",
      "1.1.",
      "1.1.1.",
      "1.2.",
    ]);
  });

  it("honours start_depth by numbering from that level", () => {
    assert.deepEqual(
      numbersFor([1, 2, 2, 3], { start_depth: 1, skip_first_h1: false }),
      ["1.", "1.1.", "1.2.", "1.2.1."],
    );
  });

  it("skips only the first h1 when start_depth is 1", () => {
    // The skipped h1 still parents its sections ("1.1.", never "0.1."), but
    // does not consume a number: the next real h1 is "1.".
    assert.deepEqual(numbersFor([1, 2, 1], { start_depth: 1 }), [
      undefined,
      "1.1.",
      "1.",
    ]);
  });

  it("numbers the first h1 when skip_first_h1 is false", () => {
    assert.deepEqual(
      numbersFor([1, 1], { start_depth: 1, skip_first_h1: false }),
      ["1.", "2."],
    );
  });

  it("does not number headings deeper than max_depth", () => {
    assert.deepEqual(numbersFor([2, 3, 4], { max_depth: 3 }), [
      "1.",
      "1.1.",
      undefined,
    ]);
  });

  it("uses the configured separator between and after levels", () => {
    assert.deepEqual(numbersFor([2, 3], { separator: "-" }), ["1-", "1-1-"]);
  });

  it("formats numbers as lowercase roman numerals", () => {
    assert.deepEqual(numbersFor([2, 2, 2, 2], { format: "roman" }), [
      "i.",
      "ii.",
      "iii.",
      "iv.",
    ]);
  });

  it("formats numbers as uppercase roman numerals", () => {
    assert.deepEqual(numbersFor([2, 2], { format: "roman-upper" }), [
      "I.",
      "II.",
    ]);
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

describe("headingNumbers() extension", () => {
  it("derives heading ids from the un-numbered text", () => {
    const marked = new Marked(headingNumbers());
    const html = marked.parse("## Avvik\n", { async: false }) as string;
    assert.match(html, /<h2 id="avvik">1\. Avvik<\/h2>/);
  });

  it("de-duplicates ids for repeated heading text", () => {
    const marked = new Marked(headingNumbers());
    const html = marked.parse("## Notes\n\n## Notes\n", {
      async: false,
    }) as string;
    assert.match(html, /<h2 id="notes">1\. Notes<\/h2>/);
    assert.match(html, /<h2 id="notes-1">2\. Notes<\/h2>/);
  });

  it("produces the same numbers as HeadingNumberer for the same headings", () => {
    const markdown = [
      "# Title",
      "## Alpha",
      "### Beta",
      "### Gamma",
      "## Delta",
      "#### Deep",
      "### Epsilon",
    ].join("\n\n");
    const depths = [1, 2, 3, 3, 2, 4, 3];
    const titles = [
      "Title",
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
      "Deep",
      "Epsilon",
    ];

    for (const config of [
      {},
      { start_depth: 1, skip_first_h1: false },
      { max_depth: 3 },
      { format: "roman-upper" as const, separator: "-" },
    ] satisfies HeadingNumbersConfig[]) {
      const numberer = new HeadingNumberer(config);
      const expected = depths.map((depth, i) =>
        numberer.apply(depth, titles[i] as string),
      );
      assert.deepEqual(
        renderedHeadingTexts(markdown, config),
        expected,
        `config ${JSON.stringify(config)}`,
      );
    }
  });
});
