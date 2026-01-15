interface FileItem {
	path: string;
	name: string;
	status: "pending" | "converting" | "done" | "error";
	progress: number;
	error?: string;
}

interface FileListProps {
	files: FileItem[];
	onRemove: (path: string) => void;
	onClear: () => void;
}

export default function FileList({ files, onRemove, onClear }: FileListProps) {
	return (
		<div className="mt-6 bg-white rounded-lg shadow">
			<div className="flex items-center justify-between p-3 border-b">
				<span className="font-medium text-gray-700">
					{files.length} file{files.length !== 1 ? "s" : ""}
				</span>
				<button
					type="button"
					onClick={onClear}
					className="text-sm text-red-600 hover:text-red-700"
				>
					Clear all
				</button>
			</div>

			<ul className="divide-y">
				{files.map((file) => (
					<li key={file.path} className="p-3 flex items-center gap-3">
						<StatusIcon status={file.status} />

						<div className="flex-1 min-w-0">
							<p className="text-sm font-medium text-gray-800 truncate">
								{file.name}
							</p>
							{file.status === "converting" && (
								<div className="mt-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
									<div
										className="h-full bg-blue-500 transition-all"
										style={{ width: `${file.progress}%` }}
									/>
								</div>
							)}
							{file.error ? (
								<p className="text-xs text-red-600 mt-1">{file.error}</p>
							) : null}
						</div>

						<button
							type="button"
							onClick={() => onRemove(file.path)}
							aria-label="Remove file"
							className="text-gray-400 hover:text-red-600 transition-colors"
						>
							<svg
								aria-hidden="true"
								className="w-5 h-5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

function StatusIcon({ status }: { status: FileItem["status"] }) {
	switch (status) {
		case "pending":
			return <div className="w-5 h-5 rounded-full border-2 border-gray-300" />;
		case "converting":
			return (
				<div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
			);
		case "done":
			return (
				<svg
					aria-hidden="true"
					className="w-5 h-5 text-green-500"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M5 13l4 4L19 7"
					/>
				</svg>
			);
		case "error":
			return (
				<svg
					aria-hidden="true"
					className="w-5 h-5 text-red-500"
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
			);
	}
}
