/**
 * Parity sounds with Discord, live (3/11/2026).
 *
 *   npm run build && node scripts/e2e-sons-paridade.mjs
 *
 * Local and throwaway server with SFU, never production. Two accounts in
 * Chromium (two browsers), fake microphone and camera, fake screen (a drawn canvas,
 * hooked before the app). Ana creates the channel and moderates; Bruno is invited.
 *
 *  1. Ana calls Bruno through private conversation: hears the outgoing ring, which
 *     repeats; Bruno hears the incoming call, not the outgoing ring;
 *  2. Bruno answers: the outgoing ring stops;
 *  3. in the channel, both in the "voz" room: Ana shares the screen, and both hear
 *     the broadcast starting;
 *  4. Bruno hits "View": Ana hears a viewer entering; Bruno stops viewing: Ana
 *     hears a viewer leaving;
 *  5. Ana stops sharing: both hear the broadcast ending;
 *  6. Ana creates the "Cabina" room and moves Bruno there: Bruno hears the move sound,
 *     and not the entry or the "connected" of the new room;
 *  7. Bruno's socket drops (closed by the test): hears the connection lost,
 *     once, even after the connection comes back;
 *  8. Ana leaves the call by gesture: does not hear the connection lost.
 *
 * **No ears.** The instrument (`ESPIAR`) is the one from `e2e-sons-canal-mencao.mjs`:
 * it logs the frequencies of each sound that the engine renders and, at each
 * `AudioBufferSourceNode.start`, which sound it was. By the signature in `familia.ts`
 * each sound is recognized. It also saves the page's WebSockets, so step 7 can close them.
 */
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, abrirDirecta, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, entrarNaVoz, espera, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "estudio"
const CABINA = "Cabina"

/** The family signatures, by fundamental frequencies (Hz), in `familia.ts`. */
const FIGURAS = {
  "a-chamar": [587.33, 739.99, 587.33, 739.99],
  chamada: [880, 739.99, 880, 1174.66, 880, 739.99, 880, 1174.66],
  "voz-perdida": [739.99, 587.33, 440],
  movido: [880, 587.33, 880],
  "transmissao-iniciada": [440, 880],
  "transmissao-terminada": [880, 440],
  "espectador-entrou": [739.99, 987.77],
  "espectador-saiu": [987.77, 739.99],
  entrou: [587.33, 880],
  saiu: [880, 587.33],
  ligado: [493.88, 739.99, 987.77],
  directa: [1318.51, 987.77],
  enviada: [987.77, 1174.66],
  "amigo-online": [587.33, 739.99, 880, 1174.66],
}

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8524, servidor: 8525, sfu: 44336, etiqueta: "sons-paridade" })
const browsers = []
const registo = []

/** The instrument and the fake screen. Runs in each document before the app code. */
function ESPIAR() {
  window.__sons = []
  window.__sockets = []
  const Nativo = window.WebSocket
  window.WebSocket = class extends Nativo {
    constructor(...args) {
      super(...args)
      window.__sockets.push(this)
    }
  }
  navigator.mediaDevices.getDisplayMedia = async () => {
    const tela = document.createElement("canvas")
    tela.width = 640
    tela.height = 360
    const g = tela.getContext("2d")
    let n = 0
    setInterval(() => {
      g.fillStyle = `hsl(${(n++ * 7) % 360} 60% 35%)`
      g.fillRect(0, 0, 640, 360)
    }, 66)
    return new MediaStream([tela.captureStream(15).getVideoTracks()[0]])
  }
  const figuras = new WeakMap()
  const descricao = Object.getOwnPropertyDescriptor(AudioParam.prototype, "value")
  const Offline = window.OfflineAudioContext
  if (!Offline || !descricao) return
  const criarOscilador = Offline.prototype.createOscillator
  Offline.prototype.createOscillator = function () {
    const oscilador = criarOscilador.call(this)
    const contexto = this
    contexto.__hz ??= []
    Object.defineProperty(oscilador.frequency, "value", {
      configurable: true,
      get() {
        return descricao.get.call(this)
      },
      set(valor) {
        contexto.__hz.push(valor)
        descricao.set.call(this, valor)
      },
    })
    return oscilador
  }
  const renderizar = Offline.prototype.startRendering
  Offline.prototype.startRendering = function () {
    const contexto = this
    return renderizar.call(this).then((buffer) => {
      const hz = (contexto.__hz ?? []).filter((_, i) => i % 3 === 0).map((valor) => Math.round(valor * 100) / 100)
      figuras.set(buffer, hz)
      return buffer
    })
  }
  const comecar = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (...args) {
    // The mallet of each note (the marimba click) plays inside the render: it is not a sound.
    if (this.context instanceof Offline) return comecar.apply(this, args)
    window.__sons.push({ hz: figuras.get(this.buffer) ?? null, t: Date.now() })
    return comecar.apply(this, args)
  }
}

function nomeDaFigura(hz) {
  if (!hz) return "?"
  for (const [nome, figura] of Object.entries(FIGURAS)) {
    if (figura.length === hz.length && figura.every((valor, i) => Math.abs(valor - hz[i]) < 0.02)) return nome
  }
  return `outro(${hz.join(",")})`
}

