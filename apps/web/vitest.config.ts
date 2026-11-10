import { defineConfig } from "vitest/config"

/**
 * The browser bridge now has tests.
 *
 * It had none, and its sister module did not either. It was in one of them that we
 * discovered, on August 13, 2026, that `applyMediaPrefs` was never implemented: noise
 * suppression, gain, and microphone choice were saved to disk and died on the way, in
 * the installed app, those toggles never did anything, from the start.
 *
 * A defect like this lives for months because nobody looks at where it is. Eleven files
 * without a single test, between the core and what the user sees.
 *
 * `jsdom` because the bridge touches `window` and media elements.
 */
export default defineConfig({
  test: {
    environment: "jsdom",
  },
})
