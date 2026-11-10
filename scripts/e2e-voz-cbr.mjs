/**
 * Constant bitrate for voice (owner, 3/11/2026): while speaking, all voice packets
 * have the same size; in silence DTX keeps cutting transmission.
 *
 * ```
 * npm run build && node scripts/e2e-voz-cbr.mjs                  # everything that needs no fixture
 * node scripts/e2e-voz-cbr.mjs --so browser-sfu                  # Ana and Bruno in Chromium, over SFU
 * node scripts/e2e-voz-cbr.mjs --so browser-malha                # idem, em malha
 * node scripts/e2e-voz-cbr.mjs --so secretaria-malha             # a Ana na app de secretária, o Bruno no Chromium
 * node scripts/e2e-voz-cbr.mjs --so secretaria-sfu
 * ORWELL_DIST_ANTIGO=<apps/web/dist da 1.0.8> node scripts/e2e-voz-cbr.mjs --so antigo-sfu    # o Bruno num cliente 1.0.8
 * ORWELL_DIST_ANTIGO=<...> node scripts/e2e-voz-cbr.mjs --so antigo-malha
 * ```
 *
 * **Why.** In variable bitrate (VBR) Opus makes each packet the size the sound
 * demands, and the sequence of sizes lets you guess phrases with encrypted
 * voice (Wright et al., "Spot me if you can", 2008, and the work that
 * followed on SILK and Opus). In constant bitrate (CBR) all voice packets have
 * the same size, and what you see on the network is just who speaks and when.
 *
 * **What is measured, and where:**
 *
 *  - at the SENDER (Ana), the size of each frame the Opus encoder delivers to
 *    the cipher, captured in `createEncodedStreams` of `RTCRtpSender`;
 *  - at the RECEIVER (Bruno), the size of each frame as it arrives from the
 *    network, still encrypted, captured in `createEncodedStreams` of `RTCRtpReceiver`. This is the payload
 *    that a network observer (or the server) sees;
 *  - Ana's bitrate (`outbound-rtp`), packets per second, and the voice energy that Bruno
 *    hears after decrypting and decoding (`inbound-rtp`).
 *
 * Each run makes two calls: **before** (VBR) and **after** (CBR). The "before"
 * is the same code with `cbr=1` stripped from each remote description before the
 * browser reads it (`setRemoteDescription`), on both sides: it is exactly what happened without
 * this fix, because the browser only enables constant bitrate when the other
 * side's description asks for it. The "before" MUST show varying sizes: that
 * proves the measurement sees the difference.
 *
 * **Ana's sound is synthetic**, and varies: the voice from core tests (glottal
 * pulses, formants, syllables and pauses) from -20 e to -35 dBFS, a tone
 * rising and falling with changing amplitude, noise in bursts, and silence.
 * There is no recorded speech file in the repository.
 *
 * **The runs `antigo-*`** put Bruno in a 1.0.8 client (the served web is the
 * folder `ORWELL_DIST_ANTIGO`) and Ana in the desktop app from this branch. Both directions
 * are measured: Ana speaks to the old one, and the old one speaks to Ana. The
 * `dist` is obtained without worktree: `git archive a1d2bc22 | tar -x -C <pasta>`, and there `npm ci && npx tsc -b && npm run build -w @enclave/web`.
 *
 * All local and disposable (`servidor-descartavel.mjs`). Ports 8521 a 8538.
 * Never production. Nothing is saved to disk beyond the report lines.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, ate, contasDoServidor, criarCanal, dentro, entrarNaVoz, portaoPronto, verificador } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const so = process.argv.includes("--so") ? process.argv[process.argv.indexOf("--so") + 1] : null
const DIST_ANTIGO = process.env.ORWELL_DIST_ANTIGO ?? ""
const TODAS = ["browser-sfu", "browser-malha", "secretaria-malha", "secretaria-sfu", ...(DIST_ANTIGO ? ["antigo-sfu", "antigo-malha"] : [])]
const CORRIDAS = so ? [so] : TODAS
const FRASE = "frase-de-verificacao-2026"
const CANAL = "ensaio"
const ARGS = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
const JANELA = 6000

const { check, resumo } = verificador()
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Synthetic microphone. Runs before the app, in the page world. Four sources in
 * rotation, each with its own gain; `window.__definirSom(tipo, db)` turns one on
 * and the others off. Factory default is all silent.
 */
