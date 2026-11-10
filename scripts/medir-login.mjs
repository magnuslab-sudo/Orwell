/**
 * Login timeline on an account with a vault from real usage.
 *
 *   npm run build
 *   node scripts/medir-login.mjs                               (this dist only)
 *   DISTS=agora:apps/web/dist,v110:.verify-data/v110/apps/web/dist node scripts/medir-login.mjs
 *   VOLTAS=5 MEMBROS=34 MENSAGENS=360 PERFIL=1 node scripts/medir-login.mjs
 *
 * Owner complaint (3/11/2026): "login seems very slow". Server responds in 0,2 s;
 * this measures the client side.
 *
 * LOCAL BY DESIGN: own homeserver in a disposable folder, free ports at
 * 127.0.0.1, server name is `localhost:<porta>`.
 *
 * How:
 * 1. Seeds in Node with real core: the "Owner" account and MEMBERS accounts
 *    in the common room, 3 comunidades with 4 convidados each, and MESSAGES messages in the
 *    common room (plus 40 em each community). Six members stay connected, as on
 *    a normal day; the rest log out.
 * 2. Takes the Owner vault bytes and disconnects it. This vault is the
 *    measured account: each loop puts it in a fresh browser profile (IndexedDB
 *    `enclave`/`vault`, key `current`, same place where `BrowserVaultBackend` stores it) and opens
 *    the app. Both versions open the SAME bytes.
 * 3. Marks taken inside the page (`performance.now()`, counting from start of
 *    navigation): the gate, "Log in", Argon2id Worker starting and ending,
 *    WebSocket, app open, first message on screen. And long tasks (> 50 ms)
 *    from Chromium for "usable": first moment after app open with one full
 *    second with no long task.
 * 4. With session remembered: loop checks "Remember session" on login then
 *    reloads the page; measures open without password.
 *
 * PERFIL=1 grava a CPU profile (CDP) of the first loop of each dist in `.verify-data/login-lento/`.
 */
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { loadavg } from "node:os"
import { extname, join, normalize, resolve as resolverCaminho } from "node:path"
import { fileURLToPath } from "node:url"
import { webcrypto } from "node:crypto"
import { chromium } from "playwright"
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala, parseServerName } from "@enclave/protocol"
if (!globalThis.crypto) globalThis.crypto = webcrypto

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const FRASE = "frase-de-medida-do-login-2026"
const MEMBROS = Number(process.env.MEMBROS ?? 34)
const MENSAGENS = Number(process.env.MENSAGENS ?? 360)
const VOLTAS = Number(process.env.VOLTAS ?? 3)
const PERFIL = process.env.PERFIL === "1"
const PAUSA_MS = Number(process.env.PAUSA_MS ?? 0)
const SAIDA = join(RAIZ, ".verify-data/login-lento")
mkdirSync(SAIDA, { recursive: true })
const DISTS = (process.env.DISTS ?? "agora:apps/web/dist").split(",").filter((par) => par && par !== "-").map((par) => {
  const [rotulo, caminho] = par.split(":")
  return { rotulo, dist: resolverCaminho(RAIZ, caminho) }
})
for (const { dist } of DISTS) if (!existsSync(join(dist, "index.html"))) throw new Error(`Falta ${dist}/index.html: corre \`npm run build\`.`)
const pausa = (ms) => new Promise((r) => setTimeout(r, ms))
/*
  A batch of 30 entries in the common room, in Node, sometimes leaves a member
  with a loose MLS rejection (removed from the group mid-send). It is the member
  left out, not the measurement: count it and move on.
*/
let rejeicoesSoltas = 0
process.on("unhandledRejection", (erro) => {
  rejeicoesSoltas++
  if (process.env.VERBOSO) console.log(`  rejeição solta: ${erro?.message ?? erro}`)
})

async function portaLivre() {
  return new Promise((resolve, reject) => {
    const sonda = net.createServer()
    sonda.once("error", reject)
    sonda.listen(0, "127.0.0.1", () => {
      const { port } = sonda.address()
      sonda.close(() => resolve(port))
    })
  })
}

