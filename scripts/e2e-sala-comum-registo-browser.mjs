/**
 * Does a newly registered account in the browser join the common room with online members?
 * (report from 2/11/2026: "a user just registered and was not routed to the
 * 'Orwell' common channel").
 *
 *   node scripts/e2e-sala-comum-registo-browser.mjs   (requires `npm run build`)
 *
 * Everything local and disposable: homeserver in community mode with common room, a
 * front end that acts as Caddy, the founder and unprivileged member accounts (Node), and a
 * new account via the interface in Chromium. Measures on the server side how many
 * Welcome messages the new account received (1 is correct; one per retry is the
 * bug) and how many messages the room received from the join.
 * Ports 8467 (front end) and 8466 (server), or E2E_PORTA_DA_FRENTE/E2E_PORTA_DO_SERVIDOR.
 */
import { spawn, execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { webcrypto } from "node:crypto"
import { chromium } from "playwright"
import { Session, Vault } from "@enclave/client-core"
import { generateIdentity, sign, toBase64, fromBase64 } from "@enclave/protocol"
import { WebSocket } from "ws"
import { criarConta } from "./conta.mjs"
if (!globalThis.crypto) globalThis.crypto = webcrypto

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8467)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8466)
const NOME = `localhost:${PORTA_DA_FRENTE}`
const SALA = `!orwell:${NOME}`
const MEMBROS = Number(process.env.MEMBROS ?? 5)
const LINGUA = process.env.LINGUA ?? "pt"
const pausa = (ms) => new Promise((r) => setTimeout(r, ms))

const dados = mkdtempSync(join(RAIZ, ".dev-data-scr", "browser-"))
const BASE = join(dados, "enclave.sqlite")
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR),
    ENCLAVE_COMMUNITY_MODE: "true",
    ENCLAVE_COMMON_ROOM: SALA,
  },
  stdio: ["ignore", "pipe", "pipe"],
})
let registoDoServidor = ""
servidor.stdout.on("data", (b) => (registoDoServidor += b))
servidor.stderr.on("data", (b) => (registoDoServidor += b))

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".wasm": "application/wasm" }
const frente = http.createServer((pedido, resposta) => {
  const caminho = (pedido.url ?? "/").split("?")[0]
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
  adiante.on("error", () => { resposta.writeHead(502); resposta.end() })
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
await new Promise((r) => frente.listen(PORTA_DA_FRENTE, "127.0.0.1", r))
for (let i = 0; i < 60; i++) {
  if (registoDoServidor.includes("listening")) break
  await pausa(250)
}

let browser
const sessoes = []
async function arrumar(codigo) {
  await browser?.close().catch(() => {})
  for (const s of sessoes) s.disconnect?.()
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
  process.exit(codigo)
}

class MemoryBackend {
  bytes = null
  supportsOsProtection = false
  async read() { return this.bytes }
  async write(b) { this.bytes = b }
  async clear() { this.bytes = null }
}
async function conta(nome) {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-de-teste")
  const session = new Session(vault)
  await session.createIdentity(NOME)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  void session.ensureCommonRoom().catch(() => {})
  sessoes.push(session)
  return session
}
async function ate(condicao, ms) {
  const fim = Date.now() + ms
  while (Date.now() < fim) {
    if (await condicao()) return true
    await pausa(250)
  }
  return false
}
const sql = (q) => execFileSync("sqlite3", ["-readonly", BASE, q], { encoding: "utf8" }).trim()

const falhas = []
const verificar = (ok, frase) => {
  console.log(`  ${ok ? "ok  " : "FALHA"} ${frase}`)
  if (!ok) falhas.push(frase)
}

const A = await conta("Fundadora")
verificar(await ate(() => A.channels.includes(SALA), 20_000), "a fundadora cria a sala comum")
for (let i = 0; i < MEMBROS; i++) {
  const M = await conta(`Membro${i}`)
  if (!(await ate(() => M.channels.includes(SALA), 60_000))) console.log(`  (Membro${i} não entrou)`)
}
await pausa(8_000)
if (process.env.FUNDADORA_SAI) A.disconnect()
await pausa(2_000)

/*
  SEM_CARTAO=1: a separate account lifts the common room card every 300 ms
  during the join, and the new account enters as in production on 2/11/2026:
  through the seat request, admitted by a member with a Welcome.
*/
let ladrao = null
async function contaCrua() {
  const id = generateIdentity(NOME)
  const ws = new WebSocket(`ws://${NOME}/_enclave/gateway`)
  const chegou = []
  ws.on("message", (raw) => chegou.push(JSON.parse(raw.toString("utf8"))))
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject) })
  const espera = async (t) => { for (let i = 0; i < 200; i++) { const f = chegou.find((x) => x.t === t); if (f) return f; await pausa(25) } return null }
  const enviar = (f) => ws.send(JSON.stringify(f))
  enviar({ t: "hello", version: 1, capabilities: ["commit-after-echo"] }); await espera("hello.ok")
  enviar({ t: "auth.begin", address: id.address, signingKey: toBase64(id.signingPublicKey) })
  const desafio = await espera("auth.challenge")
  enviar({ t: "auth.finish", signature: toBase64(sign(id, fromBase64(desafio.nonce))) })
  await espera("auth.ok")
  return enviar
}
if (process.env.SEM_CARTAO) {
  // The server lets each account pull 6 cards per minute: twelve accounts, taking turns.
  const ladroes = []
  for (let i = 0; i < 12; i++) ladroes.push(await contaCrua())
  let vez = 0
  ladrao = setInterval(() => ladroes[vez++ % ladroes.length]({ t: "channel.groupinfo.take", channel: SALA }), 400)
}

