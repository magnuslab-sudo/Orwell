/**
 * Live: the microphone dies halfway through the call and sound comes back,
 * without leaving, and without a single packet outside the cipher (11/4/2026).
 *
 *   npx tsc -b && node scripts/sfu-prova-mic-recupera/prova.mjs
 *   CENARIOS=faixa-termina node scripts/sfu-prova-mic-recupera/prova.mjs
 *   SABOTAGEM=sem-vigia node scripts/sfu-prova-mic-recupera/prova.mjs     # MUST fail
 *
 * One Chromium (Playwright, the desktop app engine) and the minimal Phase 0
 * SFU (`scripts/sfu-prova/servidor.mjs`, which has no key at all). Two pages:
 * the SENDER runs the entire `Call` of the product, with the true voice chain
 * (worklet and gtcrn) and true encryption; the LISTENER consumes the sender's
 * voice through the SFU with the product's `MotorSfu` and `CifraDeMedia`, and
 * measures the peak of what comes out of decryption every 250 ms.
 *
 * In each scenario: 4 s of normal call, the microphone dead by the scenario's
 * cause, and 8 s of wait. It verifies that sound arrives before, comes back
 * after (in the listener, decrypted), that the sender never left the call, that
 * the log says the cause and recovery, that every frame that came out of
 * encryption has an SFrame header, that the connection sent no more packets than
 * encryption let out, and that EVERY packet the server forwarded (the entire
 * call, also during and after the swap) opens with the key outside it.
 *
 * Scenarios: `faixa-termina` (the device disappears), `worklet-rebenta` (the
 * worklet throws in `process()`), `contexto-preso` (the `AudioContext` is
 * suspended and refuses to come back) and `cifra-tarda` (the key arrives only
 * 3 s after entry: encryption tries again and voice comes out without the
 * person doing anything).
 */
import { spawn } from "node:child_process"
import { copyFile, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { chromium } from "playwright"
import { abrirSframe, payloadDeRtp } from "../sfu-prova/analise.mjs"
import { KEY_ID, materialEmBytes, SENDER_ID } from "../sfu-prova/chave-de-teste.mjs"

const AQUI = fileURLToPath(new URL(".", import.meta.url))
const PROVA = fileURLToPath(new URL("../sfu-prova/", import.meta.url))
const DIST = fileURLToPath(new URL("../../packages/client-core/dist/", import.meta.url))
const PORTO_HTTP = Number(process.env.PROVA_PORTO_HTTP ?? 8467)
const PORTO_MEDIA = Number(process.env.PROVA_PORTO_MEDIA ?? 44367)
const CAPTURA = `${PROVA}.captura-mic-recupera.json`
const SABOTAGEM = process.env.SABOTAGEM ?? ""
const CENARIOS = (process.env.CENARIOS ?? "faixa-termina,worklet-rebenta,contexto-preso,cifra-tarda").split(",")
/** Below this is silence. The tone of Chromium's fake device gets close to 1. */
const SOM = 0.05

let passou = 0
let falhou = 0
function check(rotulo, ok, detalhe = "") {
  if (ok) passou++
  else falhou++
  console.log(`${ok ? "PASS" : "FAIL"}  ${rotulo}${detalhe ? ` -- ${detalhe}` : ""}`)
}

// --- the files served: the page, the voice chain worklet, and the model ----
const exigir = createRequire(import.meta.url)
await copyFile(exigir.resolve("@sapphi-red/web-noise-suppressor/gtcrn.wasm"), `${PROVA}mic-recupera.gtcrn.wasm`)
await build({
  entryPoints: [`${DIST}audio/processador-de-voz.js`],
  outfile: `${PROVA}mic-recupera.worklet.js`,
  bundle: true,
  format: "esm",
  target: "chrome120",
  logLevel: "error",
})
/** Vite's `?url` by hand: the chain requests the worklet and model by address. */
const enderecos = {
  name: "enderecos",
  setup(construir) {
    construir.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: "endereco" }))
    construir.onLoad({ filter: /.*/, namespace: "endereco" }, (args) => ({
      contents: `export default ${JSON.stringify(args.path.includes("gtcrn") ? "/mic-recupera.gtcrn.wasm" : "/mic-recupera.worklet.js")}`,
      loader: "js",
    }))
  },
}
await build({
  entryPoints: [`${AQUI}pagina.js`],
  outfile: `${PROVA}mic-recupera.bundle.js`,
  bundle: true,
  format: "esm",
  target: "chrome120",
  logLevel: "error",
  plugins: [enderecos],
})
const html = (await readFile(`${PROVA}pagina.html`, "utf8")).replace("/pagina.bundle.js", "/mic-recupera.bundle.js")
await writeFile(`${PROVA}mic-recupera.html`, html)

