/**
 * "Microphone sensitivity" live (owner, 2/11/2026): the manual slider silences the
 * microphone below it, and the OTHER side measures it.
 *
 * ```
 * npm run build && node scripts/e2e-limiar-microfone.mjs              # tudo
 * node scripts/e2e-limiar-microfone.mjs --so browser-sfu               # Ana and Bruno in Chromium, over SFU
 * node scripts/e2e-limiar-microfone.mjs --so browser-malha             # idem, em malha
 * node scripts/e2e-limiar-microfone.mjs --so secretaria                # a Ana na app de secretária, o Bruno no Chromium
 * SABOTAGEM=sem-linha node scripts/e2e-limiar-microfone.mjs --so browser-sfu   # MUST exit with 1
 * ```
 *
 * Via the interface: Ana and Bruno create accounts, Ana creates the channel and
 * invites Bruno. Ana opens Settings › Microphone and camera, turns off
 * "Automatic" and sets the slider to -50 dB; the live meter moves and lights
 * up green (capture at `capturas/limiar-microfone-*.png`). Both join the voice room; Bruno mutes his.
 * Then, with the settings screen open mid-call:
 *
 *  1. voice at -20 dBFS, slider at -50: Bruno hears the voice (energy from `getStats`);
 *  2. slider moves to 0 dB, same call: Bruno measures silence, and via SFU
 *     Opus DTX cuts the packets;
 *  3. slider at -40 e voice at -60: silence; voice rises to -20: he hears it again;
 *  4. Ana's ring on Bruno's screen follows this (off at 2 e 3);
 *  5. "Automatic" again: voice comes through as before.
 *
 * **Ana's microphone is synthetic**: the test core's voice
 * (`client-core/testes/audio-sintetico.ts`, glottal pulses, formants, syllables
 * and pauses), played on a `AudioContext` and delivered by the `getUserMedia` swapped
 * before the app starts. `window.__definirNivel(db)` changes the level.
 *
 * **"Hears" means energy in Bruno's `getStats`**: `totalAudioEnergy` across
 * `totalSamplesDuration` of the audio tracks that arrive (after decryption and
 * decoding), plus packets per second.
 *
 * Sabotage `sem-linha` leaves sensitivity on automatic (the script does not
 * touch the switch or the slider): the silence phases MUST fail, which
 * proves that the other side's measurement sees the difference between voice
 * and silence.
 *
 * Everything local and disposable (`servidor-descartavel.mjs`). Ports 8506 a 8508 no
 * browser, 8509 e 8510 na desktop. Never production.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, ate, contasDoServidor, criarCanal, dentro, entrarNaVoz, portaoPronto, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const SABOTAGEM = process.env.SABOTAGEM ?? ""
const so = process.argv.includes("--so") ? process.argv[process.argv.indexOf("--so") + 1] : null
const CORRIDAS = so ? [so] : ["browser-sfu", "browser-malha", "secretaria"]
const FRASE = "frase-de-verificacao-2026"
const CANAL = "ensaio"
const ARGS = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
const CAPTURAS = join(RAIZ, "capturas")
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Ana's synthetic microphone. Runs before the app, in the page world.
 * One graph only (source in loop, gain), and a new destination for each request: the
 * preview, the meter and the call each open the microphone in turn.
 */
