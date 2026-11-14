// Renders an example document (or the one named by --in=) to PDF through @mdforge/renderer-electron, to
// verify the Electron rendering path across Electron upgrades. The desktop app
// is otherwise hard to exercise non-interactively.
//
// Must be CommonJS using the 'ready' event: awaiting app.whenReady() at the top
// level of an ESM entrypoint deadlocks, because Electron does not emit 'ready'
// until the entry module has finished evaluating.
//
// Run from packages/desktop (which provides the electron binary):
//   env -u DISPLAY -u WAYLAND_DISPLAY ./node_modules/.bin/electron \
//     --no-sandbox --ozone-platform=headless --disable-gpu \
//     ../../scripts/check-electron-render.cjs --out=/path/to/out.pdf

const { promises: fs } = require("node:fs");
const { join, resolve } = require("node:path");
const { app } = require("electron");

const repoRoot = resolve(__dirname, "..");

// Electron leaves both its own switches and the entry script path in argv, so
// take the input and destination from explicit --in= and --out= switches.
// Matching positionally risks resolving to this script's own path and
// overwriting it.
const inArg = process.argv.find((a) => a.startsWith("--in="));

const input = inArg
  ? resolve(inArg.slice("--in=".length))
  : join(repoRoot, "examples", "06-code-highlighting", "document.md");

const outArg = process.argv.find((a) => a.startsWith("--out="));

const output = outArg
  ? resolve(outArg.slice("--out=".length))
  : join(repoRoot, "electron-render.pdf");

// The renderer opens and closes a hidden window; without this the app would
// quit on window-all-closed before the conversion finishes.
app.on("window-all-closed", (e) => {
  e.preventDefault();
});

const out = (msg) => {
  process.stdout.write(`${msg}\n`);
};

app.on("ready", async () => {
  try {
    if (/\.(cjs|mjs|js|ts)$/.test(output)) {
      throw new Error(`refusing to write over a script: ${output}`);
    }

    const { convertMdToPdf } = await import(
      join(repoRoot, "packages/renderer-electron/dist/index.js")
    );

    const { defaultConfig } = await import(join(repoRoot, "packages/core/dist/index.js"));

    const result = await convertMdToPdf({ path: input }, defaultConfig, {
      output: { kind: "file", path: output },
    });

    const content = Buffer.from(result.content);
    await fs.writeFile(output, content);

    const header = content.subarray(0, 5).toString("latin1");

    const pages = (content.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

    out(`electron ${process.versions.electron}, chrome ${process.versions.chrome}`);
    out(`wrote ${output} (${content.length} bytes), header ${header}`);
    out(`pages: ${pages}`);

    for (const warning of result.info.warnings) {
      out(`warning: ${warning}`);
    }

    app.exit(header === "%PDF-" ? 0 : 1);
  } catch (err) {
    out(`render failed: ${err && err.stack ? err.stack : err}`);
    app.exit(1);
  }
});
