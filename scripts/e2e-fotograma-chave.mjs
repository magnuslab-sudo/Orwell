/**
 * Live M2 phase: when someone SEES a screen, they request a keyframe when the
 * image breaks, and the request reaches the sender, capped at one per second.
 *
 * ```
 * npm run build && node scripts/e2e-fotograma-chave.mjs
 * SABOTAGEM=sem-congelar node scripts/e2e-fotograma-chave.mjs   # MUST exit with 1
 * ```
 *
 * For the product, via SFU: two accounts, one invite, the voice room, screen
 * share from A (an animated canvas in place of `getDisplayMedia`) and B's "View".
 *
 * **The broken image is simulated on the viewer's side**, and only in the
 * numbers: B's `RTCRtpReceiver.getStats` adds `window.__congelar` to the video's `freezeCount`
 * (the actual image stays good). It's the counter that the watcher reads
 * (`VigiaDoFotogramaChave`), and it's what a lost decoder makes go up.
 *
 * **"Reaches" means A receives the request**: the `pliCount` of A's video `outbound-rtp`,
 * which counts the PLIs that the SFU sends it. Measured in two windows
 * of 10 s: without freezing (just the server's 3 s clock, about 3 a 4 PLI) and with
 * the `freezeCount` rising for each 200 ms (the clock plus B's requests,
 * at most one per second). The difference must be between 6 e 12.
 *
 * Sabotage `sem-congelar` does not affect the counter: the second window stays the same
 * as the first, and the race fails. Everything local and disposable. Never
 * production.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { comLingua } from "./ambiente.mjs"
import { criarContaEEntrar } from "./conta.mjs"
import { APP, FRASE, matarTudo, levantarServidor, levantarWeb } from "./sfu-prova-fase2/bancada.mjs"
import { abrirCanal, assentar, criarCanal, entrarNaChamada } from "./sfu-prova-fase2/montagem.mjs"
import { ARGS, partilharEcra, pararEcra } from "./sfu-prova-fase3/montagem.mjs"

const SABOTAGEM = process.env.SABOTAGEM ?? ""
const JANELA_MS = 10_000
const resultados = []
const verificar = (etiqueta, ok, detalhe = "") => {
  resultados.push({ etiqueta, ok })
  console.log(`${ok ? "PASS" : "FALHA"}  ${etiqueta}${detalhe ? ` -- ${detalhe}` : ""}`)
}
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A's fake screen, and each one's connections, captured at birth. */
const SONDAS = () => {
  window.__pcs = []
  const Original = window.RTCPeerConnection
  window.RTCPeerConnection = function (...argumentos) {
    const pc = new Original(...argumentos)
    window.__pcs.push(pc)
    return pc
  }
  window.RTCPeerConnection.prototype = Original.prototype
  Object.setPrototypeOf(window.RTCPeerConnection, Original)

  // The broken image, only in the numbers: see the header.
  window.__congelar = 0
  const ler = RTCRtpReceiver.prototype.getStats
  RTCRtpReceiver.prototype.getStats = async function (...argumentos) {
    const relatorio = await ler.apply(this, argumentos)
    if (this.track?.kind !== "video" || window.__congelar === 0) return relatorio
    const copia = new Map()
    relatorio.forEach((linha, chave) => {
      copia.set(chave, linha.type === "inbound-rtp" ? { ...linha, freezeCount: (linha.freezeCount ?? 0) + window.__congelar } : linha)
    })
    return copia
  }

  navigator.mediaDevices.getDisplayMedia = async () => {
    const tela = document.createElement("canvas")
    tela.width = 1280
    tela.height = 720
    const g = tela.getContext("2d")
    let n = 0
    setInterval(() => {
      g.fillStyle = `hsl(${(n++ * 7) % 360} 60% 35%)`
      g.fillRect(0, 0, 1280, 720)
      g.fillStyle = "#fff"
      g.font = "64px sans-serif"
      g.fillText(`ecrã ${n}`, 60, 120)
    }, 66)
    return new MediaStream([tela.captureStream(15).getVideoTracks()[0]])
  }
}

/** PLIs received and keyframes encoded by the video A sends. */
const ENVIO_DE_VIDEO = async () => {
  let pli = 0
  let chaves = 0
  for (const pc of window.__pcs) {
    if (pc.connectionState === "closed") continue
    const relatorio = await pc.getStats().catch(() => null)
    relatorio?.forEach((r) => {
      if (r.type === "outbound-rtp" && r.kind === "video") {
        pli += r.pliCount ?? 0
        chaves += r.keyFramesEncoded ?? 0
      }
    })
  }
  return { pli, chaves }
}

