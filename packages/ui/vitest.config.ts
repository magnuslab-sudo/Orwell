import { defineConfig } from "vitest/config"

// The UI is React, so tests need a DOM and the automatic JSX runtime — the
// other packages run on vitest's node defaults and need no config at all.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
  },
})
