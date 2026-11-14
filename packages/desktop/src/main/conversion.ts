import process from "node:process";
import {
  type Config,
  convertMdToPdf,
  defaultConfig,
  fontPairings,
  isFontPairingPreset,
} from "@mdforge/renderer-electron";
import type { ConversionConfig, ConversionResult, PreviewConfig, PreviewResult } from "../types";

// Simple logger - enable with MDFORGE_DEBUG=1
const DEBUG: boolean = process.env["MDFORGE_DEBUG"] === "1";

function log(...args: unknown[]): void {
  if (DEBUG) {
    console.log("[desktop:conversion]", ...args);
  }
}

export async function convertFile(
  filePath: string,
  config: ConversionConfig,
  onProgress?: (progress: number) => void,
): Promise<ConversionResult> {
  log("convertFile called:", filePath);
  const outputPath = config.outputPath ?? "";

  try {
    const mergedConfig: Config = { ...defaultConfig };

    if (config.theme) {
      mergedConfig.theme = config.theme;
    }

    // An unknown name leaves fonts unset, so the theme's pairing applies
    if (config.fontPairing && isFontPairingPreset(config.fontPairing)) {
      mergedConfig.fonts = { ...fontPairings[config.fontPairing] };
    }

    if (config.author) {
      mergedConfig.metadata = { author: config.author };
    }

    log("Starting conversion with config:", JSON.stringify(mergedConfig));
    onProgress?.(50);

    log("Calling convertMdToPdf...");

    // No output path means convert without writing, as it always has
    const result = await convertMdToPdf({ path: filePath }, mergedConfig, {
      format: "pdf",
      output: config.outputPath ? { kind: "file", path: config.outputPath } : { kind: "none" },
    });

    log("convertMdToPdf returned successfully");

    onProgress?.(100);

    return {
      success: true,
      inputPath: filePath,
      outputPath: result.filename ?? outputPath,
      warnings: result.info.warnings,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log("Conversion error:", err.message, err.stack);

    return {
      success: false,
      inputPath: filePath,
      outputPath,
      error: err.message,
      warnings: [],
    };
  }
}

export async function convertFiles(
  files: string[],
  config: ConversionConfig,
  onProgress?: (file: string, progress: number) => void,
): Promise<ConversionResult[]> {
  const results: ConversionResult[] = [];

  for (const file of files) {
    const result = await convertFile(
      file,
      {
        ...config,
        outputPath: getOutputPath(file, config.outputDir),
      },
      (progress) => onProgress?.(file, progress),
    );

    results.push(result);
  }

  return results;
}

function getOutputPath(inputPath: string, outputDir: string): string {
  const basename = inputPath.replace(/\.[^.]+$/, "");
  const filename = basename.split(/[/\\]/).pop() ?? "output";

  return `${outputDir}/${filename}.pdf`;
}

export interface PreviewOutcome {
  result: PreviewResult;
  /**
   * Files other than the source whose content or existence decided the
   * preview, relative to the source's directory; undefined when it failed.
   */
  dependencies: string[] | undefined;
}

export async function generatePreview(
  filePath: string,
  config: PreviewConfig,
): Promise<PreviewOutcome> {
  log("generatePreview called:", filePath);

  try {
    const mergedConfig: Config = { ...defaultConfig };

    if (config.theme) {
      mergedConfig.theme = config.theme;
    }

    // An unknown name leaves fonts unset, so the theme's pairing applies
    if (config.fontPairing && isFontPairingPreset(config.fontPairing)) {
      mergedConfig.fonts = { ...fontPairings[config.fontPairing] };
    }

    if (config.author) {
      mergedConfig.metadata = { author: config.author };
    }

    log("Generating preview with config:", JSON.stringify(mergedConfig));

    // The preview only wants the bytes. Format and target are invocation
    // options, which the document's front matter cannot override.
    const result = await convertMdToPdf({ path: filePath }, mergedConfig, {
      format: "pdf",
      output: { kind: "none" },
    });

    log("Preview generated, size:", result.content.length);

    // Buffer extends Uint8Array; PDF output is never a string.
    if (!(result.content instanceof Uint8Array)) {
      throw new Error("Expected PDF bytes from the preview conversion");
    }

    const pdfData = result.content;

    return {
      result: { success: true, filePath, pdfData, warnings: result.info.warnings },
      dependencies: result.info.dependencies,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log("Preview error:", err.message, err.stack);

    return {
      result: { success: false, filePath, error: err.message },
      dependencies: undefined,
    };
  }
}
