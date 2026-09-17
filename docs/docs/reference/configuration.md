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
  style: bullet
  page_numbers: false
  page_label: ""
  page_separator: " — "
  # table_headers: ["", ""]

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
| `constants` | `object` | - | Named values for `{{ ... }}` placeholders |
| `constants_locale` | `string` | - | Locale for grouping numeric results |
| `constants_precision` | `number` | `2` | Maximum fraction digits in a result |

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

## Table of Contents

Insert `<!-- toc -->` in the document where the contents list should go.

```yaml
toc_options:
  skip_first_h1: false    # Skip the first h1 (usually the document title)
  maxdepth: 6             # Deepest heading level to include
  style: table            # bullet (default), ordered, or table
  page_numbers: true      # Resolve the printed page of each heading
  page_label: "Side "     # Text before the page number
  page_separator: " — "   # Between title and page (bullet/ordered only)
  table_headers: ["", ""] # Header cells for the table style
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `skip_first_h1` | `boolean` | `false` | Leave the first h1 out of the list |
| `maxdepth` | `number` | `6` | Deepest heading level included |
| `style` | `string` | `"bullet"` | `bullet`, `ordered` or `table` |
| `page_numbers` | `boolean` | `false` | Append each heading's printed page |
| `page_label` | `string` | `""` | Text before the page number, e.g. `"Side "` |
| `page_separator` | `string` | `" — "` | Title/page separator in list styles |
| `table_headers` | `[string, string]` | `["", ""]` | Header cells for `style: table` |

Page numbers use the same machinery as `@pageof(...)`: the PDF is rendered,
its outline is read back, and the real numbers are filled in on a second pass.
They are therefore only available when producing a PDF, not with `--as-html`.

When `heading_numbers` is enabled, contents entries carry the same numbers as
the rendered headings.

## Heading Numbers

```yaml
heading_numbers:
  format: arabic      # Number format
  start_depth: 2      # Start at h2
  max_depth: 4        # Stop at h4
  separator: "."      # Between levels
  skip_first_h1: true # Skip first h1
```

Prose can refer to a generated number with `@numberof(Heading Text)`, which
prints it bare (`8.1`) and follows the heading if the document is renumbered.
Unresolvable references are left in the output verbatim. See
[Cross-References](../guides/includes.md#heading-numbers).
