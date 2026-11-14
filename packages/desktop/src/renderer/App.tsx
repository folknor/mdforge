import type { Theme } from "@mdforge/renderer-electron/browser";
import type React from "react";
import { useEffect, useReducer, useState } from "react";
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

/** The last PDF that generated successfully for the selected file. */
interface PreviewDocument {
  data: Uint8Array;
  generatedAt: Date;
}

/** The latest preview attempt that finished, successful or not. */
interface PreviewOutcome {
  generation: number;
  error: string | null;
}

/**
 * Files, selection, settings and preview live in one reducer so that every
 * change to a preview input is one place that bumps `generation`. The preview
 * effect keys on it, and a result is current only when it carries the current
 * generation, so a superseded or out-of-order IPC response is ignored and
 * "loading" is derived rather than set from inside the effect.
 */
interface AppState {
  files: FileItem[];
  selectedFile: string | null;
  theme: Theme;
  fontPairing: string;
  author: string;
  /** Never reset, so a later request can never reuse an earlier number. */
  generation: number;
  document: PreviewDocument | null;
  outcome: PreviewOutcome | null;
}

type AppAction =
  | { type: "filesAdded"; paths: string[] }
  | { type: "fileRemoved"; path: string }
  | { type: "filesCleared" }
  | { type: "fileSelected"; path: string }
  | { type: "themeChanged"; theme: Theme }
  | { type: "fontPairingChanged"; fontPairing: string }
  | { type: "authorChanged"; author: string }
  | { type: "sourceChanged"; path: string }
  | { type: "previewSucceeded"; generation: number; data: Uint8Array }
  | { type: "previewFailed"; generation: number; error: string }
  | { type: "conversionStarted" }
  | { type: "conversionProgressed"; progress: ConversionProgress }
  | { type: "conversionFinished"; results: ConversionResult[] };

const initialState: AppState = {
  files: [],
  selectedFile: null,
  theme: "beryl",
  fontPairing: "beryl",
  author: "",
  generation: 0,
  document: null,
  outcome: null,
};

/**
 * Selects a file and starts a new preview generation. The previous file's PDF
 * is dropped rather than kept under the new file's name.
 */
function select(state: AppState, selectedFile: string | null): AppState {
  if (selectedFile === state.selectedFile) return state;

  return {
    ...state,
    selectedFile,
    generation: state.generation + 1,
    document: null,
    outcome: null,
  };
}

/** A settings change regenerates the preview but keeps the current PDF on screen meanwhile. */
function invalidate(state: AppState): AppState {
  return { ...state, generation: state.generation + 1 };
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "filesAdded": {
      const existing = new Set(state.files.map((f) => f.path));

      const added: FileItem[] = action.paths
        .filter((path) => !existing.has(path))
        .map((path) => ({
          path,
          name: path.split(/[/\\]/).pop() ?? path,
          status: "pending",
          progress: 0,
        }));

      const next = { ...state, files: [...state.files, ...added] };
      const first = added[0];

      return state.selectedFile == null && first ? select(next, first.path) : next;
    }

    case "fileRemoved": {
      const files = state.files.filter((f) => f.path !== action.path);
      const next = { ...state, files };

      return action.path === state.selectedFile ? select(next, files[0]?.path ?? null) : next;
    }

    case "filesCleared":
      return select({ ...state, files: [] }, null);

    case "fileSelected":
      return select(state, action.path);

    case "themeChanged":
      return action.theme === state.theme ? state : invalidate({ ...state, theme: action.theme });

    case "fontPairingChanged":
      return action.fontPairing === state.fontPairing
        ? state
        : invalidate({ ...state, fontPairing: action.fontPairing });

    case "authorChanged":
      return action.author === state.author
        ? state
        : invalidate({ ...state, author: action.author });

    case "sourceChanged":
      // A change notification from a watcher that was being torn down can
      // arrive after the selection moved on, so match the current selection.
      return action.path === state.selectedFile ? invalidate(state) : state;

    case "previewSucceeded":
      if (action.generation !== state.generation || state.selectedFile == null) return state;

      return {
        ...state,
        document: { data: action.data, generatedAt: new Date() },
        outcome: { generation: action.generation, error: null },
      };

    case "previewFailed":
      if (action.generation !== state.generation || state.selectedFile == null) return state;

      return { ...state, outcome: { generation: action.generation, error: action.error } };

    case "conversionStarted":
      return {
        ...state,
        files: state.files.map((f) => ({ ...f, status: "converting", progress: 0 })),
      };

    case "conversionProgressed": {
      const { progress } = action;

      return {
        ...state,
        files: state.files.map((f) =>
          f.path === progress.file
            ? {
                ...f,
                status: progress.progress === 100 ? "done" : "converting",
                progress: progress.progress,
              }
            : f,
        ),
      };
    }

    case "conversionFinished":
      return {
        ...state,
        files: state.files.map((f) => {
          const result = action.results.find((r) => r.inputPath === f.path);

          if (!result) return f;

          return {
            ...f,
            status: result.success ? "done" : "error",
            progress: 100,
            error: result.error,
          };
        }),
      };
  }
}

export default function App(): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [outputDir, setOutputDir] = useState<string>("");
  const [isConverting, setIsConverting] = useState(false);
  const { files, selectedFile, theme, fontPairing, author, generation, outcome } = state;
  const previewDocument = state.document;

  // Listen for conversion progress
  useEffect(() => {
    return window.electron.onConversionProgress((progress: ConversionProgress) => {
      dispatch({ type: "conversionProgressed", progress });
    });
  }, []);

  // Watch the selected file and regenerate the preview when it changes on disk.
  useEffect(() => {
    if (!selectedFile) return;

    const unsubscribe = window.electron.onFileChanged((path) => {
      dispatch({ type: "sourceChanged", path });
    });

    void window.electron.watchFile(selectedFile);

    return (): void => {
      unsubscribe();
      void window.electron.unwatchFile(selectedFile);
    };
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

        action =
          result.success && result.pdfData
            ? { type: "previewSucceeded", generation, data: result.pdfData }
            : {
                type: "previewFailed",
                generation,
                error: result.error ?? "Failed to generate preview",
              };
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
    if (files.length === 0 || !outputDir) return;

    setIsConverting(true);
    dispatch({ type: "conversionStarted" });

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

    dispatch({ type: "conversionFinished", results });
    setIsConverting(false);
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
        />
      </div>
    </div>
  );
}