const antes = Number(sql(`select count(*) from events where channel='${SALA}'`))
browser = await chromium.launch()
const contexto = await browser.newContext({ locale: LINGUA === "en" ? "en-US" : "pt-PT" })
const page = await contexto.newPage()
const consola = []
page.on("console", (m) => consola.push(m.text()))
await page.goto(`http://${NOME}/app/?lingua=pt`)
try {
  await criarConta(page, { nome: "david", servidor: NOME })
  await page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
} catch (erro) {
  await page.screenshot({ path: join(RAIZ, ".dev-data-scr", "registo-falhou.png") })
  console.log(`  FALHA o registo não chegou à aplicação: ${erro.message.split("\n")[0]}`)
  for (const l of consola.slice(-40)) console.log(`    consola: ${l.slice(0, 300)}`)
  await arrumar(1)
}
const endereco = sql("select address from accounts order by created_minute desc, rowid desc limit 1")
console.log(`  conta nova ${endereco}`)
if (LINGUA === "en") {
  // The language of the report browser. Setup runs in Portuguese (the account script
  // only knows those buttons); the app switches to English by reloading without `?lingua`.
  await page.goto(`http://${NOME}/app/`)
}

const JANELA_MS = Number(process.env.JANELA_MS ?? 75_000)
await pausa(JANELA_MS)
const welcomes = Number(sql(`select count(*) from events where channel='${SALA}' and kind='welcome' and recipient='${endereco}'`))
const depois = Number(sql(`select count(*) from events where channel='${SALA}'`))
const aplicacao = Number(sql(`select count(*) from events where channel='${SALA}' and kind='application' and rowid > 0`))
console.log(`  welcomes para a conta nova: ${welcomes}; eventos da sala durante a entrada: ${depois - antes} (application total ${aplicacao})`)
verificar(welcomes <= 1, `a conta nova é admitida uma vez só (welcomes: ${welcomes})`)
verificar(depois - antes < 40 + 10 * MEMBROS, `a entrada não inunda a sala (${depois - antes} eventos com ${MEMBROS} membros)`)
const naBarra = await page.locator('[aria-label="Orwell"], [title="Orwell"]').count()
verificar(naBarra > 0, `a sala comum "Orwell" aparece na barra lateral (${naBarra})`)
await page.screenshot({ path: join(RAIZ, ".dev-data-scr", `registo-${LINGUA}.png`) })
if (process.env.CONSOLA) for (const l of consola) console.log(`    consola: ${l.slice(0, 300)}`)
console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : "\ntudo ok")
await arrumar(falhas.length ? 1 : 0)
