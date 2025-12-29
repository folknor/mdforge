/*!
 * Table of Contents generation for md-to-pdf
 * Adapted from markdown-toc <https://github.com/jonschlinkert/markdown-toc>
 *
 * Copyright (c) 2013-2023, Jon Schlinkert.
 * Released under the MIT License.
 */

import GithubSlugger from "github-slugger";
import { marked, type Token, type Tokens } from "marked";
import { cleanForSlug } from "./slugger.js";

export interface TOCOptions {
	/** Include the first h1 heading in the TOC. Default: true */
	firsth1?: boolean;
	/** Maximum heading depth to include (1-6). Default: 6 */
	maxdepth?: number;
	/** Bullet characters for list items. Default: ['-'] */
	bullets?: string[];
	/** Indentation string. Default: '  ' */
	indent?: string;
	/** Filter function to exclude certain headings */
	filter?: (
		content: string,
		token: HeadingToken,
		tokens: HeadingToken[],
	) => boolean;
}

export interface HeadingToken {
	content: string;
	slug: string;
	lvl: number;
	i: number;
	seen: number;
}

interface TOCResult {
	content: string;
	json: HeadingToken[];
	highest: number;
}

/**
 * Adapter to work with marked tokens and provide TOC generation.
 */
class MarkedAdapter {
	private options: TOCOptions;
	private slugger = new GithubSlugger();
	private headings: HeadingToken[] = [];

	constructor(options: TOCOptions = {}) {
		this.options = {
			firsth1: true,
			maxdepth: 6,
			bullets: ["-"],
			indent: "  ",
			...options,
		};
	}

	public parse(content: string): TOCResult {
		const tokens = marked.lexer(content);
		this.extractHeadings(tokens);
		this.processHeadings();
		const tocContent = this.generateTOCContent();
		const jsonOutput = this.generateJSONOutput();

		return {
			content: tocContent,
			json: jsonOutput,
			highest: this.getHighestLevel(),
		};
	}

	private extractHeadings(tokens: Token[]): void {
		for (const token of tokens) {
			if (token.type === "heading") {
				this.processHeadingToken(token);
			}
		}
	}

	private processHeadingToken(token: Token): void {
		if (token.type !== "heading") {
			return;
		}

		const headingToken = token as Tokens.Heading;
		const headingDepth = headingToken.depth;

		// Skip headings beyond maxdepth
		if (headingDepth > this.options.maxdepth!) {
			return;
		}

		const text = this.getTokenText(token);
		// Use same slug logic as gfmHeadingId to ensure links match
		const slug = this.slugger.slug(cleanForSlug(headingToken.text));

		const heading: HeadingToken = {
			content: text,
			slug,
			lvl: headingDepth,
			i: this.headings.length,
			seen: 0,
		};

		this.headings.push(heading);
	}

	private getTokenText(token: Token): string {
		if (token.type === "heading") {
			return (token as Tokens.Heading).text;
		}
		if (token.type === "text") {
			return (token as Tokens.Text).text;
		}
		if (token.type === "link") {
			const linkToken = token as Tokens.Link;
			return linkToken.text || linkToken.href;
		}
		if (
			token.type === "strong" ||
			token.type === "em" ||
			token.type === "codespan"
		) {
			return (token as Tokens.Strong | Tokens.Em | Tokens.Codespan).text;
		}
		if ("text" in token && typeof token.text === "string") {
			return token.text;
		}
		if ("tokens" in token && Array.isArray(token.tokens)) {
			return token.tokens.map((t) => this.getTokenText(t)).join("");
		}
		return "";
	}

	private processHeadings(): void {
		// Apply firsth1 option - skip first h1 if disabled
		const firstHeading = this.headings[0];
		if (!this.options.firsth1 && firstHeading && firstHeading.lvl === 1) {
			this.headings = this.headings.slice(1);
		}

		// Apply filter function if provided
		if (typeof this.options.filter === "function") {
			this.headings = this.headings.filter((heading) => {
				return this.options.filter!(heading.content, heading, this.headings);
			});
		}
	}

	private generateTOCContent(): string {
		const lines: string[] = [];
		const bullets = this.options.bullets!;
		const indent = this.options.indent!;

		for (const heading of this.headings) {
			if (heading.lvl > this.options.maxdepth!) {
				continue;
			}

			const bulletIndex = Math.min(heading.lvl - 1, bullets.length - 1);
			const bullet = bullets[bulletIndex] || "-";

			const highestLevel = this.getHighestLevel();
			const indentLevel = Math.max(0, heading.lvl - highestLevel);
			const indentation = indent.repeat(indentLevel);

			lines.push(
				`${indentation}${bullet} [${heading.content}](#${heading.slug})`,
			);
		}

		return lines.join("\n");
	}

	private generateJSONOutput(): HeadingToken[] {
		return this.headings.map((heading) => ({
			content: heading.content,
			slug: heading.slug,
			lvl: heading.lvl,
			i: heading.i,
			seen: heading.seen,
		}));
	}

	private getHighestLevel(): number {
		if (this.headings.length === 0) return 1;
		return Math.min(...this.headings.map((h) => h.lvl));
	}
}

/**
 * Generate a table of contents from markdown content.
 */
function toc(str: string, options: TOCOptions = {}): TOCResult {
	const adapter = new MarkedAdapter(options);
	return adapter.parse(str);
}

/**
 * Insert a table of contents into markdown content.
 * Looks for <!-- toc --> and <!-- tocstop --> markers.
 *
 * @param str - Markdown string
 * @param options - TOC generation options
 * @returns Markdown with TOC inserted (or original if no markers)
 */
export function insertToc(str: string, options: TOCOptions = {}): string {
	const regex = /(?:<!-- toc(?:\s*stop)? -->)/g;
	const open = "<!-- toc -->\n\n";
	const close = "\n<!-- tocstop -->";

	// Preserve trailing newlines
	const newlines = (/\n+$/.exec(str) || [""])[0];

	const sections = str.split(regex).map((s) => s.trim());

	if (sections.length === 1) {
		// No markers found, return unchanged
		return str;
	}

	if (sections.length > 3) {
		throw new Error("md-to-pdf only supports one Table of Contents per file.");
	}

	const last = sections[sections.length - 1] as string;
	const tocContent = toc(last, options).content;

	if (sections.length === 3) {
		// Both markers present: <!-- toc --> content <!-- tocstop -->
		sections.splice(1, 1, open + tocContent);
		sections.splice(2, 0, close);
	} else if (sections.length === 2) {
		// Only opening marker: <!-- toc -->
		sections.splice(1, 0, `${open}${tocContent}${close}`);
	}

	return sections.join("\n\n") + newlines;
}
