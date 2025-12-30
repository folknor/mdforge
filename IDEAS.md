# Future Ideas

Potential improvements and features to explore.

## High-Value Additions

### Document Merging
Combine multiple markdown files into a single PDF output.
```bash
md-to-pdf --merge chapter1.md chapter2.md -o book.pdf
```

### Math Support
KaTeX or MathJax rendering for equations using standard `$x^2$` inline and `$$` block syntax.

### Mermaid Diagrams
Render flowcharts, sequence diagrams, and other diagrams from fenced code blocks marked as `mermaid`.

### Include Directive
Compose documents from multiple files:
```markdown
<!-- include: introduction.md -->
<!-- include: chapters/chapter1.md -->
```

## Quality of Life

### Watch Mode
Re-add `--watch` flag for iterative editing workflows. Automatically regenerate PDF when source files change.

### stdin Support
Read markdown from standard input for piping workflows:
```bash
echo "# Hello" | md-to-pdf -o out.pdf
cat README.md | md-to-pdf --as-html
```

### Dry Run
`--dry-run` flag to preview config resolution and output paths without generating files.

### Debug Mode
`--debug` flag to save intermediate HTML, show timing information, and aid troubleshooting.

## PDF-Specific

### PDF Metadata
Set document properties embedded in the PDF:
- Author
- Title
- Subject
- Keywords
- Creation date

### Cover Page
First-class support for title pages, potentially with a separate template or special front-matter syntax.

### Watermarks
Overlay text like "DRAFT" or "CONFIDENTIAL" across pages.

### PDF/A Compliance
Generate archival-quality PDFs for legal, compliance, or long-term storage use cases.

### Presets
Built-in configuration presets for common scenarios:
```bash
md-to-pdf --preset print document.md
md-to-pdf --preset ebook document.md
md-to-pdf --preset presentation slides.md
```

## Advanced

### Templating / Variables
Simple variable substitution in markdown:
```markdown
---
variables:
  version: 1.2.0
  date: 2024-01-15
---
Document version: {{version}}
Generated: {{date}}
```

### Link Validation
Warn on broken internal anchors and optionally check external URLs.

### Hooks / Plugins
Custom transformation points in the pipeline:
- Pre-markdown (raw text manipulation)
- Post-HTML (DOM manipulation before PDF generation)

### Image Optimization
Compress and optimize images before embedding to reduce PDF file size.

## Header/Footer Improvements

Current simplified header/footer uses paged.js with some limitations:

### Configurable Page Size
`paged-css.ts` hardcodes `size: A4`. Should read from `pdf_options.format`.

### Configurable Margins
Margins are hardcoded at `25mm 20mm`. Should respect `pdf_options.margin` when using simplified headers.

### Markdown in Headers/Footers
CSS `content` property can't render HTML, so markdown is stripped to plain text. Could potentially support bold/italic via Unicode mathematical symbols or webfonts.

### ~~Local paged.js~~ ✓
~~Currently loads from unpkg CDN. Could bundle locally for offline use.~~ Done - now bundled locally.

---

## Historical Note

Previously had a Puppeteer-native mode for simplified headers that converted `header`/`footer` to `headerTemplate`/`footerTemplate`. Removed because `{chapter}` variable was impossible (Puppeteer has no class for running chapter titles) and no support for `firstPageHeader`/`firstPageFooter`. Old implementation was in `src/lib/header-footer.ts`.
