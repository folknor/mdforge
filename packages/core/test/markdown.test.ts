import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig } from "../src/lib/config.ts";
import { getHtml } from "../src/lib/markdown.ts";
import { prepareConversion } from "../src/lib/prepare.ts";

describe("document title text", () => {
  const title = '<&> &amp; </TiTlE><script>throw "injected"</script>';

  const serialized =
    "&lt;&amp;&gt; &amp;amp; &lt;/TiTlE&gt;&lt;script&gt;throw &quot;injected&quot;&lt;/script&gt;";

  it("escapes title text without changing the config value", () => {
    const config = { ...defaultConfig, document_title: title };
    const html = getHtml("Body", config);

    assert.ok(html.includes(`<title>${serialized}</title>`));
    assert.equal(config.document_title, title);
    assert.ok(!html.includes("<script>"));
  });

  for (const source of ["front matter", "first heading"] as const) {
    it(`preserves the literal title from ${source}`, async () => {
      const content =
        source === "front matter"
          ? `---\ndocument_title: '${title}'\n---\n# Other heading\n`
          : `# ${title}\n`;

      const prepared = await prepareConversion(
        { content },
        { ...defaultConfig, theme: false },
        { output: { kind: "none" } },
      );

      assert.equal(prepared.config.document_title, title);
      assert.ok(prepared.html.includes(`<title>${serialized}</title>`));
    });
  }
});
