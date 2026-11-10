/**
 * A private conversation on a device paired with the main one disconnected.
 *
 *   node scripts/e2e-privadas-separador.mjs                    (all three engines on the phone)
 *   node scripts/e2e-privadas-separador.mjs webkit             (just this one)
 *
 * Needs `npm run build` first.
 *
 * The owner's report (2/11/2026): "there are users whose private messages are in the
 * 'communities' tab instead of 'friends'". Only the device with the account key
 * can infer a direct message; the paired one waits for the main one's sync data. With the main
 * one closed, a new direct message appeared in "Communities" on the paired device.
 *
 * What we prove, for each engine on the phone (Chromium, Firefox, WebKit):
 *  1. Ana creates an account on the computer (Chromium) and pairs the phone.
 *  2. The computer CLOSES. Carla, an account in the core here on Node, opens a
 *     direct with Ana and requests friendship.
 *  3. On the phone, the "Communities" list gains no channel, and Carla's request
 *     is in Friends, Received. Ana accepts on the phone.
 *  4. A second tab on the phone (same browser) shows the same.
 *
 * ALL LOCAL AND ALL DISPOSABLE, in the style of `e2e-perfis-entre-aparelhos.mjs`:
 * its own homeserver in a temp folder, a frontend acting as Caddy, ports
 * 8488 and 8489 (only for this script), and no way to point it at production.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { argon2id } from "@noble/hashes/argon2.js"
import { DatabaseSync } from "node:sqlite"
import { Session, Vault } from "@enclave/client-core"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { irParaEmparelhar } from "./fase7-comum.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
// Ports change by env var, so two scripts do not fight over them.
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8488)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8489)
const NOME = `localhost:${PORTA_DA_FRENTE}`
const SALA_COMUM = `!orwell:${NOME}`
const APP = `http://${NOME}/app/?lingua=pt`
const FRASE = "frase-de-verificacao-2026"

const results = []
function check(nome, ok, detalhe = "") {
  results.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}

for (const [o_que, caminho] of [["a web construída", join(DIST, "index.html")], ["o servidor construído", SERVIDOR_JS]]) {
  if (!existsSync(caminho)) {
    console.error(`Falta ${o_que}: ${caminho}. Corre \`npm run build\` primeiro.`)
    process.exit(2)
  }
}

async function portaLivre(porta) {
  return new Promise((resolve) => {
    const sonda = net.createServer()
    sonda.once("error", () => resolve(false))
    sonda.once("listening", () => sonda.close(() => resolve(true)))
    sonda.listen(porta, "127.0.0.1")
  })
}
for (const porta of [PORTA_DA_FRENTE, PORTA_DO_SERVIDOR]) {
  if (!(await portaLivre(porta))) {
    console.error(`A porta ${porta} já tem dono. Este guião não mata processos de ninguém: liberta-a e volta a correr.`)
    process.exit(2)
  }
}

// --- the homeserver, disposable, with common room -------------------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-privadas-separador-"))
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR),
    ENCLAVE_COMMUNITY_MODE: "true",
    ENCLAVE_COMMON_ROOM: SALA_COMUM,
  },
  stdio: ["ignore", "pipe", "pipe"],
})
let registoDoServidor = ""
servidor.stdout.on("data", (bocado) => (registoDoServidor += bocado))
servidor.stderr.on("data", (bocado) => (registoDoServidor += bocado))

// --- The frontend that acts as Caddy. ----------------------------------------
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json", ".wasm": "application/wasm" }
const acessos = []
const frente = http.createServer((pedido, resposta) => {
  acessos.push(`${pedido.method} ${pedido.url}`)
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
  adiante.on("error", () => {
    resposta.writeHead(502)
    resposta.end()
  })
  pedido.pipe(adiante)
})
frente.on("upgrade", (pedido, socket, cabeca) => {
  acessos.push(`${pedido.method} ${pedido.url} (upgrade)`)
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

async function servidorDePe() {
  for (let volta = 0; volta < 60; volta++) {
    const ok = await new Promise((resolve) => {
      const sonda = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => {
        sonda.destroy()
        resolve(true)
      })
      sonda.on("error", () => resolve(false))
    })
    if (ok) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

const abertos = []
const amigos = []
async function arrumar(codigoDeSaida) {
  for (const amigo of amigos) amigo.session.disconnect()
  for (const browser of abertos) await browser.close().catch(() => {})
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
  process.exit(codigoDeSaida)
}

if (!(await servidorDePe())) {
  console.error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
  await arrumar(2)
}

// --- the full network, from each context -----------------------------------------
function escutar(context, saco) {
  context.on("request", (pedido) => {
    saco.push(`PEDIDO ${pedido.method()} ${pedido.url()}`)
    const corpo = pedido.postData()
    if (corpo) saco.push(`CORPO ${corpo}`)
  })
  context.on("page", (page) => {
    page.on("websocket", (ws) => {
      saco.push(`WS ${ws.url()}`)
      ws.on("framesent", (trama) => saco.push(`TRAMA> ${typeof trama.payload === "string" ? trama.payload : trama.payload.toString("latin1")}`))
      ws.on("framereceived", (trama) => saco.push(`TRAMA< ${typeof trama.payload === "string" ? trama.payload : trama.payload.toString("latin1")}`))
    })
    page.on("console", (mensagem) => saco.push(`CONSOLA ${mensagem.text()}`))
    page.on("pageerror", (erro) => saco.push(`PAGEERROR ${erro.message}`))
  })
}

const CONTEXTO = { locale: "pt-PT" }
const dentro = (page) => page.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 90_000 })
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Wait until the condition is true, or time runs out. Returns whether it happened. */
async function ate(condicao, ms = 60_000, passo = 1_000) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await condicao().catch(() => false)) return true
    await wait(passo)
  }
  return false
}

