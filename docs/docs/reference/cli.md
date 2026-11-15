# CLI Reference

## Usage

```bash
mdforge [options] <files...>
```

## Options

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help |
| `-v, --version` | Show version |
| `-o, --output <path>` | Output file path (single file only) |
| `--as-html` | Output HTML instead of PDF |
| `--fillable` | Generate fillable PDF form fields (overrides the document's `fillable`) |
| `--config-file <path>` | Path to YAML configuration file |
| `-w, --watch` | Re-render when an input file or its stylesheet changes |

## Examples

```bash
# Single file
mdforge document.md

# Multiple files
mdforge file1.md file2.md file3.md
mdforge *.md

# Custom output path
mdforge document.md -o output.pdf

# With config file
mdforge document.md --config-file config.yaml

# Output HTML for debugging
mdforge --as-html document.md

# Re-render on every save (ctrl-c to stop)
mdforge --watch document.md
```

The output path and format are chosen only here: neither a config file nor a
document's front matter can set them. Without `-o`, each input is written
beside itself with a `.pdf` (or `.html`) extension, replacing only the last
extension. An input given twice (`a.md ./a.md`) is rendered once.

One run never lets an input replace a file the run wrote for another input:
`a.md` and `a.markdown` in one folder, `Notes.md` and `notes.md` on a
case-insensitive volume, or an output name that is a symlink to another
output. The files themselves are compared (device and inode), not their
names. The input given first on the command line keeps the file; the later
one fails with an error naming it. In watch mode this holds for the whole
session, so the later input keeps failing on every re-render. Files that
existed before the run are replaced as usual.

File output (PDF or HTML, including through the JavaScript API and desktop)
is written to a unique sibling temp file, closed, then renamed over the destination.
An existing file's permission bits are preserved; new files use the usual process
umask. The output directory must permit creating and renaming files, even when the
existing file itself is writable. A failed write or rename leaves the previous
output intact and removes the temp file. Replacement changes the inode: hard links
keep the old content. A destination that is a symlink is followed: the link
stays and its target is replaced (the temp file lives in the target's directory).
Ownership and ACLs are not copied. On Windows, an open destination or permissions
may prevent replacement; the conversion fails without deleting the old output.
This protects against interrupted writes, not power-loss durability (no fsync).

Each input renders independently (concurrently, then written in command-line
order): one that fails is reported on stderr and the
others are still written. Without `--watch`, the exit status is 1 if any input
failed.

Unknown options and options missing a required value are reported on stderr
with a `--help` hint and exit status 1.

Ctrl-C (SIGINT), SIGTERM and SIGHUP stop a run in either mode. The CLI stops
watching, drops pending re-renders, and closes the browser, which fails the
conversion in progress. Then it waits up to 10 seconds for that render to
finish cleaning up, and ends by re-raising the same signal. A shell therefore
sees an interrupted run (status 130, 143 or 129), not a success. A second signal,
or the 10 seconds running out, exits at once with that same status. An interrupted output
write leaves the previous output intact (or no output if none existed); abrupt
termination can leave a sibling `.mdforge-output-*.tmp` file behind.

## Watch mode

`--watch` renders once, then re-renders whenever an input changes. Alongside the
Markdown itself it watches the document's stylesheet paths, the files its front
matter references with `@file`, the `--config-file` and the files that
references, so a theme edit retriggers the render too. A watched file that does
not exist yet is watched for: creating it (or the directory it belongs in)
triggers a render. For a document that relies on the automatic stylesheet,
creating `<name>.css` triggers a render, and so does creating `index.css` while
`<name>.css` does not exist. Files pulled in with `@include` and images are not
watched. An input that fails to render is reported and watched like the rest,
including on the first run, so fixing it re-renders it; the inputs that rendered
beside it are unaffected. Files a render that fails never got to report are not
watched until a render succeeds, and a file created while a render is still running may be
missed. The browser stays open between runs, which makes each
re-render considerably faster than a cold start.

Saves are debounced, so the burst of writes an editor makes on save produces a
single render. Press ctrl-c to stop.

## Programmatic API

```typescript
import { convertMdToPdf, defaultConfig } from "@mdforge/renderer-puppeteer";

// From file: writes document.pdf beside it
const result = await convertMdToPdf({ path: "document.md" }, defaultConfig);

// From string, to memory only. Relative references in it (images, @file,
// includes) resolve against baseDir, default the working directory.
const html = await convertMdToPdf(
  { content: "# Hello\n\nWorld", baseDir: "docs" },
  { ...defaultConfig, theme: "tufte" },
  { format: "html", output: { kind: "none" } },
);

// result.content is a Uint8Array (PDF) or string (HTML)
// result.filename is the file written, if the output was a file
```

`convertMdToPdf` shares one browser between calls until `closeBrowser()`. To
launch with particular settings (the config file's `launch_options`), use a
pool of your own:

```typescript
import { BrowserPool, defaultConfig } from "@mdforge/renderer-puppeteer";

const pool = new BrowserPool({ executablePath: "/usr/bin/chromium" });
await pool.convertMdToPdf({ path: "document.md" }, defaultConfig);
await pool.close();
```

The third argument holds the invocation's choices, which front matter cannot
override:

- `format`: `"pdf"` (default) or `"html"`.
- `output`: `{ kind: "file", path }`, `{ kind: "stdout" }` or `{ kind: "none" }`.
  Default: a file beside a path input, stdout for content input.
- `fillable`: overrides the document's `fillable` when set.

`pdf_options` takes the options listed in the configuration reference (there
is no `path`; mdforge writes the output itself). The API also supports `marked_extensions` for custom [Marked extensions](https://marked.js.org/using_pro#extensions).
