/**
 * Does someone who joins a call late hear the people who were already there?
 *
 * ```
 * npm run build && node scripts/e2e-audio-quem-entra-tarde.mjs           # tudo
 * node scripts/e2e-audio-quem-entra-tarde.mjs --so sfu-tarde             # one run
 * node scripts/e2e-audio-quem-entra-tarde.mjs --motores chromium,firefox,chromium   # A, B e C
 * ```
 *
 * **The report (3/11/2026).** An agent that was taking screenshots with 40 contas saw
 * this: someone who joins a call that already has people does not hear who was
 * there; their audio arrives almost empty and the level stays at 0; they
 * only hear people who join after them. This script reproduces the case with
 * three accounts and stable synthetic audio.
 *
 * **The runs.** `<modo>-<ordem>`, with `sfu` or `malha` mode and the order:
 *
 *  - `tarde`: Ana and Bruno join the voice room and hear each other; only then
 *    Carla joins. This is the reported case.
 *  - `primeiro`: Carla joins first, and Ana and Bruno follow. This is the
 *    control: the same measurement, with no one joining late.
 *  - `novo`: like `tarde`, but Carla is only invited to the CHANNEL with the
 *    call already running. Her entry into the MLS group changes the epoch, and
 *    with it the SFrame keys (`#acceptWelcome`): this is the key clue.
 *
 * **What you measure, on Carla.** Three phases of 6 s: only Ana talks, only
 * Bruno talks, no one talks. In each one, two independent measurements:
 *
 *  - the `getStats` of each `inbound-rtp` of audio: the bytes that arrived (what
 *    the network brought, still encrypted) and the energy after decrypting and
 *    decoding (`totalAudioEnergy`, Chromium only);
 *  - the RMS level of each remote track, read by a `AnalyserNode` on the
 *    page itself (works in Firefox too). This is what reaches the speaker.
 *
 * Bytes arriving with zero energy means the cipher did not open (the SFrame keys
 * did not arrive). Zero bytes means the SFU or the mesh does not deliver. Both
 * going up means the person is hearing.
 *
 * **The sound is synthetic and changes by script**, like in `e2e-voz-cbr.mjs`: a voice
 * (glottal pulses, formants, syllables, pauses) at -20 dBFS, switched on and off
 * by `window.__definirSom`. We do not use the fake microphone beep (a pure tone
 * that noise reduction kills) or `--use-file-for-fake-audio-capture`.
 *
 * All local and disposable (`servidor-descartavel.mjs`). Ports 8551 a 8574.
 * Never production.
 */
import { chromium, firefox } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, ate, contasDoServidor, criarCanal, dentro, entrarNaVoz, portaoPronto, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ as RAIZ_DO_REPO } from "./servidor-descartavel.mjs"

const arg = (nome) => (process.argv.includes(nome) ? process.argv[process.argv.indexOf(nome) + 1] : null)
const so = arg("--so")
const MOTORES = (arg("--motores") ?? "chromium,chromium,chromium").split(",")
const TODAS = ["sfu-tarde", "sfu-primeiro", "sfu-novo", "malha-tarde", "malha-primeiro", "malha-novo"]
const CORRIDAS = so ? so.split(",") : TODAS
const FRASE = "frase-de-verificacao-2026"
const CANAL = "ensaio"
const JANELA = 6000
/** Below this is silence: the decoder filling in, or nothing. */
const OUVE_DB = -45

const { check, resumo } = verificador()
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The synthetic mic, in the page world, before the application. The voice from
 * `e2e-voz-cbr.mjs`, 8 s in a loop; `window.__definirSom("voz" | "silencio")`.
 */
