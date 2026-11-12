/**
 * The 1.3.7 proof, reduced motion: with `reducedMotion: "reduce"`, the three
 * continuous animations (the aurora, the pulse of a voice room with people in
 * it and the ring pulse of whoever is on a call) stay in
 * `document.getAnimations()`, slower. The owner's rule: nothing stops, it just
 * moves slower.
 *
 *   node scripts/prova-1.3.7-movimento.mjs chromium|firefox|webkit   (needs `npm run build` first)
 *
 * One account only, in a voice room: the room now has people in it, and the
 * call card has the on-call ring. ALL LOCAL AND DISPOSABLE: `servidor-descartavel.mjs`.
 */
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { abrirCanal, criarCanal, dentro, entrarNaVoz } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const MOTOR = process.argv[2] ?? "chromium"
const PORTAS = { chromium: [8861, 8862, 8863], firefox: [8871, 8872, 8873], webkit: [8881, 8882, 8883] }
const ESPERADO = {
  normal: { aurora: 24000, pulse: 1800, "anel-pulsa-no-cartao": 1600 },
  reduzido: { "aurora-calma": 72000, "pulse-calmo": 3600, "anel-pulsa-calmo-no-cartao": 3200 },
}
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const passos = []
const check = (nome, ok, detalhe = "") => {
  passos.push({ nome, ok: Boolean(ok), detalhe: String(detalhe).slice(0, 400) })
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${String(detalhe).slice(0, 400)})` : ""}`)
}
const ler = () =>
  document
    .getAnimations()
    .filter((x) => x.animationName)
    .map((x) => ({ nome: x.animationName, duracao: Math.round(Number(x.effect?.getComputedTiming?.().duration ?? 0)), infinita: x.effect?.getComputedTiming?.().iterations === Infinity, estado: x.playState }))

const [FRENTE, SERV, SFU] = PORTAS[MOTOR]
const srv = await levantarServidor({ frente: FRENTE, servidor: SERV, sfu: SFU, etiqueta: `prova-movimento-${MOTOR}` })
let browser
const resultado = {}
try {
  const lancar = { chromium, firefox, webkit }[MOTOR]
  browser = await lancar.launch(
    MOTOR === "chromium"
      ? { headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] }
      : MOTOR === "firefox"
        ? { headless: true, firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true } }
        : { headless: true },
  )
  const ctx = await browser.newContext({ locale: "pt-PT", ...(MOTOR === "chromium" ? { permissions: ["microphone"] } : {}), viewport: { width: 1280, height: 860 } })
  // Headless WebKit has no test microphone: a silent oscillator stands in for the microphone.
  if (MOTOR === "webkit")
    await ctx.addInitScript(() => {
      const falso = async () => {
        const audio = new AudioContext()
        const destino = audio.createMediaStreamDestination()
        const ganho = audio.createGain()
        ganho.gain.value = 0
        const oscilador = audio.createOscillator()
        oscilador.connect(ganho).connect(destino)
        oscilador.start()
        return destino.stream
      }
      Object.defineProperty(MediaDevices.prototype, "getUserMedia", { value: falso, configurable: true, writable: true })
    })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e?.message ?? e)))
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome: "Ana", frase: "frase-de-verificacao-2026", servidor: srv.NOME })
  await dentro(page)
  await criarCanal(page, "ensaio")
  await abrirCanal(page, "ensaio")
  check("a Ana entra em «voz»", await entrarNaVoz(page))
  await page.locator(".room-glyph.room-live").first().waitFor({ timeout: 30_000 })
  await page.locator(".call-chip [data-anel][data-em-chamada]").first().waitFor({ timeout: 30_000 })

  for (const [modo, preferencia] of [["normal", "no-preference"], ["reduzido", "reduce"]]) {
    await page.emulateMedia({ reducedMotion: preferencia })
    await dormir(1500)
    const animacoes = await page.evaluate(ler)
    resultado[modo] = animacoes.map((x) => `${x.nome}:${x.duracao}${x.infinita ? "∞" : ""}:${x.estado}`)
    for (const [nome, ms] of Object.entries(ESPERADO[modo])) {
      const achadas = animacoes.filter((x) => x.nome === nome)
      check(`${modo}: ${nome} a correr, ${ms} ms, sem fim`, achadas.length > 0 && achadas.every((x) => x.duracao === ms && x.infinita && x.estado === "running"), JSON.stringify(achadas))
    }
    const congeladas = animacoes.filter((x) => x.duracao < 50 && x.infinita)
    check(`${modo}: nenhuma animação contínua congelada a 0,01 ms`, congeladas.length === 0, JSON.stringify(congeladas))
  }
  check("nenhum erro de página", erros.length === 0, erros.slice(0, 2).join(" | "))
} catch (erro) {
  check("o percurso correu até ao fim", false, String(erro?.message ?? erro).split("\n")[0])
} finally {
  await browser?.close().catch(() => {})
  srv.fechar()
}
const falhas = passos.filter((p) => !p.ok)
console.log(`\n${passos.length - falhas.length}/${passos.length} verificações passaram`)
console.log(`PROVA-JSON ${JSON.stringify({ motor: MOTOR, passos, resultado })}`)
process.exit(falhas.length === 0 ? 0 : 1)