const MICROFONE_SINTETICO = () => {
  const TAXA = 48000
  function voz(segundos) {
    const n = Math.round(segundos * TAXA)
    const formantes = [[700, 1220, 2600], [300, 2300, 3000], [500, 1000, 2500], [400, 1700, 2400]]
    const estado = [[0, 0], [0, 0], [0, 0]]
    const x = new Float32Array(n)
    let fase = 0
    const silaba = 0.25
    for (let i = 0; i < n; i++) {
      const t = i / TAXA
      const f0 = 120 + 15 * Math.sin(2 * Math.PI * 0.7 * t) + 8 * Math.sin(2 * Math.PI * 5 * t)
      fase += f0 / TAXA
      if (fase >= 1) fase -= 1
      const fonte = (fase < 0.4 ? Math.sin((Math.PI * fase) / 0.4) : 0) - 0.25
      const F = formantes[Math.floor(t / silaba) % 4]
      let y = 0
      for (let j = 0; j < 3; j++) {
        const largura = 80 + 40 * j
        const r = Math.exp((-Math.PI * largura) / TAXA)
        const a1 = 2 * r * Math.cos((2 * Math.PI * F[j]) / TAXA)
        const a2 = -r * r
        const e = estado[j]
        const v = fonte * (1 - r) + a1 * e[0] + a2 * e[1]
        e[1] = e[0]
        e[0] = v
        y += v / (j + 1)
      }
      const emFala = t % 2 < 1.4
      const envelope = emFala ? Math.pow(Math.sin(Math.PI * ((t % silaba) / silaba)), 0.6) : 0
      x[i] = y * envelope
    }
    // RMS of speech (without pauses) at -20 dBFS: the gain changes from here on.
    let soma = 0
    let contadas = 0
    for (let i = 0; i < n; i++) if ((i / TAXA) % 2 < 1.4) (soma += x[i] * x[i]), contadas++
    const escala = 10 ** (-20 / 20) / Math.sqrt(soma / contadas)
    for (let i = 0; i < n; i++) x[i] *= escala
    return x
  }

  let grafo = null
  window.__nivel = -20
  const montar = () => {
    if (grafo) return grafo
    const ctx = new AudioContext({ sampleRate: TAXA })
    const buffer = ctx.createBuffer(1, 4 * TAXA, TAXA)
    buffer.copyToChannel(voz(4), 0)
    const fonte = ctx.createBufferSource()
    fonte.buffer = buffer
    fonte.loop = true
    const ganho = ctx.createGain()
    ganho.gain.value = 10 ** ((window.__nivel + 20) / 20)
    fonte.connect(ganho)
    fonte.start()
    grafo = { ctx, ganho }
    return grafo
  }
  /** Ana's speech level, in RMS dBFS (excluding pauses). */
  window.__definirNivel = (db) => {
    window.__nivel = db
    if (grafo) grafo.ganho.gain.value = 10 ** ((db + 20) / 20)
  }
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  const falso = async (pedido) => {
    if (!pedido?.audio) return original(pedido)
    const { ctx, ganho } = montar()
    await ctx.resume().catch(() => {})
    const destino = ctx.createMediaStreamDestination()
    destino.channelCount = 1
    ganho.connect(destino)
    const faixas = [...destino.stream.getAudioTracks()]
    if (pedido.video) faixas.push(...(await original({ video: pedido.video })).getVideoTracks())
    return new MediaStream(faixas)
  }
  Object.defineProperty(MediaDevices.prototype, "getUserMedia", { value: falso, configurable: true, writable: true })
  try {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: falso, configurable: true, writable: true })
  } catch {}
}

/** Bruno's connections, captured at birth, for `getStats`. */
const SONDA = () => {
  /*
   * Phase M1: the size of each audio frame that the encoder delivers to the
   * cipher, BEFORE it adds header and tag. It proves the DTX hypothesis: in
   * silence Opus delivers frames of 0 to 2 bytes, and the cipher turns them
   * into packets. Insertable stream path only (Chromium and desktop).
   */
  window.__quadros = { total: 0, minimos: 0 }
  const abrir = window.RTCRtpSender?.prototype?.createEncodedStreams
  if (typeof abrir === "function") {
    window.RTCRtpSender.prototype.createEncodedStreams = function (...argumentos) {
      const fluxos = abrir.apply(this, argumentos)
      if (this.track?.kind !== "audio") return fluxos
      const contador = new TransformStream({
        transform(quadro, controlador) {
          window.__quadros.total++
          if (quadro.data.byteLength <= 2) window.__quadros.minimos++
          controlador.enqueue(quadro)
        },
      })
      return { readable: fluxos.readable.pipeThrough(contador), writable: fluxos.writable }
    }
  }
  window.__pcs = []
  const Original = window.RTCPeerConnection
  window.RTCPeerConnection = function (...argumentos) {
    const pc = new Original(...argumentos)
    window.__pcs.push(pc)
    return pc
  }
  window.RTCPeerConnection.prototype = Original.prototype
  Object.setPrototypeOf(window.RTCPeerConnection, Original)
}

