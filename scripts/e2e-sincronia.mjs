/**
 * The mandatory test for absolute sync (S6, §8.3 of the plan
 * `docs/planos/2026-10-20-sincronia-absoluta.md`), in real browsers.
 *
 *   node scripts/e2e-sincronia.mjs                    (all three engines)
 *   node scripts/e2e-sincronia.mjs chromium webkit    (only these)
 *
 * Requires `npm run build` and `npm run build -w @enclave/server` first: serves
 * `apps/web/dist` and runs `apps/server/dist`.
 *
 * Who joins. Ana and Bruno are Node sessions (write fast and are the reference).
 * Carla and Dora are accounts created by the UI, one per engine, each in its own
 * Playwright context (one owner per browser), and Carla with a second tab open
 * that must wait with no WebSocket. Eva is an account with two paired devices
 * (Node) that both enter the same commit.
 *
 * How to compare. Each browser account's vault is read from IndexedDB and
 * unlocked here with the passphrase (as in `e2e-separadores.mjs`); the level-0
 * digest is computed with the SAME function from the core (`resumoDoCanal`) for
 * all accounts. "Equal" is: the same digest in the types being compared. Time
 * counts from the trigger (reconnect, being seated) to the first equal digest;
 * the browser vault saves in batches (one and a half seconds), and reading takes
 * about half a second, so time has a grain of roughly 2 s.
 *
 * The scenarios, by engine (§8.1):
 *
 *  1. Account offline "one hour": the front end cuts Carla's WebSocket and
 *     won't let her back; her page clock runs one hour forward (`clock.fastForward`);
 *     meanwhile 50 messages, 5 posts, 20 comments, 5 votes, one role change and
 *     one ticket. Target: 2 min after reconnect.
 *  2. Server loses events: with Carla cut off, 10 messages, of which the server
 *     loses 5 (deleted from the database). They come back by report. Target: 2 min.
 *  3. Vault at cap: one old tombstone and one old post, then 410 messages (the
 *     vault stores 400 per channel). The wall and tombstones stay equal, and the
 *     deleted message does not come back to the screen. Target: 30 s after the
 *     last one.
 *  4. Member who joins late (Dora): Bruno seats her in a channel with a wall,
 *     comments, votes from two people, roles and one ticket. Target: 30 s.
 *     The place marker appears on screen, and no message before the marker is in
 *     the vault.
 *  5. The "Receiving" banner after a crash: Carla is seated in the same channel,
 *     and her connection drops halfway through receiving for 8 s. At the end the
 *     banner is not on screen and the digest is equal.
 *
 * And once, with no browser: Eva (PC and phone paired) is seated in a channel,
 * both leaves in the same commit, and both stay equal. Target: 30 s.
 *
 * ALL LOCAL AND ALL DISPOSABLE, after the pattern of `e2e-separadores.mjs`: its
 * own homeserver in a temporary folder that gets deleted at the end, free ports
 * chosen by the system, and no way to point it at production.
 */
import { spawn } from "node:child_process"
import { webcrypto } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { argon2id } from "@noble/hashes/argon2.js"
import { chromium, firefox, webkit } from "playwright"
import { resumoDoCanal, Session, TIPOS_DO_INSTANTANEO, TIPOS_RELATAVEIS, tiposDiferentes, Vault } from "@enclave/client-core"
import { moradaDeSala, parseServerName } from "@enclave/protocol"
import { criarConta } from "./conta.mjs"

if (!globalThis.crypto) globalThis.crypto = webcrypto

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const FRASE = "frase-de-verificacao-2026"
const MOTORES = { chromium, firefox, webkit }
const META_LIGADAS_MS = 30_000
const META_VOLTAR_MS = 120_000
const ESPERA = "Já tens o Orwell aberto noutro separador."
/** Text the script writes for Ana (not a UI label). See `strings.guioes.test.ts`. */
const APAGADA = "para apagar"
/** Where the time table goes for the report. Outside the repository. */
const SAIDA = process.env.E2E_SINCRONIA_SAIDA ?? ""

