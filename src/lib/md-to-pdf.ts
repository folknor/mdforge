import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import type { Browser } from "puppeteer";
import type { Config } from "./config.js";
import { generateOutput } from "./generate-output.js";
import { getHtml } from "./markdown.js";
import {
	getMarginObject,
	getOutputFilePath,
	parseFrontMatter,
	resolveFileRefs,
} from "./util.js";

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

	const { content: md, data: rawFrontMatter } = parseFrontMatter(mdFileContent);

	// resolve @filename references in front-matter relative to markdown file
	const baseDir = "path" in input ? dirname(resolve(input.path)) : process.cwd();
	const frontMatterConfig = await resolveFileRefs(
		rawFrontMatter as Partial<Config>,
		baseDir,
	);

	// merge front-matter config
	config = {
		...config,
		...frontMatterConfig,
		pdf_options: {
			...config.pdf_options,
			...frontMatterConfig.pdf_options,
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
