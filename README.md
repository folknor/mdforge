# mdforge

Convert Markdown to beautifully styled PDFs.

## Install

```bash
npm install -g mdforge
```

## Usage

```bash
mdforge document.md
mdforge document.md -o output.pdf
mdforge *.md
```

## Quick Start

Add front-matter to your markdown:

```markdown
---
theme: tufte
footer: "Page {page} of {pages}"
---

# My Document

<!-- toc -->

## Introduction

Content here...
```

## Themes

Built-in: `beryl` (default), `tufte`, `buttondown`, `pandoc`

## Example Configs

**Academic paper:**

```yaml
---
theme: tufte
header:
  left: "{title}"
  right: "{date}"
footer:
  center: "{page}"
pdf_options:
  format: A4
  margin: 25mm
---
```

**Technical documentation:**

```yaml
---
theme: pandoc
toc_options:
  maxdepth: 3
footer: "Page {page} of {pages}"
pdf_options:
  format: Letter
---
```

## Documentation

Full documentation: **[folknor.github.io/mdforge](https://folknor.github.io/mdforge/)**

- [Configuration Reference](https://folknor.github.io/mdforge/reference/configuration/)
- [Headers & Footers](https://folknor.github.io/mdforge/guides/headers-footers/)
- [Fonts](https://folknor.github.io/mdforge/guides/fonts/)
- [Themes & Styling](https://folknor.github.io/mdforge/guides/themes/)

## License

MIT