const MICROFONE_SINTETICO = () => {
  const TAXA = 48000
  function voz(segundos) {
    const n = Math.round(segundos * TAXA)
    const formantes = [[700, 1220, 2600], [300, 2300, 3000], [500, 1000, 2500], [400, 1700, 2400], [600, 900, 2200]]
    const estado = [[0, 0], [0, 0], [0, 0]]
    const x = new Float32Array(n)
    let fase = 0
    for (let i = 0; i < n; i++) {
      const t = i / TAXA
      const silaba = 0.18 + (0.12 * ((Math.floor(t / 0.3) * 7) % 5)) / 4
      const f0 = 110 + 40 * Math.sin(2 * Math.PI * 0.4 * t) + 10 * Math.sin(2 * Math.PI * 5 * t)
      fase += f0 / TAXA
      if (fase >= 1) fase -= 1
      const fonte = (fase < 0.4 ? Math.sin((Math.PI * fase) / 0.4) : 0) - 0.25
      const F = formantes[Math.floor(t / silaba) % formantes.length]
      let y = 0
      for (let j = 0; j < 3; j++) {
        const r = Math.exp((-Math.PI * (80 + 40 * j)) / TAXA)
        const a1 = 2 * r * Math.cos((2 * Math.PI * F[j]) / TAXA)
        const e = estado[j]
        const v = fonte * (1 - r) + a1 * e[0] - r * r * e[1]
        e[1] = e[0]
        e[0] = v
        y += v / (j + 1)
      }
      const emFala = t % 2 < 1.4
      x[i] = emFala ? y * Math.pow(Math.sin(Math.PI * ((t % silaba) / silaba)), 0.6) : 0
    }
    let soma = 0
    let k = 0
    for (let i = 0; i < n; i++) if ((i / TAXA) % 2 < 1.4) (soma += x[i] * x[i]), k++
    const escala = 10 ** (-20 / 20) / Math.sqrt(soma / Math.max(1, k))
    for (let i = 0; i < n; i++) x[i] *= escala
    return x
  }
  let grafo = null
  const montar = () => {
    if (grafo) return grafo
    const ctx = new AudioContext({ sampleRate: TAXA })
    const buffer = ctx.createBuffer(1, 8 * TAXA, TAXA)
    buffer.copyToChannel(voz(8), 0)
    const fonte = ctx.createBufferSource()
    fonte.buffer = buffer
    fonte.loop = true
    const ganho = ctx.createGain()
    ganho.gain.value = 0
    fonte.connect(ganho)
    fonte.start()
    grafo = { ctx, ganho }
    window.__definirSom(window.__som ?? "silencio")
    return grafo
  }
  window.__definirSom = (tipo) => {
    window.__som = tipo
    if (grafo) grafo.ganho.gain.value = tipo === "voz" ? 1 : 0
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

/**
 * The probes: each `RTCPeerConnection` when born, and each remote audio track
 * wired to a `AnalyserNode` that sums the square of the samples of 50 em 50 ms.
 */
const SONDA = () => {
  window.__pcs = []
  window.__niveis = {}
  let ctx = null
  const medir = (faixa) => {
    if (faixa.kind !== "audio" || window.__niveis[faixa.id]) return
    ctx ??= new AudioContext()
    ctx.resume().catch(() => {})
    const fonte = ctx.createMediaStreamSource(new MediaStream([faixa]))
    const analisador = ctx.createAnalyser()
    analisador.fftSize = 2048
    fonte.connect(analisador)
    const amostras = new Float32Array(analisador.fftSize)
    const nivel = { soma: 0, n: 0, nasceu: performance.now() }
    window.__niveis[faixa.id] = nivel
    setInterval(() => {
      analisador.getFloatTimeDomainData(amostras)
      let s = 0
      for (const v of amostras) s += v * v
      nivel.soma += s / amostras.length
      nivel.n++
    }, 50)
  }
  const Original = window.RTCPeerConnection
  window.RTCPeerConnection = function (...argumentos) {
    const pc = new Original(...argumentos)
    window.__pcs.push(pc)
    pc.addEventListener("track", (e) => medir(e.track))
    return pc
  }
  window.RTCPeerConnection.prototype = Original.prototype
  Object.setPrototypeOf(window.RTCPeerConnection, Original)
}

/** A snapshot of what the page receives: by `inbound-rtp` and by track. */
const LER = async () => {
  const fluxos = {}
  for (const pc of window.__pcs ?? []) {
    if (pc.connectionState === "closed") continue
    const relatorio = await pc.getStats().catch(() => null)
    relatorio?.forEach((r) => {
      if (r.type !== "inbound-rtp" || r.kind !== "audio") return
      fluxos[`${r.id}`] = { faixa: r.trackIdentifier ?? "", bytes: r.bytesReceived ?? 0, pacotes: r.packetsReceived ?? 0, energia: r.totalAudioEnergy ?? null, duracao: r.totalSamplesDuration ?? null, descodificados: r.packetsDiscarded ?? 0 }
    })
  }
  const niveis = Object.fromEntries(Object.entries(window.__niveis ?? {}).map(([id, v]) => [id, { soma: v.soma, n: v.n }]))
  return { agora: performance.now(), fluxos, niveis }
}

/**
 * What the interface shows: the `--voz` (0 a 1) that the card meter
 * writes (`useNivelDeVoz`). Read the maximum of each card, from 100 em 100 ms.
 */
const CARTOES_DE_NOVO = () => {
  clearInterval(window.__cartoesRelogio)
  window.__cartoes = {}
  window.__cartoesRelogio = setInterval(() => {
    for (const cartao of document.querySelectorAll(".call-chip")) {
      const nome = cartao.querySelector(".call-chip-name")?.textContent?.trim() ?? "?"
      const voz = Number(getComputedStyle(cartao).getPropertyValue("--voz").trim() || 0)
      window.__cartoes[nome] = Math.max(window.__cartoes[nome] ?? 0, voz)
    }
  }, 100)
}
const CARTOES_LER = () => ({ ...window.__cartoes })

/** For when nothing is heard: the state of each connection and the stats types it has. */
const DIAG_PCS = async () =>
  Promise.all(
    (window.__pcs ?? []).map(async (pc) => {
      const tipos = {}
      ;(await pc.getStats().catch(() => null))?.forEach((r) => {
        const k = r.kind ? `${r.type}:${r.kind}` : r.type
        tipos[k] = (tipos[k] ?? 0) + 1
      })
      return { ligacao: pc.connectionState, ice: pc.iceConnectionState, sinal: pc.signalingState, tipos, receptores: pc.getReceivers().map((x) => `${x.track?.kind}:${x.track?.readyState}:${x.track?.muted ? "muda" : "som"}`) }
    }),
  )

const db = (potencia) => (potencia > 0 ? 10 * Math.log10(potencia) : -Infinity)

/** What changed between two snapshots: the best flow and the best track. */
function diferenca(a, b) {
  const seg = (b.agora - a.agora) / 1000
  const fluxos = Object.entries(b.fluxos).map(([id, f]) => {
    const antes = a.fluxos[id] ?? { bytes: 0, pacotes: 0, energia: 0, duracao: 0 }
    const energia = f.energia === null ? null : db((f.energia - (antes.energia ?? 0)) / Math.max(1e-9, f.duracao - (antes.duracao ?? 0)))
    return { id, kbps: ((f.bytes - antes.bytes) * 8) / seg / 1000, pps: (f.pacotes - antes.pacotes) / seg, energia }
  })
  const faixas = Object.entries(b.niveis).map(([id, n]) => {
    const antes = a.niveis[id] ?? { soma: 0, n: 0 }
    return { id, nivel: db((n.soma - antes.soma) / Math.max(1, n.n - antes.n)) }
  })
  const maxEnergia = Math.max(-Infinity, ...fluxos.map((f) => f.energia ?? -Infinity))
  const maxNivel = Math.max(-Infinity, ...faixas.map((f) => f.nivel))
  return { fluxos, faixas, maxEnergia, maxNivel }
}

const f1 = (v) => (v === null ? "n/d" : Number.isFinite(v) ? v.toFixed(1) : "-inf")

async function fase(titulo, falantes, calados, ouvinte) {
  await Promise.all(falantes.map((p) => p.evaluate(() => window.__definirSom("voz"))))
  await Promise.all(calados.map((p) => p.evaluate(() => window.__definirSom("silencio"))))
  await dormir(1500)
  const a = await ouvinte.evaluate(LER)
  await ouvinte.evaluate(CARTOES_DE_NOVO)
  await dormir(JANELA)
  const b = await ouvinte.evaluate(LER)
  const d = diferenca(a, b)
  d.cartoes = await ouvinte.evaluate(CARTOES_LER)
  console.log(`     ${titulo}: energia máx ${f1(d.maxEnergia)} dB, nível máx ${f1(d.maxNivel)} dB, --voz máx nos cartões ${JSON.stringify(d.cartoes)}`)
  for (const f of d.fluxos) console.log(`       fluxo ${f.id.slice(-12)}: ${f.kbps.toFixed(1)} kbit/s, ${f.pps.toFixed(1)} pacotes/s, energia ${f1(f.energia)} dB`)
  for (const f of d.faixas) console.log(`       faixa ${f.id.slice(0, 8)}: nível ${f1(f.nivel)} dB`)
  return d
}

/** What counts as "hearing": the decoded energy (Chromium) or the level on the page. */
const ouve = (d) => Math.max(d.maxEnergia, d.maxNivel) > OUVE_DB

async function abrirPessoa(srv, nome, motor) {
  if (motor === "secretaria") {
    // The real desktop app (`secretaria.mjs`), as in `e2e-voz-cbr.mjs`. One per run.
    const { abrirSecretaria } = await import("./secretaria.mjs")
    const sec = await abrirSecretaria({ rotulo: nome.toLowerCase() })
    const page = sec.page
    await portaoPronto(page)
    await page.addInitScript(MICROFONE_SINTETICO)
    await page.addInitScript(SONDA)
    await page.reload()
    await criarConta(page, { nome, frase: FRASE, servidor: srv.NOME })
    await dentro(page)
    const erros = []
    page.on("pageerror", (e) => erros.push(String(e?.message ?? e)))
    return { browser: { close: () => sec.fechar() }, page, erros, nome, motor }
  }
  const browser =
    motor === "firefox"
      ? await firefox.launch({
          headless: true,
          /*
            Playwright's Firefox does not gather ICE candidates on 127.0.0.1, not even with
            `media.peerconnection.ice.loopback` (tested 3/11/2026: only local network IP comes out).
            The disposable SFU listens and announces on 127.0.0.1, so Firefox DOES NOT connect
            to the SFU in this script: mesh only.
            `obfuscate_host_addresses` removes mDNS names, which Chromium does not resolve.
          */
          firefoxUserPrefs: { "media.peerconnection.ice.loopback": true, "media.peerconnection.ice.obfuscate_host_addresses": false, "media.navigator.permission.disabled": true, "media.navigator.streams.fake": true, "media.autoplay.default": 0, "media.autoplay.block-webaudio": false },
        })
      : await chromium.launch({
          headless: true,
          // Without mDNS names (`*.local`) in candidates: Playwright's Firefox
          // does not resolve them, and the mesh between the two engines would not connect.
          args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--disable-features=WebRtcHideLocalIpsWithMdns"],
        })
  const ctx = await browser.newContext({ locale: "pt-PT", ...(motor === "firefox" ? {} : { permissions: ["microphone"] }), viewport: { width: 1280, height: 860 } })
  await ctx.addInitScript(MICROFONE_SINTETICO)
  await ctx.addInitScript(SONDA)
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e?.message ?? e)))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome, frase: FRASE, servidor: srv.NOME })
  await dentro(page)
  return { browser, page, erros, nome, motor }
}

