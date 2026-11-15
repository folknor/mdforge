/**
 * What a PDF is printed with: `pdf_options` turned into one browser-neutral
 * specification, in inches, which every renderer's driver passes to its
 * browser as it stands. The meaning of each option, and its default, is
 * decided here and nowhere else.
 *
 * The semantics are Puppeteer's page.pdf() ones (the options were documented
 * as those), so the CLI's output did not change when they moved here: a
 * `format` overrides `width` and `height`; width and height fall back
 * independently to Letter's; a number, or a string without a unit, is CSS
 * pixels; margins default to 0.
 */

import type { PdfLength, PdfOptions } from "@mdforge/core";

export interface PrintMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PrintSpec {
  /** Paper size in inches, before `landscape` turns it */
  paperWidth: number;
  paperHeight: number;
  /** Inches */
  margin: PrintMargins;
  landscape: boolean;
  scale: number;
  printBackground: boolean;
  displayHeaderFooter: boolean;
  headerTemplate: string;
  footerTemplate: string;
  /** Chromium's page-range syntax; empty means every page */
  pageRanges: string;
  preferCSSPageSize: boolean;
}

/** Paper sizes in inches (Puppeteer's table). */
const PAPER_INCHES = {
  letter: { width: 8.5, height: 11 },
  legal: { width: 8.5, height: 14 },
  tabloid: { width: 11, height: 17 },
  ledger: { width: 17, height: 11 },
  a0: { width: 33.1102, height: 46.811 },
  a1: { width: 23.3858, height: 33.1102 },
  a2: { width: 16.5354, height: 23.3858 },
  a3: { width: 11.6929, height: 16.5354 },
  a4: { width: 8.2677, height: 11.6929 },
  a5: { width: 5.8268, height: 8.2677 },
  a6: { width: 4.1339, height: 5.8268 },
} as const;

/** CSS pixels per unit. */
const PIXELS_PER_UNIT = new Map<string, number>([
  ["px", 1],
  ["in", 96],
  ["cm", 96 / 2.54],
  ["mm", 96 / 25.4],
  ["pt", 96 / 72],
  ["pc", 16],
]);

/** How long one print may take when `pdf_options.timeout` is not set. */
export const DEFAULT_PRINT_TIMEOUT_MS = 30_000;

/** A length in inches; undefined when absent. */
export function lengthInInches(value: PdfLength | undefined): number | undefined {
  if (value === undefined) return undefined;

  // A number's text never ends in a unit, so it reads as pixels too.
  const text = String(value);
  const perUnit = PIXELS_PER_UNIT.get(text.slice(-2).toLowerCase());
  const number = Number(perUnit === undefined ? text : text.slice(0, -2));

  if (Number.isNaN(number)) {
    throw new Error(`Invalid length in pdf_options: ${JSON.stringify(value)}`);
  }

  return (number * (perUnit ?? 1)) / 96;
}

/** The print specification for a conversion's PDF options. */
export function printSpec(options: PdfOptions): PrintSpec {
  let paperWidth: number;
  let paperHeight: number;

  if (options.format) {
    ({ width: paperWidth, height: paperHeight } = PAPER_INCHES[options.format]);
  } else {
    paperWidth = lengthInInches(options.width) ?? PAPER_INCHES.letter.width;
    paperHeight = lengthInInches(options.height) ?? PAPER_INCHES.letter.height;
  }

  const { margin } = options;

  return {
    paperWidth,
    paperHeight,
    margin: {
      top: lengthInInches(margin?.top) || 0,
      right: lengthInInches(margin?.right) || 0,
      bottom: lengthInInches(margin?.bottom) || 0,
      left: lengthInInches(margin?.left) || 0,
    },
    landscape: options.landscape ?? false,
    scale: options.scale ?? 1,
    printBackground: options.printBackground ?? false,
    displayHeaderFooter: options.displayHeaderFooter ?? false,
    headerTemplate: options.headerTemplate ?? "",
    footerTemplate: options.footerTemplate ?? "",
    pageRanges: options.pageRanges ?? "",
    preferCSSPageSize: options.preferCSSPageSize ?? false,
  };
}

/** The same specification printing every page. */
export function wholeDocument(spec: PrintSpec): PrintSpec {
  return { ...spec, pageRanges: "" };
}
