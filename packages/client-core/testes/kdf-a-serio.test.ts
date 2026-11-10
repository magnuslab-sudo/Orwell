/**
 * The only place where true Argon2id runs in core suite tests.
 *
 * Everything else uses the cheap substitute from `kdf-de-teste.ts`, which keeps
 * the properties and drops the cost. Cost is the reason for the KDF, so it has
 * to stay pinned somewhere, and this is it.
 *
 * Before this file, the KDF parameters had NO tests: changing `m: 65_536` to
 * `m: 256` would turn the whole suite green and every passphrase in the world
 * would become cheap to guess offline. This is the kind of change someone makes
 * in good faith to "speed up tests", and this file exists precisely to stop it.
 *
 * It costs one real derivation (~1.5 s here) and pays for itself.
 */
import { describe, expect, it, vi } from "vitest"
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { fromBase64 } from "@enclave/protocol"
import type { VaultBackend } from "../src/vault.js"
import { semCabecalho } from "../src/cabecalhoDoCofre.js"

// This file talks to real Argon2id, unlike everything else: `setupFiles` mocks
// it for the whole suite, and here we undo that.
vi.unmock("@noble/hashes/argon2.js")

/** The vault must use these parameters. See `KDF` in `vault.ts`. */
const ESPERADO = { t: 3, m: 65_536, p: 4, dkLen: 32 } as const

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

describe("o KDF do cofre, a sério", () => {
  it("é Argon2id com 64 MiB, três passagens e quatro pistas — e é isso que abre o ficheiro", async () => {
    const { argon2id } = await vi.importActual<typeof import("@noble/hashes/argon2.js")>(
      "@noble/hashes/argon2.js",
    )
    const { Vault } = await import("../src/vault.js")

    const backend = new MemoryBackend()
    const vault = new Vault(backend)
    await vault.create("frase-passe-de-verdade")
    await vault.update((contents) => {
      contents.profile.displayName = "Testemunha"
    })

    const ficheiro = JSON.parse(semCabecalho(backend.bytes!) as string) as {
      salt: string
      nonce: string
      ciphertext: string
    }

    // Derived here with the parameters above and the salt the vault wrote. If
    // `vault.ts` is using different parameters, or a different algorithm, this
    // key won't open the file and the test fails.
    const chave = argon2id(
      new TextEncoder().encode("frase-passe-de-verdade"),
      fromBase64(ficheiro.salt),
      ESPERADO,
    )
    const aberto = xchacha20poly1305(chave, fromBase64(ficheiro.nonce)).decrypt(
      fromBase64(ficheiro.ciphertext),
    )
    expect(new TextDecoder().decode(aberto)).toContain("Testemunha")

    // The salt has 16 bytes so two vaults with the same passphrase don't share a key.
    expect(fromBase64(ficheiro.salt)).toHaveLength(16)
  }, 120_000)

  it("é caro de propósito: uma derivação não é instantânea", async () => {
    const { argon2id } = await vi.importActual<typeof import("@noble/hashes/argon2.js")>(
      "@noble/hashes/argon2.js",
    )

    const inicio = performance.now()
    argon2id(new TextEncoder().encode("x"), new Uint8Array(16), ESPERADO)
    const gasto = performance.now() - inicio

    // The threshold is deliberately low, a hundred milliseconds, because what we're
    // catching is not a slow machine: it's someone lowering `m` from 64 MiB to a few
    // kilobytes, which would derive in under a millisecond. A higher number would be
    // a test of the hardware, and would fail on its own on a fast machine tomorrow.
    expect(gasto).toBeGreaterThan(100)
  }, 120_000)
})
