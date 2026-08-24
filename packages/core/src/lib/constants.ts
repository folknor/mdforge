/**
 * Document constants and inline arithmetic.
 *
 * Constants are declared in front-matter (or a config file) and referenced from
 * the document with `{{ ... }}`:
 *
 *   ---
 *   constants:
 *     rate: 290
 *   ---
 *   Normal {{ rate }} NOK/t, overtime {{ rate * 1.5 }} NOK/t.
 *
 * The point is single-sourcing: a figure that appears in twenty places and in a
 * dozen derived sums is defined once, so changing it can't leave the document
 * internally inconsistent.
 *
 * Expressions support + - * / %, parentheses and unary minus over numbers and
 * constant names. There is no `eval` here and no access to anything outside the
 * declared constants — the parser below is the whole language.
 */

/** A constant's declared value. */
export type ConstantValue = number | string;

export interface ConstantsOptions {
  /**
   * BCP 47 locale used to format numeric results, e.g. "nb-NO" → `15 000`.
   * When unset, numbers are rendered bare (`15000`).
   */
  locale?: string;
  /** Maximum fraction digits in a formatted result. Default: 2. */
  precision?: number;
}

export interface ConstantsResult {
  content: string;
  warnings: string[];
}

/**
 * Matches, in priority order: fenced code blocks, inline code spans and escaped
 * openers (all passed through untouched, group 1), then `{{ expression }}`
 * (group 2). Ordered alternation plus left-to-right scanning is what keeps
 * placeholders inside code examples from being substituted.
 */
const SCAN_REGEX =
  /(^```[^\n]*\n[\s\S]*?^```|^~~~[^\n]*\n[\s\S]*?^~~~|`+[^`\n]*`+|\\\{\{)|\{\{([^{}]+)\}\}/gm;

const NUMBER_REGEX = /\d+(?:\.\d+)?/y;
const IDENT_REGEX = /[A-Za-z_][A-Za-z0-9_]*/y;
const BARE_IDENT_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Raised for a malformed expression or an unknown name; reported per placeholder. */
class ExpressionError extends Error {}

/**
 * Recursive-descent evaluator.
 *
 * expr   := term (('+' | '-') term)*
 * term   := unary (('*' | '/' | '%') unary)*
 * unary  := '-' unary | '+' unary | primary
 * primary := number | identifier | '(' expr ')'
 */
class Evaluator {
  private pos = 0;

  constructor(
    private readonly source: string,
    private readonly constants: Record<string, ConstantValue>,
  ) {}

  evaluate(): number {
    const value = this.parseExpression();
    this.skipWhitespace();
    if (this.pos < this.source.length) {
      throw new ExpressionError(
        `unexpected "${this.source.slice(this.pos).trim()}"`,
      );
    }
    return value;
  }

  private skipWhitespace(): void {
    while (
      this.pos < this.source.length &&
      /\s/.test(this.source[this.pos] ?? "")
    ) {
      this.pos++;
    }
  }

  /** Consume `op` if it is the next non-space character. */
  private eat(op: string): boolean {
    this.skipWhitespace();
    if (this.source[this.pos] === op) {
      this.pos++;
      return true;
    }
    return false;
  }

  private parseExpression(): number {
    let value = this.parseTerm();
    for (;;) {
      if (this.eat("+")) {
        value += this.parseTerm();
      } else if (this.eat("-")) {
        value -= this.parseTerm();
      } else {
        return value;
      }
    }
  }

  private parseTerm(): number {
    let value = this.parseUnary();
    for (;;) {
      if (this.eat("*")) {
        value *= this.parseUnary();
      } else if (this.eat("/")) {
        const divisor = this.parseUnary();
        if (divisor === 0) {
          throw new ExpressionError("division by zero");
        }
        value /= divisor;
      } else if (this.eat("%")) {
        const divisor = this.parseUnary();
        if (divisor === 0) {
          throw new ExpressionError("division by zero");
        }
        value %= divisor;
      } else {
        return value;
      }
    }
  }

  private parseUnary(): number {
    if (this.eat("-")) return -this.parseUnary();
    if (this.eat("+")) return this.parseUnary();
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();

    if (this.eat("(")) {
      const value = this.parseExpression();
      if (!this.eat(")")) {
        throw new ExpressionError("missing closing parenthesis");
      }
      return value;
    }

    NUMBER_REGEX.lastIndex = this.pos;
    const number = NUMBER_REGEX.exec(this.source);
    if (number) {
      this.pos = NUMBER_REGEX.lastIndex;
      return Number(number[0]);
    }

    IDENT_REGEX.lastIndex = this.pos;
    const ident = IDENT_REGEX.exec(this.source);
    if (ident) {
      this.pos = IDENT_REGEX.lastIndex;
      return this.lookup(ident[0]);
    }

    const rest = this.source.slice(this.pos).trim();
    throw new ExpressionError(
      rest ? `unexpected "${rest}"` : "unexpected end of expression",
    );
  }

  private lookup(name: string): number {
    if (!(name in this.constants)) {
      throw new ExpressionError(`unknown constant "${name}"`);
    }
    const value = this.constants[name];
    if (typeof value !== "number") {
      throw new ExpressionError(
        `constant "${name}" is text and can't be used in arithmetic`,
      );
    }
    return value;
  }
}

/** Render a numeric result, grouping digits when a locale is configured. */
function formatNumber(
  value: number,
  { locale, precision = 2 }: ConstantsOptions,
): string {
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;

  if (!locale) {
    return String(rounded);
  }

  try {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: precision,
    }).format(rounded);
  } catch {
    // Bad locale tag — reported once by the caller, not per placeholder
    return String(rounded);
  }
}

/**
 * Substitute `{{ ... }}` placeholders in markdown.
 *
 * A placeholder that can't be resolved is left in the output verbatim and
 * reported as a warning: a visible `{{ rate }}` in the PDF is a far better
 * failure than a silently blank or wrong figure in a rate table.
 */
export function processConstants(
  content: string,
  constants: Record<string, ConstantValue> | undefined,
  options: ConstantsOptions = {},
): ConstantsResult {
  const warnings: string[] = [];

  if (!constants || Object.keys(constants).length === 0) {
    return { content, warnings };
  }

  if (options.locale) {
    try {
      new Intl.NumberFormat(options.locale);
    } catch {
      warnings.push(
        `Invalid constants_locale "${options.locale}" — numbers will be unformatted`,
      );
    }
  }

  const seen = new Set<string>();

  const result = content.replace(
    SCAN_REGEX,
    (
      match,
      passthrough: string | undefined,
      expression: string | undefined,
    ) => {
      if (passthrough !== undefined) {
        // `\{{` is the escape hatch for a literal placeholder
        return passthrough === "\\{{" ? "{{" : passthrough;
      }
      if (expression === undefined) {
        return match;
      }

      const trimmed = expression.trim();

      // A bare name may resolve to text; anything else must be arithmetic
      if (BARE_IDENT_REGEX.test(trimmed)) {
        const value = constants[trimmed];
        if (typeof value === "string") {
          return value;
        }
      }

      try {
        return formatNumber(
          new Evaluator(trimmed, constants).evaluate(),
          options,
        );
      } catch (error) {
        const reason =
          error instanceof ExpressionError ? error.message : String(error);
        const warning = `{{ ${trimmed} }}: ${reason}`;
        if (!seen.has(warning)) {
          seen.add(warning);
          warnings.push(warning);
        }
        return match;
      }
    },
  );

  return { content: result, warnings };
}