async function abrir(nome) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  })
  browsers.push(browser)
  const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 }, permissions: ["microphone", "camera"] })
  await ctx.addInitScript(ESPIAR)
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  return page
}

const contar = (page) => page.evaluate(() => window.__sons.length)
async function sonsDesde(page, desde) {
  const lista = await page.evaluate(() => window.__sons)
  return lista.slice(desde).map((som) => nomeDaFigura(som.hz))
}
/** Wait for `nome` to play after `desde` (or give up), and return the sounds from there. */
async function esperarPor(page, desde, nome, ms = 20_000) {
  await ate(async () => (await sonsDesde(page, desde)).includes(nome), ms, 200)
  await espera(800)
  return sonsDesde(page, desde)
}
const quantos = (lista, nome) => lista.filter((som) => som === nome).length

/** The private conversation menu, in Friends. */
async function menuDaPrivada(page, comQuem, item) {
  await abrirDirecta(page, comQuem)
  await page.locator(".direct-row").filter({ hasText: comQuem }).first().click({ button: "right" })
  await page.getByRole("menuitem", { name: item, exact: true }).first().click({ timeout: 15_000 })
}

/** A gesture, so the engine can play (and prepare sounds). */
async function gesto(page) {
  await page.locator(".chat-main, main").first().click({ position: { x: 5, y: 5 } }).catch(() => {})
  await espera(1500)
  return page.evaluate(() => navigator.userActivation?.hasBeenActive === true)
}

