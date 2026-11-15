import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lengthInInches, printSpec } from "../src/print-spec.ts";

describe("printSpec", () => {
  it("reads lengths as Puppeteer does", () => {
    assert.equal(lengthInInches(96), 1, "a number is pixels");
    assert.equal(lengthInInches("96"), 1, "a string without unit is pixels");
    assert.equal(lengthInInches("2in"), 2);
    assert.equal(lengthInInches("25.4mm"), 1);
    assert.equal(lengthInInches("2.54cm"), 1);
    assert.equal(lengthInInches("72pt"), 1);
    assert.equal(lengthInInches("6pc"), 1);
    assert.equal(lengthInInches(undefined), undefined);
    assert.throws(() => lengthInInches("wide"), /Invalid length/);
  });

  it("defaults to Letter, no margins, no backgrounds, scale 1", () => {
    assert.deepEqual(printSpec({}), {
      paperWidth: 8.5,
      paperHeight: 11,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      landscape: false,
      scale: 1,
      printBackground: false,
      displayHeaderFooter: false,
      headerTemplate: "",
      footerTemplate: "",
      pageRanges: "",
      preferCSSPageSize: false,
    });
  });

  it("lets a format override width and height", () => {
    const spec = printSpec({ format: "a4", width: "100mm", height: "100mm" });

    assert.equal(spec.paperWidth, 8.2677);
    assert.equal(spec.paperHeight, 11.6929);
  });

  it("falls back to Letter for width and height independently", () => {
    const spec = printSpec({ width: "192px" });

    assert.equal(spec.paperWidth, 2);
    assert.equal(spec.paperHeight, 11);
  });

  it("converts each margin and treats a missing side as 0", () => {
    const spec = printSpec({ margin: { top: "1in", left: 48 } });

    assert.deepEqual(spec.margin, { top: 1, right: 0, bottom: 0, left: 0.5 });
  });
});