/** Audio energy and packets arriving at Bruno, over a window of `ms`. */
const MEDIR = async (ms) => {
  const ler = async () => {
    let energia = 0
    let duracao = 0
    let pacotes = 0
    for (const pc of window.__pcs) {
      if (pc.connectionState === "closed") continue
      const relatorio = await pc.getStats().catch(() => null)
      relatorio?.forEach((r) => {
        if (r.type === "inbound-rtp" && r.kind === "audio") {
          energia += r.totalAudioEnergy ?? 0
          duracao += r.totalSamplesDuration ?? 0
          pacotes += r.packetsReceived ?? 0
        }
      })
    }
    return { energia, duracao, pacotes }
  }
  const a = await ler()
  await new Promise((r) => setTimeout(r, ms))
  const b = await ler()
  const potencia = (b.energia - a.energia) / Math.max(1e-9, b.duracao - a.duracao)
  return {
    db: potencia > 0 ? Math.round(10 * Math.log10(potencia) * 10) / 10 : -Infinity,
    pps: Math.round(((b.pacotes - a.pacotes) / (ms / 1000)) * 10) / 10,
    segundos: Math.round((b.duracao - a.duracao) * 10) / 10,
  }
}

/** The highest `--voz` on Ana's card on Bruno's screen, over a window of `ms`. */
async function anelDaAna(page, ms = 3000) {
  let maior = 0
  const fim = Date.now() + ms
  while (Date.now() < fim) {
    const valor = await page.evaluate(() => {
      const cartao = [...document.querySelectorAll(".call-chip")].find((c) => c.querySelector(".call-chip-name")?.textContent?.includes("Ana"))
      return Number(cartao?.style.getPropertyValue("--voz") || "0")
    })
    maior = Math.max(maior, valor)
    await dormir(100)
  }
  return maior
}

async function abrirDefinicoesDoMicrofone(page) {
  await page.keyboard.press("Escape").catch(() => {})
  await page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await page.getByRole("button", { name: "Microfone e câmara", exact: true }).first().click()
  const cartao = page.locator("section.sensibilidade")
  await cartao.waitFor({ timeout: 15_000 })
  return cartao
}

const SABOTAR = SABOTAGEM === "sem-linha"

async function definirLinha(cartao, db) {
  if (SABOTAR) return
  await cartao.getByRole("slider", { name: "Linha do microfone" }).fill(String(db))
  await dormir(300)
}

async function capturar(page, cartao, nome) {
  for (const [largura, altura] of [[1280, 860], [390, 844]]) {
    await page.setViewportSize({ width: largura, height: altura })
    await cartao.scrollIntoViewIfNeeded()
    await dormir(600)
    // Synthetic speech has pauses: capture waits for a syllable, so green shows.
    await ate(async () => Number(await cartao.getByRole("meter").getAttribute("aria-valuenow")) > -30, 4000, 40)
    await dormir(120)
    await page.screenshot({ path: join(CAPTURAS, `${nome}-${largura}.png`) })
    const rola = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    check(`${nome} a ${largura}px: sem rolagem horizontal`, !rola)
  }
  await page.setViewportSize({ width: 1280, height: 860 })
}

/**
 * The common path for runs: Ana (in `ana`) and Bruno (Chromium) already have
 * accounts on the same server; from here on it's the same.
 */
