/**
 * SEC-02 live: no media packet leaves without SFrame, with the production engine.
 *
 *   npx tsc -b && node scripts/sfu-prova-primeiro-pacote/prova.mjs
 *   MOTOR=webkit node scripts/sfu-prova-primeiro-pacote/prova.mjs     # the worker path
 *   SABOTAGEM=sem-cifra node scripts/sfu-prova-primeiro-pacote/prova.mjs     # must fail
 *   SABOTAGEM=ordem-antiga node scripts/sfu-prova-primeiro-pacote/prova.mjs
 *
 * A Chromium (Playwright) and the minimal SFU from Phase 0 (`scripts/sfu-prova/
 * servidor.mjs`, which has no key). The page runs `MotorSfu` and
 * `CifraDeMedia` from `packages/client-core/dist`, without a single adapted line.
 * Three scenarios, each in a fresh browser:
 *
 *  1. `certo`: all frames leaving encryption carry an SFrame header; the
 *     connection sends no more packets than encryption allowed out (one extra
 *     packet is a packet that did not go through it); and every packet the
 *     server forwarded decrypts with the key, outside the server.
 *  2. `plataforma-recusa`: `createEncodedStreams` throws. The input fails with
 *     448, the connection sends ZERO audio packets, the server forwards nothing,
 *     and the producer is closed on the server.
 *  3. `sem-chave`: without our key the producer is never even requested.
 *
 * The `ordem-antiga` sabotage wires encryption after `produce()`, as it was
 * until 1.2.0. What it shows is written in the README.
 */
