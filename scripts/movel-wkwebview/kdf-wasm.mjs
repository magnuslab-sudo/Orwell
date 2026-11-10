/**
 * The same vault Argon2id, in WebAssembly, to measure the fix.
 *
 * Not a dependency proposal: it's the measurement that says if it's worth
 * changing. `hash-wasm` was installed with `--no-save` just for this line
 * of the document, the product `package.json` was not touched.
 */
import { argon2id } from "hash-wasm"

const KDF = { t: 3, m: 65_536, p: 4, dkLen: 32 }
const voltas = Number(process.argv[2] ?? 5)
const tempos = []

for (let i = 0; i < voltas; i++) {
  const inicio = performance.now()
  await argon2id({
    password: "frase-passe-de-verdade",
    salt: new Uint8Array(16).fill(3),
    parallelism: KDF.p,
    iterations: KDF.t,
    memorySize: KDF.m,
    hashLength: KDF.dkLen,
    outputType: "binary",
  })
  tempos.push(performance.now() - inicio)
}

tempos.sort((a, b) => a - b)
console.log(JSON.stringify({
  motor: "hash-wasm (WASM) em node " + process.version,
  parametros: KDF,
  melhor: Math.round(tempos[0]),
  mediana: Math.round(tempos[Math.floor(tempos.length / 2)]),
  pior: Math.round(tempos[tempos.length - 1]),
  todos: tempos.map((t) => Math.round(t)),
}, null, 1))
