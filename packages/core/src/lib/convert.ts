import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, relative, resolve } from "node:path";
import type { Browser } from "puppeteer";
import { type Config, themes, themesDir } from "./config.js";
import {
	type ConversionInfo,
	createConversionInfo,
} from "./conversion-info.js";
import { ConfigError, GenerationError, IncludeError } from "./errors.js";
import { generateFontStylesheet } from "./fonts.js";
import { generateOutput } from "./generate-output.js";
import { processIcons } from "./icons.js";
import { processIncludes } from "./includes.js";
import { processXref } from "./xref.js";
import { getHtml } from "./markdown.js";
import {
	buildPuppeteerTemplate,
	generatePagedCss,
	hasBackground,
} from "./paged-css.js";
import {
	extractFirstHeading,
	getMarginObject,
	getOutputFilePath,
	parseFrontMatter,
	resolveFileRefs,
} from "./util.js";
import { formatValidationErrors, validateConfig } from "./validate-config.js";

const require = createRequire(import.meta.url);
const PAGED_JS_PATH = resolve(
	dirname(require.resolve("pagedjs")),
	"..",
	"dist",
	"paged.polyfill.js",
);

/** Options that can be passed from CLI or other callers */
interface ConvertOptions {
	"--as-html"?: boolean;
}

/** Output from convertMdToPdf */
export interface ConvertResult {
	filename: string | undefined;
	content: Buffer | Uint8Array | string;
	info: ConversionInfo;
}

/**
 * Convert markdown to pdf.
 */
