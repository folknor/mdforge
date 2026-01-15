# Quick Start

## Basic Usage

Convert a Markdown file to PDF:

```bash
mdforge document.md
```

This creates `document.pdf` in the same directory using the default `beryl` theme.

## Common Options

```bash
# Specify output file
mdforge document.md -o output.pdf

# Use a config file
mdforge document.md --config-file config.yaml

# Convert multiple files
mdforge *.md

# Output HTML instead (for debugging)
mdforge --as-html document.md

# Pipe from stdin
cat document.md | mdforge > output.pdf
```

## Using Front-matter

Add configuration directly in your Markdown file:

```markdown
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

## Using a Config File

Create `config.yaml`:

```yaml
theme: tufte
stylesheet: custom.css
footer: "Page {page} of {pages}"
pdf_options:
  format: Letter
```

Then run:

```bash
mdforge document.md --config-file config.yaml
```

## Add a Table of Contents

Insert `<!-- toc -->` where you want the table of contents:

```markdown
# My Document

<!-- toc -->

## Introduction

Content...

## Chapter 1

More content...
```
