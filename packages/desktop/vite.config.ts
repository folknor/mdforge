import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";

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
  // A packaged build loads the renderer with loadFile(), so assets must be
  // referenced relatively rather than from the server root.
  base: "./",
  build: {
    outDir: resolve(dir, "out/renderer"),
    emptyOutDir: true,
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: resolve(dir, "src/main/index.ts"),
        vite: {
          build: {
            outDir: resolve(dir, "out/main"),
            // vite-plugin-electron marks these as node builds via rolldown's
            // `platform: "node"`, which Vite 7 (rollup) ignores. Without ssr
            // the main process is bundled as a client build. Revisit if this
            // package moves to Vite 8.
            ssr: true,
            rollupOptions: { external },
          },
        },
      },
      preload: {
        input: resolve(dir, "src/preload/index.ts"),
        vite: {
          build: {
            outDir: resolve(dir, "out/preload"),
            ssr: true,
            rollupOptions: { external },
          },
        },
      },
    }),
  ],
});
