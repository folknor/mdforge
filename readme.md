# Markdown to PDF

This is a fork of https://github.com/ehrktia/md-to-pdf and https://github.com/simonhaenisch/md-to-pdf

**A simple and hackable CLI tool for converting markdown to pdf**. It uses [Marked](https://github.com/markedjs/marked) to convert `markdown` to `html` and [Puppeteer](https://github.com/GoogleChrome/puppeteer) (headless Chromium) to further convert the `html` to `pdf`. It also uses [highlight.js](https://github.com/isagalaev/highlight.js) for code highlighting. The whole source code of this tool is ~only \~250 lines of JS~ ~500 lines of Typescript and ~100 lines of CSS, so it is easy to clone and customize.

**Highlights:**

- Concurrently convert multiple Markdown files
- Watch mode
- Use your own or remote stylesheets/scripts
- Front-matter for configuration
- Headers and Footers
- Page Breaks
- Syntax highlighting in code blocks
- Extend the options of the underlying tools
- Programmatic API
- Supports `stdio`
- Convert HTML (or [inline HTML](https://daringfireball.net/projects/markdown/syntax#html)) to PDF
