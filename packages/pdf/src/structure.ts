/**
 * The tagged structure of a printed PDF, as far as fillable fields need it.
 *
 * Chromium prints a tagged PDF in both renderers. A field marker (the empty
 * link core puts over each control) is a /Link structure element whose only
 * kid is an object reference (OBJR) to the marker's link annotation; the
 * annotation's /StructParent key maps to that element in the ParentTree. The
 * page-scale marker and the hidden page-reference links are not in the
 * structure at all (the first is aria-hidden, the second display: none), so
 * removing them needs nothing here.
 *
 * When a marker becomes a widget, the marker's element is the widget's slot:
 * it becomes the widget's /Form element and the widget takes the marker's
 * key. A marker that yields no widget is detached: every OBJR to it and its
 * ParentTree entry are removed, and an element left empty is removed too.
 * Either way nothing in the structure refers to the marker afterwards, so the
 * annotation object can be deleted.
 */

import {
  PDFArray,
  PDFDict,
  type PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFObject,
  PDFRef,
} from "@folknor/pdf-lib";

const K = PDFName.of("K");
const P = PDFName.of("P");
const S = PDFName.of("S");
const TYPE = PDFName.of("Type");
const OBJ = PDFName.of("Obj");
const OBJR = PDFName.of("OBJR");
const NUMS = PDFName.of("Nums");
const KIDS = PDFName.of("Kids");
const LIMITS = PDFName.of("Limits");
const STRUCT_PARENT = PDFName.of("StructParent");

/** Where an OBJR to an annotation sits: in an element's kids. */
interface ObjrUse {
  element: PDFDict;
  /** The kid as stored in /K: the OBJR dictionary or a reference to it. */
  kid: PDFObject;
}

/** A marker's structure element, ready to be handed to its widget. */
export interface MarkerSlot {
  key: number;
  element: PDFDict;
}

export class TaggedStructure {
  private readonly doc: PDFDocument;
  private readonly root: PDFDict;
  /** Annotation ref -> every OBJR in the tree that points at it. */
  private readonly uses = new Map<PDFRef, ObjrUse[]>();
  /** Every element reached from the root through /K. */
  private readonly reached = new Set<PDFDict>();

  /** The document's structure, or undefined when it is not tagged. */
  static of(doc: PDFDocument): TaggedStructure | undefined {
    const root = doc.catalog.lookup(PDFName.of("StructTreeRoot"));

    return root instanceof PDFDict ? new TaggedStructure(doc, root) : undefined;
  }

  private constructor(doc: PDFDocument, root: PDFDict) {
    this.doc = doc;
    this.root = root;
    this.index(root);
  }

  /**
   * The marker annotation's slot, only when the structure has exactly the
   * shape Chromium prints: the annotation's key maps to an element whose
   * only kid is an OBJR to this annotation, and which is in the tree (reached
   * from the root), so the widget gets a place in the reading order.
   */
  slotFor(annotation: PDFRef): MarkerSlot | undefined {
    const key = this.keyOf(annotation);

    if (key === undefined) return;

    const element = this.doc.context.lookup(this.parentTreeGet(key));

    if (!(element instanceof PDFDict && this.reached.has(element))) return;

    const kids = this.kidsOf(element);
    const only = kids.length === 1 ? kids[0] : undefined;

    if (only === undefined || this.objrTarget(only) !== annotation) return;

    return { key, element };
  }

  /**
   * Make a marker's slot its widget's /Form element: one OBJR to the widget,
   * the widget taking the marker's key. `alt` describes the widget where the
   * field's /TU cannot (one option of a radio group).
   */
  give(slot: MarkerSlot, marker: PDFRef, widget: PDFRef, page: PDFRef, alt?: string): void {
    const { context } = this.doc;
    const widgetDict = context.lookup(widget);

    if (!(widgetDict instanceof PDFDict)) throw new Error("The widget is not an annotation.");

    // The slot's own OBJR is replaced below; any other OBJR to the marker
    // (not a shape Chromium prints) goes with the marker.
    const removed = this.dropUses(marker, slot.element);
    this.parentTreeDrop((_, value) => value instanceof PDFRef && removed.has(value));

    for (const kid of this.kidsOf(slot.element)) this.deleteIndirect(kid);

    slot.element.set(S, PDFName.of("Form"));
    this.setKids(slot.element, [context.obj({ Type: "OBJR", Obj: widget, Pg: page })]);

    if (alt) slot.element.set(PDFName.of("Alt"), PDFHexString.fromText(alt));

    widgetDict.set(STRUCT_PARENT, PDFNumber.of(slot.key));
  }

