/**
 * How much a 720p camera costs, measured, not estimated.
 *
 *   node scripts/sfu-prova-720p/medir.mjs
 *   TECTOS=600000,1500000 SEGUNDOS=25 node scripts/sfu-prova-720p/medir.mjs
 *
 * The SFU plan wrote `TECTO_DA_CAMARA = 600 kbps` with the note "600 kbps is
 * 720p at a low frame rate or 480p at normal frame rate". The note was never
 * measured, and the product offers "720p" on the settings screen. This measures what
 * happens when the two meet: a 1280×720 camera at 30
 * frames per second, with today's cap and with higher caps, through the
 * product path (VP8, one encoding, no simulcast, `maxBitrate`).
 *
 * The camera is a y4m file that Chrome pretends is a camera, always the same,
 * so runs are comparable. There are two, and why is in
 * `FONTES`, below: one with small movement and one expensive scene to
 * encode, which is the range a real camera falls within.
 *
 * The output is a table with, per cap: the resolution actually encoded, the
 * average QP (the sharpness), the frame rate, the bitrate achieved, and Chrome's
 * word on what limited it. And the server exit count that each one implies.
 */
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { chromium } from "playwright"

const AQUI = fileURLToPath(new URL(".", import.meta.url))
const REPO = fileURLToPath(new URL("../..", import.meta.url))
const PORTO_HTTP = Number(process.env.PROVA_PORTO_HTTP ?? 8463)
const PORTO_MEDIA = Number(process.env.PROVA_PORTO_MEDIA ?? 44330)
const SEGUNDOS = Number(process.env.SEGUNDOS ?? 22)
const TECTOS = (process.env.TECTOS ?? "600000,900000,1200000,1500000").split(",").map(Number)

// The y4m lives in `.verify-data/`, which git ignores: it is 200 MB of raw
// video, and raw is the point, compressed, Chrome cannot inject it as a camera.
const PASTA = `${REPO}.verify-data/720p`

/**
 * Two false cameras, not one, because the cost to encode depends on what is
 * in front of the lens and a measurement from one source only sets the cap
 * by the taste of whoever chose it.
 *
 *  - `padrao`: `testsrc2`, the ffmpeg test pattern. Constant movement,
 *    hard edges and a noise block. It is EXPENSIVE, more than a
 *    normal camera, and serves as the upper limit.
 *  - `retrato`: a real photograph (from the site footer), scaled to
 *    720p, with slow drift and temporal grain on top. Skin, texture and
 *    small movement, which is what a call is. It comes from a 420 px
 *    image scaled up, so it is softer than a native camera: lower limit.
 *
 * The truth of a real camera is between the two, and the cap is chosen for the
 * higher one, a cap tuned to the easy case drops the resolution exactly when
 * the person moves, which is when they are being watched.
 */
const FONTES = {
  padrao: {
    ficheiro: `${PASTA}/padrao-1280x720.y4m`,
    args: ["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-t", "5"],
  },
  retrato: {
    ficheiro: `${PASTA}/retrato-1280x720.y4m`,
    args: [
      "-loop", "1", "-i", `${REPO}apps/site/public/duarte.webp`, "-t", "5",
      "-vf",
      "scale=1600:-2,crop=1280:720:x='(iw-1280)/2+90*sin(t*0.9)':y='(ih-720)/2+40*sin(t*0.6)'," +
        "noise=alls=6:allf=t,fps=30",
    ],
  },
}
const FONTE = FONTES[process.env.FONTE ?? "padrao"]
if (!FONTE) throw new Error(`fonte desconhecida: ${process.env.FONTE} (padrao|retrato)`)

if (!existsSync(FONTE.ficheiro)) {
  mkdirSync(PASTA, { recursive: true })
  console.log("a gerar a câmara falsa (5 s de 1280×720 a 30, cru)…")
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...FONTE.args, "-pix_fmt", "yuv420p", "-y", FONTE.ficheiro], {
    stdio: "inherit",
  })
}
console.log(`câmara falsa: ${FONTE.ficheiro} (${(statSync(FONTE.ficheiro).size / 1e6).toFixed(0)} MB)\n`)

await build({
  entryPoints: [`${AQUI}pagina.js`],
  outfile: `${AQUI}pagina.bundle.js`,
  bundle: true,
  format: "esm",
  target: "chrome120",
  logLevel: "error",
})

