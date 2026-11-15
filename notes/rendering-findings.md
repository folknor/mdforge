# Rendering findings

Open findings about how documents are rendered and post-processed
(packages/render, packages/pdf, core page loading). Each entry stands alone.

## AcroForm text ignores `pdf_options.scale`

packages/pdf/src/acroform.ts sizes field appearance text as the CSS font size
times 0.75, while the field rectangles come from the printed (scaled) page.
With `scale` other than 1, fillable fields get text at a different size from
the surrounding document. CSS page-size fitting (`preferCSSPageSize`) may do
the same. Unverified by a render.

## One font for every AcroForm field

packages/render/src/engine.ts `readFormFont` reads the computed font of the
first form field only, and acroform.ts uses it for every field. Fields styled
with different families or sizes get wrong appearances.

## `page_media_type` does not reach cross-origin iframes

Both renderers apply the media type to the page's own frames only; a
cross-origin (out-of-process) iframe prints with print media even when
`page_media_type` is `screen`. Observed identically in both renderers
(Puppeteer's Chrome 157, Electron's Chrome 156) with a local http iframe.
Fixing it means applying the emulation to each out-of-process frame target as
it attaches, in both drivers.

## A `content` stylesheet containing `</style` breaks the page

packages/core/src/lib/page-load.ts `buildPageHtml` writes CSS-text stylesheets
as `<style>${value}</style>` verbatim, so CSS whose text contains `</style`
(in a string or comment) ends the element early and the rest is parsed as
document markup, in both renderers and in HTML output.
