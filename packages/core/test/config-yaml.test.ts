import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type ConfigSource, parseConfigYaml, splitFrontMatter } from "../dist/lib/config-yaml.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "config-yaml");

function parse(yaml: string, source: ConfigSource = "front-matter") {
  const dependencies: string[] = [];

  return parseConfigYaml(yaml, { source, baseDir: fixtures, dependencies }).then((parsed) => ({
    ...parsed,
    dependencies,
  }));
}

const paths = (issues: { path: string }[]) => issues.map(({ path }) => path);

describe("parseConfigYaml", () => {
  it("decodes a valid document without issues", async () => {
    const { config, issues } = await parse(`
theme: tufte
print_urls: true
font_scale: 1.2
fonts: classic-elegant
header:
  right: "Page {page}"
heading_numbers: false
constants:
  rate: 1500
  name: Acme
`);

    assert.deepEqual(issues, []);
    assert.deepEqual(config, {
      theme: "tufte",
      print_urls: true,
      font_scale: 1.2,
      fonts: {
        heading: "Playfair Display",
        body: "Libre Baskerville",
        mono: "Fira Code",
      },
      header: { right: "Page {page}" },
      heading_numbers: false,
      constants: {
        rate: { kind: "number", value: 1500 },
        name: { kind: "text", value: "Acme" },
      },
    });
  });

  it("decodes a plain header string as the centered column", async () => {
    const { config } = await parse('header: "{title}"\nfooter: ""');

    assert.deepEqual(config.header, { center: "{title}" });
    assert.deepEqual(config.footer, { center: "" });
  });

  it("drops a header string whose @file is missing", async () => {
    const { config, issues } = await parse('header: "@missing.txt"');

    assert.equal(config.header, undefined);
    assert.deepEqual(paths(issues), ["header"]);
  });

  it("resolves a font preset to a copy of its pairing", async () => {
    const one = await parse("fonts: beryl");
    const two = await parse("fonts: beryl");

    assert.deepEqual(one.config.fonts, two.config.fonts);
    assert.notEqual(one.config.fonts, two.config.fonts);
  });

  it("drops unknown and mistyped keys, keeping valid siblings", async () => {
    const { config, issues } = await parse(`
theme: tufte
unknown_option: x
page_numbers:
  format: invalid-format
  start: 3
pdf_options:
  scale: big
  landscape: true
`);

    assert.deepEqual(config, {
      theme: "tufte",
      page_numbers: { start: 3 },
      pdf_options: { landscape: true },
    });
    assert.deepEqual(paths(issues), ["unknown_option", "page_numbers.format", "pdf_options.scale"]);
  });

  it("rejects theme: true rather than passing it on", async () => {
    const { config, issues } = await parse("theme: true");

    assert.deepEqual(config, {});
    assert.deepEqual(paths(issues), ["theme"]);
  });

  it("expands margin shorthand, tolerating repeated spaces", async () => {
    const one = await parse("pdf_options:\n  margin: 20mm");
    const two = await parse('pdf_options:\n  margin: "20mm  15mm"');
    const bad = await parse('pdf_options:\n  margin: "1 2 3 4 5"');

    assert.deepEqual(one.config.pdf_options?.margin, {
      top: "20mm",
      right: "20mm",
      bottom: "20mm",
      left: "20mm",
    });
    assert.deepEqual(two.config.pdf_options?.margin, {
      top: "20mm",
      right: "15mm",
      bottom: "20mm",
      left: "15mm",
    });
    assert.deepEqual(bad.config.pdf_options, {});
    assert.deepEqual(paths(bad.issues), ["pdf_options.margin"]);
  });

  it("normalises paper format case", async () => {
    const { config } = await parse("pdf_options:\n  format: A4");

    assert.equal(config.pdf_options?.format, "a4");
  });

  it("turns single stylesheet and body_class values into lists", async () => {
    const { config } = await parse(`
stylesheet: style.css
body_class: wide
`);

    assert.deepEqual(config.stylesheet, [{ type: "path", value: resolve(fixtures, "style.css") }]);
    assert.deepEqual(config.body_class, ["wide"]);
  });

  // import.css is one line with no `{` and no trailing newline (it is kept out
  // of oxfmt for that reason): the shape that used to be taken for a filename.
  it("tags each stylesheet as path, URL or CSS", async () => {
    const { config, issues, dependencies } = await parse(`
stylesheet:
  - "@import.css"
  - https://example.com/a.css
  - http-docs.css
  - "body { margin: 0 }"
`);

    assert.deepEqual(issues, []);
    assert.deepEqual(config.stylesheet, [
      { type: "content", value: '@import url("https://example.com/b.css");' },
      { type: "url", value: "https://example.com/a.css" },
      { type: "path", value: resolve(fixtures, "http-docs.css") },
      { type: "content", value: "body { margin: 0 }" },
    ]);
    assert.deepEqual(dependencies, [join(fixtures, "import.css")]);
  });

  it("treats an empty stylesheet as none", async () => {
    const { config, issues } = await parse('stylesheet: ""');

    assert.deepEqual(config.stylesheet, []);
    assert.deepEqual(issues, []);
  });

  it("reads @file references in free-text fields only", async () => {
    const { config, issues, dependencies } = await parse(`
pdf_options:
  headerTemplate: "@header.html"
theme: "@header.html"
`);

    assert.match(config.pdf_options?.headerTemplate ?? "", /class="header"/);
    assert.deepEqual(dependencies, [join(fixtures, "header.html")]);
    assert.equal(config.theme, undefined);
    assert.deepEqual(paths(issues), ["theme"]);
  });

  it("reports a missing @file instead of throwing", async () => {
    const { config, issues } = await parse(`
header:
  left: "@missing.html"
  right: kept
`);

    assert.deepEqual(config.header, { right: "kept" });
    assert.deepEqual(paths(issues), ["header.left"]);
  });

  it("fails a two-cell tuple as a whole", async () => {
    const { config } = await parse(`
toc_options:
  table_headers: ["@missing.txt", "Page"]
  maxdepth: 3
`);

    assert.deepEqual(config.toc_options, { maxdepth: 3 });
  });

  it("only accepts launch_options from the config file", async () => {
    const yaml = "launch_options:\n  args: [--no-sandbox]";

    const fromFile = await parse(yaml, "config-file");
    const fromFrontMatter = await parse(yaml, "front-matter");

    assert.deepEqual(fromFile.config.launch_options, {
      args: ["--no-sandbox"],
    });
    assert.deepEqual(fromFrontMatter.config, {});
    assert.deepEqual(paths(fromFrontMatter.issues), ["launch_options"]);
  });

  it("rejects the whole document on a syntax error", async () => {
    const { config, issues } = await parse("theme: [unclosed");

    assert.deepEqual(config, {});
    assert.deepEqual(paths(issues), [""]);
  });

  it("rejects non-core tags and aliases", async () => {
    const { config, issues } = await parse(`
metadata: !!set {a: null}
title_base: &t Hello
document_title: *t
print_urls: true
`);

    assert.deepEqual(config, { print_urls: true });
    assert.ok(issues.some(({ path }) => path === "metadata"));
    assert.ok(issues.some(({ path }) => path === "document_title"));
  });

  it("rejects a font preset that is only a prototype key", async () => {
    const { config, issues } = await parse("fonts: toString");

    assert.deepEqual(config, {});
    assert.deepEqual(paths(issues), ["fonts"]);
  });

  it("returns nothing for an empty document", async () => {
    assert.deepEqual(await parse(""), {
      config: {},
      issues: [],
      dependencies: [],
    });
  });
});

describe("splitFrontMatter", () => {
  it("separates the YAML from the body", () => {
    assert.deepEqual(splitFrontMatter("---\ntheme: tufte\n---\n# Hi\n"), {
      yaml: "theme: tufte",
      content: "# Hi\n",
    });
  });

  it("leaves a document without front matter alone", () => {
    assert.deepEqual(splitFrontMatter("# Hi\n"), {
      yaml: undefined,
      content: "# Hi\n",
    });
  });
});
