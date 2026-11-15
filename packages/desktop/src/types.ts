import type { Theme } from "@mdforge/renderer-electron/browser";

export interface ConversionConfig {
  theme?: Theme;
  fontPairing?: string;
  author?: string;
  outputDir: string;
  outputPath?: string;
}

export interface PreviewConfig {
  theme?: Theme;
  fontPairing?: string;
  author?: string;
}

export interface ConversionResult {
  success: boolean;
  inputPath: string;
  outputPath: string;
  error?: string;
  /** What the conversion reported but survived; empty when it failed. */
  warnings: string[];
}

export type PreviewResult =
  | { success: true; filePath: string; pdfData: Uint8Array; warnings: string[] }
  | { success: false; filePath: string; error: string };

export interface ConversionProgress {
  /** The token the batch was started with, echoed unchanged. */
  batch: string;
  file: string;
  progress: number;
}

export interface ElectronAPI {
  // Conversion
  /**
   * `batch` is an opaque token, unique across renderer lifetimes, echoed in
   * every progress event of this conversion.
   */
  convertFiles: (
    batch: string,
    files: string[],
    config: ConversionConfig,
  ) => Promise<ConversionResult[]>;

  // Preview
  generatePreview: (filePath: string, config: PreviewConfig) => Promise<PreviewResult>;
  /**
   * Requesting a preview also watches the file and its dependencies; this
   * stops that when nothing is selected any more.
   */
  stopPreviewWatch: () => Promise<void>;

  // File dialogs
  selectFiles: () => Promise<string[]>;
  selectOutputDir: () => Promise<string | null>;

  // Filesystem path of a dropped File, or "" when it is not backed by a file
  getPathForFile: (file: File) => string;

  // Events
  onConversionProgress: (callback: (progress: ConversionProgress) => void) => () => void;
  /** The previewed file or one of its dependencies changed on disk. */
  onPreviewSourceChanged: (callback: () => void) => () => void;
  /** What live preview currently cannot watch; empty when everything is covered. */
  onWatchProblems: (callback: (problems: WatchProblem[]) => void) => () => void;
}

export interface WatchProblem {
  path: string;
  reason: string;
}
