import { randomBytes } from "node:crypto";
import type { MarkedExtension, Token, Tokens, TokensList } from "marked";
import { HeadingNumberer, type HeadingNumbersConfig } from "./heading-numbers.ts";
import { HeadingIdAssigner, referenceSlug } from "./slugger.ts";
import { renderToc, type TOCOptions } from "./toc.ts";
import { escapeHtml } from "./util.ts";

/**
 * The document outline: heading ids and numbers, the table of contents, and
 * `@numberof(...)`.
 *
 * The heading renderer is the only thing that assigns heading ids and numbers.
 * Everything else that needs them - TOC links, TOC page references,
 * `@numberof` - reads what it recorded during the same render, so they can
 * never disagree with the rendered `id` attributes. Ids are slugged from the
 * rendered inline HTML, so `## [Alpha](https://example.org)` is `alpha` for
 * its heading and its TOC link alike. Headings nested in blockquotes, lists or
 * admonitions get ids and numbers like any other (they are rendered) but are
 * not listed in the TOC.
 *
 * Contract for `config.marked_extensions`: a heading rendered by an extension
 * that replaces mdforge's heading renderer is outside the outline (no id from
 * mdforge, not in the TOC, not reachable by `@numberof`). Extensions must not
 * insert, clone or reorder heading tokens after lexing, must lex without side
 * effects (the TOC marker search lexes the document once more), and must not
 * insert synthetic top-level tokens whose raw text matches the source at that
 * point (or after whitespace there).
 */

/** One rendered heading, as recorded by the heading renderer. */
interface OutlineHeading {
  depth: number;
  id: string;
  /** Number without trailing separator (`7.1`), when the heading is numbered. */
  number: string | undefined;
  /** Number prefix plus the projected label HTML, for the TOC. */
  label: string;
  /** Whether the heading is a direct child of the document. */
  topLevel: boolean;
}

const TOC_OPEN = "<!-- toc -->";
const TOC_CLOSE = /^<!-- toc\s*stop -->$/;

/** Elements whose content is not text and never belongs in a TOC label. */
const RAW_TEXT_ELEMENTS = /^<(script|style|textarea|title|noscript)(?=[\s/>])/i;

/** Mutable state of one render of one document. */
class Outline {
  readonly headings: OutlineHeading[] = [];
  /** Number of headings rendered before the TOC sentinel, once it is seen. */
  tocAt: number | undefined;
  /** Whether the marker search placed a TOC sentinel in the source. */
  tocPlaced = false;
  readonly topLevelHeadings = new WeakSet<Token>();

  /** Per-render nonce, so neither markers nor sentinel can be forged by input. */
  private readonly nonce = randomBytes(8).toString("hex");
  readonly tocSentinel = `<!-- mdforge-toc ${this.nonce} -->`;
  /** `@numberof` side table: the marker index is the position here. */
  private readonly references: { slug: string; source: string }[] = [];
  private readonly referenceMarkers = new WeakMap<Token, string>();
  private readonly markerPattern = new RegExp(`\uE000${this.nonce}:(\\d+)\uE001`, "g");

  /**
   * The opaque marker standing in for one `@numberof` until the numbers are
   * known. Private-use characters pass through marked unescaped, so the
   * marker survives in element text and in attribute values (image alt) alike.
   */
  referenceMarker(token: Token, ref: string, source: string): string {
    const known = this.referenceMarkers.get(token);

    if (known !== undefined) {
      return known;
    }

    const marker = `\uE000${this.nonce}:${this.references.length}\uE001`;
    this.references.push({ slug: referenceSlug(ref), source });
    this.referenceMarkers.set(token, marker);

    return marker;
  }

  /** Text with every reference marker removed, for slugging. */
  withoutMarkers(text: string): string {
    return text.replace(this.markerPattern, "");
  }

  /**
   * Replace every reference marker with its heading's number, or with the
   * original directive when nothing answers it. A visible `@numberof(...)` is a
   * defect the author will notice; a blank would silently falsify the text.
   */
  resolveMarkers(html: string): string {
    const numbers = new Map<string, string>();

    for (const heading of this.headings) {
      if (heading.number !== undefined && !numbers.has(heading.id)) {
        numbers.set(heading.id, heading.number);
      }
    }

    return html.replace(this.markerPattern, (match, index: string) => {
      const reference = this.references[Number(index)];

      if (reference === undefined) {
        return match;
      }

      return escapeHtml(numbers.get(reference.slug) ?? reference.source);
    });
  }
}

/** Drop the trailing level separator from a heading number prefix. */
function trimTrailingSeparator(prefix: string, separator: string): string {
  return separator && prefix.endsWith(separator) ? prefix.slice(0, -separator.length) : prefix;
}

/**
 * Where a top-level token's raw text starts in the source, at or just after
 * `cursor`, or -1 when it is not there (a synthetic token).
 */
function sourceStart(text: string, raw: string, cursor: number): number {
  let start = cursor;

  // marked emits no token for some whitespace (a leading newline, say).
  while (!text.startsWith(raw, start) && /\s/.test(text.charAt(start))) {
    start++;
  }

  return raw !== "" && text.startsWith(raw, start) ? start : -1;
}

