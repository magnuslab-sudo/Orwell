/**
 * The boundary of `postMessage`, in a real browser-not in the test double.
 *
 * Measures four things that `kdf.test.ts` (jsdom, fake Worker) cannot:
 *   1. the key that COMES BACK from the Worker is byte-for-byte the same as the
 *      main thread's, with high-byte salts, zeros, and phrases with accents and
 *      emoji;
 *   2. a salt that is a VIEW of a larger buffer survives the clone;
 *   3. consecutive derivations: the worker is buried in each one and must be reborn;
 *   4. TWO derivations at once-does the `enterrar()` of the first kill the worker
 *      of the second?
 *
 * **What this proved, on 30 September 2026.** The key that comes back from the
 * Worker is byte-for-byte the same as the main thread's, in all six cases with the
 * salt offset.
 *
 * And it caught what no one was looking for: TWO derivations at once and the
 * second took **61 490 ms**-the `enterrar()` in the `finally` killed the shared
 * worker while the other request was still inside it, and `terminate()` fires no
 * error, so only the 60 s cap freed it. Fixed that same day (`apps/web/src/kdf.ts`):
 * 61 490 ms → 3 023 ms.
 */
import http from "node:http"
import { existsSync, readFileSync, statSync } from "node:fs"
import { extname, join, normalize } from "node:path"
import { chromium } from "playwright"
import { comLingua } from "./ambiente.mjs"

const DIST = process.argv[2]
const PORTA = Number(process.argv[3] ?? 8492)
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".map": "application/json" }

const frente = http.createServer((pedido, resposta) => {
  const caminho = (pedido.url ?? "/").split("?")[0]
  const relativo = normalize(decodeURIComponent(caminho.replace(/^\/app/, ""))).replace(/^(\.\.[/\\])+/, "")
  let ficheiro = join(DIST, relativo)
  if (!ficheiro.startsWith(DIST) || !existsSync(ficheiro) || statSync(ficheiro).isDirectory()) ficheiro = join(DIST, "prova-kdf.html")
  resposta.writeHead(200, { "content-type": TIPOS[extname(ficheiro)] ?? "application/octet-stream", "cache-control": "no-cache" })
  resposta.end(readFileSync(ficheiro))
})
await new Promise((r) => frente.listen(PORTA, "127.0.0.1", r))

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const erros = []
page.on("pageerror", (e) => erros.push(e.message))
page.on("console", (m) => m.type() === "error" && erros.push(`console: ${m.text()}`))
// This page has no interface, just Argon2id, but the rule in
// `guioes.lingua.test.ts` is about what you NAVIGATE, not what's on it, and
// an exception opened for convenience is the exception the next script copies.
await page.goto(comLingua(`http://127.0.0.1:${PORTA}/app/prova-kdf.html`), { waitUntil: "domcontentloaded" })
await page.waitForFunction(() => document.getElementById("estado")?.textContent === "pronto", { timeout: 30_000 })

const casos = [
  ["sal todo a zero", "frase-simples", new Array(16).fill(0)],
  ["sal todo a 0xFF", "frase-simples", new Array(16).fill(255)],
  ["sal misto alto/zero", "frase-simples", [0, 255, 0, 128, 255, 1, 0, 254, 127, 0, 255, 63, 0, 200, 0, 255]],
  ["frase com acentos", "trás-os-montes é onde a névoa cai à noite", [0, 255, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238]],
  ["frase com emoji e combinantes", "cão 🔐 ãã áè ção", new Array(16).fill(42)],
  ["frase vazia", "", new Array(16).fill(7)],
]

let falhas = 0
console.log("--- 1/2. a chave que volta do Worker, contra a da thread principal ---")
for (const [nome, frase, sal] of casos) {
  const r = await page.evaluate(([f, s]) => globalThis.prova.igualdade(f, s), [frase, sal])
  console.log(`${r.batem ? "  ok  " : " FALHA"} ${nome}  (${r.ms} ms)  worker=${r.noWorker.slice(0, 16)}… thread=${r.naThread.slice(0, 16)}…`)
  if (!r.batem) falhas++
}
const desloc = await page.evaluate(() => globalThis.prova.salDeslocado("frase-simples"))
console.log(`${desloc.batem ? "  ok  " : " FALHA"} sal como vista de um buffer maior (byteOffset=${desloc.byteOffset})`)
if (!desloc.batem) falhas++

console.log("\n--- 3. derivações SEGUIDAS: o worker renasce em cada uma? ---")
const seg = await page.evaluate(() => globalThis.prova.seguidas(6))
console.log(`${seg.todasCertas ? "  ok  " : " FALHA"} 6 seguidas, todas certas  (ms: ${seg.tempos.join(", ")})`)
if (!seg.todasCertas) falhas++

console.log("\n--- 4. DUAS ao mesmo tempo: o enterrar() da primeira mata a segunda? ---")
const par = await page.evaluate(() => globalThis.prova.aoMesmoTempo())
console.log(JSON.stringify(par, null, 2))
const suspeita = Math.max(par.a.ms, par.b.ms) > 30_000
console.log(`${suspeita ? " ATENÇÃO" : "  ok  "} a mais lenta das duas demorou ${Math.max(par.a.ms, par.b.ms)} ms`)
if (!par.a.certa || !par.b.certa) {
  console.log(" FALHA  uma das duas chaves saiu ERRADA")
  falhas++
}

if (erros.length) console.log(`\nerros de página/consola: ${erros.join(" | ")}`)
console.log(`\n${falhas === 0 ? "sem divergências de chave" : `${falhas} DIVERGÊNCIAS`}`)
await browser.close()
frente.close()
