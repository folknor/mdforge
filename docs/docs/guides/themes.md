# Themes and Styling

## Built-in Themes

mdforge includes four built-in themes:

| Theme | Description |
|-------|-------------|
| `beryl` | Clean, modern default theme |
| `tufte` | Inspired by Edward Tufte's book design |
| `buttondown` | Minimal, newsletter-style |
| `pandoc` | Classic academic style |

Set a theme in front-matter or config:

```yaml
theme: tufte
```

## Disabling Themes

To use only your own CSS:

```yaml
theme: false
stylesheet: my-styles.css
```

## Custom Stylesheets

Add custom CSS that extends or overrides the theme:

```yaml
theme: tufte
stylesheet: my-overrides.css
```

### CSS Load Order

Stylesheets load in this order (later overrides earlier):

1. **Theme** - base styles
2. **Fonts** - font-family declarations
3. **Your stylesheet** - custom overrides

### Auto-detection

If no stylesheet is specified, mdforge looks for:

1. `{basename}.css` (e.g., `document.css` for `document.md`)
2. `index.css`

## Page Background Color

When using custom CSS, set background on both `body` and `@page`:

```css
:root {
  --color-background: #fffff8;
}

body {
  background-color: var(--color-background);
}

@page {
  background-color: var(--color-background);
}
```
