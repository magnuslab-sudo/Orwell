/**
 * The web app in a shared room at the scale of `!984`, with the room live
 * (slow-after-entry, 4/11/2026).
 *
 * Owner complaints: "it gets slow and glitchy sometimes", "I think it is slow
 * after entering", "when I load a new page it usually takes a while".
 *
 *   npm run build -w @enclave/web
 *   node scripts/medir-sala-comum-viva.mjs
 *   MEMBROS=30 ATRIBUICOES=80 LASTRO_MB=8 ENTRADAS=2 PERFIL=1 DIST=apps/web/dist node scripts/medir-sala-comum-viva.mjs
 *
 * LOCAL BY DESIGN, like `medir-login.mjs` from which this comes: own homeserver
 * in a temporary folder at 127.0.0.1.
 *
 * 1. In Node, with the core for real: Ana creates the shared room and sets it
 *    up like `!984` (3 categories, 10 rooms, a role given to ATRIBUICOES
 *    accounts); MEMBROS accounts join and stay connected; MENSAGENS messages.
 *    The Owner joins, receives LASTRO_MB of vault data (the directory of 150
 *    profiles with avatars and history from real usage) and leaves.
 * 2. The Owner's vault goes to IndexedDB of a Chromium and the app opens with
 *    the password.
 * 3. Measurements on the page: long tasks (> 50 ms, `longtask`), duration of
 *    clicks (Event Timing: from click to next render) and JS heap. With
 *    PERFIL=1, a CPU profile via CDP. Phases: (a) 20 s after entry; (b) for
 *    each of ENTRADAS, a new account joins the shared room and a 30 s window
 *    is measured after; (c) screen changes (rooms, channels, settings).
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { extname, join, normalize, resolve as resolverCaminho } from "node:path"
import { fileURLToPath } from "node:url"
import { webcrypto } from "node:crypto"
import { chromium } from "playwright"
import { Session, Vault } from "@enclave/client-core"
import { generateIdentity, parseServerName } from "@enclave/protocol"
if (!globalThis.crypto) globalThis.crypto = webcrypto

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const FRASE = "frase-de-medida-da-sala-viva-2026"
const MEMBROS = Number(process.env.MEMBROS ?? 30)
const ATRIBUICOES = Number(process.env.ATRIBUICOES ?? 80)
const MENSAGENS = Number(process.env.MENSAGENS ?? 200)
const LASTRO_MB = Number(process.env.LASTRO_MB ?? 8)
const ENTRADAS = Number(process.env.ENTRADAS ?? 2)
const PERFIL = process.env.PERFIL === "1"
const ROTULO = process.env.ROTULO ?? "agora"
const DIST = resolverCaminho(RAIZ, process.env.DIST ?? "apps/web/dist")
const SAIDA = join(RAIZ, ".verify-data/sala-viva")
mkdirSync(SAIDA, { recursive: true })
if (!existsSync(join(DIST, "index.html"))) throw new Error(`Falta ${DIST}/index.html: corre \`npm run build -w @enclave/web\`.`)
const pausa = (ms) => new Promise((r) => setTimeout(r, ms))
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

// --- server and frontend (as in medir-login.mjs) ---------------------------------
const PORTA_DA_FRENTE = await portaLivre()
const PORTA_DO_SERVIDOR = await portaLivre()
const NOME = `localhost:${PORTA_DA_FRENTE}`
const SALA = `!orwell:${NOME}`
const APP = `http://${NOME}/app/?lingua=pt`
const dados = mkdtempSync(join(SAIDA, "servidor-"))
let registoDoServidor = ""
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
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
for (let volta = 0; ; volta++) {
  const ok = await new Promise((resolve) => {
    const sonda = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => (sonda.destroy(), resolve(true)))
    sonda.on("error", () => resolve(false))
  })
  if (ok) break
  if (volta > 60) throw new Error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
  await pausa(250)
}
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".wasm": "application/wasm", ".onnx": "application/octet-stream" }
const frente = http.createServer((pedido, resposta) => {
  const caminho = (pedido.url ?? "/").split("?")[0]
  if (caminho === "/semear") {
    resposta.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    resposta.end("<!doctype html><title>semear</title>")
    return
  }
  if (caminho.startsWith("/app")) {
    const relativo = normalize(decodeURIComponent(caminho.slice("/app".length))).replace(/^(\.\.[/\\])+/, "")
    let ficheiro = join(DIST, relativo)
    if (!ficheiro.startsWith(DIST) || !existsSync(ficheiro) || statSync(ficheiro).isDirectory()) ficheiro = join(DIST, "index.html")
    resposta.writeHead(200, { "content-type": TIPOS[extname(ficheiro)] ?? "application/octet-stream", "cache-control": "no-cache" })
    resposta.end(readFileSync(ficheiro))
    return
  }
  const adiante = http.request({ host: "127.0.0.1", port: PORTA_DO_SERVIDOR, path: pedido.url, method: pedido.method, headers: pedido.headers }, (vinda) => {
    resposta.writeHead(vinda.statusCode ?? 502, vinda.headers)
    vinda.pipe(resposta)
  })
  adiante.on("error", () => (resposta.writeHead(502), resposta.end()))
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
const todas = []
const acabar = (codigo) => {
  for (const c of todas) c.session.disconnect()
  frente.close()
  servidor.kill()
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
  // Thirty-two consecutive connections to a local server on a loaded machine:
  // one or two fail to open ("could not reach the homeserver"), and without a
  // retry the measurement fell into the seeds (two runs out of three in 1.3.2).
  for (let tentativa = 1; ; tentativa++) {
    try {
      await session.connect()
      break
    } catch (erro) {
      if (tentativa >= 5) throw erro
      console.log(`  ${nome}: a ligação falhou (${erro?.message ?? erro}), tentativa ${tentativa + 1}`)
      await pausa(1000 * tentativa)
    }
  }
  await session.updateProfile({ displayName: nome, donations: [] })
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
const naSala = (c) => c.session.channels.includes(SALA)
const mensagem = (corpo) => ({ t: "message", id: `m-${Date.now()}-${Math.random().toString(36).slice(2)}`, sentAt: Date.now(), body: corpo, attachments: [] })

const t0 = Date.now()
console.log(`Servidor ${NOME}. A semear: Ana + Dono + ${MEMBROS} membros, ${ATRIBUICOES} atribuições, ${MENSAGENS} mensagens, cofre do Dono +${LASTRO_MB} MB.`)
const ana = await conta("Ana")
await ana.session.ensureCommonRoom()
if (!(await ate(() => naSala(ana), 30_000))) (console.log("A Ana não entrou"), acabar(2))
if (!ana.session.founderOf(SALA)) await ana.session.claimFounder(SALA)
await ate(() => ana.session.founderOf(SALA) === ana.session.identity.address, 30_000)
for (let c = 0; c < 3; c++) await ana.session.upsertCategory(SALA, { category: `cat${c}`, name: `Categoria ${c + 1}`, position: c })
for (let s = 0; s < 10; s++) await ana.session.upsertRoom(SALA, { room: `sala${s}`, name: `sala ${s + 1}`, category: `cat${s % 3}` })
await ana.session.defineRole(SALA, { role: "membro", name: "Membro", powers: [] })
const dono = await conta("Dono", FRASE)
await dono.session.ensureCommonRoom()
if (!(await ate(() => naSala(dono), 30_000))) (console.log("O Dono não entrou"), acabar(2))
const membros = []
for (let i = 0; i < MEMBROS; i++) {
  const c = await conta(`Membro ${String(i + 1).padStart(2, "0")}`)
  await c.session.ensureCommonRoom().catch(() => {})
  if (!(await ate(() => naSala(c), 30_000))) console.log(`  ${c.nome} não entrou`)
  membros.push(c)
}
const comCargo = [dono, ...membros].map((c) => c.session.identity.address)
while (comCargo.length < ATRIBUICOES) comCargo.push(generateIdentity(parseServerName(NOME)).address)
for (const quem of comCargo) await ana.session.assignRoles(SALA, quem, ["membro"]).catch(() => rejeicoesSoltas++)
for (let i = 0; i < MENSAGENS; i++) {
  const quem = membros[i % membros.length] ?? ana
  await quem.session.send(SALA, mensagem(`Mensagem de semente ${i + 1}, com algum texto para ocupar uma linha.`)).catch(() => rejeicoesSoltas++)
}
await ate(() => dono.session.roomsOf(SALA).length >= 10, 60_000)
await pausa(5_000)
if (LASTRO_MB > 0) {
  await dono.vault.update((c) => {
    for (let i = 0; i < 150; i++) {
      c.directory[`@lastro${i}:${NOME}`] = { at: 1, payload: { t: "profile", displayName: `l${i}`, lastro: "A".repeat(Math.round((LASTRO_MB * 1e6) / 150)) } }
    }
  })
}
await dono.session.flush()
const bytesDoCofre = Buffer.from(dono.backend.bytes)
dono.session.disconnect()
todas.splice(todas.indexOf(dono), 1)
console.log(`  semeado em ${((Date.now() - t0) / 1000).toFixed(0)} s; ${membros.filter(naSala).length + 1} contas ligadas na sala comum; cofre do Dono ${(bytesDoCofre.length / 1024 / 1024).toFixed(1)} MB; ${rejeicoesSoltas} rejeições soltas`)

// --- medir ----------------------------------------------------------------------
function instrumentar() {
  const longas = []
  const cliques = []
  const tramas = { "<": 0, ">": 0, bytesIn: 0, bytesOut: 0 }
  window.__longas = longas
  window.__cliques = cliques
  window.__tramas = tramas
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) longas.push([Math.round(e.startTime), Math.round(e.duration)]) }).observe({ type: "longtask", buffered: true })
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name === "click" || e.name === "pointerup") cliques.push({ t: Math.round(e.startTime), nome: e.name, dur: Math.round(e.duration), proc: Math.round(e.processingEnd - e.processingStart), espera: Math.round(e.processingStart - e.startTime) })
    }).observe({ type: "event", durationThreshold: 16, buffered: true })
  } catch {}
  const WS = window.WebSocket
  window.WebSocket = function (...args) {
    const s = new WS(...args)
    s.addEventListener("message", (e) => { tramas["<"]++; tramas.bytesIn += typeof e.data === "string" ? e.data.length : 0 })
    const enviar = s.send.bind(s)
    s.send = (d) => { tramas[">"]++; tramas.bytesOut += typeof d === "string" ? d.length : 0; return enviar(d) }
    return s
  }
  window.WebSocket.prototype = WS.prototype
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
}
const somaLongas = (longas, de, ate) => longas.reduce((n, [i, d]) => n + Math.max(0, Math.min(i + d, ate) - Math.max(i, de)), 0)
const janela = (longas, de, ate) => {
  const dentro = longas.filter(([i]) => i >= de && i < ate)
  return { longas: dentro.length, ocupadoMs: Math.round(somaLongas(longas, de, ate)), maiorMs: Math.max(0, ...dentro.map(([, d]) => d)) }
}
const heapMB = async (cdp) => {
  const { usedSize } = await cdp.send("Runtime.getHeapUsage")
  return Math.round(usedSize / 1024 / 1024)
}

const browser = await chromium.launch({ headless: true })
const contexto = await browser.newContext({ viewport: { width: 1440, height: 900 } })
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
}, bytesDoCofre.toString("base64"))
await page.addInitScript(instrumentar)
const cdp = await contexto.newCDPSession(page)
await cdp.send("Runtime.enable")
if (PERFIL) {
  await cdp.send("Profiler.enable")
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 })
}
const CPU_LENTO = Number(process.env.CPU_LENTO ?? 1)
if (CPU_LENTO > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_LENTO })
await page.goto(APP)
await page.waitForSelector('input[type="password"]', { timeout: 180_000 })
await page.fill('input[type="password"]', FRASE)
if (PERFIL) await cdp.send("Profiler.start")
const tEntrar = await page.evaluate(() => performance.now())
await page.evaluate(() => { const f = document.querySelector('input[type="password"]')?.form; if (f) f.requestSubmit() })
const abriu = await page.waitForSelector('button[aria-label="Configurações"], button[title="Configurações"]', { timeout: Number(process.env.PRAZO_APP_MS ?? 180_000) }).then(() => true, () => false)
if (!abriu) {
  console.log("  a app não abriu no prazo")
  if (PERFIL) {
    const { profile } = await cdp.send("Profiler.stop")
    writeFileSync(join(SAIDA, `perfil-${ROTULO}-sem-abrir.cpuprofile`), JSON.stringify(profile))
  }
  await page.screenshot({ path: join(SAIDA, `ecra-${ROTULO}-sem-abrir.png`) }).catch(() => {})
  console.log(`  erros: ${erros.slice(0, 5).join(" | ")}`)
  await browser.close()
  acabar(3)
}
const tApp = await page.evaluate(() => performance.now())
await page.waitForTimeout(20_000)
const fim1 = await page.evaluate(() => performance.now())
let longas = await page.evaluate(() => window.__longas)
const resultado = {
  rotulo: ROTULO,
  cofreMB: Number((bytesDoCofre.length / 1024 / 1024).toFixed(1)),
  membrosLigados: membros.filter(naSala).length + 1,
  entrar: { entrarAteAppMs: Math.round(tApp - tEntrar), ...janela(longas, tEntrar, fim1), heapMB: await heapMB(cdp) },
  entradas: [],
  trocas: [],
}
console.log(`  entrar: ${JSON.stringify(resultado.entrar)}`)
if (process.env.DUMP_BOTOES === "1") {
  const botoes = await page.evaluate(() => [...document.querySelectorAll("button, a, [role=button], [role=treeitem], [role=tab]")].map((b) => [b.tagName, b.getAttribute("aria-label"), b.getAttribute("title"), (b.textContent ?? "").trim().slice(0, 40)]))
  writeFileSync(join(SAIDA, `botoes-${ROTULO}.json`), JSON.stringify(botoes, null, 1))
}
resultado.cpuLento = CPU_LENTO

for (let e = 0; e < ENTRADAS; e++) {
  const antes = await page.evaluate(() => ({ t: performance.now(), ...window.__tramas }))
  const novo = await conta(`Novo ${e + 1}`)
  await novo.session.ensureCommonRoom().catch(() => {})
  const entrou = await ate(() => naSala(novo), 30_000)
  await page.waitForTimeout(30_000)
  const depois = await page.evaluate(() => ({ t: performance.now(), ...window.__tramas }))
  longas = await page.evaluate(() => window.__longas)
  const linha = { entrou, tramasRecebidas: depois["<"] - antes["<"], tramasEnviadas: depois[">"] - antes[">"], kBEnviados: Math.round((depois.bytesOut - antes.bytesOut) / 1024), ...janela(longas, antes.t, depois.t), heapMB: await heapMB(cdp) }
  resultado.entradas.push(linha)
  console.log(`  entrada ${e + 1}: ${JSON.stringify(linha)}`)
}

if (PERFIL) {
  const { profile } = await cdp.send("Profiler.stop")
  writeFileSync(join(SAIDA, `perfil-${ROTULO}.cpuprofile`), JSON.stringify(profile))
}
writeFileSync(join(SAIDA, `resultado-${ROTULO}-${Date.now()}.json`), JSON.stringify(resultado, null, 1))
/*
  Long watch (MINUTOS=n): app open in the channel, a new join every ENTRADA_CADA
  minutes, and every minute the heap after a forced GC, DOM nodes, listeners and
  the fraction of the minute the thread worked (`TaskDuration` from CDP). Detects
  both leaks and CPU stalls.
  */
