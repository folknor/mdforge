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

## Scaled header/footer SVGs keep their own height

packages/core/src/lib/paged-css.ts `scaleSvg` (`logo.svg 60%` in a column)
sets the root `width` but leaves an existing `height` attribute, so an SVG
that declares both is stretched to its full declared height. Rendered with
example 07's header-bg.svg (declares 120mm): in a margin box the column's
image and its text vanish, and in a background template the image is a thin
line with the following text pushed far down the page. Both renderings share
the image resolver, so one fix covers both.

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
