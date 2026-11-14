# CLI Reference

## Usage

```bash
mdforge [options] <files...>
```

## Options

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help |
| `-v, --version` | Show version |
| `-o, --output <path>` | Output file path (single file only) |
| `--as-html` | Output HTML instead of PDF |
| `--fillable` | Generate fillable PDF form fields (overrides the document's `fillable`) |
| `--config-file <path>` | Path to YAML configuration file |
| `-w, --watch` | Re-render when an input file or its stylesheet changes |

## Examples

```bash
# Single file
mdforge document.md

# Multiple files
mdforge file1.md file2.md file3.md
mdforge *.md

# Custom output path
mdforge document.md -o output.pdf

# With config file
mdforge document.md --config-file config.yaml

# Output HTML for debugging
mdforge --as-html document.md

# Re-render on every save (ctrl-c to stop)
mdforge --watch document.md
```

The output path and format are chosen only here: neither a config file nor a
document's front matter can set them. Without `-o`, each input is written
beside itself with a `.pdf` (or `.html`) extension.

## Watch mode

`--watch` renders once, then re-renders whenever an input changes. Alongside the
Markdown itself it watches the document's stylesheet paths, the files its front
matter references with `@file`, the `--config-file` and the files that
references, so a theme edit retriggers the render too. A watched file that does
not exist yet is watched for: creating it (or the directory it belongs in)
triggers a render. For a document that relies on the automatic stylesheet,
creating `<name>.css` triggers a render, and so does creating `index.css` while
`<name>.css` does not exist. Files pulled in with `@include` and images are not
watched. Files a render that fails never got to report are not watched until a
render succeeds, and a file created while a render is still running may be
missed. The browser stays open between runs, which makes each
re-render considerably faster than a cold start.

Saves are debounced, so the burst of writes an editor makes on save produces a
single render. Press ctrl-c to stop.

## Programmatic API

```typescript
import { convertMdToPdf, defaultConfig } from "@mdforge/renderer-puppeteer";

// From file: writes document.pdf beside it
const result = await convertMdToPdf({ path: "document.md" }, defaultConfig);

// From string, to memory only
const html = await convertMdToPdf(
  { content: "# Hello\n\nWorld" },
  { ...defaultConfig, theme: "tufte" },
  { format: "html", output: { kind: "none" } },
);

// result.content is a Buffer (PDF) or string (HTML)
// result.filename is the file written, if the output was a file
```

The third argument holds the invocation's choices, which front matter cannot
override:

- `format`: `"pdf"` (default) or `"html"`.
- `output`: `{ kind: "file", path }`, `{ kind: "stdout" }` or `{ kind: "none" }`.
  Default: a file beside a path input, stdout for content input.
- `fillable`: overrides the document's `fillable` when set.

`pdf_options` takes Puppeteer's PDF options except `path`; mdforge writes the
output itself. The API also supports `marked_extensions` for custom [Marked extensions](https://marked.js.org/using_pro#extensions).
