# Fonts

Load custom fonts from Google Fonts for headings, body text, and code. System fonts are used when available; missing fonts are downloaded from Google Fonts and cached in `~/.cache/mdforge/fonts/`.

## Font Presets

Use a preset by name:

```yaml
fonts: classic-elegant
```

Available presets:

| Preset | Heading | Body | Mono |
|--------|---------|------|------|
| `modern-professional` | Inter | Inter | Fira Code |
| `classic-elegant` | Playfair Display | Libre Baskerville | Fira Code |
| `modern-geometric` | Poppins | Open Sans | Fira Code |
| `tech-minimal` | Space Grotesk | DM Sans | JetBrains Mono |
| `editorial` | Cormorant Garamond | Libre Baskerville | Fira Code |
| `clean-sans` | DM Sans | Inter | Fira Code |

Each theme also has a matching font preset (`beryl`, `tufte`, `buttondown`, `pandoc`) that's automatically applied when using that theme.

## Custom Fonts

Specify any Google Font by name:

```yaml
fonts:
  heading: "Playfair Display"
  body: "Inter"
  mono: "JetBrains Mono"
```

You can specify just one or two:

```yaml
fonts:
  heading: "Poppins"  # Uses theme default for body and mono
```

## Font Scale

Scale all font sizes proportionally:

```yaml
font_scale: 1.2  # 20% larger (14.4pt base instead of 12pt)
```

## CSS Variables

Fonts are set as CSS variables that themes use:

- `--font-heading`
- `--font-body`
- `--font-mono`