const MINUTOS = Number(process.env.MINUTOS ?? 0)
if (MINUTOS > 0) {
  const ENTRADA_CADA = Number(process.env.ENTRADA_CADA ?? 0)
  await cdp.send("Performance.enable")
  const metricas = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]))
  resultado.vigia = []
  let anterior = await metricas()
  for (let minuto = 1; minuto <= MINUTOS; minuto++) {
    if (ENTRADA_CADA > 0 && minuto % ENTRADA_CADA === 0) {
      const novo = await conta(`Vigia ${minuto}`)
      void novo.session.ensureCommonRoom().catch(() => {})
    }
    await pausa(60_000)
    await cdp.send("HeapProfiler.collectGarbage")
    const agora = await metricas()
    const linha = {
      minuto,
      heapMB: Math.round(agora.JSHeapUsedSize / 1024 / 1024),
      nos: agora.Nodes,
      ouvintes: agora.JSEventListeners,
      documentos: agora.Documents,
      threadOcupadaPct: Number((((agora.TaskDuration - anterior.TaskDuration) / 60) * 100).toFixed(1)),
      scriptPct: Number((((agora.ScriptDuration - anterior.ScriptDuration) / 60) * 100).toFixed(1)),
    }
    anterior = agora
    resultado.vigia.push(linha)
    console.log(`  vigia ${JSON.stringify(linha)}`)
    if (process.env.INSTANTANEOS && [0, 10, 30].includes(minuto)) {
      const pedacos = []
      cdp.on("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) => pedacos.push(chunk))
      await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false })
      writeFileSync(join(SAIDA, `heap-${ROTULO}-${minuto}min.heapsnapshot`), pedacos.join(""))
    }
  }
  writeFileSync(join(SAIDA, `resultado-${ROTULO}-${Date.now()}.json`), JSON.stringify(resultado, null, 1))
}