const pedidos = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
const escolhidos = pedidos.length ? pedidos : Object.keys(MOTORES)
for (const nome of escolhidos) {
  if (!MOTORES[nome]) {
    console.error(`Motor desconhecido: ${nome}. Usa chromium, firefox ou webkit.`)
    process.exit(2)
  }
}
for (const [o_que, caminho] of [["a web construída", join(DIST, "index.html")], ["o servidor construído", SERVIDOR_JS]]) {
  if (!existsSync(caminho)) {
    console.error(`Falta ${o_que}: ${caminho}. Corre \`npm run build\` primeiro.`)
    process.exit(2)
  }
}

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

const PORTA_DA_FRENTE = await portaLivre()
const PORTA_DO_SERVIDOR = await portaLivre()
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`

// --- the homeserver, disposable -----------------------------------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-sincronia-"))
const BASE = join(dados, "enclave.sqlite")
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR),
    ENCLAVE_COMMUNITY_MODE: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
})
let registoDoServidor = ""
servidor.stdout.on("data", (bocado) => (registoDoServidor += bocado))
servidor.stderr.on("data", (bocado) => (registoDoServidor += bocado))

// --- the front end, which acts as Caddy and can cut an account's connection ---------
/*
  Each browser context carries in the User-Agent the marker `conta/<nome>`. The
  WebSocket carries User-Agent in all engines, and that is how the front
  disconnects an account (closes its sockets and refuses new ones) without
  touching others. It is the "account disconnected" without `setOffline`, which
  does not close WebSockets the same way across the three engines.
*/
const cortadas = new Set()
const socketsDe = new Map()
const contaDoPedido = (pedido) => /conta\/(\S+)/.exec(pedido.headers["user-agent"] ?? "")?.[1] ?? null
function cortar(conta) {
  cortadas.add(conta)
  for (const socket of socketsDe.get(conta) ?? []) socket.destroy()
}
function religar(conta) {
  cortadas.delete(conta)
}

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json", ".wasm": "application/wasm" }
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
  const conta = contaDoPedido(pedido)
  if (conta && cortadas.has(conta)) {
    resposta.writeHead(503)
    resposta.end()
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
  const conta = contaDoPedido(pedido)
  if (conta && cortadas.has(conta)) {
    socket.destroy()
    return
  }
  if (conta) {
    const lista = socketsDe.get(conta) ?? new Set()
    lista.add(socket)
    socketsDe.set(conta, lista)
    socket.on("close", () => lista.delete(socket))
  }
  const destino = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => {
    const linhas = [`${pedido.method} ${pedido.url} HTTP/${pedido.httpVersion}`]
    for (let i = 0; i < pedido.rawHeaders.length; i += 2) linhas.push(`${pedido.rawHeaders[i]}: ${pedido.rawHeaders[i + 1]}`)
    destino.write(`${linhas.join("\r\n")}\r\n\r\n`)
    if (cabeca.length) destino.write(cabeca)
    socket.pipe(destino).pipe(socket)
  })
  destino.on("error", () => socket.destroy())
  socket.on("error", () => destino.destroy())
  socket.on("close", () => destino.destroy())
})
await new Promise((resolve) => frente.listen(PORTA_DA_FRENTE, "127.0.0.1", resolve))

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function ate(condicao, ms = 60_000, passo = 300) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await Promise.resolve().then(condicao).catch(() => false)) return true
    await espera(passo)
  }
  return false
}
async function servidorDePe() {
  return ate(
    () =>
      new Promise((resolve) => {
        const sonda = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => {
          sonda.destroy()
          resolve(true)
        })
        sonda.on("error", () => resolve(false))
      }),
    15_000,
    250,
  )
}

const sessoes = []
const browsers = []
async function arrumar(codigo) {
  for (const s of sessoes) s.disconnect()
  for (const b of browsers) await b.close().catch(() => {})
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
  process.exit(codigo)
}
if (!(await servidorDePe())) {
  console.error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
  await arrumar(2)
}

// --- accounts in Node ----------------------------------------------------------
class CofreEmMemoria {
  bytes = null
  supportsOsProtection = false
  async read() {
    return this.bytes
  }
  async write(b) {
    this.bytes = b
  }
  async clear() {
    this.bytes = null
  }
}

async function contaNode(nome) {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create(FRASE)
  const session = new Session(vault)
  await session.createIdentity(NOME)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  sessoes.push(session)
  const avisos = []
  session.on("status", (e) => e.code && avisos.push(e.code))
  return { nome, vault, session, address: session.identity.address, avisos }
}

const mensagem = (body) => ({ t: "message", id: crypto.randomUUID(), body, sentAt: Date.now(), attachments: [] })
const publicacao = (id, caption) => ({ t: "post", id, postedAt: Date.now(), caption, media: [], links: [], tags: [] })
const corpos = (conta, canal, prefixo) =>
  conta.session
    .history(canal)
    .map((e) => String(e.payload.body ?? e.payload.caption ?? ""))
    .filter((c) => c.startsWith(prefixo))
const seqsDe = (conta, canal, prefixo) =>
  conta.session
    .history(canal)
    .filter((e) => String(e.payload.body ?? "").startsWith(prefixo))
    .map((e) => e.seq)
    .filter((seq) => seq >= 0)
    .sort((a, b) => a - b)

function apagarDoServidor(canal, seqs) {
  const base = new DatabaseSync(BASE)
  for (const seq of seqs) base.prepare("DELETE FROM events WHERE channel = ? AND seq = ?").run(canal, seq)
  base.close()
}

// --- the vault of a browser account ------------------------------------------
async function cofreDe(page) {
  const bruto = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const pedido = indexedDB.open("enclave", 1)
        pedido.onerror = () => reject(pedido.error)
        pedido.onsuccess = () => {
          const leitura = pedido.result.transaction("vault", "readonly").objectStore("vault").get("current")
          leitura.onsuccess = () => resolve(leitura.result ? new TextDecoder().decode(leitura.result) : null)
          leitura.onerror = () => reject(leitura.error)
        }
      }),
  )
  if (!bruto) return null
  // The plaintext header from 1.0 (`orwv2` and a newline, chunk 2) before the JSON.
  const ficheiro = JSON.parse(bruto.startsWith("orwv2\n") ? bruto.slice(6) : bruto)
  const b64 = (texto) => Buffer.from(texto.replace(/-/g, "+").replace(/_/g, "/"), "base64")
  const chave = argon2id(new TextEncoder().encode(FRASE), b64(ficheiro.salt), { t: 3, m: 65_536, p: 4, dkLen: 32 })
  return JSON.parse(new TextDecoder().decode(xchacha20poly1305(chave, b64(ficheiro.nonce)).decrypt(b64(ficheiro.ciphertext))))
}

/** The types where the browser's vault differs from the reference (Node) in the given window. */
function diferencas(referencia, cofre, canal, tipos, desde) {
  if (!cofre) return ["sem-cofre"]
  const a = resumoDoCanal(referencia.vault.contents, canal, { desde })
  const b = resumoDoCanal(cofre, canal, { desde })
  return tiposDiferentes(a, b).filter((tipo) => tipos.includes(tipo))
}

/**
 * Wait until the page's vault matches the reference in the given types.
 * Returns the ms since `inicio`, or `null` with what stayed different.
 */
async function ateIgual(page, referencia, canal, tipos, { inicio, prazo, desde }) {
  let ultima = []
  while (Date.now() - inicio < prazo) {
    const cofre = await cofreDe(page).catch(() => null)
    ultima = diferencas(referencia, cofre, canal, tipos, desde(cofre))
    if (ultima.length === 0) return { ms: Date.now() - inicio, diferentes: [] }
    await espera(1_000)
  }
  return { ms: null, diferentes: ultima }
}

const RELATAVEIS = [...TIPOS_RELATAVEIS].filter((tipo) => tipo !== "perfil" && tipo !== "amigos")
const DO_INSTANTANEO = [...TIPOS_DO_INSTANTANEO]
/** The common window of two accounts: the most recent place. */
const janela = (canal, ...cofres) => Math.max(-1, ...cofres.map((c) => c?.seatSince?.[canal] ?? -1))

// --- UI steps --------------------------------------------------------
// `.first()`: the UI has two buttons with this name (one in the bar and one in
// the account banner), and Playwright's strict mode refused both.
const dentro = (page, timeout = 90_000) => page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout })

async function enderecoDe(page) {
  await page.getByRole("button", { name: "Amigos", exact: true }).first().click()
  await page.locator(".people-tabs").getByRole("button", { name: "Encontrar" }).click()
  const link = await page.getByLabel("O teu link de amizade", { exact: true }).inputValue()
  await page.getByRole("button", { name: "Comunidades" }).first().click()
  // The short friend link (`/a#<id>`, slice 5b-1) leads to local only; the long
  // one led to the full address. Both resolve to the same address.
  const doFragmento = decodeURIComponent(new URL(link).hash.slice(1))
  return doFragmento.startsWith("@") ? doFragmento : `@${doFragmento}:${NOME}`
}

