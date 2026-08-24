import type { Theme } from "@mdforge/renderer-electron/browser";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConversionConfig,
  ConversionProgress,
  ConversionResult,
  PreviewConfig,
} from "../types";
import ConfigPanel from "./components/ConfigPanel";
import DropZone from "./components/DropZone";
import FileList from "./components/FileList";
import PdfPreview from "./components/PdfPreview";

declare global {
  interface Window {
    electron: import("../types").ElectronAPI;
  }
}

interface FileItem {
  path: string;
  name: string;
  status: "pending" | "converting" | "done" | "error";
  progress: number;
  error?: string;
}

export default function App(): React.ReactElement {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [outputDir, setOutputDir] = useState<string>("");
  const [theme, setTheme] = useState<Theme>("beryl");
  const [fontPairing, setFontPairing] = useState("beryl");
  const [author, setAuthor] = useState("");
  const [isConverting, setIsConverting] = useState(false);

  // Preview state
  const [previewData, setPreviewData] = useState<Uint8Array | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewGeneratedAt, setPreviewGeneratedAt] = useState<Date | null>(
    null,
  );
  const watchedFileRef = useRef<string | null>(null);

  // Listen for conversion progress
  useEffect(() => {
    const unsubscribe = window.electron.onConversionProgress(
      (progress: ConversionProgress) => {
        setFiles((prev) =>
          prev.map((f) =>
            f.path === progress.file
              ? {
                  ...f,
                  status: progress.progress === 100 ? "done" : "converting",
                  progress: progress.progress,
                }
              : f,
          ),
        );
      },
    );
    return unsubscribe;
  }, []);

  // Generate preview for selected file
  const generatePreview = useCallback(
    async (filePath: string) => {
      setPreviewLoading(true);
      setPreviewError(null);

      const config: PreviewConfig = {
        theme,
        fontPairing,
        author: author || undefined,
      };

      const result = await window.electron.generatePreview(filePath, config);

      if (result.success && result.pdfData) {
        setPreviewData(result.pdfData);
        setPreviewError(null);
        setPreviewGeneratedAt(new Date());
      } else {
        setPreviewError(result.error ?? "Failed to generate preview");
      }

      setPreviewLoading(false);
    },
    [theme, fontPairing, author],
  );

  // Watch selected file for changes
  useEffect(() => {
    if (!selectedFile) return;

    // Start watching the file
    const watchedFile = selectedFile;
    void window.electron.watchFile(watchedFile);
    watchedFileRef.current = watchedFile;

    // Listen for file changes
    const unsubscribe = window.electron.onFileChanged((filePath) => {
      if (filePath === watchedFile) {
        void generatePreview(watchedFile);
      }
    });

    return (): void => {
      unsubscribe();
      void window.electron.unwatchFile(watchedFile);
      watchedFileRef.current = null;
    };
  }, [selectedFile, generatePreview]);

  // Generate preview when selected file or config changes
  useEffect(() => {
    if (selectedFile) {
      void generatePreview(selectedFile);
    } else {
      setPreviewData(null);
      setPreviewError(null);
    }
  }, [selectedFile, generatePreview]);

  const handleFilesAdded = useCallback((paths: string[]) => {
    const newFiles: FileItem[] = paths.map((path) => ({
      path,
      name: path.split(/[/\\]/).pop() ?? path,
      status: "pending",
      progress: 0,
    }));
    setFiles((prev) => {
      const existingPaths = new Set(prev.map((f) => f.path));
      const unique = newFiles.filter((f) => !existingPaths.has(f.path));
      const updated = [...prev, ...unique];

      // Auto-select first file if nothing is selected
      if (unique.length > 0) {
        setSelectedFile((current) => current ?? unique[0].path);
      }

      return updated;
    });
  }, []);

  const handleSelectOutputDir = async (): Promise<void> => {
    const dir = await window.electron.selectOutputDir();
    if (dir) {
      setOutputDir(dir);
    }
  };

  const handleConvert = async (): Promise<void> => {
    if (files.length === 0 || !outputDir) return;

    setIsConverting(true);
    setFiles((prev) =>
      prev.map((f) => ({ ...f, status: "converting" as const, progress: 0 })),
    );

    const config: ConversionConfig = {
      theme,
      fontPairing,
      author: author || undefined,
      outputDir,
    };

    const results = await window.electron.convertFiles(
      files.map((f) => f.path),
      config,
    );

    setFiles((prev) =>
      prev.map((f) => {
        const result = results.find(
          (r: ConversionResult) => r.inputPath === f.path,
        );
        if (result) {
          return {
            ...f,
            status: result.success ? "done" : "error",
            progress: 100,
            error: result.error,
          };
        }
        return f;
      }),
    );

    setIsConverting(false);
  };

  const handleSelectFile = (path: string): void => {
    setSelectedFile(path);
  };

  const handleRemoveFile = (path: string): void => {
    setFiles((prev) => {
      const updated = prev.filter((f) => f.path !== path);
      // If we removed the selected file, select another one
      if (path === selectedFile) {
        setSelectedFile(updated.length > 0 ? updated[0].path : null);
      }
      return updated;
    });
  };

  const handleClearFiles = (): void => {
    setFiles([]);
    setSelectedFile(null);
    setPreviewData(null);
    setPreviewError(null);
    setPreviewGeneratedAt(null);
  };

  return (
    <div className="h-screen bg-gray-100 flex">
      {/* Left panel - controls */}
      <div className="w-80 flex-shrink-0 p-4 overflow-y-auto">
        <DropZone onFilesAdded={handleFilesAdded} />

        {files.length > 0 && (
          <FileList
            files={files}
            selectedPath={selectedFile}
            onSelect={handleSelectFile}
            onRemove={handleRemoveFile}
            onClear={handleClearFiles}
          />
        )}

        <ConfigPanel
          theme={theme}
          fontPairing={fontPairing}
          author={author}
          onThemeChange={setTheme}
          onFontPairingChange={setFontPairing}
          onAuthorChange={setAuthor}
        />

        <div className="mt-4 bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSelectOutputDir}
              className="px-3 py-1.5 text-sm bg-gray-200 rounded hover:bg-gray-300 transition-colors"
            >
              Output Folder
            </button>
            <span className="text-xs text-gray-600 truncate flex-1">
              {outputDir || "Not selected"}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleConvert}
          disabled={files.length === 0 || !outputDir || isConverting}
          className="mt-4 w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold
                     hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed
                     transition-colors"
        >
          {isConverting ? "Converting..." : "Generate PDFs"}
        </button>
      </div>

      {/* Right panel - preview */}
      <div className="flex-1 p-4 pl-0">
        <PdfPreview
          pdfData={previewData}
          isLoading={previewLoading}
          error={previewError}
          fileName={
            selectedFile
              ? (files.find((f) => f.path === selectedFile)?.name ?? null)
              : null
          }
          generatedAt={previewGeneratedAt}
        />
      </div>
    </div>
  );
}
