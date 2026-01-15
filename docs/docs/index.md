# mdforge

Convert Markdown to beautifully styled PDFs.

## Features

- **Themes** - Built-in themes (beryl, tufte, buttondown, pandoc) or use your own CSS
- **Custom Fonts** - Google Fonts integration with curated presets
- **Headers & Footers** - Three-column layouts with page numbers, dates, and images
- **Table of Contents** - Auto-generated from headings with PDF bookmarks
- **Icons** - 200,000+ icons from Iconify
- **Includes** - Modular documents with `@include` and named templates
- **Cross-References** - Link to headings with `@see`
- **Form Fields** - Create printable forms

## Quick Example

```bash
mdforge document.md
```

```yaml
---
theme: tufte
header:
  left: "{title}"
  right: "{date}"
footer:
  center: "Page {page}/{pages}"
---

# My Document

Content here...
```

[Get Started](getting-started/index.md){ .md-button .md-button--primary }
