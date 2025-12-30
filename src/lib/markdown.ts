import hljs from "highlight.js";
import type { MarkedExtension, MarkedOptions } from "marked";
import { Marked } from "marked";
import markedFootnote from "marked-footnote";
import { markedHighlight } from "marked-highlight";
import markedLinkifyIt from "marked-linkify-it";
import { markedSmartypants } from "marked-smartypants";
import type { Config } from "./config.js";
import { gfmHeadingId } from "./slugger.js";
import { insertToc } from "./toc.js";

/**
 * Create a configured Marked instance with syntax highlighting and extensions.
 */
const getMarked = (options: MarkedOptions, extensions: MarkedExtension[]) => {
	const highlightExtension = markedHighlight({
		langPrefix: "hljs language-",
		highlight(code, lang) {
			const language = hljs.getLanguage(lang) ? lang : "plaintext";
			return hljs.highlight(code, { language }).value;
		},
	});
	return new Marked(
		highlightExtension,
		gfmHeadingId(),
		markedSmartypants(),
		markedFootnote(),
		markedLinkifyIt(),
		...extensions,
	).setOptions({ ...options });
};

/**
 * Generates a HTML document from a markdown string.
 */
export const getHtml = (md: string, config: Config) => {
	const mdWithToc = insertToc(md, config.toc_options);
	return `<!DOCTYPE html>
<html>
	<head><title>${config.document_title}</title><meta charset="utf-8"></head>
	<body class="${config.body_class.join(" ")}">
		${getMarked(config.marked_options, config.marked_extensions).parse(mdWithToc)}
	</body>
</html>
`;
};
