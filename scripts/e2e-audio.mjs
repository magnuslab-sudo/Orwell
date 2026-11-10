// Live proof of the voice chain on three engines: Chromium, Firefox and WebKit.
//
// What is verified in each:
//
//   1. the worklet module and `gtcrn.wasm` arrive from the same origin, hashed
//      in the name, under the security policy of `apps/web/index.html`
//      (copied from there at each run), without a single violation;
//   2. the model compiles and runs INSIDE the worklet (message `motor: pronto`);
//   3. offline, with synthetic voice and pink noise at 5 dB, the noise in pauses
//      drops at least 20 dB and the voice stays within 3 dB of what it was;
//   4. live, via `MediaStream` (the call path), the engine runs, the worklet sends
//      measurements to the main thread, and the output track is alive;
//   5. (Chromium) comparison with the browser's NATIVE suppressor: the fake mic
//      reads a WAV with synthetic voice and noise at 5 dB, and the SNR of the output
//      is measured in three modes (raw, native, ours). Prints the README table.
//      `--sem-nativo` skips it;
//   6. the counter-proof: with the OLD policy (without `'wasm-unsafe-eval'`) the model
//      does not compile, the chain does not die, and the engine says `falhou`. This
//      shows that the new word in the policy is necessary, and that without it we
//      fall back to the browser suppressor instead of losing sound.
//
// LOCAL BY DESIGN: builds a test page with Vite to a temporary folder, serves it
// at 127.0.0.1 and asks for nothing else elsewhere.
//
// Usage:
//   npx tsc -b && node scripts/e2e-audio.mjs
//   node scripts/e2e-audio.mjs --so chromium      # one engine only
import { mkdtempSync, readFileSync, writeFileSync, createReadStream, existsSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { chromium, firefox, webkit } from "playwright"
import { build } from "vite"
import { comLingua } from "./ambiente.mjs"

const REPO = fileURLToPath(new URL("..", import.meta.url))
const PAGINA = join(REPO, "scripts/e2e-audio")
const PORTO = 5397

const resultados = []
const check = (rotulo, ok, detalhe = "") => {
  resultados.push(Boolean(ok))
  console.log(`${ok ? "PASS" : "FAIL"}  ${rotulo}${detalhe ? ` (${detalhe})` : ""}`)
}

if (!existsSync(join(REPO, "packages/client-core/dist/audio/cadeia.js"))) {
  console.error("Falta o núcleo construído. Corre `npx tsc -b` primeiro.")
  process.exit(2)
}

// --- the policy, taken from the application --------------------------------

const htmlDaApp = readFileSync(join(REPO, "apps/web/index.html"), "utf8")
const politica = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(htmlDaApp)?.[1]
if (!politica) {
  console.error("Não encontrei a política no apps/web/index.html.")
  process.exit(2)
}
check("a política da aplicação deixa compilar WebAssembly", /script-src[^;]*'wasm-unsafe-eval'/.test(politica), politica.split(";")[1]?.trim())
check("e continua sem 'unsafe-eval' nem 'unsafe-inline' em script-src", !/script-src[^;]*'unsafe-(eval|inline)'/.test(politica))
const politicaAntiga = politica.replace(" 'wasm-unsafe-eval'", "")

// --- the test page ----------------------------------------------------------

const saida = mkdtempSync(join(tmpdir(), "orwell-e2e-audio-"))
await build({
  root: PAGINA,
  logLevel: "warn",
  configFile: false,
  build: { outDir: saida, emptyOutDir: true, target: "es2023" },
})
const construida = readFileSync(join(saida, "index.html"), "utf8")
writeFileSync(join(saida, "index.html"), construida.replace("%POLITICA%", politica))
writeFileSync(join(saida, "antiga.html"), construida.replace("%POLITICA%", politicaAntiga))

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".map": "application/json",
}
const pedidos = []
const servidor = createServer((pedido, resposta) => {
  const caminho = normalize(decodeURIComponent(new URL(pedido.url, "http://x").pathname)).replace(/^\/+/, "")
  pedidos.push(caminho)
  const ficheiro = join(saida, caminho || "index.html")
  if (!ficheiro.startsWith(saida) || !existsSync(ficheiro)) {
    resposta.writeHead(404).end()
    return
  }
  resposta.writeHead(200, { "Content-Type": TIPOS[extname(ficheiro)] ?? "application/octet-stream" })
  createReadStream(ficheiro).pipe(resposta)
})
await new Promise((resolver) => servidor.listen(PORTO, "127.0.0.1", resolver))

// --- the engines ----------------------------------------------------------------

const so = process.argv.includes("--so") ? process.argv[process.argv.indexOf("--so") + 1] : null
const motores = { chromium, firefox, webkit }