const MICROFONE_SINTETICO = () => {
  const TAXA = 48000
  const rmsPara = (x, db, conta = () => true) => {
    let soma = 0
    let n = 0
    for (let i = 0; i < x.length; i++) if (conta(i)) (soma += x[i] * x[i]), n++
    const escala = 10 ** (db / 20) / Math.sqrt(soma / Math.max(1, n))
    for (let i = 0; i < x.length; i++) x[i] *= escala
    return x
  }
  function voz(segundos) {
    const n = Math.round(segundos * TAXA)
    const formantes = [[700, 1220, 2600], [300, 2300, 3000], [500, 1000, 2500], [400, 1700, 2400], [600, 900, 2200]]
    const estado = [[0, 0], [0, 0], [0, 0]]
    const x = new Float32Array(n)
    let fase = 0
    for (let i = 0; i < n; i++) {
      const t = i / TAXA
      // Syllables of different duration and pitch, so variable bitrate has to follow.
      const silaba = 0.18 + 0.12 * ((Math.floor(t / 0.3) * 7) % 5) / 4
      const f0 = 110 + 40 * Math.sin(2 * Math.PI * 0.4 * t) + 10 * Math.sin(2 * Math.PI * 5 * t)
      fase += f0 / TAXA
      if (fase >= 1) fase -= 1
      const fonte = (fase < 0.4 ? Math.sin((Math.PI * fase) / 0.4) : 0) - 0.25
      // Fricatives: noise between syllables, sometimes.
      const fricativa = Math.floor(t / silaba) % 3 === 2 ? (Math.random() * 2 - 1) * 0.3 : 0
      const F = formantes[Math.floor(t / silaba) % formantes.length]
      let y = 0
      for (let j = 0; j < 3; j++) {
        const largura = 80 + 40 * j
        const r = Math.exp((-Math.PI * largura) / TAXA)
        const a1 = 2 * r * Math.cos((2 * Math.PI * F[j]) / TAXA)
        const a2 = -r * r
        const e = estado[j]
        const v = (fonte + fricativa) * (1 - r) + a1 * e[0] + a2 * e[1]
        e[1] = e[0]
        e[0] = v
        y += v / (j + 1)
      }
      const emFala = t % 2 < 1.4
      const envelope = emFala ? Math.pow(Math.sin(Math.PI * ((t % silaba) / silaba)), 0.6) : 0
      x[i] = y * envelope
    }
    return rmsPara(x, -20, (i) => (i / TAXA) % 2 < 1.4)
  }
  function tom(segundos) {
    const n = Math.round(segundos * TAXA)
    const x = new Float32Array(n)
    let fase = 0
    for (let i = 0; i < n; i++) {
      const t = i / TAXA
      const f = 300 + 1700 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.25 * t))
      fase += f / TAXA
      x[i] = Math.sin(2 * Math.PI * fase) * (0.55 + 0.45 * Math.sin(2 * Math.PI * 3 * t))
    }
    return rmsPara(x, -20)
  }
  function ruido(segundos) {
    const n = Math.round(segundos * TAXA)
    const x = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / TAXA
      x[i] = (Math.random() * 2 - 1) * (t % 0.7 < 0.4 ? 1 : 0.08)
    }
    return rmsPara(x, -25)
  }

  let grafo = null
  const montar = () => {
    if (grafo) return grafo
    const ctx = new AudioContext({ sampleRate: TAXA })
    const saida = ctx.createGain()
    const ganhos = {}
    for (const [nome, gerar] of [["voz", voz], ["tom", tom], ["ruido", ruido]]) {
      const buffer = ctx.createBuffer(1, 8 * TAXA, TAXA)
      buffer.copyToChannel(gerar(8), 0)
      const fonte = ctx.createBufferSource()
      fonte.buffer = buffer
      fonte.loop = true
      const ganho = ctx.createGain()
      ganho.gain.value = 0
      fonte.connect(ganho)
      ganho.connect(saida)
      fonte.start()
      ganhos[nome] = ganho
    }
    grafo = { ctx, saida, ganhos }
    window.__definirSom(window.__som ?? "silencio", window.__somDb ?? 0)
    return grafo
  }
  /** `tipo` is voice, tone, noise or silence; `db` adjusts from the factory level of each source. */
  window.__definirSom = (tipo, db = 0) => {
    window.__som = tipo
    window.__somDb = db
    if (!grafo) return
    for (const [nome, ganho] of Object.entries(grafo.ganhos)) ganho.gain.value = nome === tipo ? 10 ** (db / 20) : 0
  }
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  const falso = async (pedido) => {
    if (!pedido?.audio) return original(pedido)
    const { ctx, saida } = montar()
    await ctx.resume().catch(() => {})
    const destino = ctx.createMediaStreamDestination()
    destino.channelCount = 1
    saida.connect(destino)
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
 * The probes: connections, caught at birth, and the size of each audio frame at
 * encoder output (sender) and at network arrival (receiver).
 */
const SONDA = () => {
  window.__envio = []
  window.__rececao = []
  const escuta = (prototipo, saco) => {
    const abrir = prototipo?.createEncodedStreams
    if (typeof abrir !== "function") return
    prototipo.createEncodedStreams = function (...argumentos) {
      const fluxos = abrir.apply(this, argumentos)
      if (this.track?.kind !== "audio") return fluxos
      const contador = new TransformStream({
        transform(quadro, controlador) {
          saco.push([performance.now(), quadro.data.byteLength])
          controlador.enqueue(quadro)
        },
      })
      return { readable: fluxos.readable.pipeThrough(contador), writable: fluxos.writable }
    }
  }
  escuta(window.RTCRtpSender?.prototype, window.__envio)
  escuta(window.RTCRtpReceiver?.prototype, window.__rececao)
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

/**
 * The "before": `cbr=1` stripped from each remote description before the browser
 * reads it. What the browser saw without this fix, and the only thing that changes.
 */
const SEM_CBR = () => {
  const definir = RTCPeerConnection.prototype.setRemoteDescription
  RTCPeerConnection.prototype.setRemoteDescription = function (descricao, ...resto) {
    if (descricao?.sdp) {
      const sdp = descricao.sdp.replace(/^(a=fmtp:\d+ .*?);cbr=1(?=;|\r?$)/gm, "$1").replace(/^(a=fmtp:\d+ )cbr=1;?/gm, "$1")
      descricao = { type: descricao.type, sdp }
    }
    return definir.call(this, descricao, ...resto)
  }
}

/** What we read from `getStats` on a page, one time. */
const LER_STATS = async () => {
  const total = { saida: { pacotes: 0, bytes: 0, cabecalhos: 0 }, entrada: { energia: 0, duracao: 0, pacotes: 0 } }
  for (const pc of window.__pcs ?? []) {
    if (pc.connectionState === "closed") continue
    const relatorio = await pc.getStats().catch(() => null)
    relatorio?.forEach((r) => {
      if (r.type === "outbound-rtp" && r.kind === "audio") {
        total.saida.pacotes += r.packetsSent ?? 0
        total.saida.bytes += r.bytesSent ?? 0
        total.saida.cabecalhos += r.headerBytesSent ?? 0
      }
      if (r.type === "inbound-rtp" && r.kind === "audio") {
        total.entrada.energia += r.totalAudioEnergy ?? 0
        total.entrada.duracao += r.totalSamplesDuration ?? 0
        total.entrada.pacotes += r.packetsReceived ?? 0
      }
    })
  }
  return { agora: performance.now(), ...total }
}

/** Opus fmtp in the page's remote descriptions (what its encoder read). */
const FMTP_REMOTO = () =>
  [...new Set((window.__pcs ?? []).flatMap((pc) => (pc.remoteDescription?.sdp ?? "").split("\n").filter((l) => /a=fmtp:\d+ .*(usedtx|useinbandfec)/.test(l)).map((l) => l.trim())))]

const QUADROS_ENTRE = ([saco, de, ate]) => (window[saco] ?? []).filter(([t]) => t >= de && t < ate).map(([, tamanho]) => tamanho)

/** Distribution of a list of sizes. */
function distribuicao(tamanhos) {
  const ordenados = [...tamanhos].sort((a, b) => a - b)
  const n = ordenados.length
  if (n === 0) return { n: 0 }
  const media = ordenados.reduce((s, v) => s + v, 0) / n
  const desvio = Math.sqrt(ordenados.reduce((s, v) => s + (v - media) ** 2, 0) / n)
  const q = (p) => ordenados[Math.min(n - 1, Math.floor(p * n))]
  const contagem = new Map()
  for (const v of ordenados) contagem.set(v, (contagem.get(v) ?? 0) + 1)
  const [moda, naModa] = [...contagem].sort((a, b) => b[1] - a[1])[0]
  return { n, min: ordenados[0], p5: q(0.05), mediana: q(0.5), p95: q(0.95), max: ordenados[n - 1], media, desvio, distintos: contagem.size, moda, naModa: naModa / n, contagem }
}

/** A text histogram, in 4-byte bins. */
function histograma(tamanhos, largura = 4) {
  const caixas = new Map()
  for (const v of tamanhos) {
    const c = Math.floor(v / largura) * largura
    caixas.set(c, (caixas.get(c) ?? 0) + 1)
  }
  const maior = Math.max(...caixas.values())
  return [...caixas]
    .sort((a, b) => a[0] - b[0])
    .map(([c, k]) => `         ${String(c).padStart(4)}-${String(c + largura - 1).padEnd(4)} ${"#".repeat(Math.max(1, Math.round((k / maior) * 40)))} ${k}`)
    .join("\n")
}

const fmt = (d) =>
  d.n === 0
    ? "nenhum quadro"
    : `n=${d.n}, min ${d.min}, p5 ${d.p5}, mediana ${d.mediana}, p95 ${d.p95}, max ${d.max}, média ${d.media.toFixed(1)}, desvio ${d.desvio.toFixed(2)}, ${d.distintos} tamanhos distintos, moda ${d.moda} (${(d.naModa * 100).toFixed(1)} %)`

/** Results from all runs, for the final table. */
const TABELA = []

/**
 * One phase: the speaker turns sound on, waits for the encoder to settle, then
 * measure a window on both sides.
 */
async function fase(titulo, falante, ouvinte, som, db) {
  await falante.evaluate(([tipo, nivel]) => window.__definirSom(tipo, nivel), [som, db])
  await dormir(1500)
  const [aF, aO] = await Promise.all([falante.evaluate(LER_STATS), ouvinte.evaluate(LER_STATS)])
  await dormir(JANELA)
  const [bF, bO] = await Promise.all([falante.evaluate(LER_STATS), ouvinte.evaluate(LER_STATS)])
  const segF = (bF.agora - aF.agora) / 1000
  const envio = await falante.evaluate(QUADROS_ENTRE, ["__envio", aF.agora, bF.agora])
  const rececao = await ouvinte.evaluate(QUADROS_ENTRE, ["__rececao", aO.agora, bO.agora])
  const pacotes = bF.saida.pacotes - aF.saida.pacotes
  const bytes = bF.saida.bytes - aF.saida.bytes
  const cabecalhos = bF.saida.cabecalhos - aF.saida.cabecalhos
  const potencia = (bO.entrada.energia - aO.entrada.energia) / Math.max(1e-9, bO.entrada.duracao - aO.entrada.duracao)
  const medida = {
    titulo,
    som,
    db,
    // DTX silence markers (2 bytes or less) aren't sent: see `quadroDeSilencio`.
    envio: distribuicao(envio.filter((t) => t > 2)),
    marcadores: envio.filter((t) => t <= 2).length / segF,
    envioBruto: envio.filter((t) => t > 2),
    rececao: distribuicao(rececao),
    rececaoBruta: rececao,
    pps: pacotes / segF,
    kbps: (bytes * 8) / segF / 1000,
    kbpsComCabecalhos: ((bytes + cabecalhos) * 8) / segF / 1000,
    ppsNoOuvinte: (bO.entrada.pacotes - aO.entrada.pacotes) / ((bO.agora - aO.agora) / 1000),
    energia: potencia > 0 ? 10 * Math.log10(potencia) : -Infinity,
  }
  console.log(`     ${titulo}: ${medida.pps.toFixed(1)} pacotes/s, ${medida.kbps.toFixed(1)} kbit/s de carga (${medida.kbpsComCabecalhos.toFixed(1)} com cabeçalhos RTP), energia no ouvinte ${medida.energia.toFixed(1)} dB`)
  console.log(`       emissor:  ${fmt(medida.envio)}`)
  console.log(`       receptor: ${fmt(medida.rececao)}`)
  return medida
}

/** Call direction phases: speech with variation, and silence. */
async function sentido(rotulo, modo, falante, ouvinte) {
  const fases = []
  fases.push(await fase("voz a -20 dBFS", falante, ouvinte, "voz", 0))
  fases.push(await fase("voz a -35 dBFS", falante, ouvinte, "voz", -15))
  fases.push(await fase("tom a subir e descer", falante, ouvinte, "tom", 0))
  fases.push(await fase("ruído em rajadas", falante, ouvinte, "ruido", 0))
  const silencio = await fase("silêncio", falante, ouvinte, "silencio", 0)
  const comSom = fases
  const envio = distribuicao(comSom.flatMap((f) => f.envioBruto))
  const rececao = distribuicao(comSom.flatMap((f) => f.rececaoBruta))
  console.log(`     TUDO o que tem som, no emissor:  ${fmt(envio)}`)
  console.log(histograma(comSom.flatMap((f) => f.envioBruto)))
  console.log(`     TUDO o que tem som, no receptor: ${fmt(rececao)}`)
  const linha = { rotulo, modo, fases, silencio, envio, rececao }
  TABELA.push(linha)
  return linha
}

/**
 * A call between Ana and Bruno, both with accounts on the same server, through
 * to the voice room. Returns when one person's audio reaches the other.
 */
async function chamada(r, ana, bruno, srv) {
  const [, enderecoBruno] = contasDoServidor(srv.base)
  await criarCanal(ana, CANAL)
  check(r("a Ana convida o Bruno"), await convidar(ana, CANAL, enderecoBruno))
  check(r("o Bruno entra no canal"), await aceitarConvite(bruno, CANAL, { espera: 60_000 }))
  for (const page of [ana, bruno]) {
    await page.keyboard.press("Escape").catch(() => {})
    await abrirCanal(page, CANAL)
    check(r(`${page === ana ? "a Ana" : "o Bruno"} entra na sala de voz`), await entrarNaVoz(page))
    await page.locator(".call-barra").waitFor({ timeout: 30_000 })
  }
  await ana.evaluate(() => window.__definirSom("voz", 0))
  const ligado = await ate(async () => {
    const a = await bruno.evaluate(LER_STATS)
    await dormir(800)
    const b = await bruno.evaluate(LER_STATS)
    return b.entrada.duracao - a.entrada.duracao > 0.4 && b.entrada.energia > a.entrada.energia
  }, 60_000, 500)
  check(r("o áudio da Ana chega ao Bruno"), ligado >= 0)
  // The encoder settles in: the first few seconds of a connection have congestion control ramping up.
  await dormir(3000)
}

/** Checks for one measured direction, with what each mode should produce. */
function verificar(r, linha, { cbr }) {
  const { envio, rececao, silencio, fases } = linha
  const fala = fases[0]
  if (cbr) {
    // Constant bitrate: almost all frames with sound at the same size, across all phases.
    check(r("CBR: no emissor, 97 % ou mais dos quadros com som têm o mesmo tamanho"), envio.naModa >= 0.97, fmt(envio))
    check(r("CBR: e no receptor, o que a rede mostra, também"), rececao.naModa >= 0.97, fmt(rececao))
    const modas = new Set(fases.map((f) => f.envio.moda))
    check(r("CBR: o mesmo tamanho na voz forte, na fraca, no tom e no ruído"), modas.size === 1, [...modas].join(", "))
  } else {
    // The baseline: sizes follow the speech. This proves the measurement catches the difference.
    check(r("VBR (antes): os tamanhos variam com o som"), envio.desvio > 5 && envio.distintos > 15, fmt(envio))
  }
  check(r("DTX: em silêncio saem 5 pacotes/s ou menos"), silencio.pps <= 5, `${silencio.pps.toFixed(1)} pacotes/s, ${silencio.kbps.toFixed(2)} kbit/s`)
  check(r("DTX: e com voz sai a voz"), fala.pps >= 30, `${fala.pps.toFixed(1)} pacotes/s`)
  check(r("o ouvinte ouve a voz"), fala.energia > -45, `${fala.energia.toFixed(1)} dB`)
  check(r("e mede silêncio quando não há voz"), silencio.energia < -70, `${silencio.energia.toFixed(1)} dB`)
}

async function abrirNoBrowser(srv, nome, { semCbr }) {
  const browser = await chromium.launch({ headless: true, args: ARGS })
  const ctx = await browser.newContext({ locale: "pt-PT", permissions: ["microphone"], viewport: { width: 1280, height: 860 } })
  await ctx.addInitScript(MICROFONE_SINTETICO)
  await ctx.addInitScript(SONDA)
  if (semCbr) await ctx.addInitScript(SEM_CBR)
  const page = await ctx.newPage()
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome, frase: FRASE, servidor: srv.NOME })
  await dentro(page)
  return { browser, page }
}

