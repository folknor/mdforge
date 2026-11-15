import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "@folknor/pdf-lib";
import { addAcroFormFields, SCALE_MARKER_URL } from "../src/acroform.ts";

async function printed(scale: number | undefined) {
  const doc = await PDFDocument.create();
  const page = doc.addPage();

  if (scale) {
    page.drawLink({ url: SCALE_MARKER_URL, x: 0, y: 0, width: 100 * scale, height: 100 * scale });
  }

  for (const [index, type] of ["text", "textarea", "select"].entries()) {
    page.drawLink({
      url: `https://mdforge.marker/${type}?type=${type}`,
      x: 40,
      y: 100 + index * 100,
      width: 200,
      height: 80,
    });
  }

  return doc.save();
}

const styles = new Map(
  ["text", "textarea", "select"].map((name) => [
    name,
    {
      fontSizePx: 32,
      fonts: [],
      textInsetsPx: { left: 27, top: 11, right: 23, bottom: 15 },
    },
  ]),
);

function rectangle(doc: PDFDocument, name: string) {
  return doc.getForm().getField(name).acroField.getWidgets()[0]?.getRectangle();
}

describe("fillable control content boxes", () => {
  for (const scale of [0.375, 0.75, 1.5]) {
    it(`uses asymmetric control insets and compensates appearance padding at ${scale}pt/px`, async () => {
      const result = await addAcroFormFields(await printed(scale), {
        fieldStyles: styles,
        selectOptions: new Map([["select", ["Option"]]]),
      });

      assert.deepEqual(result.warnings, []);
      const doc = await PDFDocument.load(result.pdf);

      for (const [index, name] of ["text", "textarea", "select"].entries()) {
        const field = doc.getForm().getField(name);
        const widget = field.acroField.getWidgets()[0];
        assert.ok(widget);
        assert.deepEqual(widget.getRectangle(), {
          x: 40 + 27 * scale - 1,
          y: 100 + index * 100 + 15 * scale - 1,
          width: 200 - 50 * scale + 2,
          height: 80 - 26 * scale + 2,
        });
        const appearance = widget.getAppearances()?.normal;
        assert.ok(appearance instanceof PDFRawStream);
        const operators = new TextDecoder().decode(decodePDFRawStream(appearance).decode());
        assert.match(operators, /1 0 0 1 1 [-\d.]+ Tm/, "appearance starts 1pt inside the widget");
        assert.match(operators, new RegExp(`/Helvetica ${32 * scale} Tf`));
      }
    });
  }

  it("keeps every field on the marker box when the printed scale is unusable", async () => {
    const result = await addAcroFormFields(await printed(undefined), {
      fieldStyles: styles,
      selectOptions: new Map([["select", ["Option"]]]),
    });

    assert.deepEqual(result.warnings, [
      "The printed page scale could not be measured, so fillable fields use a default text size instead of the document's.",
    ]);
    const doc = await PDFDocument.load(result.pdf);

    for (const [index, name] of ["text", "textarea", "select"].entries()) {
      assert.deepEqual(rectangle(doc, name), {
        x: 40,
        y: 100 + index * 100,
        width: 200,
        height: 80,
      });
    }
  });

  for (const [label, textInsetsPx] of [
    ["width", { left: 300, right: 300, top: 0, bottom: 0 }],
    ["height", { left: 0, right: 0, top: 100, bottom: 100 }],
    ["non-finite", { left: Number.NaN, right: 0, top: 0, bottom: 0 }],
  ] as const) {
    it(`falls back to the marker box when the content box is unusable (${label})`, async () => {
      const result = await addAcroFormFields(await printed(0.75), {
        fieldStyles: new Map([["text", { fontSizePx: 32, fonts: [], textInsetsPx }]]),
      });

      assert.deepEqual(result.warnings, []);
      const doc = await PDFDocument.load(result.pdf);
      assert.equal(doc.getForm().getFields().length, 3);
      assert.deepEqual(rectangle(doc, "text"), { x: 40, y: 100, width: 200, height: 80 });
    });
  }

  it("uses the marker box for a field without measured insets", async () => {
    const result = await addAcroFormFields(await printed(0.75), {
      fieldStyles: new Map([["text", { fontSizePx: 32, fonts: [] }]]),
    });

    assert.deepEqual(result.warnings, []);
    const doc = await PDFDocument.load(result.pdf);
    assert.deepEqual(rectangle(doc, "text"), { x: 40, y: 100, width: 200, height: 80 });
  });
});