/**
 * Find the document-level TOC markers and replace the marked region with the
 * render's sentinel, before the real lexer sees the source. A stale TOC body
 * between `<!-- toc -->` and `<!-- tocstop -->` is cut here, so it is never
 * lexed: its footnotes and link definitions cannot leak into the document.
 *
 * Only top-level HTML blocks consisting of exactly a marker count. A marker in
 * a code block, a raw HTML block or a container (blockquote, list, admonition)
 * is ordinary text.
 */
function placeTocSentinel(
  source: string,
  lex: (src: string) => TokensList,
  outline: Outline,
): string {
  if (!source.includes(TOC_OPEN)) {
    return source;
  }

  // marked normalises line endings before lexing; offsets are into that text.
  const text = source.replace(/\r\n|\r/g, "\n");
  let cursor = 0;
  let open: { start: number; end: number } | undefined;
  let close: { end: number } | undefined;

  for (const token of lex(text)) {
    // marked-footnote adds a synthetic aggregate token that consumes no
    // source. Any other token not found at the cursor is synthetic too.
    const start = token.type === "footnotes" ? -1 : sourceStart(text, token.raw, cursor);

    if (start < 0) {
      continue;
    }

    cursor = start + token.raw.length;

    if (token.type !== "html") {
      continue;
    }

    const marker = token.raw.trim();

    if (marker === TOC_OPEN) {
      if (open) {
        throw new Error("mdforge only supports one Table of Contents per file.");
      }

      open = { start, end: cursor };
    } else if (open && !close && TOC_CLOSE.test(marker)) {
      close = { end: cursor };
    }
  }

  if (text.slice(cursor).trim() !== "") {
    throw new Error(
      "Could not locate the <!-- toc --> marker: a configured marked extension changed the lexed source.",
    );
  }

  if (!open) {
    return text;
  }

  outline.tocPlaced = true;
  const end = close ? close.end : open.end;

  return `${text.slice(0, open.start)}${outline.tocSentinel}\n\n${text.slice(end)}`;
}

/**
 * Projected label HTML without its tags, still escaped, so it stays safe to
 * emit as HTML. The projector emits only bare tags, so this cannot misparse.
 */
function withoutTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * Whether projected label HTML shows nothing. Character references are decoded
 * for this check only; the decoded text is never emitted.
 */
function isBlank(html: string): boolean {
  return (
    withoutTags(html)
      .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
        const point =
          code.startsWith("x") || code.startsWith("X")
            ? Number.parseInt(code.slice(1), 16)
            : Number(code);

        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "?";
      })
      .replace(/&(?:nbsp|ensp|emsp|thinsp|hairsp|numsp|puncsp|MediumSpace|Tab|NewLine);/g, " ")
      .trim() === ""
  );
}

/**
 * The TOC label for a heading, projected from its inline tokens without
 * running any renderer a second time (renderers may be stateful, and their
 * output carries ids, links and form fields that must not be duplicated).
 * Formatting is kept, links are unwrapped, images become their alt text,
 * footnote references disappear, form fields become their label, and raw HTML
 * is dropped - including the content of script/style-like elements.
 */
function projectLabel(tokens: readonly Token[], outline: Outline): string {
  let suppressUntil: RegExp | undefined;

  const project = (list: readonly Token[]): string => {
    let out = "";

    for (const token of list) {
      if (suppressUntil) {
        if (token.type === "html" && suppressUntil.test(token.raw)) {
          suppressUntil = undefined;
        }

        continue;
      }

      out += projectToken(token);
    }

    return out;
  };

  const projectToken = (token: Token): string => {
    switch (token.type) {
      // Formatting is kept, always without attributes.
      case "strong":
      case "em":
      case "del":
        return `<${token.type}>${project(token.tokens ?? [])}</${token.type}>`;

      case "escape":
        return escapeHtml(token.text);

      case "text": {
        if ("tokens" in token && token.tokens) {
          return project(token.tokens);
        }

        return "escaped" in token && token.escaped ? token.text : escapeHtml(token.text);
      }

      case "codespan":
        return `<code>${escapeHtml(token.text)}</code>`;

      // `tokens` is optional only because Token includes Tokens.Generic.
      case "link":
        return project(token.tokens ?? []);

      case "image":
        // Its own projection: raw HTML in alt text is escaped into the
        // attribute, so it must not suppress the heading text after it.
        return withoutTags(projectLabel(token.tokens ?? [], outline));

      case "br":
        return " ";

      case "html": {
        const element = RAW_TEXT_ELEMENTS.exec(token.raw);
        const name = element?.[1];

        if (name && !new RegExp(`</${name}\\s*>`, "i").test(token.raw)) {
          suppressUntil = new RegExp(`^</${name}\\s*>`, "i");
        }

        return "";
      }

      case "footnoteRef":
        return "";

      case "formFieldInline":
        return escapeHtml(String(token["label"] ?? ""));

      case "numberof":
        return outline.referenceMarker(token, String(token["ref"]), token.raw);

      default:
        if ("tokens" in token && token.tokens) {
          return project(token.tokens);
        }

        return "text" in token ? escapeHtml(String(token.text)) : "";
    }
  };

  return project(tokens);
}

