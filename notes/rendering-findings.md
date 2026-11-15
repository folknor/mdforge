# Rendering findings

Open findings about how documents are rendered and post-processed
(packages/render, packages/pdf, core page loading). Each entry stands alone.

## Fillable fields never use web fonts

A text or select field whose CSS font is a web font (the Google faces core
downloads for a theme, or any `@font-face` file) gets the next family in its
font-family stack that is installed on the system, usually the fontconfig
default for the stack's generic family (packages/render/src/form-styles.ts).
The fork @folknor/pdf-lib re-encodes WOFF/WOFF2 into a plain font program only
when the font was parsed by its own vendored fontkit, which its package does
not export; through the @pdf-lib/fontkit mdforge registers, it wrote the
compressed container as /FontFile2 and viewers drew the text blank (poppler:
"Embedded font file may be invalid"). acroform.ts now refuses WOFF/WOFF2. Even
with the fork fixed, core only has Google's unicode-range subsets (one per
script), so a field would need the subset covering what users type, or a
whole font fetched for fillable output. Filed in bz against pdf-lib.

## Fillable content-box insets ignore CSS transforms

`readPageFields` (render form-styles.ts) takes a text control's content box as
its bounding rect, which includes transforms and zoom, plus its computed
padding and borders, which do not. A transformed or zoomed control (or
ancestor) gets insets that mix the two, so the PDF widget's text area drifts
from the control's. Matching the content box also does not make the PDF
viewer's baseline, line spacing or native select text placement match
Chromium's.

## Tagged PDFs leave graphics neither tagged nor marked as artifacts

Chromium (both renderers) writes only text as marked content in its tagged
PDFs: backgrounds, borders, table rules and form-control boxes are drawn as
plain operators outside any marked-content sequence, so they are neither in
the structure tree nor `/Artifact`. PDF/UA requires every piece of page
content to be one or the other. mdforge marks what it draws itself (the
fillable dropdown arrow, acroform.ts) as an artifact, but fixing Chromium's
output would mean rewriting each page's content stream to wrap the unmarked
drawing in `/Artifact BMC ... EMC`. Seen by reading the content streams of
real renders (no PDF/UA checker such as veraPDF was available).

## Images and other subresources that fail to load are silent

A stylesheet that fails to load is named in a warning (page-load.ts
`watchStylesheetLoads`), but an image, font file or iframe that fails (a
missing local file, an HTTP 404) is left out of the print with no warning, in
both renderers. Observed with Puppeteer: a missing `<img>` fires a captured
`error` event the same as a stylesheet does (a remote 404 image is a finished
request with status 404; a missing local one fails with
net::ERR_FILE_NOT_FOUND), so the stylesheet watch could cover images by
widening its filter. Fonts loaded through `@font-face` fire no element event
(`document.fonts` reports them). Whether broken images deserve a warning is a
product decision: raw HTML in documents can reference optional images.

Stylesheets inside iframes and shadow roots are not watched either.

## Electron hosts with file privileges enabled allow direct local-file reads

Packaged desktop builds turn Electron's `grantFileProtocolExtraPrivileges`
fuse off (electron-builder.yml), so their `file://` render page matches the
CLI's Chrome: page scripts cannot read other local files by `fetch`, XHR or
an iframe's `contentDocument`. Any Electron binary with the fuse on (its
default) still grants those reads: `pnpm desktop`, the
scripts/check-electron-render checks, and every other app hosting
`@mdforge/renderer-electron`. The driver needs a ready app and cannot change
its host's fuses.

Open options: run development and the check scripts on a private fuse-off
copy of the Electron binary, or make a fuse-off host a requirement the
library checks and refuses otherwise. Not verified: the fuse flip and asar
serving in an actually packaged artifact (electron-builder was not run; the
flip was tested on a copied binary with @electron/fuses, the library
electron-builder uses).
