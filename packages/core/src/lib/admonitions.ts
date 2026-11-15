import type { MarkedExtension, Token, Tokens } from "marked";
import { escapeHtml } from "./util.ts";

/**
 * Supported admonition types
 */
const ADMONITION_TYPES = [
  "note",
  "tip",
  "info",
  "warning",
  "danger",
  "caution",
  "important",
  "success",
  "failure",
  "bug",
  "example",
  "quote",
  "abstract",
  "question",
] as const;

type AdmonitionType = (typeof ADMONITION_TYPES)[number];

function isAdmonitionType(value: string): value is AdmonitionType {
  return ADMONITION_TYPES.some((type) => type === value);
}

/** Token produced by the admonition tokenizer and consumed by its renderer. */
interface AdmonitionToken extends Tokens.Generic {
  type: "admonition";
  admonitionType: AdmonitionType;
  title: string;
  tokens: Token[];
}

/**
 * Marked extension for admonitions using Python-Markdown syntax.
 *
 * Syntax:
 * ```
 * !!! note
 *     This is a note admonition.
 *
 * !!! warning "Custom Title"
 *     This is a warning with a custom title.
 *
 * !!! danger ""
 *     This admonition has no title.
 * ```
 *
 * Supported types: note, tip, info, warning, danger, caution, important,
 * success, failure, bug, example, quote, abstract, question
 */
export function admonitions(): MarkedExtension {
  // Pattern to match admonition start: !!! type ["optional title"]
  const startPattern = /^!{3}\s+(\w+)(?:\s+"([^"]*)")?\s*\n/;

  return {
    extensions: [
      {
        name: "admonition",
        level: "block",
        start(src: string): number | undefined {
          const match = src.match(startPattern);

          return match?.index;
        },
        tokenizer(
          this: {
            lexer: { blockTokens: (src: string, tokens: Token[]) => Token[] };
          },
          src: string,
        ): AdmonitionToken | undefined {
          const match = startPattern.exec(src);

          if (!match) return;

          const typeRaw = match[1]?.toLowerCase() ?? "note";

          const type = isAdmonitionType(typeRaw) ? typeRaw : "note";

          // Title: custom if provided, empty string means no title, undefined means use type
          const customTitle = match[2];

          const title =
            customTitle !== undefined ? customTitle : type.charAt(0).toUpperCase() + type.slice(1);

          // Find the content block (indented lines)
          const afterHeader = src.slice(match[0].length);
          const contentLines: string[] = [];
          const lines = afterHeader.split("\n");

          for (const line of lines) {
            // Content lines must be indented (4 spaces or 1 tab) or empty
            if (line === "" || /^(?: {4}|\t)/.test(line)) {
              // Remove the indentation
              contentLines.push(line.replace(/^(?: {4}|\t)/, ""));
            } else {
              break;
            }
          }

          // Remove trailing empty lines
          while (contentLines.length > 0 && contentLines[contentLines.length - 1] === "") {
            contentLines.pop();
          }

          const content = contentLines.join("\n");

          const raw =
            match[0] +
            lines.slice(0, contentLines.length).join("\n") +
            (contentLines.length > 0 ? "\n" : "");

          // Parse content as markdown tokens
          const contentTokens: Token[] = [];
          this.lexer.blockTokens(content, contentTokens);

          return {
            type: "admonition",
            raw,
            admonitionType: type,
            title,
            tokens: contentTokens,
          };
        },
        renderer(
          this: { parser: { parse: (tokens: Token[]) => string } },
          token: Tokens.Generic,
        ): string {
          // SAFETY: marked dispatches this renderer only for tokens whose
          // `type` is "admonition", and only the tokenizer above creates
          // them, always as an AdmonitionToken.
          const { admonitionType, title, tokens } = token as AdmonitionToken;

          const titleHtml = title ? `<p class="admonition-title">${escapeHtml(title)}</p>\n` : "";

          const contentHtml = this.parser.parse(tokens);

          return `<div class="admonition ${escapeHtml(admonitionType)}">\n${titleHtml}${contentHtml}</div>\n`;
        },
      },
    ],
  };
}

/**
 * CSS for admonitions - provides styling for all admonition types.
 */
export const admonitionsCss = `
/* Admonition base styles */
.admonition {
  margin: 1em 0;
  padding: 0.75em 1em;
  border-left: 4px solid var(--admonition-color, #448aff);
  background: var(--admonition-bg, #f5f8ff);
  border-radius: 0 4px 4px 0;
}

.admonition-title {
  font-weight: 600;
  margin: 0 0 0.5em 0;
  color: var(--admonition-color, #448aff);
}

.admonition > :last-child {
  margin-bottom: 0;
}

/* Note - blue */
.admonition.note {
  --admonition-color: #448aff;
  --admonition-bg: #f5f8ff;
}

/* Tip - green */
.admonition.tip {
  --admonition-color: #00c853;
  --admonition-bg: #f0fff4;
}

/* Info - cyan */
.admonition.info {
  --admonition-color: #00b8d4;
  --admonition-bg: #f0fcff;
}

/* Warning - orange */
.admonition.warning,
.admonition.caution {
  --admonition-color: #ff9100;
  --admonition-bg: #fff8f0;
}

/* Danger - red */
.admonition.danger,
.admonition.failure,
.admonition.bug {
  --admonition-color: #ff5252;
  --admonition-bg: #fff5f5;
}

/* Important - purple */
.admonition.important {
  --admonition-color: #7c4dff;
  --admonition-bg: #f8f5ff;
}

/* Success - green */
.admonition.success {
  --admonition-color: #00c853;
  --admonition-bg: #f0fff4;
}

/* Example - purple */
.admonition.example {
  --admonition-color: #7c4dff;
  --admonition-bg: #f8f5ff;
}

/* Quote - gray */
.admonition.quote,
.admonition.abstract {
  --admonition-color: #9e9e9e;
  --admonition-bg: #fafafa;
}

/* Question - cyan */
.admonition.question {
  --admonition-color: #64ffda;
  --admonition-bg: #f0fffc;
}

/* Print styles */
@media print {
  .admonition {
    break-inside: avoid;
    border-left-width: 3px;
  }
}
`;
