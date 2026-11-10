/**
 * Against THIS server, which video codec can each engine actually use?
 *
 *   node scripts/sfu-codec-por-motor.mjs
 *
 * It's the question still waiting for a measurement, and for one day it was
 * answered by mistake with another. The `sfu-script-transform-por-motor.mjs`
 * measures encryption BY codec, on a pair of local connections where the codec
 * is forced by hand. It says full-frame encryption works on VP8 in all three
 * engines and collapses in H.264 on all three. What it can't say is which of
 * the two the product uses, there's no server there, and who decides the codec
 * in the product is the SFU router.
 *
 * **The gap between the two things cost the wrong conclusion.** The test rig let
 * each engine choose, WebKit chooses H.264, and out came "encrypted video
 * doesn't cross WebKit", a statement about one engine, pulled from a variable
 * the test rig wasn't fixing and that in the product isn't free.
 *
 * **What this measures, and is the missing link:** the router's REAL capabilities
 * (`MotorDeMedia` for real, mediasoup worker for real, the `CODECS` from
 * `apps/server/src/media.ts`) given to the `mediasoup-client` `Device` for
 * real, INSIDE each engine. What comes out is the intersection, the codecs
 * that browser can use against this server, and it's exactly that intersection
 * that picks a producer's codec in the product.
 *
 * Doesn't open any call and doesn't need the product running: what's being
 * measured is negotiation, and negotiation happens entirely in `device.load()`.
 */
import { build } from "esbuild"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, firefox, webkit } from "playwright"
import { MotorDeMedia } from "../apps/server/dist/media.js"

/** The repository root: that's where `mediasoup-client` resolves from. */
const RAIZ = fileURLToPath(new URL("..", import.meta.url))

let falhou = 0
function verificar(rotulo, condicao, detalhe = "") {
  if (condicao) {
    console.log(`PASS  ${rotulo}`)
  } else {
    falhou += 1
    console.log(`FAIL  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
  }
}

/*
 * The engine for real, not a copy of the codec list.
 *
 * Hardcoding `["video/VP8"]` here would make this script a test of what's
 * written in the script. What matters is what the mediasoup worker ANNOUNCES
 * after chewing through the `CODECS`, that's what reaches the client.
 */
const motor = await MotorDeMedia.arrancar({ porto: 0, anunciarIp: "", escutarEm: "127.0.0.1" })
const { rtpCapabilities } = await motor.entrar("codec-por-motor", "eu")
const doRouter = (rtpCapabilities.codecs ?? [])
  .filter((codec) => codec.kind === "video" && !codec.mimeType.toLowerCase().endsWith("/rtx"))
  .map((codec) => codec.mimeType)
console.log(`O router anuncia, para vídeo: ${doRouter.join(", ") || "(nada)"}`)

const pasta = mkdtempSync(join(tmpdir(), "sfu-codec-"))
const saida = join(pasta, "pagina.bundle.js")
/*
 * The source comes in on `stdin` with `resolveDir` at the root, not as a file
 * in the temp folder.
 *
 * A file in `/tmp` resolves imports from `/tmp`, where there's no `node_modules`:
 * `mediasoup-client` is not found and the script dies saying "Could not resolve".
 * `resolveDir` puts resolution where the dependencies are, at this repository's
 * root, and it's also what ensures you're measuring the SAME copy of the library
 * that the product packages.
 */
const FONTE = `import { Device } from "mediasoup-client"
window.__perguntar = async (routerRtpCapabilities) => {
  const device = new Device()
  await device.load({ routerRtpCapabilities })
  return {
    handler: device.handlerName,
    podeVideo: device.canProduce("video"),
    podeAudio: device.canProduce("audio"),
    // A INTERSECÇÃO: o que este browser pode usar contra este router.
    video: (device.rtpCapabilities.codecs ?? [])
      .filter((c) => c.kind === "video" && !c.mimeType.toLowerCase().endsWith("/rtx"))
      .map((c) => c.mimeType),
  }
}
`
await build({
  stdin: { contents: FONTE, resolveDir: RAIZ, sourcefile: "pagina.js", loader: "js" },
  outfile: saida,
  bundle: true,
  format: "iife",
  target: "es2020",
  logLevel: "error",
})

const MOTORES = [
  ["chromium", chromium, { args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] }],
  ["firefox", firefox, {}],
  ["webkit", webkit, {}],
]
const QUAIS = (process.env["MOTORES"] ?? "chromium,firefox,webkit").split(",")

for (const [nome, motorDoBrowser, opcoes] of MOTORES) {
  if (!QUAIS.includes(nome)) continue
  let browser
  try {
    browser = await motorDoBrowser.launch({ headless: true, ...opcoes })
  } catch (erro) {
    console.log(`SALTA ${nome}: não está instalado (${String(erro?.message ?? erro).split("\n")[0]})`)
    continue
  }
  const page = await browser.newPage()
  page.on("pageerror", (erro) => console.log(`   [erro de página] ${String(erro?.message ?? erro)}`))
  // A real origin: `mediasoup-client` touches WebRTC, and some engines refuse it
  // on `about:blank`. It cost a zero-run on the sister test rig.
  await page.goto("https://example.com", { waitUntil: "domcontentloaded" }).catch(() => page.goto("about:blank"))
  await page.addScriptTag({ path: saida })

  let resposta
  try {
    resposta = await page.evaluate((caps) => window.__perguntar(caps), rtpCapabilities)
  } catch (erro) {
    resposta = { erro: String(erro?.message ?? erro).split("\n")[0] }
  }

  console.log("")
  console.log(`== ${nome}`)
  console.log(`   handler do mediasoup-client: ${resposta.handler ?? "?"}`)
  console.log(`   canProduce audio / video:    ${resposta.podeAudio ?? "?"} / ${resposta.podeVideo ?? "?"}`)
  console.log(`   vídeo possível com o router: ${(resposta.video ?? []).join(", ") || resposta.erro || "(nada)"}`)

  verificar(`${nome}: o \`Device\` carrega as capacidades deste router`, Boolean(resposta.handler), `erro=${resposta.erro}`)
  verificar(`${nome}: e diz que sabe produzir vídeo`, resposta.podeVideo === true, `canProduce("video")=${resposta.podeVideo}`)
  /*
   * The assertion that closes the issue.
   *
   * If the intersection has VP8 and nothing else, then a video producer from
   * this engine against this server can ONLY come out in VP8, there's no path
   * where H.264 appears, no matter how much the engine prefers it when left
   * to choose. That's what makes the encryption-by-codec measurement apply to
   * the product.
   */
  verificar(
    `${nome}: contra este servidor o único vídeo possível é VP8, e nunca H.264`,
    JSON.stringify((resposta.video ?? []).map((cada) => cada.toLowerCase())) === JSON.stringify(["video/vp8"]),
    `intersecção=${JSON.stringify(resposta.video)} — se aqui aparecer H.264, a cifra de frame inteiro deixa de passar neste motor`,
  )

  await browser.close()
}

await motor.fechar()
rmSync(pasta, { recursive: true, force: true })

console.log("")
console.log(
  falhou === 0
    ? "Contra este router, os três motores só podem produzir vídeo em VP8 — que é o codec onde a cifra de frame inteiro passa."
    : `${falhou} verificações falharam.`,
)
process.exit(falhou === 0 ? 0 : 1)
