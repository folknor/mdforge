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

# Pipe from stdin
cat document.md | mdforge > output.pdf
```

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
