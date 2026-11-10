/**
 * Channel and mention sounds, live (3/11/2026).
 *
 *   npm run build && node scripts/e2e-sons-canal-mencao.mjs
 *
 * Local and throwaway server, never production. Two accounts in Chromium (two
 * contexts): Ana writes, Bruno listens. Bruno has the channel open in the
 * "conversa" room, with the window in front.
 *
 *  1. Ana writes in "anúncios" (another room): Bruno hears the channel sound;
 *  2. Ana writes in "conversa" (the open room, in front): nothing plays;
 *  3. Ana writes "@Bruno" in "anúncios": only the mention sound plays, full;
 *  4. Ana writes "@Bruno" in "conversa" (open, in front): the mention plays,
 *     at half amplitude;
 *  5. Ana writes "@Bruno" in the private conversation: only the mention plays;
 *  6. Bruno mutes the channel: the message in "anúncios" does not play, and the mention
 *     keeps playing;
 *  7. the common "Orwell" channel was muted by default on both accounts.
 *
 * **No ears.** The instrument (`ESPIAR`) starts before the app boots: it logs
 * the frequencies of each sound that the engine renders (`OfflineAudioContext`), and at
 * each `AudioBufferSourceNode.start` it logs which sound it was and what gain. The
 * family (`packages/ui/src/sons/familia.ts`) gives each sound its signature, and that
 * is how it is recognized.
 */
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, abrirDirecta, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, espera, ouviu, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "lagar"

/** The family signatures, by fundamental frequencies (Hz), in `familia.ts`. */
const FIGURAS = {
  canal: [587.33, 659.25],
  mencao: [987.77, 1174.66, 1479.98],
  directa: [1318.51, 987.77],
  enviada: [987.77, 1174.66],
}

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8514, servidor: 8515, etiqueta: "sons-canal" })
const browsers = []
const registo = []

/** The instrument. Runs in each document before the app code. */
function ESPIAR() {
  window.__sons = []
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
      // Three oscillators per note (the marimba partials): the fundamental is the first.
      const hz = (contexto.__hz ?? []).filter((_, i) => i % 3 === 0).map((valor) => Math.round(valor * 100) / 100)
      figuras.set(buffer, hz)
      return buffer
    })
  }
  const ligar = AudioNode.prototype.connect
  AudioNode.prototype.connect = function (destino, ...resto) {
    if (this instanceof AudioBufferSourceNode) this.__destino = destino
    return ligar.call(this, destino, ...resto)
  }
  const comecar = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (...args) {
    // The mallet of each note (the marimba click) plays inside the render: it is not a sound.
    if (this.context instanceof Offline) return comecar.apply(this, args)
    const ganho = this.__destino && this.__destino.gain ? this.__destino.gain.value : null
    window.__sons.push({ hz: figuras.get(this.buffer) ?? null, ganho, t: Date.now() })
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
  const browser = await chromium.launch({ headless: true })
  browsers.push(browser)
  const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  await ctx.addInitScript(ESPIAR)
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  return page
}

/** The sounds played on this page since `desde`, by signature name. */
async function sonsDesde(page, desde) {
  const lista = await page.evaluate(() => window.__sons)
  return lista.slice(desde).map((som) => ({ nome: nomeDaFigura(som.hz), ganho: som.ganho }))
}

const contar = (page) => page.evaluate(() => window.__sons.length)

async function abrirSala(page, nome) {
  const sala = page.locator(".room-row button.room").filter({ has: page.locator(".room-name", { hasText: nome }) }).first()
  await sala.click({ timeout: 30_000 })
  await page.locator('input[placeholder="Escreve uma mensagem"]').waitFor({ timeout: 30_000 })
  await espera(600)
}

async function escrever(page, frase) {
  const caixa = page.locator('input[placeholder="Escreve uma mensagem"]')
  await caixa.click()
  await caixa.fill(frase)
  await page.keyboard.press("Enter")
}

/** Write with the chosen mention from the list, like a person. */
async function mencionar(page, nome, resto) {
  const caixa = page.locator('input[placeholder="Escreve uma mensagem"]')
  await caixa.click()
  await caixa.fill("")
  await caixa.pressSequentially(`@${nome.slice(0, 3)}`, { delay: 60 })
  await page.locator(".mention-picker [role=option]").first().waitFor({ timeout: 15_000 })
  await page.keyboard.press("Enter")
  await caixa.pressSequentially(` ${resto}`, { delay: 20 })
  await page.keyboard.press("Enter")
}

