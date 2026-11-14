---
theme: tufte
footer: Page {page} of {pages}
toc_options:
  skip_first_h1: true
  maxdepth: 3
---

# Table of Contents Example

<!-- toc -->

## Introduction

This document demonstrates the automatic table of contents feature. Add `<!-- toc -->` where you want the TOC to appear.

## Getting Started

### Installation

Install mdforge globally:

```bash
npm install -g mdforge
```

### Basic Usage

Run the converter:

```bash
mdforge document.md
```

## Features

### Markdown Support

Full GitHub-flavored markdown support including:

- Headers
- Lists
- Code blocks
- Tables
- And more

### PDF Generation

High-quality PDF output with:

- Embedded fonts
- Syntax highlighting
- Page numbers

## Configuration

### TOC Options

```yaml
toc_options:
  skip_first_h1: true   # Skip the document title
  maxdepth: 3           # Include h1, h2, h3
```

### Other Settings

All standard mdforge options are available.

## Conclusion

The table of contents is automatically generated from your headings.
