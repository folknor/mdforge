/**
 * Prepare conversion - processes markdown and config, returns everything needed for rendering.
 * This module contains no browser dependencies.
 */

import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type { FrameAddScriptTagOptions } from "puppeteer";
import { admonitionsCss } from "./admonitions.js";
import {
  type Config,
  type HeaderFooterColumn,
  type PdfOptions,
  type StylesheetEntry,
  themes,
  themesDir,
} from "./config.js";
import { formatConfigIssues, parseConfigYaml, splitFrontMatter } from "./config-yaml.js";
import { processConstants } from "./constants.js";
import { type ConversionInfo, createConversionInfo } from "./conversion-info.js";
import { formatCssErrors, validateCss } from "./css-validator.js";
import { ConfigError, IncludeError } from "./errors.js";
import { type EmbeddedFontData, fontPairings, generateFontStylesheet } from "./fonts.js";
import { formFieldsCss } from "./form-fields.js";
import { processIcons } from "./icons.js";
import { processIncludes } from "./includes.js";
import { getHtml } from "./markdown.js";
import {
  buildPuppeteerTemplate,
  generatePagedCss,
  hasBackground,
  hasContent,
} from "./paged-css.js";
import { extractFirstHeading, getOutputFilePath } from "./util.js";
import { hasPageRefs, processXref } from "./xref.js";

const require: NodeRequire = createRequire(import.meta.url);

/** One-line summary of a header or footer for the conversion info. */
function summarize(columns: HeaderFooterColumn | undefined): string | undefined {
  return [columns?.left, columns?.center, columns?.right].filter(Boolean).join(" | ") || undefined;
}

/** What the conversion produces. */
export type OutputFormat = "pdf" | "html";

/**
 * Where the result goes. `none` only returns it to the caller. A `file` path
 * is always a file, even one named "stdout"; an empty path is an error from
 * the write, not a way to say `none`.
 */
export type OutputTarget = { kind: "file"; path: string } | { kind: "stdout" } | { kind: "none" };

/**
 * The invocation's own choices, which the document cannot override: front
 * matter and config files are Config, and Config has no say in these.
 */
export interface ConvertOptions {
  /** Default: "pdf". */
  format?: OutputFormat;
  /**
   * Default: a file beside a path input, with the format's extension, or
   * stdout for content input.
   */
  output?: OutputTarget;
  /** Overrides the document's `fillable` when set. */
  fillable?: boolean;
}

/**
 * The document to convert. Its directory is where relative references in it
 * resolve (`@file`, includes, header/footer images, relative URLs in the
 * page): a path input's own directory, or for content the caller's `baseDir`,
 * default the working directory. Like the output target, this belongs to the
 * invocation, so neither front matter nor a config file can move it.
 */
export type MarkdownInput = { path: string } | { content: string; baseDir?: string };

/**
 * The `<base>` element for a prepared document's `baseUrl`. A file URL keeps
 * `&` and `'` as they are, and `&` would start a character reference inside
 * the attribute, so the value is HTML-escaped here.
 */
export function baseElement(baseUrl: string): string {
  const escaped = baseUrl
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  return `<base href="${escaped}">`;
}

/** Write a converted document to its target. */
export async function writeOutput(
  target: OutputTarget,
  content: Buffer | Uint8Array | string,
): Promise<void> {
  switch (target.kind) {
    case "file":
      await fs.writeFile(target.path, content);

      return;
    case "stdout":
      process.stdout.write(content);

      return;
    case "none":
      return;
  }
}

/**
 * Everything needed to render the document.
 * This is the output of prepareConversion() and input to render().
 */
export interface PreparedConversion {
  /** The complete HTML document */
  html: string;

  /** Stylesheets to add to the page */
  stylesheets: StylesheetEntry[];

  /** Scripts to add to the page */
  scripts: FrameAddScriptTagOptions[];

  /** PDF options for the renderer */
  pdfOptions: PdfOptions;

  /** Base URL for resolving relative paths */
  baseUrl: string;

  /** The processed config */
  config: Config;

  /** Embedded font data for fillable forms */
  embeddedFonts?: EmbeddedFontData[];

  /** Conversion info for CLI output */
  info: ConversionInfo;

  /** What to produce, as the invocation chose it */
  format: OutputFormat;

  /** Where the result goes, as the invocation chose it or its default */
  output: OutputTarget;
}