/** The phone's vault, read from IndexedDB and opened with the passphrase, here in Node. */
async function cofreDe(page, frase) {
  const bruto = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const pedido = indexedDB.open("enclave", 1)
        pedido.onerror = () => reject(pedido.error)
        pedido.onsuccess = () => {
          const db = pedido.result
          const leitura = db.transaction("vault", "readonly").objectStore("vault").get("current")
          leitura.onsuccess = () => resolve(leitura.result ? new TextDecoder().decode(leitura.result) : null)
          leitura.onerror = () => reject(leitura.error)
        }
      }),
  )
  if (!bruto) throw new Error("o telemóvel não tem cofre")
  // The plaintext header from 1.0 (`orwv2` and a newline, chunk 2) before the JSON.
  const ficheiro = JSON.parse(bruto.startsWith("orwv2\n") ? bruto.slice(6) : bruto)
  const b64 = (texto) => Buffer.from(texto.replace(/-/g, "+").replace(/_/g, "/"), "base64")
  const chave = argon2id(new TextEncoder().encode(frase), b64(ficheiro.salt), { t: 3, m: 65_536, p: 4, dkLen: 32 })
  const texto = xchacha20poly1305(chave, b64(ficheiro.nonce)).decrypt(b64(ficheiro.ciphertext))
  return JSON.parse(new TextDecoder().decode(texto))
}



class CofreEmMemoria {
  bytes = null
  supportsOsProtection = false
  async read() {
    return this.bytes
  }
  async write(bytes) {
    this.bytes = bytes
  }
  async clear() {
    this.bytes = null
  }
}

/** A core account, here in Node, against this script's server. */
async function contaNoNode(nome) {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-de-teste-do-no")
  const session = new Session(vault)
  const identidade = await session.createIdentity(NOME)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  const conta = { nome, session, vault, address: identidade.address }
  amigos.push(conta)
  return conta
}

/** The address of the most recent account in the server database: Ana this time, who is created before Carla. */
function enderecoDaUltimaConta() {
  const base = new DatabaseSync(join(dados, "enclave.sqlite"), { readOnly: true })
  try {
    return base.prepare("SELECT address FROM accounts ORDER BY rowid DESC").get()?.address
  } finally {
    base.close()
  }
}


async function separador(page, nome) {
  await page.getByRole("button", { name: "Amigos", exact: true }).first().click()
  await page.locator(".people-destination").waitFor({ timeout: 15_000 })
  await page.locator(".people-tabs").getByRole("button", { name: nome }).click()
}

/** How many channels the "Communities" list has. By the DOM: at 390 px the list is in a drawer. */
async function canaisEmComunidades(page) {
  await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  await wait(500)
  return page.evaluate(() => document.querySelectorAll(".channel-list .channel-name").length)
}

const MOTORES = { chromium, firefox, webkit }
const pedidos = process.argv.slice(2).filter((nome) => nome in MOTORES)
const motores = pedidos.length > 0 ? pedidos : Object.keys(MOTORES)