export const convertMdToPdf = async (
	input: { path: string } | { content: string },
	config: Config,
	{
		args = {},
		browser,
	}: {
		args?: ConvertOptions;
		browser?: Browser;
	} = {},
): Promise<ConvertResult> => {
	// Track conversion info for CLI output
	const info = createConversionInfo();

	const mdFileContent =
		"content" in input
			? input.content
			: await fs.readFile(input.path, { encoding: "utf-8" });

	const { content: md, data: rawFrontMatter } = parseFrontMatter(mdFileContent);

	// resolve @filename references in front-matter relative to markdown file
	const baseDir =
		"path" in input ? dirname(resolve(input.path)) : process.cwd();
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

	// Validate merged config
	const validationErrors = validateConfig(frontMatterConfig);
	if (validationErrors.length > 0) {
		info.warnings.push(formatValidationErrors(validationErrors));
	}

	// Note: displayHeaderFooter auto-enable is handled after simplified header/footer processing below

	const arrayOptions = ["body_class", "script", "stylesheet"] as const;

	// sanitize frontmatter array options
	for (const option of arrayOptions) {
		if (!Array.isArray(config[option])) {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic config array sanitization
			config[option] = [config[option]].filter(Boolean) as any;
		}
	}

	// Resolve relative stylesheet paths from front-matter
	if (frontMatterConfig.stylesheet && "path" in input) {
		config.stylesheet = config.stylesheet.map((s) =>
			typeof s === "string" && !s.startsWith("/") && !s.includes("\n")
				? resolve(baseDir, s)
				: s,
		);
	}

	// Auto-detect stylesheet if not specified
	if (config.stylesheet.length === 0 && "path" in input) {
		const mdBasename = basename(input.path, ".md");
		const candidateCss = resolve(baseDir, `${mdBasename}.css`);
		const indexCss = resolve(baseDir, "index.css");

		try {
			await fs.access(candidateCss);
			config.stylesheet = [candidateCss];
			info.stylesheet = { type: "auto", path: basename(candidateCss) };
		} catch {
			try {
				await fs.access(indexCss);
				config.stylesheet = [indexCss];
				info.stylesheet = { type: "auto", path: "index.css" };
			} catch {
				// No stylesheet found, continue without
				info.stylesheet = { type: "none" };
			}
		}
	} else if (config.stylesheet.length > 0) {
		// User specified stylesheet
		const firstStylesheet = config.stylesheet[0];
		if (typeof firstStylesheet === "string" && !firstStylesheet.includes("\n")) {
			info.stylesheet = { type: "specified", path: basename(firstStylesheet) };
		}
	}

	// resolve theme to stylesheet path
	let themeStylesheet: string | undefined;
	if (config.theme !== false && config.theme !== undefined) {
		const themeName = config.theme;
		if (!themes.includes(themeName)) {
			throw new ConfigError(
				`Unknown theme "${themeName}". Available themes: ${themes.join(", ")}`,
			);
		}
		themeStylesheet = resolve(themesDir, `${themeName}.css`);
		info.theme = themeName;
	} else if (config.theme === false) {
		info.theme = false;
	}

	// Generate font stylesheet from config (fonts are cached locally)
	// If no fonts specified but theme is set, use theme name as default preset
	const effectiveFonts = config.fonts || config.theme || undefined;
	const fontResult = await generateFontStylesheet(effectiveFonts);
	const fontCss = fontResult?.css;

	// Track font resolution info and warnings
	if (fontResult?.info) {
		info.fonts = fontResult.info;
	}
	if (fontResult?.warnings) {
		info.warnings.push(...fontResult.warnings);
	}

	// Build stylesheet list: theme, fonts, user stylesheets
	// Order matters: theme first, fonts override theme, user overrides all
	const baseStylesheets: string[] = [];
	if (themeStylesheet) baseStylesheets.push(themeStylesheet);
	if (fontCss) baseStylesheets.push(fontCss);
	config.stylesheet = [...baseStylesheets, ...config.stylesheet];

	// add print-urls body class and CSS if enabled
	if (config.print_urls) {
		config.body_class = [...config.body_class, "print-urls"];
		const printUrlsCss = `.print-urls a[href^="http"]:after {
	content: " (" attr(href) ")";
	font-size: 85%;
	color: var(--color-text-muted, #666);
}`;
		config.stylesheet = [...config.stylesheet, printUrlsCss];
	}

	// Process simplified header/footer config
	if (config.header || config.footer) {
		const headerFooterConfig = {
			header: config.header,
			footer: config.footer,
			page_numbers: config.page_numbers,
		};

		// Helper to summarize header/footer config
		const summarize = (cfg: typeof config.header): string | undefined => {
			if (!cfg) return undefined;
			if (typeof cfg === "string") return cfg;
			const parts = [cfg.left, cfg.center, cfg.right].filter(Boolean);
			return parts.join(" | ") || undefined;
		};

		// Check if backgrounds are used (requires Puppeteer templates)
		if (hasBackground(headerFooterConfig)) {
			// Use Puppeteer's native header/footer templates for backgrounds
			if (config.header) {
				config.pdf_options.headerTemplate = await buildPuppeteerTemplate(
					config.header,
					"header",
					baseDir,
				);
			}
			if (config.footer) {
				config.pdf_options.footerTemplate = await buildPuppeteerTemplate(
					config.footer,
					"footer",
					baseDir,
				);
			}
			config.pdf_options.displayHeaderFooter = true;
			info.headerFooter = {
				type: "puppeteer",
				header: summarize(config.header),
				footer: summarize(config.footer),
			};
		} else {
			// Use paged.js for text-only headers/footers
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
						// Stylesheet already validated, this is unexpected
					}
				}
			}
			const allCss = cssContents.join("\n\n");

			// Generate CSS @page rules for paged.js
			const pagedCss = await generatePagedCss(
				headerFooterConfig,
				allCss,
				baseDir,
			);

			// Add paged CSS to stylesheets
			config.stylesheet = [...config.stylesheet, pagedCss];

			// Add paged.js script if not already present
			const hasPagedJs = config.script.some(
				(s) => s.url?.includes("pagedjs") || s.path?.includes("pagedjs"),
			);
			if (!hasPagedJs) {
				config.script = [...config.script, { path: PAGED_JS_PATH }];
			}

			// Paged.js handles margins, set Puppeteer margins to 0
			config.pdf_options.margin = {
				top: "0mm",
				right: "0mm",
				bottom: "0mm",
				left: "0mm",
			};

			// Disable Puppeteer's displayHeaderFooter (paged.js renders in content)
			config.pdf_options.displayHeaderFooter = false;

			info.headerFooter = {
				type: "paged.js",
				header: summarize(config.header),
				footer: summarize(config.footer),
			};
		}
	} else {
		info.headerFooter = { type: "none" };
	}

	// Auto-enable displayHeaderFooter if raw templates are set via pdf_options
	const { headerTemplate, footerTemplate, displayHeaderFooter } =
		config.pdf_options;
	if ((headerTemplate || footerTemplate) && displayHeaderFooter === undefined) {
		config.pdf_options.displayHeaderFooter = true;
	}

	// Process @include directives (file paths or template names)
	let processedMd = md;
	try {
		processedMd = await processIncludes(md, baseDir, config.templates);
	} catch (error) {
		const err = error as Error;
		throw new IncludeError("", err.message);
	}

	// Process :icon[prefix:name] syntax - fetch and inline SVGs from Iconify
	try {
		processedMd = await processIcons(processedMd);
	} catch (error) {
		const err = error as Error;
		info.warnings.push(`Icon processing failed: ${err.message} (continuing with placeholders)`);
	}

	// Process @see Section Name → [Section Name](#section-name)
	processedMd = processXref(processedMd);

	// auto-detect document title from first heading if not set
	if (!config.document_title) {
		config.document_title = extractFirstHeading(processedMd) ?? "";
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

	const highlightStylesheet = resolve(
		dirname(require.resolve("highlight.js")),
		"..",
		"styles",
		`${config.code_block_style}.css`,
	);

	config.stylesheet = [...new Set([...config.stylesheet, highlightStylesheet])];

	// Validate stylesheets exist before passing to Puppeteer
	const validatedStylesheets: string[] = [];
	for (const stylesheet of config.stylesheet) {
		// Skip if it's CSS content (from @file) or a URL
		if (stylesheet.includes("\n") || stylesheet.includes("{") || stylesheet.startsWith("http")) {
			validatedStylesheets.push(stylesheet);
			continue;
		}
		// Check if file exists
		try {
			await fs.access(stylesheet);
			validatedStylesheets.push(stylesheet);
		} catch {
			info.warnings.push(`Stylesheet not found: ${stylesheet}`);
		}
	}
	config.stylesheet = validatedStylesheets;

	const html = getHtml(processedMd, config);

	const relativePath =
		"path" in input ? relative(config.basedir, input.path) : ".";

	let output: Awaited<ReturnType<typeof generateOutput>>;
	try {
		output = await generateOutput(html, relativePath, config, browser);
	} catch (error) {
		const err = error as Error;
		const outputType = config.as_html ? "HTML" : "PDF";
		// Provide context about what failed
		if (err.message.includes("Browser") || err.message.includes("browser")) {
			throw new GenerationError(
				`Failed to create ${outputType}: Could not launch browser. Is Puppeteer installed correctly?`,
				err,
			);
		}
		if (err.message.includes("timeout") || err.message.includes("Timeout")) {
			throw new GenerationError(
				`Failed to create ${outputType}: Page load timed out. Check for slow-loading resources.`,
				err,
			);
		}
		throw new GenerationError(`Failed to create ${outputType}: ${err.message}`, err);
	}

	if (output.filename) {
		if (output.filename === "stdout") {
			process.stdout.write(output.content);
		} else {
			await fs.writeFile(output.filename, output.content);
		}
	}

	// Track output info
	if (output.filename) {
		info.output = {
			path: output.filename,
		};
	}

	return {
		filename: output.filename,
		content: output.content,
		info,
	};
};