async function entrar(r, pessoa) {
  const page = pessoa.page
  await page.keyboard.press("Escape").catch(() => {})
  await abrirCanal(page, CANAL)
  check(r(`${pessoa.nome} entra na sala de voz`), await entrarNaVoz(page))
  await page.locator(".call-barra").waitFor({ timeout: 30_000 })
}

/** Until the listener hears the speaker (energy or level above threshold in a 1 s window). Returns ms, or -1. */
async function ateOuvir(falante, outros, ouvinte, ms = 30_000) {
  await falante.evaluate(() => window.__definirSom("voz"))
  await Promise.all(outros.map((p) => p.evaluate(() => window.__definirSom("silencio"))))
  return ate(async () => {
    const a = await ouvinte.evaluate(LER)
    await dormir(1000)
    const b = await ouvinte.evaluate(LER)
    return ouve(diferenca(a, b))
  }, ms, 200)
}

const TABELA = []
let porta = 8551

async function correr(corrida) {
  const [modo, ordem] = corrida.split("-")
  if (!["sfu", "malha"].includes(modo) || !["tarde", "primeiro", "novo"].includes(ordem)) throw new Error(`corrida desconhecida: ${corrida}`)
  const rotulo = `${corrida} (${MOTORES.join("/")})`
  const r = (texto) => `[${rotulo}] ${texto}`
  console.log(`\n== ${rotulo}`)
  const srv = await levantarServidor({ frente: porta, servidor: porta + 1, sfu: modo === "sfu" ? porta + 2 : 0, etiqueta: `entra-tarde-${corrida}` })
  porta += 3
  const pessoas = []
  try {
    const ana = await abrirPessoa(srv, "Ana", MOTORES[0])
    pessoas.push(ana)
    const bruno = await abrirPessoa(srv, "Bruno", MOTORES[1])
    pessoas.push(bruno)
    const carla = await abrirPessoa(srv, "Carla", MOTORES[2])
    pessoas.push(carla)
    const [, endBruno, endCarla] = contasDoServidor(srv.base)
    await criarCanal(ana.page, CANAL)
    check(r("a Ana convida o Bruno"), await convidar(ana.page, CANAL, endBruno))
    check(r("o Bruno entra no canal"), await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))
    const convidarCarla = async () => {
      check(r("a Ana convida a Carla"), await convidar(ana.page, CANAL, endCarla))
      check(r("a Carla entra no canal"), await aceitarConvite(carla.page, CANAL, { espera: 60_000 }))
    }
    if (ordem !== "novo") await convidarCarla()

    if (ordem === "primeiro") await entrar(r, carla)
    await entrar(r, ana)
    await entrar(r, bruno)
    const tAB = await ateOuvir(ana.page, [bruno.page], bruno.page)
    check(r("o Bruno ouve a Ana"), tAB >= 0, `${tAB} ms`)
    if (tAB < 0) for (const p of [ana, bruno]) console.log(`     ${p.nome} (${p.motor}) ligações: ${JSON.stringify(await p.page.evaluate(DIAG_PCS))}`)
    const tBA = await ateOuvir(bruno.page, [ana.page], ana.page)
    check(r("a Ana ouve o Bruno"), tBA >= 0, `${tBA} ms`)
    if (ordem === "tarde" || ordem === "novo") {
      // The conversation is already underway: Ana and Bruno are speaking while Carla joins.
      await Promise.all([ana, bruno].map((p) => p.page.evaluate(() => window.__definirSom("voz"))))
      // `novo`: Carla only enters the CHANNEL now, with the call running. The
      // MLS group shifts epoch, and the SFrame keys with it.
      if (ordem === "novo") await convidarCarla()
      await dormir(3000)
      await entrar(r, carla)
    }
    // How long until Carla hears each person, counting from here (already in the call).
    const tCA = await ateOuvir(ana.page, [bruno.page], carla.page)
    const tCB = await ateOuvir(bruno.page, [ana.page], carla.page)
    console.log(`     a Carla ouviu a Ana ao fim de ${tCA} ms, e o Bruno ao fim de ${tCB} ms (-1 = nunca, em 30 s)`)
    const soAna = await fase("só a Ana fala", [ana.page], [bruno.page], carla.page)
    const soBruno = await fase("só o Bruno fala", [bruno.page], [ana.page], carla.page)
    const ninguem = await fase("ninguém fala", [], [ana.page, bruno.page], carla.page)
    check(r("a Carla ouve a Ana"), ouve(soAna), `energia ${f1(soAna.maxEnergia)} dB, nível ${f1(soAna.maxNivel)} dB`)
    check(r("a Carla ouve o Bruno"), ouve(soBruno), `energia ${f1(soBruno.maxEnergia)} dB, nível ${f1(soBruno.maxNivel)} dB`)
    const cartao = (d, nome) => Object.entries(d.cartoes).find(([k]) => k.startsWith(nome))?.[1] ?? 0
    check(r("o cartão da Ana acende na Carla quando ela fala (--voz máx > 0,05)"), cartao(soAna, "Ana") > 0.05, String(cartao(soAna, "Ana")))
    check(r("o cartão do Bruno acende na Carla quando ele fala"), cartao(soBruno, "Bruno") > 0.05, String(cartao(soBruno, "Bruno")))
    check(r("e mede silêncio quando ninguém fala"), !ouve(ninguem), `energia ${f1(ninguem.maxEnergia)} dB, nível ${f1(ninguem.maxNivel)} dB`)
    // And the other way: those who were there hear who joined.
    const tAC = await ateOuvir(carla.page, [ana.page, bruno.page], ana.page)
    check(r("a Ana ouve a Carla"), tAC >= 0, `${tAC} ms`)
    const erros = pessoas.flatMap((p) => p.erros.map((e) => `${p.nome}: ${e}`))
    check(r("nenhum erro de página"), erros.length === 0, erros[0]?.slice(0, 200) ?? "")
    TABELA.push({ rotulo, tCA, tCB, soAna, soBruno, ninguem })
  } catch (erro) {
    check(r("a corrida chegou ao fim"), false, String(erro?.message ?? erro).split("\n")[0])
  } finally {
    for (const p of pessoas.reverse()) await p.browser.close().catch(() => {})
    srv.fechar()
    await dormir(1000)
  }
}