try {
  const ana = await abrir("ana")
  await criarConta(ana, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana)
  const bruno = await abrir("bruno")
  await criarConta(bruno, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno)
  const [enderecoAna, enderecoBruno] = contasDoServidor(srv.base)
  await pedirAmizade(bruno, enderecoAna)
  check("a Ana aceita a amizade do Bruno", (await aceitarAmizade(ana)) >= 0)
  await criarCanal(ana, CANAL)
  check("a Ana convida o Bruno", await convidar(ana, CANAL, enderecoBruno))
  check("o Bruno entra no canal", await aceitarConvite(bruno, CANAL, { espera: 60_000 }))
  check("houve um gesto na página da Ana", await gesto(ana))
  check("houve um gesto na página do Bruno", await gesto(bruno))

  // 1. Ana calls Bruno.
  let antesAna = await contar(ana)
  let antesBruno = await contar(bruno)
  await menuDaPrivada(ana, "Bruno", "Entrar em chamada")
  await espera(7000)
  let sonsAna = await sonsDesde(ana, antesAna)
  check("1. a Ana ouve o toque a sair, e ele repete", quantos(sonsAna, "a-chamar") >= 2, JSON.stringify(sonsAna))
  const sonsBruno = await esperarPor(bruno, antesBruno, "chamada")
  check("1. o Bruno não ouve o toque a sair: não foi ele que ligou", !sonsBruno.includes("a-chamar"), JSON.stringify(sonsBruno))
  // The incoming ring already existed (not from this work); measured here because it pairs with the outgoing ring.
  check("1. o Bruno ouve a chamada a entrar", sonsBruno.includes("chamada"), JSON.stringify(sonsBruno))

  // 2. Bruno answers: the outgoing ring stops.
  antesBruno = await contar(bruno)
  await menuDaPrivada(bruno, "Ana", "Entrar em chamada")
  await espera(3500)
  antesAna = await contar(ana)
  await espera(7000)
  sonsAna = await sonsDesde(ana, antesAna)
  check("2. o Bruno atendeu: a Ana deixa de ouvir o toque a sair", !sonsAna.includes("a-chamar"), JSON.stringify(sonsAna))
  check("2. quem atende não ouve o toque a sair", !(await sonsDesde(bruno, antesBruno)).includes("a-chamar"))
  await menuDaPrivada(bruno, "Ana", "Sair da chamada")
  await menuDaPrivada(ana, "Bruno", "Sair da chamada")
  await espera(2000)

  // 3. In the channel, both in the voice room; Ana shares the screen.
  for (const page of [ana, bruno]) {
    await abrirCanal(page, CANAL)
    check(`3. ${page === ana ? "a Ana" : "o Bruno"} entra na sala de voz`, await entrarNaVoz(page))
  }
  // More than the settle window (3 s), and the connection up.
  await espera(8000)
  antesAna = await contar(ana)
  antesBruno = await contar(bruno)
  await ana.getByRole("button", { name: "Partilhar ecrã." }).first().click({ timeout: 15_000 })
  sonsAna = await esperarPor(ana, antesAna, "transmissao-iniciada")
  check("3. a Ana partilha: ouve a transmissão a começar", quantos(sonsAna, "transmissao-iniciada") === 1, JSON.stringify(sonsAna))
  let sonsDoBruno = await esperarPor(bruno, antesBruno, "transmissao-iniciada")
  check("3. o Bruno ouve a transmissão da Ana a começar", quantos(sonsDoBruno, "transmissao-iniciada") === 1, JSON.stringify(sonsDoBruno))

  // 4. Bruno sees and stops seeing.
  await espera(2500)
  antesAna = await contar(ana)
  await bruno.locator(".call-chip.ao-vivo-convida").first().hover({ timeout: 15_000 }).catch(() => {})
  await bruno.getByRole("button", { name: /^Ver (o ecrã|a transmissão) de/ }).first().click({ timeout: 15_000 })
  sonsAna = await esperarPor(ana, antesAna, "espectador-entrou")
  check('4. o Bruno carrega em "Ver": a Ana ouve um espectador a entrar', quantos(sonsAna, "espectador-entrou") === 1, JSON.stringify(sonsAna))
  await espera(2500)
  antesAna = await contar(ana)
  await bruno.getByRole("button", { name: /^Parar de ver o ecrã de/ }).first().click({ timeout: 15_000 })
  sonsAna = await esperarPor(ana, antesAna, "espectador-saiu")
  check("4. o Bruno pára de ver: a Ana ouve um espectador a sair", quantos(sonsAna, "espectador-saiu") === 1, JSON.stringify(sonsAna))

  // 5. Ana stops sharing.
  await espera(2500)
  antesAna = await contar(ana)
  antesBruno = await contar(bruno)
  await ana.getByRole("button", { name: /Parar de partilhar/ }).first().click({ timeout: 15_000 })
  sonsAna = await esperarPor(ana, antesAna, "transmissao-terminada")
  check("5. a Ana pára: ouve a transmissão a acabar", quantos(sonsAna, "transmissao-terminada") === 1, JSON.stringify(sonsAna))
  sonsDoBruno = await esperarPor(bruno, antesBruno, "transmissao-terminada")
  check("5. o Bruno ouve a transmissão da Ana a acabar", quantos(sonsDoBruno, "transmissao-terminada") === 1, JSON.stringify(sonsDoBruno))

  // 6. Ana creates the "Cabin" and moves Bruno there.
  await ana.locator(".room-row button.room-new").first().click()
  await ana.getByPlaceholder("Anúncios").fill(CABINA)
  await ana.getByRole("button", { name: "Voz", exact: true }).click()
  await ana.getByRole("button", { name: "Criar", exact: true }).click()
  await ana.locator(".room-row").filter({ hasText: CABINA }).first().waitFor({ timeout: 30_000 })
  await bruno.locator(".room-row").filter({ hasText: CABINA }).first().waitFor({ timeout: 60_000 })
  await espera(2000)
  antesBruno = await contar(bruno)
  const linhaDoBruno = ana.locator(".room-voice-members li").filter({ hasText: "Bruno" }).first()
  await linhaDoBruno.click({ button: "right", timeout: 15_000 })
  await ana.getByRole("menuitem", { name: "Mover para", exact: true }).first().click({ timeout: 15_000 })
  await ana.getByRole("menuitem", { name: CABINA, exact: true }).first().click({ timeout: 15_000 })
  sonsDoBruno = await esperarPor(bruno, antesBruno, "movido")
  await espera(6000)
  sonsDoBruno = await sonsDesde(bruno, antesBruno)
  check("6. o Bruno é movido: ouve o som de ser movido, uma vez", quantos(sonsDoBruno, "movido") === 1, JSON.stringify(sonsDoBruno))
  check('6. e não ouve a própria entrada nem o "ligado" da sala nova', !sonsDoBruno.includes("entrou") && !sonsDoBruno.includes("ligado"), JSON.stringify(sonsDoBruno))

  // 7. O socket do Bruno cai.
  await espera(2500)
  antesBruno = await contar(bruno)
  const fechados = await bruno.evaluate(() => {
    const vivos = window.__sockets.filter((s) => s.readyState === WebSocket.OPEN)
    for (const s of vivos) s.close()
    return vivos.length
  })
  check("7. a bancada fecha o socket do Bruno", fechados > 0, String(fechados))
  sonsDoBruno = await esperarPor(bruno, antesBruno, "voz-perdida")
  // The connection comes back on its own; the call reconnects or drops for good. A drop, a sound.
  await espera(15_000)
  sonsDoBruno = await sonsDesde(bruno, antesBruno)
  check("7. o Bruno ouve a ligação perdida, uma vez", quantos(sonsDoBruno, "voz-perdida") === 1, JSON.stringify(sonsDoBruno))

  // 8. Ana leaves by gesture: not a missed call.
  antesAna = await contar(ana)
  await ana.getByRole("button", { name: "Sair da chamada" }).first().click({ timeout: 15_000 })
  await espera(4000)
  sonsAna = await sonsDesde(ana, antesAna)
  check("8. a Ana sai por gesto: não ouve a ligação perdida", !sonsAna.includes("voz-perdida"), JSON.stringify(sonsAna))
} catch (erro) {
  check(`o guião correu até ao fim (${erro.message})`, false)
} finally {
  for (const linha of registo.slice(-10)) console.log(linha)
  for (const browser of browsers) await browser.close().catch(() => {})
  await srv.fechar?.()
}
process.exit(resumo() ? 0 : 1)
