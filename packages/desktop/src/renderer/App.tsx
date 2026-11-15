import type React from "react";
import { useEffect, useReducer, useState } from "react";
import type { ConversionConfig, ConversionProgress, PreviewConfig, WatchProblem } from "../types";
import ConfigPanel from "./components/ConfigPanel";
import DropZone from "./components/DropZone";
import FileList from "./components/FileList";
import PdfPreview from "./components/PdfPreview";
import { type AppAction, initialState, reducer } from "./state";

declare global {
  interface Window {
    electron: import("../types").ElectronAPI;
  }
}

export default function App(): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [outputDir, setOutputDir] = useState<string>("");
  const [watchProblems, setWatchProblems] = useState<WatchProblem[]>([]);
  const { files, selectedFile, theme, fontPairing, author, generation, outcome, batch } = state;
  const isConverting = batch != null;
  const previewDocument = state.document;

  // Listen for conversion progress
  useEffect(() => {
    return window.electron.onConversionProgress((progress: ConversionProgress) => {
      dispatch({ type: "conversionProgressed", progress });
    });
  }, []);

  // Requesting a preview makes the main process watch the file and what its
  // preview depended on; a change there regenerates the preview.
  useEffect(() => {
    const offChanged = window.electron.onPreviewSourceChanged(() => {
      dispatch({ type: "sourceChanged" });
    });

    const offProblems = window.electron.onWatchProblems(setWatchProblems);

    return (): void => {
      offChanged();
      offProblems();
    };
  }, []);

  // With nothing selected there is no preview request to scope the watch to
  useEffect(() => {
    if (selectedFile == null) void window.electron.stopPreviewWatch();
  }, [selectedFile]);

  // Generate the preview for the current generation. The other dependencies
  // only ever change together with `generation`.
  useEffect(() => {
    if (!selectedFile) return;

    let cancelled = false;

    const config: PreviewConfig = {
      theme,
      fontPairing,
      author: author || undefined,
    };

    const run = async (): Promise<void> => {
      let action: AppAction;

      try {
        const result = await window.electron.generatePreview(selectedFile, config);

        action = result.success
          ? {
              type: "previewSucceeded",
              generation,
              data: result.pdfData,
              warnings: result.warnings,
            }
          : { type: "previewFailed", generation, error: result.error };
      } catch (error) {
        // The main process reports conversion errors in the result; this is
        // the IPC invocation itself failing.
        action = {
          type: "previewFailed",
          generation,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      if (!cancelled) dispatch(action);
    };

    void run();

    return (): void => {
      cancelled = true;
    };
  }, [generation, selectedFile, theme, fontPairing, author]);

  const previewLoading = selectedFile != null && outcome?.generation !== generation;
  const previewError = outcome?.generation === generation ? outcome.error : null;

  const handleSelectOutputDir = async (): Promise<void> => {
    const dir = await window.electron.selectOutputDir();

    if (dir) {
      setOutputDir(dir);
    }
  };

  const handleConvert = async (): Promise<void> => {
    if (files.length === 0 || !outputDir || isConverting) return;

    // Unique across reloads: a batch started before one keeps reporting
    const token = crypto.randomUUID();

    // The members and the paths sent are the same snapshot
    dispatch({ type: "conversionStarted", token, members: files });

    const config: ConversionConfig = {
      theme,
      fontPairing,
      author: author || undefined,
      outputDir,
    };

    try {
      const results = await window.electron.convertFiles(
        token,
        files.map((f) => f.path),
        config,
      );

      dispatch({ type: "conversionFinished", token, results });
    } catch (error) {
      // Conversion errors come back as results; this is the invocation failing
      dispatch({
        type: "conversionFailed",
        token,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="h-screen bg-gray-100 flex">
      {/* Left panel - controls */}
      <div className="w-80 flex-shrink-0 p-4 overflow-y-auto">
        <DropZone onFilesAdded={(paths) => dispatch({ type: "filesAdded", paths })} />

        {files.length > 0 && (
          <FileList
            files={files}
            selectedPath={selectedFile}
            onSelect={(path) => dispatch({ type: "fileSelected", path })}
            onRemove={(path) => dispatch({ type: "fileRemoved", path })}
            onClear={() => dispatch({ type: "filesCleared" })}
          />
        )}

        <ConfigPanel
          theme={theme}
          fontPairing={fontPairing}
          author={author}
          onThemeChange={(value) => dispatch({ type: "themeChanged", theme: value })}
          onFontPairingChange={(value) =>
            dispatch({ type: "fontPairingChanged", fontPairing: value })
          }
          onAuthorChange={(value) => dispatch({ type: "authorChanged", author: value })}
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
          pdfData={previewDocument?.data ?? null}
          isLoading={previewLoading}
          error={previewError}
          fileName={
            selectedFile ? (files.find((f) => f.path === selectedFile)?.name ?? null) : null
          }
          generatedAt={previewDocument?.generatedAt ?? null}
          warnings={previewDocument?.warnings ?? []}
          watchProblems={watchProblems}
        />
      </div>
    </div>
  );
}
