import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import type { Browser } from "puppeteer";
import YAML from "yaml";
import type { Config } from "./config.js";
import { generateOutput } from "./generate-output.js";
import { getHtml } from "./get-html.js";
import { getOutputFilePath } from "./get-output-file-path.js";
import { getMarginObject } from "./helpers.js";

/**
 * Parse YAML front-matter from markdown content.
 */
function parseFrontMatter(content: string): { data: Record<string, unknown>; content: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
	if (!match) return { data: {}, content };
	try {
		return {
			data: YAML.parse(match[1]!) || {},
			content: match[2]!,
		};
	} catch (error) {
		console.warn("Warning: front-matter could not be parsed:", error);
		return { data: {}, content };
	}
}

type CliArgs = typeof import("../cli.js").cliFlags;

/**
 * Convert markdown to pdf.
 */
export const convertMdToPdf = async (
	input: { path: string } | { content: string },
	config: Config,
	{
		args = {} as CliArgs,
		browser,
	}: {
		args?: CliArgs;
		browser?: Browser;
	} = {},
) => {
	const mdFileContent =
		"content" in input
			? input.content
			: await fs.readFile(input.path, { encoding: "utf-8" });

	const { content: md, data: frontMatterConfig } = parseFrontMatter(mdFileContent);

	// merge front-matter config
	config = {
		...config,
		...(frontMatterConfig as Partial<Config>),
		pdf_options: {
			...config.pdf_options,
			...(frontMatterConfig as Partial<Config>).pdf_options,
		},
	};

	const { headerTemplate, footerTemplate, displayHeaderFooter } =
		config.pdf_options;

	if ((headerTemplate || footerTemplate) && displayHeaderFooter === undefined) {
		config.pdf_options.displayHeaderFooter = true;
	}

	const arrayOptions = ["body_class", "script", "stylesheet"] as const;

	// sanitize frontmatter array options
	for (const option of arrayOptions) {
		if (!Array.isArray(config[option])) {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic config array sanitization
			config[option] = [config[option]].filter(Boolean) as any;
		}
	}

	// merge --as-html from CLI args
	if (args["--as-html"]) {
		config.as_html = true;
	}

	// sanitize the margin in pdf_options
	if (typeof config.pdf_options.margin === "string") {
		config.pdf_options.margin = getMarginObject(config.pdf_options.margin);
	}

	// set output destination
	if (config.dest === undefined) {
		config.dest =
			"path" in input
				? getOutputFilePath(input.path, config.as_html ? "html" : "pdf")
				: "stdout";
	}

	const require = createRequire(import.meta.url);
	const highlightStylesheet = resolve(
		dirname(require.resolve("highlight.js")),
		"..",
		"styles",
		`${config.highlight_style}.css`,
	);

	config.stylesheet = [...new Set([...config.stylesheet, highlightStylesheet])];

	const html = getHtml(md, config);

	const relativePath =
		"path" in input ? relative(config.basedir, input.path) : ".";

	const output = await generateOutput(html, relativePath, config, browser);

	if (!output) {
		throw new Error(`Failed to create ${config.as_html ? "HTML" : "PDF"}.`);
	}

	if (output.filename) {
		if (output.filename === "stdout") {
			process.stdout.write(output.content);
		} else {
			await fs.writeFile(output.filename, output.content);
		}
	}

	return output;
};