// --- server and frontend -----------------------------------------------------
/*
  The seed: the seeded server and the Owner's vault, saved so measurements before
  and after the fix open EXACTLY the same account. Each run starts the server in
  a copy of it, and the seed stays as it was.
*/
const SEMENTE = process.env.SEMENTE ? resolverCaminho(RAIZ, process.env.SEMENTE) : join(SAIDA, "semente")
const FICHA_DA_SEMENTE = join(SEMENTE, "semente.json")
const reaproveitar = existsSync(FICHA_DA_SEMENTE) && process.env.SEMEAR !== "1"
const ficha = reaproveitar ? JSON.parse(readFileSync(FICHA_DA_SEMENTE, "utf8")) : null
const PORTA_DA_FRENTE = ficha?.porta ?? (await portaLivre())
const PORTA_DO_SERVIDOR = await portaLivre()
const NOME = `localhost:${PORTA_DA_FRENTE}`
const SALA = `!orwell:${NOME}`
const APP = `http://${NOME}/app/?lingua=pt`
const dados = mkdtempSync(join(SAIDA, "servidor-"))
if (reaproveitar) cpSync(join(SEMENTE, "servidor"), dados, { recursive: true })
let servidor = null
let registoDoServidor = ""
function arrancarServidor() {
  servidor = spawn(process.execPath, [SERVIDOR_JS], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      ENCLAVE_DATA_DIR: dados,
      ENCLAVE_SERVER_NAME: NOME,
      ENCLAVE_BIND_HOST: "127.0.0.1",
      ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR),
      ENCLAVE_COMMUNITY_MODE: "true",
      ENCLAVE_COMMON_ROOM: SALA,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  servidor.stdout.on("data", (b) => (registoDoServidor += b))
  servidor.stderr.on("data", (b) => (registoDoServidor += b))
}
async function servidorDePe() {
  for (let volta = 0; volta < 60; volta++) {
    const ok = await new Promise((resolve) => {
      const sonda = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => (sonda.destroy(), resolve(true)))
      sonda.on("error", () => resolve(false))
    })
    if (ok) return
    await pausa(250)
  }
  throw new Error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
}
arrancarServidor()

let distActual = DISTS[0]?.dist ?? ""
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json", ".wasm": "application/wasm" }
const frente = http.createServer((pedido, resposta) => {
  const caminho = (pedido.url ?? "/").split("?")[0]
  if (caminho === "/semear") {
    resposta.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    resposta.end("<!doctype html><title>semear</title>")
    return
  }
  if (caminho.startsWith("/app")) {
    const relativo = normalize(decodeURIComponent(caminho.slice("/app".length))).replace(/^(\.\.[/\\])+/, "")
    let ficheiro = join(distActual, relativo)
    if (!ficheiro.startsWith(distActual) || !existsSync(ficheiro) || statSync(ficheiro).isDirectory()) ficheiro = join(distActual, "index.html")
    resposta.writeHead(200, { "content-type": TIPOS[extname(ficheiro)] ?? "application/octet-stream", "cache-control": "no-cache" })
    resposta.end(readFileSync(ficheiro))
    return
  }
  const adiante = http.request({ host: "127.0.0.1", port: PORTA_DO_SERVIDOR, path: pedido.url, method: pedido.method, headers: pedido.headers }, (vinda) => {
    resposta.writeHead(vinda.statusCode ?? 502, vinda.headers)
    vinda.pipe(resposta)
  })
  adiante.on("error", () => {
    resposta.writeHead(502)
    resposta.end()
  })
  pedido.pipe(adiante)
})
frente.on("upgrade", (pedido, socket, cabeca) => {
  const destino = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => {
    const linhas = [`${pedido.method} ${pedido.url} HTTP/${pedido.httpVersion}`]
    for (let i = 0; i < pedido.rawHeaders.length; i += 2) linhas.push(`${pedido.rawHeaders[i]}: ${pedido.rawHeaders[i + 1]}`)
    destino.write(`${linhas.join("\r\n")}\r\n\r\n`)
    if (cabeca.length) destino.write(cabeca)
    socket.pipe(destino).pipe(socket)
  })
  destino.on("error", () => socket.destroy())
  socket.on("error", () => destino.destroy())
})
await new Promise((resolve) => frente.listen(PORTA_DA_FRENTE, "127.0.0.1", resolve))
await servidorDePe()
const todas = []
const acabar = (codigo) => {
  for (const c of todas) c.session.disconnect()
  frente.close()
  servidor?.kill()
  rmSync(dados, { recursive: true, force: true })
  process.exit(codigo)
}

