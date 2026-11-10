/**
 * The same key derivation as `kdf-node.mjs`, but running inside a WKWebView.
 *
 * It goes to `esbuild` and comes out as a single file, because a WKWebView
 * served by a custom scheme doesn't resolve `node_modules`. It measures
 * JavaScriptCore, which is the engine the iPhone runs, and that's why this
 * measurement is worth more than Node's for answering the phone question.
 *
 * The `kdf-bundle.js` alongside is GENERATED from here, and is in the repository
 * on purpose: it's what lets you serve `kdf.html` to a phone without a bundler
 * there. Rebuild with:
 *
 *   npx esbuild scripts/movel-wkwebview/kdf-entrada.mjs --bundle --format=iife \
 *     --outfile=scripts/movel-wkwebview/kdf-bundle.js
 */
import { argon2id } from "@noble/hashes/argon2.js"

const KDF = { t: 3, m: 65_536, p: 4, dkLen: 32 }

globalThis.medirKdf = (voltas) => {
  const frase = new TextEncoder().encode("frase-passe-de-verdade")
  const sal = new Uint8Array(16).fill(3)
  const tempos = []
  for (let i = 0; i < voltas; i++) {
    const inicio = performance.now()
    argon2id(frase, sal, KDF)
    tempos.push(performance.now() - inicio)
  }
  tempos.sort((a, b) => a - b)
  return {
    parametros: KDF,
    voltas,
    melhor: Math.round(tempos[0]),
    mediana: Math.round(tempos[Math.floor(tempos.length / 2)]),
    pior: Math.round(tempos[tempos.length - 1]),
    todos: tempos.map((t) => Math.round(t)),
  }
}
