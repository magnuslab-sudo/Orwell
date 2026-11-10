/**
 * The exit gate of Phase 0: an audio track routed between two
 * clients, with SFrame intact, and no key on the server.
 *
 *   node scripts/sfu-prova/prova.mjs
 *
 * Exits with 0 if everything promised in the plan holds, and says why if it does not. Does not touch the product: does not import `call.ts`, does not talk to the gateway, does not
 * need any development server running.
 *
 * **The proof measures itself before it measures mediasoup.** The first thing
 * that runs is `autoTeste()` from `analise.mjs`, which puts each check through
 * a good case and a deliberately broken case. Three tests were removed
 * from this repository for passing with the false premise; this order exists
 * because of that.
 *
 * And there is a second level of mutation, this one against the entire proof:
 *
 *   SABOTAGEM=sem-insertable node scripts/sfu-prova/prova.mjs
 *   SABOTAGEM=sem-cifra      node scripts/sfu-prova/prova.mjs
 *   SABOTAGEM=chave-errada   node scripts/sfu-prova/prova.mjs
 *
 * Each one breaks a different link in the chain, the `additionalSettings`, the encryption
 * on the sender, the key on the receiver, and the proof MUST fail on all three. If it passes
 * with any of them, what it measures is not what it says it measures. See the README.
 */
