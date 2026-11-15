# CLI findings

## Inputs in one folder that differ only in extension share an output

Without `-o`, each input is written beside itself as `<name>.pdf` (core
`getOutputFilePath` in packages/core/src/lib/util.ts strips only the last
extension), so `a.md` and `a.markdown` in one folder, or `Notes.md` and
`notes.md` on a case-insensitive volume, both write the same file. The CLI
runs its files concurrently (`concurrent: true` in packages/cli/src/cli.ts),
so the two renders race and whichever renames last wins, both reported as
written. The desktop batch refuses this case by comparing written file
identities (packages/desktop/src/main/output-claims.ts); the CLI has no
equivalent. Reasoned from the code, not reproduced.
