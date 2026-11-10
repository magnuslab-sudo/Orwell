import react from "@vitejs/plugin-react"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import { resolve } from "node:path"

export default defineConfig({
  main: {
    // `@enclave/*` and their MLS dependencies are ESM-only, and the main bundle
    // is CommonJS (see below). Bundling them rather than externalising avoids
    // relying on `require(esm)` interop, and keeps the shipped surface to code
    // that is actually reachable.
    plugins: [
      externalizeDepsPlugin({ exclude: ["@enclave/client-core", "@enclave/crypto", "@enclave/protocol"] }),
    ],
    build: {
      outDir: resolve("out/main"),
      rollupOptions: {
        input: { index: resolve("src/main/index.ts") },
        // CommonJS, deliberately. Electron's ESM main entry never resolves
        // `app.whenReady()` in this build — the process starts, evaluates the
        // module, and then sits there with no window and no error. A CJS entry
        // is boring and works.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve("out/preload"),
      rollupOptions: {
        // Two bridges: the main window one and the game overlay one, which is much
        // smaller (see `src/preload/overlay.ts`).
        input: { index: resolve("src/preload/index.ts"), overlay: resolve("src/preload/overlay.ts") },
        // A sandboxed preload has no ESM loader, so this must be CommonJS. The
        // sandbox is worth far more than the module syntax: it is what stops a
        // renderer compromise from reaching the filesystem.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },

  renderer: {
    root: resolve("src/renderer"),
    plugins: [react()],
    build: {
      // Without this the output lands relative to `root` and escapes the app.
      outDir: resolve("out/renderer"),
      emptyOutDir: true,
      rollupOptions: {
        input: { index: resolve("src/renderer/index.html"), overlay: resolve("src/renderer/overlay.html") },
      },
    },
  },
})
