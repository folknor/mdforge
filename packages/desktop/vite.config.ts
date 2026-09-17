import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { ElectronOptions } from "vite-plugin-electron";
import { esmShim } from "vite-plugin-electron/plugin";
import electron from "vite-plugin-electron/simple";

// The plugin does not export the onstart argument type directly.
type OnStartArgs = Parameters<NonNullable<ElectronOptions["onstart"]>>[0];

const dir: string = import.meta.dirname;

const pkg = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf-8")) as {
  dependencies?: Record<string, string>;
};

// Keep the main and preload bundles thin by resolving production dependencies
// at runtime instead of inlining them, which is what electron-vite did. Vite
// bundles linked workspace packages during SSR builds by default, so
// @mdforge/renderer-electron would otherwise pull core, pdf-lib and marked into
// the main process. electron-builder ships node_modules, so these resolve once
// packaged. puppeteer and electron-store are listed defensively: they are
// optional deps of the renderer packages rather than direct deps here.
const external: string[] = [
  "electron",
  ...Object.keys(pkg.dependencies ?? {}),
  "puppeteer",
  "electron-store",
];

// The renderer is the Vite root; vite-plugin-electron builds the main and
// preload processes alongside it and starts Electron in dev. Output paths are
// pinned to out/{main,preload,renderer} because electron-builder.yml packages
// out/**/* and package.json points main at ./out/main/index.js.
export default defineConfig({
  root: resolve(dir, "src/renderer"),
  // base is left unset: vite-plugin-electron already applies base: "./" to the
  // production build, which a packaged renderer needs because it is loaded
  // with loadFile().
  build: {
    outDir: resolve(dir, "out/renderer"),
    emptyOutDir: true,
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: resolve(dir, "src/main/index.ts"),
        // In dev the plugin runs `electron .` from the Vite root, which here is
        // src/renderer and holds no package.json. Launch from the package root
        // instead, so Electron finds the manifest and its main field.
        onstart({ startup }: OnStartArgs): void {
          void startup([".", "--no-sandbox"], { cwd: dir });
        },
        vite: {
          build: {
            outDir: resolve(dir, "out/main"),
            // vite-plugin-electron marks these as node builds via rolldown's
            // `platform: "node"`, which Vite 7 (rollup) ignores. Without ssr
            // the main process is bundled as a client build. Revisit if this
            // package moves to Vite 8.
            ssr: true,
            rollupOptions: { external, output: { format: "es" } },
          },
          // The package is type: module, so main is emitted as ESM where
          // __dirname does not exist. src/main/index.ts uses it to locate the
          // preload script and the built renderer.
          plugins: [esmShim()],
        },
      },
      preload: {
        input: resolve(dir, "src/preload/index.ts"),
        vite: {
          build: {
            outDir: resolve(dir, "out/preload"),
            ssr: true,
            // The plugin decides CJS vs ESM from config.root, which is
            // src/renderer here and holds no package.json, so it assumed CJS
            // and emitted `require` calls into a .mjs file. Electron parses
            // .mjs as ESM, the preload threw, and the contextBridge was never
            // set up, leaving the window blank. Pin the format instead.
            rollupOptions: { external, output: { format: "es" } },
          },
        },
      },
    }),
  ],
});