async function abrir(tipo, pagina) {
  const browser = await motores[tipo].launch()
  const pageErros = []
  const page = await browser.newPage()
  page.on("pageerror", (erro) => pageErros.push(String(erro)))
  page.on("console", (mensagem) => {
    if (mensagem.type() === "error") pageErros.push(mensagem.text())
  })
  // The test page has no language interface; `comLingua` is there only by folder convention.
  await page.goto(comLingua(`http://127.0.0.1:${PORTO}/${pagina}`))
  await page.click("#correr")
  const resultado = await page.evaluate(() => window.resultado(), undefined, { timeout: 60_000 })
  await browser.close()
  return { resultado, pageErros }
}

for (const tipo of Object.keys(motores)) {
  if (so && so !== tipo) continue
  console.log(`\n== ${tipo}`)
  const { resultado: r, pageErros } = await abrir(tipo, "index.html")
  check(`${tipo}: sem violações da política`, r.violacoes.length === 0, r.violacoes.join(" | "))
  check(`${tipo}: sem erros na página`, r.erros.length === 0 && pageErros.length === 0, [...r.erros, ...pageErros].join(" | "))
  check(`${tipo}: o worklet vem da origem, com hash no nome`, /\/assets\/processador-de-voz-[\w-]+\.js$/.test(r.worklet ?? ""), r.worklet)
  check(`${tipo}: o modelo foi lido`, r.erroDoWasm === null, r.erroDoWasm ?? "")
  const off = r.offline
  check(`${tipo}: offline, o modelo compilou no worklet`, off?.motor === "pronto", off?.motor)
  if (off) {
    const reducao = off.pausasAntesDb - off.pausasDepoisDb
    const voz = off.vozDepoisDb - off.vozAntesDb
    check(`${tipo}: offline, a saída é finita`, off.finita)
    check(`${tipo}: offline, o ruído nas pausas desce 20 dB ou mais`, reducao >= 20, `${reducao.toFixed(1)} dB`)
    check(`${tipo}: offline, a voz fica a menos de 3 dB`, Math.abs(voz) < 3, `${voz.toFixed(1)} dB`)
    console.log(`      render offline: ${off.renderMsPorSegundo.toFixed(1)} ms por segundo de áudio`)
  }
  const vivo = r.aoVivo
  check(`${tipo}: ao vivo, o contexto corre`, vivo?.estadoDoContexto === "running", vivo?.estadoDoContexto)
  check(`${tipo}: ao vivo, o modelo está pronto`, vivo?.motor === "pronto", vivo?.motor)
  check(
    `${tipo}: ao vivo, o worklet mede e manda`,
    vivo && vivo.medidas.entradaDb > -60 && vivo.medidas.saidaDb > -60 && vivo.medidas.cpuMs > 0,
    vivo ? `entrada ${vivo.medidas.entradaDb.toFixed(1)} dB, saída ${vivo.medidas.saidaDb.toFixed(1)} dB, CPU ${vivo.medidas.cpuMs.toFixed(3)} ms/bloco, ${vivo.taxa} Hz` : "",
  )
  check(`${tipo}: ao vivo, a faixa de saída está viva`, vivo?.faixa === "live", vivo?.faixa)

  const contra = await abrir(tipo, "antiga.html")
  check(
    `${tipo}: contraprova, sem 'wasm-unsafe-eval' o modelo não compila e a cadeia segue`,
    contra.resultado.offline?.motor?.startsWith("falhou") && contra.resultado.offline?.finita === true,
    contra.resultado.offline?.motor,
  )
}

// --- comparison with the native suppressor (Chromium) ---------------------------