// --- semear ---------------------------------------------------------------------
class MemoryBackend {
  bytes = null
  supportsOsProtection = false
  async read() { return this.bytes }
  async write(b) { this.bytes = b }
  async clear() { this.bytes = null }
}

async function conta(nome, frase = "frase-de-um-membro") {
  const backend = new MemoryBackend()
  const vault = new Vault(backend)
  await vault.create(frase)
  const session = new Session(vault)
  await session.createIdentity(NOME)
  session.on("status", (s) => {
    if (process.env.VERBOSO) console.log(`  [${nome}] ${s.level} ${s.code ?? ""} ${s.detail}`)
  })
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  void session.ensureCommonRoom().catch(() => {})
  const c = { nome, vault, session, backend }
  todas.push(c)
  return c
}
async function ate(condicao, msMax) {
  const fim = Date.now() + msMax
  while (Date.now() < fim) {
    if (condicao()) return true
    await pausa(200)
  }
  return false
}
const naSala = (c, canal = SALA) => c.session.channels.includes(canal)
const mensagem = (corpo) => ({ t: "message", id: `m-${Date.now()}-${Math.random().toString(36).slice(2)}`, sentAt: Date.now(), body: corpo, attachments: [] })
const FRASES = [
  "Alguém já viu o novo relatório?",
  "Bom dia a todos, hoje há reunião às dez.",
  "Concordo, mas convém ler o documento antes de decidir.",
  "Deixo aqui a ligação que prometi ontem, vejam com calma.",
  "Isto ficou muito melhor do que a versão anterior, obrigado pelo trabalho.",
  "Quem fica com a acta desta vez?",
]

async function semear() {
const t0 = Date.now()
console.log(`Servidor ${NOME}. A semear: ${MEMBROS} membros, ${MENSAGENS} mensagens na sala comum, 3 comunidades.`)
const dono = await conta("Dono", FRASE)
if (!(await ate(() => naSala(dono), 30_000))) { console.log("O Dono não entrou na sala comum"); acabar(2) }
const membros = []
for (let i = 0; i < MEMBROS; i++) {
  const c = await conta(`Membro ${String(i + 1).padStart(2, "0")}`)
  if (!(await ate(() => naSala(c), 30_000))) console.log(`  ${c.nome} não entrou na sala comum`)
  membros.push(c)
  await pausa(1_500)
}
console.log(`  ${membros.filter((c) => naSala(c)).length}/${MEMBROS} na sala comum, ${rejeicoesSoltas} rejeições soltas (${((Date.now() - t0) / 1000).toFixed(0)} s)`)

const comunidades = []
for (let k = 0; k < 3; k++) {
  const canal = moradaDeSala(parseServerName(NOME))
  await dono.session.createSpace(canal, undefined, `Comunidade ${k + 1}`)
  const link = await dono.session.createInvite(canal)
  for (const c of membros.slice(k * 4, k * 4 + 4)) {
    await c.session.redeemInvite(link).catch((e) => console.log(`  convite falhou para ${c.nome}: ${e.message}`))
    await ate(() => naSala(c, canal), 20_000)
  }
  comunidades.push(canal)
}
console.log(`  3 comunidades, ${comunidades.map((canal) => dono.session.membersOf(canal).length).join("/")} membros`)

for (let i = 0; i < MENSAGENS; i++) {
  const quem = i % 5 === 0 ? dono : membros[i % membros.length]
  await quem.session.send(SALA, mensagem(`${FRASES[i % FRASES.length]} (${i + 1})`)).catch(() => rejeicoesSoltas++)
  if (i % 20 === 19) await pausa(100)
}
for (const [k, canal] of comunidades.entries()) {
  const deles = [dono, ...membros.slice(k * 4, k * 4 + 4)]
  for (let i = 0; i < 40; i++) await deles[i % deles.length].session.send(canal, mensagem(`${FRASES[i % FRASES.length]} [${k + 1}.${i + 1}]`)).catch(() => rejeicoesSoltas++)
}
const naConversa = (canal) => dono.session.history(canal).filter((e) => e.payload?.t === "message").length
await ate(() => naConversa(SALA) >= Math.min(MENSAGENS, 380) - 5, 60_000)
await pausa(3_000)
await dono.session.flush()
const bytesDoCofre = new Uint8Array(dono.backend.bytes)
console.log(`  cofre do Dono: ${(bytesDoCofre.length / 1024).toFixed(0)} KiB, ${naConversa(SALA)} mensagens na sala comum, ${dono.session.channels.length} canais (semeado em ${((Date.now() - t0) / 1000).toFixed(0)} s)`)
// Everyone leaves: the seed is a stopped server, copied whole.
for (const c of todas.splice(0)) c.session.disconnect()
await pausa(2_000)
servidor.kill()
await new Promise((resolve) => servidor.once("exit", resolve))
rmSync(SEMENTE, { recursive: true, force: true })
cpSync(dados, join(SEMENTE, "servidor"), { recursive: true })
writeFileSync(FICHA_DA_SEMENTE, JSON.stringify({ porta: PORTA_DA_FRENTE, membros: MEMBROS, mensagens: MENSAGENS, cofre: Buffer.from(bytesDoCofre).toString("base64") }))
console.log(`  semente guardada em ${SEMENTE}`)
arrancarServidor()
await servidorDePe()
return Buffer.from(bytesDoCofre).toString("base64")

}
const bytesB64 = reaproveitar ? ficha.cofre : await semear()
const bytesDoCofreParaFicheiro = () => Buffer.from(bytesB64, "base64")

