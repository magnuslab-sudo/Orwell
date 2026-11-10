/**
 * The call server refuses a consume, and the listener keeps hearing without leaving? (4/11/2026)
 *
 *   npm run build && node scripts/e2e-consumo-repete.mjs
 *   node scripts/e2e-consumo-repete.mjs --dist <folder>     # web from another version (the earlier one, to make the proof bite)
 *
 * Owner report (logged 4/11/2026, 16:42:21 UTC, 1.3.0, #984): "the user hears me but I don't hear them". In the middle of a stuck thread, an `sfu.consume` received from the server "the call server refused the request", and 1.3.0 never asked again: the owner didn't hear the person until leaving and rejoining.
 *
 * Two real accounts (built web, throwaway server and SFU, like in `e2e-troca-de-sala.mjs`), each in Chromium. Ana speaks in "voice".
 *
 * 1. **The refusal.** Bruno joins "voice" with the first `sfu.consume` broken in the frame (the producer id swapped for one the server doesn't know). The real server responds with `sfu.error` "produtor-desconhecido", which is the answer to a stale request. We measure whether Bruno hears Ana without leaving.
 * 2. **The stuck thread.** Both hearing each other. Bruno's page thread stalls for 12 s (the vault in 1.3.0); in that time Ana goes to "voice2" and back to "voice" (her producer is rebuilt twice), and the first `sfu.consume` Bruno sends when unstuck comes out broken. We measure whether Bruno hears Ana again without leaving.
 *
 * Break it in the frame, not in the code: what we measure is the app as shipped, against the real server refusal. All local and disposable. Ports 8591 to 8593. Never production.
 */
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, ate, contasDoServidor, criarCanal, dentro, entrarNaVoz, escutar, verificador } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const arg = (nome) => (process.argv.includes(nome) ? process.argv[process.argv.indexOf(nome) + 1] : null)
const DIST = arg("--dist")
const FRASE = "frase-de-verificacao-2026"
const CANAL = "ensaio"
const OUVE_DB = -45
/** How long to give the listener to hear, after refusal. The retry policy repeats at 1 s. */
const PRAZO_MS = 20_000

const { check, resumo } = verificador()
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The broken frame: the next `window.__estragar` frames of `sfu.consume` go out with
 * a producer the server doesn't know. Everything else passes untouched.
 */
const ESTRAGAR = () => {
  window.__estragar = 0
  window.__estragados = 0
  const enviar = WebSocket.prototype.send
  WebSocket.prototype.send = function (dados) {
    if (window.__estragar > 0 && typeof dados === "string" && dados.includes('"sfu.consume"')) {
      try {
        const frame = JSON.parse(dados)
        if (frame.t === "sfu.consume") {
          window.__estragar--
          window.__estragados++
          frame.producer = crypto.randomUUID()
          return enviar.call(this, JSON.stringify(frame))
        }
      } catch {}
    }
    return enviar.call(this, dados)
  }
}

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

async function criarSalaDeVoz(page, nome) {
  await page.locator(".room-row button.room-new").first().click()
  await page.getByPlaceholder("Anúncios").fill(nome)
  await page.getByRole("button", { name: "Voz", exact: true }).click()
  await page.getByRole("button", { name: "Criar", exact: true }).click()
  await linhaDa(page, nome).waitFor({ timeout: 30_000 })
}

async function abrirPessoa(srv, nome, trama) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  })
  const ctx = await browser.newContext({ locale: "pt-PT", permissions: ["microphone"], viewport: { width: 1280, height: 860 } })
  await ctx.addInitScript(MICROFONE_SINTETICO)
  await ctx.addInitScript(SONDA)
  await ctx.addInitScript(ESTRAGAR)
  escutar(ctx, trama, nome)
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e?.message ?? e)))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome, frase: FRASE, servidor: srv.NOME })
  await dentro(page)
  return { browser, page, erros, nome }
}