if (process.env.SEM_TROCAS === "1") {
  await browser.close()
  acabar(0)
}

/*
  Screen changes: click and measure until the next render (Event Timing).
  Targets are found by what the user sees; what is not found is reported and not
  measured.
  */
async function trocar(rotulo, localizar) {
  const alvo = localizar()
  if (!(await alvo.count())) {
    resultado.trocas.push({ rotulo, encontrado: false })
    return
  }
  const antes = await page.evaluate(() => ({ n: window.__cliques.length, t: performance.now() }))
  await alvo.first().click({ timeout: 5_000 }).catch(() => {})
  await page.waitForTimeout(1_500)
  const { cliques, t } = await page.evaluate(() => ({ cliques: window.__cliques, t: performance.now() }))
  longas = await page.evaluate(() => window.__longas)
  const meus = cliques.slice(antes.n).filter((c) => c.t >= antes.t - 5)
  const durMax = Math.max(0, ...meus.map((c) => c.dur))
  resultado.trocas.push({ rotulo, encontrado: true, cliqueAoDesenhoMs: meus.length ? durMax : "< 16", ...janela(longas, antes.t, t) })
}
for (let volta = 0; volta < 2; volta++) {
  for (let s = 1; s <= 4; s++) await trocar(`sala ${s}`, () => page.getByRole("button", { name: new RegExp(`^#?\\s*sala ${s}$`, "i") }))
  await trocar("definições", () => page.locator('button[aria-label="Configurações"], button[title="Configurações"]'))
  await page.keyboard.press("Escape").catch(() => {})
  await page.waitForTimeout(500)
  await trocar("membros", () => page.getByRole("button", { name: /membros/i }))
  await trocar("sala 1 outra vez", () => page.getByRole("button", { name: /^#?\s*sala 1$/i }))
}
for (const t of resultado.trocas) console.log(`  troca ${JSON.stringify(t)}`)

await page.screenshot({ path: join(SAIDA, `ecra-${ROTULO}.png`) })
writeFileSync(join(SAIDA, `resultado-${ROTULO}-${Date.now()}.json`), JSON.stringify(resultado, null, 1))
if (erros.length) console.log(`  erros na página: ${erros.slice(0, 5).join(" | ")}`)
await browser.close()
acabar(0)
