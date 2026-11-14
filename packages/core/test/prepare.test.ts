import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Config, defaultConfig } from "../dist/lib/config.js";
import { prepareConversion } from "../dist/lib/prepare.js";

// No theme, so preparation needs no font lookups
const config = (): Config => ({ ...defaultConfig, theme: false });

const hostile = "---\ndest: elsewhere.pdf\nas_html: true\n---\n# Title\n";

describe("prepareConversion output choices", () => {
  it("keeps the invocation's target and format over front matter", async () => {
    const prepared = await prepareConversion({ content: hostile }, config(), {
      format: "pdf",
      output: { kind: "none" },
    });

    assert.equal(prepared.format, "pdf");
    assert.deepEqual(prepared.output, { kind: "none" });
    assert.equal(prepared.info.warnings.length, 1);
  });

  it("defaults content input to stdout and PDF", async () => {
    const prepared = await prepareConversion({ content: hostile }, config());

    assert.equal(prepared.format, "pdf");
    assert.deepEqual(prepared.output, { kind: "stdout" });
  });

  it("treats a file named stdout as a file", async () => {
    const prepared = await prepareConversion({ content: "# Title\n" }, config(), {
      output: { kind: "file", path: "stdout" },
    });

    assert.deepEqual(prepared.output, { kind: "file", path: "stdout" });
  });

  it("lets an explicit fillable override the document", async () => {
    const prepared = await prepareConversion({ content: "---\nfillable: true\n---\n" }, config(), {
      fillable: false,
    });

    assert.equal(prepared.config.fillable, false);
  });

  it("does not mutate a config shared between conversions", async () => {
    const shared = config();
    const before = structuredClone(shared);

    await prepareConversion({ content: "# One\n" }, shared);
    await prepareConversion({ content: "# Two\n" }, shared);

    assert.deepEqual(shared, before);
  });
});
