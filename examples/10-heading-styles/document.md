---
stylesheet: style.css
---

# Styling Specific Headings

Headings automatically get IDs based on their text. Use these IDs to style specific headings.

## Important Section

This section has special styling applied via `#important-section` in CSS.

## Regular Section

This section has default styling.

## Warning: Read Carefully

This warning section is styled with a red color and icon prefix.

## Another Regular Section

Back to normal styling here.

### Nested Subsection

Subsections also get IDs: `#nested-subsection`

## How It Works

Markdown headings are converted to HTML with auto-generated IDs:

```markdown
## My Heading Title
```

Becomes:

```html
<h2 id="my-heading-title">My Heading Title</h2>
```

### ID Generation Rules

- Lowercase
- Spaces become hyphens
- Special characters removed
- Example: `## Warning: Read Carefully` becomes `#warning-read-carefully`

## Styling in CSS

Target specific headings by ID:

```css
#important-section {
  color: #2563eb;
  border-left: 4px solid #2563eb;
  padding-left: 1em;
}

#warning-read-carefully {
  color: #dc2626;
}
```
