import { type DragEvent, useCallback, useState } from "react";

interface DropZoneProps {
	onFilesAdded: (paths: string[]) => void;
}

export default function DropZone({ onFilesAdded }: DropZoneProps) {
	const [isDragging, setIsDragging] = useState(false);

	const handleDragOver = useCallback((e: DragEvent) => {
		e.preventDefault();
		setIsDragging(true);
	}, []);

	const handleDragLeave = useCallback((e: DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
	}, []);

	const handleDrop = useCallback(
		(e: DragEvent) => {
			e.preventDefault();
			setIsDragging(false);

			const paths: string[] = [];
			const items = e.dataTransfer.files;

			for (let i = 0; i < items.length; i++) {
				const file = items[i];
				if (file) {
					// Get the path from the File object (available in Electron)
					const path = (file as File & { path?: string }).path;
					if (path && (path.endsWith(".md") || path.endsWith(".markdown"))) {
						paths.push(path);
					}
				}
			}

			if (paths.length > 0) {
				onFilesAdded(paths);
			}
		},
		[onFilesAdded],
	);

	const handleSelectFiles = async () => {
		const paths = await window.electron.selectFiles();
		if (paths.length > 0) {
			onFilesAdded(paths);
		}
	};

	const handleSelectFolder = async () => {
		const folder = await window.electron.selectFolder();
		if (folder) {
			// In a real implementation, we'd scan for .md files in the folder
			// For now, just show the folder selection worked
			// This would need backend support to scan directory
			console.log("Selected folder:", folder);
		}
	};

	return (
		<section
			aria-label="File drop zone"
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			className={`
        border-2 border-dashed rounded-lg p-8 text-center transition-colors
        ${isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-white"}
      `}
		>
			<div className="text-gray-600 mb-4">
				<svg
					aria-hidden="true"
					className="w-12 h-12 mx-auto mb-3 text-gray-400"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
					/>
				</svg>
				<p className="text-lg font-medium">Drop Markdown files here</p>
				<p className="text-sm text-gray-500 mt-1">or</p>
			</div>

			<div className="flex gap-3 justify-center">
				<button
					type="button"
					onClick={handleSelectFiles}
					className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
				>
					Select Files
				</button>
				<button
					type="button"
					onClick={handleSelectFolder}
					className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
				>
					Select Folder
				</button>
			</div>
		</section>
	);
}
