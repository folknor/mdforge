import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type Config, defaultConfig } from "../src/lib/config.ts";
import { baseElement, prepareConversion, stylesheetLink } from "../src/lib/prepare.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "prepare");

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

describe("prepareConversion base directory", () => {
  it("uses a path input's own directory", async () => {
    const prepared = await prepareConversion({ path: join(fixtures, "doc.md") }, config(), {
      output: { kind: "none" },
    });

    assert.equal(prepared.baseUrl, pathToFileURL(join(fixtures, "/")).href);
  });

  it("uses a content input's baseDir and rejects basedir in front matter", async () => {
    const prepared = await prepareConversion(
      { content: "---\nbasedir: /etc\n---\n# Title\n", baseDir: fixtures },
      config(),
      { output: { kind: "none" } },
    );

    assert.equal(prepared.baseUrl, pathToFileURL(join(fixtures, "/")).href);
    assert.equal(prepared.info.warnings.length, 1);
    assert.match(prepared.info.warnings[0] ?? "", /basedir/);
  });

  it("percent-encodes characters that would end the URL path", async () => {
    const dir = join(fixtures, 'a"b#c?d');

    const prepared = await prepareConversion({ content: "# Title\n", baseDir: dir }, config(), {
      output: { kind: "none" },
    });

    assert.ok(prepared.baseUrl.endsWith("/a%22b%23c%3Fd/"));
    assert.equal(fileURLToPath(prepared.baseUrl), join(dir, "/"));
  });
});

describe("baseElement", () => {
  it("escapes the URL for an HTML attribute", () => {
    assert.equal(baseElement("file:///docs/a&copy;b/"), '<base href="file:///docs/a&amp;copy;b/">');
  });
});

describe("stylesheetLink", () => {
  it("escapes the URL for an HTML attribute", () => {
    assert.equal(
      stylesheetLink("file:///css/a&copy;b.css"),
      '<link rel="stylesheet" href="file:///css/a&amp;copy;b.css">',
    );
  });
});

describe("prepareConversion stylesheets", () => {
  // User files must stay paths, which the renderers link by URL so a sheet's
  // relative url() and @import resolve against its own directory. The
  // package's own sheets travel as text so HTML output carries them.
  it("keeps user stylesheet files as paths and inlines the package's own", async () => {
    const userSheet = join(fixtures, "user.css");

    const prepared = await prepareConversion(
      { content: "# Title\n", baseDir: fixtures },
      { ...config(), stylesheet: [{ type: "path", value: userSheet }] },
      { output: { kind: "none" } },
    );

    const paths = prepared.stylesheets.filter((s) => s.type === "path");

    assert.deepEqual(paths, [{ type: "path", value: userSheet }]);
    // The highlight.js sheet is appended as text
    assert.equal(prepared.stylesheets.at(-1)?.type, "content");
  });

  // A user `@page { @top-left { ... } }` rule must beat the generated margin
  // box defaults at equal specificity, so the generated sheet comes first.
  it("places the generated header/footer sheet before the user's stylesheets", async () => {
    const userSheet = join(fixtures, "user.css");

    const prepared = await prepareConversion(
      { content: "# Title\n", baseDir: fixtures },
      {
        ...config(),
        stylesheet: [{ type: "path", value: userSheet }],
        header: { left: "**Bold**" },
      },
      { output: { kind: "none" } },
    );

    const pagedIndex = prepared.stylesheets.findIndex(
      (s) => s.type === "content" && s.value.includes("@top-left"),
    );

    const userIndex = prepared.stylesheets.findIndex((s) => s.type === "path");

    assert.notEqual(pagedIndex, -1);
    assert.ok(pagedIndex < userIndex);
  });
});

describe("prepareConversion dependencies", () => {
  it("records the auto-detected stylesheet candidates even when absent", async () => {
    const prepared = await prepareConversion({ path: join(fixtures, "doc.md") }, config(), {
      output: { kind: "none" },
    });

    assert.deepEqual(prepared.info.dependencies, [
      join(fixtures, "doc.css"),
      join(fixtures, "index.css"),
    ]);
  });
});
