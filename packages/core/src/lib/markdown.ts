import hljs from "highlight.js";
import { Marked } from "marked";
import markedFootnote from "marked-footnote";
import { markedHighlight } from "marked-highlight";
import markedLinkifyIt from "marked-linkify-it";
import { markedSmartypants } from "marked-smartypants";
import { admonitions } from "./admonitions.js";
import type { Config } from "./config.js";
import { formFields } from "./form-fields.js";
import { headingNumbers } from "./heading-numbers.js";
import { gfmHeadingId } from "./slugger.js";
import { insertToc } from "./toc.js";
import { resolveNumberRefs } from "./xref.js";

/**
 * Create a configured Marked instance with syntax highlighting and extensions.
 */
const getMarked = (config: Config): Marked => {
  const highlightExtension = markedHighlight({
    langPrefix: "hljs language-",
    highlight(code: string, lang: string): string {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  });

  // Use headingNumbers extension if configured, otherwise use gfmHeadingId
  // (headingNumbers includes the same ID generation functionality)
  const headingExtension = config.heading_numbers
    ? headingNumbers(config.heading_numbers)
    : gfmHeadingId();

  return new Marked(
    highlightExtension,
    headingExtension,
    admonitions(),
    formFields({ fillable: config.fillable }),
    markedSmartypants(),
    markedFootnote(),
    markedLinkifyIt(),
    ...config.marked_extensions,
  ).setOptions({
    gfm: true,
    breaks: false,
    pedantic: false,
    silent: false,
  });
};

/**
 * Generates a HTML document from a markdown string.
 */
export const getHtml = (md: string, config: Config): string => {
  // `@numberof(...)` is resolved here rather than in {@link processXref},
  // because it needs the whole document's headings replayed through the same
  // counters the renderer uses — which is only sound once includes and
  // constants have been expanded. It runs before the TOC is inserted so the
  // generated TOC markup is never scanned for directives.
  const resolved = resolveNumberRefs(md, config.heading_numbers);
  const mdWithToc = insertToc(
    resolved,
    config.toc_options,
    config.heading_numbers,
  );
  return `<!DOCTYPE html>
<html>
	<head><title>${config.document_title}</title><meta charset="utf-8"></head>
	<body class="${config.body_class.join(" ")}">
		${getMarked(config).parse(mdWithToc)}
	</body>
</html>
`;
};