/**
 * The screenshot agent method, as `retratar-midnight.mjs` does it:
 * ONE Chromium for all accounts (each in its own context), the fake mic reading
 * a WAV via `--use-file-for-fake-audio-capture` (the voice from `audio-sintetico.ts`,
 * 12 s in a loop, at -30 dBFS), and nobody mutes: the WAV plays always, on all
 * accounts. Measured on Carla are each remote track and the `--voz` of each card,
 * with Carla joining late.
 */
async function correrComoAsCapturas(modo) {
  const rotulo = `capturas ${modo}-tarde`
  const r = (texto) => `[${rotulo}] ${texto}`
  console.log(`\n== ${rotulo}: um Chromium, contextos, WAV em ciclo`)
  const srv = await levantarServidor({ frente: porta, servidor: porta + 1, sfu: modo === "sfu" ? porta + 2 : 0, etiqueta: `entra-tarde-capturas-${modo}` })
  porta += 3
  let browser = null
  try {
    const { pathToFileURL } = await import("node:url")
    const { join } = await import("node:path")
    const { writeFileSync } = await import("node:fs")
    const S = await import(pathToFileURL(join(RAIZ_DO_REPO, "packages/client-core/testes/audio-sintetico.ts")).href)
    const amostras = S.normalizar(S.voz(12), -30)
    const corpo = Buffer.alloc(amostras.length * 2)
    for (let i = 0; i < amostras.length; i++) corpo.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(amostras[i] * 32767))), i * 2)
    const cab = Buffer.alloc(44)
    cab.write("RIFF", 0); cab.writeUInt32LE(36 + corpo.length, 4); cab.write("WAVEfmt ", 8); cab.writeUInt32LE(16, 16)
    cab.writeUInt16LE(1, 20); cab.writeUInt16LE(1, 22); cab.writeUInt32LE(S.TAXA, 24); cab.writeUInt32LE(S.TAXA * 2, 28)
    cab.writeUInt16LE(2, 32); cab.writeUInt16LE(16, 34); cab.write("data", 36); cab.writeUInt32LE(corpo.length, 40)
    const wav = join(srv.dados, "voz.wav")
    writeFileSync(wav, Buffer.concat([cab, corpo]))
    browser = await chromium.launch({
      headless: true,
      args: ["--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    })
    const pessoa = async (nome) => {
      const ctx = await browser.newContext({ locale: "pt-PT", permissions: ["microphone"], viewport: { width: 1280, height: 860 } })
      await ctx.addInitScript(SONDA)
      const page = await ctx.newPage()
      const erros = []
      page.on("pageerror", (e) => erros.push(String(e?.message ?? e)))
      await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
      await criarConta(page, { nome, frase: FRASE, servidor: srv.NOME })
      await dentro(page)
      return { page, erros, nome }
    }
    // `--pessoas N`: N-1 people already in the call (Ana, Bruno and more), and Carla joining late.
    const N = Math.max(3, Number(arg("--pessoas") ?? 3))
    const nomes = ["Ana", "Bruno", ...Array.from({ length: N - 3 }, (_, i) => `Pessoa${i + 1}`)]
    const cedo = []
    for (const nome of nomes) cedo.push(await pessoa(nome))
    const carla = await pessoa("Carla")
    const ana = cedo[0]
    const enderecos = contasDoServidor(srv.base)
    await criarCanal(ana.page, CANAL)
    for (const [i, p] of [...cedo.slice(1), carla].entries()) {
      check(r(`a Ana convida ${p.nome}`), await convidar(ana.page, CANAL, enderecos[i + 1]))
      check(r(`${p.nome} entra no canal`), await aceitarConvite(p.page, CANAL, { espera: 60_000 }))
    }
    for (const p of cedo) await entrar(r, p)
    await dormir(5000)
    await entrar(r, carla)
    await dormir(3000)
    const todos = await fase("na Carla, todos falam (o WAV não pára)", [], [], carla.page)
    const remotasComSom = todos.faixas.filter((f) => f.nivel > OUVE_DB).length
    check(r(`na Carla, as ${cedo.length} faixas remotas de voz têm som`), remotasComSom >= cedo.length, `${remotasComSom} com som: ${todos.faixas.map((f) => f1(f.nivel)).join(", ")}`)
    for (const p of cedo) {
      const voz = Object.entries(todos.cartoes).find(([k]) => k.startsWith(p.nome))?.[1] ?? 0
      check(r(`o cartão de ${p.nome} acende na Carla (--voz máx > 0,05)`), voz > 0.05, String(voz))
    }
    // And those who were there early still hear the others: the sound did not die for everyone.
    const noBruno = await fase("no Bruno, todos falam", [], [], cedo[1].page)
    const noBrunoComSom = noBruno.faixas.filter((f) => f.nivel > OUVE_DB).length
    check(r(`o Bruno ouve as ${cedo.length} outras vozes`), noBrunoComSom >= cedo.length, `${noBrunoComSom} com som`)
    const erros = [...cedo, carla].flatMap((p) => p.erros.map((e) => `${p.nome}: ${e}`))
    check(r("nenhum erro de página"), erros.length === 0, erros[0]?.slice(0, 200) ?? "")
  } catch (erro) {
    check(r("a corrida chegou ao fim"), false, String(erro?.message ?? erro).split("\n")[0])
  } finally {
    await browser?.close().catch(() => {})
    srv.fechar()
    await dormir(1000)
  }
}

if (arg("--metodo") === "capturas") for (const modo of so ? so.split(",") : ["sfu", "malha"]) await correrComoAsCapturas(modo)
else for (const corrida of CORRIDAS) await correr(corrida)

if (TABELA.length) {
  console.log("\n== Resumo, na Carla (energia descodificada / nível na página, em dB)")
  console.log("| corrida | ouviu a Ana (ms) | ouviu o Bruno (ms) | só a Ana | só o Bruno | ninguém |")
}
for (const l of TABELA) {
  const c = (d) => `${f1(d.maxEnergia)} / ${f1(d.maxNivel)}`
  console.log(`| ${l.rotulo} | ${l.tCA} | ${l.tCB} | ${c(l.soAna)} | ${c(l.soBruno)} | ${c(l.ninguem)} |`)
}

process.exit(resumo() ? 0 : 1)