import { spawn } from "node:child_process"
import { readFile, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { chromium } from "playwright"
import { abrirSframe, auditarSegredos, autoTeste, payloadDeRtp } from "./analise.mjs"
import { KEY_ID, MATERIAL_HEX, materialEmBytes, SENDER_ID } from "./chave-de-teste.mjs"

const AQUI = fileURLToPath(new URL(".", import.meta.url))
const PORTO_HTTP = Number(process.env.PROVA_PORTO_HTTP ?? 8460)
const PORTO_MEDIA = Number(process.env.PROVA_PORTO_MEDIA ?? 44300)
const CAPTURA = `${AQUI}.captura.json`
const SABOTAGEM = process.env.SABOTAGEM ?? ""
const SEGUNDOS = Number(process.env.PROVA_SEGUNDOS ?? 8)

let passou = 0
let falhou = 0
function check(rotulo, ok, detalhe = "") {
  if (ok) {
    passou++
    console.log(`PASS  ${rotulo}`)
  } else {
    falhou++
    console.log(`FAIL  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
  }
}

if (SABOTAGEM) {
  console.log(`\n### SABOTAGEM="${SABOTAGEM}" — esta corrida TEM de falhar. Se sair com 0, a prova não mede nada.\n`)
}

// --- 0. the proof measures itself -------------------------------------------
console.log("== as medições, contra casos bons e contra casos estragados")
const auto = await autoTeste()
for (const linha of auto.linhas) console.log(linha)
if (auto.falhou > 0) {
  console.log(`\nas próprias medições estão partidas (${auto.falhou} a falhar). Não vale a pena ligar browsers.`)
  process.exit(1)
}
console.log(`  (${auto.passou} verificações da instrumentação, todas com o par certo/errado)\n`)

// --- 1. the server has no key -----------------------------------------------
console.log("== o servidor")
const fonteDoServidor = await readFile(`${AQUI}servidor.mjs`, "utf8")
const problemas = auditarSegredos(fonteDoServidor, MATERIAL_HEX)
check("o servidor.mjs não conhece material de chave nenhum", problemas.length === 0, problemas.join("; "))
const linhas = fonteDoServidor.split("\n").filter((l) => l.trim() && !l.trim().startsWith("*") && !l.trim().startsWith("/*") && !l.trim().startsWith("//")).length
check("o servidor.mjs cabe numa leitura a olho (menos de 200 linhas de código)", linhas < 200, `${linhas} linhas`)

// --- 2. montar e acender -----------------------------------------------------
await rm(CAPTURA, { force: true })
await build({
  entryPoints: [`${AQUI}pagina.js`],
  outfile: `${AQUI}pagina.bundle.js`,
  bundle: true,
  format: "esm",
  target: "chrome120",
  logLevel: "error",
})

const servidor = spawn(process.execPath, [`${AQUI}servidor.mjs`], {
  env: { ...process.env, PROVA_PORTO_HTTP: String(PORTO_HTTP), PROVA_PORTO_MEDIA: String(PORTO_MEDIA), PROVA_CAPTURA: CAPTURA },
  stdio: ["ignore", "pipe", "pipe"],
})
const registoDoServidor = []
servidor.stdout.on("data", (d) => registoDoServidor.push(String(d)))
servidor.stderr.on("data", (d) => registoDoServidor.push(String(d)))
await esperarPorHttp(`http://127.0.0.1:${PORTO_HTTP}/pagina.html`)

const FLAGS = [
  // Synthetic audio: a continuous tone, no microphone or human consent.
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  // Without this Chrome will not let the AudioContext start and sound measurement gives
  // zero, a false negative that looks like a real failure.
  "--autoplay-policy=no-user-gesture-required",
]

const browsers = []
const paginas = []
async function abrirPagina(papel) {
  const browser = await chromium.launch({ headless: true, args: FLAGS })
  browsers.push(browser)
  const contexto = await browser.newContext({ permissions: ["microphone"] })
  const pagina = await contexto.newPage()
  const erros = []
  pagina.on("pageerror", (e) => erros.push(String(e.message).slice(0, 200)))
  pagina.on("console", (m) => m.type() === "error" && erros.push(m.text().slice(0, 200)))
  const url = new URL(`http://127.0.0.1:${PORTO_HTTP}/pagina.html`)
  url.searchParams.set("papel", papel)
  if (SABOTAGEM) url.searchParams.set("sabotagem", SABOTAGEM)
  await pagina.goto(url.href, { waitUntil: "domcontentloaded" })
  paginas.push({ papel, pagina, erros })
  return pagina
}

let veredicto = 1
try {
  const emissor = await abrirPagina("emissor")
  await esperar(emissor, 15000)
  const receptor = await abrirPagina("receptor")
  await esperar(receptor, 15000)

  // Let it run. Eight seconds of audio at 50 frames per second is a few
  // hundred frames, plenty arrives and does not make the proof slow.
  await emissor.waitForTimeout(SEGUNDOS * 1000)

  const daEmissao = await emissor.evaluate(() => window.__prova)
  const daRecepcao = await receptor.evaluate(() => window.__prova)

  // --- 3. the two client guesses -----------------------------------------------
  console.log("\n== o mediasoup-client")
  check("o handler do mediasoup-client carregou", Boolean(daEmissao.handler), JSON.stringify(daEmissao.handler))
  check("producer.rtpSender existe", daEmissao.temRtpSender === true, daEmissao.erro)
  check("consumer.rtpReceiver existe", daRecepcao.temRtpReceiver === true, daRecepcao.erro)
  check(
    "additionalSettings.encodedInsertableStreams chega à RTCPeerConnection do emissor",
    daEmissao.insertableNoEmissor === true,
    daEmissao.erro,
  )
  check(
    "additionalSettings.encodedInsertableStreams chega à RTCPeerConnection do receptor",
    daRecepcao.insertableNoReceptor === true,
    daRecepcao.erro,
  )

  // --- 4. a faixa atravessa, e atravessa cifrada -----------------------------
  console.log("\n== o áudio")
  check("o emissor cifrou frames", daEmissao.framesCifrados > 0, `${daEmissao.framesCifrados}`)
  check("o receptor recebeu frames", daRecepcao.framesRecebidos > 0, `${daRecepcao.framesRecebidos}`)
  check("o receptor DECIFROU frames", daRecepcao.framesDecifrados > 0, `${daRecepcao.framesDecifrados} decifrados`)
  check(
    "nenhum frame chegou em claro (todos traziam cabeçalho SFrame)",
    daRecepcao.framesSemCabecalho === 0,
    `${daRecepcao.framesSemCabecalho} sem cabeçalho`,
  )
  check(
    "nenhum frame com cabeçalho falhou a decifra",
    daRecepcao.framesRecusados === 0,
    `${daRecepcao.framesRecusados} recusados`,
  )
  check(
    "o cabeçalho decifrado traz o keyId e o senderId do emissor",
    daRecepcao.primeiroCabecalho?.keyId === KEY_ID && daRecepcao.primeiroCabecalho?.senderId === SENDER_ID,
    JSON.stringify(daRecepcao.primeiroCabecalho),
  )
  check("os pacotes RTP chegaram ao receptor", (daRecepcao.stats?.packetsReceived ?? 0) > 0, JSON.stringify(daRecepcao.stats))
  check(
    "saiu som do descodificador depois de decifrar",
    daRecepcao.energiaDeAudio > 0 || daRecepcao.rms > 0.0001,
    `energia=${daRecepcao.energiaDeAudio} rms=${daRecepcao.rms}`,
  )

  // --- 5. what the server saw pass -------------------------------------------
  console.log("\n== os bytes que o servidor encaminhou")
  const capturados = JSON.parse(await readFile(CAPTURA, "utf8").catch(() => "[]"))
  check("o servidor capturou pacotes RTP encaminhados", capturados.length > 0, `${capturados.length}`)

  const chave = await importarChave()
  let comCabecalho = 0
  let abertos = 0
  let contadorAnterior = -1
  let contadorSempreACrescer = true
  let semPayload = 0
  for (const emBase64 of capturados) {
    const payload = payloadDeRtp(Buffer.from(emBase64, "base64"))
    if (!payload) {
      semPayload++
      continue
    }
    const { cabecalho, claro } = await abrirSframe(payload, chave)
    if (!cabecalho) continue
    comCabecalho++
    if (claro) abertos++
    if (cabecalho.counter <= contadorAnterior) contadorSempreACrescer = false
    contadorAnterior = cabecalho.counter
  }
  check("todos os pacotes capturados são RTP legível", semPayload === 0, `${semPayload} ilegíveis`)
  check("o payload de cada pacote é um frame SFrame", comCabecalho === capturados.length, `${comCabecalho}/${capturados.length}`)
  check("o contador do SFrame cresce ao longo dos pacotes", contadorSempreACrescer)
  // Proof that the router did not touch a byte: the AES-GCM tag covers the
  // entire payload, and is verified here, outside the server process, against the
  // exact bytes it passed along.
  check("cada payload abre com a chave do emissor — o SFU não mexeu num byte", abertos === capturados.length, `${abertos}/${capturados.length}`)

  const adulterado = Buffer.from(capturados[0] ?? "", "base64")
  if (adulterado.length > 0) {
    const payload = payloadDeRtp(adulterado)
    payload[payload.length - 1] ^= 0x01
    const resultado = await abrirSframe(payload, chave)
    check("um byte trocado num payload capturado deixa de abrir (a verificação morde)", resultado.claro === undefined)
  }

  console.log("\n== erros de consola")
  for (const { papel, erros } of paginas) check(`sem erros de consola no ${papel}`, erros.length === 0, erros.slice(0, 3).join(" | "))

  // The raw numbers. Not checks, they are what goes into the
  // report and the README, and what lets you see at a glance if the
  // next run behaved differently.
  console.log(
    `\n== números em ${SEGUNDOS}s` +
      `\n   emissor:  ${daEmissao.framesCifrados} frames cifrados · handler ${daEmissao.handler}` +
      `\n   receptor: ${daRecepcao.framesRecebidos} recebidos, ${daRecepcao.framesDecifrados} decifrados, ` +
      `${daRecepcao.framesSemCabecalho} sem cabeçalho, ${daRecepcao.framesRecusados} recusados` +
      `\n   rede:     ${daRecepcao.stats?.packetsReceived} pacotes, ${daRecepcao.stats?.bytesReceived} bytes ` +
      `(${Math.round(((daRecepcao.stats?.bytesReceived ?? 0) * 8) / SEGUNDOS / 100) / 10} kbps)` +
      `\n   som:      energia ${daRecepcao.energiaDeAudio?.toFixed?.(4)} · rms máximo ${daRecepcao.rms?.toFixed?.(4)}` +
      `\n   servidor: ${capturados.length} pacotes RTP capturados, ${abertos} abrem com a chave do emissor`,
  )

  veredicto = falhou === 0 ? 0 : 1
} catch (erro) {
  console.log(`\nFAIL  a prova rebentou — ${String(erro?.message ?? erro)}`)
  falhou++
  veredicto = 1
} finally {
  for (const browser of browsers) await browser.close().catch(() => {})
  servidor.kill("SIGTERM")
}

console.log(`\n${passou} passaram, ${falhou} falharam`)
if (falhou > 0 && registoDoServidor.length > 0) console.log(`\nregisto do servidor:\n${registoDoServidor.join("")}`)
if (SABOTAGEM) {
  const bem = veredicto !== 0
  console.log(bem ? `\nBEM: a sabotagem "${SABOTAGEM}" fez a prova falhar, como tinha de fazer.` : `\nMAL: a sabotagem "${SABOTAGEM}" passou. A prova não mede o que diz medir.`)
}
process.exit(veredicto)

async function importarChave() {
  const { importSframeKey } = await import("@enclave/crypto")
  return importSframeKey(materialEmBytes(), KEY_ID, SENDER_ID)
}

async function esperar(pagina, limite) {
  await pagina.waitForFunction(() => window.__prova?.pronto || window.__prova?.erro, undefined, { timeout: limite, polling: 200 })
  const estado = await pagina.evaluate(() => window.__prova)
  if (estado.erro) throw new Error(`${estado.papel}: ${estado.erro}`)
}

async function esperarPorHttp(url) {
  for (let tentativa = 0; tentativa < 100; tentativa++) {
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error(`o servidor não acendeu em ${url}\n${registoDoServidor.join("")}`)
}
