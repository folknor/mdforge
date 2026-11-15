# Headers and Footers

## Simple Footer

```yaml
footer: "Page {page} of {pages}"
```

Creates a centered footer.

## Three-Column Layout

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

## Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{page}` | Current page number | 5 |
| `{pages}` | Total page count | 12 |
| `{title}` | Document title (the first `#` or `##` heading's text, as written) | My Document |
| `{date}` | Current date (default locale) | December 30, 2024 |
| `{date:locale}` | Date with specific locale | 30. desember 2024 |

Any other text, quotes, backslashes and HTML markup included, is shown as
written, with or without a background image.

### Localized Dates

```yaml
header:
  left: "{date:nb-NO}"    # Norwegian: "30. desember 2024"
  right: "{date:en-US}"   # US English: "December 30, 2024"
```

Common locales: `en-US`, `en-GB`, `nb-NO`, `de-DE`, `fr-FR`, `es-ES`, `ja-JP`, `zh-CN`

## Images

```yaml
header:
  left: logo.png
  right: "Page {page}"
footer:
  right: logo.svg 60%   # Scale to 60% (100% = 60px)
```

Images are embedded as base64 data URIs. Supported: PNG, JPG, GIF, SVG, WebP.

## Background Images

For branded headers/footers with full-width background images:

```yaml
header:
  background: "header-bg.svg"
  right: "Page {page}/{pages}"
footer:
  background: "footer-bg.svg"
```

## Skip First Page

Hide headers/footers on the first page (e.g., for a title page):

```yaml
header:
  center: "{title}"
  firstPage: false
footer:
  center: "Page {page}"
  firstPage: false
```

## Styling with CSS

Text-only headers and footers are drawn in the page's margin boxes. Element
selectors such as `.header-left` cannot reach them; style them with `@page`
margin rules in your stylesheet instead:

```css
@page {
  @top-left {
    color: #dc2626;
  }
}
```

The margin boxes are `@top-left`, `@top-center`, `@top-right`,
`@bottom-left`, `@bottom-center` and `@bottom-right`. Your stylesheets come
after the generated header/footer rules, so your declarations (including
`@page { margin: ... }`) override the defaults. A column that is entirely
`**bold**` or `*italic*` is shown bold or italic; emphasis markers around only
part of a column are dropped and the text shown plain.

When the header or footer has a background image, both are rendered as
Chromium header/footer templates instead (`@page` cannot paint a background
image). Their columns mean the same as above, but these `@page` rules,
`firstPage: false` and `page_numbers` formats do not apply to them.