async function ensaio(rotulo, ana, bruno, srv, { sfu }) {
  const r = (texto) => `[${rotulo}] ${texto}`
  const [, enderecoBruno] = contasDoServidor(srv.base)
  await criarCanal(ana, CANAL)
  check(r("a Ana convida o Bruno"), await convidar(ana, CANAL, enderecoBruno))
  check(r("o Bruno entra no canal"), await aceitarConvite(bruno, CANAL, { espera: 60_000 }))

  // Off call: the meter opens the microphone and moves.
  let cartao = await abrirDefinicoesDoMicrofone(ana)
  const automatica = cartao.getByRole("switch", { name: "Automática" })
  check(r("de fábrica a sensibilidade é automática"), (await automatica.getAttribute("aria-checked")) === "true")
  check(r("na automática não há barra"), (await cartao.getByRole("slider").count()) === 0)
  if (!SABOTAR) {
    await automatica.click()
    await cartao.getByRole("slider", { name: "Linha do microfone" }).waitFor({ timeout: 5000 })
  }
  await definirLinha(cartao, -50)
  const leituras = []
  for (let i = 0; i < 25 && !SABOTAR; i++) {
    leituras.push(Number(await cartao.getByRole("meter").getAttribute("aria-valuenow")))
    await dormir(120)
  }
  const distintas = new Set(leituras).size
  check(r("fora de chamada, o medidor ao vivo mexe"), distintas >= 3, `${distintas} leituras distintas, de ${Math.min(...leituras)} a ${Math.max(...leituras)} dB`)
  check(r("e a voz a -20 dBFS passa a linha de -50"), Math.max(...leituras) > -50)
  const verde = SABOTAR ? 0 : await cartao.locator(".sensibilidade-acima").evaluate((el) => Number(el.style.transform.match(/scaleX\(([\d.]+)\)/)?.[1] ?? 0))
  check(r("acima da linha, o medidor acende a verde"), verde > 0 || Math.max(...leituras) > -50, `verde ${verde}`)
  if (rotulo === "browser sfu" && !SABOTAR) await capturar(ana, cartao, "limiar-microfone")

  // A chamada.
  for (const page of [ana, bruno]) {
    await page.keyboard.press("Escape").catch(() => {})
    await abrirCanal(page, CANAL)
    check(r(`${page === ana ? "a Ana" : "o Bruno"} entra na sala de voz`), await entrarNaVoz(page))
    await page.locator(".call-barra").waitFor({ timeout: 30_000 })
  }
  const micDoBruno = bruno.locator(".call-barra").getByRole("button", { name: "Microfone ligado. Desligar microfone." })
  if (await micDoBruno.isVisible().catch(() => false)) await micDoBruno.click()
  const ligado = await ate(async () => (await MEDIR_NO(bruno, 1000)).segundos > 0.5, 45_000, 500)
  check(r("o áudio da Ana chega ao Bruno"), ligado >= 0)

  // Settings open mid-call: the slider changes live.
  cartao = await abrirDefinicoesDoMicrofone(ana)

  const fase = async (titulo, { linha, nivel }) => {
    await ana.evaluate((db) => window.__definirNivel(db), nivel)
    await definirLinha(cartao, linha)
    await dormir(1500)
    const [medida, enviado] = await Promise.all([MEDIR_NO(bruno, 4000), ana.evaluate(ENVIADO, 4000).catch(() => null)])
    if (enviado) {
      console.log(`       (a Ana envia ${enviado.pps.toFixed(1)} pacotes/s, ${(enviado.bps / 1000).toFixed(1)} kbps, ${enviado.bytesPorPacote.toFixed(1)} bytes de carga por pacote; ${enviado.fmtp.join(" | ")})`)
      console.log(`       (quadros do codificador: ${enviado.quadros.porSegundo.toFixed(1)}/s, dos quais ${enviado.quadros.minimos.toFixed(1)}/s com 2 bytes ou menos)`)
    }
    const anel = await anelDaAna(bruno, 2500)
    console.log(`       ${titulo}: ${medida.db} dB, ${medida.pps} pacotes/s, anel ${anel.toFixed(3)}`)
    return { ...medida, anel, enviado }
  }

  const voz = await fase("voz a -20, linha a -50", { linha: -50, nivel: -20 })
  check(r("voz acima da linha: o Bruno ouve-a"), voz.db > -45, `${voz.db} dB`)
  check(r("e o anel da Ana acende no ecrã do Bruno"), voz.anel > 0.2, voz.anel.toFixed(3))

  const linhaNoTopo = await fase("voz a -20, linha a 0", { linha: 0, nivel: -20 })
  check(r("linha acima da voz, na mesma chamada: o Bruno mede silêncio"), linhaNoTopo.db < -80, `${linhaNoTopo.db} dB`)
  check(r("e o anel da Ana fica apagado"), linhaNoTopo.anel < 0.05, linhaNoTopo.anel.toFixed(3))
  /*
    M1 phase (DTX for real). Until 2/11/2026 DTX did not cut packets: via SFU the
    cipher put header and tag on Opus silence markers (0 a 2
    bytes) and the RTP sender sent them all; on the mesh no one asked
    for `usedtx=1`. Measured before: 50 pacotes/s in silence, both sides. Now the
    sender drops the markers (`quadroDeSilencio`) and the mesh asks for DTX
    (`comDtxNoOpus`): in silence out comes comfort of 400 em 400 ms, and nothing else.
  */
  if (voz.enviado && linhaNoTopo.enviado) {
    console.log(`       (débito da Ana: ${(linhaNoTopo.enviado.bps / 1000).toFixed(1)} kbps em silêncio, ${(voz.enviado.bps / 1000).toFixed(1)} com voz)`)
    check(r("DTX: em silêncio a Ana manda 5 pacotes/s ou menos"), linhaNoTopo.enviado.pps <= 5, `${linhaNoTopo.enviado.pps.toFixed(1)} pacotes/s, ${(linhaNoTopo.enviado.bps / 1000).toFixed(1)} kbps`)
    check(r("DTX: e com voz continua a mandar a voz"), voz.enviado.pps >= 30, `${voz.enviado.pps.toFixed(1)} pacotes/s`)
  }
  console.log(`       (pacotes por segundo no Bruno: ${linhaNoTopo.pps} em silêncio, ${voz.pps} com voz${sfu ? ", por SFU" : ", em malha"})`)

  const baixa = await fase("voz a -60, linha a -40", { linha: -40, nivel: -60 })
  check(r("voz baixa abaixo da linha: silêncio"), baixa.db < -80, `${baixa.db} dB`)
  const sobe = await fase("voz a -20, linha a -40", { linha: -40, nivel: -20 })
  check(r("a voz sobe acima da linha: volta a ouvir-se"), sobe.db > -45, `${sobe.db} dB`)

  if (!SABOTAR) await cartao.getByRole("switch", { name: "Automática" }).click()
  await ana.evaluate(() => window.__definirNivel(-20))
  await dormir(1500)
  const auto = await MEDIR_NO(bruno, 4000)
  check(r('"Automática" outra vez: a voz passa como antes'), auto.db > -45, `${auto.db} dB`)
}

