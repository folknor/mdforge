#!/usr/bin/env node

import { promises as fs } from 'fs';
import { basename, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const examplesDir = join(__dirname, '..', 'examples');
const cliPath = join(__dirname, '..', 'dist', 'cli.js');

/**
 * Get all markdown files in an example directory.
 * Returns array of { input, output } paths.
 */
async function getMarkdownFiles(examplePath) {
	const entries = await fs.readdir(examplePath, { withFileTypes: true });
	const mdFiles = entries
		.filter(e => e.isFile() && e.name.endsWith('.md'))
		.map(e => ({
			input: join(examplePath, e.name),
			output: join(examplePath, e.name.replace(/\.md$/, '.pdf')),
			name: e.name,
		}));
	return mdFiles;
}

async function regenerateExamples() {
	const filterExample = process.argv[2]; // Optional: single example name

	try {
		// Read all directories in examples
		const entries = await fs.readdir(examplesDir, { withFileTypes: true });
		let exampleDirs = entries
			.filter(e => e.isDirectory())
			.map(e => e.name)
			.sort();

		// Filter to single example if specified
		if (filterExample) {
			const match = exampleDirs.find(d => d === filterExample || d.startsWith(filterExample));
			if (!match) {
				console.error(`Example "${filterExample}" not found`);
				console.error(`Available: ${exampleDirs.join(', ')}`);
				process.exit(1);
			}
			exampleDirs = [match];
		}

		console.log(`Found ${exampleDirs.length} example(s)\n`);

		let totalGenerated = 0;

		for (const dir of exampleDirs) {
			const examplePath = join(examplesDir, dir);
			const mdFiles = await getMarkdownFiles(examplePath);

			if (mdFiles.length === 0) {
				console.log(`⚠ Skipping ${dir}: no .md files found`);
				continue;
			}

			console.log(`${dir}/`);

			for (const { input, output, name } of mdFiles) {
				try {
					execSync(`node "${cliPath}" "${input}" -o "${output}"`, {
						stdio: 'pipe',
					});
					console.log(`  ✓ ${name}`);
					totalGenerated++;
				} catch (error) {
					console.error(`  ✗ Failed: ${name}`);
					console.error(`    ${error.message}`);
					process.exit(1);
				}
			}

			console.log('');
		}

		console.log(`Done! Generated ${totalGenerated} PDF(s).`);
	} catch (error) {
		console.error('Error:', error.message);
		process.exit(1);
	}
}

regenerateExamples();
