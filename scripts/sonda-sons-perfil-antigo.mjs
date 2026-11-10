/**
 * Probe of the report "audio muted" (4/11/2026): a profile made by an OLD web
 * app, then the new web in the same browser, like during an update.
 *
 *   DIST_ANTIGO=<apps/web/dist from a published version> PASTA=<work folder> \
 *     node scripts/sonda-sons-perfil-antigo.mjs        (needs `npm run build`)
 *
 * Local disposable server. Ana and Bruno create an account, become friends and
 * share a channel on the old web. The frontend then serves the new web at the
 * same URL, pages reload and unlock with the passphrase written by hand (the
 * key is the gesture). Then: a direct message with no more gesture, the
 * channel, an outgoing message, another direct. Prints the sounds heard by the
 * `familia.ts` figure. Probe, no verdict.
 */
import { chromium } from "playwright"
import { cpSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, abrirDirecta, aceitarAmizade, contasDoServidor, criarCanal, dentro, dizer, espera, ouviu, pedirAmizade } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const ANTIGO = process.env.DIST_ANTIGO
const NOVO = join(process.cwd(), "apps/web/dist")
const D = join(process.env.PASTA, "dist-vivo")
rmSync(D, { recursive: true, force: true }); mkdirSync(D, { recursive: true })
cpSync(ANTIGO, D, { recursive: true })
const FRASE = "frase-de-verificacao-2026"
const FIGURAS = {
  canal: [587.33, 659.25], mencao: [987.77, 1174.66, 1479.98], directa: [1318.51, 987.77], enviada: [987.77, 1174.66],
  "mic-silenciado": [880, 659.25], "mic-ligado": [659.25, 880],
}
function ESPIAR() {
  window.__sons = []
  const figuras = new WeakMap()
  const descricao = Object.getOwnPropertyDescriptor(AudioParam.prototype, "value")
  const Offline = window.OfflineAudioContext
  const criarOscilador = Offline.prototype.createOscillator
  Offline.prototype.createOscillator = function () {
    const o = criarOscilador.call(this); const c = this; c.__hz ??= []
    Object.defineProperty(o.frequency, "value", { configurable: true, get() { return descricao.get.call(this) }, set(v) { c.__hz.push(v); descricao.set.call(this, v) } })
    return o
  }
  const renderizar = Offline.prototype.startRendering
  Offline.prototype.startRendering = function () {
    const c = this
    return renderizar.call(this).then((b) => { figuras.set(b, (c.__hz ?? []).filter((_, i) => i % 3 === 0).map((v) => Math.round(v * 100) / 100)); return b })
  }
  const comecar = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (...a) {
    if (!(this.context instanceof Offline)) window.__sons.push({ hz: figuras.get(this.buffer) ?? null, estado: this.context.state, t: Date.now() })
    return comecar.apply(this, a)
  }
  const AC = window.AudioContext
  window.__contextos = []
  window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__contextos.push(this) } }
}
const nome = (hz) => { if (!hz) return "?"; for (const [n, f] of Object.entries(FIGURAS)) if (f.length === hz.length && f.every((v, i) => Math.abs(v - hz[i]) < 0.02)) return n; return `outro(${hz.join(",")})` }
const srv = await levantarServidor({ frente: 8544, servidor: 8545, dist: D, etiqueta: "perfil-antigo" })
const browser = await chromium.launch()
const sons = async (p, desde) => (await p.evaluate(() => window.__sons)).slice(desde).map((s) => `${nome(s.hz)}[${s.estado}]`)
const n = (p) => p.evaluate(() => window.__sons.length)
async function abrir(rotulo) {
  const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  await ctx.addInitScript(ESPIAR)
  const p = await ctx.newPage()
  p.on("pageerror", (e) => console.log(rotulo, "PAGEERROR", e.message))
  p.on("console", (m) => { if (/AudioContext|autoplay|som/i.test(m.text())) console.log(rotulo, "consola:", m.text().slice(0, 200)) })
  await p.goto(srv.APP, { waitUntil: "domcontentloaded" })
  return p
}
try {
  const ana = await abrir("ana"); await criarConta(ana, { nome: "Ana", frase: FRASE, servidor: srv.NOME }); await dentro(ana)
  const bruno = await abrir("bruno"); await criarConta(bruno, { nome: "Bruno", frase: FRASE, servidor: srv.NOME }); await dentro(bruno)
  const [eAna, eBruno] = contasDoServidor(srv.base)
  await pedirAmizade(bruno, eAna); console.log("amizade", await aceitarAmizade(ana))
  await criarCanal(ana, "lagar"); console.log("convite", await convidar(ana, "lagar", eBruno), await aceitarConvite(bruno, "lagar", { espera: 60_000 }))
  await abrirDirecta(ana); await dizer(ana, "ola na antiga"); console.log("bruno ouviu na antiga", await ouviu(bruno, "ola na antiga"))
  console.log("ANTIGA prefs", await bruno.evaluate(() => ({ prefs: localStorage.getItem("enclave.prefs"), sons: localStorage.getItem("enclave.sons"), keys: Object.keys(localStorage) })))
  // The swap: 1.3.0 at the same place.
  rmSync(D, { recursive: true, force: true }); cpSync(NOVO, D, { recursive: true })
  for (const p of [ana, bruno]) {
    await p.reload({ waitUntil: "domcontentloaded" })
    const campo = p.locator('input[type="password"]').first()
    await campo.or(p.getByRole("button", { name: "Configurações", exact: true })).first().waitFor({ timeout: 60_000 })
    if (await campo.count()) { await campo.click(); await campo.pressSequentially(FRASE, { delay: 5 }); await p.keyboard.press("Enter") }
    await dentro(p)
  }
  await espera(4000)
  console.log("NOVA contextos", await bruno.evaluate(() => window.__contextos.map((c) => c.state)), "gesto", await bruno.evaluate(() => navigator.userActivation.hasBeenActive))
  // 1. the direct message, with no more gesture from Bruno
  let a = await n(bruno); await abrirDirecta(ana); await dizer(ana, "directa um"); await ouviu(bruno, "directa um", 60_000).catch(() => {}); await espera(2500)
  console.log("1 directa (sem gesto depois de desbloquear):", await sons(bruno, a), await bruno.evaluate(() => window.__contextos.map((c) => c.state)))
  // 2. the channel
  await abrirCanal(ana, "lagar"); a = await n(bruno); await dizer(ana, "canal um"); await espera(5000)
  console.log("2 canal:", await sons(bruno, a))
  // 3. Bruno clicks and types
  await abrirCanal(bruno, "lagar"); a = await n(bruno); await dizer(bruno, "enviada um"); await espera(2500)
  console.log("3 enviada:", await sons(bruno, a), await bruno.evaluate(() => window.__contextos.map((c) => c.state)))
  await abrirDirecta(ana); a = await n(bruno); await dizer(ana, "directa dois"); await espera(3500)
  console.log("4 directa dois:", await sons(bruno, a))
  console.log("NOVA prefs", await bruno.evaluate(() => ({ prefs: localStorage.getItem("enclave.prefs"), sons: localStorage.getItem("enclave.sons") })))
} finally { await browser.close(); srv.fechar(); process.exit(0) }
