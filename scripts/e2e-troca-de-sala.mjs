/**
 * Room, AFK, then back to room in under 3 s: does the other person still hear you? (4/11/2026)
 *
 *   npm run build && node scripts/e2e-troca-de-sala.mjs
 *   node scripts/e2e-troca-de-sala.mjs --ida-e-volta 1500      # interval between the two clicks, in ms
 *
 * Owner report (log from 4/11/2026, 14:14 to 14:16 UTC, 1.3.0): switched
 * to AFK room and back to voice room in about 3 s. "Sound goes through (he sees
 * his own level), but doesn't reach the other user." No sender line
 * (`sfu-emissor-*`, 448) in his log.
 *
 * Two real accounts (built web, disposable server and SFU, as in
 * `e2e-audio-quem-entra-tarde.mjs`), each in Chromium: Ana creates the
 * channel with voice room "voz" and AFK room "Dormir", invites Bruno, both
 * join "voz" and hear each other. Then Ana clicks "Dormir" and, `--ida-e-volta`
 * ms later (2600 by default, the interval from the log), "voz". Measure on
 * Bruno whether he hears Ana, for 20 s, and repeat the switch twice.
 *
 * Sound is synthetic voice from the late-join script, at -20 dBFS.
 * All local and disposable. Ports 8581 to 8583. Never production.
 */
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, ate, contasDoServidor, criarCanal, dentro, entrarNaVoz, escutar, verificador } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const arg = (nome) => (process.argv.includes(nome) ? process.argv[process.argv.indexOf(nome) + 1] : null)
const IDA_E_VOLTA = Number(arg("--ida-e-volta") ?? 2600)
/**
 * `--sem-afk`: "Dormir" is a normal voice room. In the owner's log the room he
 * joined was set up by the SFU (`call-sfu-ligado X-Km39…`), which the AFK room
 * does not do (`#entrarSemVoz`): either his room wasn't marked AFK, or the app
 * didn't recognize it as such. Both variants run.
 */
const SEM_AFK = process.argv.includes("--sem-afk")
const FRASE = "frase-de-verificacao-2026"
const CANAL = "ensaio"
const AFK = "Dormir"
const OUVE_DB = -45

const { check, resumo } = verificador()
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The synthetic microphone and probes, from `e2e-audio-quem-entra-tarde.mjs`. */
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


const ouve = (d) => Math.max(d.maxEnergia, d.maxNivel) > OUVE_DB

/** Until the listener hears (1 s above the threshold), or time runs out. Returns ms, or -1. */
async function ateOuvir(ouvinte, ms) {
  return ate(async () => {
    const a = await ouvinte.evaluate(LER)
    await dormir(1000)
    const b = await ouvinte.evaluate(LER)
    return ouve(diferenca(a, b))
  }, ms, 200)
}

const linhaDa = (page, nome) => page.locator(".room-row").filter({ has: page.locator(".room-name", { hasText: nome }) }).first()

async function criarSalaAfk(page) {
  await page.locator(".room-row button.room-new").first().click()
  await page.getByPlaceholder("Anúncios").fill(AFK)
  await page.getByRole("button", { name: "Voz", exact: true }).click()
  if (!SEM_AFK) await page.getByRole("switch", { name: "Sala AFK" }).click()
  await page.getByRole("button", { name: "Criar", exact: true }).click()
  await linhaDa(page, AFK).waitFor({ timeout: 30_000 })
}

async function abrirPessoa(srv, nome, trama) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  })
  const ctx = await browser.newContext({ locale: "pt-PT", permissions: ["microphone"], viewport: { width: 1280, height: 860 } })
  await ctx.addInitScript(MICROFONE_SINTETICO)
  await ctx.addInitScript(SONDA)
  escutar(ctx, trama, nome)
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e?.message ?? e)))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome, frase: FRASE, servidor: srv.NOME })
  await dentro(page)
  return { browser, page, erros, nome }
}

const srv = await levantarServidor({ frente: 8581, servidor: 8582, sfu: 8583, etiqueta: "troca-de-sala" })
const trama = []
const pessoas = []
try {
  const ana = await abrirPessoa(srv, "Ana", trama)
  pessoas.push(ana)
  const bruno = await abrirPessoa(srv, "Bruno", trama)
  pessoas.push(bruno)
  const [, endBruno] = contasDoServidor(srv.base)
  await criarCanal(ana.page, CANAL)
  await criarSalaAfk(ana.page)
  check("a Ana convida o Bruno", await convidar(ana.page, CANAL, endBruno))
  check("o Bruno entra no canal", await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))
  for (const p of [ana, bruno]) {
    await p.page.keyboard.press("Escape").catch(() => {})
    await abrirCanal(p.page, CANAL)
    check(`${p.nome} entra em «voz»`, await entrarNaVoz(p.page))
    await p.page.locator(".call-barra").waitFor({ timeout: 30_000 })
  }
  await ana.page.evaluate(() => window.__definirSom("voz"))
  const t0 = await ateOuvir(bruno.page, 30_000)
  check("o Bruno ouve a Ana", t0 >= 0, `${t0} ms`)

  for (const volta of [1, 2]) {
    const marca = trama.length
    await linhaDa(ana.page, AFK).locator("button.room").click()
    await dormir(IDA_E_VOLTA)
    await linhaDa(ana.page, "voz").locator("button.room").click()
    const t = await ateOuvir(bruno.page, 20_000)
    check(`volta ${volta}: o Bruno ouve a Ana outra vez depois de «Dormir» e «voz» em ${IDA_E_VOLTA} ms`, t >= 0, `${t} ms`)
    const sfu = trama.slice(marca).filter((l) => l.startsWith("Ana TRAMA") && /"t":"sfu\./.test(l)).map((l) => l.replace(/^Ana TRAMA/, "").slice(0, 160))
    console.log(`     tramas sfu da Ana nesta volta:\n       ${sfu.join("\n       ")}`)
    if (t < 0) break
    await dormir(2000)
  }
  const erros = pessoas.flatMap((p) => p.erros.map((e) => `${p.nome}: ${e}`))
  check("nenhum erro de página", erros.length === 0, erros[0]?.slice(0, 200) ?? "")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
} finally {
  for (const p of pessoas) await p.browser.close().catch(() => {})
  srv.fechar()
}
process.exit(resumo() ? 0 : 1)
