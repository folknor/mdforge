# Configuration Reference

## Configuration Sources

Options can be set via:

1. **Config file** - `--config-file config.yaml`
2. **Front-matter** - YAML at the top of the markdown file

Front-matter overrides config file. Relative `stylesheet` paths and `@file`
references resolve against the directory of the file they are written in (the
config file or the markdown document). Other paths (`templates`, `script`
`path` entries) are taken as they are. Relative links, images and includes in the
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

Inline CSS goes into the page as a `<style>` element, where `</style`
(followed by a space, `/` or `>`, in any case) ends the element even inside a
CSS string or comment. Inline CSS containing it fails the conversion; write it
as `"<\/style>"` in a CSS string, or put the CSS in a file and use `"@path"`
(files are linked, not inlined, so they may contain anything).

A stylesheet that the page cannot load (a file removed after the conversion
started, an HTTP error, a refused connection), or one whose `@import` cannot
be loaded, is named in a warning and the document is printed without the
styles that did not arrive. This covers the main document's `<link>` and
`<style>` stylesheets, including any a script adds, whose failure is seen by
the time loading ends; stylesheets inside iframes or shadow roots are not
checked.

### Scripts

`script` adds JavaScript to the page in both renderers (CLI and desktop), in
the order given, after the page has loaded and before it is printed. Each
entry has exactly one of:

- `url`: a script the page loads from that URL.
- `path`: a file whose code is added inline (relative paths are taken from
  the working directory). Because it is inline, a module's relative imports
  resolve against the document, not the file. A missing file fails the
  conversion.
- `content`: code (or `"@path"`, see above).

plus optional `type` and `id` attributes for the `<script>` element. An entry
with no source, more than one, or an empty one is reported and ignored, as is
a `url` entry whose `type` is not JavaScript or `module` (the browser would
never fetch it).

The next step waits until a `url` script has loaded (a script that cannot load
fails the conversion) and until inline classic code has run. Inline module
scripts, top-level `await` and anything a script starts asynchronously are not
waited on, and an error thrown by the code itself does not stop the
conversion. A script's remote loads count against the remote content deadline
below. Scripts run once per conversion, before the first print. HTML output is
the page as printed, so it still contains the added `<script>` elements and
whatever they changed. A script whose text would not read back the same when
the HTML file is opened (most often because it contains `</script`, which ends
a script in HTML) fails an HTML conversion rather than producing a file that
does not reopen as rendered; write such text differently, for example
`"<\/script>"` in a string. The same goes for the text of a `<style>` (or
other raw-text element) a script creates, for example one containing
`</style`; rules added through the CSSOM (`insertRule`) are not in the HTML
file at all. Scripts, and anything else in the document, should
not change form fields, page references or layout in reaction to printing
(`beforeprint`/`afterprint`): mdforge reads them from the live page around
printing and prints the page more than once. In fillable PDFs each field's
font and text size are read from the page after printing, where it is laid
out at the screen width, so field styles that depend on the layout width
(width media queries, `vw` units) are not carried over; a field gets the
first font in its font-family stack installed on the system (web fonts are
not used), else Helvetica.

The page is loaded from a temporary file in a private directory of its own,
not from the document's directory; a `<base>` element points relative URLs at
the document's directory. Scripts that build URLs should resolve them against
`document.baseURI`, not `location`, which names the temporary file.

### Remote content

Anything the page itself fetches from `http://` or `https://` (a stylesheet
URL, a remote image, a `url(...)` or `@import` in CSS, an iframe) must load
within 15 seconds, counted once for the whole conversion. Whatever has not
finished by then is left out and named in a warning, and the document is
printed without it; anything the page asks for after loading has ended is left
out the same way. If a stalled resource kept the browser from reading the rest
of the document (a script after a stylesheet that never arrives, for example),
the conversion fails instead of printing a cut-off document. This deadline
bounds how long printing waits; it is not a limit on what the page may
contact.

### Trust

Rendering, including desktop preview and batch conversion, is not a sandbox.
A document's includes and configuration (`@include`, `@file`, stylesheet and
script paths) can put any file the mdforge process can read into the page,
and raw HTML can reference any local path. In the desktop app, page scripts
can additionally read local files directly; the CLI's browser blocks those
direct reads. The page can also contact the network. None of this gives
document scripts Node.js APIs or command execution. Render only documents,
and remote scripts and content they load, that you trust.

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
| `page_media_type` | `string` | `"screen"` | CSS media the page is loaded and printed with: `screen` or `print` |
| `pdf_options` | `object` | see above | How the PDF is printed (see below) |
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
| `script` | `object \| object[]` | - | Scripts added to the page after loading (see above) |