/** Frames decoded from the video B receives: the image keeps moving. */
const RECEBIDO = async () => {
  let fotogramas = 0
  for (const pc of window.__pcs) {
    if (pc.connectionState === "closed") continue
    const relatorio = await pc.getStats().catch(() => null)
    relatorio?.forEach((r) => {
      if (r.type === "inbound-rtp" && r.kind === "video") fotogramas += r.framesDecoded ?? 0
    })
  }
  return fotogramas
}

async function abrirConta({ nome, indice, perfil }) {
  const ctx = await chromium.launchPersistentContext(`${perfil}/${indice}`, { headless: true, args: ARGS, permissions: ["microphone", "camera"] })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.addInitScript(SONDAS)
  await page.goto(comLingua(APP), { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2000)
  await criarContaEEntrar(page, { nome, frase: FRASE })
  return { ctx, page, nome }
}

async function janela(a, b, congelar) {
  const antes = await a.page.evaluate(ENVIO_DE_VIDEO)
  const vistosAntes = await b.page.evaluate(RECEBIDO)
  const fim = Date.now() + JANELA_MS
  while (Date.now() < fim) {
    if (congelar) await b.page.evaluate(() => void (window.__congelar += 1))
    await dormir(200)
  }
  const depois = await a.page.evaluate(ENVIO_DE_VIDEO)
  const vistos = (await b.page.evaluate(RECEBIDO)) - vistosAntes
  return { pli: depois.pli - antes.pli, chaves: depois.chaves - antes.chaves, vistos }
}

async function correr() {
  console.log("\n== O fotograma-chave a pedido de quem vê, por SFU")
  const dados = mkdtempSync(join(tmpdir(), "orwell-fotograma-chave-"))
  const perfis = mkdtempSync(join(tmpdir(), "orwell-fotograma-chave-perfis-"))
  const sala = `chave ${Date.now().toString(36)}`
  const clientes = []
  try {
    if (!(await levantarServidor(dados, { comSfu: true }))) throw new Error("o homeserver não subiu")
    if (!(await levantarWeb())) throw new Error("o vite não subiu")
    for (const indice of [0, 1]) clientes.push(await abrirConta({ nome: `chave ${indice}`, indice, perfil: perfis }))
    const [a, b] = clientes
    await criarCanal(a.page, sala)
    const entrou = await assentar(a, b, sala)
    verificar("o convidado aceita e fica no canal", entrou)
    if (!entrou) return
    for (const cliente of [a, b]) {
      await abrirCanal(cliente.page, sala)
      verificar(`${cliente.nome} entra na sala de voz`, await entrarNaChamada(cliente.page))
      await cliente.page.waitForTimeout(1500)
    }
    await dormir(4000)

    verificar("A partilha o ecrã", await partilharEcra(a.page))
    const ver = b.page.getByRole("button", { name: /^Ver (o ecrã|a transmissão) de/ }).first()
    const temVer = await ver.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false)
    verificar('B tem o "Ver"', temVer)
    if (!temVer) return
    await b.page.locator(".call-chip.ao-vivo-convida").first().hover()
    await ver.click()
    await dormir(6000)

    const calmo = await janela(a, b, false)
    console.log(`       sem congelar: ${calmo.pli} PLI, ${calmo.chaves} fotogramas-chave, ${calmo.vistos} fotogramas vistos em ${JANELA_MS / 1000} s`)
    verificar("a imagem anda do lado de B", calmo.vistos > 50, `${calmo.vistos} fotogramas`)
    verificar("sem congelar, só o relógio do servidor pede (no máximo 5 em 10 s)", calmo.pli <= 5, `${calmo.pli} PLI`)

    const partido = await janela(a, b, SABOTAGEM !== "sem-congelar")
    console.log(`       a congelar:   ${partido.pli} PLI, ${partido.chaves} fotogramas-chave, ${partido.vistos} fotogramas vistos em ${JANELA_MS / 1000} s`)
    const pedidos = partido.pli - calmo.pli
    verificar("com a imagem partida, os pedidos de B chegam a A", pedidos >= 6, `${pedidos} PLI a mais`)
    verificar("e com o tecto: no máximo um por segundo", pedidos <= 12, `${pedidos} PLI a mais em ${JANELA_MS / 1000} s`)
    verificar("e A codifica fotogramas-chave a mais", partido.chaves > calmo.chaves, `${calmo.chaves} → ${partido.chaves}`)
    await pararEcra(a.page)
  } catch (erro) {
    console.error(`\nFALHA  a corrida rebentou: ${erro?.stack ?? erro}`)
    resultados.push({ etiqueta: "a corrida chegou ao fim", ok: false })
  } finally {
    for (const cliente of clientes) await cliente.ctx.close().catch(() => {})
    matarTudo()
    const limpar = (pasta) => rmSync(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    limpar(dados)
    limpar(perfis)
  }
}

await correr()
const passou = resultados.filter((r) => r.ok).length
console.log(`\n${passou}/${resultados.length} verificações passaram`)
process.exit(passou === resultados.length && resultados.length > 0 ? 0 : 1)