/*
  The owner coming back after time away (ATRASO=N): N new accounts enter the
  common room (each is an MLS commit the Owner's vault has not seen yet, plus its
  profile) and each posts POR_NOVA messages. Then they leave. Each iteration opens
  the same vault and hits the same server lag.
*/
const ATRASO = Number(process.env.ATRASO ?? 0)
const POR_NOVA = Number(process.env.POR_NOVA ?? 20)
if (ATRASO > 0) {
  const tA = Date.now()
  let entraram = 0
  for (let i = 0; i < ATRASO; i++) {
    const c = await conta(`Novo ${String(i + 1).padStart(2, "0")}`)
    if (await ate(() => naSala(c), 30_000)) entraram++
    for (let k = 0; k < POR_NOVA; k++) await c.session.send(SALA, mensagem(`${FRASES[k % FRASES.length]} (novo ${i + 1}.${k + 1})`)).catch(() => rejeicoesSoltas++)
  }
  await pausa(2_000)
  for (const c of todas.splice(0)) c.session.disconnect()
  console.log(`Atraso: ${entraram}/${ATRASO} contas novas na sala comum, ${ATRASO * POR_NOVA} mensagens (${((Date.now() - tA) / 1000).toFixed(0)} s).`)
}
if (reaproveitar) console.log(`Semente reaproveitada (${ficha.membros} membros, ${ficha.mensagens} mensagens), servidor ${NOME}.`)

