import { defineConfig } from "vitest/config"

/**
 * The desktop bridge now has tests.
 *
 * This was the one that did not implement `applyMediaPrefs`: it created the `Call`
 * and passed it no options. Noise suppression, gain and microphone choice were saved
 * to disk and died in transit-in the installed app they never did anything, ever,
 * and there was no way to tell.
 *
 * The renderer went in first. The main process talks to Electron, which does not
 * exist outside it-but that is a reason for ITS DECISIONS not to live in
 * `index.ts`, not for them to go unmeasured. `src/main/ecra.ts` imports no Electron:
 * the gates come in as parameters and `index.ts` wires them to the real ones. That
 * is what makes screen sharing in the installed app testable without opening a window.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/renderer/**/*.test.ts", "src/main/**/*.test.ts"],
  },
})
