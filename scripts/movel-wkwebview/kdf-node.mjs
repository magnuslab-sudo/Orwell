/**
 * How much ONE vault key derivation costs, with the parameters the product uses.
 *
 * The parameters come from `KDF` in `packages/client-core/src/vault.ts` and
 * are read here by hand on purpose: if they drift, this measurement stops
 * measuring the vault and no one notices. The `kdf-a-serio.test.ts` is what
 * pins them.
 */
import { argon2id } from "@noble/hashes/argon2.js"

const KDF = { t: 3, m: 65_536, p: 4, dkLen: 32 }
const frase = new TextEncoder().encode("frase-passe-de-verdade")
const sal = new Uint8Array(16).fill(3)

// A cold run counts: it's what the user pays when opening the app.
const voltas = Number(process.argv[2] ?? 5)
const tempos = []
for (let i = 0; i < voltas; i++) {
  const inicio = performance.now()
  argon2id(frase, sal, KDF)
  tempos.push(performance.now() - inicio)
}
tempos.sort((a, b) => a - b)
console.log(JSON.stringify({
  motor: "node " + process.version,
  parametros: KDF,
  voltas,
  primeira: Math.round(tempos[0]),
  mediana: Math.round(tempos[Math.floor(tempos.length / 2)]),
  pior: Math.round(tempos[tempos.length - 1]),
  todos: tempos.map((t) => Math.round(t)),
}, null, 1))