  /**
   * Remove every structure reference to an annotation that is going away:
   * each OBJR to it, any element that held only those OBJRs, and the
   * ParentTree entries of both - the annotation's own key only when it maps
   * to an element that referred to it, so a wrong /StructParent cannot take
   * another object's entry.
   */
  detach(annotation: PDFRef): void {
    const key = this.keyOf(annotation);
    const owners = new Set((this.uses.get(annotation) ?? []).map((use) => use.element));
    const removed = this.dropUses(annotation);

    this.parentTreeDrop((k, value) => {
      if (value instanceof PDFRef && removed.has(value)) return true;

      const element = this.doc.context.lookup(value);

      return k === key && element instanceof PDFDict && owners.has(element);
    });
  }

  /**
   * Remove the OBJRs to an annotation, except those in `keep`. Returns the
   * refs of the elements this left empty and removed.
   */
  private dropUses(annotation: PDFRef, keep?: PDFDict): Set<PDFRef> {
    const removed = new Set<PDFRef>();

    for (const { element, kid } of this.uses.get(annotation) ?? []) {
      if (element === keep) continue;

      const kids = this.kidsOf(element).filter((k) => k !== kid);
      this.deleteIndirect(kid);
      this.setKids(element, kids);

      if (kids.length === 0) {
        const ref = this.removeElement(element);

        if (ref) removed.add(ref);
      }
    }

    this.uses.delete(annotation);

    return removed;
  }

  private keyOf(annotation: PDFRef): number | undefined {
    const dict = this.doc.context.lookup(annotation);
    const key = dict instanceof PDFDict ? dict.get(STRUCT_PARENT) : undefined;

    return key instanceof PDFNumber ? key.asNumber() : undefined;
  }

  /** Record every OBJR under a structure node. */
  private index(node: PDFDict): void {
    if (this.reached.has(node)) return;
    this.reached.add(node);

    for (const kid of this.kidsOf(node)) {
      const target = this.objrTarget(kid);

      if (target) {
        const list = this.uses.get(target) ?? [];
        list.push({ element: node, kid });
        this.uses.set(target, list);
        continue;
      }

      const child = this.doc.context.lookup(kid);

      // Marked-content references carry /MCID and are content, not elements.
      if (child instanceof PDFDict && child.has(S)) this.index(child);
    }
  }

  /** The annotation an /K entry refers to, when it is an OBJR. */
  private objrTarget(kid: PDFObject): PDFRef | undefined {
    const dict = this.doc.context.lookup(kid);

    if (!(dict instanceof PDFDict && dict.get(TYPE) === OBJR)) return;

    const obj = dict.get(OBJ);

    return obj instanceof PDFRef ? obj : undefined;
  }

  /** A node's /K as a list (it may be absent, one kid, or an array). */
  private kidsOf(node: PDFDict): PDFObject[] {
    const k = node.get(K);

    if (k === undefined) return [];

    const resolved = this.doc.context.lookup(k);

    return resolved instanceof PDFArray ? resolved.asArray() : [k];
  }

  private setKids(node: PDFDict, kids: PDFObject[]): void {
    if (kids.length === 0) {
      this.deleteIndirect(node.get(K));
      node.delete(K);
    } else if (kids.length === 1 && kids[0] !== undefined && !(node.get(K) instanceof PDFRef)) {
      node.set(K, kids[0]);
    } else {
      this.writeArray(node, K, kids);
    }
  }

