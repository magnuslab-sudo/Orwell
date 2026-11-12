/**
 * The late pong: how many reconnections and how much delay in sends (1.3.7).
 *
 *   node scripts/e2e-pong-atrasado.mjs [web folder] [label]   (needs `npm run build` first)
 *
 * Why: after 1.3.6, the gateway's reconnections went from ~24 to 50 to 62 per
 * hour. The check treated the connection as dead if the `pong` did not arrive
 * within 5 s, and the server answers in order, behind slow work.
 *
 * The setup: one account in Chromium, with the socket going through
 * `routeWebSocket`. Each server `pong` arrives 6 s late; everything else goes
 * through at once. For `DURACAO_MS`: one message every 10 s and one return to
 * the page (`visibilitychange`) every 20 s. The interface pulse runs on its own.
 *
 * Measures: sockets opened after the first one (reconnections), and, per
 * message, the time between Enter and the `channel.send` frame leaving the browser.
 *
 * Passing the `apps/web/dist` folder of another version compares versions
 * against the same server. ALL LOCAL AND DISPOSABLE: `servidor-descartavel.mjs`.
 */
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const DIST = process.argv[2]
const ETIQUETA = process.argv[3] ?? "esta"
const ATRASO_DO_PONG_MS = 6_000
const DURACAO_MS = Number(process.env["DURACAO_MS"] ?? 100_000)
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const servidor = await levantarServidor({ frente: 8793, servidor: 8794, etiqueta: "pong-atrasado", ...(DIST ? { dist: DIST } : {}) })
const browser = await chromium.launch({ headless: true })
let sockets = 0
let pings = 0
const enviosEm = []
try {
  const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1200, height: 860 } })
  await ctx.routeWebSocket(/\/_enclave\/gateway/, (ws) => {
    sockets += 1
    const doServidor = ws.connectToServer()
    ws.onMessage((mensagem) => {
      try {
        const t = JSON.parse(String(mensagem)).t
        if (t === "ping") pings += 1
        if (t === "channel.send") enviosEm.push(Date.now())
      } catch {
        // Not JSON: passes anyway.
      }
      doServidor.send(mensagem)
    })
    doServidor.onMessage((mensagem) => {
      let pong = false
      try {
        pong = JSON.parse(String(mensagem)).t === "pong"
      } catch {
        // same
      }
      if (pong) setTimeout(() => ws.send(mensagem), ATRASO_DO_PONG_MS)
      else ws.send(mensagem)
    })
  })
  const page = await ctx.newPage()
  await page.goto(servidor.APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome: "Ana", servidor: servidor.NOME })
  await page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
  const caixa = page.getByPlaceholder("Escreve uma mensagem").first()
  await caixa.waitFor({ timeout: 90_000 })
  await espera(5_000)
  const socketsNoInicio = sockets
  const latencias = []
  const inicio = Date.now()
  let n = 0
  while (Date.now() - inicio < DURACAO_MS) {
    n += 1
    if (n % 2 === 0) await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
    await espera(300)
    const antes = enviosEm.length
    await caixa.fill(`mensagem-${n}`)
    const partiu = Date.now()
    await caixa.press("Enter")
    const limite = Date.now() + 20_000
    while (enviosEm.length === antes && Date.now() < limite) await espera(20)
    latencias.push(enviosEm.length > antes ? enviosEm[antes] - partiu : null)
    await espera(Math.max(0, 10_000 - (Date.now() - partiu)))
  }
  const medidas = latencias.filter((ms) => ms !== null).sort((a, b) => a - b)
  const religacoes = sockets - socketsNoInicio
  const resumo = {
    versao: ETIQUETA,
    duracaoS: Math.round(DURACAO_MS / 1000),
    religacoes,
    religacoesPorHora: Math.round((religacoes * 3_600_000) / DURACAO_MS),
    pings,
    envios: latencias.length,
    perdidos: latencias.filter((ms) => ms === null).length,
    latenciaMedianaMs: medidas[Math.floor(medidas.length / 2)] ?? null,
    latenciaMaximaMs: medidas.at(-1) ?? null,
  }
  console.log(`MEDIDA-PONG ${JSON.stringify(resumo)}`)
} finally {
  await browser.close().catch(() => {})
  servidor.fechar()
}