// --- medir ----------------------------------------------------------------------
/** The marks inside the page before the app loads. */
function instrumentar() {
  const marcas = {}
  const longas = []
  const tramas = []
  window.__tramas = tramas
  window.__marcas = marcas
  window.__longas = longas
  const marcar = (nome) => {
    if (!(nome in marcas)) marcas[nome] = performance.now()
  }
  window.__marcar = marcar
  try {
    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries()) longas.push([e.startTime, e.duration])
    }).observe({ type: "longtask", buffered: true })
  } catch {}
  const W = window.Worker
  window.Worker = function (url, opcoes) {
    const w = new W(url, opcoes)
    if (/kdf/.test(String(url))) {
      const pm = w.postMessage.bind(w)
      w.postMessage = (m, t) => {
        marcas.derivacoes = (marcas.derivacoes ?? 0) + 1
        marcar("kdf-inicio")
        return pm(m, t)
      }
      w.addEventListener("message", () => marcar("kdf-fim"))
    }
    return w
  }
  window.Worker.prototype = W.prototype
  const WS = window.WebSocket
  window.WebSocket = function (...args) {
    const s = new WS(...args)
    marcar("ws-criado")
    s.addEventListener("open", () => marcar("ws-aberto"))
    s.addEventListener("message", (e) => {
      marcar("ws-1a-resposta")
      let t = "?"
      try {
        t = typeof e.data === "string" ? JSON.parse(e.data).t : "binario"
      } catch {}
      tramas.push([Math.round(performance.now()), "<", t])
    })
    const enviar = s.send.bind(s)
    s.send = (dados) => {
      let t = "?"
      try {
        t = typeof dados === "string" ? JSON.parse(dados).t : "binario"
      } catch {}
      tramas.push([Math.round(performance.now()), ">", t])
      return enviar(dados)
    }
    return s
  }
  window.WebSocket.prototype = WS.prototype
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target?.type === "password") marcar("entrar") }, true)
  const ver = () => {
    if (document.querySelector('input[type="password"]')) marcar("portao")
    const botoes = document.querySelectorAll("button")
    for (const b of botoes) {
      if (b.getAttribute("aria-label") === "Configurações" || b.getAttribute("title") === "Configurações") {
        marcar("app")
        break
      }
    }
    if (document.querySelector(".message-body")) marcar("mensagens")
  }
  new MutationObserver(ver).observe(document, { subtree: true, childList: true, attributes: true })
  addEventListener("DOMContentLoaded", () => marcar("dom"))
  addEventListener("load", () => marcar("load"))
}

/** The first moment from `desde` with SILENCIO ms without a long task. */
function utilizavel(longas, desde, silencio = 1000) {
  let t = desde
  for (const [inicio, duracao] of [...longas].sort((a, b) => a[0] - b[0])) {
    const fim = inicio + duracao
    if (fim <= t) continue
    if (inicio < t + silencio) t = fim
    else break
  }
  return t
}
const ocupado = (longas, de, ate) => longas.reduce((n, [i, d]) => n + Math.max(0, Math.min(i + d, ate) - Math.max(i, de)), 0)

async function esperarMarca(page, nome, ms = 90_000) {
  await page.waitForFunction((n) => n in (window.__marcas ?? {}), nome, { timeout: ms, polling: 50 })
}

async function abrirSalaComum(page) {
  // The common room opens by column; if the app already opened on a channel with messages, do not move.
  if (await page.evaluate(() => "mensagens" in window.__marcas)) return
  const botao = page.getByRole("button", { name: /Orwell|Sala comum|Geral/i }).first()
  if (await botao.count()) await botao.click().catch(() => {})
}

async function recolher(page) {
  return page.evaluate(() => ({ marcas: { ...window.__marcas }, longas: [...window.__longas], tramas: [...window.__tramas] }))
}

function linhaDaVolta(m, longas) {
  const r = (x) => (x === undefined ? null : Math.round(x))
  const base = m.app ?? m.mensagens
  const util = base === undefined ? undefined : utilizavel(longas, Math.max(base, m.mensagens ?? base))
  return {
    load: r(m.load),
    portao: r(m.portao),
    argon2: m["kdf-fim"] !== undefined && m["kdf-inicio"] !== undefined ? r(m["kdf-fim"] - m["kdf-inicio"]) : null,
    entrar_kdf: m["kdf-inicio"] !== undefined && m.entrar !== undefined ? r(m["kdf-inicio"] - m.entrar) : null,
    cofre_ws: m["ws-aberto"] !== undefined && m["kdf-fim"] !== undefined ? r(m["ws-aberto"] - m["kdf-fim"]) : null,
    entrar_app: m.app !== undefined && m.entrar !== undefined ? r(m.app - m.entrar) : null,
    entrar_msgs: m.mensagens !== undefined && m.entrar !== undefined ? r(m.mensagens - m.entrar) : null,
    entrar_util: util !== undefined && m.entrar !== undefined ? r(util - m.entrar) : null,
    app: r(m.app),
    msgs: r(m.mensagens),
    util: r(util),
    longas_ms: r(ocupado(longas, m.entrar ?? 0, (m.entrar ?? 0) + 20_000)),
    derivacoes: m.derivacoes ?? 0,
    maior_longa: r(Math.max(0, ...longas.filter(([i]) => i >= (m.entrar ?? 0)).map(([, d]) => d))),
  }
}

