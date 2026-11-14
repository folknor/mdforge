---
header:
  left: "**TOP SECRET**"
  right: logo.svg 80%
footer:
  left: "{date}"
  center: Page {page}/{pages}
  right: logo.svg 60%
stylesheet: style.css
---

# Confidential Report

This example demonstrates branded documents with logos and styled text.

## Features Shown

### Markdown in Headers

Use markdown for bold/italic text:

```yaml
header:
  left: "**TOP SECRET**"
```

### Custom Colors via CSS

Style header/footer positions with `@page` margin rules in your stylesheet:

```css
@page {
  @top-left {
    color: #dc2626;
  }
}
```

Available margin boxes: `@top-left`, `@top-center`, `@top-right`, `@bottom-left`, `@bottom-center`, `@bottom-right`.

### Images in Headers

Embed logos with optional sizing:

```yaml
header:
  right: logo.svg 80%
footer:
  right: logo.svg 60%
```

The percentage scales the image (100% ≈ 60px).

## Sample Content

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
