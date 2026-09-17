import type React from "react";
import { useEffect, useState } from "react";

interface PdfPreviewProps {
  pdfData: Uint8Array | null;
  isLoading: boolean;
  error: string | null;
  fileName: string | null;
  generatedAt: Date | null;
}

export default function PdfPreview({
  pdfData,
  isLoading,
  error,
  fileName,
  generatedAt,
}: PdfPreviewProps): React.ReactElement {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // Create blob URL when PDF data changes
  useEffect(() => {
    if (pdfData) {
      // pdfData arrives over IPC, so it is always backed by a plain
      // ArrayBuffer rather than a SharedArrayBuffer, which Blob requires.
      const blob = new Blob([pdfData as Uint8Array<ArrayBuffer>], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);

      // Cleanup old blob URL
      return (): void => {
        URL.revokeObjectURL(url);
      };
    }
    setBlobUrl(null);
    return;
  }, [pdfData]);

  function formatTime(date: Date): string {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  return (
    <div className="h-full bg-white rounded-lg shadow overflow-hidden flex flex-col">
      <div className="flex items-center justify-between p-3 border-b flex-shrink-0">
        <span className="font-medium text-gray-700">
          {fileName ? `Preview: ${fileName}` : "Preview"}
        </span>
        <div className="flex items-center gap-3">
          {generatedAt != null && !isLoading ? (
            <span className="text-xs text-gray-500">
              {formatTime(generatedAt)}
            </span>
          ) : null}
          {isLoading ? (
            <span className="text-sm text-blue-600">Generating...</span>
          ) : null}
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

        {error == null && blobUrl == null && !isLoading ? (
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

        {isLoading && blobUrl == null ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
            <div className="text-center p-4">
              <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-gray-600 text-sm">Generating preview...</p>
            </div>
          </div>
        ) : null}

        {blobUrl != null ? (
          <iframe
            src={blobUrl}
            title="PDF Preview"
            className="w-full h-full border-0"
          />
        ) : null}

        {isLoading && blobUrl != null ? (
          <div className="absolute top-2 right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full">
            Updating...
          </div>
        ) : null}
      </div>
    </div>
  );
}
