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

describe("generated HTML escaping", () => {
  const text = '<img src=x>&amp;"';
  const escaped = "&lt;img src=x&gt;&amp;amp;&quot;";

  it("escapes the complete body class attribute and keeps config literal", () => {
    const body_class = ["first second", 'x" onload="injected', "<&amp;>"];
    const html = getHtml("Body", { ...defaultConfig, body_class });

    assert.ok(
      html.includes('<body class="first second x&quot; onload=&quot;injected &lt;&amp;amp;&gt;">'),
    );
    assert.deepEqual(body_class, ["first second", 'x" onload="injected', "<&amp;>"]);
    assert.ok(getHtml("Body", { ...defaultConfig, body_class: [] }).includes('<body class="">'));
  });

  for (const value of ["'first second \"<&amp;>'", "['first second', '\"<&amp;>']"]) {
    it(`preserves spaces and literal characters in YAML body_class ${value}`, async () => {
      const prepared = await prepareConversion(
        { content: `---\nbody_class: ${value}\n---\nBody` },
        { ...defaultConfig, theme: false },
        { output: { kind: "none" } },
      );

      assert.deepEqual(
        prepared.config.body_class,
        value.startsWith("[") ? ["first second", '"<&amp;>'] : ['first second "<&amp;>'],
      );
      assert.ok(prepared.html.includes('<body class="first second &quot;&lt;&amp;amp;&gt;">'));
    });
  }

  it("escapes admonition titles as plain text", () => {
    const html = getHtml('!!! note "<img src=x>&amp;"\n    Body\n', defaultConfig);

    assert.ok(html.includes('<p class="admonition-title">&lt;img src=x&gt;&amp;amp;</p>'));
    assert.ok(!html.includes("<img src=x>"));
  });

  for (const fillable of [false, true]) {
    for (const kind of ["select", "checklist", "radiolist"]) {
      it(`escapes ${kind} names, labels and options (fillable=${fillable})`, () => {
        const html = getHtml(`[?${kind}? ${text}](${text})\n- ${text}\n`, {
          ...defaultConfig,
          fillable,
        });

        assert.ok(html.includes(`name="${escaped}"`));
        assert.ok(html.includes(`value="${escaped}"`));
        assert.ok(html.includes(`>${escaped}</`));
        assert.ok(!html.includes("<img src=x>"));

        if (fillable) {
          assert.ok(html.includes(`data-field-name="${escaped}"`));

          if (kind !== "select") assert.ok(html.includes("&amp;value="));
        }
      });
    }

    for (const marks of ["??", "???6"]) {
      it(`escapes inline ${marks} names and labels (fillable=${fillable})`, () => {
        const html = getHtml(`[${text} ${marks}](${text})`, { ...defaultConfig, fillable });

        assert.ok(html.includes(`name="${escaped}"`));
        assert.ok(html.includes(`>${escaped}</span>`));
        assert.ok(!html.includes("<img src=x>"));

        if (fillable) assert.ok(html.includes(`data-field-name="${escaped}"`));
      });
    }
  }

  it("escapes numbering separators in headings, TOC labels and references", () => {
    const html = getHtml("<!-- toc -->\n\n## First\n\n### Second\n\n@numberof(Second)", {
      ...defaultConfig,
      heading_numbers: { separator: text },
    });

    assert.ok(html.includes(`1${escaped} First</h2>`));
    assert.ok(html.includes(`1${escaped}1${escaped} Second</h3>`));
    assert.ok(html.includes(`1${escaped}1${escaped} Second</a>`));
    assert.ok(html.includes(`<p>1${escaped}1</p>`));
    assert.ok(!html.includes("<img src=x>"));
  });
});