  /**
   * Set an array entry. An indirect array is rewritten in place, so no
   * displaced copy holding removed refs is left in the file (the fork writes
   * every registered object, referenced or not).
   */
  private writeArray(owner: PDFDict, key: PDFName, items: PDFObject[]): void {
    const raw = owner.get(key);
    const existing = raw instanceof PDFRef ? this.doc.context.lookup(raw) : undefined;

    if (existing instanceof PDFArray) {
      while (existing.size() > 0) existing.remove(0);

      for (const item of items) existing.push(item);
    } else {
      owner.set(key, this.doc.context.obj(items));
    }
  }

  /** Take an empty element out of its parent's kids and delete it. */
  private removeElement(element: PDFDict): PDFRef | undefined {
    const ref = this.doc.context.getObjectRef(element);
    const parent = this.doc.context.lookup(element.get(P));

    if (parent instanceof PDFDict) {
      this.setKids(
        parent,
        this.kidsOf(parent).filter((kid) => kid !== ref && kid !== element),
      );
    }

    this.reached.delete(element);

    if (ref) this.doc.context.delete(ref);

    return ref;
  }

  private deleteIndirect(kid: PDFObject | undefined): void {
    if (kid instanceof PDFRef) this.doc.context.delete(kid);
  }

  private parentTreeGet(
    key: number,
    node: PDFObject | undefined = this.root.get(PDFName.of("ParentTree")),
  ): PDFObject | undefined {
    const dict = this.doc.context.lookup(node);

    if (!(dict instanceof PDFDict)) return;

    const nums = dict.lookup(NUMS);

    if (nums instanceof PDFArray) {
      for (let i = 0; i + 1 < nums.size(); i += 2) {
        const k = nums.get(i);

        if (k instanceof PDFNumber && k.asNumber() === key) return nums.get(i + 1);
      }
    }

    const kids = dict.lookup(KIDS);

    if (!(kids instanceof PDFArray)) return;

    for (const kid of kids.asArray()) {
      const found = this.parentTreeGet(key, kid);

      if (found !== undefined) return found;
    }

    return;
  }

  /** Remove the ParentTree entries `drop` picks. */
  private parentTreeDrop(drop: (key: number, value: PDFObject) => boolean): void {
    this.numberTreeDrop(this.root.get(PDFName.of("ParentTree")), drop);
  }

  /**
   * Remove entries from a number tree, keeping every /Limits exact and
   * pruning (and deleting) child nodes left empty; the root is kept. Returns
   * the node's remaining [least, greatest] keys, or undefined when empty.
   */
  private numberTreeDrop(
    node: PDFObject | undefined,
    drop: (key: number, value: PDFObject) => boolean,
  ): [number, number] | undefined {
    const dict = this.doc.context.lookup(node);

    if (!(dict instanceof PDFDict)) return;

    let least = Infinity;
    let greatest = -Infinity;
    const nums = dict.lookup(NUMS);

    if (nums instanceof PDFArray) {
      const kept: PDFObject[] = [];

      for (let i = 0; i + 1 < nums.size(); i += 2) {
        const k = nums.get(i);
        const v = nums.get(i + 1);

        if (!(k instanceof PDFNumber) || v === undefined) continue;

        if (drop(k.asNumber(), v)) continue;

        kept.push(k, v);
        least = Math.min(least, k.asNumber());
        greatest = Math.max(greatest, k.asNumber());
      }

      this.writeArray(dict, NUMS, kept);
    }

    const kids = dict.lookup(KIDS);

    if (kids instanceof PDFArray) {
      const kept: PDFObject[] = [];

      for (const kid of kids.asArray()) {
        const range = this.numberTreeDrop(kid, drop);

        if (!range) {
          this.deleteIndirect(kid);
          continue;
        }

        kept.push(kid);
        least = Math.min(least, range[0]);
        greatest = Math.max(greatest, range[1]);
      }

      this.writeArray(dict, KIDS, kept);
    }

    if (least > greatest) return;

    if (dict.has(LIMITS)) dict.set(LIMITS, this.doc.context.obj([least, greatest]));

    return [least, greatest];
  }
}
