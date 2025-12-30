# md-to-pdf

CLI tool to convert Markdown files to PDF using Puppeteer.

Fork of [simonhaenisch/md-to-pdf](https://github.com/simonhaenisch/md-to-pdf).

## Install

```bash
npm install -g md-to-pdf
```

## Usage

```bash
md-to-pdf document.md
md-to-pdf document.md --config-file config.yaml
md-to-pdf document.md -o output.pdf
md-to-pdf *.md                              # multiple files
md-to-pdf --as-html document.md             # output HTML instead
cat document.md | md-to-pdf > output.pdf    # stdio
```

## Themes

Built-in themes: `beryl` (default), `tufte`, `buttondown`, `pandoc`

```yaml
theme: tufte
```

Set `theme: false` to disable theming.

## Configuration

Options can be set via:
1. YAML config file (`--config-file config.yaml`)
2. Front-matter in markdown file

Later sources override earlier ones. Front-matter overrides config file.

### Config File

```yaml
theme: tufte
stylesheet: "@custom.css"
footer: "Page {page} of {pages}"
pdf_options:
  format: Letter
```

Use `@filename` syntax to load external file contents.

### Front-matter

```markdown
---
theme: pandoc
footer: "Page {page} of {pages}"
---

# Document Title

Content here.
```

## All Defaults

```yaml
theme: beryl              # beryl, tufte, buttondown, pandoc (or false to disable)
stylesheet: ""            # CSS file path or inline CSS
document_title: ""        # auto-detected from first heading if not specified
code_block_style: github  # see https://highlightjs.org/examples
outline: true             # generate PDF bookmarks from headings
print_urls: false         # append URLs after links: [text](url) → "text (url)"

pdf_options:
  printBackground: true
  format: A4
  margin:
    top: 20mm
    right: 20mm
    bottom: 20mm
    left: 20mm

toc_options:
  skip_first_h1: false    # skip first h1 in TOC (usually the document title)
  maxdepth: 6             # maximum heading depth to include (1-6)

header: null
footer: null
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `theme` | `string \| false` | `"beryl"` | Built-in theme or `false` to disable |
| `stylesheet` | `string` | `""` | Additional CSS file or inline CSS |
| `document_title` | `string` | auto | PDF title (auto-detected from first heading) |
| `code_block_style` | `string` | `"github"` | [highlight.js theme](https://highlightjs.org/examples) |
| `outline` | `boolean` | `true` | Generate PDF bookmarks from headings |
| `print_urls` | `boolean` | `false` | Append URLs after links when printed |
| `pdf_options` | `object` | see below | Puppeteer PDF options |
| `toc_options` | `object` | see below | Table of contents options |
| `header` | `string \| object` | - | Header config (see Headers section) |
| `footer` | `string \| object` | - | Footer config (see Footers section) |

## PDF Options

Pass-through to [Puppeteer's page.pdf()](https://pptr.dev/api/puppeteer.pdfoptions):

```yaml
pdf_options:
  format: A4                    # or: Letter, Legal, Tabloid, A3, A5
  landscape: false
  printBackground: true
  scale: 1                      # 0.1 to 2
  margin:
    top: 20mm
    right: 20mm
    bottom: 20mm
    left: 20mm
  pageRanges: "1-5"             # print specific pages
```

### Margin Shortcuts

```yaml
margin: "20mm"                    # all sides
margin: "20mm 15mm"               # vertical, horizontal
margin: "20mm 15mm 25mm 15mm"     # top, right, bottom, left
```

## Headers and Footers

### Simple Footer

```yaml
footer: "Page {page} of {pages}"
```

Creates a centered footer.

### Three-Column Layout

```yaml
header:
  left: "{title}"
  center: ""
  right: "{date}"
footer:
  left: "Company Name"
  center: "Page {page} / {pages}"
  right: "Confidential"
```

### Variables

| Variable | Description | Example Output |
|----------|-------------|----------------|
| `{page}` | Current page number | 5 |
| `{pages}` | Total page count | 12 |
| `{title}` | Document title | My Document |
| `{date}` | Current date (default locale) | December 30, 2024 |
| `{date:locale}` | Date with specific locale | 30. desember 2024 |
| `{url}` | Document URL | file:///path/to/doc.md |

### Localized Dates

```yaml
header:
  left: "{date:nb-NO}"    # Norwegian: "30. desember 2024"
  right: "{date:en-US}"   # US English: "December 30, 2024"
```

Common locales: `en-US`, `en-GB`, `nb-NO`, `de-DE`, `fr-FR`, `es-ES`, `ja-JP`, `zh-CN`

### Images

```yaml
header:
  left: "![Logo](logo.png)"
  right: "Page {page}"
```

Images are embedded as base64 data URIs. Supported: PNG, JPG, GIF, SVG, WebP.

### Background Images

For branded headers/footers with full-width background images:

```yaml
header:
  background: "header-bg.svg"
  right: "Page {page}/{pages}"
footer:
  background: "footer-bg.svg"
```

Background images use `background-size: cover`. Headers anchor to bottom edge, footers to top edge.

### Skip First Page

Hide headers/footers on the first page (e.g., for a title page). Only works with text-only headers/footers (not with background images).

```yaml
header:
  center: "{title}"
  firstPage: false
footer:
  center: "Page {page}"
  firstPage: false
```

## Table of Contents

Add `<!-- toc -->` marker where you want the TOC:

```markdown
# My Document

<!-- toc -->

## Introduction

Content...

## Chapter 1

More content...
```

The TOC is generated from headings and inserted as a markdown list with anchor links.

### TOC Options

```yaml
toc_options:
  skip_first_h1: false    # skip first h1 (usually the document title)
  maxdepth: 6             # maximum heading level (1-6)
```

## Code Highlighting

Syntax highlighting via highlight.js. Set the theme:

```yaml
code_block_style: github
```

See [highlight.js examples](https://highlightjs.org/examples) for available themes: `github`, `monokai`, `vs`, `atom-one-dark`, etc.

## PDF Bookmarks

PDF bookmarks (outline) are automatically generated from headings. Readers can navigate via the PDF viewer's bookmark panel.

```yaml
outline: true     # default
outline: false    # disable bookmarks
```

## Page Breaks

HTML:
```html
<div class="page-break"></div>
```

CSS:
```css
h1 { page-break-before: always; }
.no-break { page-break-inside: avoid; }
```

## Debugging

Output HTML instead of PDF to inspect in browser:

```bash
md-to-pdf --as-html document.md
```

## Programmatic API

```typescript
import { mdToPdf } from "md-to-pdf";

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

## Example Configurations

### Minimal

```yaml
theme: beryl
```

### Academic Paper

```yaml
theme: buttondown
code_block_style: vs
header:
  left: "{title}"
  right: "{date}"
footer:
  center: "{page}"
pdf_options:
  format: A4
  margin: 25mm
```

### Company Report

```yaml
theme: beryl
stylesheet: "@brand.css"
header:
  background: "header.svg"
  right: "Page {page}/{pages}"
footer:
  background: "footer.svg"
firstPageHeader: false
firstPageFooter: false
pdf_options:
  format: A4
```

### Technical Documentation

```yaml
theme: pandoc
code_block_style: monokai
toc_options:
  maxdepth: 3
footer: "Page {page} of {pages}"
pdf_options:
  format: Letter
  margin:
    top: 20mm
    bottom: 25mm
    left: 20mm
    right: 20mm
```

## License

MIT
