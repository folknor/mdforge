---
theme: beryl
fonts: classic-elegant
---

# Font Presets

This document uses the **classic-elegant** font preset.

## Using Presets

Simply specify a preset name:

```yaml
fonts: classic-elegant
```

## Available Presets

| Preset | Heading | Body | Mono |
|--------|---------|------|------|
| `modern-professional` | Inter | Inter | Fira Code |
| `classic-elegant` | Playfair Display | Libre Baskerville | Fira Code |
| `modern-geometric` | Poppins | Open Sans | Fira Code |
| `tech-minimal` | Space Grotesk | DM Sans | JetBrains Mono |
| `editorial` | Cormorant Garamond | Libre Baskerville | Fira Code |
| `clean-sans` | DM Sans | Inter | Fira Code |

### Theme Font Presets

Each theme has matching fonts (system fonts with Google Fonts fallbacks):

| Theme | Heading | Body | Mono |
|-------|---------|------|------|
| `beryl` | — | Noto Sans | Fira Code |
| `tufte` | — | Palatino → EB Garamond | Consolas → Inconsolata |
| `buttondown` | Helvetica Neue → Inter | Georgia → Gelasio | Courier New → Fira Code |
| `pandoc` | — | Georgia → Libre Baskerville | Consolas → Fira Code |

System fonts are used when available; fallbacks (after →) are downloaded from Google Fonts.

## Custom Fonts

Specify individual fonts from Google Fonts:

```yaml
fonts:
  heading: "Playfair Display"
  body: "Source Serif Pro"
  mono: "JetBrains Mono"
```

You can specify just what you need:

```yaml
fonts:
  heading: "Poppins"    # Others use theme defaults
```

## Code Example

Here's some code to show the mono font:

```javascript
function greet(name) {
  console.log(`Hello, ${name}!`);
}
```

## How It Works

1. Fonts are checked against your system fonts first
2. If not installed, downloaded from Google Fonts
3. Cached in `~/.cache/mdforge/fonts/` for future use

Fonts are set as CSS variables that themes use:
- `--font-heading`
- `--font-body`
- `--font-mono`

## Combining with Themes

Fonts work with any theme:

```yaml
theme: tufte
fonts: tech-minimal    # Override tufte's default fonts
```
