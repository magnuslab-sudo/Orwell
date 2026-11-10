import { defineConfig } from "vitest/config"

/**
 * The server runs on vitest defaults, with one exception: the vault KDF.
 *
 * `fundador.test.ts` and `feed-delivery.test.ts` create real accounts, `new
 * Vault(...)` plus `vault.create("frase-passe-de-teste")`, so there is someone
 * on the other end of the wire. The Argon2id at 64 MiB costs 1.5 s each time and
 * none of these tests measure the cost of guessing a passphrase: they measure
 * delivery, founding and federation. `fundador.test.ts` alone took 40
 * seconds, almost all of it here.
 *
 * The replacement is the same file that the core uses (a single one, on purpose,
 * so the two copies cannot diverge), and what it keeps and what it drops is
 * written inside it. The real Argon2id stays locked in
 * `packages/client-core/testes/kdf-a-serio.test.ts`.
 */
export default defineConfig({
  test: {
    setupFiles: ["../../packages/client-core/testes/kdf-de-teste.ts"],
    // The vault enters here through the `dist/` of `@enclave/client-core`. Without
    // the inline, the package is externalized and loaded raw by Node: the
    // `vi.mock` never reaches it and the real Argon2id runs anyway, silently.
    server: { deps: { inline: ["@enclave/client-core"] } },
  },
})