const MEDIR_NO = (page, ms) => page.evaluate(MEDIR, ms)

/** What Ana SENDS (packets and bytes per second) and the negotiated Opus fmtp. DTX diagnostics. */
const ENVIADO = async (ms) => {
  const ler = async () => {
    let pacotes = 0
    let bytes = 0
    for (const pc of window.__pcs ?? []) {
      if (pc.connectionState === "closed") continue
      const relatorio = await pc.getStats().catch(() => null)
      relatorio?.forEach((r) => {
        if (r.type === "outbound-rtp" && r.kind === "audio") {
          pacotes += r.packetsSent ?? 0
          bytes += r.bytesSent ?? 0
        }
      })
    }
    return { pacotes, bytes }
  }
  const a = await ler()
  const qa = { ...(window.__quadros ?? { total: 0, minimos: 0 }) }
  await new Promise((r) => setTimeout(r, ms))
  const b = await ler()
  const qb = window.__quadros ?? { total: 0, minimos: 0 }
  const quadros = { porSegundo: ((qb.total - qa.total) / ms) * 1000, minimos: ((qb.minimos - qa.minimos) / ms) * 1000 }
  const fmtp = [...new Set((window.__pcs ?? []).flatMap((pc) => (pc.remoteDescription?.sdp ?? "").split("\n").filter((l) => /a=fmtp:\d+ .*(usedtx|useinbandfec)/.test(l)).map((l) => l.trim())))]
  const pacotes = b.pacotes - a.pacotes
  return { pps: (pacotes / ms) * 1000, bps: ((b.bytes - a.bytes) / ms) * 8000, bytesPorPacote: pacotes ? (b.bytes - a.bytes) / pacotes : 0, quadros, fmtp }
}

