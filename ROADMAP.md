# mdforge Roadmap

## 1. Rebrand to mdforge ✓

- [x] Rename package to `mdforge` in package.json (first npm publish)
- [x] CLI commands: `mdforge` primary
- [ ] Logo: anvil + "mdforge" text
- [x] Update README, all docs, examples
- [ ] Update GitHub repo name (user will do this)

## 2. PDF Metadata ✓

Uses pdf-lib for post-processing after Puppeteer generates PDF.

- [x] Research: pdf-lib vs pdf.js vs other libraries → chose pdf-lib
- [x] Inject metadata after PDF generation:
  - `title` (auto from document_title/h1, or config override)
  - `author` (config only)
  - `subject`, `keywords`, `creator`, `producer` (config only)
  - `modificationDate` (auto set to now)
- [x] Config validated with helpful error messages
- [x] Documented in README

## 3. Font Loading & Pairings ✓

- [x] Test remote `@font-face` in Puppeteer
- [x] Config separates heading vs body fonts:
  ```yaml
  fonts:
    heading: "Playfair Display"
    body: "Inter"
  ```
  Or use a preset:
  ```yaml
  fonts: modern-professional
  ```
- [x] Verified ALL fonts are on Google Fonts (free):
  - Playfair Display, Inter, Poppins, Open Sans
  - Space Grotesk, DM Sans, Cormorant Garamond, Libre Baskerville
- [x] Auto-generate `@import` URLs from font names
- [x] 6 preset pairings: modern-professional, classic-elegant, modern-geometric, tech-minimal, editorial, clean-sans

## 4. More Themes

- [ ] Add 2-3 built-in themes: `corporate`, `academic`, `minimal`
- [ ] No user-contributed theme system

## 5. Iconify Icons in Markdown ✓

- [x] Syntax: `:icon[prefix:name]` or `:icon[prefix:name]{size=24}`
- [x] Fetch SVG from Iconify API at build time
- [x] Inline as SVG with proper styling
- [x] Support sizing: `:icon[mdi:home]{size=24}`
- [x] Local cache in `~/.cache/mdforge/icons/`

## 6. @include / Templates ✓

- [x] Include markdown files:
  ```markdown
  @include ./shared/disclaimer.md
  @include /absolute/path/to/file.md
  @include "path with spaces/file.md"
  ```
- [x] Path handling: normalize Windows/Mac/Linux, support spaces (quoted paths)
- [x] Named templates in config:
  ```yaml
  templates:
    legal-footer: "/path/to/legal-footer.md"
    company-header: "/path/to/company-header.md"
  ```
- [x] Usage: `@include legal-footer` (template names work with @include)
- [x] Recursive includes with depth limit (max 10)
- [ ] Works in header/footer config values too (future enhancement)

## 7. Fix regenerate-examples Script ✓

- [x] Regenerate ALL examples every time
- [x] Handle 03-themes: all .md files in directory
- [x] Handle 04-headers-footers: all .md files in directory
- [x] Optional single-example filter: `pnpm regenerate-examples 03-themes`

## 8. Desktop App (Electron) ✓

- [x] Simple UI:
  - Drop zone for .md file or folder
  - Config panel: author, title, theme, font pairing
  - "Generate PDF" button
  - Output path selector
- [x] No preview pane
- [x] Save user preferences (default author, theme, etc.)
- [x] Batch: drop folder → generate all .md files
- [ ] **Windows primary target** (needs testing)
- [x] Distribution: single portable files only
  - Windows: `.exe` (no installer) - configured
  - Linux: AppImage ✓
  - macOS: `.app` bundle - configured
- [ ] Auto-update (optional, lower priority)

## 9. Page Number Formats ✓

- [x] Roman numerals for front matter (i, ii, iii)
- [x] Custom start value for page numbering
- [x] Config: `page_numbers: { start: 1, format: "arabic" | "roman" | "roman-upper" | "alpha" | "alpha-upper" }`

---

## Ideas (not yet confirmed)

### Watch Mode

Auto-regenerate PDF when source file changes.

- [ ] `--watch` flag for CLI
- [ ] Debounce rapid changes
- [ ] Desktop app: optional auto-regenerate toggle

### Multi-file / Book Mode

Combine multiple .md files into a single PDF.

- [ ] Config: `files: [chapter1.md, chapter2.md, ...]`
- [ ] Shared TOC across all files
- [ ] Page breaks between files

### Cover Page

First page template with title, author, date.

- [ ] Config: `cover: { title, subtitle, author, date, image }`
- [ ] Built-in cover templates
- [ ] Or custom HTML/markdown for cover

### VS Code Extension

- [ ] "Generate PDF" button in editor
- [ ] Status bar integration
- [ ] Config file autocompletion

### Watermarks

Overlay text on pages.

- [ ] Config: `watermark: "DRAFT"` or `watermark: { text, opacity, angle }`
- [ ] Diagonal text across page
- [ ] Optional: image watermarks

---

## Priority Order

1. ~~Rebrand~~ ✓
2. ~~PDF metadata~~ ✓
3. ~~Fix regenerate script~~ ✓
4. ~~Fonts~~ ✓
5. ~~@include/templates~~ ✓
6. ~~Icons~~ ✓
7. Themes
8. ~~Desktop app~~ ✓
9. ~~Page number formats~~ ✓
