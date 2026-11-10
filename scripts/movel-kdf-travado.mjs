/**
 * How Argon2id in the vault scales when the processor is slower.
 *
 * I don't have a phone connected to this machine, and a fake number for the phone
 * was worth nothing. What you can measure without it is the SLOPE: Chrome DevTools
 * Protocol's `Emulation.setCPUThrottlingRate` slows the engine by a known factor,
 * and we measure the cost at each step. If the cost is linear in the factor, which
 * is what you expect from an algorithm that only does math and memory, then you
 * only need to know how many times slower the phone is to work out the time, without
 * guessing.
 *
 * This is a SIMULATION and is labeled as such in the document. Real measurement
 * happens by opening `kdf.html` on the phone, and needs no Xcode.
 *
 *   node scripts/movel-kdf-travado.mjs
 */
import { chromium } from "playwright"
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { comLingua } from "./ambiente.mjs"

const PORTA = 8944
const html = `<!doctype html><meta charset="utf-8"><body><script>
${readFileSync("scripts/movel-wkwebview/kdf-bundle.js", "utf8")}
</script></body>`

const servidor = createServer((_, r) => {
  r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  r.end(html)
}).listen(PORTA, "127.0.0.1")

const navegador = await chromium.launch()
const pagina = await navegador.newPage()
const cdp = await pagina.context().newCDPSession(pagina)
// This page has no interface, just Argon2id, but the rule in
// `guioes.lingua.test.ts` is about what you NAVIGATE, not what's on it, and
// an exception opened for convenience is the exception the next script copies.
await pagina.goto(comLingua(`http://127.0.0.1:${PORTA}/`))

const linhas = []
for (const travao of [1, 2, 4, 6, 8]) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: travao })
  const r = await pagina.evaluate((voltas) => globalThis.medirKdf(voltas), travao >= 6 ? 2 : 3)
  linhas.push({
    travao: travao + "x",
    mediana_ms: r.mediana,
    // How much the throttle actually cost, against the baseline step.
    custo_real: linhas.length ? +(r.mediana / linhas[0].mediana_ms).toFixed(2) : 1,
  })
  console.log(travao + "x →", r.mediana, "ms")
}

console.table(linhas)
await navegador.close()
servidor.close()
