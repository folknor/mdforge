---
theme: tufte
templates:
  approval: ./templates/approval-block.md
  legal: ./templates/legal-footer.md
---

# Project Proposal

@include ./shared/company-info.md

## Executive Summary

The `@include` directive lets you reuse content across documents. It works with both file paths and named templates.

## File Paths

Include content from another markdown file:

- `@include ./shared/header.md` - relative path
- `@include /absolute/path/file.md` - absolute path
- `@include "path with spaces/file.md"` - quoted for spaces

Paths are resolved relative to the current file's directory.

## Named Templates

Define template names in config (or front-matter):

```yaml
templates:
  legal: "templates/legal-footer.md"
  header: "templates/company-header.md"
```

Then use the name:

- `@include legal` - uses the template path
- `@include header` - uses the template path

If the argument matches a template name, it uses the template. Otherwise it's treated as a file path.

## Benefits

- Keep shared content in one place
- Update once, reflect everywhere
- Includes can be nested (max depth: 10)
- Named templates for organization-wide reuse

@include approval

@include ./shared/disclaimer.md
