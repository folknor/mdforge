import type React from "react";
import { useEffect, useRef } from "react";
import type { WatchProblem } from "../../types";

interface PdfPreviewProps {
  pdfData: Uint8Array | null;
  isLoading: boolean;
  error: string | null;
  fileName: string | null;
  generatedAt: Date | null;
  /** Files live preview cannot currently watch, so their edits may be missed. */
  watchProblems: WatchProblem[];
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function PdfPreview({
  pdfData,
  isLoading,
  error,
  fileName,
  generatedAt,
  watchProblems,
}: PdfPreviewProps): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // The object URL is an external resource with a lifetime, so the effect owns
  // it and points the iframe at it directly; `src` is deliberately not in the
  // JSX. The iframe stays mounted whenever there is data (the loading and
  // error overlays sit on top of it), so an unchanged pdfData never needs a
  // fresh URL for a fresh element.
  useEffect(() => {
    const frame = iframeRef.current;

    if (pdfData == null || frame == null) return;

    // SAFETY: pdfData only ever comes from the generatePreview IPC result,
    // and IPC structured-clones it into a Uint8Array backed by a plain
    // ArrayBuffer rather than a SharedArrayBuffer, which Blob requires.
    const blob = new Blob([pdfData as Uint8Array<ArrayBuffer>], {
      type: "application/pdf",
    });

    const url = URL.createObjectURL(blob);
    frame.src = url;

    return (): void => {
      frame.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [pdfData]);

  return (
    <div className="h-full bg-white rounded-lg shadow overflow-hidden flex flex-col">
      <div className="flex items-center justify-between p-3 border-b flex-shrink-0">
        <span className="font-medium text-gray-700">
          {fileName ? `Preview: ${fileName}` : "Preview"}
        </span>
        <div className="flex items-center gap-3">
          {watchProblems.length > 0 ? (
            <span
              className="text-xs text-amber-700"
              title={watchProblems.map((p) => `${p.path}: ${p.reason}`).join("\n")}
            >
              Live preview may miss changes
            </span>
          ) : null}
          {generatedAt != null && !isLoading ? (
            <span className="text-xs text-gray-500">{formatTime(generatedAt)}</span>
          ) : null}
          {isLoading ? <span className="text-sm text-blue-600">Generating...</span> : null}
        </div>
      </div>

      <div className="relative flex-1">
        {error != null ? (
          <div className="absolute inset-0 flex items-center justify-center bg-red-50">
            <div className="text-center p-4">
              <svg
                aria-hidden="true"
                className="w-12 h-12 text-red-400 mx-auto mb-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          </div>
        ) : null}

        {error == null && pdfData == null && !isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
            <div className="text-center p-4">
              <svg
                aria-hidden="true"
                className="w-12 h-12 text-gray-300 mx-auto mb-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p className="text-gray-500 text-sm">Select a file to preview</p>
            </div>
          </div>
        ) : null}

        {isLoading && pdfData == null ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
            <div className="text-center p-4">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-gray-600 text-sm">Generating preview...</p>
            </div>
          </div>
        ) : null}

        {pdfData != null ? (
          // The preview uses Chromium's built-in PDF viewer, which refuses to
          // load inside a sandboxed frame (Chromium rejects MimeHandlerView
          // loads there, and no sandbox token re-enables it), so a sandbox
          // attribute would leave the preview blank. That was not reproduced
          // on this app's Electron version. The PDF is built from user
          // Markdown, so its content is not trusted; what keeps it away from
          // the app is the viewer running in its own origin and process, not
          // where the bytes came from. Development runs with --no-sandbox,
          // which drops the OS sandbox around that process too.
          // oxlint-disable-next-line react/iframe-missing-sandbox -- see above
          <iframe ref={iframeRef} title="PDF Preview" className="w-full h-full border-0" />
        ) : null}

        {isLoading && pdfData != null ? (
          <div className="absolute top-2 right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full">
            Updating...
          </div>
        ) : null}
      </div>
    </div>
  );
}
