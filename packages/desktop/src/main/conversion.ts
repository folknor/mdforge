import process from "node:process";
import {
  type Config,
  convertMdToPdf,
  defaultConfig,
} from "@mdforge/renderer-electron";
import type {
  ConversionConfig,
  ConversionResult,
  PreviewConfig,
  PreviewResult,
} from "../types";

// Simple logger - enable with MDFORGE_DEBUG=1
const DEBUG: boolean = process.env["MDFORGE_DEBUG"] === "1";
function log(...args: unknown[]): void {
  if (DEBUG) {
    // biome-ignore lint/suspicious/noConsole: Debug logging
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
    const mergedConfig: Partial<Config> = {
      ...defaultConfig,
      dest: outputPath,
    };

    if (config.theme) {
      mergedConfig.theme = config.theme;
    }

    if (config.fontPairing) {
      mergedConfig.fonts = config.fontPairing;
    }

    if (config.author) {
      mergedConfig.metadata = { author: config.author };
    }

    log("Starting conversion with config:", JSON.stringify(mergedConfig));
    onProgress?.(50);

    log("Calling convertMdToPdf...");
    const result = await convertMdToPdf(
      { path: filePath },
      mergedConfig as Config,
    );
    log("convertMdToPdf returned successfully");

    onProgress?.(100);

    return {
      success: true,
      inputPath: filePath,
      outputPath: result.filename ?? outputPath,
    };
  } catch (error) {
    const err = error as Error;
    log("Conversion error:", err.message, err.stack);
    return {
      success: false,
      inputPath: filePath,
      outputPath,
      error: err.message,
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

export async function generatePreview(
  filePath: string,
  config: PreviewConfig,
): Promise<PreviewResult> {
  log("generatePreview called:", filePath);
  try {
    const mergedConfig: Partial<Config> = {
      ...defaultConfig,
      // Don't write to file - we just want the buffer
      dest: undefined,
    };

    if (config.theme) {
      mergedConfig.theme = config.theme;
    }

    if (config.fontPairing) {
      mergedConfig.fonts = config.fontPairing;
    }

    if (config.author) {
      mergedConfig.metadata = { author: config.author };
    }

    log("Generating preview with config:", JSON.stringify(mergedConfig));
    const result = await convertMdToPdf(
      { path: filePath },
      mergedConfig as Config,
    );
    log("Preview generated, size:", result.content.length);

    // Convert Buffer to Uint8Array for IPC transfer. Buffer extends
    // Uint8Array, so only string output (HTML) needs encoding.
    const pdfData =
      result.content instanceof Uint8Array
        ? result.content
        : new TextEncoder().encode(result.content);

    return {
      success: true,
      filePath,
      pdfData,
    };
  } catch (error) {
    const err = error as Error;
    log("Preview error:", err.message, err.stack);
    return {
      success: false,
      filePath,
      error: err.message,
    };
  }
}