const browser = await chromium.launch({ headless: true })
const resultados = {}
for (const { rotulo, dist } of DISTS) {
  distActual = dist
  resultados[rotulo] = { frase: [], memorizada: [] }
  for (let volta = 0; volta < VOLTAS; volta++) {
    /*
      Server allows 60 pedidos history per ACCOUNT per minute (\`BACKFILLS_POR_MINUTO\`) and silences
      the rest; client expects 10 s per silenced page. Back-to-back loops of
      the same account fill that bucket: with PAUSA_MS=65000 cada loop starts with
      an empty bucket.
    */
    if (PAUSA_MS > 0 && (volta > 0 || rotulo !== DISTS[0].rotulo)) await pausa(PAUSA_MS)
    const contexto = await browser.newContext()
    const page = await contexto.newPage()
    const erros = []
    page.on("pageerror", (e) => erros.push(e.message))
    await page.goto(`http://${NOME}/semear`)
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      await new Promise((resolve, reject) => {
        const pedido = indexedDB.open("enclave", 1)
        pedido.onupgradeneeded = () => pedido.result.createObjectStore("vault")
        pedido.onsuccess = () => {
          const tx = pedido.result.transaction("vault", "readwrite")
          tx.objectStore("vault").put(bytes.buffer, "current")
          tx.oncomplete = () => (pedido.result.close(), resolve())
          tx.onerror = () => reject(tx.error)
        }
        pedido.onerror = () => reject(pedido.error)
      })
    }, bytesB64)
    await page.addInitScript(instrumentar)
    const cdp = PERFIL && volta === 0 ? await contexto.newCDPSession(page) : null
    if (cdp) {
      await cdp.send("Profiler.enable")
      await cdp.send("Profiler.setSamplingInterval", { interval: 200 })
    }
    await page.goto(APP)
    await esperarMarca(page, "portao")
    const campo = page.locator('input[type="password"]').first()
    await campo.fill(FRASE)
    const caixa = page.locator('input[name="memorizar"]')
    if (await caixa.count()) await caixa.setChecked(true)
    if (cdp) await cdp.send("Profiler.start")
    await campo.press("Enter")
    await esperarMarca(page, "app")
    await page.waitForTimeout(1_500)
    await abrirSalaComum(page)
    await esperarMarca(page, "mensagens", 30_000).catch(() => {})
    await page.waitForTimeout(16_000)
    if (cdp) {
      const { profile } = await cdp.send("Profiler.stop")
      writeFileSync(join(SAIDA, `perfil-${rotulo}.cpuprofile`), JSON.stringify(profile))
    }
    const a = await recolher(page)
    resultados[rotulo].frase.push(linhaDaVolta(a.marcas, a.longas))
    writeFileSync(join(SAIDA, `tramas-${rotulo}-${volta + 1}-frase.json`), JSON.stringify({ marcas: a.marcas, tramas: a.tramas }))

    // Memorized: reload without password.
    await page.reload()
    await esperarMarca(page, "app").catch(() => {})
    const viuPortao = await page.evaluate(() => "portao" in window.__marcas)
    await page.waitForTimeout(1_500)
    await abrirSalaComum(page)
    await esperarMarca(page, "mensagens", 30_000).catch(() => {})
    await page.waitForTimeout(8_000)
    const b = await recolher(page)
    writeFileSync(join(SAIDA, `tramas-${rotulo}-${volta + 1}-memo.json`), JSON.stringify({ marcas: b.marcas, tramas: b.tramas }))
    const linha = linhaDaVolta({ ...b.marcas, entrar: 0 }, b.longas)
    resultados[rotulo].memorizada.push({ ...linha, pediu_frase: viuPortao })
    if (erros.length) console.log(`  [${rotulo} ${volta + 1}] erros na página: ${erros.slice(0, 3).join(" | ")}`)
    console.log(`  [${rotulo} ${volta + 1}] frase ${JSON.stringify(resultados[rotulo].frase.at(-1))}`)
    console.log(`  [${rotulo} ${volta + 1}] memo  ${JSON.stringify(resultados[rotulo].memorizada.at(-1))}`)
    await contexto.close()
  }
}
await browser.close()

