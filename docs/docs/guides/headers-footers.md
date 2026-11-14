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
| `{title}` | Document title (from first h1) | My Document |
| `{date}` | Current date (default locale) | December 30, 2024 |
| `{date:locale}` | Date with specific locale | 30. desember 2024 |

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

```css
.header-left { color: red; }
.footer-center { font-style: italic; }
```

Available selectors: `.header-left`, `.header-center`, `.header-right`, `.footer-left`, `.footer-center`, `.footer-right`
