import type { Theme } from "@mdforge/renderer-electron/browser";
import type { ConversionProgress, ConversionResult } from "../types";

export interface FileItem {
  /**
   * Identity of this list entry. A file removed and added again is a new entry
   * with a new id, so it never inherits a batch it was not part of.
   */
  id: number;
  path: string;
  name: string;
  status: "pending" | "converting" | "done" | "error";
  progress: number;
  error?: string;
  /** From the last finished conversion of this file. */
  warnings: string[];
}

/**
 * The batch conversion in flight. `token` is unique across renderer lifetimes
 * and echoed by the main process in every progress event, so events from a
 * batch started before a reload are not mistaken for this one's. `members`
 * maps each path passed to the conversion to the entry it was started for;
 * progress and results reach an entry only while that entry still exists.
 */
export interface Batch {
  token: string;
  members: ReadonlyMap<string, number>;
}

/**
 * The last PDF that generated successfully for the selected file. Its warnings
 * belong to it, so they are replaced only with it.
 */
export interface PreviewDocument {
  data: Uint8Array;
  generatedAt: Date;
  warnings: string[];
}

/** The latest preview attempt that finished, successful or not. */
export interface PreviewOutcome {
  generation: number;
  error: string | null;
}

/**
 * Files, selection, settings, preview and batch live in one reducer so that
 * every change to a preview input is one place that bumps `generation`. The
 * preview effect keys on it, and a result is current only when it carries the
 * current generation, so a superseded or out-of-order IPC response is ignored
 * and "loading" is derived rather than set from inside the effect.
 */
export interface AppState {
  files: FileItem[];
  /** Never reset, so a removed entry's id is never reused. */
  nextFileId: number;
  selectedFile: string | null;
  theme: Theme;
  fontPairing: string;
  author: string;
  /** Never reset, so a later request can never reuse an earlier number. */
  generation: number;
  document: PreviewDocument | null;
  outcome: PreviewOutcome | null;
  batch: Batch | null;
}

export type AppAction =
  | { type: "filesAdded"; paths: string[] }
  | { type: "fileRemoved"; path: string }
  | { type: "filesCleared" }
  | { type: "fileSelected"; path: string }
  | { type: "themeChanged"; theme: Theme }
  | { type: "fontPairingChanged"; fontPairing: string }
  | { type: "authorChanged"; author: string }
  | { type: "sourceChanged" }
  | { type: "previewSucceeded"; generation: number; data: Uint8Array; warnings: string[] }
  | { type: "previewFailed"; generation: number; error: string }
  /** `members` are exactly the entries whose paths are passed to the conversion. */
  | { type: "conversionStarted"; token: string; members: readonly FileItem[] }
  | { type: "conversionProgressed"; progress: ConversionProgress }
  | { type: "conversionFinished"; token: string; results: ConversionResult[] }
  /** The conversion invocation itself failed; per-file failures are results. */
  | { type: "conversionFailed"; token: string; error: string };

export const initialState: AppState = {
  files: [],
  nextFileId: 0,
  selectedFile: null,
  theme: "beryl",
  fontPairing: "beryl",
  author: "",
  generation: 0,
  document: null,
  outcome: null,
  batch: null,
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

/** Applies `update` to the entries the current batch was started for. */
function updateMembers(
  state: AppState,
  batch: Batch,
  update: (file: FileItem) => FileItem,
): FileItem[] {
  return state.files.map((f) => (batch.members.get(f.path) === f.id ? update(f) : f));
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "filesAdded": {
      // Paths are unique in the list, which batch membership relies on
      const seen = new Set(state.files.map((f) => f.path));
      const added: FileItem[] = [];
      let nextFileId = state.nextFileId;

      for (const path of action.paths) {
        if (seen.has(path)) continue;
        seen.add(path);
        added.push({
          id: nextFileId++,
          path,
          name: path.split(/[/\\]/).pop() ?? path,
          status: "pending",
          progress: 0,
          warnings: [],
        });
      }

      const next = { ...state, files: [...state.files, ...added], nextFileId };
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
      // A notification meant for the previous selection can land just after
      // the selection moved on; that costs one redundant preview at most.
      return state.selectedFile == null ? state : invalidate(state);

    case "previewSucceeded":
      if (action.generation !== state.generation || state.selectedFile == null) return state;

      return {
        ...state,
        document: { data: action.data, generatedAt: new Date(), warnings: action.warnings },
        outcome: { generation: action.generation, error: null },
      };

    case "previewFailed":
      if (action.generation !== state.generation || state.selectedFile == null) return state;

      return { ...state, outcome: { generation: action.generation, error: action.error } };

    case "conversionStarted": {
      // One batch at a time; the caller checks too, since a rejected start
      // here cannot stop an IPC call already made
      if (state.batch) return state;

      const batch: Batch = {
        token: action.token,
        members: new Map(action.members.map((f) => [f.path, f.id])),
      };

      return {
        ...state,
        batch,
        files: updateMembers(state, batch, (f) => ({
          ...f,
          status: "converting",
          progress: 0,
          error: undefined,
          warnings: [],
        })),
      };
    }

    case "conversionProgressed": {
      const { batch } = state;
      const { progress } = action;

      if (batch?.token !== progress.batch) return state;

      // Only conversionFinished marks a file done: that is when its result,
      // warnings included, is known.
      return {
        ...state,
        files: updateMembers(state, batch, (f) =>
          f.path === progress.file ? { ...f, progress: progress.progress } : f,
        ),
      };
    }

    case "conversionFinished": {
      const { batch } = state;

      if (batch?.token !== action.token) return state;

      const results = new Map(action.results.map((r) => [r.inputPath, r]));

      return {
        ...state,
        batch: null,
        files: updateMembers(state, batch, (f) => {
          const result = results.get(f.path);

          // The main process returns one result per input; never leave a
          // member spinning if it did not
          if (!result) {
            return { ...f, status: "error", progress: 100, error: "No result was returned" };
          }

          return {
            ...f,
            status: result.success ? "done" : "error",
            progress: 100,
            error: result.error,
            warnings: result.warnings,
          };
        }),
      };
    }

    case "conversionFailed": {
      const { batch } = state;

      if (batch?.token !== action.token) return state;

      return {
        ...state,
        batch: null,
        files: updateMembers(state, batch, (f) => ({
          ...f,
          status: "error",
          progress: 100,
          error: action.error,
          warnings: [],
        })),
      };
    }
  }
}