async function abrirNaSecretaria(srv, { semCbr }) {
  const { abrirSecretaria } = await import("./secretaria.mjs")
  const sec = await abrirSecretaria({ rotulo: "ana" })
  const ana = sec.page
  await portaoPronto(ana)
  await ana.addInitScript(MICROFONE_SINTETICO)
  await ana.addInitScript(SONDA)
  if (semCbr) await ana.addInitScript(SEM_CBR)
  await ana.reload()
  await criarConta(ana, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana)
  return sec
}

let porta = 8521
const portas = (sfu) => {
  const p = { frente: porta, servidor: porta + 1, sfu: sfu ? porta + 2 : 0 }
  porta += 3
  return p
}

/** A run, before and after: `where` is browser or desktop, `mode` is sfu or mesh. */
async function correr(onde, modo) {
  for (const semCbr of [true, false]) {
    const rotulo = `${onde} ${modo} ${semCbr ? "antes (VBR)" : "depois (CBR)"}`
    const r = (texto) => `[${rotulo}] ${texto}`
    console.log(`\n== ${rotulo}`)
    const srv = await levantarServidor({ ...portas(modo === "sfu"), etiqueta: `voz-cbr-${onde}-${modo}` })
    const fechar = []
    try {
      let ana
      if (onde === "secretaria") {
        const sec = await abrirNaSecretaria(srv, { semCbr })
        fechar.push(() => sec.fechar())
        ana = sec.page
      } else {
        const a = await abrirNoBrowser(srv, "Ana", { semCbr })
        fechar.push(() => a.browser.close())
        ana = a.page
      }
      const bruno = await abrirNoBrowser(srv, "Bruno", { semCbr })
      fechar.push(() => bruno.browser.close())
      await chamada(r, ana, bruno.page, srv)
      console.log(`     fmtp que o codificador da Ana leu: ${(await ana.evaluate(FMTP_REMOTO)).join(" | ")}`)
      const linha = await sentido(rotulo, modo, ana, bruno.page)
      verificar(r, linha, { cbr: !semCbr })
    } catch (erro) {
      check(r("a corrida chegou ao fim"), false, String(erro?.message ?? erro).split("\n")[0])
    } finally {
      for (const f of fechar.reverse()) await f().catch(() => {})
      srv.fechar()
      await dormir(1000)
    }
  }
}

