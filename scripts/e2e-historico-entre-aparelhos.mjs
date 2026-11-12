/**
 * History across account devices, in two browsers.
 *
 *   node scripts/e2e-historico-entre-aparelhos.mjs          (needs `npm run build` first)
 *
 * Owner request (29/10/2026): all history and all media move to the new device
 * on pairing, no questions ("I want out").
 *
 * What we prove: Ana creates an account on desktop (one browser). Bruno is a
 * core account here in Node: asks Ana for friendship (she accepts by button),
 * writes her thirty messages and sends a photo, deletes one message, posts to
 * their wall, and opens a channel with Ana with one open ticket and one
 * deleted. Bruno GOES OFFLINE. Ana pairs a mobile phone by link. Without Bruno
 * coming back:
 *  - both screens of six words say the new device gets the old chats, no box
 *    or prompt;
 *  - the mobile shows "Bringing in history" banner;
 *  - the mobile's connection drops midway and comes back, and the history ends;
 *  - the mobile's vault has the full chat with no dupes, the deleted message
 *    stays deleted, the photo with its bytes, the wall post, the open ticket,
 *    and the deleted one stays deleted;
 *  - in the chat with Bruno, the mobile shows the first message.
 *
 * ALL LOCAL AND ALL DISPOSABLE, like `e2e-perfis-entre-aparelhos.mjs`:
 * its own homeserver in a temp folder, a frontend that acts as Caddy, ports
 * 8484 and 8485 (this script only), and no way to point it at production.
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
import { Session, Vault, chaveDoEvento, dobrarConversa, ticketsOf } from "@enclave/client-core"
import { moradaDeSala } from "@enclave/protocol"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { irParaEmparelhar } from "./fase7-comum.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
// Ports change by env var, so two scripts do not fight over them.
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8484)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8485)
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
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-historico-entre-aparelhos-"))
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

let browserPc
let browserTel
const amigos = []
async function arrumar(codigoDeSaida) {
  for (const amigo of amigos) amigo.session.disconnect()
  await browserPc?.close().catch(() => {})
  await browserTel?.close().catch(() => {})
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
const SEM_NOME = "Sem nome"

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

/** Ana's address, read from the server database: the first account born. */
function enderecoDaPrimeiraConta() {
  const base = new DatabaseSync(join(dados, "enclave.sqlite"), { readOnly: true })
  try {
    return base.prepare("SELECT address FROM accounts ORDER BY rowid ASC").get()?.address
  } finally {
    base.close()
  }
}

async function separador(page, nome) {
  await page.getByRole("button", { name: "Amigos", exact: true }).first().click()
  await page.locator(".people-destination").waitFor({ timeout: 15_000 })
  await page.locator(".people-tabs").getByRole("button", { name: nome }).click()
}

function mensagem(corpo, anexo) {
  return {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body: corpo,
    attachments: anexo
      ? [{ url: "", key: "", nonce: "", digest: "", kind: "image", name: anexo.nome, mediaType: "image/png", byteLength: anexo.bytes, inline: anexo.inline }]
      : [],
    links: [],
    mentions: [],
  }
}

/** Channel entries in the vault (the two lists), the way the core joins them. */
const entradas = (cofre, canal) => [...(cofre.history?.[canal] ?? []), ...(cofre.estadoDoCanal?.[canal] ?? [])].filter((e) => !e.herdado)
const corposVistos = (cofre, canal) =>
  dobrarConversa([...entradas(cofre, canal)].sort((a, b) => a.seq - b.seq))
    .filter((e) => e.payload.t === "message")
    .map((e) => e.payload.body)

