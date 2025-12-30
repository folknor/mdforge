export interface ConversionConfig {
	theme?: string;
	fontPairing?: string;
	metadata?: {
		author?: string;
		title?: string;
	};
	outputDir: string;
	outputPath: string;
}

export interface ConversionResult {
	success: boolean;
	inputPath: string;
	outputPath: string;
	error?: string;
}

export interface UserPreferences {
	defaultTheme: string;
	defaultFontPairing: string;
	defaultAuthor: string;
	lastOutputDir: string;
	rememberLastDir: boolean;
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

	// File dialogs
	selectFiles: () => Promise<string[]>;
	selectFolder: () => Promise<string | null>;
	selectOutputDir: () => Promise<string | null>;

	// Preferences
	getPreferences: () => Promise<UserPreferences>;
	setPreferences: (prefs: Partial<UserPreferences>) => Promise<void>;

	// Events
	onConversionProgress: (
		callback: (progress: ConversionProgress) => void,
	) => () => void;
}
