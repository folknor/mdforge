---
theme: pandoc
metadata:
  title: "Technical Specification v2.0"
  author: "Jane Smith"
  subject: "API Documentation for Widget System"
  keywords:
    - api
    - documentation
    - widgets
    - technical
---

# PDF Metadata

This document has custom PDF metadata embedded.

## Viewing Metadata

PDF metadata is visible in:
- PDF viewer "Document Properties" (Ctrl+D in most viewers)
- File managers showing PDF details
- Search indexers and document management systems

## Configuration

```yaml
metadata:
  title: "My Document Title"
  author: "Author Name"
  subject: "What this document is about"
  keywords:
    - keyword1
    - keyword2
    - keyword3
```

## Available Fields

| Field | Description |
|-------|-------------|
| `title` | Document title (auto-detected from first h1 if not set) |
| `author` | Document author |
| `subject` | Document subject/description |
| `keywords` | Array of keywords for search indexing |
| `creator` | Application that created the document (default: "mdforge") |
| `producer` | PDF producer (usually set by pdf-lib) |

## Use Cases

### Professional Documents

```yaml
metadata:
  title: "Q4 Financial Report"
  author: "Finance Department"
  subject: "Quarterly financial analysis"
  keywords:
    - finance
    - quarterly
    - 2024
```

### Technical Documentation

```yaml
metadata:
  title: "API Reference v3.0"
  author: "Engineering Team"
  subject: "REST API documentation"
  keywords:
    - api
    - rest
    - documentation
```

### Legal Documents

```yaml
metadata:
  title: "Service Agreement"
  author: "Legal Department"
  subject: "Terms of service agreement"
  keywords:
    - legal
    - agreement
    - terms
```

## Automatic Title Detection

If you don't specify a title, mdforge uses the first h1 heading:

```markdown
# This Becomes the Title

Content here...
```

Results in `title: "This Becomes the Title"` in the PDF metadata.
