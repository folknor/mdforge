import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFObject,
} from "@folknor/pdf-lib";
import { TaggedStructure } from "../src/structure.ts";

/** Checked narrowing for the objects these tests read back. */
function dict(doc: PDFDocument, value: PDFObject | undefined): PDFDict {
  const resolved = doc.context.lookup(value);
  assert.ok(resolved instanceof PDFDict);

  return resolved;
}

function array(doc: PDFDocument, value: PDFObject | undefined): PDFArray {
  const resolved = doc.context.lookup(value);
  assert.ok(resolved instanceof PDFArray);

  return resolved;
}

function num(value: PDFObject | undefined): number {
  assert.ok(value instanceof PDFNumber);

  return value.asNumber();
}

/**
 * A tagged document shaped like Chromium's fillable print: a wrapper element
 * holding label content (MCID 0) and a /Link element whose only kid is an
 * OBJR to a marker annotation with /StructParent 1. `split` puts the
 * ParentTree in two leaves with /Limits.
 */
async function markerDocument(split = false) {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const { context } = doc;

  const marker = context.register(context.obj({ Type: "Annot", Subtype: "Link", StructParent: 1 }));

  page.node.set(PDFName.of("Annots"), context.obj([marker]));
  page.node.set(PDFName.of("StructParents"), PDFNumber.of(0));

  const rootRef = context.nextRef();
  const wrapperRef = context.nextRef();
  const linkRef = context.nextRef();

  const link = context.obj({
    Type: "StructElem",
    S: "Link",
    P: wrapperRef,
    K: { Type: "OBJR", Obj: marker, Pg: page.ref },
  });

  const wrapper = context.obj({
    Type: "StructElem",
    S: "NonStruct",
    P: rootRef,
    Pg: page.ref,
    K: [0, linkRef],
  });

  const pageElements = context.obj([wrapperRef]);

  const parentTree = split
    ? context.obj({
        Kids: [
          context.register(context.obj({ Limits: [0, 0], Nums: [0, pageElements] })),
          context.register(context.obj({ Limits: [1, 1], Nums: [1, linkRef] })),
        ],
      })
    : context.obj({ Nums: [0, pageElements, 1, linkRef] });

  context.assign(linkRef, link);
  context.assign(wrapperRef, wrapper);
  context.assign(
    rootRef,
    context.obj({
      Type: "StructTreeRoot",
      K: wrapperRef,
      ParentTree: parentTree,
      ParentTreeNextKey: 2,
    }),
  );
  doc.catalog.set(PDFName.of("StructTreeRoot"), rootRef);

  return { doc, page, marker, link, linkRef, wrapper, parentTree };
}

function nums(doc: PDFDocument, tree: PDFDict): number[] {
  const keys: number[] = [];

  const visit = (node: PDFDict) => {
    const n = node.lookup(PDFName.of("Nums"));

    if (n instanceof PDFArray) {
      for (let i = 0; i < n.size(); i += 2) keys.push(num(n.get(i)));
    }

    const kids = node.lookup(PDFName.of("Kids"));

    if (kids instanceof PDFArray) {
      for (const kid of kids.asArray()) visit(dict(doc, kid));
    }
  };

  visit(tree);

  return keys;
}

