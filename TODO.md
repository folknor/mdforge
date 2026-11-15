# TODO

## Transparent Form Field Backgrounds

**Status:** Implemented as workaround in `acroform.ts`, pending pdf-lib improvement.

### The problem

pdf-lib defaults all form field widgets to white backgrounds (`rgb(1, 1, 1)`). We need transparent backgrounds so the HTML-rendered styling shows through the AcroForm overlay.

### Current workaround

In `acroform.ts` (`buildFields`, after the fields are created), we manually delete the `BG` key from each widget's `MK` dictionary:

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