const bancada = spawn(process.execPath, [`${AQUI}bancada.mjs`], {
  env: { ...process.env, PROVA_PORTO_HTTP: String(PORTO_HTTP), PROVA_PORTO_MEDIA: String(PORTO_MEDIA) },
  stdio: ["ignore", "pipe", "pipe"],
})
const registoDaBancada = []
bancada.stdout.on("data", (d) => registoDaBancada.push(String(d)))
bancada.stderr.on("data", (d) => registoDaBancada.push(String(d)))

async function esperarPorHttp(url, limite = 20_000) {
  const fim = Date.now() + limite
  while (Date.now() < fim) {
    try {
      const resposta = await fetch(url)
      if (resposta.ok) return
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`a bancada não abriu: ${url}\n${registoDaBancada.join("")}`)
}
await esperarPorHttp(`http://127.0.0.1:${PORTO_HTTP}/pagina.html`)

const FLAGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  // The false camera becomes the file. Without this, Chrome injects a trivial
  // synthetic pattern to encode, and the measurement would say 720p fits in nothing.
  `--use-file-for-fake-video-capture=${FONTE.ficheiro}`,
  "--autoplay-policy=no-user-gesture-required",
]

/** Use median, not mean: a single bad second at startup does not shift the median. */
const mediana = (valores) => {
  const ordenados = [...valores].filter((v) => v !== null && v !== undefined).sort((a, b) => a - b)
  if (ordenados.length === 0) return null
  const meio = Math.floor(ordenados.length / 2)
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2
}

const linhas = []
for (const tecto of TECTOS) {
  const browser = await chromium.launch({ headless: true, args: FLAGS })
  const contexto = await browser.newContext({ permissions: ["camera"] })
  const pagina = await contexto.newPage()
  const erros = []
  pagina.on("pageerror", (e) => erros.push(String(e.message).slice(0, 200)))
  const url = new URL(`http://127.0.0.1:${PORTO_HTTP}/pagina.html`)
  url.searchParams.set("tecto", String(tecto))
  await pagina.goto(url.href, { waitUntil: "domcontentloaded" })
  await pagina.waitForFunction(() => window.__medida?.pronto || window.__medida?.erro, { timeout: 30_000 })
  await pagina.waitForTimeout(SEGUNDOS * 1000)

  const medida = await pagina.evaluate(() => window.__medida)
  // Server stats are a bonus: fetching them must not fail a run whose main number
  // was already measured in the browser.
  const contas = await pagina.evaluate(() => window.__contas?.() ?? null).catch((erro) => ({ erro: String(erro).slice(0, 120) }))
  await browser.close()

  if (medida.erro) {
    console.log(`ERRO com tecto ${tecto}: ${medida.erro}`)
    continue
  }
  // The first six seconds are encoder startup and congestion control ramp-up: we
  // care about steady state, not the ramp.
  const regime = medida.amostras.slice(6)
  const resolucoes = [...new Set(regime.map((a) => a.resolucao))]
  const limites = [...new Set(regime.map((a) => a.limite))]
  linhas.push({
    tecto,
    capturado: medida.capturado,
    resolucao: resolucoes.join(" → "),
    fps: mediana(regime.map((a) => a.fps)),
    qp: mediana(regime.map((a) => a.qp)),
    bitrate: mediana(regime.map((a) => a.bitrate)),
    limite: limites.join(","),
    recebido: medida.recebido?.resolucao,
    amostras: regime.length,
    erros: erros.slice(0, 2),
    contas,
  })
  const ultima = linhas.at(-1)
  console.log(
    `tecto ${(tecto / 1000).toString().padStart(4)} kbps  →  captado ${ultima.capturado}  ` +
      `${ultima.resolucao.padEnd(14)} ${String(ultima.fps).padStart(4)} fps  ` +
      `QP ${String(ultima.qp).padStart(4)}  ` +
      `${String(Math.round(ultima.bitrate / 1000)).padStart(4)} kbps reais  ` +
      `limite: ${ultima.limite}`,
  )
}

bancada.kill("SIGTERM")

console.log("\n== o que isto quer dizer, por tecto")
console.log("(saída do servidor = bitrate × 10 espectadores × número de câmaras)")
for (const linha of linhas) {
  const porCamara = (linha.bitrate * 10) / 1e6
  const cabem = Math.floor((50 - 25 - 1.5) / porCamara) // 25 from the screen, 1.5 from voice with DTX
  console.log(
    `  ${(linha.tecto / 1000).toString().padStart(4)} kbps: ` +
      `${linha.resolucao} a QP ${linha.qp} · ${porCamara.toFixed(1)} Mbps por câmara a 10 espectadores · ` +
      `cabem ${cabem} câmaras ao lado de um ecrã partilhado`,
  )
}
console.log("")
