# Configuration Reference

## Configuration Sources

Options can be set via:

1. **Config file** - `--config-file config.yaml`
2. **Front-matter** - YAML at the top of the markdown file

Front-matter overrides config file. Relative `stylesheet` paths and `@file`
references resolve against the directory of the file they are written in (the
config file or the markdown document). Other paths (`templates`, `script`
paths) are taken as they are. Relative links, images and includes in the
document resolve against the document's own directory; neither source can
change that.

Neither source chooses where the output goes or whether it is PDF or HTML:
that is up to whoever runs the conversion (`-o` and `--as-html` on the
[CLI](cli.md)), so a document cannot redirect or reshape it. `pdf_options.path`
is not accepted for the same reason.

### Invalid values

Both sources are parsed against the options below. An unknown option, or a
value of the wrong type, is reported as a warning and ignored; the rest of the
document still applies. A YAML syntax error ignores the whole block. YAML
aliases (`*name`) and tags outside YAML 1.2's core schema (`!!set`,
`!!binary`, custom tags) are not supported.

### File references

A free-text value written as `"@path"` is replaced by the contents of that
file: `header`/`footer` text, `pdf_options.headerTemplate` and
`footerTemplate`, `metadata`, `toc_options` labels, `constants` strings and
`script` content. In `stylesheet`, `"@path"` names a CSS file instead (see
below). Names, enums and paths (`theme`, `format`, `templates`,
...) are taken literally.

### Stylesheet entries

Each `stylesheet` entry is a file, a URL or CSS, decided as follows:

- `"@path"`: a CSS file, whatever it contains (a single `@import url(...)`
  line included). A missing or unreadable file is reported against the
  option.
- A value starting with `http://` or `https://`: a URL the page loads.
- A value containing `{` or a line break: inline CSS.
- Anything else: a CSS file path.

CSS that itself starts with `@` cannot be written inline (it would be taken as
a file reference); put it in a file and use `"@path"`.

A stylesheet file or URL is loaded by the page from where it lives, so
relative `url(...)` and `@import` references inside it resolve against the
stylesheet's own location. Relative references in inline CSS resolve against
the document's directory.

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
| `stylesheet` | `string \| string[]` | auto | CSS file path(s), URLs or CSS, applied in order (see above) |
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
| `heading_numbers` | `object \| false` | - | Heading numbering options |
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

`pdf_options.margin` also takes CSS shorthand:

```yaml
pdf_options:
  margin: "20mm"                  # all sides
  # margin: "20mm 15mm"           # vertical, horizontal
  # margin: "20mm 15mm 25mm"      # top, horizontal, bottom
  # margin: "20mm 15mm 25mm 15mm" # top, right, bottom, left
```

## Browser Launch Options

`launch_options` is read from the config file only (one browser serves every
document in a run, so front matter cannot change it). The supported keys are
Puppeteer launch options that YAML can express: `executablePath`, `browser`,
`channel`, `headless`, `args`, `ignoreDefaultArgs`, `enableExtensions`,
`userDataDir`, `env`, `timeout`, `protocolTimeout`, `slowMo`, `dumpio`, `pipe`,
`devtools`, `debuggingPort`, `acceptInsecureCerts`, `waitForInitialPage`,
`handleSIGINT`, `handleSIGTERM` and `handleSIGHUP`.

```yaml
launch_options:
  executablePath: /usr/bin/chromium
  args: ["--no-sandbox"]
```

## Icon Server

`iconify_api` names the [Iconify](https://iconify.design/) server icons are
fetched from (default `https://api.iconify.design`), for self-hosted or
air-gapped deployments. It is read from the config file only: a document cannot
choose which host the converter contacts. The value must be an `http` or
`https` base URL without credentials, query or fragment; a trailing slash makes
no difference (`/icons` and `/icons/` are the same server). Fetched icons are
cached in `~/.cache/mdforge/iconify/`, separately for each server.

```yaml
iconify_api: https://icons.internal.example/
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

Insert `<!-- toc -->` on a line of its own, outside any list, quote or code
block, where the contents list should go. Anything between it and a later
`<!-- tocstop -->` line is replaced. The contents list every document-level
heading after the marker; headings inside quotes, lists or admonitions keep
their own anchors and numbers but are not listed. Entries link to exactly the
anchors the headings render with, and show the heading's formatting without
its links, footnote references or raw HTML. `page_label`, `page_separator` and
`table_headers` are plain text.

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
the page each heading landed on is read back, and the real numbers are filled in on a second pass.
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