/*
  The desktop app (SECRETARIA=rotulo:out,...): the main process for real
  (`secretaria.mjs`), with the Owner's vault written to `vault.enc` in a fresh
  data folder. No "Remember": on macOS that touches the keychain. Marks from the
  script side (25 ms polling), counting from the "Sign in" click.
*/
const SECRETARIAS = (process.env.SECRETARIA ?? "").split(",").filter(Boolean).map((par) => {
  const [rotulo, caminho] = par.split(":")
  return { rotulo, principal: join(resolverCaminho(RAIZ, caminho), "main/index.cjs") }
})
const naSecretaria = {}
if (SECRETARIAS.length) {
  const { abrirSecretaria } = await import("./secretaria.mjs")
  for (const { rotulo, principal } of SECRETARIAS) {
    naSecretaria[rotulo] = []
    for (let volta = 0; volta < VOLTAS; volta++) {
      // The same history request bucket per account (see above).
      if (PAUSA_MS > 0 && (volta > 0 || rotulo !== SECRETARIAS[0].rotulo || DISTS.length > 0)) await pausa(PAUSA_MS)
      const pasta = mkdtempSync(join(SAIDA, "secretaria-"))
      writeFileSync(join(pasta, "vault.enc"), bytesDoCofreParaFicheiro())
      const inicio = Date.now()
      const app = await abrirSecretaria({ rotulo, dados: pasta, principal })
      const { page } = app
      const ate = async (seletor, ms = 90_000) => {
        await page.waitForSelector(seletor, { timeout: ms, state: "attached" })
        return Date.now()
      }
      try {
        const portao = await ate('input[type="password"]')
        await page.fill('input[type="password"]', FRASE)
        const caixa = page.locator('input[name="memorizar"]')
        if (await caixa.count()) await caixa.setChecked(false)
        const entrar = Date.now()
        await page.press('input[type="password"]', "Enter")
        const aberta = await ate('button[aria-label="Configurações"], button[title="Configurações"]')
        let msgs = await ate(".message-body", 1_500).catch(() => null)
        if (msgs === null) {
          const botao = page.getByRole("button", { name: /Orwell|Sala comum|Geral/i }).first()
          if (await botao.count()) await botao.click().catch(() => {})
          msgs = await ate(".message-body", 30_000).catch(() => null)
        }
        const linha = { portao: portao - inicio, entrar_app: aberta - entrar, entrar_msgs: msgs === null ? null : msgs - entrar }
        naSecretaria[rotulo].push(linha)
        console.log(`  [secretaria ${rotulo} ${volta + 1}] ${JSON.stringify(linha)}`)
      } catch (erro) {
        console.log(`  [secretaria ${rotulo} ${volta + 1}] falhou: ${erro.message}\n${app.registo.slice(-8).join("\n")}`)
      } finally {
        await app.fechar()
      }
    }
  }
}

const mediana = (xs) => {
  const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)] : null
}
for (const tipo of DISTS.length ? ["frase", "memorizada"] : []) {
  console.log(`\nMedianas (${tipo}, ms; ${VOLTAS} voltas):`)
  const chaves = Object.keys(resultados[DISTS[0].rotulo][tipo][0]).filter((k) => k !== "pediu_frase")
  console.log(["", ...chaves].join("\t"))
  for (const { rotulo } of DISTS) console.log([rotulo, ...chaves.map((k) => mediana(resultados[rotulo][tipo].map((l) => l[k])))].join("\t"))
}
for (const { rotulo } of SECRETARIAS) {
  const linhas = naSecretaria[rotulo]
  if (!linhas?.length) continue
  console.log(`secretaria ${rotulo}: portão ${mediana(linhas.map((l) => l.portao))} ms, Entrar→app ${mediana(linhas.map((l) => l.entrar_app))} ms, Entrar→mensagens ${mediana(linhas.map((l) => l.entrar_msgs))} ms`)
}
writeFileSync(join(SAIDA, `resultados-${Date.now()}.json`), JSON.stringify({ resultados, naSecretaria }, null, 1))
console.log(`\nCarga da máquina: ${loadavg().map((x) => x.toFixed(2)).join(" ")}`)
acabar(0)
