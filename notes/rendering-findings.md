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

## Electron page scripts can read any local file directly

The Electron render window loads its page from `file://`, and Electron's
`grantFileProtocolExtraPrivileges` fuse (on by default, settable only at
package time) gives `file://` pages universal access to other `file://`
resources. Verified on Electron 45.3.2 with a canary outside the document
directory: a page script read it by `fetch`, synchronous XHR and an iframe's
`contentDocument`; in the CLI's Chrome all three fail (the iframe still
displays the file). So a compromised remote script a trusted document loads
can, in the desktop app only, read further local files of its choosing and
send them out while loading. It still reads whatever the document itself
includes, in both renderers; this concerns only the additional direct reads.

Cancelling `file:` requests of webRequest type `xhr` alone does not close it
(the iframe read remains), so nothing was landed. Candidate fixes, each
unverified against the full access matrix: flip the fuse in packaged builds
(affects the desktop main window, which is loaded from `file://`, and leaves
dev runs unfused), or serve the render page and its local resources from a
custom protocol with a defined origin mapping and CORS policy. Choosing one is
a design decision. docs/docs/reference/configuration.md "Trust" states the
current behaviour.
