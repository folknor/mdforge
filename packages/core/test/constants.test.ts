import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { processConstants } from "../src/lib/constants.ts";

const constants = {
  rate: { kind: "number", value: 1500 },
  name: { kind: "text", value: "Acme" },
} as const;

describe("processConstants", () => {
  it("substitutes text and evaluates arithmetic", () => {
    const { content, warnings } = processConstants("{{ name }}: {{ rate * 2 }}", constants);

    assert.equal(content, "Acme: 3000");
    assert.deepEqual(warnings, []);
  });

  it("refuses text in arithmetic", () => {
    const { content, warnings } = processConstants("{{ name + 1 }}", constants);

    assert.equal(content, "{{ name + 1 }}");
    assert.match(warnings[0] ?? "", /is text/);
  });

  it("treats prototype names as unknown", () => {
    for (const name of ["toString", "constructor", "hasOwnProperty"]) {
      const { content, warnings } = processConstants(`{{ ${name} }}`, constants);

      assert.equal(content, `{{ ${name} }}`);
      assert.match(warnings[0] ?? "", /unknown constant/, name);
    }
  });
});
