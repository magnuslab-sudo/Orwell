/**
 * The vault's Argon2id, replaced in tests with cheap derivation.
 *
 * WHY. `KDF = { t: 3, m: 65_536, p: 4 }` costs **1.5 seconds per derivation**
 * on this machine, and that's what we want in production: a weak passphrase has
 * to be expensive to guess offline. But `vault.create()` runs at startup in
 * almost every core test, `offlineSession()` alone runs it 58 times in
 * `session.test.ts`, and none of them measure the cost of guessing. Measured
 * on August 16: `vault.create` 1434 ms, `createIdentity` 22 ms, `createSpaceChannel`
 * 30 ms. **98% of each test startup was the KDF**, and that's what pushed
 * `session.test.ts` to 116 seconds and `fundador.test.ts` to 40.
 *
 * WHAT WE LOSE, AND ONLY THAT. We lose the COST. We lose nothing else:
 *
 *  - it stays deterministic from (passphrase, salt), so creating with one
 *    passphrase and opening with the same one keeps working;
 *  - different passphrases still give different keys, so wrong passphrase tests
 *    still catch the bug;
 *  - different salts still give different keys, so two vaults with the same
 *    passphrase still don't share a key;
 *  - the length is prefixed, so ("ab","c") and ("a","bc") don't collide, without
 *    it a wrong passphrase test could pass for the wrong reason.
 *
 * And the cost, which is the only thing left out here, now has its own guard:
 * `testes/kdf-a-serio.test.ts` runs the TRUE Argon2id once and pins the parameters.
 * Before this change there was no test for them at all.
 *
 * See `packages/client-core/vitest.config.ts`, which is what loads this file.
 */
import { vi } from "vitest"

/** Domain separation: these bytes are never a true Argon2id. */
const DOMINIO = new TextEncoder().encode("enclave/testes/kdf-substituto/v1")

declare global {
  // eslint-disable-next-line no-var
  var __derivacoesDoKdf: number | undefined
}

/**
 * How many times the vault has derived a key from a passphrase since the last
 * reset. It proves the ABSENCE of derivation: that's how `unlockWithKey` proves
 * it opens the vault without running the KDF again, instead of just saying so in
 * the name.
 */
export function derivacoesDoKdf(): number {
  return globalThis.__derivacoesDoKdf ?? 0
}

export function reporDerivacoesDoKdf(): void {
  globalThis.__derivacoesDoKdf = 0
}

vi.mock("@noble/hashes/argon2.js", async () => {
  const real = await vi.importActual<typeof import("@noble/hashes/argon2.js")>("@noble/hashes/argon2.js")
  const { sha256 } = await import("@noble/hashes/sha2.js")

  const quatroBytes = (valor: number): Uint8Array => {
    const saida = new Uint8Array(4)
    new DataView(saida.buffer).setUint32(0, valor, false)
    return saida
  }

  const juntar = (partes: Uint8Array[]): Uint8Array => {
    const total = partes.reduce((soma, parte) => soma + parte.length, 0)
    const saida = new Uint8Array(total)
    let posicao = 0
    for (const parte of partes) {
      saida.set(parte, posicao)
      posicao += parte.length
    }
    return saida
  }

  const argon2id = (
    password: Uint8Array | string,
    salt: Uint8Array | string,
    opts: { dkLen?: number },
  ): Uint8Array => {
    globalThis.__derivacoesDoKdf = (globalThis.__derivacoesDoKdf ?? 0) + 1

    const codificador = new TextEncoder()
    const frase = typeof password === "string" ? codificador.encode(password) : password
    const sal = typeof salt === "string" ? codificador.encode(salt) : salt
    const dkLen = opts?.dkLen ?? 32

    const saida = new Uint8Array(dkLen)
    let escrito = 0
    let bloco = 0
    while (escrito < dkLen) {
      const resumo = sha256(
        juntar([DOMINIO, quatroBytes(frase.length), frase, quatroBytes(sal.length), sal, quatroBytes(bloco)]),
      )
      const quanto = Math.min(resumo.length, dkLen - escrito)
      saida.set(resumo.subarray(0, quanto), escrito)
      escrito += quanto
      bloco += 1
    }
    return saida
  }

  return { ...real, argon2id }
})