/** Bruno's `sfu.*` frames since `marca`, for the report and the accounts. */
const tramasSfu = (trama, marca, quem) =>
  trama.slice(marca).filter((l) => l.startsWith(`${quem} TRAMA`) && /"t":"sfu\.(consume|error|consumed|resume|resumed|scope\.join|producer)/.test(l))

const contar = (linhas, padrao) => linhas.filter((l) => padrao.test(l)).length

/** The text on Ana's card on Bruno's screen: "connected", "in call, no audio yet"... */
async function estadoDaAna(page) {
  return page.evaluate(() => {
    const cartoes = [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && /^(ligad|na chamada|sem som|a ligar)/i.test(e.textContent?.trim() ?? ""))
    return cartoes.map((e) => e.textContent.trim()).slice(0, 4)
  })
}

const srv = await levantarServidor({ frente: 8591, servidor: 8592, sfu: 8593, etiqueta: "consumo-repete", ...(DIST ? { dist: DIST } : {}) })
console.log(`  web: ${DIST ?? "apps/web/dist (esta versão)"}`)
const trama = []
const pessoas = []
try {
  const ana = await abrirPessoa(srv, "Ana", trama)
  pessoas.push(ana)
  const bruno = await abrirPessoa(srv, "Bruno", trama)
  pessoas.push(bruno)
  const [, endBruno] = contasDoServidor(srv.base)
  await criarCanal(ana.page, CANAL)
  await criarSalaDeVoz(ana.page, "voz2")
  check("a Ana convida o Bruno", await convidar(ana.page, CANAL, endBruno))
  check("o Bruno entra no canal", await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))
  for (const p of [ana, bruno]) {
    await p.page.keyboard.press("Escape").catch(() => {})
    await abrirCanal(p.page, CANAL)
  }

  // ------------------------------------------------------------ 1. a recusa
  check("a Ana entra em «voz»", await entrarNaVoz(ana.page))
  await ana.page.locator(".call-barra").waitFor({ timeout: 30_000 })
  await ana.page.evaluate(() => window.__definirSom("voz"))

  let marca = trama.length
  await bruno.page.evaluate(() => (window.__estragar = 1))
  check("o Bruno entra em «voz», com o primeiro consumo estragado no fio", await entrarNaVoz(bruno.page))
  await bruno.page.locator(".call-barra").waitFor({ timeout: 30_000 })
  const t1 = await ateOuvir(bruno.page, PRAZO_MS)
  let linhas = tramasSfu(trama, marca, "Bruno")
  const recusas1 = contar(linhas, /TRAMA< .*"t":"sfu\.error".*produtor-desconhecido/)
  check("o servidor recusou o consumo estragado (sfu.error produtor-desconhecido)", recusas1 >= 1, `${recusas1} recusa(s), ${await bruno.page.evaluate(() => window.__estragados)} estragado(s)`)
  check("1. o Bruno ouve a Ana sem sair da chamada", t1 >= 0, t1 >= 0 ? `${t1} ms depois de entrar` : `nada em ${PRAZO_MS} ms; cartão: ${JSON.stringify(await estadoDaAna(bruno.page))}`)
  console.log(`     tramas sfu do Bruno:\n       ${linhas.map((l) => l.replace(/^Bruno /, "").slice(0, 150)).join("\n       ")}`)

  // ------------------------------------------------- 2. a thread presa
  if (t1 < 0) {
    // Without the first, the second measures nothing: Bruno leaves and joins to start from a clean state.
    await bruno.page.getByRole("button", { name: "Sair da chamada" }).first().click().catch(() => {})
    await dormir(1500)
    await entrarNaVoz(bruno.page)
    check("(para a parte 2) o Bruno ouve a Ana depois de sair e entrar", (await ateOuvir(bruno.page, PRAZO_MS)) >= 0)
  }
  marca = trama.length
  await bruno.page.evaluate(() => {
    window.__estragar = 1
    // The thread stalls for 12 s, like the vault in 1.3.0. On a clock, so evaluate returns early.
    setTimeout(() => {
      const fim = Date.now() + 12_000
      while (Date.now() < fim) {}
    }, 0)
  })
  await dormir(1000)
  await linhaDa(ana.page, "voz2").locator("button.room").click()
  await dormir(2600)
  await linhaDa(ana.page, "voz").locator("button.room").click()
  await dormir(12_000)
  const t2 = await ateOuvir(bruno.page, PRAZO_MS)
  linhas = tramasSfu(trama, marca, "Bruno")
  console.log(`     tramas sfu do Bruno:\n       ${linhas.map((l) => l.replace(/^Bruno /, "").slice(0, 150)).join("\n       ")}`)
  check("2. depois da thread presa e do produtor refeito, o Bruno volta a ouvir a Ana sem sair", t2 >= 0, t2 >= 0 ? `${t2} ms depois de soltar` : `nada em ${PRAZO_MS} ms; cartão: ${JSON.stringify(await estadoDaAna(bruno.page))}`)
  check("2. e a Ana ouve o Bruno", (await bruno.page.evaluate(() => window.__definirSom("voz")), await ateOuvir(ana.page, PRAZO_MS)) >= 0)

  const erros = pessoas.flatMap((p) => p.erros.map((e) => `${p.nome}: ${e}`))
  check("nenhum erro de página", erros.length === 0, erros[0]?.slice(0, 200) ?? "")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
} finally {
  for (const p of pessoas) await p.browser.close().catch(() => {})
  srv.fechar()
}
process.exit(resumo() ? 0 : 1)
