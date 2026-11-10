/**
 * Probe of the report "audio muted" (4/11/2026): the "Play" of each of the 27
 * sounds in the desktop app for real (Electron, `scripts/secretaria.mjs`).
 *
 *   npm run build && node scripts/sonda-sons-secretaria-sons.mjs
 *
 * Measures the `start` and peak at the destination of each sound. Probe, no
 * verdict.
 */
import { abrirSecretaria } from "./secretaria.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"
import { criarConta } from "./conta.mjs"
import { dentro, espera } from "./fase7-comum.mjs"
const srv = await levantarServidor({ frente: 8554, servidor: 8555, etiqueta: "sonda-sec" })
const sec = await abrirSecretaria({ rotulo: "ana" })
const page = sec.page
try {
  await criarConta(page, { nome: "Ana", frase: "frase-de-verificacao-2026", servidor: srv.NOME })
  await dentro(page)
  await page.evaluate(() => {
    window.__starts = []; window.__pico = 0
    const s = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...a) {
      if (!(this.context instanceof OfflineAudioContext)) window.__starts.push(this.context.state)
      return s.apply(this, a)
    }
    const ligar = AudioNode.prototype.connect
    AudioNode.prototype.connect = function (d, ...r) {
      const out = ligar.call(this, d, ...r)
      if (d instanceof AudioDestinationNode && !(this.context instanceof OfflineAudioContext)) {
        const c = this.context
        if (!c.__an) { c.__an = c.createAnalyser(); const b = new Float32Array(2048); setInterval(() => { c.__an.getFloatTimeDomainData(b); for (const x of b) window.__pico = Math.max(window.__pico, Math.abs(x)) }, 20) }
        ligar.call(this, c.__an)
      }
      return out
    }
  })
  await page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await espera(800)
  await page.getByText("Notificações", { exact: true }).first().click()
  await page.getByText("Um som por acontecimento").click()
  await espera(500)
  const botoes = page.locator(".sound-type button")
  const n = await botoes.count()
  for (let i = 0; i < n; i++) {
    const antes = await page.evaluate(() => { window.__pico = 0; return window.__starts.length })
    const nome = await botoes.nth(i).getAttribute("aria-label")
    await botoes.nth(i).click()
    await espera(500)
    const [depois, pico, est] = await page.evaluate(() => [window.__starts.length, window.__pico, window.__starts.at(-1)])
    console.log((depois > antes && pico > 0.01 ? "ok   " : "MUDO ") + nome + " pico=" + pico.toFixed(3) + " " + est)
  }
} catch (e) { console.log("ERRO", e.message); console.log(sec.registo.slice(-20).join("\n")) }
finally { await sec.fechar(); srv.fechar(); process.exit(0) }