/**
 * Compatibility: Bruno on client 1.0.8, Ana on this branch (desktop app).
 * Both directions: `cbr` is a request to the encoder of the one SENDING, and
 * the receiver decodes the same way.
 */
async function correrComAntigo(modo) {
  const rotulo = `antigo ${modo}`
  const r = (texto) => `[${rotulo}] ${texto}`
  console.log(`\n== A Ana neste ramo (secretária), o Bruno num cliente 1.0.8, por ${modo === "sfu" ? "SFU" : "malha"}`)
  if (!existsSync(join(DIST_ANTIGO, "index.html"))) {
    check(r("há fixtura do cliente antigo"), false, `ORWELL_DIST_ANTIGO=${DIST_ANTIGO || "(vazio)"}`)
    return
  }
  const srv = await levantarServidor({ ...portas(modo === "sfu"), dist: DIST_ANTIGO, etiqueta: `voz-cbr-antigo-${modo}` })
  const fechar = []
  try {
    const sec = await abrirNaSecretaria(srv, { semCbr: false })
    fechar.push(() => sec.fechar())
    const ana = sec.page
    const bruno = await abrirNoBrowser(srv, "Bruno", { semCbr: false })
    fechar.push(() => bruno.browser.close())
    await chamada(r, ana, bruno.page, srv)
    console.log(`     fmtp que o codificador da Ana leu: ${(await ana.evaluate(FMTP_REMOTO)).join(" | ")}`)
    console.log(`     fmtp que o codificador do Bruno (1.0.8) leu: ${(await bruno.page.evaluate(FMTP_REMOTO)).join(" | ")}`)

    console.log("   -- a Ana fala, o Bruno (1.0.8) ouve")
    const daAna = await sentido(`${rotulo}: a Ana fala`, modo, ana, bruno.page)
    check(r("o 1.0.8 ouve a voz da Ana"), daAna.fases[0].energia > -45, `${daAna.fases[0].energia.toFixed(1)} dB`)
    if (modo === "sfu") {
      check(r("por SFU a Ana envia em CBR para o 1.0.8 (o pedido vem do router)"), daAna.envio.naModa >= 0.97, fmt(daAna.envio))
      check(r("e o silêncio dela continua cortado"), daAna.silencio.pps <= 5, `${daAna.silencio.pps.toFixed(1)} pacotes/s`)
    } else {
      /*
        In mesh, the one asking for CBR and DTX is the description from the OTHER
        side, and the 1.0.8 version asks for neither: for him Ana sends as she did
        before M1 (VBR, 50 packets/s in silence). This is the limitation M1 already
        wrote in `comDtxNoOpus`, and it goes away when the other side updates.
      */
      console.log(`     (em malha, para o 1.0.8 a Ana envia como antes: ${fmt(daAna.envio)}; ${daAna.silencio.pps.toFixed(1)} pacotes/s em silêncio)`)
    }

    await ana.evaluate(() => window.__definirSom("silencio", 0))
    console.log("   -- o Bruno (1.0.8) fala, a Ana ouve")
    const doBruno = await sentido(`${rotulo}: o Bruno (1.0.8) fala`, modo, bruno.page, ana)
    check(r("a Ana ouve a voz do 1.0.8"), doBruno.fases[0].energia > -45, `${doBruno.fases[0].energia.toFixed(1)} dB`)
    // The 1.0.8 version has no M1 (its sender sends silence markers): 50 packets/s in silence, as it always has.
    console.log(`     (o 1.0.8 em silêncio: ${doBruno.silencio.pps.toFixed(1)} pacotes/s, sem a M1, como antes)`)
    // The 1.0.8 version reads cbr=1: via SFU in the router, in mesh via Ana's description.
    check(r("o 1.0.8 também passa a enviar em CBR"), doBruno.envio.naModa >= 0.97, fmt(doBruno.envio))
    const erros = sec.registo.filter((l) => l.includes("PAGEERROR"))
    check(r("nenhum erro de página na app"), erros.length === 0, erros[0]?.slice(0, 160) ?? "")
  } catch (erro) {
    check(r("a corrida chegou ao fim"), false, String(erro?.message ?? erro).split("\n")[0])
  } finally {
    for (const f of fechar.reverse()) await f().catch(() => {})
    srv.fechar()
    await dormir(1000)
  }
}