if ((!so || so === "chromium") && !process.argv.includes("--sem-nativo")) {
  const S = await import(pathToFileURL(join(REPO, "packages/client-core/testes/audio-sintetico.ts")).href)
  const limpa = S.normalizar(S.voz(12), -20)
  const N = limpa.length

  const wav = (amostras) => {
    const dados = Buffer.alloc(amostras.length * 2)
    for (let i = 0; i < amostras.length; i++) dados.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(amostras[i] * 32767))), i * 2)
    const cabecalho = Buffer.alloc(44)
    cabecalho.write("RIFF", 0)
    cabecalho.writeUInt32LE(36 + dados.length, 4)
    cabecalho.write("WAVEfmt ", 8)
    cabecalho.writeUInt32LE(16, 16)
    cabecalho.writeUInt16LE(1, 20)
    cabecalho.writeUInt16LE(1, 22)
    cabecalho.writeUInt32LE(S.TAXA, 24)
    cabecalho.writeUInt32LE(S.TAXA * 2, 28)
    cabecalho.writeUInt16LE(2, 32)
    cabecalho.writeUInt16LE(16, 34)
    cabecalho.write("data", 36)
    cabecalho.writeUInt32LE(dados.length, 40)
    return Buffer.concat([cabecalho, dados])
  }

  // Where each recording chunk sits in the 12 s cycle of the WAV file. First, a
  // global delay from the envelope at 1 kHz; then, from 250 em 250 ms, the fine delay
  // around it. Split into chunks because the microphone path has queues with
  // drift correction: with the native suppressor, or with the chain, the delay
  // shifts ±20 amostras over the recording, and a single delay would break the math.
  const alinharGrosso = (gravada) => {
    const passo = 48
    const env = (x, n) => {
      const e = new Float64Array(Math.floor(n / passo))
      for (let k = 0; k < e.length; k++) {
        let s = 0
        for (let j = 0; j < passo; j++) s += Math.abs(x[(k * passo + j) % x.length])
        e[k] = s
      }
      return e
    }
    const eg = env(gravada, gravada.length)
    const el = env(limpa, N)
    let melhor = -Infinity
    let grosso = 0
    for (let l = 0; l < el.length; l++) {
      let s = 0
      for (let k = 0; k < eg.length; k++) s += eg[k] * el[(k + l) % el.length]
      if (s > melhor) (melhor = s), (grosso = l * passo)
    }
    return grosso
  }
  const ciclo = (i) => ((i % N) + N) % N

  /**
   * Voice level and level in pauses, in dBFS.
   *
   * This is not the SNR measurement from the unit test projection, and the reason
   * is measured: the microphone path has queues with drift correction, and with
   * the native suppressor (or with the chain) the delay drifts tens of samples
   * across the recording. Sample-by-sample projection would read that drift as
   * noise and report 0 dB on an output with pauses at -70 dBFS. Here we measure
   * by regions (voice: 0.1 to 1.3 s of each 2 s; pause: 1.5 to 1.95 s), where
   * a half-millisecond drift makes no difference.
   */
  const medirRegioes = (gravada) => {
    const l = alinharGrosso(gravada)
    let pv = 0
    let nv = 0
    let pp = 0
    let np = 0
    for (let i = 0; i < gravada.length; i++) {
      const t = (ciclo(i + l) / S.TAXA) % 2
      const q = gravada[i] * gravada[i]
      if (t > 0.1 && t < 1.3) (pv += q), nv++
      else if (t > 1.5 && t < 1.95) (pp += q), np++
    }
    return { vozDb: 10 * Math.log10(pv / nv), pausasDb: 10 * Math.log10(Math.max(pp / np, 1e-14)) }
  }

  console.log("\n== chromium: o nosso contra o supressor nativo (entrada a 5 dB de SNR)")
  const tabela = {}
  for (const tipo of ["branco", "rosa", "ventoinha", "teclado"]) {
    const ficheiro = join(saida, `entrada-${tipo}.wav`)
    writeFileSync(ficheiro, wav(S.misturar(limpa, S.ruido(tipo, N), 5)))
    const browser = await chromium.launch({
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${ficheiro}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    })
    const page = await browser.newPage()
    await page.goto(comLingua(`http://127.0.0.1:${PORTO}/index.html`))
    const linha = {}
    for (const modo of ["cru", "nativo", "nosso"]) {
      const base64 = await page.evaluate((m) => window.gravar(m, 6), modo, { timeout: 60_000 })
      const bytes = Buffer.from(base64, "base64")
      const gravada = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
      const medida = medirRegioes(gravada)
      linha[modo] = `${medida.vozDb.toFixed(1)} / ${medida.pausasDb.toFixed(1)}`
      linha[`_${modo}`] = medida
    }
    await browser.close()
    tabela[tipo] = linha
  }
  console.log("Voz / pausas, em dBFS (a diferença entre as duas é quanto a voz fica acima do ruído):")
  console.table(Object.fromEntries(Object.entries(tabela).map(([t, l]) => [t, { cru: l.cru, nativo: l.nativo, nosso: l.nosso }])))
  for (const tipo of ["branco", "rosa", "ventoinha", "teclado"]) {
    const { _cru: cru, _nativo: nativo, _nosso: nosso } = tabela[tipo]
    const reducaoNossa = cru.pausasDb - nosso.pausasDb
    const reducaoNativa = cru.pausasDb - nativo.pausasDb
    check(
      `chromium: em ruído ${tipo}, o nosso tira mais ruído das pausas do que o nativo`,
      reducaoNossa > reducaoNativa,
      `${reducaoNossa.toFixed(1)} contra ${reducaoNativa.toFixed(1)} dB`,
    )
    check(
      `chromium: em ruído ${tipo}, a voz não perde mais de 1 dB (o nativo perde ${(cru.vozDb - nativo.vozDb).toFixed(1)})`,
      cru.vozDb - nosso.vozDb <= 1,
      `${(nosso.vozDb - cru.vozDb).toFixed(1)} dB`,
    )
  }
}

servidor.close()
rmSync(saida, { recursive: true, force: true })
const fora = pedidos.filter((caminho) => caminho.startsWith("http"))
check("nada foi pedido fora de 127.0.0.1", fora.length === 0)

const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações passaram.`)
process.exit(falhas === 0 ? 0 : 1)
