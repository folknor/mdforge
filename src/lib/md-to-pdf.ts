import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import type { Browser } from "puppeteer";
import { type Config, themes, themesDir } from "./config.js";
import { generateOutput } from "./generate-output.js";
import { buildHeaderFooterTemplate } from "./header-footer.js";
import { getHtml } from "./markdown.js";
import { generatePagedCss } from "./paged-css.js";
import {
	extractFirstHeading,
	getMarginObject,
	getOutputFilePath,
	parseFrontMatter,
	resolveFileRefs,
} from "./util.js";

const PAGED_JS_URL = "https://unpkg.com/pagedjs/dist/paged.polyfill.js";

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

	// Note: displayHeaderFooter auto-enable is handled after simplified header/footer processing below

	const arrayOptions = ["body_class", "script", "stylesheet"] as const;

	// sanitize frontmatter array options
	for (const option of arrayOptions) {
		if (!Array.isArray(config[option])) {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic config array sanitization
			config[option] = [config[option]].filter(Boolean) as any;
		}
	}

	// resolve theme to stylesheet path
	if (config.theme !== false && config.theme !== undefined) {
		const themeName = config.theme;
		if (!themes.includes(themeName)) {
			throw new Error(
				`Unknown theme "${themeName}". Available themes: ${themes.join(", ")}`,
			);
		}
		const themeStylesheet = resolve(themesDir, `${themeName}.css`);
		// prepend theme stylesheet so user stylesheets can override
		config.stylesheet = [themeStylesheet, ...config.stylesheet];
	}

	// add print-urls body class if enabled
	if (config.print_urls) {
		config.body_class = [...config.body_class, "print-urls"];
	}

	// process simplified header/footer config
	if (config.header || config.footer) {
		// Collect all CSS for header/footer styling
		const cssContents: string[] = [];
		for (const stylesheet of config.stylesheet) {
			// Skip highlight.js stylesheets
			if (stylesheet.includes("highlight.js")) continue;

			// If it's already CSS content (from @file), use directly
			if (stylesheet.includes("\n") || stylesheet.includes("{")) {
				cssContents.push(stylesheet);
			} else {
				// Try to read the file
				try {
					const css = await fs.readFile(stylesheet, "utf-8");
					cssContents.push(css);
				} catch {
					// File not readable, skip
				}
			}
		}
		const allCss = cssContents.join("\n\n");

		if (config.paged_js) {
			// Paged.js mode: generate CSS @page rules
			const pagedCss = await generatePagedCss(
				{
					header: config.header,
					footer: config.footer,
					firstPageHeader: config.firstPageHeader,
					firstPageFooter: config.firstPageFooter,
				},
				allCss,
				baseDir,
			);

			// Prepend paged CSS to stylesheets (so theme + user styles are first)
			config.stylesheet = [...config.stylesheet, pagedCss];

			// Add paged.js script if not already present
			const hasPagedJs = config.script.some(
				(s) => s.url?.includes("pagedjs") || s.path?.includes("pagedjs"),
			);
			if (!hasPagedJs) {
				config.script = [...config.script, { url: PAGED_JS_URL }];
			}

			// Paged.js handles margins, set Puppeteer margins to 0
			config.pdf_options.margin = { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" };

			// Disable Puppeteer's displayHeaderFooter (paged.js renders in content)
			config.pdf_options.displayHeaderFooter = false;
		} else {
			// Puppeteer native mode: build HTML templates
			// Build header template if not already set via pdf_options
			if (config.header && !config.pdf_options.headerTemplate) {
				config.pdf_options.headerTemplate = await buildHeaderFooterTemplate(
					config.header,
					"header",
					allCss,
					baseDir,
				);
			}

			// Build footer template if not already set via pdf_options
			if (config.footer && !config.pdf_options.footerTemplate) {
				config.pdf_options.footerTemplate = await buildHeaderFooterTemplate(
					config.footer,
					"footer",
					allCss,
					baseDir,
				);
			}
		}
	}

	// Auto-enable displayHeaderFooter if templates are set (either simplified or via pdf_options)
	// Only applies to Puppeteer native mode (not paged.js)
	if (!config.paged_js) {
		const { headerTemplate, footerTemplate, displayHeaderFooter } =
			config.pdf_options;
		if ((headerTemplate || footerTemplate) && displayHeaderFooter === undefined) {
			config.pdf_options.displayHeaderFooter = true;
		}
	}

	// auto-detect document title from first heading if not set
	if (!config.document_title) {
		config.document_title = extractFirstHeading(md) ?? "";
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

			// Write header/footer template files when generating HTML
			if (config.as_html) {
				const baseName = output.filename.replace(/\.html$/, "");
				if ("headerTemplate" in output && output.headerTemplate) {
					await fs.writeFile(`${baseName}-header.html`, output.headerTemplate);
				}
				if ("footerTemplate" in output && output.footerTemplate) {
					await fs.writeFile(`${baseName}-footer.html`, output.footerTemplate);
				}
			}
		}
	}

	return output;
};