for (const corrida of CORRIDAS) {
  const [onde, modo] = corrida.split("-")
  if (!["sfu", "malha"].includes(modo)) throw new Error(`corrida desconhecida: ${corrida}`)
  if (onde === "browser" || onde === "secretaria") await correr(onde, modo)
  else if (onde === "antigo") await correrComAntigo(modo)
  else throw new Error(`corrida desconhecida: ${corrida}`)
}

console.log("\n== Resumo (quadros com som, todas as fases menos o silêncio)")
console.log("| corrida | emissor: mediana, desvio, distintos, na moda | receptor: mediana, desvio, na moda | kbit/s a falar (-20) | pacotes/s em silêncio | energia (-20) |")
for (const l of TABELA) {
  const f = l.fases[0]
  console.log(
    `| ${l.rotulo} | ${l.envio.mediana} B, ${l.envio.desvio?.toFixed(2)}, ${l.envio.distintos}, ${((l.envio.naModa ?? 0) * 100).toFixed(1)} % | ${l.rececao.mediana} B, ${l.rececao.desvio?.toFixed(2)}, ${((l.rececao.naModa ?? 0) * 100).toFixed(1)} % | ${f.kbps.toFixed(1)} (${f.kbpsComCabecalhos.toFixed(1)}) | ${l.silencio.pps.toFixed(1)} | ${f.energia.toFixed(1)} dB |`,
  )
}

process.exit(resumo() ? 0 : 1)
