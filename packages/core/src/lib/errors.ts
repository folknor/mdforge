/**
 * Custom error classes for mdforge
 */

/**
 * Base error class for mdforge errors
 */
export class MdforgeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MdforgeError";
	}
}

/**
 * Error thrown when a file is not found
 */
export class FileNotFoundError extends MdforgeError {
	readonly path: string;

	constructor(path: string, context?: string) {
		const message = context
			? `${context}: ${path}`
			: `File not found: ${path}`;
		super(message);
		this.name = "FileNotFoundError";
		this.path = path;
	}
}

/**
 * Error thrown when configuration is invalid
 */
export class ConfigError extends MdforgeError {
	constructor(message: string) {
		super(message);
		this.name = "ConfigError";
	}
}

/**
 * Error thrown when PDF/HTML generation fails
 */
export class GenerationError extends MdforgeError {
	readonly cause?: Error;

	constructor(message: string, cause?: Error) {
		super(message);
		this.name = "GenerationError";
		this.cause = cause;
	}
}

/**
 * Error thrown when an include file cannot be processed
 */
export class IncludeError extends MdforgeError {
	readonly path: string;

	constructor(path: string, reason: string) {
		super(`Include error: ${reason}`);
		this.name = "IncludeError";
		this.path = path;
	}
}