import { spawn } from "node:child_process"
import { readFile, rm, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { chromium, webkit } from "playwright"
import { abrirSframe, payloadDeRtp } from "../sfu-prova/analise.mjs"
import { KEY_ID, materialEmBytes, SENDER_ID } from "../sfu-prova/chave-de-teste.mjs"

const AQUI = fileURLToPath(new URL(".", import.meta.url))
const PROVA = fileURLToPath(new URL("../sfu-prova/", import.meta.url))
const PORTO_HTTP = Number(process.env.PROVA_PORTO_HTTP ?? 8466)
const PORTO_MEDIA = Number(process.env.PROVA_PORTO_MEDIA ?? 44366)
const CAPTURA = `${PROVA}.captura-primeiro-pacote.json`
const SABOTAGEM = process.env.SABOTAGEM ?? ""
const SEGUNDOS = Number(process.env.PROVA_SEGUNDOS ?? 5)
const MENSAGEM_448 = "the call media could not be encrypted"

let passou = 0
let falhou = 0
function check(rotulo, ok, detalhe = "") {
  if (ok) passou++
  else falhou++
  console.log(`${ok ? "PASS" : "FAIL"}  ${rotulo}${detalhe ? ` -- ${detalhe}` : ""}`)
}

await build({
  entryPoints: [`${AQUI}worker.js`],
  outfile: `${PROVA}primeiro-pacote.worker.js`,
  bundle: true,
  format: "esm",
  target: "es2022",
  logLevel: "error",
})
await build({
  entryPoints: [`${AQUI}pagina.js`],
  outfile: `${PROVA}primeiro-pacote.bundle.js`,
  bundle: true,
  format: "esm",
  target: "chrome120",
  logLevel: "error",
})
const html = (await readFile(`${PROVA}pagina.html`, "utf8")).replace("/pagina.bundle.js", "/primeiro-pacote.bundle.js")
await writeFile(`${PROVA}primeiro-pacote.html`, html)

const MOTOR = process.env.MOTOR ?? "chromium"
/*
 * Chromium encrypts via insertable streams; WebKit via `RTCRtpScriptTransform`,
 * in a worker (the path for Firefox and Safari). Playwright's Firefox does not
 * connect to an SFU on 127.0.0.1 (see `scripts/e2e-audio-quem-entra-tarde.mjs`),
 * so it is not here: WebKit proves the worker path.
 */
const LANCAR =
  MOTOR === "webkit"
    ? () => webkit.launch({ headless: true })
    : () =>
        chromium.launch({
          headless: true,
          args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
        })

/** A scenario: fresh server (clean capture), fresh browser, page with the product. */
async function cenario(nome) {
  await rm(CAPTURA, { force: true })
  const servidor = spawn(process.execPath, [`${PROVA}servidor.mjs`], {
    env: {
      ...process.env,
      PROVA_PORTO_HTTP: String(PORTO_HTTP),
      PROVA_PORTO_MEDIA: String(PORTO_MEDIA),
      PROVA_CAPTURA: CAPTURA,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const doServidor = []
  servidor.stdout.on("data", (d) => doServidor.push(String(d)))
  servidor.stderr.on("data", (d) => doServidor.push(String(d)))
  const browser = await LANCAR()
  try {
    await esperarPorHttp(`http://127.0.0.1:${PORTO_HTTP}/primeiro-pacote.html`, doServidor)
    const pagina = await (await browser.newContext({ permissions: ["microphone"] })).newPage()
    const erros = []
    pagina.on("pageerror", (e) => erros.push(String(e.message).slice(0, 200)))
    if (process.env.PROVA_DEBUG) pagina.on("console", (m) => console.log(`   [${nome}] ${m.text()}`))
    if (process.env.PROVA_DEBUG) pagina.on("pageerror", (e) => console.log(`   [${nome}] ERRO ${e.message}`))
    const url = new URL(`http://127.0.0.1:${PORTO_HTTP}/primeiro-pacote.html`)
    url.searchParams.set("cenario", nome)
    if (SABOTAGEM) url.searchParams.set("sabotagem", SABOTAGEM)
    await pagina.goto(url.href, { waitUntil: "domcontentloaded" })
    await pagina.waitForFunction(() => window.__prova?.pronto || window.__prova?.erro, undefined, { timeout: 20000, polling: 200 })
    await pagina.waitForTimeout(SEGUNDOS * 1000)
    await pagina.evaluate(() => window.__contarPacotes())
    const estado = await pagina.evaluate(() => window.__prova)
    // The server writes the capture at 40 packets, or on exit if there are fewer.
    servidor.kill("SIGTERM")
    await new Promise((r) => servidor.once("exit", r))
    const capturados = JSON.parse(await readFile(CAPTURA, "utf8").catch(() => "[]"))
    const chegados = JSON.parse(await readFile(`${CAPTURA}.chegados.json`, "utf8").catch(() => "{}"))
    return { estado, capturados, chegados, erros }
  } finally {
    await browser.close().catch(() => {})
    if (servidor.exitCode === null) servidor.kill("SIGTERM")
  }
}

const { importSframeKey } = await import("@enclave/crypto")
const chave = await importSframeKey(materialEmBytes(), KEY_ID, SENDER_ID)

/** How many of the captured packets decrypt with the key, and the first packet's number. */
async function abrir(capturados) {
  let abertos = 0
  let primeiroContador
  for (const emBase64 of capturados) {
    const payload = payloadDeRtp(Buffer.from(emBase64, "base64"))
    if (!payload) continue
    const { cabecalho, claro } = await abrirSframe(payload, chave)
    if (cabecalho && primeiroContador === undefined) primeiroContador = cabecalho.counter
    if (claro) abertos++
  }
  return { abertos, primeiroContador }
}

let veredicto = 1
try {
  console.log(`motor: ${MOTOR}`)
  if (SABOTAGEM) console.log(`\n### SABOTAGEM="${SABOTAGEM}"\n`)

  console.log("== 1. o caminho certo")
  const certo = await cenario("certo")
  const { abertos, primeiroContador } = await abrir(certo.capturados)
  check("a entrada não falhou", certo.estado.erroDaEntrada === undefined && !certo.estado.erro, certo.estado.erroDaEntrada ?? certo.estado.erro)
  check("saíram frames da cifra", certo.estado.framesQueSairamDaCifra > 0, `${certo.estado.framesQueSairamDaCifra}`)
  check("todos os frames que saíram da cifra trazem cabeçalho SFrame", certo.estado.framesSemCabecalho === 0, `${certo.estado.framesSemCabecalho} sem cabeçalho`)
  /*
    The browser's `packetsSent` also counts padding-only packets (bandwidth
    estimate probes, no payload), which Chromium sends when media stops: measured
    on 4/11/2026 with the producer's `trace` on the server. That is why packets
    WITH PAYLOAD are counted on the server.
  */
  check(
    "os pacotes com carga que chegaram ao servidor não passam dos frames cifrados (nenhum pacote passou ao lado da cifra)",
    certo.chegados.comCarga > 0 && certo.chegados.comCarga <= certo.estado.framesQueSairamDaCifra,
    `${certo.chegados.comCarga} com carga, ${certo.estado.framesQueSairamDaCifra} frames cifrados`,
  )
  check(
    "e o resto do que a ligação enviou é só enchimento ou repetição",
    certo.estado.pacotesEnviados > 0 &&
      certo.estado.pacotesEnviados <= certo.estado.framesQueSairamDaCifra + certo.chegados.soEnchimento + certo.chegados.repetidos,
    `${certo.estado.pacotesEnviados} enviados; no servidor ${certo.chegados.comCarga} com carga, ${certo.chegados.soEnchimento} só enchimento, ${certo.chegados.repetidos} repetidos`,
  )
  check("o servidor encaminhou pacotes", certo.capturados.length > 0, `${certo.capturados.length}`)
  check("cada pacote encaminhado abre com a chave, fora do servidor", abertos === certo.capturados.length, `${abertos}/${certo.capturados.length}`)
  check("sem erros na página", certo.erros.length === 0, certo.erros.join(" | "))

  console.log("\n== 2. a plataforma recusa a cifra no emissor")
  const recusa = await cenario("plataforma-recusa")
  check("a entrada falha com o 448", recusa.estado.erroDaEntrada === MENSAGEM_448, recusa.estado.erroDaEntrada)
  check("a ligação enviou ZERO pacotes de áudio", recusa.estado.pacotesEnviados === 0, `${recusa.estado.pacotesEnviados}`)
  check("o servidor não encaminhou nada", recusa.capturados.length === 0, `${recusa.capturados.length}`)
  check("o produtor foi fechado no servidor", recusa.estado.pedidos.includes("produtor.fechar"), recusa.estado.pedidos.join(","))

  console.log("\n== 3. sem chave nossa")
  const semChave = await cenario("sem-chave")
  check("a entrada falha com o 448", semChave.estado.erroDaEntrada === MENSAGEM_448, semChave.estado.erroDaEntrada)
  check("o produtor nem foi pedido ao servidor", !semChave.estado.pedidos.includes("produzir"), semChave.estado.pedidos.join(","))
  check("a ligação enviou ZERO pacotes de áudio", semChave.estado.pacotesEnviados === 0, `${semChave.estado.pacotesEnviados}`)

  console.log(
    `\n== números em ${SEGUNDOS}s (caminho certo)` +
      `\n   caminho da cifra: ${certo.estado.caminho}` +
      `\n   cifra: ${certo.estado.framesQueSairamDaCifra} frames, ${certo.estado.framesSemCabecalho} sem cabeçalho, keyId ${certo.estado.primeiroKeyId}` +
      `\n   ligação: ${certo.estado.pacotesEnviados} pacotes de áudio enviados` +
      `\n   servidor: ${certo.capturados.length} capturados, ${abertos} abrem; contador SFrame do primeiro: ${primeiroContador} (a reserva começa em 1000)` +
      `\n   ligações: ${certo.estado.ligacoes?.join(", ")}` +
      `\n   diagnósticos: ${certo.estado.diagnosticos.join(", ") || "nenhum"}`,
  )
  veredicto = falhou === 0 ? 0 : 1
} catch (erro) {
  console.log(`\nFAIL  a prova rebentou -- ${String(erro?.message ?? erro)}`)
  falhou++
}

console.log(`\n${passou} passaram, ${falhou} falharam`)
process.exit(veredicto)

async function esperarPorHttp(url, registo) {
  for (let tentativa = 0; tentativa < 100; tentativa++) {
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error(`o servidor não acendeu em ${url}\n${registo.join("")}`)
}