const { importSframeKey } = await import("@enclave/crypto")
const chave = await importSframeKey(materialEmBytes(), KEY_ID, SENDER_ID)

async function cenario(nome) {
  await rm(CAPTURA, { force: true })
  const servidor = spawn(process.execPath, [`${PROVA}servidor.mjs`], {
    env: {
      ...process.env,
      PROVA_PORTO_HTTP: String(PORTO_HTTP),
      PROVA_PORTO_MEDIA: String(PORTO_MEDIA),
      PROVA_CAPTURA: CAPTURA,
      PROVA_PACOTES_A_GUARDAR: "4000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const doServidor = []
  servidor.stdout.on("data", (d) => doServidor.push(String(d)))
  servidor.stderr.on("data", (d) => doServidor.push(String(d)))
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  })
  try {
    const base = `http://127.0.0.1:${PORTO_HTTP}/mic-recupera.html`
    await esperarPorHttp(base, doServidor)
    const abrir = async (papel) => {
      const pagina = await (await browser.newContext({ permissions: ["microphone"] })).newPage()
      const erros = []
      pagina.on("pageerror", (e) => erros.push(String(e.message).slice(0, 200)))
      if (process.env.PROVA_DEBUG) pagina.on("console", (m) => console.log(`   [${papel}] ${m.text()}`))
      const url = new URL(base)
      url.searchParams.set("papel", papel)
      url.searchParams.set("cenario", nome)
      if (SABOTAGEM) url.searchParams.set("sabotagem", SABOTAGEM)
      await pagina.goto(url.href, { waitUntil: "domcontentloaded" })
      await pagina.waitForFunction(() => window.__prova?.pronto || window.__prova?.erro, undefined, { timeout: 20000, polling: 200 })
      return { pagina, erros }
    }
    const emissor = await abrir("emissor")
    // Voice must be on the server before the listener enters (the listener consumes what's there).
    await emissor.pagina.waitForFunction(() => window.__prova.diagnosticos.some((l) => l.includes("call-sfu-ligado")), undefined, { timeout: 20000 })
    if (nome === "cifra-tarda") {
      await emissor.pagina.waitForFunction(
        () => window.__prova.diagnosticos.some((l) => l.includes("sfu-emissor-cifra-recuperada")),
        undefined,
        { timeout: 20000 },
      )
    }
    const ouvinte = await abrir("ouvinte")
    await emissor.pagina.waitForTimeout(4000)
    if (nome !== "cifra-tarda") await emissor.pagina.evaluate(() => window.__matar())
    await emissor.pagina.waitForTimeout(8000)
    await emissor.pagina.evaluate(() => window.__contarPacotes())
    servidor.kill("SIGTERM")
    await new Promise((r) => servidor.once("exit", r))
    // Cipher frames are read AFTER the server stops counting (4/11/2026, 1.3.2 integration). Read before, a frame leaving between the read and SIGTERM reached the server instead of the count: "552 with payload, 551 encrypted frames", all 552 opening with the key. Read after, the sender's count can only be higher, and "not one more" again measures what it says.
    const doEmissor = await emissor.pagina.evaluate(() => window.__prova)
    const doOuvinte = await ouvinte.pagina.evaluate(() => window.__prova)
    const capturados = JSON.parse(await readFile(CAPTURA, "utf8").catch(() => "[]"))
    const chegados = JSON.parse(await readFile(`${CAPTURA}.chegados.json`, "utf8").catch(() => "{}"))
    return { doEmissor, doOuvinte, capturados, chegados, erros: [...emissor.erros, ...ouvinte.erros] }
  } finally {
    await browser.close().catch(() => {})
    if (servidor.exitCode === null) servidor.kill("SIGTERM")
  }
}

async function abertos(capturados) {
  let abrem = 0
  for (const emBase64 of capturados) {
    const payload = payloadDeRtp(Buffer.from(emBase64, "base64"))
    if (!payload) continue
    const { claro } = await abrirSframe(payload, chave)
    if (claro) abrem++
  }
  return abrem
}

/** The peak level on the listener between two instants on their page. */
function picoEntre(niveis, de, ate) {
  return niveis.filter(([t]) => t >= de && t < ate).reduce((m, [, v]) => Math.max(m, v), 0)
}

const MORTE_POR_CENARIO = {
  "faixa-termina": "call-microfone-terminou",
  "worklet-rebenta": "call-microfone-cadeia-rebentou",
  "contexto-preso": "call-microfone-contexto-parado",
}

let veredicto = 1
try {
  if (SABOTAGEM) console.log(`\n### SABOTAGEM="${SABOTAGEM}"\n`)
  for (const nome of CENARIOS) {
    console.log(`\n== ${nome}`)
    const { doEmissor, doOuvinte, capturados, chegados, erros } = await cenario(nome)
    const abrem = await abertos(capturados)
    const niveis = doOuvinte.niveis
    // Levels count on the listener's clock; the call ends at the last one.
    const fim = niveis.at(-1)?.[0] ?? 0
    // Death was roughly 8 seconds before the end; the first one and a half seconds of measurement is startup.
    const antes = picoEntre(niveis, 1500, fim - 8250)
    const depois = picoEntre(niveis, fim - 3000, fim + 1)
    // Voice frames that opened on the listener's side: roughly 50 per second when there's voice.
    const frames = (de, ate) => doOuvinte.decifrados.filter(([t]) => t >= de && t < ate).reduce((n, [, v]) => n + v, 0)
    const framesAntes = frames(1500, fim - 8250)
    const framesDepois = frames(fim - 3000, fim + 1)

    check("o emissor entrou, com a cadeia de voz", doEmissor.erro === undefined && doEmissor.cadeia === true, doEmissor.erro ?? `cadeia=${doEmissor.cadeia}`)
    check("o ouvinte ouve o emissor antes", antes > SOM && framesAntes > 50, `pico ${antes}, ${framesAntes} frames decifrados`)
    if (nome === "nada") {
      // The control: no death at all, the same measurements.
    } else if (MORTE_POR_CENARIO[nome]) {
      check(`o registo diz a causa (${MORTE_POR_CENARIO[nome]})`, doEmissor.diagnosticos.some((l) => l.includes(MORTE_POR_CENARIO[nome])))
      check(
        "o registo diz que voltou",
        doEmissor.diagnosticos.some((l) => l.includes("call-microfone-recuperado")),
        doEmissor.diagnosticos.find((l) => l.includes("call-microfone-recuperado")) ?? "",
      )
    } else {
      check(
        "a cifra tentou outra vez e a voz saiu sozinha",
        doEmissor.diagnosticos.some((l) => l.includes("sfu-emissor-cifra-a-repetir")) &&
          doEmissor.diagnosticos.some((l) => l.includes("sfu-emissor-cifra-recuperada")),
      )
    }
    check(
      "o som volta ao ouvinte, decifrado, sem o emissor sair",
      depois > SOM && framesDepois > 100,
      `últimos 3 s: pico ${depois}, ${framesDepois} frames decifrados`,
    )
    check("o emissor nunca saiu da chamada", doEmissor.canal === "!prova:local" && !doEmissor.terminou && doEmissor.erros.length === 0, `${doEmissor.canal} ${doEmissor.erros.join(",")}`)
    check("todos os frames que saíram da cifra trazem cabeçalho SFrame", doEmissor.framesSemCabecalho === 0, `${doEmissor.framesSemCabecalho} de ${doEmissor.framesQueSairamDaCifra}`)
    /*
      Browser `packetsSent` also counts padding-only packets (bandwidth estimate
      probes, sent by Chromium in media gaps with no payload). This is compared
      against what REACHED the producer on the server, separated into payload and
      padding-only (the mediasoup `trace`).
    */
    check(
      "chegaram ao servidor tantos pacotes com carga como frames cifrados, nem um a mais",
      chegados.comCarga > 0 && chegados.comCarga <= doEmissor.framesQueSairamDaCifra,
      `${chegados.comCarga} com carga, ${doEmissor.framesQueSairamDaCifra} frames cifrados`,
    )
    check(
      "o resto do que a ligação enviou é só enchimento",
      doEmissor.pacotesEnviados <= doEmissor.framesQueSairamDaCifra + chegados.soEnchimento + chegados.repetidos,
      `${doEmissor.pacotesEnviados} enviados; no servidor: ${chegados.comCarga} com carga, ${chegados.soEnchimento} só enchimento, ${chegados.repetidos} repetidos`,
    )
    check("cada pacote que o servidor encaminhou (a chamada inteira) abre com a chave", capturados.length > 100 && abrem === capturados.length, `${abrem}/${capturados.length}`)
    check("sem erros nas páginas", erros.length === 0, erros.join(" | "))
    console.log(`   capturas do microfone: ${doEmissor.capturas}`)
    console.log(`   registo: ${doEmissor.diagnosticos.filter((l) => /microfone|cifra|audio-|sframe/.test(l)).join(" | ")}`)
    for (const serie of doEmissor.niveisDaSaida ?? []) console.log(`   saída do microfone (ms, pico): ${serie.filter((_, i) => i % 4 === 0).map(([t, v]) => `${t}:${v}`).join(" ")}`)
    console.log(`   níveis do ouvinte (ms, pico): ${niveis.filter((_, i) => i % 4 === 0).map(([t, v]) => `${t}:${v}`).join(" ")}`)
  }
  veredicto = falhou === 0 ? 0 : 1
} catch (erro) {
  console.log(`\nFAIL  a prova rebentou -- ${String(erro?.stack ?? erro)}`)
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
