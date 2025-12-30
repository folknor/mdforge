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
md-to-pdf *.md                              # multiple files
md-to-pdf document.md --watch               # watch mode
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
1. YAML config file (`--config-file`)
2. Front-matter in markdown file
3. CLI arguments

### Config file

All defaults:

```yaml
theme: beryl
stylesheet: []
print_urls: false
document_title: ""      # auto-detected from first heading if not specified
page_media_type: screen # or "print" for @media print rules
highlight_style: github # see https://highlightjs.org/demo
marked_options:
  gfm: true             # GitHub Flavored Markdown
  breaks: false         # convert \n to <br>
  pedantic: false       # conform to original markdown.pl
  silent: false         # suppress error output
# always enabled: smartypants, heading IDs (github-slugger)
pdf_options:
  printBackground: true
  format: A4
  margin:
    top: 20mm
    right: 20mm
    bottom: 20mm
    left: 20mm
launch_options: {}      # Puppeteer browser launch options
```

Example with custom settings:

```yaml
theme: tufte
stylesheet:
  - custom.css
print_urls: true
body_class:
  - my-class
pdf_options:
  headerTemplate: "@header.html"
  footerTemplate: "@footer.html"
  displayHeaderFooter: true
marked_options:
  gfm: true
  breaks: true
```

Use `@filename` to reference external files for templates.

### Front-matter

```markdown
---
theme: pandoc
stylesheet: custom.css
---

# Document Title

Content here.
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `theme` | string\|false | `"beryl"` | Built-in theme name or false |
| `stylesheet` | string\|string[] | `[]` | Additional CSS files |
| `print_urls` | boolean | `false` | Show URLs after links in print |
| `document_title` | string | auto | PDF title (defaults to first heading) |
| `body_class` | string\|string[] | `[]` | Classes to add to body |
| `basedir` | string | cwd | Base directory for relative paths |
| `dest` | string | - | Output file path |
| `pdf_options` | object | - | Puppeteer PDF options |
| `launch_options` | object | - | Puppeteer launch options |
| `highlight_style` | string | `"github"` | highlight.js theme |
| `marked_options` | object | - | Marked parser options |
| `html` | boolean | `false` | Treat input as HTML |
| `devtools` | boolean | `false` | Open devtools |

### PDF Options

Pass-through to [Puppeteer's page.pdf()](https://pptr.dev/api/puppeteer.pdfoptions):

```yaml
pdf_options:
  format: A4
  landscape: false
  printBackground: true
  margin:
    top: 20mm
    right: 20mm
    bottom: 20mm
    left: 20mm
```

### Headers and Footers

There are two ways to add headers and footers:

1. **Simplified config** (recommended) - use `header` and `footer` options
2. **Raw HTML templates** - use `pdf_options.headerTemplate` and `pdf_options.footerTemplate`

#### Simplified Headers and Footers

The simplest way to add a footer:

```yaml
footer: "Page {page} of {pages}"
```

This creates a centered footer. For more control, use a three-column layout:

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

You can omit any column (`left`, `center`, `right`) and it will be empty.

#### Variables

Use these placeholders in your header/footer text:

| Variable | Description |
|----------|-------------|
| `{page}` | Current page number |
| `{pages}` | Total page count |
| `{title}` | Document title (from `document_title` config or first heading) |
| `{date}` | Current date (browser's default locale) |
| `{date:locale}` | Current date with specific locale (see below) |
| `{url}` | Document URL |

#### Date Formatting

The `{date}` variable uses the browser's default locale. For specific formatting, use `{date:locale}`:

```yaml
header:
  left: "{date:nb-NO}"    # Norwegian: "30. desember 2024"
  right: "{date:en-US}"   # US English: "December 30, 2024"
footer:
  center: "{date:de-DE}"  # German: "30. Dezember 2024"
```

Common locale codes: `en-US`, `en-GB`, `nb-NO`, `de-DE`, `fr-FR`, `es-ES`, `ja-JP`, `zh-CN`

#### Markdown in Headers/Footers

You can use inline markdown:

```yaml
header:
  left: "**CONFIDENTIAL**"
  center: "*Draft Document*"
  right: "[Company](https://example.com)"
```

Supported: `**bold**`, `*italic*`, `[links](url)`, `` `code` ``

#### Images in Headers/Footers

Use markdown image syntax. Images are automatically embedded as base64 data URIs:

```yaml
header:
  left: "![Company Logo](logo.png)"
  right: "Page {page}"
```

Supported formats: PNG, JPG, GIF, SVG, WebP. Use small images (logos, icons) for best results.

#### File References

Load content from external files using `@filename`:

```yaml
header:
  left: "@company-header.md"
footer:
  center: "@legal-footer.md"
```

The file content is read and processed as markdown.

#### Styling

Headers and footers automatically inherit styling from your theme and custom stylesheets via CSS variables:

- `--font-body` - Font family
- `--font-size` - Base font size (headers/footers use 70% of this)
- `--color-text` - Text color

To customize header/footer appearance, add CSS targeting the `.hf` class:

```css
/* In your custom stylesheet */
.hf {
  font-size: 10px;
  color: #666;
}

.hf.header {
  border-bottom: 1px solid #ccc;
}

.hf.footer {
  border-top: 1px solid #ccc;
}

.hf-left { /* left column */ }
.hf-center { /* center column */ }
.hf-right { /* right column */ }
```

#### Raw HTML Templates (Advanced)

For complete control, use Puppeteer's native template options:

```yaml
pdf_options:
  displayHeaderFooter: true
  headerTemplate: "@header.html"
  footerTemplate: "@footer.html"
```

Your HTML template must be a complete HTML document. Puppeteer provides these CSS classes:

- `pageNumber` - current page number
- `totalPages` - total pages
- `title` - document title
- `date` - current date
- `url` - document URL

Example `footer.html`:

```html
<html>
<head>
  <style>
    .footer {
      font-size: 10px;
      width: 100%;
      padding: 0 20px;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="footer">
    <span>Company Name</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>
</body>
</html>
```

**Important notes for raw templates:**

- Headers/footers render in an isolated context - external stylesheets won't load
- Use inline styles or `<style>` tags
- Images must be embedded as base64 data URIs
- The template is rendered at the page margins, not in the main content area
- `displayHeaderFooter: true` is required (auto-enabled when using simplified config)

#### Precedence

If both simplified (`header`/`footer`) and raw templates (`headerTemplate`/`footerTemplate`) are specified, the raw templates take precedence.

## Page Breaks

```html
<div class="page-break"></div>
```

Or use CSS:

```css
h1 {
  page-break-before: always;
}
```

## Debugging

Use `--as-html` to output HTML instead of PDF:

```bash
md-to-pdf --as-html document.md
```

Generates three files when headers/footers are configured:
- `document.html` - main content
- `document-header.html` - header template
- `document-footer.html` - footer template

Open in browser dev tools to inspect selectors and styling.

## Programmatic API

```typescript
import { mdToPdf } from "md-to-pdf";

const result = await mdToPdf({ path: "document.md" });
// result.content is the PDF buffer
```

## License

MIT
