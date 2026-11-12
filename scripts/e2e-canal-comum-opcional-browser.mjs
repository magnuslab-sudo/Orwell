/**
 * The common "Orwell" channel becomes a registration choice (owner request,
 * 3/11/2026). Four cases, one after another, against the same server:
 *
 *   1. New account with the box UNCHECKED: does not join, not after reload,
 *      not after closing and opening the tab again.
 *   2. The same account joins later via the "Join Orwell channel" button.
 *   3. New account with the box CHECKED (the default): joins, as today.
 *   4. Old account (no choice at all, like all pre-version ones) stays in the
 *      channel after reconnecting.
 *
 *   node scripts/e2e-canal-comum-opcional-browser.mjs   (needs `npm run build`)
 *
 * All local and throwaway, like `e2e-sala-comum-registo-browser.mjs`: a homeserver
 * in community mode with common room, a front end that acts as Caddy, the founder
 * and a member in Node, and new accounts via the Chromium interface. Truth comes
 * from two sides: the group tree seen by the founder (who is a member), and the
 * server database (Welcomes and subscriptions for the new account). Ports 8469
 * (front) and 8468 (server), or E2E_PORTA_DA_FRENTE/E2E_PORTA_DO_SERVIDOR.
 */
import { spawn, execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { webcrypto } from "node:crypto"
import { chromium } from "playwright"
import { Session, Vault } from "@enclave/client-core"
import { FRASE } from "./ambiente.mjs"
import { criarConta } from "./conta.mjs"
if (!globalThis.crypto) globalThis.crypto = webcrypto

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8469)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8468)
const NOME = `localhost:${PORTA_DA_FRENTE}`
const SALA = `!orwell:${NOME}`
/** How long to wait for an entry that MUST NOT happen: retries at 15 s and 45 s. */
const ESPERA_DE_FORA_MS = Number(process.env.ESPERA_DE_FORA_MS ?? 50_000)
const pausa = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync(join(RAIZ, ".dev-data-scr"), { recursive: true })
const dados = mkdtempSync(join(RAIZ, ".dev-data-scr", "canal-opcional-"))
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
/** An account in Node, as before this version: no choice in the vault. */
async function contaAntiga(nome) {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-de-teste")
  const session = new Session(vault)
  await session.createIdentity(NOME)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
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

// ------------------------------------------------------------------ the stage
const fundadora = await contaAntiga("Fundadora")
verificar(await ate(() => fundadora.channels.includes(SALA), 20_000), "a fundadora cria a sala comum")
const antiga = await contaAntiga("Antiga")
verificar(await ate(() => antiga.channels.includes(SALA), 60_000), "a conta antiga entra na sala comum")
await pausa(3_000)

browser = await chromium.launch()
const URL_DA_APP = `http://${NOME}/app/?lingua=pt`
// Via the channel line in the list, not by `aria-label="Orwell"`: the app brand
// is also called that, and it is on screen with or without the channel.
const naBarra = (page) => page.locator(".channel-row .channel-name").filter({ hasText: /^Orwell$/ }).count()
const botaoDeEntrar = (page) => page.getByRole("button", { name: "Entrar no canal Orwell", exact: true })
const configuracoes = (page) => page.getByRole("button", { name: "Configurações", exact: true }).first()
const ultimaConta = () => sql("select address from accounts order by created_minute desc, rowid desc limit 1")
const membro = (endereco) => fundadora.membersOf(SALA).map(String).includes(endereco)
const welcomes = (endereco) => Number(sql(`select count(*) from events where channel='${SALA}' and kind='welcome' and recipient='${endereco}'`))
const subscrito = (endereco) => Number(sql(`select count(*) from subscriptions where channel='${SALA}' and address='${endereco}'`)) > 0

async function registar(contexto, nome, canalOficial) {
  const page = await contexto.newPage()
  await page.goto(URL_DA_APP)
  try {
    await criarConta(page, { nome, servidor: NOME, ...(canalOficial === undefined ? {} : { canalOficial }) })
    await configuracoes(page).waitFor({ timeout: 90_000 })
  } catch (erro) {
    await page.screenshot({ path: join(RAIZ, ".dev-data-scr", `canal-opcional-${nome}.png`) })
    console.log(`  FALHA o registo de ${nome} não chegou à aplicação: ${erro.message.split("\n")[0]}`)
    await arrumar(1)
  }
  return page
}

/** Open again: the vault asks for the password (the session was not saved). */
async function desbloquear(page) {
  const campo = page.locator('input[type="password"]').first()
  await campo.or(configuracoes(page)).first().waitFor({ timeout: 60_000 })
  if (await campo.count()) {
    await campo.fill(FRASE)
    await page.keyboard.press("Enter")
  }
  await configuracoes(page).waitFor({ timeout: 90_000 })
}

async function deFora(page, endereco, quando) {
  verificar((await naBarra(page)) === 0, `${quando}: "Orwell" não está na barra lateral`)
  verificar(!membro(endereco), `${quando}: a conta não está na árvore da sala comum`)
  verificar(welcomes(endereco) === 0, `${quando}: nenhum Welcome para a conta (${welcomes(endereco)})`)
  verificar(!subscrito(endereco), `${quando}: a conta não está subscrita à sala comum no servidor`)
}

// --------------------------------------------- 1. box unchecked: stays out
console.log("\n1. Conta nova com a caixa desmarcada")
const contextoFora = await browser.newContext({ locale: "pt-PT" })
let paginaFora = await registar(contextoFora, "fora", false)
const enderecoFora = ultimaConta()
console.log(`  conta ${enderecoFora}`)
await pausa(ESPERA_DE_FORA_MS)
await deFora(paginaFora, enderecoFora, "logo a seguir ao registo")
verificar((await botaoDeEntrar(paginaFora).count()) === 1, 'o botão "Entrar no canal Orwell" está na coluna')

await paginaFora.reload()
await desbloquear(paginaFora)
await pausa(ESPERA_DE_FORA_MS / 2)
await deFora(paginaFora, enderecoFora, "depois de recarregar")

await paginaFora.close()
paginaFora = await contextoFora.newPage()
await paginaFora.goto(URL_DA_APP)
await desbloquear(paginaFora)
await pausa(ESPERA_DE_FORA_MS / 2)
await deFora(paginaFora, enderecoFora, "depois de fechar e voltar a abrir")

// ------------------------------------------------- 2. join later via button
console.log("\n2. A mesma conta entra mais tarde pelo botão")
await botaoDeEntrar(paginaFora).click()
verificar(await ate(async () => (await naBarra(paginaFora)) > 0, 90_000), '"Orwell" aparece na barra lateral')
verificar(await ate(() => membro(enderecoFora), 30_000), "a fundadora vê a conta na sala comum")
verificar((await botaoDeEntrar(paginaFora).count()) === 0, "o botão sai da coluna")
await paginaFora.reload()
await desbloquear(paginaFora)
verificar(await ate(async () => (await naBarra(paginaFora)) > 0, 60_000), 'depois de recarregar, "Orwell" continua lá')
await paginaFora.screenshot({ path: join(RAIZ, ".dev-data-scr", "canal-opcional-entrou-depois.png") })

// ---------------------------------------------- 3. box checked: joins, as today
console.log("\n3. Conta nova com a caixa marcada (a omissão)")
const contextoDentro = await browser.newContext({ locale: "pt-PT" })
const paginaDentro = await registar(contextoDentro, "dentro", undefined)
const enderecoDentro = ultimaConta()
console.log(`  conta ${enderecoDentro}`)
verificar(await ate(async () => (await naBarra(paginaDentro)) > 0, 90_000), '"Orwell" aparece na barra lateral')
verificar(await ate(() => membro(enderecoDentro), 30_000), "a fundadora vê a conta na sala comum")
verificar((await botaoDeEntrar(paginaDentro).count()) === 0, 'não há botão "Entrar no canal Orwell"')
await paginaDentro.screenshot({ path: join(RAIZ, ".dev-data-scr", "canal-opcional-marcada.png") })

// ---------------------------------------------- 4. old account stays there
console.log("\n4. A conta antiga continua no canal")
verificar(antiga.querSalaComum(), "a conta antiga não tem escolha feita, e conta como querer")
antiga.disconnect()
await pausa(1_000)
await antiga.connect()
await pausa(10_000)
verificar(antiga.channels.includes(SALA), "depois de voltar a ligar, a conta antiga continua na sala comum")
verificar(membro(String(antiga.identity.address)), "e a fundadora continua a vê-la lá")

console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : "\ntudo ok")
await arrumar(falhas.length ? 1 : 0)
