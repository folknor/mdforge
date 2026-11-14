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
}

export interface PreviewResult {
  success: boolean;
  filePath: string;
  pdfData?: Uint8Array;
  error?: string;
}

export interface ConversionProgress {
  file: string;
  progress: number;
}

export interface ElectronAPI {
  // Conversion
  convertFiles: (
    files: string[],
    config: ConversionConfig,
  ) => Promise<ConversionResult[]>;

  // Preview
  generatePreview: (
    filePath: string,
    config: PreviewConfig,
  ) => Promise<PreviewResult>;
  watchFile: (filePath: string) => Promise<void>;
  unwatchFile: (filePath: string) => Promise<void>;

  // File dialogs
  selectFiles: () => Promise<string[]>;
  selectOutputDir: () => Promise<string | null>;

  // Filesystem path of a dropped File, or "" when it is not backed by a file
  getPathForFile: (file: File) => string;

  // Events
  onConversionProgress: (
    callback: (progress: ConversionProgress) => void,
  ) => () => void;
  onFileChanged: (callback: (filePath: string) => void) => () => void;
}