async function abrirCanal(page, curto) {
  await page.getByRole("button", { name: "Comunidades" }).first().click().catch(() => {})
  const entrada = page.getByText(curto, { exact: true }).first()
  if (!(await ate(() => entrada.isVisible(), 60_000))) return false
  await entrada.click()
  return true
}

const ve = (page, texto, timeout = 30_000) =>
  page.getByText(texto, { exact: false }).first().waitFor({ timeout }).then(
    () => true,
    () => false,
  )

// --- a tabela ------------------------------------------------------------------
const tempos = []
function medir(motor, cenario, ms, meta, extra = "") {
  tempos.push({ motor, cenario, ms, meta, extra })
}

const resultadoPorMotor = {}
const results = []
function checkGeral(nome, ok, detalhe = "") {
  results.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}

try {
  const ana = await contaNode("Ana")
  const bruno = await contaNode("Bruno")

  // ---------------------------------------------------------------------------
  // 0. Two paired devices, seated in the same commit (no browser).
  // ---------------------------------------------------------------------------
  {
    const esperarFase = (session, fase, prazoMs = 30_000) =>
      new Promise((resolve, reject) => {
        const prazo = setTimeout(() => {
          desligar()
          reject(new Error(`nunca chegou a fase ${fase}`))
        }, prazoMs)
        const desligar = session.on("pair", (evento) => {
          if (evento.fase === fase) {
            clearTimeout(prazo)
            desligar()
            resolve(evento)
          } else if (evento.fase === "falhou") {
            clearTimeout(prazo)
            desligar()
            reject(new Error(`falhou: ${evento.razao}`))
          }
        })
      })
    const evaPc = await contaNode("Eva")
    const vaultTel = new Vault(new CofreEmMemoria())
    await vaultTel.create(FRASE)
    const evaTel = { nome: "Eva (telemóvel)", vault: vaultTel, session: new Session(vaultTel) }
    sessoes.push(evaTel.session)
    const sasPc = esperarFase(evaPc.session, "sas")
    const { link } = await evaPc.session.emparelharComoAnfitriao()
    const sasTel = esperarFase(evaTel.session, "sas")
    evaTel.session.emparelharComoConvidado(link)
    await Promise.all([sasPc, sasTel])
    const certificado = esperarFase(evaTel.session, "certificado")
    const concluido = esperarFase(evaPc.session, "concluido")
    await evaTel.session.confirmarSas()
    await evaPc.session.confirmarSas()
    await certificado
    evaTel.session.loadIdentity()
    await evaTel.session.connect()
    await espera(500)
    evaTel.session.concluirEmparelhamento()
    await concluido
    checkGeral("a Eva emparelha o telemóvel no PC", evaTel.session.identity.address === evaPc.address)

    // Opaque addresses: the 1.0 server does not debut rooms with names (slice 6a).
    const canal = moradaDeSala(parseServerName(NOME))
    await ana.session.createSpaceChannel(canal)
    await ana.session.seat(canal, bruno.address)
    await ate(() => bruno.session.channels.includes(canal))
    await ana.session.send(canal, mensagem("antes da Eva"))
    const posts = []
    for (let i = 0; i < 15; i++) {
      const id = crypto.randomUUID()
      posts.push(id)
      await ana.session.send(canal, publicacao(id, `mural ${i}`))
    }
    for (let i = 0; i < 30; i++) await bruno.session.commentOnPost(canal, posts[i % 15], `comentário ${i}`)
    for (let i = 0; i < 5; i++) await bruno.session.voteOnPoll(canal, posts[i], 1)
    await bruno.session.openTicket(canal, "", "Ticket do Bruno")
    await ate(() => tiposDiferentes(resumoDoCanal(ana.vault.contents, canal, {}), resumoDoCanal(bruno.vault.contents, canal, {})).length === 0, 60_000)
    ana.session.disconnect()

    const inicio = Date.now()
    await bruno.session.seat(canal, evaPc.address)
    const entraram = await ate(() => evaPc.session.channels.includes(canal) && evaTel.session.channels.includes(canal), 30_000, 100)
    checkGeral("os dois aparelhos da Eva entram", entraram)
    const lugarPc = evaPc.vault.contents.seatSince?.[canal]
    const lugarTel = evaTel.vault.contents.seatSince?.[canal]
    checkGeral("no mesmo commit (o mesmo lugar)", lugarPc !== undefined && lugarPc === lugarTel, `${lugarPc} e ${lugarTel}`)
    const igual = (quem) => tiposDiferentes(resumoDoCanal(bruno.vault.contents, canal, { desde: Number.MAX_SAFE_INTEGER }), resumoDoCanal(quem.vault.contents, canal, { desde: Number.MAX_SAFE_INTEGER })).filter((t) => DO_INSTANTANEO.includes(t)).length === 0
    const ok = await ate(() => igual(evaPc) && igual(evaTel), META_LIGADAS_MS * 2, 200)
    const ms = Date.now() - inicio
    checkGeral("os dois aparelhos ficam iguais ao Bruno", ok, `${ms} ms`)
    checkGeral("dentro da meta de 30 s", ok && ms <= META_LIGADAS_MS, `${ms} ms`)
    checkGeral("e nenhum recebe a conversa de antes do lugar", corpos(evaPc, canal, "antes da Eva").length === 0 && corpos(evaTel, canal, "antes da Eva").length === 0)
    medir("node", "dois aparelhos no mesmo commit", ok ? ms : null, META_LIGADAS_MS)
    await ana.session.connect()
  }

  // ---------------------------------------------------------------------------
  // Por motor.
  // ---------------------------------------------------------------------------
  for (const motor of escolhidos) {
    const resultados = []
    const check = (nome, ok, detalhe = "") => {
      resultados.push(Boolean(ok))
      console.log(`${ok ? "  ok  " : " FALHA"} [${motor}] ${nome}${detalhe ? `  (${detalhe})` : ""}`)
    }
    let browser
    try {
      browser = await MOTORES[motor].launch({ headless: true })
      browsers.push(browser)
      const sonda = await browser.newPage()
      const uaBase = await sonda.evaluate(() => navigator.userAgent)
      await sonda.close()
      const erros = []
      const novoContexto = async (conta, { relogio = false } = {}) => {
        const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1200, height: 860 }, userAgent: `${uaBase} conta/${conta}` })
        if (relogio) await ctx.clock.install()
        ctx.on("page", (page) => page.on("console", (m) => m.type() === "error" && erros.push(`${conta}: ${m.text()}`)))
        return ctx
      }

      // Carla: one context with controlled clock and two tabs.
      const contaCarla = `carla-${motor}`
      const ctxCarla = await novoContexto(contaCarla, { relogio: true })
      const carla = await ctxCarla.newPage()
      let socketsDaCarla = 0
      carla.on("websocket", () => (socketsDaCarla += 1))
      await carla.goto(APP, { waitUntil: "domcontentloaded" })
      await criarConta(carla, { nome: "Carla", frase: FRASE, servidor: NOME })
      await dentro(carla)
      const enderecoCarla = await enderecoDe(carla)
      check("a Carla cria conta pela interface", /^@[^:]+:/.test(enderecoCarla), enderecoCarla)

      const segundo = await ctxCarla.newPage()
      let socketsDoSegundo = 0
      segundo.on("websocket", () => (socketsDoSegundo += 1))
      await segundo.goto(APP, { waitUntil: "domcontentloaded" })
      check("o segundo separador da Carla fica à espera (um dono por browser)", await ve(segundo, ESPERA, 15_000))

      // Ana's channel, with Bruno and Carla.
      const curto = `lagar-${motor}-${Math.random().toString(36).slice(2, 6)}`
      // The address is drawn at random and the name goes inside (1.0 "Arca"): Carla
      // finds it on screen by name.
      const canal = moradaDeSala(parseServerName(NOME))
      await ana.session.createSpaceChannel(canal, curto)
      await ana.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["convidar"] })
      await ana.session.seat(canal, bruno.address)
      await ate(() => bruno.session.channels.includes(canal))
      await ana.session.seat(canal, enderecoCarla)
      check("a Carla vê o canal e abre-o", await abrirCanal(carla, curto))
      await ana.session.send(canal, mensagem("olá a todos"))
      check("a Carla lê a Ana ao vivo", await ve(carla, "olá a todos"))

      // 1. Account offline for one hour.
      cortar(contaCarla)
      await carla.clock.fastForward("01:00:00")
      const adiantado = (await carla.evaluate(() => Date.now())) - Date.now()
      check("1. o relógio da página da Carla andou uma hora", adiantado > 59 * 60_000, `${Math.round(adiantado / 60_000)} min`)
      for (let i = 0; i < 50; i++) await ana.session.send(canal, mensagem(`fora ${i}`))
      const posts = []
      for (let i = 0; i < 5; i++) {
        const id = crypto.randomUUID()
        posts.push(id)
        await ana.session.send(canal, publicacao(id, `mural ${i}`))
      }
      for (let i = 0; i < 20; i++) await bruno.session.commentOnPost(canal, posts[i % 5], `comentário ${i}`)
      for (const post of posts) await bruno.session.voteOnPoll(canal, post, 1)
      await ana.session.assignRoles(canal, bruno.address, ["porteiro"])
      await ana.session.openTicket(canal, "", "A porta não fecha")
      await ate(() => corpos(bruno, canal, "fora 49").length === 1, 60_000)
      const socketsAntes = socketsDaCarla
      let inicio = Date.now()
      religar(contaCarla)
      await ate(() => socketsDaCarla > socketsAntes, 120_000, 100)
      const ligouEm = Date.now() - inicio
      inicio = Date.now()
      let r = await ateIgual(carla, ana, canal, RELATAVEIS, { inicio, prazo: META_VOLTAR_MS + 60_000, desde: (c) => janela(canal, ana.vault.contents, c) })
      check("1. desligada uma hora: igual depois de ligar", r.ms !== null, r.ms === null ? r.diferentes.join(",") : `${r.ms} ms, religou em ${ligouEm} ms`)
      check("1. dentro da meta de 2 min", r.ms !== null && r.ms <= META_VOLTAR_MS)
      check("1. e no ecrã (a última mensagem)", await ve(carla, "fora 49", 10_000))
      medir(motor, "1. desligada uma hora", r.ms, META_VOLTAR_MS, `voltou a ligar em ${ligouEm} ms`)

      // 2. Server that drops events.
      cortar(contaCarla)
      for (let i = 0; i < 10; i++) await ana.session.send(canal, mensagem(`perdida ${i}`))
      await ate(() => seqsDe(bruno, canal, "perdida ").length === 10, 30_000)
      const perdidas = seqsDe(bruno, canal, "perdida ").slice(2, 7)
      apagarDoServidor(canal, perdidas)
      const antes2 = socketsDaCarla
      inicio = Date.now()
      religar(contaCarla)
      await ate(() => socketsDaCarla > antes2, 120_000, 100)
      r = await ateIgual(carla, ana, canal, RELATAVEIS, { inicio, prazo: META_VOLTAR_MS + 60_000, desde: (c) => janela(canal, ana.vault.contents, c) })
      check("2. o servidor perdeu 5: voltam por relato", r.ms !== null, r.ms === null ? r.diferentes.join(",") : `${r.ms} ms`)
      check("2. dentro da meta de 2 min", r.ms !== null && r.ms <= META_VOLTAR_MS)
      check("2. e a que se perdeu está no ecrã", await ve(carla, "perdida 4", 10_000))
      medir(motor, "2. servidor perde eventos", r.ms, META_VOLTAR_MS, `${perdidas.length} apagadas`)

      // 3. Cofre no tecto.
      const antiga = crypto.randomUUID()
      await ana.session.send(canal, publicacao(antiga, "a publicação antiga"))
      await bruno.session.commentOnPost(canal, antiga, "o comentário antigo")
      await ana.session.send(canal, mensagem(APAGADA))
      await ate(() => corpos(bruno, canal, APAGADA).length === 1)
      const alvo = ana.session.history(canal).find((e) => e.payload.body === APAGADA)
      await ana.session.deleteMessage(canal, alvo.payload.id)
      for (let i = 0; i < 410; i++) await ana.session.send(canal, mensagem(`enchimento ${i}`))
      inicio = Date.now()
      const SEM_MENSAGENS = RELATAVEIS.filter((t) => t !== "mensagem" && t !== "edicao" && t !== "reaccao")
      r = await ateIgual(carla, ana, canal, SEM_MENSAGENS, { inicio, prazo: META_LIGADAS_MS + 60_000, desde: () => -1 })
      const cofre3 = await cofreDe(carla)
      check("3. cofre no tecto: mural e lápides iguais", r.ms !== null, r.ms === null ? r.diferentes.join(",") : `${r.ms} ms`)
      check("3. dentro da meta de 30 s", r.ms !== null && r.ms <= META_LIGADAS_MS)
      check("3. o cofre da Carla está no tecto", (cofre3?.history?.[canal]?.length ?? 0) <= 400, String(cofre3?.history?.[canal]?.length))
      check("3. a mensagem apagada não volta ao ecrã", (await carla.getByText(APAGADA, { exact: true }).count()) === 0)
      medir(motor, "3. cofre no tecto", r.ms, META_LIGADAS_MS)

      // 4. Member who joins late (Dora), in the second channel.
      const curto2 = `adega-${motor}-${Math.random().toString(36).slice(2, 6)}`
      const canal2 = moradaDeSala(parseServerName(NOME))
      await ana.session.createSpaceChannel(canal2, curto2)
      await ana.session.defineRole(canal2, { role: "porteiro", name: "Porteiro", powers: ["convidar"] })
      await ana.session.seat(canal2, bruno.address)
      await ate(() => bruno.session.channels.includes(canal2))
      await ana.session.assignRoles(canal2, bruno.address, ["porteiro"])
      await ana.session.send(canal2, mensagem("dito antes da Dora"))
      const posts2 = []
      for (let i = 0; i < 30; i++) {
        const id = crypto.randomUUID()
        posts2.push(id)
        await ana.session.send(canal2, publicacao(id, `nota ${i} ${"do lagar ".repeat(20)}`))
      }
      for (let i = 0; i < 100; i++) await bruno.session.commentOnPost(canal2, posts2[i % 30], `comentário ${i}`)
      for (let i = 0; i < 10; i++) await (i % 2 ? ana : bruno).session.voteOnPoll(canal2, posts2[i], 1)
      await bruno.session.openTicket(canal2, "", "Ticket do Bruno")
      await ate(() => tiposDiferentes(resumoDoCanal(ana.vault.contents, canal2, {}), resumoDoCanal(bruno.vault.contents, canal2, {})).length === 0, 60_000)

      const contaDora = `dora-${motor}`
      const ctxDora = await novoContexto(contaDora)
      const dora = await ctxDora.newPage()
      await dora.goto(APP, { waitUntil: "domcontentloaded" })
      await criarConta(dora, { nome: "Dora", frase: FRASE, servidor: NOME })
      await dentro(dora)
      const enderecoDora = await enderecoDe(dora)
      inicio = Date.now()
      await bruno.session.seat(canal2, enderecoDora)
      const abriu = await abrirCanal(dora, curto2)
      check("4. a Dora é sentada e abre o canal", abriu)
      const barra = dora.locator(".barra-sincronia")
      let viuBarra = false
      const vigia = (async () => {
        const fim = Date.now() + META_LIGADAS_MS
        while (Date.now() < fim && !viuBarra) {
          viuBarra = await barra.isVisible().catch(() => false)
          await espera(200)
        }
      })()
      r = await ateIgual(dora, bruno, canal2, DO_INSTANTANEO, { inicio, prazo: META_LIGADAS_MS + 60_000, desde: () => Number.MAX_SAFE_INTEGER })
      await vigia
      check("4. entra tarde: estado e mural iguais", r.ms !== null, r.ms === null ? r.diferentes.join(",") : `${r.ms} ms`)
      check("4. dentro da meta de 30 s", r.ms !== null && r.ms <= META_LIGADAS_MS)
      const cofre4 = await cofreDe(dora)
      const lugar = cofre4?.seatSince?.[canal2] ?? -1
      const antesDoLugar = (cofre4?.history?.[canal2] ?? []).filter((e) => e.payload?.t === "message" && e.seq >= 0 && e.seq < lugar)
      check("4. nenhuma mensagem de antes do lugar no cofre", antesDoLugar.length === 0 && !(cofre4?.history?.[canal2] ?? []).some((e) => e.payload?.body === "dito antes da Dora"))
      await bruno.session.send(canal2, mensagem("Bem-vinda, Dora."))
      check("4. o marcador do lugar aparece no ecrã", await ate(() => dora.locator(".timeline-lugar").isVisible(), 30_000))
      check("4. a barra não fica no ecrã", await ate(async () => !(await barra.isVisible()), 60_000, 500))
      medir(motor, "4. entra tarde", r.ms, META_LIGADAS_MS, `barra vista: ${viuBarra ? "sim" : "não (acabou antes dos 5 s)"}`)

      // 5. Carla joins the same channel, and the connection drops halfway.
      inicio = Date.now()
      await bruno.session.seat(canal2, enderecoCarla)
      check("5. a Carla abre o segundo canal", await abrirCanal(carla, curto2))
      await espera(1_500)
      cortar(contaCarla)
      await espera(8_000)
      religar(contaCarla)
      r = await ateIgual(carla, bruno, canal2, DO_INSTANTANEO, { inicio, prazo: META_VOLTAR_MS + 60_000, desde: () => Number.MAX_SAFE_INTEGER })
      check("5. com a queda a meio: estado e mural iguais", r.ms !== null, r.ms === null ? r.diferentes.join(",") : `${r.ms} ms`)
      check("5. dentro da meta de 2 min (conta que volta)", r.ms !== null && r.ms <= META_VOLTAR_MS)
      check('5. a barra "A receber" sai do ecrã', await ate(async () => !(await carla.locator(".barra-sincronia").isVisible()), 60_000, 500))
      medir(motor, "5. entra tarde com queda de 8 s", r.ms, META_VOLTAR_MS)

      // The second tab never opened a WebSocket, and the console stayed clean.
      check("o segundo separador nunca abriu WebSocket", socketsDoSegundo === 0, String(socketsDoSegundo))
      const surdos = [...ana.avisos, ...bruno.avisos].filter((c) => c === "channel-deaf" || c === "channel-forked")
      check("ninguém ficou surdo (nenhum channel-deaf nem channel-forked na Ana e no Bruno)", surdos.length === 0, surdos.join(","))
      const graves = erros.filter((l) => /deaf|surd|epoch|época/i.test(l))
      check("sem erros de época ou surdez na consola", graves.length === 0, graves.slice(0, 2).join(" | ").slice(0, 200))
    } catch (erro) {
      check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
    } finally {
      await browser?.close().catch(() => {})
    }
    resultadoPorMotor[motor] = { passaram: resultados.filter(Boolean).length, total: resultados.length }
  }
} catch (erro) {
  checkGeral("o guião chegou ao fim", false, String(erro?.stack ?? erro).slice(0, 400))
}

console.log("\nTempos até ficar igual:")
console.log("| Motor | Cenário | Tempo | Meta | Nota |")
console.log("|---|---|---|---|---|")
for (const t of tempos) {
  const tempo = t.ms === null ? "NÃO IGUALOU" : `${(t.ms / 1000).toFixed(1)} s`
  console.log(`| ${t.motor} | ${t.cenario} | ${tempo} | ${t.meta / 1000} s | ${t.extra} |`)
}
if (SAIDA) writeFileSync(SAIDA, JSON.stringify(tempos, null, 2))

console.log("")
let tudoBem = results.every(Boolean)
console.log(`geral: ${results.filter(Boolean).length}/${results.length} verificações passaram`)
for (const [motor, { passaram, total }] of Object.entries(resultadoPorMotor)) {
  console.log(`${motor}: ${passaram}/${total} verificações passaram`)
  if (passaram !== total) tudoBem = false
}
await arrumar(tudoBem ? 0 : 1)
