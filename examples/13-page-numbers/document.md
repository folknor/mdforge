---
theme: beryl
header:
  right: "Page {page}"
footer:
  center: "{page} of {pages}"
page_numbers:
  format: roman
---

# Page Number Formats

This document uses **roman numerals** for page numbers (i, ii, iii...).

## Available Formats

| Format | Example | Config |
|--------|---------|--------|
| Arabic (default) | 1, 2, 3 | `format: arabic` |
| Roman lowercase | i, ii, iii | `format: roman` |
| Roman uppercase | I, II, III | `format: roman-upper` |
| Alpha lowercase | a, b, c | `format: alpha` |
| Alpha uppercase | A, B, C | `format: alpha-upper` |

## Configuration

```yaml
page_numbers:
  format: roman      # or: arabic, roman-upper, alpha, alpha-upper
  start: 1           # optional: start from a different number
```

## Custom Start Value

Start numbering from a specific page (useful for multi-part documents):

```yaml
page_numbers:
  start: 5    # First page is numbered 5
```

## Use Cases

### Academic Papers

Front matter (abstract, TOC) often uses roman numerals:

```yaml
page_numbers:
  format: roman
```

### Multi-Part Documents

Continue numbering from previous section:

```yaml
page_numbers:
  format: arabic
  start: 47    # Continue from page 47
```

### Appendices

Use letters for appendix pages:

```yaml
page_numbers:
  format: alpha-upper   # A, B, C...
```

## This Document

Check the header and footer - they show roman numerals because of:

```yaml
page_numbers:
  format: roman
```

<div class="page-break"></div>

## Page Two

This page should show "ii" in the header/footer.

The `{page}` and `{pages}` variables automatically use the configured format.
