import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rangedPrintMatches, selectedPages } from "../src/page-ranges.ts";

describe("selectedPages", () => {
  it("reads Chromium's range syntax", () => {
    assert.deepEqual(selectedPages("1-3, 5", 10), [1, 2, 3, 5]);
    assert.deepEqual(selectedPages("8-", 10), [8, 9, 10]);
    assert.deepEqual(selectedPages("-2", 10), [1, 2]);
    assert.deepEqual(selectedPages("-", 3), [1, 2, 3]);
    assert.deepEqual(selectedPages("3, , 1", 10), [1, 3], "blank entries skipped, sorted");
    assert.deepEqual(selectedPages("2-4, 3-5", 10), [2, 3, 4, 5], "merged");
  });

  it("caps pages at the end of the document", () => {
    assert.deepEqual(selectedPages("9-99", 10), [9, 10]);
    assert.deepEqual(selectedPages("20", 10), []);
  });

  it("rejects what Chromium rejects", () => {
    assert.equal(selectedPages("3-1", 10), undefined);
    assert.equal(selectedPages("0", 10), undefined);
    assert.equal(selectedPages("a", 10), undefined);
    assert.equal(selectedPages("1-2-3", 10), undefined);
  });
});

describe("rangedPrintMatches", () => {
  const settled = {
    pageCount: 4,
    destinations: new Map([
      ["a", 1],
      ["b", 3],
      ["c", 4],
    ]),
  };

  it("accepts a selection whose destinations moved with it", () => {
    const ranged = { pageCount: 2, destinations: new Map([["b", 2]]) };

    assert.equal(rangedPrintMatches(settled, ranged, [2, 3]), true);
  });

  it("rejects a destination on another document page", () => {
    const ranged = { pageCount: 2, destinations: new Map([["b", 1]]) };

    assert.equal(rangedPrintMatches(settled, ranged, [2, 3]), false);
  });

  it("rejects a selected destination that went missing", () => {
    const ranged = { pageCount: 2, destinations: new Map<string, number>() };

    assert.equal(rangedPrintMatches(settled, ranged, [2, 3]), false);
  });

  it("rejects a page count that does not match the selection", () => {
    const ranged = { pageCount: 3, destinations: new Map([["b", 2]]) };

    assert.equal(rangedPrintMatches(settled, ranged, [2, 3]), false);
  });
});