/** Wait for something new to play (or give up), and a bit more to catch a second sound. */
async function esperarSons(page, desde, ms = 20_000) {
  await ate(async () => (await contar(page)) > desde, ms, 200)
  await espera(1500)
  return sonsDesde(page, desde)
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

  await abrirCanal(ana, CANAL)
  await abrirCanal(bruno, CANAL)
  await abrirSala(bruno, "conversa")
  await bruno.bringToFront()
  const aFrente = await bruno.evaluate(() => !document.hidden && document.hasFocus())
  check("a janela do Bruno está à frente e com foco", aFrente)

  // The engine only plays after a gesture, and prepares sounds on that gesture.
  await bruno.locator(".chat-main, main").first().click({ position: { x: 5, y: 5 } }).catch(() => {})
  await espera(1500)
  const gesto = await bruno.evaluate(() => navigator.userActivation?.hasBeenActive === true)
  check("houve um gesto na página do Bruno", gesto)

  // 1. Another channel room: plays the channel sound.
  await abrirSala(ana, "anúncios")
  let antes = await contar(bruno)
  await escrever(ana, "primeira em anúncios")
  let sons = await esperarSons(bruno, antes)
  check('1. mensagem em "anúncios" (outra sala): toca o som do canal, uma vez', sons.length === 1 && sons[0]?.nome === "canal", JSON.stringify(sons))
  const ganhoCheio = sons[0]?.ganho ?? 0

  // 2. The open room, in front: does not play.
  await espera(3500)
  await abrirSala(ana, "conversa")
  antes = await contar(bruno)
  await escrever(ana, "segunda na conversa")
  const viu = await ouviu(bruno, "segunda na conversa", 30_000)
  await espera(2500)
  sons = await sonsDesde(bruno, antes)
  check('2. mensagem em "conversa" (a sala aberta, à frente): chega e não toca', viu >= 0 && sons.length === 0, JSON.stringify(sons))

  // 3. Mention in another room: only the mention.
  await espera(3500)
  await abrirSala(ana, "anúncios")
  antes = await contar(bruno)
  await mencionar(ana, "Bruno", "olha os anúncios")
  sons = await esperarSons(bruno, antes)
  check('3. "@Bruno" em "anúncios": toca só o som da menção, inteiro', sons.length === 1 && sons[0]?.nome === "mencao" && sons[0]?.ganho === ganhoCheio, JSON.stringify(sons))
  const ganhoDaMencao = sons[0]?.ganho ?? 0

  // 4. Mention in the open room, in front: the mention plays, quieter.
  await espera(3500)
  await abrirSala(ana, "conversa")
  antes = await contar(bruno)
  await mencionar(ana, "Bruno", "estás a ver isto")
  sons = await esperarSons(bruno, antes)
  const metade = ganhoDaMencao > 0 && Math.abs((sons[0]?.ganho ?? 0) / ganhoDaMencao - 0.5) < 0.01
  check('4. "@Bruno" em "conversa" (aberta, à frente): toca a menção, a metade', sons.length === 1 && sons[0]?.nome === "mencao" && metade, `${JSON.stringify(sons)} contra ${ganhoDaMencao}`)

  // 5. Mention in the private conversation: only the mention.
  await espera(3500)
  await bruno.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  await abrirDirecta(ana, "Bruno")
  antes = await contar(bruno)
  await mencionar(ana, "Bruno", "na privada")
  sons = await esperarSons(bruno, antes)
  check('5. "@Bruno" na conversa privada: toca só o som da menção', sons.length === 1 && sons[0]?.nome === "mencao", JSON.stringify(sons))

  // 6. Channel muted: the message does not play, the mention plays.
  await abrirCanal(bruno, CANAL)
  await abrirSala(bruno, "conversa")
  await bruno.locator(".channel-list .channel-row").filter({ has: bruno.locator(".channel-name", { hasText: CANAL }) }).first().click({ button: "right" })
  await bruno.getByRole("menuitem", { name: "Silenciar notificações" }).first().click()
  const linhaDoCanal = bruno.locator(".channel-list .channel-row").filter({ has: bruno.locator(".channel-name", { hasText: CANAL }) }).first()
  const silenciado = await ate(async () => (await linhaDoCanal.locator(".marca-silencio").count()) > 0, 10_000)
  check("6. o Bruno silencia o canal pelo menu", silenciado >= 0)
  await bruno.keyboard.press("Escape").catch(() => {})
  await espera(3500)
  await abrirCanal(ana, CANAL)
  await abrirSala(ana, "anúncios")
  antes = await contar(bruno)
  await escrever(ana, "terceira em anúncios, calada")
  await espera(8000)
  sons = await sonsDesde(bruno, antes)
  check('6. canal silenciado: a mensagem em "anúncios" não toca', sons.length === 0, JSON.stringify(sons))
  await abrirSala(bruno, "anúncios")
  check("6. e chegou na mesma", (await ouviu(bruno, "terceira em anúncios, calada", 20_000)) >= 0)
  await abrirSala(bruno, "conversa")
  await espera(3500)
  antes = await contar(bruno)
  await mencionar(ana, "Bruno", "mesmo calado")
  sons = await esperarSons(bruno, antes)
  check("6. canal silenciado: a menção toca na mesma", sons.length === 1 && sons[0]?.nome === "mencao", JSON.stringify(sons))

  // 7. The common channel, muted by default.
  for (const [nome, page] of [["Ana", ana], ["Bruno", bruno]]) {
    const prefs = await page.evaluate(() => localStorage.getItem("enclave.prefs") ?? "")
    check(`7. o canal comum "Orwell" está silenciado de fábrica para a ${nome}`, prefs.includes(`!orwell:${srv.NOME}`), prefs.slice(0, 200))
  }

  check("o ganho do som do canal é o do volume (sem metade)", ganhoCheio > 0, String(ganhoCheio))
} catch (erro) {
  check(`o guião correu até ao fim (${erro.message})`, false)
} finally {
  for (const linha of registo.slice(-10)) console.log(linha)
  for (const browser of browsers) await browser.close().catch(() => {})
  await srv.fechar?.()
}
process.exit(resumo() ? 0 : 1)
