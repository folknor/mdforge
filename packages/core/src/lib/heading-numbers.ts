/**
 * Heading number format options (same as page number formats).
 */
export type HeadingNumberFormat =
  | "arabic" // 1, 2, 3 (default)
  | "roman" // i, ii, iii
  | "roman-upper" // I, II, III
  | "alpha" // a, b, c
  | "alpha-upper"; // A, B, C

export interface HeadingNumbersConfig {
  /**
   * Format for heading numbers. Default: "arabic"
   */
  format?: HeadingNumberFormat;
  /**
   * Starting depth level (1-6). Headings above this level won't be numbered.
   * Default: 2 (starts numbering at h2)
   */
  start_depth?: number;
  /**
   * Maximum depth level to number (1-6). Headings below this level won't be numbered.
   * Default: 6
   */
  max_depth?: number;
  /**
   * Separator between number levels. Default: "."
   */
  separator?: string;
  /**
   * Skip numbering the first h1 (usually the document title). Default: true
   */
  skip_first_h1?: boolean;
}

/**
 * Convert a number to roman numerals.
 */
function toRoman(num: number): string {
  const romanNumerals: [number, string][] = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];

  let result = "";
  let remaining = num;

  for (const [value, numeral] of romanNumerals) {
    while (remaining >= value) {
      result += numeral;
      remaining -= value;
    }
  }

  return result;
}

/**
 * Convert a number to alphabetic (a, b, c, ..., z, aa, ab, ...).
 */
function toAlpha(num: number): string {
  let result = "";
  let n = num;

  while (n > 0) {
    n--;
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }

  return result;
}

/**
 * Format a number according to the specified format.
 */
function formatNumber(num: number, format: HeadingNumberFormat): string {
  switch (format) {
    case "roman":
      return toRoman(num);
    case "roman-upper":
      return toRoman(num).toUpperCase();
    case "alpha":
      return toAlpha(num);
    case "alpha-upper":
      return toAlpha(num).toUpperCase();
    default:
      return String(num);
  }
}

/**
 * Hierarchical heading counter.
 *
 * Driven by the heading renderer (outline.ts), the one place headings are
 * numbered; the TOC and `@numberof` read the numbers it handed out. It is
 * stateful: feed it every heading of the document, in document order, exactly
 * once — including headings it will not number, since they still affect the
 * first-h1 tracking.
 */
export class HeadingNumberer {
  private readonly format: HeadingNumberFormat;
  private readonly startDepth: number;
  private readonly maxDepth: number;
  private readonly separator: string;
  private readonly skipFirstH1: boolean;

  /** Counter per heading level (1-6). */
  private readonly counters = [0, 0, 0, 0, 0, 0];
  private firstH1Seen = false;
  /**
   * True while the level-1 counter holds a stand-in for a skipped first h1:
   * its sections need a parent number ("1.1.", not "0.1."), but the skipped
   * heading itself must not consume one, so the next real h1 is still "1.".
   */
  private phantomH1 = false;

  constructor(config: HeadingNumbersConfig = {}) {
    const {
      format = "arabic",
      start_depth = 2,
      max_depth = 6,
      separator = ".",
      skip_first_h1 = true,
    } = config;

    this.format = format;
    this.startDepth = start_depth;
    this.maxDepth = max_depth;
    this.separator = separator;
    this.skipFirstH1 = skip_first_h1;
  }

  /**
   * Advance the counters for a heading and return its number prefix, including
   * the trailing separator (e.g. `"8."` or `"2.3."`). Returns `undefined` when
   * the heading falls outside the configured depth range.
   */
  public next(depth: number): string | undefined {
    const shouldNumber =
      depth >= this.startDepth &&
      depth <= this.maxDepth &&
      !(this.skipFirstH1 && depth === 1 && !this.firstH1Seen);

    if (depth === 1) {
      this.firstH1Seen = true;
    }

    if (!shouldNumber) {
      // A skipped first h1 still parents the sections under it, so give it a
      // stand-in number when level 1 is part of the printed prefix.
      if (depth === 1 && this.startDepth === 1) {
        this.counters[0] = 1;
        this.phantomH1 = true;
      }

      return undefined;
    }

    // Reset deeper level counters when a shallower heading appears
    for (let i = depth; i < 6; i++) {
      this.counters[i] = 0;
    }

    const counterIndex = depth - 1;

    // The stand-in was never a real number, so the first numbered h1 takes it
    // over rather than following it.
    if (depth === 1 && this.phantomH1) {
      this.counters[0] = 0;
      this.phantomH1 = false;
    }

    this.counters[counterIndex] = (this.counters[counterIndex] ?? 0) + 1;

    // Build the number prefix from start_depth to current depth
    const numberParts: string[] = [];

    for (let i = this.startDepth - 1; i < depth; i++) {
      numberParts.push(formatNumber(this.counters[i] ?? 0, this.format));
    }

    return `${numberParts.join(this.separator)}${this.separator}`;
  }

  /**
   * Advance the counters and return the heading text with its number prefix,
   * exactly as it will be rendered.
   */
  public apply(depth: number, text: string): string {
    const prefix = this.next(depth);

    return prefix === undefined ? text : `${prefix} ${text}`;
  }
}
