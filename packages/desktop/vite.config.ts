import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import type { ElectronOptions } from "vite-plugin-electron";
import electron from "vite-plugin-electron/simple";

// The plugin does not export the onstart argument type directly.
type OnStartArgs = Parameters<NonNullable<ElectronOptions["onstart"]>>[0];

const dir: string = import.meta.dirname;

const electronArgv: string[] = [".", "--no-sandbox"];

// SAFETY: this reads the package's own checked-in package.json, whose
// dependencies field, when present, maps package names to version strings.
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

// The packaged renderer page gets a Content-Security-Policy. It is added at
// build time only: the dev server injects inline scripts (HMR, React refresh)
// that this policy would block. It is prepended so it precedes every script,
// stylesheet and modulepreload Vite emits. frame-src allows the blob: URL the
// PDF preview iframe loads; nothing else in the page needs more than 'self'.
const contentSecurityPolicy: Plugin = {
  name: "mdforge-content-security-policy",
  apply: "build",
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: {
        "http-equiv": "Content-Security-Policy",
        content: [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "frame-src blob:",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
        ].join("; "),
      },
      injectTo: "head-prepend",
    },
  ],
};

// The renderer is the Vite root; vite-plugin-electron builds the main and
// preload processes alongside it and starts Electron in dev. Output paths are
// pinned to out/{main,preload,renderer} because electron-builder.yml packages
// out/**/* and package.json points main at ./out/main/index.js.
// Root pnpm clean runs each package's clean script; desktop removes these
// bundles, release packages and its TypeScript build cache.
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
    contentSecurityPolicy,
    electron({
      main: {
        entry: resolve(dir, "src/main/index.ts"),
        // In dev the plugin runs `electron .` from the Vite root, which here is
        // src/renderer and holds no package.json. Launch from the package root
        // instead, so Electron finds the manifest and its main field.
        onstart({ startup }: OnStartArgs): void {
          void startup(electronArgv, { cwd: dir });
        },
        vite: {
          build: {
            outDir: resolve(dir, "out/main"),
            // platform: "node" is repeated from the plugin's own defaults
            // because supplying rolldownOptions here replaces them wholesale
            // rather than merging. Without it the main process is bundled as a
            // browser target. The external list keeps linked workspace
            // packages out, which rolldown would otherwise inline.
            rolldownOptions: {
              platform: "node",
              external,
            },
          },
        },
      },
      preload: {
        input: resolve(dir, "src/preload/index.ts"),
        // The plugin's default preload hook calls reload(), which starts
        // Electron from the Vite root when no app is running yet. That happens
        // whenever the preload finishes before main has launched Electron (for
        // example on the first run, while the Electron binary downloads), and
        // fails for the same reason as above. Reload only a running app, and
        // otherwise launch from the package root.
        onstart({ startup, reload }: OnStartArgs): void {
          // The plugin stores the running child on process.electronApp but
          // does not declare it on the Process type.
          // SAFETY: the assertion only adds an optional property of type
          // unknown, which every object satisfies, and the value is only
          // tested for truthiness.
          if ((process as { electronApp?: unknown }).electronApp) {
            reload();
          } else {
            void startup(electronArgv, { cwd: dir });
          }
        },
        vite: {
          build: {
            outDir: resolve(dir, "out/preload"),
            // The main window is sandboxed, and a sandboxed preload runs as a
            // plain script: it cannot be an ES module. Pin CommonJS and the
            // .cjs name the main process loads, rather than letting the plugin
            // pick either from config.root (src/renderer, no package.json).
            // A mismatch leaves contextBridge unset and the window blank.
            rolldownOptions: {
              platform: "node",
              external,
              output: { format: "cjs", entryFileNames: "index.cjs" },
            },
          },
        },
      },
    }),
  ],
});
