---
pdf_options:
  displayHeaderFooter: true
  headerTemplate: |
    <html>
    <head>
      <style>
        #header { padding: 0 !important; }
        .container {
          width: 100%;
          padding: 10px 20px;
          font-family: Georgia, serif;
          font-size: 10px;
          color: #666;
          display: flex;
          justify-content: space-between;
          border-bottom: 1px solid #ddd;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <span>Custom Header Template</span>
        <span class="title"></span>
      </div>
    </body>
    </html>
  footerTemplate: |
    <html>
    <head>
      <style>
        #footer { padding: 0 !important; }
        .container {
          width: 100%;
          padding: 10px 20px;
          font-family: Georgia, serif;
          font-size: 10px;
          color: #666;
          display: flex;
          justify-content: space-between;
          border-top: 1px solid #ddd;
        }
        .page-info { font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <span class="date"></span>
        <span class="page-info">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    </body>
    </html>
  margin:
    top: 25mm
    bottom: 25mm
---

# Inline HTML Templates

This example embeds raw HTML templates directly in the frontmatter for full control over headers and footers. For larger templates, see example 17 which loads HTML from external files.

## When to Use This

Use `pdf_options.headerTemplate` and `pdf_options.footerTemplate` when you need:

- Complex HTML structures
- Custom borders or decorations
- Precise positioning control
- Anything the simplified `header`/`footer` config can't do

## Template Format

Templates are full HTML documents with inline styles:

```html
<html>
<head>
  <style>
    #header { padding: 0 !important; }
    .my-header { /* your styles */ }
  </style>
</head>
<body>
  <div class="my-header">Content here</div>
</body>
</html>
```

## Special Classes

Puppeteer replaces these with actual values:

| Class | Description |
|-------|-------------|
| `pageNumber` | Current page number |
| `totalPages` | Total page count |
| `date` | Current date |
| `title` | Document title |
| `url` | Document URL |

Example: `<span class="pageNumber"></span>`

## Important Notes

- Templates must include `#header { padding: 0 !important; }` or `#footer { padding: 0 !important; }` to remove Puppeteer's default padding
- Set adequate margins in `pdf_options.margin` to make room for headers/footers
- Use `-webkit-print-color-adjust: exact` for background colors
