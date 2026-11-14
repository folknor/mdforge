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

# Pipe from stdin
cat document.md | mdforge > output.pdf
```

## Watch mode

`--watch` renders once, then re-renders whenever an input changes. Alongside the
Markdown itself it watches the stylesheet the document resolved to and the
`--config-file`, so a theme edit retriggers the render too. The browser stays open
between runs, which makes each re-render considerably faster than a cold start.

Saves are debounced, so the burst of writes an editor makes on save produces a
single render. Press ctrl-c to stop.

## Programmatic API

```typescript
import { mdToPdf } from "mdforge";

// From file
const result = await mdToPdf({ path: "document.md" });

// From string
const result = await mdToPdf(
  { content: "# Hello\n\nWorld" },
  { theme: "tufte", pdf_options: { format: "Letter" } }
);

// result.content is Buffer (PDF) or string (HTML)
// result.filename is the output path
```

The API also supports `marked_extensions` for custom [Marked extensions](https://marked.js.org/using_pro#extensions).
