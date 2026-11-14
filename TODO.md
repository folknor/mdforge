# TODO

## Transparent Form Field Backgrounds

**Status:** Implemented as workaround in `acroform.ts`, pending pdf-lib improvement.

### The problem

pdf-lib defaults all form field widgets to white backgrounds (`rgb(1, 1, 1)`). We need transparent backgrounds so the HTML-rendered styling shows through the AcroForm overlay.

### Current workaround

In `acroform.ts:399-409`, we manually delete the `BG` key from each widget's `MK` dictionary:

```typescript
for (const field of form.getFields()) {
  const widgets = field.acroField.getWidgets();
  for (const widget of widgets) {
    const mk = widget.dict.get(PDFName.of("MK"));
    if (mk && mk instanceof PDFDict) {
      mk.delete(PDFName.of("BG"));
    }
  }
}
```

### Future: pdf-lib improvement

See `/home/folk/Programs/pdf-lib/TODO.md` for the proposed API:
- Accept `backgroundColor: null` to mean "no background"
- Add `clearBackgroundColor()` to `AppearanceCharacteristics`

Once implemented in pdf-lib, we can simplify to:
```typescript
field.addToPage(page, { backgroundColor: null, ... });
```

---

## Link Annotation API for Marker Extraction

**Status:** Implemented as manual PDF manipulation in `acroform.ts`, pending pdf-lib improvement.

### The hack

mdforge uses invisible `<a>` links as position markers. Puppeteer converts these to PDF Link annotations with precise coordinates. We then:
1. Scan for links matching `https://mdforge.marker/...`
2. Extract field name, type, and position from annotation rectangle
3. Remove marker annotations
4. Create AcroForm fields at those positions

### Current implementation

In `acroform.ts:85-178`, we manually iterate through annotations:

```typescript
const annotsRef = page.node.get(PDFName.of("Annots"));
const annots = page.node.context.lookup(annotsRef);
// ... manual PDFArray iteration, PDFDict lookup, URL extraction
```

### Future: pdf-lib improvement

See `/home/folk/Programs/pdf-lib/TODO.md` for the proposed API:
- `page.getLinkAnnotations()` returning `PDFLinkAnnotation[]`
- `annotation.getUrl()` for easy URL extraction
- `page.removeAnnotations(predicate)` for batch removal

Once implemented, marker extraction simplifies to:
```typescript
const markers = page.getLinkAnnotations()
  .filter(link => link.getUrl()?.startsWith(MARKER_URL_PREFIX));

for (const marker of markers) {
  const { x, y, width, height } = marker.getRectangle();
  // ... create AcroForm field
  page.removeAnnotation(marker);
}
```

---

## Fillable PDF Form Field Fonts

**Status:** ✅ Resolved

Font size is now calculated from CSS (`formFontInfo.fontSize * 0.75` for 96→72 DPI conversion) and custom fonts are embedded via `pdfDoc.embedFont()`. See `acroform.ts:214-249`.
