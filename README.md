# mdforge

Convert Markdown to beautifully styled PDFs.

Originally forked from [simonhaenisch/md-to-pdf](https://github.com/simonhaenisch/md-to-pdf).

## Install

```bash
npm install -g mdforge
```

## Usage

```bash
mdforge document.md
mdforge document.md --config-file config.yaml
mdforge document.md -o output.pdf
mdforge *.md                              # multiple files
mdforge --as-html document.md             # output HTML instead
cat document.md | mdforge > output.pdf    # stdio
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
stylesheet: custom.css
footer: "Page {page} of {pages}"
pdf_options:
  format: Letter
```

Paths are resolved relative to the config file location.

### Front-matter

All config options can be set directly in the markdown file's front-matter:

```markdown
---
theme: tufte
stylesheet: custom.css
header:
  left: "{title}"
  right: "{date}"
footer:
  center: Page {page}/{pages}
pdf_options:
  format: Letter
  margin: 25mm
---

# Document Title

Content here.
```

Front-matter can completely replace a config file—both methods produce the same result.

## All Defaults

```yaml
theme: beryl              # beryl, tufte, buttondown, pandoc (or false to disable)
stylesheet: ""            # CSS file path (auto-detected if not specified)
document_title: ""        # auto-detected from first heading if not specified
code_block_style: github  # see https://highlightjs.org/examples
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
metadata: null            # { title, author, subject, keywords, creator, producer }
fonts: null               # { heading, body } - any Google Font name
font_pairing: null        # modern-professional, classic-elegant, etc.
templates: null           # { name: "path/to/template.md" }
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `theme` | `string \| false` | `"beryl"` | Built-in theme or `false` to disable |
| `stylesheet` | `string` | auto | CSS file path (auto-detects `{basename}.css` or `index.css`) |
| `document_title` | `string` | auto | PDF title (auto-detected from first heading) |
| `code_block_style` | `string` | `"github"` | [highlight.js theme](https://highlightjs.org/examples) |
| `print_urls` | `boolean` | `false` | Append URLs after links when printed |
| `pdf_options` | `object` | see below | Puppeteer PDF options |
| `toc_options` | `object` | see below | Table of contents options |
| `header` | `string \| object` | - | Header config (see Headers section) |
| `footer` | `string \| object` | - | Footer config (see Footers section) |
| `metadata` | `object` | - | PDF metadata (author, title, subject, keywords) |
| `fonts` | `object` | - | Custom fonts (heading, body) from Google Fonts |
| `font_pairing` | `string` | - | Named font pairing preset |
| `templates` | `object` | - | Named templates for @template directive |

## Stylesheets

If no stylesheet is specified, mdforge auto-detects a CSS file in the same directory as the markdown file:

1. First looks for `{basename}.css` (e.g., `document.css` for `document.md`)
2. Falls back to `index.css`

To use a custom stylesheet:

```yaml
stylesheet: custom.css
```

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
  left: logo.png
  right: "Page {page}"
footer:
  right: logo.svg 60%   # Scale to 60% (100% ≈ 60px)
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

### Styling with CSS

Use simple selectors to style header/footer positions:

```css
.header-left { color: red; }
.footer-center { font-style: italic; }
```

Available selectors: `.header-left`, `.header-center`, `.header-right`, `.footer-left`, `.footer-center`, `.footer-right`

## Includes and Templates

Include markdown files directly in your documents.

### @include Directive

Include content from another markdown file:

```markdown
@include ./shared/header.md
@include /absolute/path/to/disclaimer.md
@include "path with spaces/file.md"
```

Paths can be:
- Relative: `./shared/header.md`
- Absolute: `/home/user/templates/footer.md`
- Quoted (for paths with spaces): `"My Templates/header.md"`

Includes can be nested (included files can include other files).

### @template Directive

Define reusable templates in config and use them by name:

```yaml
templates:
  legal-footer: "/path/to/legal-footer.md"
  company-header: "/path/to/company-header.md"
```

Then in markdown:

```markdown
# Document Title

@template company-header

Content here...

@template legal-footer
```

Templates are resolved from the paths specified in config, while `@include` resolves relative to the current file.

## Icons

Use icons from [Iconify](https://iconify.design/) (200,000+ icons from 150+ icon sets).

### Basic Usage

```markdown
Home: :icon[mdi:home]
Settings: :icon[mdi:cog]
Star: :icon[ph:star-fill]
```

Format: `:icon[prefix:name]` where `prefix` is the icon set (e.g., `mdi`, `ph`, `lucide`) and `name` is the icon name.

### With Size

```markdown
Small: :icon[mdi:star]{size=16}
Medium: :icon[mdi:star]{size=24}
Large: :icon[mdi:star]{size=48}
```

### Inline in Text

```markdown
Click :icon[mdi:home]{size=16} to go home.
```

Icons are fetched from the Iconify API and cached locally in `~/.cache/mdforge/icons/`.

Browse available icons at [icon-sets.iconify.design](https://icon-sets.iconify.design/).

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

PDF bookmarks are automatically generated from headings, allowing navigation via the PDF viewer's bookmark panel.

## Fonts

Load custom fonts from Google Fonts for headings and body text.

### Font Pairings

Use a preset font pairing:

```yaml
font_pairing: classic-elegant
```

Available pairings:

| Pairing | Heading | Body |
|---------|---------|------|
| `modern-professional` | Inter | Inter |
| `classic-elegant` | Playfair Display | Libre Baskerville |
| `modern-geometric` | Poppins | Open Sans |
| `tech-minimal` | Space Grotesk | DM Sans |
| `editorial` | Cormorant Garamond | Libre Baskerville |
| `clean-sans` | DM Sans | Inter |

### Custom Fonts

Specify any Google Font by name:

```yaml
fonts:
  heading: "Playfair Display"
  body: "Inter"
```

You can specify just one:

```yaml
fonts:
  heading: "Poppins"  # Uses theme default for body
```

Fonts are loaded via Google Fonts and set as CSS variables (`--font-heading`, `--font-body`).

## PDF Metadata

Set PDF document properties (visible in PDF viewer info panels):

```yaml
metadata:
  title: "My Document"        # defaults to first h1
  author: "John Doe"
  subject: "Technical Report"
  keywords:
    - markdown
    - pdf
    - documentation
```

Available metadata fields:

| Field | Description |
|-------|-------------|
| `title` | Document title (auto-detected from first h1 if not set) |
| `author` | Document author |
| `subject` | Document subject/description |
| `keywords` | Array of keywords for search indexing |
| `creator` | Application that created the document (default: "mdforge") |
| `producer` | PDF producer (usually set by pdf-lib) |

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
mdforge --as-html document.md
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
stylesheet: brand.css
header:
  background: header.svg
  right: Page {page}/{pages}
footer:
  background: footer.svg
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
