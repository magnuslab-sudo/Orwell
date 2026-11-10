/**
 * Turning on a sound in Settings plays, live (4/11/2026).
 *
 *   npm run build && node scripts/e2e-sons-ligar.mjs
 *
 * Report from the owner in 1.3.0: "Sounds are not activating. All of them. I hear nothing.
 * Just private messages." In Settings › Notifications, turning on the main
 * "Sounds" toggle plays immediately ("Private message"); turning on each type played
 * nothing. In 1.3.0 this script gives 0/27; with the fix, 27/27.
 *
 * Local and throwaway server, never production. One account in Chromium. For
 * each of the 27 types: it turns off (if on), and turns on. It counts the
 * `start` of each buffer in the real-time `AudioContext` and the peak that an
 * analyzer hooked to the output actually measures. It also confirms that turning off
 * does not play, and that the main toggle still plays the direct one.
 */
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { dentro, espera, verificador } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8564, servidor: 8565, etiqueta: "sons-ligar" })
const browser = await chromium.launch()

/** The instrument: each real-time `start`, and the peak at the output. Runs before the app. */
function ESPIAR() {
  window.__inicios = 0
  window.__pico = 0
  const comecar = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (...a) {
    if (!(this.context instanceof OfflineAudioContext)) window.__inicios += 1
    return comecar.apply(this, a)
  }
  const ligar = AudioNode.prototype.connect
  AudioNode.prototype.connect = function (destino, ...resto) {
    const feito = ligar.call(this, destino, ...resto)
    if (destino instanceof AudioDestinationNode && !(this.context instanceof OfflineAudioContext)) {
      const c = this.context
      if (!c.__analisador) {
        c.__analisador = c.createAnalyser()
        const amostras = new Float32Array(2048)
        setInterval(() => {
          c.__analisador.getFloatTimeDomainData(amostras)
          for (const x of amostras) window.__pico = Math.max(window.__pico, Math.abs(x))
        }, 15)
      }
      ligar.call(this, c.__analisador)
    }
    return feito
  }
}

const marcar = (page) => page.evaluate(() => { window.__pico = 0; return window.__inicios })
const medir = (page) => page.evaluate(() => ({ inicios: window.__inicios, pico: window.__pico }))

try {
  const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript(ESPIAR)
  const page = await ctx.newPage()
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome: "Ana", frase: "frase-de-verificacao-2026", servidor: srv.NOME })
  await dentro(page)
  await page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await espera(800)
  await page.getByText("Notificações", { exact: true }).first().click()

  // The main toggle: turning off and on plays the direct one, as always.
  const geral = page.getByLabel("Sons", { exact: true })
  await geral.click()
  await espera(300)
  let antes = await marcar(page)
  await geral.click()
  await espera(600)
  let medida = await medir(page)
  check('ligar "Sons" toca a directa', medida.inicios > antes && medida.pico > 0.01, JSON.stringify(medida))

  await page.getByText("Um som por acontecimento").click()
  await espera(500)
  const caixas = page.locator(".sound-type input[type=checkbox]")
  const total = await caixas.count()
  check("são 27 tipos", total === 27, String(total))
  let ouvidos = 0
  let desligarCalado = true
  for (let i = 0; i < total; i += 1) {
    const caixa = caixas.nth(i)
    const nome = (await caixa.evaluate((e) => e.parentElement?.textContent ?? "")).trim()
    if (await caixa.isChecked()) {
      antes = await marcar(page)
      await caixa.click()
      await espera(300)
      if ((await medir(page)).inicios !== antes) desligarCalado = false
    }
    antes = await marcar(page)
    await caixa.click()
    await espera(550)
    medida = await medir(page)
    const ouviu = medida.inicios > antes && medida.pico > 0.01
    if (ouviu) ouvidos += 1
    console.log(`  ${ouviu ? "ok  " : "MUDO"} ${nome}  pico=${medida.pico.toFixed(3)}`)
  }
  check("ligar cada tipo toca esse som (27/27)", ouvidos === total, `${ouvidos}/${total}`)
  check("desligar um tipo não toca nada", desligarCalado)
} catch (erro) {
  check(`o guião correu até ao fim (${erro.message})`, false)
} finally {
  await browser.close()
  srv.fechar()
}
process.exit(resumo() ? 0 : 1)