async function abrirBruno(srv) {
  const browser = await chromium.launch({ headless: true, args: ARGS })
  const ctx = await browser.newContext({ locale: "pt-PT", permissions: ["microphone"], viewport: { width: 1280, height: 860 } })
  await ctx.addInitScript(SONDA)
  const page = await ctx.newPage()
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(page)
  return { browser, page }
}

async function correrNoBrowser(modo) {
  const rotulo = `browser ${modo}`
  console.log(`\n== A Ana e o Bruno no Chromium, por ${modo === "sfu" ? "SFU" : "malha"}`)
  const srv = await levantarServidor({ frente: 8506, servidor: 8507, sfu: modo === "sfu" ? 8508 : 0, etiqueta: `limiar-${modo}` })
  const browsers = []
  try {
    const browser = await chromium.launch({ headless: true, args: ARGS })
    browsers.push(browser)
    const ctx = await browser.newContext({ locale: "pt-PT", permissions: ["microphone"], viewport: { width: 1280, height: 860 } })
    await ctx.addInitScript(MICROFONE_SINTETICO)
    await ctx.addInitScript(SONDA)
    const ana = await ctx.newPage()
    await ana.goto(srv.APP, { waitUntil: "domcontentloaded" })
    await criarConta(ana, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
    await dentro(ana)
    const bruno = await abrirBruno(srv)
    browsers.push(bruno.browser)
    await ensaio(rotulo, ana, bruno.page, srv, { sfu: modo === "sfu" })
  } catch (erro) {
    check(`[${rotulo}] a corrida chegou ao fim`, false, String(erro?.message ?? erro).split("\n")[0])
  } finally {
    for (const b of browsers) await b.close().catch(() => {})
    srv.fechar()
    await dormir(1000)
  }
}

async function correrNaSecretaria() {
  const rotulo = "secretaria"
  console.log("\n== A Ana na app de secretária, o Bruno no Chromium (malha)")
  const { abrirSecretaria } = await import("./secretaria.mjs")
  const srv = await levantarServidor({ frente: 8509, servidor: 8510, sfu: 0, etiqueta: "limiar-secretaria" })
  let sec
  let bruno
  try {
    sec = await abrirSecretaria({ rotulo: "ana" })
    const ana = sec.page
    await portaoPronto(ana)
    await ana.addInitScript(MICROFONE_SINTETICO)
    await ana.addInitScript(SONDA)
    await ana.reload()
    await criarConta(ana, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
    await dentro(ana)
    bruno = await abrirBruno(srv)
    await ensaio(rotulo, ana, bruno.page, srv, { sfu: false })
    const erros = sec.registo.filter((l) => l.includes("PAGEERROR"))
    check(`[${rotulo}] nenhum erro de página na app`, erros.length === 0, erros[0]?.slice(0, 160) ?? "")
  } catch (erro) {
    check(`[${rotulo}] a corrida chegou ao fim`, false, String(erro?.message ?? erro).split("\n")[0])
    console.log("--- registo da app (fim) ---\n" + (sec?.registo ?? []).slice(-30).join("\n"))
  } finally {
    await sec?.fechar().catch(() => {})
    await bruno?.browser.close().catch(() => {})
    srv.fechar()
  }
}

for (const corrida of CORRIDAS) {
  if (corrida === "browser-sfu") await correrNoBrowser("sfu")
  else if (corrida === "browser-malha") await correrNoBrowser("malha")
  else if (corrida === "secretaria") await correrNaSecretaria()
  else throw new Error(`corrida desconhecida: ${corrida}`)
}

process.exit(resumo() ? 0 : 1)