/**
 * Prepare a markdown document for rendering.
 *
 * This function:
 * - Reads and parses the markdown file
 * - Merges the caller's config with front matter, then applies the
 *   invocation's options, which front matter cannot override
 * - Resolves themes, fonts, stylesheets
 * - Processes includes, icons, cross-references
 * - Generates header/footer CSS or templates
 * - Converts markdown to HTML
 *
 * It does NOT:
 * - Launch a browser
 * - Render the HTML
 * - Generate PDF
 *
 * @param input - Markdown file path or content
 * @param config - Configuration
 * @param options - Output format, target and fillable override
 * @returns Everything needed for rendering
 */
export async function prepareConversion(
  input: MarkdownInput,
  config: Config,
  options: ConvertOptions = {},
): Promise<PreparedConversion> {
  // Track conversion info for CLI output
  const info = createConversionInfo();

  const format = options.format ?? "pdf";

  // Preparation reassigns config fields and writes into pdf_options; a
  // caller may share one config across concurrent conversions (the CLI does),
  // so each conversion works on its own copy.
  config = { ...config, pdf_options: { ...config.pdf_options } };

  const mdFileContent =
    "content" in input ? input.content : await fs.readFile(input.path, { encoding: "utf-8" });

  const { content: md, yaml } = splitFrontMatter(mdFileContent);

  // Extract title early for header/footer {title} variable
  const docTitle = extractFirstHeading(md) ?? "";

  // The document's directory: @file references, relative stylesheets,
  // includes and the page's <base href> all resolve against it
  const baseDir =
    "path" in input ? dirname(resolve(input.path)) : resolve(input.baseDir ?? process.cwd());

  if (yaml !== undefined) {
    const frontMatter = await parseConfigYaml(yaml, {
      source: "front-matter",
      baseDir,
      dependencies: info.dependencies,
    });

    if (frontMatter.issues.length > 0) {
      info.warnings.push(formatConfigIssues(frontMatter.issues, "front matter"));
    }

    config = {
      ...config,
      ...frontMatter.config,
      pdf_options: {
        ...config.pdf_options,
        ...frontMatter.config.pdf_options,
      },
    };
  }

  // Auto-detect stylesheet if not specified
  if (config.stylesheet.length === 0 && "path" in input) {
    const mdBasename = basename(input.path, ".md");
    const candidateCss = resolve(baseDir, `${mdBasename}.css`);
    const indexCss = resolve(baseDir, "index.css");

    // Every candidate consulted is a dependency whether or not it exists:
    // creating `<name>.css` must take over from index.css or from no sheet.
    // index.css is consulted only when `<name>.css` is absent.
    info.dependencies.push(candidateCss);

    try {
      await fs.access(candidateCss);
      config.stylesheet = [{ type: "path", value: candidateCss }];
      info.stylesheet = { type: "auto", path: basename(candidateCss) };
    } catch {
      info.dependencies.push(indexCss);

      try {
        await fs.access(indexCss);
        config.stylesheet = [{ type: "path", value: indexCss }];
        info.stylesheet = { type: "auto", path: "index.css" };
      } catch {
        // No stylesheet found, continue without
        info.stylesheet = { type: "none" };
      }
    }
  } else if (config.stylesheet.length > 0) {
    // User specified one or more stylesheets; they cascade in the order given,
    // so record all of them — the later sheets are what a layered theme uses to
    // override the base.
    const files = config.stylesheet.flatMap((s) => (s.type === "path" ? [s.value] : []));

    const [firstFile] = files;

    if (firstFile !== undefined) {
      info.stylesheet = {
        type: "specified",
        path: basename(firstFile),
        paths: files.map((s) => basename(s)),
      };
      info.dependencies.push(...files);
    }
  }

  // resolve theme to stylesheet path
  let themeStylesheet: string | undefined;

  if (config.theme !== false && config.theme !== undefined) {
    const themeName = config.theme;

    if (!themes.includes(themeName)) {
      throw new ConfigError(`Unknown theme "${themeName}". Available themes: ${themes.join(", ")}`);
    }

    themeStylesheet = resolve(themesDir, `${themeName}.css`);
    info.theme = themeName;
  } else if (config.theme === false) {
    info.theme = false;
  }

  // Generate font stylesheet from config (fonts are cached locally)
  // If no fonts specified but theme is set, use the theme's pairing. Resolved
  // here, not when parsing, so a front-matter theme still picks the default.
  const effectiveFonts = config.fonts ?? (config.theme ? fontPairings[config.theme] : undefined);

  const fontResult = await generateFontStylesheet(effectiveFonts);
  const fontCss = fontResult?.css;

  // Track font resolution info and warnings
  if (fontResult?.info) {
    info.fonts = fontResult.info;
  }

  if (fontResult?.warnings) {
    info.warnings.push(...fontResult.warnings);
  }

  // Store embedded font data for form field rendering
  const embeddedFonts = fontResult?.embeddedFonts;

  // Build stylesheet list: theme, fonts, font_scale, built-in features, user stylesheets
  // Order matters: theme first, fonts override theme, user overrides all
  const baseStylesheets: StylesheetEntry[] = [];

  if (themeStylesheet) baseStylesheets.push({ type: "path", value: themeStylesheet });

  if (fontCss) baseStylesheets.push({ type: "content", value: fontCss });

  // Add built-in extension CSS (always available)
  baseStylesheets.push({ type: "content", value: formFieldsCss });
  baseStylesheets.push({ type: "content", value: admonitionsCss });

  // Apply font_scale if set (scales the base 12pt size)
  if (config.font_scale && config.font_scale !== 1) {
    const scaledSize = 12 * config.font_scale;
    baseStylesheets.push({ type: "content", value: `:root { --font-size: ${scaledSize}pt; }` });
    info.fontScale = config.font_scale;
  }

  config.stylesheet = [...baseStylesheets, ...config.stylesheet];

  // add print-urls body class and CSS if enabled
  if (config.print_urls) {
    config.body_class = [...config.body_class, "print-urls"];

    const printUrlsCss = `.print-urls a[href^="http"]:after {
	content: " (" attr(href) ")";
	font-size: 85%;
	color: var(--color-text-muted, #666);
}`;

    config.stylesheet = [...config.stylesheet, { type: "content", value: printUrlsCss }];
  }

  // Process simplified header/footer config
  // Empty headers/footers are dropped here, so everything below sees only
  // ones with content (see hasContent).
  const header = hasContent(config.header) ? config.header : undefined;
  const footer = hasContent(config.footer) ? config.footer : undefined;

  if (header || footer) {
    const headerFooterConfig = {
      header,
      footer,
      page_numbers: config.page_numbers,
      title: docTitle,
    };

    // Check if backgrounds are used (requires Puppeteer templates)
    if (hasBackground(headerFooterConfig)) {
      // Use Puppeteer's native header/footer templates for backgrounds
      if (header) {
        config.pdf_options.headerTemplate = await buildPuppeteerTemplate(header, "header", baseDir);
      }

      if (footer) {
        config.pdf_options.footerTemplate = await buildPuppeteerTemplate(footer, "footer", baseDir);
      }

      config.pdf_options.displayHeaderFooter = true;
      info.headerFooter = {
        type: "puppeteer",
        header: summarize(header),
        footer: summarize(footer),
      };
    } else {
      // Use paged.js for text-only headers/footers
      // Collect all CSS for header/footer styling
      const cssContents: string[] = [];

      // The highlight.js sheet is not in the list yet; it is appended below.
      for (const stylesheet of config.stylesheet) {
        if (stylesheet.type === "content") {
          cssContents.push(stylesheet.value);
        } else if (stylesheet.type === "path") {
          try {
            cssContents.push(await fs.readFile(stylesheet.value, "utf-8"));
          } catch {
            // Reported by the validation pass below
          }
        }
        // URLs are loaded by the page and cannot be read here
      }

      const allCss = cssContents.join("\n\n");

      // Generate CSS @page rules for paged.js
      const pagedCss = await generatePagedCss(headerFooterConfig, allCss, baseDir);

      // Add paged CSS to stylesheets (uses native Chrome @page margin boxes)
      config.stylesheet = [...config.stylesheet, { type: "content", value: pagedCss }];

      // Chrome 131+ supports @page margin boxes natively, no paged.js needed
      // Set Puppeteer margins to 0 - the @page rule handles margins
      config.pdf_options.margin = {
        top: "0mm",
        right: "0mm",
        bottom: "0mm",
        left: "0mm",
      };

      // Disable Puppeteer's displayHeaderFooter (native @page renders in margins)
      config.pdf_options.displayHeaderFooter = false;

      info.headerFooter = {
        type: "css @page",
        header: summarize(header),
        footer: summarize(footer),
      };
    }
  } else {
    info.headerFooter = { type: "none" };
  }

  // Auto-enable displayHeaderFooter if raw templates are set via pdf_options
  const { headerTemplate, footerTemplate, displayHeaderFooter } = config.pdf_options;

  if ((headerTemplate || footerTemplate) && displayHeaderFooter === undefined) {
    config.pdf_options.displayHeaderFooter = true;
  }

  // Process @include directives (file paths or template names)
  let processedMd = md;

  try {
    processedMd = await processIncludes(md, baseDir, config.templates);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new IncludeError("", message, { cause: error });
  }

  // Substitute {{ constant }} / {{ constant * 1.5 }} placeholders.
  // Runs after includes so included files see the same constants.
  const constants = processConstants(processedMd, config.constants, {
    locale: config.constants_locale,
    precision: config.constants_precision,
  });

  processedMd = constants.content;

  for (const warning of constants.warnings) {
    info.warnings.push(`Constant: ${warning}`);
  }

  // Process :icon[prefix:name] syntax - fetch and inline SVGs from Iconify
  try {
    processedMd = await processIcons(processedMd, config.iconify_api);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    info.warnings.push(`Icon processing failed: ${message} (continuing with placeholders)`);
  }

  // Process @see Section Name → [Section Name](#section-name)
  processedMd = processXref(processedMd);

  // auto-detect document title from first heading if not set
  if (!config.document_title) {
    config.document_title = extractFirstHeading(processedMd) ?? "";
  }

  if (options.fillable !== undefined) {
    config.fillable = options.fillable;
  }

  const output: OutputTarget =
    options.output ??
    ("path" in input
      ? { kind: "file", path: getOutputFilePath(input.path, format) }
      : { kind: "stdout" });

  const highlightStylesheet = resolve(
    dirname(require.resolve("highlight.js")),
    "..",
    "styles",
    `${config.code_block_style}.css`,
  );

  // Appended unless the user already placed it; other repeats are kept, since
  // dropping one would change the cascade.
  const hasHighlight = config.stylesheet.some(
    (s) => s.type === "path" && s.value === highlightStylesheet,
  );

  if (!hasHighlight) {
    config.stylesheet = [...config.stylesheet, { type: "path", value: highlightStylesheet }];
  }

  // Validate stylesheets exist and have valid syntax
  const validatedStylesheets: StylesheetEntry[] = [];

  for (const stylesheet of config.stylesheet) {
    if (stylesheet.type === "url") {
      validatedStylesheets.push(stylesheet);
    } else if (stylesheet.type === "content") {
      const result = validateCss(stylesheet.value);

      if (!result.valid) {
        info.warnings.push(...formatCssErrors(result.errors, "inline CSS"));
      }

      validatedStylesheets.push(stylesheet);
    } else {
      const file = stylesheet.value;

      try {
        const css = await fs.readFile(file, "utf-8");
        const result = validateCss(css, basename(file));

        if (!result.valid) {
          info.warnings.push(...formatCssErrors(result.errors, basename(file)));
        }

        validatedStylesheets.push(stylesheet);
      } catch (error) {
        const isMissing = error instanceof Error && "code" in error && error.code === "ENOENT";

        if (isMissing) {
          info.warnings.push(`Stylesheet not found: ${file}`);
        } else {
          info.warnings.push(`Stylesheet not readable: ${file}`);
        }
      }
    }
  }

  const html = getHtml(processedMd, config);

  // Page numbers are read back from a laid-out PDF, so HTML output has nothing
  // to resolve them against and the "??" placeholders survive into the file.
  // Say so rather than letting the user discover it in the output.
  if (format === "html" && hasPageRefs(html)) {
    info.warnings.push(
      "Page references (@pageof / toc_options.page_numbers) cannot be resolved for HTML output; they render as '??' placeholders.",
    );
  }

  // The <base href> must point at the directory containing the document, not
  // at the document itself — otherwise a relative image resolves to
  // "…/doc.md/image.jpg" and fails to load. pathToFileURL percent-encodes
  // characters such as `"`, `#` and `?` that would otherwise end the path; the
  // renderers still HTML-escape it where they write it into the page.
  const directoryUrl = pathToFileURL(baseDir);

  if (!directoryUrl.pathname.endsWith("/")) {
    directoryUrl.pathname += "/";
  }

  const baseUrl = directoryUrl.href;

  return {
    html,
    stylesheets: validatedStylesheets,
    scripts: config.script,
    pdfOptions: config.pdf_options,
    baseUrl,
    config,
    embeddedFonts,
    info,
    format,
    output,
  };
}
