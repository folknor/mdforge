import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateFontStylesheet, isFontPairingPreset } from "../src/lib/fonts.ts";

describe("font presets", () => {
  it("recognises preset names", () => {
    assert.equal(isFontPairingPreset("classic-elegant"), true);
    assert.equal(isFontPairingPreset("beryl"), true);
  });

  it("rejects prototype keys and unknown names", () => {
    for (const name of ["toString", "constructor", "__proto__", "nope"]) {
      assert.equal(isFontPairingPreset(name), false, name);
    }
  });

  it("produces no stylesheet without fonts", async () => {
    assert.equal(await generateFontStylesheet(), undefined);
    assert.equal(await generateFontStylesheet({}), undefined);
  });
});