## PDF Options

Both renderers (CLI and desktop) print with the same options, with the
meanings of [Puppeteer's page.pdf()](https://pptr.dev/api/puppeteer.pdfoptions)
for the ones listed here:

```yaml
pdf_options:
  format: A4              # or: Letter, Legal, Tabloid, Ledger, A0-A6
  # width: 210mm          # used only without format
  # height: 297mm
  landscape: false
  printBackground: true
  scale: 1                # 0.1 to 2
  margin:
    top: 20mm
    right: 20mm
    bottom: 20mm
    left: 20mm
  pageRanges: "1-5"       # print specific pages, e.g. "1-5, 8, 11-"
  preferCSSPageSize: false
  displayHeaderFooter: false
  headerTemplate: ""
  footerTemplate: ""
  timeout: 30000          # ms one print may take; 0 = no limit
```

Lengths are a number of CSS pixels or a string with a unit (`px`, `in`, `cm`,
`mm`, `pt`, `pc`). A `format` overrides `width` and `height`. Without these
settings a PDF is Letter-sized with no margins and no backgrounds (the defaults
above are mdforge's own). PDFs are always tagged and carry an outline
(bookmarks).

In a fillable PDF each field is in the tagged structure where its control
was, as a form element, and the printed control is left out of it, so a
field is not read twice. A field is described by its label (a checkbox in a
list by the list's label and its option text, a radio button by its option
text within the group's label), or by its name when it has no label. To keep
the printed controls out, mdforge marks them `aria-hidden` while printing;
document CSS that styles `[aria-hidden]` is not supported. A field that
cannot be created (for example a name used twice) is left out with a
warning. The tagged structure is otherwise Chromium's; mdforge makes no
PDF/UA claim.

Page references (`@pageof`, TOC page numbers) count pages of the whole
document, also when `pageRanges` selects some of them: the numbers are worked
out on the whole document, then the selection is printed and checked against
it, with a warning if it moved.

`timeout` bounds each print, waiting for fonts included; mdforge may print a
document more than once to resolve page references. It does not cover loading
remote content, which has its own limit (see Remote content).

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
document in a run, so front matter cannot change it), and only by the CLI: it
says how the CLI launches its browser, while the desktop app renders with its
own built-in Chromium and launches nothing. The supported keys are
Puppeteer launch options that YAML can express: `executablePath`, `browser`,
`channel`, `headless`, `args`, `ignoreDefaultArgs`, `enableExtensions`,
`userDataDir`, `env`, `timeout`, `protocolTimeout`, `slowMo`, `dumpio`, `pipe`,
`devtools`, `debuggingPort`, `acceptInsecureCerts`, `waitForInitialPage`,
`handleSIGINT`, `handleSIGTERM` and `handleSIGHUP`. The CLI parses the last
three but always launches with them off. It handles those signals itself, so
that stopping waits for the render in progress (see the CLI reference). They
take effect only for a program that passes the parsed settings to its own
`BrowserPool`.

```yaml
launch_options:
  executablePath: /usr/bin/chromium
  args: ["--no-sandbox"]
```

The browser loads each page from a temporary file mdforge writes under its
own temporary directory (`TMPDIR`, else the system default), so it must see
that directory at the same path. A browser confined to a private `/tmp`, such
as a Snap-packaged Chromium, cannot; set mdforge's `TMPDIR` (not
`launch_options.env`) to a directory both can read.

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

Both depths must be integers from 1 to 6, with `start_depth` less than or
equal to `max_depth`. Omitted depths default to 2 and 6 respectively. YAML
with a reversed range reports an issue and drops the entire `heading_numbers`
value.

A level skipped in the document counts as an implicit section 1: an h4
directly under the first h2 is `1.1.1.`, and a following h3 is `1.2.`. The
same holds for sections under a skipped first h1 when `start_depth` is 1, so
the next h1 after them is `2.`.

Prose can refer to a generated number with `@numberof(Heading Text)`, which
prints it bare (`8.1`) and follows the heading if the document is renumbered.
Unresolvable references are left in the output verbatim. See
[Cross-References](../guides/includes.md#heading-numbers).
