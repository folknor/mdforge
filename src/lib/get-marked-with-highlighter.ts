import hljs from "highlight.js";
import type { MarkedExtension, MarkedOptions } from "marked";
import { marked } from "marked";

export const getMarked = (
	options: MarkedOptions,
	extensions: MarkedExtension[],
) => {
	// Create a custom renderer with highlight support
	const renderer = new marked.Renderer();
	const originalCode = renderer.code.bind(renderer);

	renderer.code = ({
		text,
		lang,
		escaped,
	}: {
		text: string;
		lang?: string;
		escaped?: boolean;
	}) => {
		const language = lang || "plaintext";
		const validLang = hljs.getLanguage(language) ? language : "plaintext";

		if (escaped) {
			// biome-ignore lint/suspicious/noExplicitAny: marked renderer callback requires dynamic typing
			return originalCode({ text, lang, escaped } as any);
		}

		try {
			return hljs.highlight(text, { language: validLang }).value;
		} catch (_error) {
			// biome-ignore lint/suspicious/noExplicitAny: marked renderer callback requires dynamic typing
			return originalCode({ text, lang, escaped } as any);
		}
	};

	marked.setOptions({
		...options,
		renderer,
	});
	marked.use(...extensions);
	return marked;
};
