/**
 * All 27 sounds, each from the real engine, in Chromium for real (4/11/2026).
 *
 *   node scripts/e2e-sons-27.mjs
 *
 * Report from the owner in 1.3.0: "Sounds are not activating. All of them. I hear nothing.
 * Just private messages." This script proves the end-to-end sound engine, with no
 * server: the `packages/ui/src/sons/motor.ts` bundled by esbuild, with
 * Chromium's real `OfflineAudioContext` and `AudioContext`.
 *
 * The disk preferences are those that web 1.1.1 left (`enclave.sons` without
 * the channel and without the seven parity ones, `enclave.prefs` with `chosen`). After
 * a click (the gesture), each type plays through the app's path: `tocar`,
 * `tocarChamada` or `chamar`, with all the rules applied. An analyzer hooked to the
 * output measures the peak that actually comes out. It passes when all 27
 * reach the speaker with a peak above 0.01 and no invalid values.
 *
 * It also measures the first round with the main thread busy (a 600 ms task
 * right after the gesture, like opening the vault, and 450 ms after
 * each sound). There it counts only the `start`, because the analyzer is a page timer
 * and does not run with the thread busy. It is informative: a sound requested before
 * rendering arrives, with the thread stuck for more than 400 ms, is dropped on purpose
 * (`ESPERA_MAXIMA_MS`, in `motor.ts`). See `docs/planos/sons-calados-relatorio.md`.
 */
import { build } from "esbuild"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const vazio = {
  name: "vazio",
  setup(b) {
    // The engine imports the preferences, which bring the core (audio wasm from the call): not needed here.
    b.onResolve({ filter: /\?(url|worker)/ }, (a) => ({ path: a.path, namespace: "vazio" }))
    b.onLoad({ filter: /.*/, namespace: "vazio" }, () => ({ contents: "export default ''" }))
  },
}
const pacote = await build({
  entryPoints: [join(raiz, "packages/ui/src/sons/motor.ts")],
  bundle: true,
  format: "iife",
  globalName: "Motor",
  write: false,
  target: "es2022",
  logLevel: "error",
  plugins: [vazio],
})

const SONS_DA_111 = {
  porTipo: {
    directa: true, mencao: true, pedido: true, aceite: true, chamada: true, entrou: true, saiu: true, ligado: true,
    cotovelada: true, ticket: true, publicacao: true, actualizacao: true, "mic-silenciado": true, "mic-ligado": true,
    "tudo-silenciado": true, "tudo-ligado": true, "amigo-online": true, "sala-afk": true, enviada: true,
  },
  vibrar: true,
  chamadaComOcupado: true,
}
const PREFS_DA_111 = { chosen: true, activity: "online", sounds: true, soundVolume: 80, soundOff: false, silenciados: [] }

/** The instrument: each real-time `start`, and the peak at the output. */
const ESPIAO = `
window.__inicios = []; window.__pico = 0
const comecar = AudioBufferSourceNode.prototype.start
AudioBufferSourceNode.prototype.start = function (...a) {
  if (!(this.context instanceof OfflineAudioContext)) window.__inicios.push(this.context.state)
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
        for (const x of amostras) if (Number.isNaN(x)) window.__nan = true; else window.__pico = Math.max(window.__pico, Math.abs(x))
      }, 15)
    }
    ligar.call(this, c.__analisador)
  }
  return feito
}
`

const browser = await chromium.launch()
let falhas = 0
try {
  for (const ocupado of [false, true]) {
    const pagina = await browser.newPage()
    await pagina.route("http://sons.local/**", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><button id=gesto>gesto</button>" }))
    await pagina.goto("http://sons.local/")
    await pagina.evaluate(([sons, prefs]) => {
      localStorage.setItem("enclave.sons", sons)
      localStorage.setItem("enclave.prefs", prefs)
    }, [JSON.stringify(SONS_DA_111), JSON.stringify(PREFS_DA_111)])
    await pagina.addScriptTag({ content: ESPIAO + pacote.outputFiles[0].text })
    const resultado = await pagina.evaluate(async (comFioOcupado) => {
      const M = globalThis.Motor
      const motor = M.criarMotor({
        saida: M.criarSaidaWebAudio(),
        lerEstado: M.estadoDoAparelho,
        ambiente: { canalAberto: () => null, janelaAFrente: () => false, visivel: () => true },
      })
      motor.armar()
      document.getElementById("gesto").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
      if (comFioOcupado) {
        const ate = performance.now() + 600
        while (performance.now() < ate) {}
      } else {
        await new Promise((r) => setTimeout(r, 300))
      }
      const TIPOS = ["directa", "mencao", "canal", "pedido", "aceite", "chamada", "entrou", "saiu", "ligado", "cotovelada", "ticket", "publicacao", "actualizacao", "mic-silenciado", "mic-ligado", "tudo-silenciado", "tudo-ligado", "amigo-online", "sala-afk", "enviada", "a-chamar", "voz-perdida", "movido", "transmissao-iniciada", "transmissao-terminada", "espectador-entrou", "espectador-saiu"]
      const linhas = []
      for (const tipo of TIPOS) {
        window.__pico = 0
        const antes = window.__inicios.length
        let motivo
        if (tipo === "chamada") motivo = motor.tocarChamada("!directa:casa.pt")
        else if (tipo === "a-chamar") motivo = motor.chamar("!directa:casa.pt")
        else motivo = motor.tocar({ tipo, canal: "!outro:casa.pt" })
        if (comFioOcupado) {
          const ate = performance.now() + 450
          while (performance.now() < ate) {}
        }
        await new Promise((r) => setTimeout(r, tipo === "chamada" || tipo === "cotovelada" ? 900 : 550))
        if (tipo === "a-chamar") motor.pararDeChamar()
        if (tipo === "chamada") motor.pararChamada()
        linhas.push({ tipo, motivo, inicios: window.__inicios.length - antes, pico: window.__pico })
      }
      return { linhas, nan: window.__nan === true, total: TIPOS.length }
    }, ocupado)
    console.log(ocupado ? "\nCom o fio principal ocupado (informativo):" : "Com o fio principal livre:")
    for (const l of resultado.linhas) {
      // With the thread busy the analyzer does not run (it is a page timer): it counts only the `start`.
      const ok = l.motivo === "tocou" && l.inicios >= 1 && (ocupado || l.pico > 0.01)
      if (!ok && !ocupado) falhas += 1
      console.log(`  ${ok ? "ok  " : "MUDO"} ${l.tipo.padEnd(22)} motivo=${l.motivo} inicios=${l.inicios} pico=${l.pico.toFixed(3)}`)
    }
    if (resultado.nan) {
      falhas += 1
      console.log("  FALHA: NaN no destino")
    }
    await pagina.close()
  }
} finally {
  await browser.close()
}
console.log(falhas === 0 ? "\n27/27 tocaram com o fio livre" : `\n${falhas} falhas`)
process.exit(falhas === 0 ? 0 : 1)
