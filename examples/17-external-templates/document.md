---
metadata:
  title: Q4 Financial Report
stylesheet: style.css
pdf_options:
  displayHeaderFooter: true
  headerTemplate: "@header.html"
  footerTemplate: "@footer.html"
  margin:
    top: 30mm
    bottom: 25mm
---

# External Header & Footer Templates

This example demonstrates using external HTML files for headers and footers, enabling features not possible with the simple `header` and `footer` options.

## Why Use External Templates?

The simple header/footer settings support text and three-column layouts:

```yaml
# Simple approach
footer: Page {page} of {pages}

# Three-column approach
header:
  left: "{title}"
  right: "{date}"
```

External templates unlock additional capabilities:

<div class="callout">

**External templates enable:**

- Inline SVG logos and icons
- Background colors and gradients
- Custom fonts and precise typography
- Decorative borders and visual elements
- Complex multi-element layouts

</div>

## Configuration

Reference external files using the `@` prefix:

```yaml
pdf_options:
  displayHeaderFooter: true
  headerTemplate: "@header.html"
  footerTemplate: "@footer.html"
  margin:
    top: 30mm
    bottom: 25mm
```

## Template Structure

Each template is a complete HTML document with inline styles:

| File | Purpose |
|------|---------|
| `header.html` | Logo, company name, gradient background |
| `footer.html` | Date, confidentiality badge with icon, styled page numbers |
| `style.css` | Document body styling (separate from header/footer) |

## Important Notes

1. Templates must include `#header { padding: 0 !important; }` or `#footer { padding: 0 !important; }`
2. Use `-webkit-print-color-adjust: exact` for background colors
3. Set adequate margins to make room for header/footer content
4. The `@` prefix resolves paths relative to the document

## Sample Data

| Quarter | Revenue | Growth |
|---------|---------|--------|
| Q1 | $2.4M | +12% |
| Q2 | $2.8M | +17% |
| Q3 | $3.1M | +11% |
| Q4 | $3.6M | +16% |