/** The marked extensions that maintain one render's outline. */
interface OutlineExtensions {
  /** Heading renderer, `@numberof` and the TOC sentinel; registered in place of the old heading extension. */
  render: MarkedExtension;
  /** Marker search; registered FIRST, so its preprocess hook runs last. */
  locate: MarkedExtension;
  /** TOC and `@numberof` substitution; registered LAST, so it postprocesses first. */
  finish: MarkedExtension;
  /**
   * The document error the hooks met, if any (more than one TOC, say). Hooks
   * do not throw it themselves: marked would append "Please report this to
   * marked" to a message that is about the document. The caller throws it
   * after parsing.
   */
  failure: () => Error | undefined;
}

/**
 * Extensions that assign heading ids and numbers and finish the TOC and
 * `@numberof` for one render. Make a fresh set per render.
 *
 * @param lex - lexes with a fresh, identically configured instance, used only
 *   to find the TOC markers
 */
export function outlineExtensions(
  numbering: HeadingNumbersConfig | false | undefined,
  tocOptions: TOCOptions | undefined,
  lex: (src: string) => TokensList,
): OutlineExtensions {
  const outline = new Outline();
  let failure: Error | undefined;

  /** Run a hook, recording a thrown error instead of letting marked wrap it. */
  const guarded = (input: string, hook: (input: string) => string): string => {
    if (failure) {
      return input;
    }

    try {
      return hook(input);
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));

      return input;
    }
  };

  const ids = new HeadingIdAssigner();
  const numberer = numbering ? new HeadingNumberer(numbering) : undefined;
  const separator = numbering ? (numbering.separator ?? ".") : ".";

  const render: MarkedExtension = {
    renderer: {
      heading(token: Tokens.Heading): string {
        const text = this.parser.parseInline(token.tokens);
        // References inside a heading never feed its id, so an id cannot
        // depend on a number that depends on ids.
        const id = ids.assign(outline.withoutMarkers(text));
        const prefix = numberer?.next(token.depth);
        const label = projectLabel(token.tokens, outline);

        outline.headings.push({
          depth: token.depth,
          id,
          number: prefix === undefined ? undefined : trimTrailingSeparator(prefix, separator),
          label: prefix === undefined ? label : `${prefix} ${label}`,
          topLevel: outline.topLevelHeadings.has(token),
        });

        const visible = prefix === undefined ? text : `${prefix} ${text}`;

        return `<h${token.depth} id="${id}">${visible}</h${token.depth}>\n`;
      },
      html(token: Tokens.HTML | Tokens.Tag): string | false {
        if (outline.tocPlaced && token.text.trim() === outline.tocSentinel) {
          outline.tocAt = outline.headings.length;
        }

        return false;
      },
    },
    hooks: {
      processAllTokens(tokens: Token[] | TokensList): Token[] | TokensList {
        for (const token of tokens) {
          if (token.type === "heading") {
            outline.topLevelHeadings.add(token);
          }
        }

        return tokens;
      },
    },
  };

  if (numberer) {
    render.extensions = [
      {
        name: "numberof",
        level: "inline",
        start(src: string): number | undefined {
          const index = src.indexOf("@numberof(");

          return index < 0 ? undefined : index;
        },
        tokenizer(src: string): Tokens.Generic | undefined {
          const match = /^@numberof\(([^)]+)\)/.exec(src);

          return match ? { type: "numberof", raw: match[0], ref: match[1] } : undefined;
        },
        renderer(token: Tokens.Generic): string {
          return outline.referenceMarker(token, String(token["ref"]), token.raw);
        },
      },
    ];
  }

  const locate: MarkedExtension = {
    hooks: {
      preprocess(markdown: string): string {
        return guarded(markdown, (source) => placeTocSentinel(source, lex, outline));
      },
    },
  };

  const finish: MarkedExtension = {
    hooks: {
      postprocess(html: string): string {
        return guarded(html, finishHtml);
      },
    },
  };

  const finishHtml = (html: string): string => {
    let result = html;

    if (outline.tocPlaced) {
      const parts = result.split(outline.tocSentinel);

      if (parts.length !== 2 || outline.tocAt === undefined) {
        throw new Error(
          "The table of contents could not be placed: a configured marked extension removed, moved or duplicated its marker.",
        );
      }

      const entries = outline.headings
        .slice(outline.tocAt)
        .filter((heading) => heading.topLevel)
        .map((heading) => {
          const label = outline.resolveMarkers(heading.label);

          return {
            depth: heading.depth,
            id: heading.id,
            label: isBlank(label) ? "(untitled)" : label,
          };
        });

      result = parts.join(renderToc(entries, tocOptions));
    }

    return outline.resolveMarkers(result);
  };

  return { render, locate, finish, failure: () => failure };
}
