import { defineConfig } from "vitest/config"

/**
 * The core runs on vitest defaults, with one exception: the vault's KDF.
 *
 * `testes/kdf-de-teste.ts` swaps Argon2id for cheap derivation that keeps all
 * the properties tests measure and drops the only one none of them measure, the
 * cost. The why, and what we lose, are written inside.
 */
export default defineConfig({
  test: {
    setupFiles: ["./testes/kdf-de-teste.ts"],
  },
})
