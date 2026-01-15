# mdforge Roadmap

## 1. Mermaid Diagram Support

Render diagrams in PDFs.

    ```mermaid
    graph LR
      A[Markdown] --> B[PDF]
    ```

- [ ] Integrate mermaid-cli or use Puppeteer-based rendering
- [ ] Support flowcharts, sequence diagrams, ERD, etc.
- [ ] Configurable theme to match document style

## 2. Watch Mode

Auto-regenerate PDF when source file changes.

- [ ] `--watch` flag for CLI
- [ ] Debounce rapid changes
- [ ] Watch included files too (@include dependencies)
- [ ] Desktop app: optional auto-regenerate toggle

## 3. Cover Page

First page with title, author, branding. Common for reports, proposals, theses.

```yaml
cover:
  title: "Project Proposal"
  subtitle: "Q1 2025 Initiative"
  author: "Jane Smith"           # or authors: ["Jane Smith", "John Doe"]
  date: "January 2025"           # or "auto"
  version: "1.0"
  logo: company-logo.svg
  organization: "Acme Corp"
  template: corporate            # corporate, academic, minimal
  background: cover-bg.jpg       # optional background image

  # Academic papers
  institution: "MIT"
  department: "Computer Science"
  degree: "Master of Science"
  advisor: "Dr. Smith"
```

- [ ] Built-in templates: corporate, academic, minimal
- [ ] Custom cover via markdown: `cover: path/to/cover.md`
- [ ] Cover excluded from page numbering (or page 0)
- [ ] No header/footer on cover page
- [ ] Full-bleed option (no margins on cover)
- [ ] Background image support
- [ ] Sync with metadata (title, author)
- [ ] Logo sizing and positioning options

## 4. More Themes

- [ ] Add 2-3 built-in themes: `corporate`, `academic`, `minimal`

## 5. Multi-file / Book Mode

Combine multiple .md files into a single PDF with unified TOC.

**Note:** Users can already do this with @include:
```markdown
<!-- book.md -->
# My Book
<!-- toc -->
@include chapters/01-intro.md
@include chapters/02-methods.md
```

What's missing: page breaks between chapters, CLI convenience, chapter-aware headers.

**Approach A: Enhance @include**
```markdown
@include chapters/01-intro.md {page-break}
```

**Approach B: CLI flag**
```bash
mdforge --book chapters/*.md -o book.pdf
# Alphabetical order, page breaks between files
```

**Approach C: Book config**
```yaml
book:
  files:
    - preface.md
    - chapters/*.md          # glob support, sorted alphabetically
    - appendix.md
  page_break: between_files  # or: chapter_start_odd (right-hand page), none
  numbering:
    front_matter: roman      # i, ii, iii for preface
    main: arabic             # 1, 2, 3 for chapters
```

**File ordering:** Explicit list takes precedence. Globs sorted alphabetically. Numeric prefixes recommended: `01-intro.md`, `02-methods.md`.

**Per-file front-matter:** In book mode, individual file front-matter could be ignored (global config only) or merged (file overrides global). TBD.

- [ ] Page break option for @include: `{page-break}` or `{break}`
- [ ] `--book` CLI flag for combining files
- [ ] Unified TOC across all files (already works via @include)
- [ ] Chapter-aware headers: `{chapter}` placeholder from first H1
- [ ] Front matter (roman) vs main matter (arabic) numbering
- [ ] `chapter_start_odd` for print-ready PDFs (chapters start on right-hand pages)

## 6. Citations & Bibliography

Academic paper support with Pandoc-style syntax.

```markdown
According to recent research [@smith2024], ...

## References
<!-- bibliography -->
```

- [ ] BibTeX file support
- [ ] Citation styles (APA, MLA, Chicago)
- [ ] Auto-generate bibliography section

## 7. Watermarks

Overlay text (or images) on every page. Common for drafts, confidential docs, branding.

```yaml
watermark: "DRAFT"                    # simple text, defaults to diagonal gray

watermark:
  text: "CONFIDENTIAL"
  opacity: 0.3                        # 0-1
  angle: -45                          # degrees, -45 is diagonal bottom-left to top-right
  color: "#ff0000"                    # or "gray", "red", etc.
  size: 72                            # font size in points
  position: center                    # center, top, bottom

watermark:
  image: logo-watermark.png           # image instead of text
  opacity: 0.1
  position: center
  size: 50%                           # percentage of page width
```

**Implementation approaches:**

**Approach A: CSS (via paged.js)**
- Use `body::before` with `position: fixed`, `transform: rotate(-45deg)`
- Rendered by Puppeteer as part of HTML
- Simple, no extra dependencies
- Limitations: same watermark on every page, opacity via CSS

```css
body::before {
  content: "DRAFT";
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-45deg);
  font-size: 100px;
  color: rgba(200, 200, 200, 0.3);
  pointer-events: none;
  z-index: 9999;
}
```

**Approach B: pdf-lib post-processing**
- Already have pdf-lib for metadata injection
- Iterate through pages, draw text/image on each
- `page.drawText()` with `rotate: degrees(-45)`, `color: rgb(...)`
- True opacity via graphics state operators (more complex)
- More control: different watermark per page, precise positioning, images

```javascript
const pages = pdfDoc.getPages();
for (const page of pages) {
  page.drawText('DRAFT', {
    x: width / 2,
    y: height / 2,
    size: 72,
    rotate: degrees(-45),
    color: rgb(0.8, 0.8, 0.8),
  });
}
```

**Recommendation:** Start with CSS approach (simpler). Add pdf-lib for image watermarks or if CSS limitations become a problem.

- [ ] Simple text watermark via CSS pseudo-element
- [ ] Config parsing for watermark options
- [ ] Diagonal rotation and opacity
- [ ] Image watermarks (pdf-lib approach)
- [ ] Position options (center, corners, tiled)

---

## Ideas (not confirmed)

### VS Code Extension

- [ ] "Generate PDF" button in editor
- [ ] Status bar integration
- [ ] Config file autocompletion

---

## Remaining Tasks

- [ ] Logo: anvil + "mdforge" text
- [ ] Update GitHub repo name
- [ ] Desktop app: Windows testing
- [ ] Desktop app: Auto-update
- [ ] @include in header/footer config values
