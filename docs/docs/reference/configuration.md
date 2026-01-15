# Configuration Reference

## Configuration Sources

Options can be set via:

1. **Config file** - `--config-file config.yaml`
2. **Front-matter** - YAML at the top of the markdown file

Front-matter overrides config file. Paths in config files are resolved relative to the config file location.

## All Options

```yaml
theme: beryl              # beryl, tufte, buttondown, pandoc (or false)
stylesheet: ""            # CSS file path
document_title: ""        # auto-detected from first heading
code_block_style: github  # highlight.js theme
print_urls: false         # append URLs after links

pdf_options:
  printBackground: true
  format: A4
  margin:
    top: 20mm
    right: 20mm
    bottom: 20mm
    left: 20mm

toc_options:
  skip_first_h1: false
  maxdepth: 6

header:
  left: ""
  center: ""
  right: ""

footer:
  left: ""
  center: ""
  right: ""

metadata:
  title: ""
  author: ""
  subject: ""
  keywords: []

fonts: beryl
# or:
# fonts:
#   heading: ""
#   body: ""
#   mono: ""

font_scale: 1
templates: {}

page_numbers:
  format: arabic
  start: 1

heading_numbers: false
# or:
# heading_numbers:
#   format: arabic
#   start_depth: 2
#   max_depth: 6
#   separator: "."
#   skip_first_h1: true
```

## Option Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `theme` | `string \| false` | `"beryl"` | Built-in theme or `false` to disable |
| `stylesheet` | `string` | auto | CSS file path |
| `document_title` | `string` | auto | PDF title |
| `code_block_style` | `string` | `"github"` | highlight.js theme |
| `print_urls` | `boolean` | `false` | Append URLs after links |
| `pdf_options` | `object` | see above | Puppeteer PDF options |
| `toc_options` | `object` | see above | Table of contents options |
| `header` | `string \| object` | - | Header config |
| `footer` | `string \| object` | - | Footer config |
| `metadata` | `object` | - | PDF metadata |
| `fonts` | `string \| object` | - | Font preset or custom fonts |
| `font_scale` | `number` | `1` | Scale factor for font sizes |
| `templates` | `object` | - | Named templates for @include |
| `page_numbers` | `object` | - | Page number format |
| `heading_numbers` | `object` | - | Heading numbering options |

## PDF Options

Pass-through to [Puppeteer's page.pdf()](https://pptr.dev/api/puppeteer.pdfoptions):

```yaml
pdf_options:
  format: A4              # or: Letter, Legal, Tabloid, A3, A5
  landscape: false
  printBackground: true
  scale: 1                # 0.1 to 2
  margin:
    top: 20mm
    right: 20mm
    bottom: 20mm
    left: 20mm
  pageRanges: "1-5"       # print specific pages
```

### Margin Shortcuts

```yaml
margin: "20mm"                    # all sides
margin: "20mm 15mm"               # vertical, horizontal
margin: "20mm 15mm 25mm 15mm"     # top, right, bottom, left
```

## PDF Metadata

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

## Page Number Formats

```yaml
page_numbers:
  format: roman      # arabic, roman, roman-upper, alpha, alpha-upper
  start: 1
```

## Heading Numbers

```yaml
heading_numbers:
  format: arabic      # Number format
  start_depth: 2      # Start at h2
  max_depth: 4        # Stop at h4
  separator: "."      # Between levels
  skip_first_h1: true # Skip first h1
```
