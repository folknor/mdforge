import hljs from "highlight.js";
import { Marked, type MarkedExtension } from "marked";
import markedFootnote from "marked-footnote";
import { markedHighlight } from "marked-highlight";
import markedLinkifyIt from "marked-linkify-it";
import { markedSmartypants } from "marked-smartypants";
import { admonitions } from "./admonitions.ts";
import type { Config } from "./config.ts";
import { formFields } from "./form-fields.ts";
import { outlineExtensions } from "./outline.ts";
import { escapeHtml } from "./util.ts";

/**
 * A Marked instance with mdforge's extensions around `outline`, the heading
 * renderer that assigns ids and numbers. Without `outline` (the instance used
 * only to find TOC markers) headings render with marked's default renderer,
 * which does not change how the source lexes.
 */
const getMarked = (
  config: Config,
  outline?: { render: MarkedExtension; locate: MarkedExtension; finish: MarkedExtension },
): Marked => {
  const highlightExtension = markedHighlight({
    langPrefix: "hljs language-",
    highlight(code: string, lang: string): string {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";

      return hljs.highlight(code, { language }).value;
    },
  });

  // Hooks run newest first: `locate` is registered first so its preprocess
  // sees the source exactly as the lexer will, and `finish` last so the TOC
  // and @numberof are in place before smartypants and any user postprocess.
  return new Marked(
    ...(outline ? [outline.locate] : []),
    highlightExtension,
    ...(outline ? [outline.render] : []),
    admonitions(),
    formFields({ fillable: config.fillable }),
    markedSmartypants(),
    markedFootnote(),
    markedLinkifyIt(),
    ...config.marked_extensions,
    ...(outline ? [outline.finish] : []),
  ).setOptions({
    gfm: true,
    breaks: false,
    pedantic: false,
    silent: false,
  });
};

/**
 * Renders markdown to a HTML body: one render, in which the heading renderer
 * assigns every heading id and number and the TOC and `@numberof(...)` are
 * filled in from those same assignments (see outline.ts).
 */
const renderBody = (md: string, config: Config): string => {
  const outline = outlineExtensions(config.heading_numbers, config.toc_options, (src) =>
    getMarked(config).lexer(src),
  );

  const html = getMarked(config, outline).parse(md, { async: false });
  const failure = outline.failure();

  if (failure) {
    throw failure;
  }

  return html;
};

/**
 * Generates a HTML document from a markdown string.
 */
export const getHtml = (md: string, config: Config): string => `<!DOCTYPE html>
<html>
	<head><title>${escapeHtml(config.document_title)}</title><meta charset="utf-8"></head>
	<body class="${config.body_class.join(" ")}">
		${renderBody(md, config)}
	</body>
</html>
`;