describe("TaggedStructure", () => {
  it("is absent from an untagged document", async () => {
    assert.equal(TaggedStructure.of(await PDFDocument.create()), undefined);
  });

  it("hands a marker's element to its widget", async () => {
    const { doc, page, marker, link } = await markerDocument();
    const widget = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Widget" }));
    const structure = TaggedStructure.of(doc);
    const slot = structure?.slotFor(marker);

    assert.ok(structure && slot);
    assert.equal(slot.key, 1);
    structure.give(slot, marker, widget, page.ref, "Option");

    assert.equal(link.get(PDFName.of("S")), PDFName.of("Form"));
    const objr = dict(doc, link.get(PDFName.of("K")));
    assert.equal(objr.get(PDFName.of("Obj")), widget);
    assert.equal(objr.get(PDFName.of("Pg")), page.ref);
    const alt = link.get(PDFName.of("Alt"));
    assert.ok(alt instanceof PDFHexString);
    assert.equal(alt.decodeText(), "Option");
    assert.equal(num(dict(doc, widget).get(PDFName.of("StructParent"))), 1);
  });

  it("refuses a slot whose element holds more than the marker", async () => {
    const { doc, marker, link } = await markerDocument();
    const kid = link.get(PDFName.of("K"));

    assert.ok(kid);
    link.set(PDFName.of("K"), doc.context.obj([kid, 3]));

    assert.equal(TaggedStructure.of(doc)?.slotFor(marker), undefined);
  });

  it("detaches a marker that got no widget", async () => {
    const { doc, marker, linkRef, wrapper, parentTree } = await markerDocument();

    TaggedStructure.of(doc)?.detach(marker);

    assert.equal(num(wrapper.get(PDFName.of("K"))), 0, "only the label content is left");
    assert.equal(doc.context.lookup(linkRef), undefined, "the empty element is deleted");
    assert.deepEqual(nums(doc, parentTree), [0]);
  });

  it("keeps an element that still has other kids, dropping only the marker's key", async () => {
    const { doc, marker, link, linkRef, parentTree } = await markerDocument();
    const kid = link.get(PDFName.of("K"));

    assert.ok(kid);
    link.set(PDFName.of("K"), doc.context.obj([kid, 3]));
    TaggedStructure.of(doc)?.detach(marker);

    assert.equal(num(link.get(PDFName.of("K"))), 3);
    assert.ok(doc.context.lookup(linkRef) instanceof PDFDict);
    assert.deepEqual(nums(doc, parentTree), [0]);
  });

  it("prunes an emptied number-tree leaf and keeps /Limits exact", async () => {
    const { doc, marker, parentTree } = await markerDocument(true);

    TaggedStructure.of(doc)?.detach(marker);

    const kids = array(doc, parentTree.get(PDFName.of("Kids")));
    assert.equal(kids.size(), 1);
    const limits = array(doc, dict(doc, kids.get(0)).get(PDFName.of("Limits")));
    assert.deepEqual(limits.asArray().map(num), [0, 0]);
    assert.deepEqual(nums(doc, parentTree), [0]);
  });

  it("ignores an annotation the structure does not know", async () => {
    const { doc, parentTree } = await markerDocument();
    const other = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link" }));
    const structure = TaggedStructure.of(doc);

    assert.equal(structure?.slotFor(other), undefined);
    structure?.detach(other);
    assert.deepEqual(nums(doc, parentTree), [0, 1]);
  });

  it("never drops another object's entry for a wrong /StructParent", async () => {
    const { doc, marker, parentTree } = await markerDocument();

    dict(doc, marker).set(PDFName.of("StructParent"), PDFNumber.of(0));
    TaggedStructure.of(doc)?.detach(marker);

    // Key 0 is the page's content; key 1 pointed at the removed element.
    assert.deepEqual(nums(doc, parentTree), [0]);
  });

  it("drops the entry of a removed element even without /StructParent", async () => {
    const { doc, marker, parentTree } = await markerDocument();

    dict(doc, marker).delete(PDFName.of("StructParent"));
    TaggedStructure.of(doc)?.detach(marker);

    assert.deepEqual(nums(doc, parentTree), [0]);
  });

  it("gives no slot to an element outside the tree", async () => {
    const { doc, marker } = await markerDocument();

    dict(doc, doc.catalog.get(PDFName.of("StructTreeRoot"))).set(
      PDFName.of("K"),
      doc.context.obj([]),
    );

    assert.equal(TaggedStructure.of(doc)?.slotFor(marker), undefined);
  });

  it("rewrites indirect arrays in place, leaving no stale copy", async () => {
    const { doc, marker, linkRef, wrapper } = await markerDocument();
    const kidsRef = doc.context.register(doc.context.obj([0, linkRef]));

    wrapper.set(PDFName.of("K"), kidsRef);
    TaggedStructure.of(doc)?.detach(marker);

    assert.equal(wrapper.get(PDFName.of("K")), kidsRef);
    assert.deepEqual(array(doc, kidsRef).asArray().map(num), [0]);
  });
});