// A heavy photo (goes at the end, in the background, at 40 signals per minute): a 1-pixel PNG with tail.
// The tail is random: a repeated tail would compress to nothing, and the thread would send it in a flash.
const FOTOGRAFIA = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg${Array.from({ length: 15 }, () => Buffer.from(crypto.getRandomValues(new Uint8Array(60_000))).toString("base64")).join("")}`

try {
  browserPc = await chromium.launch({ headless: true })

  // ---------------------------------------------------------------------------
  // 1. Ana on the computer. Bruno: friendship, conversation, feed and tickets.
  // ---------------------------------------------------------------------------
  const redePc = []
  const ctxPc = await browserPc.newContext(CONTEXTO)
  escutar(ctxPc, redePc)
  const pc = await ctxPc.newPage()
  await pc.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(pc, { nome: "Ana", frase: FRASE, servidor: NOME })
  await dentro(pc)
  check("a Ana cria conta no computador", true)

  const ana = enderecoDaPrimeiraConta()
  const bruno = await contaNoNode("Bruno")
  const dm = await bruno.session.openDirect(ana)
  await ate(async () => bruno.session.channels.includes(dm), 30_000, 500)
  await bruno.session.sendFriendRequest(dm)
  await separador(pc, "Recebidos")
  await ate(async () => pc.getByRole("button", { name: "Aceitar" }).first().isVisible(), 60_000)
  await pc.getByRole("button", { name: "Aceitar" }).first().click()
  check("a Ana e o Bruno são amigos", await ate(async () => (await pc.locator(".people-bar-title").innerText().catch(() => "")).includes("1") || bruno.session.friendTies().get(ana)?.link === "amigos", 60_000))

  for (let n = 1; n <= 30; n++) await bruno.session.send(dm, mensagem(`mensagem ${n} do Bruno`))
  await bruno.session.send(dm, mensagem("a fotografia do rio", { nome: "rio.png", bytes: FOTOGRAFIA.length, inline: FOTOGRAFIA }))
  const apagada = mensagem("esta vai ser apagada")
  await bruno.session.send(dm, apagada)
  await bruno.session.deleteMessage(dm, apagada.id)

  const publicacao = await bruno.session.post("O rio está cheio.")
  const canal = moradaDeSala(NOME)
  await bruno.session.createSpaceChannel(canal)
  await ate(async () => bruno.session.founderOf(canal) === bruno.address, 30_000, 500)
  await bruno.session.seat(canal, ana)
  const aberto = await bruno.session.openTicket(canal, "", "A porta não fecha")
  await bruno.session.replyToTicket(canal, "", aberto, "Já chamei alguém.")
  const eliminado = await bruno.session.openTicket(canal, "", "Um ticket a eliminar")
  await ate(async () => bruno.session.ticketsOf(canal, "").length === 2, 30_000, 500)
  await bruno.session.setTicketState(canal, "", eliminado, "closed")
  await ate(async () => bruno.session.ticketsOf(canal, "").find((t) => t.id === eliminado)?.state === "closed", 30_000, 500)
  await bruno.session.deleteTicket(canal, "", eliminado)

  let cofrePc = {}
  check(
    "o cofre do computador tem a conversa, a fotografia, o mural e os tickets",
    await ate(async () => {
      cofrePc = await cofreDe(pc, FRASE)
      const conversa = corposVistos(cofrePc, dm)
      const foto = entradas(cofrePc, dm).find((e) => e.payload.body === "a fotografia do rio")
      const mural = Object.keys(cofrePc.history ?? {}).concat(Object.keys(cofrePc.estadoDoCanal ?? {})).some((c) => entradas(cofrePc, c).some((e) => e.payload.id === publicacao))
      return (
        conversa.filter((c) => c.startsWith("mensagem ")).length === 30 &&
        !conversa.includes("esta vai ser apagada") &&
        foto?.payload.attachments?.[0]?.inline === FOTOGRAFIA &&
        mural &&
        entradas(cofrePc, canal).some((e) => e.payload.ticket?.removed === true)
      )
    }, 120_000, 2_000),
  )

  // Bruno disconnects and does not come back in this script: history can only come from the computer.
  bruno.session.disconnect()

  // ---------------------------------------------------------------------------
  // 2. Add device, and the six-word phrase on both screens.
  // ---------------------------------------------------------------------------
  await pc.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await pc.getByRole("button", { name: "Aparelhos", exact: true }).click()
  await pc.getByRole("button", { name: "Acrescentar aparelho" }).click()
  const folha = pc.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")

  browserTel = await chromium.launch({ headless: true })
  const redeTel = []
  const ctxTel = await browserTel.newContext({ ...CONTEXTO, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  escutar(ctxTel, redeTel)
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
  check(
    "o ecrã das seis palavras do telemóvel diz que ele recebe as conversas antigas",
    (await tel.locator(".gate-card").innerText()).includes("este aparelho recebe as conversas antigas"),
  )
  check(
    "e o do computador diz que o aparelho novo as recebe",
    (await folha.innerText()).includes("o aparelho novo recebe as conversas antigas"),
  )
  check("sem caixa nem pergunta sobre o histórico", (await tel.locator('.gate-card input[type="checkbox"]').count()) === 0)
  await tel.screenshot({ path: join(RAIZ, "capturas/historico-seis-palavras-telemovel.png") })
  await tel.getByRole("button", { name: "São as mesmas" }).click()
  await folha.getByRole("button", { name: "São as mesmas" }).click()
  await tel.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 })
  await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await tel.getByRole("button", { name: "Entrar", exact: true }).click()
  await dentro(tel)

  // ---------------------------------------------------------------------------
  // 3. The banner, the drop midway, and the end.
  // ---------------------------------------------------------------------------
  // The banner sits above the chat: open any chat.
  await tel.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  await tel.locator(".channel-list .channel-name").first().click().catch(() => {})
  const barraVista = await ate(async () => (await tel.locator(".barra-historico").count()) > 0, 90_000, 200)
  check("o telemóvel mostra a barra do histórico", barraVista, barraVista ? await tel.locator(".barra-historico").first().innerText() : "")
  if (barraVista) await tel.screenshot({ path: join(RAIZ, "capturas/historico-barra-telemovel.png") })

  // The connection drops midway (the plan is in the vault), and comes back.
  let planoAMeio = null
  await ate(async () => {
    planoAMeio = (await cofreDe(tel, FRASE)).historico?.plano ?? null
    return planoAMeio !== null
  }, 30_000, 500)
  await ctxTel.setOffline(true)
  await wait(5_000)
  const cofreOffline = await cofreDe(tel, FRASE)
  check("a ligação cai a meio, e o plano fica no cofre", planoAMeio !== null && cofreOffline.historico?.plano !== undefined)
  await ctxTel.setOffline(false)

  let cofreTel = {}
  check(
    "a ligação volta, e o histórico acaba de chegar",
    await ate(async () => {
      cofreTel = await cofreDe(tel, FRASE)
      return cofreTel.historico?.plano === undefined && cofreTel.historico?.inicial === undefined
    }, 300_000, 3_000),
  )

  // ---------------------------------------------------------------------------
  // 4. What the mobile has.
  // ---------------------------------------------------------------------------
  const ids = entradas(cofreTel, dm).map((e) => chaveDoEvento(e) ?? `seq:${e.seq}`)
  check("a conversa inteira, sem duplicados", corposVistos(cofreTel, dm).filter((c) => c.startsWith("mensagem ")).length === 30 && new Set(ids).size === ids.length, `${ids.length} entradas`)
  check("a mensagem apagada continua apagada", !corposVistos(cofreTel, dm).includes("esta vai ser apagada"))
  check("a fotografia, com os bytes", entradas(cofreTel, dm).find((e) => e.payload.body === "a fotografia do rio")?.payload.attachments?.[0]?.inline === FOTOGRAFIA)
  const canaisTel = [...new Set([...Object.keys(cofreTel.history ?? {}), ...Object.keys(cofreTel.estadoDoCanal ?? {})])]
  check("a publicação do mural do Bruno", canaisTel.some((c) => entradas(cofreTel, c).some((e) => e.payload.id === publicacao)))
  const tickets = ticketsOf([...entradas(cofreTel, canal)].sort((a, b) => a.seq - b.seq), "", () => false, (quem) => quem === bruno.address)
  check("o ticket aberto, e o eliminado continua eliminado", tickets.length === 1 && tickets[0]?.id === aberto, tickets.map((t) => t.subject).join(", "))
  const lidasPc = cofrePc.lidas ?? {}
  check(
    "as marcas de lido não andaram para trás",
    Object.entries(lidasPc).every(([c, marca]) => (cofreTel.lidas?.[c] ?? 0) >= marca),
  )

  // In the interface: the chat with Bruno shows the first message, no reload.
  await tel.getByRole("button", { name: "Amigos", exact: true }).first().click()
  // At 390 px the chat list is in a closed drawer: the click goes through the DOM.
  await tel.locator(".direct-open").first().waitFor({ state: "attached", timeout: 30_000 })
  await tel.evaluate(() => document.querySelector(".direct-open")?.click())
  const naConversa = await ate(async () => (await tel.evaluate(() => document.body.textContent ?? "")).includes("mensagem 1 do Bruno"), 30_000)
  check(
    "na conversa com o Bruno, o telemóvel mostra a primeira mensagem",
    naConversa,
    naConversa ? "" : (await tel.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").slice(0, 300),
  )
  if (naConversa) await tel.screenshot({ path: join(RAIZ, "capturas/historico-conversa-telemovel.png") })
  const erros = [...redePc, ...redeTel].filter((linha) => linha.startsWith("PAGEERROR"))
  check("nenhum erro de página nos dois browsers", erros.length === 0, erros.slice(0, 2).join(" | "))
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
await arrumar(passaram === results.length ? 0 : 1)