async function prova(motor) {
  console.log(`\ntelemóvel em ${motor}:`)
  const browserPc = await chromium.launch({ headless: true })
  abertos.push(browserPc)
  const ctxPc = await browserPc.newContext(CONTEXTO)
  escutar(ctxPc, [])
  const pc = await ctxPc.newPage()
  await pc.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(pc, { nome: "Ana", frase: FRASE, servidor: NOME })
  await dentro(pc)
  const ana = enderecoDaUltimaConta()
  check(`[${motor}] a Ana cria conta no computador`, typeof ana === "string" && ana.startsWith("@"), ana)

  // Add a device: the link, and the phone pastes it.
  await pc.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await pc.getByRole("button", { name: "Aparelhos", exact: true }).click()
  await pc.getByRole("button", { name: "Acrescentar aparelho" }).click()
  const folha = pc.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")

  const browserTel = await MOTORES[motor].launch({ headless: true })
  abertos.push(browserTel)
  const ctxTel = await browserTel.newContext({ ...CONTEXTO, viewport: { width: 390, height: 844 }, ...(motor === "firefox" ? {} : { deviceScaleFactor: 2, isMobile: true }), hasTouch: true })
  escutar(ctxTel, [])
  const tel = await ctxTel.newPage()
  await tel.goto(APP, { waitUntil: "domcontentloaded" })
  await irParaEmparelhar(tel)
  await tel.getByRole("heading", { name: "Emparelhar este aparelho" }).waitFor({ timeout: 10_000 })
  await tel.getByLabel("Ou cola o link").fill(link)
  await tel.getByRole("button", { name: "Continuar" }).click()
  await tel.getByRole("heading", { name: "Palavra-passe deste aparelho" }).waitFor({ timeout: 10_000 })
  const frases = tel.locator('.gate-card input[type="password"]')
  await frases.nth(0).fill(FRASE)
  await frases.nth(1).fill(FRASE)
  await tel.getByRole("button", { name: "Continuar" }).click()
  await tel.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await tel.getByRole("button", { name: "São as mesmas" }).click()
  await folha.getByRole("button", { name: "São as mesmas" }).click()
  await tel.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 })
  await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await tel.getByRole("button", { name: "Entrar", exact: true }).click()
  await dentro(tel)
  check(`[${motor}] o telemóvel entra na conta`, true)
  await wait(3_000)
  const antes = await canaisEmComunidades(tel)

  // The computer closes: the device with the account key goes offline.
  await browserPc.close()
  await wait(1_000)

  const carla = await contaNoNode("Carla")
  const dm = await carla.session.openDirect(ana)
  await ate(async () => carla.session.channels.includes(dm), 30_000, 500)
  await carla.session.sendFriendRequest(dm)

  // The phone receives the direct message: we expect it to arrive in its vault.
  const chegou = await ate(async () => Boolean((await cofreDe(tel, FRASE)).groups?.[dm]), 60_000, 2_000)
  check(`[${motor}] a directa da Carla chega ao telemóvel`, chegou)
  const cofre = await cofreDe(tel, FRASE)
  check(`[${motor}] sem a ficha do principal no cofre do telemóvel (o computador está fechado)`, cofre.fichasDosCanais?.[dm] === undefined)
  await wait(2_000)
  const depois = await canaisEmComunidades(tel)
  check(`[${motor}] "Comunidades" não ganha a conversa privada`, depois === antes, `antes ${antes}, depois ${depois}`)

  await separador(tel, "Recebidos")
  const pedido = await ate(async () => tel.getByRole("button", { name: "Aceitar" }).first().isVisible(), 30_000)
  check(`[${motor}] o pedido da Carla está em Amigos, Recebidos`, pedido)
  if (pedido) {
    await tel.getByRole("button", { name: "Aceitar" }).first().click()
    await separador(tel, "Todos")
    check(
      `[${motor}] depois de aceitar no telemóvel, a Ana vê "Amigos (1)"`,
      await ate(async () => (await tel.locator(".people-bar-title").innerText()) === "Amigos (1)", 60_000),
    )
  }

  // A second tab on the same browser: waits, takes over when the first closes, and shows the same.
  const tel2 = await ctxTel.newPage()
  await tel2.goto(APP, { waitUntil: "domcontentloaded" })
  await wait(2_000)
  await tel.close()
  const pedeFrase = await ate(async () => (await tel2.locator('input[type="password"]').count()) > 0 || (await tel2.getByRole("button", { name: "Configurações" }).count()) > 0, 60_000)
  if (pedeFrase && (await tel2.locator('input[type="password"]').count()) > 0) {
    await tel2.locator('input[type="password"]').first().fill(FRASE)
    await tel2.keyboard.press("Enter")
  }
  await dentro(tel2)
  await wait(2_000)
  const noSegundo = await canaisEmComunidades(tel2)
  check(`[${motor}] no segundo separador, "Comunidades" também não a tem`, noSegundo === antes, `${noSegundo}`)
  await separador(tel2, "Todos")
  check(
    `[${motor}] e a Carla está nos amigos do segundo separador`,
    await ate(async () => (await tel2.locator(".people-destination").innerText()).includes("Carla"), 30_000),
  )
  carla.session.disconnect()
  await browserTel.close()
}

try {
  for (const motor of motores) {
    try {
      await prova(motor)
    } catch (erro) {
      check(`[${motor}] o guião chegou ao fim`, false, String(erro?.message ?? erro).split("\n")[0])
    }
  }
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
await arrumar(passaram === results.length ? 0 : 1)
