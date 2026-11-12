/**
 * An OLD client against the NEW server, in a real browser.
 *
 *   ORWELL_DIST_ANTIGO=<folder with apps/web/dist from a released version> \
 *     node scripts/e2e-cliente-antigo.mjs        (needs `npm run build` first)
 *
 * The house rule is server first, client after: each server slice must ship
 * without breaking the clients already out there. This is the proof. It starts
 * the fresh-built server, serves an older version of the web in front of it,
 * and does what a person does: create an account, join the common room, swap
 * messages with another account, and invite a third by https link. Nothing can
 * change.
 *
 * And since the claim in bundle (3 do multi-device slice) it counts what each
 * admission by the OLD client costs whoever is admitted, read from the server
 * table `key_packages`: exactly one packet when Ana adds Bruno by address (direct chat
 * claims one), and none from the common room (joins by card) nor from link join
 * (brings the packet inside the request itself). A server that gave the bundle
 * to someone who did not ask would spend more than one here, and that is what
 * this check catches.
 *
 * The old folder comes by environment and is the only thing that comes: it is a
 * folder on disk, never a network target. To get it without rebuilding, copy
 * the `apps/web/dist` BEFORE touching the client; to rebuild it, `git worktree
 * add` from the published
 * commit and `npm run build -w @enclave/web` there.
 *
 * And since 6 October 2026 mede also the PRESENCE QUERY and the field
 * `aVer`, which is what the protocol states in writing. The question "who is in
 * the room?" travels as a `voice.leave` so an old client can receive without choking,  * and in an old client a `voice.leave` REMOVES THE PERSON from the room. Because
 * rosters are indexed by ACCOUNT address and not device, a device that queries
 * can erase the other device of the same account from the screen of whoever is
 * in that call.
 *
 * We measure the flaw and the fix, against the old dist running:
 *
 *   - the query with the call room (the form BEFORE the fix, where the missing
 *     `room` is worth `""` and matches a channel call room) REMOVES the
 *     querier from the room in the old client's eyes. This is the flaw, measured,  *     and it is a NEGATIVE CONTROL, so it SKIPS (with reason written) when the
 *     fixture already brings the guard. See `saltar` and `TEM_GUARDA_DA_PERGUNTA`: the
 *     fixture is told apart by the capacity probed in the bytes served, never
 *     by a version number, a `index.html` from Vite does not declare version, and the
 *     guard landed in a commit that still said 0.3.3;
 *   - the query as this code sends it, with `SALA_DA_PERGUNTA`, a room that
 *     cannot exist, is dropped by its room filter, and removes no one;
 *   - and a `voice.join` with `aVer` is accepted whole: whoever sends it stays in
 *     the room, the channel history stays intact, and there is not a single error
 *     in the console. A rejected payload counted as an ignored event, and
 *     consecutive ignored events mark the channel deaf and fire the repair that
 *     ERASES HISTORY.
 *
 * And since S6 of absolute sync (21/10/2026) it measures ANTI-ENTROPY turned on in
 * new clients with an old browser in the channel (section 8): two new clients
 * diverge (the server loses three events), telemetry runs within the
 * `typing` with `until: 0`, and thirty more telemetry points by hand in a minute. The old
 * one cannot go deaf (no `channel.rejoin.request`), cannot see anything twice, and keeps
 * hearing. It runs against 0.7.2 and against 0.5.7. The
 * 0.7.2 is obtained without worktree, in a folder outside the repo:
 * `git archive 07a2663 | tar -x -C <pasta>`, and there `npm ci && npx tsc -b &&
 * npm run build -w @enclave/web`; the `ORWELL_DIST_ANTIGO` is `<pasta>/apps/web/dist`.
 *
 * And since phase 5 (0.5.8) it measures the ACCOUNT CHANNEL with an old leaf
 * of the same account (section 7): an old browser paired to an account of a
 * new client is not invited to the `!self-`, and after state runs there
 * it keeps hearing and speaking in the shared channel, without asking for a spot.
 * The fixture 0.5.7 is obtained without worktree: `git archive bb23e7a | tar -x -C <pasta>`, and there
 * `npm ci && npx tsc -b && npm run build -w @enclave/web`.
 *
 * The new client of this pair runs in Node, with the `Call` and `Session` of this
 * branch and a WebRTC pretending: what is at stake is signaling, and that all
 * goes through MLS and the real server. Nothing here proves two machines cross
 * a NAT, and no stub would prove it.
 *
 * ALL LOCAL AND ALL DISPOSABLE, by the template of `e2e-convite-link.mjs`: database in a
 * temporary folder deleted at the end, ports checked free, no target by argument.
 * There is no way to point it at production.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { webcrypto } from "node:crypto"
import { chromium } from "playwright"
import { Call, Session, Vault } from "@enclave/client-core"
import { deviceKeyAtLeaf, importSession, leavesOf } from "@enclave/crypto"
import { fromBase64, moradaDeSala, parseServerName, SALA_DA_PERGUNTA, toBase64 } from "@enclave/protocol"
import { criarConta } from "./conta.mjs"

if (!globalThis.crypto) globalThis.crypto = webcrypto

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const DIST = process.env.ORWELL_DIST_ANTIGO ? resolve(process.env.ORWELL_DIST_ANTIGO) : ""
const PORTA_DA_FRENTE = 8472
const PORTA_DO_SERVIDOR = 8473
const NOME = `localhost:${PORTA_DA_FRENTE}`
const SALA_COMUM = `!orwell:${NOME}`
const APP = `http://${NOME}/app/?lingua=pt`
const FRASE = "frase-de-verificacao-2026"

const results = []
function check(nome, ok, detalhe = "") {
  results.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}

/**
 * THE THIRD STATE: this check does not apply to this fixture, and says why.
 *
 * **It exists because of a negative control that turned red when the world got
 * better.** The presence query check measures the BUG in an old client, a
 * `voice.leave` with the call room removed the person from the roster, and
 * against a dist that already has the guard it cannot reproduce anything: it
 * gave 52/53 for no reason. A negative control that turns red when the bug is
 * fixed ends up ignored, and the day it is ignored is the day it hides a real
 * regression.
 *
 * Skipped counts apart and NEVER counts as a pass: the final count says
 * "N/N checks passed (M skipped)", and whoever reads it sees both things.
 */
const saltados = []
function saltar(nome, razao) {
  saltados.push(nome)
  console.log(`  salta ${nome}  (${razao})`)
}

if (!DIST) {
  console.error("Falta ORWELL_DIST_ANTIGO=<pasta com o dist da versão antiga>.")
  process.exit(2)
}
for (const [o_que, caminho] of [["a web antiga", join(DIST, "index.html")], ["o servidor construído", SERVIDOR_JS]]) {
  if (!existsSync(caminho)) {
    console.error(`Falta ${o_que}: ${caminho}.`)
    process.exit(2)
  }
}
/**
 * What this fixture CAN DO, probed in the bytes about to be served.
 *
 * **It is not the version, and we tried version first.** A Vite `index.html`
 * does not declare any version, the `?v=` read here never matched anything and
 * the log line said just the path, and even if it did it would lie: the
 * presence query guard entered in `005d297`, which still had `"version": "0.3.3"`
 * in `package.json`; the jump to 0.4.0 came half an hour later, in another
 * commit. A fixture built between the two has the guard and says 0.3.3.
 *
 * The discriminator is CAPABILITY, read from the code the browser will run: the
 * marker `SALA_DA_PERGUNTA` (`"?quem"`) exists only in bundles that handle the
 * query before the room filter.
 *
 * **Only in `.js`, never in `.map`.** The name `ehPerguntaDePresenca` vanishes
 * in minification, but the string literal stays; source maps, which the browser
 * does not run, carry the whole source and so match always. A grep over the
 * whole folder gives 5 hits in a fixture that has 0 in served code, and it
 * fooled us.
 *
 * And if there is no `.js` to probe, this STOPS: a script whose result depends
 * on what is on disk without checking what is on disk is not a measurement.
 */
function bundlesDe(pasta) {
  const encontrados = []
  for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, entrada.name)
    if (entrada.isDirectory()) encontrados.push(...bundlesDe(caminho))
    else if (entrada.name.endsWith(".js")) encontrados.push(caminho)
  }
  return encontrados
}
const BUNDLES = bundlesDe(DIST)
if (BUNDLES.length === 0) {
  console.error(`A pasta ${DIST} não tem um único .js para sondar: não há com que medir o que este cliente sabe fazer.`)
  process.exit(2)
}
/** Does this fixture handle the presence query, or is it older than its guard? */
const TEM_GUARDA_DA_PERGUNTA = BUNDLES.some((caminho) => readFileSync(caminho, "utf8").includes(SALA_DA_PERGUNTA))
/**
 * Does this fixture already know about `friends.shown` (0.5.7 does)? If so, section 6
 * has no bug to reproduce, and skips with the reason: it's the same case as the
 * negative control for the presence query.
 */
const CONHECE_A_LISTA = BUNDLES.some((caminho) => readFileSync(caminho, "utf8").includes("friends.shown"))
/** What about the account channel (phase 5)? A fixture that knows it is not "old" for section 7. */
const CONHECE_O_ESTADO = BUNDLES.some((caminho) => readFileSync(caminho, "utf8").includes("estado.lidas"))
console.log(
  `cliente antigo: ${DIST}  (${BUNDLES.length} bundles; ${TEM_GUARDA_DA_PERGUNTA ? "COM" : "sem"} a guarda da pergunta de presença)`,
)

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

// --- the NEW homeserver, disposable, with common room -------------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-cliente-antigo-"))
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

// --- the front end, which acts as Caddy and serves the OLD web ------------------------
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

let browser
async function arrumar(codigoDeSaida) {
  await browser?.close().catch(() => {})
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
  process.exit(codigoDeSaida)
}

if (!(await servidorDePe())) {
  console.error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
  await arrumar(2)
}

/** The frames and console of a context, to see what the old client did and saw. */
function escutar(context, saco) {
  context.on("page", (page) => {
    page.on("websocket", (ws) => {
      ws.on("framesent", (trama) => saco.push(`TRAMA> ${typeof trama.payload === "string" ? trama.payload : trama.payload.toString("latin1")}`))
      ws.on("framereceived", (trama) => saco.push(`TRAMA< ${typeof trama.payload === "string" ? trama.payload : trama.payload.toString("latin1")}`))
    })
    page.on("console", (mensagem) => {
      if (mensagem.type() === "error") saco.push(`ERRO ${mensagem.text()}`)
    })
    page.on("pageerror", (erro) => saco.push(`PAGEERROR ${String(erro.message)}`))
  })
}
const tiposEnviados = (saco) => saco.filter((l) => l.startsWith("TRAMA>")).map((l) => l.match(/"t":"([^"]+)"/)?.[1]).filter(Boolean)
const errosDe = (saco) => saco.filter((l) => l.startsWith("ERRO") || l.startsWith("PAGEERROR"))

/*
  The WebRTC fake of the NEW client, running in Node.
  
  **Never responds to an offer, and that's on purpose.** What this script measures is
  signaling, who gets removed from the room by a frame and who doesn't -, and an SDP
  made up and handed to real Chromium would be garbage in a browser proving nothing. Without a response, old clients keep
  his card in "connecting" state, which is the truth: on the other side is a Node
  process with no media. The presence map in the sidebar, which is what gets
  measured, lives on signaling and not on connections.
  */
class LigacaoDeFingir {
  localDescription = null
  connectionState = "new"
  ontrack = null
  onicecandidate = null
  onconnectionstatechange = null
  addTrack() {
    return {}
  }
  addTransceiver() {
    return { sender: {} }
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0\r\n" }
  }
  async createAnswer() {
    throw new Error("este cliente não negoceia media")
  }
  async setLocalDescription(descricao) {
    this.localDescription = descricao
  }
  async setRemoteDescription() {
    throw new Error("este cliente não negoceia media")
  }
  async addIceCandidate() {}
  close() {}
}
globalThis.RTCPeerConnection = LigacaoDeFingir
globalThis.RTCRtpSender = class {}
// `navigator` exists in Node 24 and is read-only: assigning to it breaks. What
// we need is `mediaDevices`, which it doesn't have.
Object.defineProperty(globalThis.navigator, "mediaDevices", {
  configurable: true,
  value: {
    getUserMedia: async () => {
      const audio = { kind: "audio", enabled: true, stop: () => {} }
      return { getTracks: () => [audio], getAudioTracks: () => [audio], getVideoTracks: () => [] }
    },
  },
})

/** A vault that lives in memory and dies with the process. */
class CofreNaMemoria {
  bytes = null
  supportsOsProtection = false
  async read() {
    return this.bytes
  }
  async write(bocado) {
    this.bytes = bocado
  }
  async clear() {
    this.bytes = null
  }
}

/**
 * An account on the NEW client: session, `Call`, and any errors it throws.
 *
 * Wired the same way `apps/web` wires it, minus what needs a browser. Errors
 * are stored so we can assert there were none, what fails in a new client
 * talking to an old one is as interesting as the opposite.
 */
async function contaNova(nome) {
  const vault = new Vault(new CofreNaMemoria())
  await vault.create(FRASE)
  const session = new Session(vault)
  const identidade = await session.createIdentity(NOME)
  const erros = []
  session.on("status", (estado) => {
    if (estado.level === "error") erros.push(`${nome}: ${estado.detail}`)
  })
  const call = new Call({
    get selfAddress() {
      return session.identity.address
    },
    sendSignal: (canal, payload) => session.send(canal, payload),
    mediaKey: (canal, address) => session.mediaKey(canal, address),
    reservarContadorSframe: (canal, keyId) => session.reservarContadorSframe(canal, keyId),
  })
  // This client has no media, and its complaints are not what gets measured:
  // it's here to put frames on the wire and to receive them.
  call.on("error", () => {})
  session.on("voice", (evento) => {
    void call.handleSignal(evento.channel, evento.from, evento.payload).catch(() => {})
  })
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  return { nome, session, call, erros, address: identidade.address }
}

const CONTEXTO = { locale: "pt-PT" }
const dentro = (page) => page.getByRole("button", { name: "Configurações", exact: true }).waitFor({ timeout: 90_000 })
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The common room in the sidebar: a button whose name is "orwell". */
async function veASalaComum(page, timeout = 60_000) {
  const fim = Date.now() + timeout
  while (Date.now() < fim) {
    const texto = await page.locator("body").innerText().catch(() => "")
    const lista = texto.split("Entrar com um link")[0] ?? ""
    if (/\borwell\b/i.test(lista)) return true
    await wait(1000)
  }
  return false
}

/**
 * Enter the voice room of the common room by clicking it in the list.
 *
 * In a channel the call belongs to a voice room and you enter by clicking its
 * line (`ChatScreen.tsx`); the "Call" button in the header only exists in direct
 * conversations. The common room is born with a voice room called "voz"
 * (`SALAS_DO_CANAL_COMUM`).
 */
async function entrarNaVoz(page) {
  const voz = page
    .locator(".room-row button.room")
    .filter({ has: page.locator(".room-name", { hasText: "voz" }) })
    .first()
  if (!(await voz.isVisible({ timeout: 15_000 }).catch(() => false))) return false
  await voz.click()
  await wait(1500)
  return true
}

/**
 * How many people THIS client sees in the voice room, by the sidebar.
 *
 * **This is the presence map per ROOM, and the sentinel protects it.** In a room
 * where this client is not, the list comes from `vozPorSala`, fed by signaling
 * and nothing else: each `voice.join` adds a person, each `voice.leave` removes
 * one. So it measures exactly what a frame does to whoever receives it, without
 * depending on any media connection.
 *
 * Two reads because the room line has two shapes: with the fold open, one
 * person per line (`.room-voice-members`); closed, the voice label, "N
 * people in this room" -, which is the `title` of the icon. Reading just one
 * would give zero depending on the fold state, which doesn't matter to what we're
 * measuring.
 */
async function quantosNaVoz(page) {
  const naLista = await page.locator(".room-voice-members li").count().catch(() => 0)
  if (naLista > 0) return naLista
  const rotulo = await page
    .locator('[title$="nesta sala"]')
    .first()
    .getAttribute("title")
    .catch(() => null)
  return Number(rotulo?.match(/^(\d+)/)?.[1] ?? 0)
}

/** How many people the CALL PANEL on this page says are there. */
async function quantosNaChamada(page) {
  const frase = await page
    .locator(".call-meta")
    .first()
    .innerText()
    .catch(() => "")
  return Number(frase.match(/(\d+)\s*pessoa/)?.[1] ?? 0)
}

/**
 * Open a TEXT room of the open channel by name.
 *
 * Entering a voice room also switches the VIEW to it, and the view of a voice
 * room has no channel conversation, so the previous conversation isn't in the
 * document while we're there. This is the way back, and doesn't hang up the call:
 * the panel leaves the view, the call stays.
 */
async function abrirSalaDeTexto(page, nome) {
  const sala = page
    .locator(".room-row button.room")
    .filter({ has: page.locator(".room-name", { hasText: nome }) })
    .first()
  if (!(await sala.isVisible({ timeout: 10_000 }).catch(() => false))) return false
  await sala.click()
  await wait(1200)
  return true
}

/** Wait until the call panel on this page counts this number, or give up. */
async function ateNaChamada(page, quantos, timeout = 30_000) {
  const fim = Date.now() + timeout
  while (Date.now() < fim) {
    if ((await quantosNaChamada(page)) === quantos) return true
    await wait(400)
  }
  return false
}

/** Wait until the voice room has this many people, or give up. */
async function ateVerNaVoz(page, quantos, timeout = 20_000) {
  const fim = Date.now() + timeout
  let ultimo = -1
  while (Date.now() < fim) {
    ultimo = await quantosNaVoz(page)
    if (ultimo === quantos) return true
    await wait(400)
  }
  return false
}

async function abrirSalaComum(page) {
  await page.locator(".channel-name", { hasText: /orwell/i }).first().click()
  await page.locator('input[placeholder="Escreve uma mensagem"]').waitFor({ timeout: 30_000 })
}

/** A channel by the sidebar, until the text input box appears. */
async function abrirCanalAntigo(page, nome) {
  await page.locator(".channel-name", { hasText: nome }).first().click()
  await page.locator('input[placeholder="Escreve uma mensagem"]').waitFor({ timeout: 30_000 })
}

async function dizer(page, frase) {
  const caixa = page.locator('input[placeholder="Escreve uma mensagem"]')
  await caixa.click()
  await caixa.fill(frase)
  await page.keyboard.press("Enter")
}

async function ouviu(page, frase, timeout = 30_000) {
  return page
    .getByText(frase, { exact: false })
    .first()
    .waitFor({ timeout })
    .then(() => true, () => false)
}

try {
  browser = await chromium.launch({
    headless: true,
    /*
      Fake microphone, so we can JOIN a call.
      The presence query is only risky for whoever is inside one, and without
      a capture device `getUserMedia` refuses and nobody joins.
    */
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  })

  // ---------------------------------------------------------------------------
  // 1. Two accounts on the old client, both in the common room.
  // ---------------------------------------------------------------------------
  const redeA = []
  const ctxA = await browser.newContext({ ...CONTEXTO, permissions: ["microphone"] })
  escutar(ctxA, redeA)
  const a = await ctxA.newPage()
  await a.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(a, { nome: "Ana", frase: FRASE, servidor: NOME })
  await dentro(a)
  check("a Ana cria conta no cliente antigo contra o servidor novo", true)
  check("a Ana vê a sala comum", await veASalaComum(a))

  const helloOk = redeA.find((l) => l.startsWith("TRAMA<") && l.includes('"hello.ok"')) ?? ""
  check("o servidor anunciou devices e retentionDays ao cliente antigo", helloOk.includes('"devices"') && helloOk.includes('"retentionDays"'))

  const redeB = []
  const ctxB = await browser.newContext({ ...CONTEXTO, permissions: ["microphone"] })
  escutar(ctxB, redeB)
  const b = await ctxB.newPage()
  await b.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(b, { nome: "Bruno", frase: FRASE, servidor: NOME })
  await dentro(b)
  check("o Bruno cria conta", true)
  check("o Bruno vê a sala comum", await veASalaComum(b))

  // ---------------------------------------------------------------------------
  // 2. Messages both ways, in the common room.
  // ---------------------------------------------------------------------------
  await abrirSalaComum(a)
  await abrirSalaComum(b)
  // The common room must have both inside: give admission time.
  await wait(4000)
  const daAna = `olá Bruno, ${Date.now().toString(36)}`
  await dizer(a, daAna)
  check("a Ana fala na sala comum e o Bruno ouve", await ouviu(b, daAna, 60_000))
  const doBruno = `olá Ana, ${Date.now().toString(36)}`
  await dizer(b, doBruno)
  check("o Bruno responde e a Ana ouve", await ouviu(a, doBruno, 60_000))

  // ---------------------------------------------------------------------------
  // 2b. Ana adds Bruno by address: this is the invite that CLAIMS a key
  //     package (the direct conversation sets Bruno up), and it's that claim,
  //     made by the 0.2.3 client without `bundle`, that must spend exactly one.
  //     Bruno's address is read from the server database, read-only.
  // ---------------------------------------------------------------------------
  const db = new DatabaseSync(join(dados, "enclave.sqlite"), { readOnly: true })
  const gastos = (address) => db.prepare("SELECT count(*) AS n FROM key_packages WHERE address = ? AND claimed = 1").get(address).n
  const contasAntes = db.prepare("SELECT address FROM accounts ORDER BY rowid ASC").all().map((l) => l.address)
  check("o servidor tem as duas contas", contasAntes.length === 2, String(contasAntes.length))
  const [enderecoAna, enderecoBruno] = contasAntes
  check("o Bruno ainda não gastou pacote nenhum (a sala comum entra por cartão)", gastos(enderecoBruno) === 0, String(gastos(enderecoBruno)))
  await a.getByRole("button", { name: "Amigos" }).click()
  await a.locator(".people-destination").waitFor({ timeout: 15_000 })
  /*
    The path that the FIXTURE has, probed on screen. Up to 0.5.6 it's "Add" →
    "Add by address"; from phase 3 of the interface it's "Find" →
    paste address → profile sheet. This script runs against OLD web,
    and the old one today doesn't have the second.
  */
  const temEncontrar = (await a.getByRole("button", { name: "Encontrar", exact: true }).count()) > 0
  if (temEncontrar) {
    await a.getByRole("button", { name: "Encontrar", exact: true }).click()
    await a.getByLabel("Cola um link ou endereço").fill(enderecoBruno)
    await a.getByRole("button", { name: "Abrir perfil" }).click()
    // The address opens the profile sheet; the request is made there, with the single button.
    const pedirNaFolha = a.locator(".person-profile").getByRole("button", { name: "Pedir amizade" })
    await pedirNaFolha.waitFor({ timeout: 10_000 }).then(() => pedirNaFolha.click(), () => {})
    await a.keyboard.press("Escape")
  } else {
    await a.getByRole("button", { name: "Adicionar" }).click()
    await a.getByRole("button", { name: /Adicionar pelo endereço/ }).click()
    await a.locator(".prompt input, .modal input").first().fill(enderecoBruno)
    await a.locator(".prompt button[type='submit'], .prompt .btn-primary").first().click()
  }
  let gastosDoBruno = 0
  for (let volta = 0; volta < 60 && gastosDoBruno === 0; volta++) {
    await wait(500)
    gastosDoBruno = gastos(enderecoBruno)
  }
  await wait(3000)
  check("a conversa directa aparece na coluna de Amigos da Ana", (await a.locator(".people-aside .direct-row").count()) >= 1)
  check("o convite feito pelo cliente 0.2.3 gastou EXACTAMENTE um pacote do Bruno", gastos(enderecoBruno) === 1, String(gastos(enderecoBruno)))
  check("e nenhum da Ana", gastos(enderecoAna) === 0, String(gastos(enderecoAna)))
  // Go back to Communities, so the next step finds the sidebar as it was left.
  await a.getByRole("button", { name: "Comunidades" }).click()
  await abrirSalaComum(a)

  // ---------------------------------------------------------------------------
  // 3. Invite by https link: Ana creates a channel and mints it; a clean browser
  //    opens the link, creates account, accepts, and the channel opens.
  // ---------------------------------------------------------------------------
  await a.getByRole("button", { name: "Criar canal" }).first().click()
  await a.locator("form.prompt input").first().fill("adega")
  await a.locator("form.prompt button.primary").first().click()
  await a.getByRole("heading", { name: "adega" }).waitFor({ timeout: 30_000 })
  /*
    The path that the FIXTURE has, probed on screen, like "Find" above.
    Up to old 0.5.x it's "Create invite link"; then the single invite sheet,
    "Invite…" and the "By link" mode (0.5.7 already is this).
  */
  if ((await a.getByRole("button", { name: "Criar link de convite" }).count()) > 0) {
    await a.getByRole("button", { name: "Criar link de convite" }).first().click()
  } else {
    await a.getByRole("button", { name: "Convidar…" }).first().click()
    await a.locator(".sheet").first().getByRole("button", { name: "Por link" }).click()
  }
  const folha = a.locator(".sheet").first()
  await folha.waitFor({ timeout: 10_000 })
  await folha.getByRole("button", { name: "Criar link" }).click()
  const campo = folha.getByLabel("O teu link")
  await campo.waitFor({ timeout: 15_000 })
  const link = await campo.inputValue()
  await folha.getByRole("button", { name: "Fechar" }).click()
  check("a Ana cunha um link https no cliente antigo", (link.startsWith(`http://${NOME}/app/convite#`) || link.startsWith(`http://${NOME}/c#`)), link.slice(0, 60))

  const redeC = []
  const ctxC = await browser.newContext(CONTEXTO)
  escutar(ctxC, redeC)
  const c = await ctxC.newPage()
  // The short link `/c#…` is redirected by Caddy to `/app/c` (the fragment stays
  // in the browser); this script's front end doesn't have that redirect.
  await c.goto(link.replace(`http://${NOME}/c#`, `http://${NOME}/app/c#`), { waitUntil: "domcontentloaded" })
  await criarConta(c, { nome: "Carla", frase: FRASE, servidor: NOME })
  await dentro(c)
  await c.getByRole("heading", { name: "Convite para um canal" }).waitFor({ timeout: 60_000 })
  await c.getByRole("button", { name: "Entrar", exact: true }).click()
  check(
    "a Carla abre o link, cria conta, aceita, e o canal abre",
    await c.getByRole("heading", { name: "adega" }).waitFor({ timeout: 60_000 }).then(() => true, () => false),
  )
  const naAdega = `bem-vinda Carla ${Date.now().toString(36)}`
  await dizer(a, naAdega)
  check("e a Ana fala na adega e a Carla ouve", await ouviu(c, naAdega, 60_000))

  // ---------------------------------------------------------------------------
  // 3b. The presence query and `aVer`, against a real call running on 0.3.3
  //     clients.
  //
  // The setup is this, and each role has a reason:
  //
  //   - Ana and Bruno (0.3.3) join the voice room of the common room, and really
  //     connect to each other, it's the call that the query cannot break;
  //   - Carla (0.3.3) stays OUT of the call, with the channel open. This is where
  //     we measure the presence map per room, which lives on signaling not on
  //     connections: each `voice.join` adds a person to that room, each
  //     `voice.leave` removes them. This is the path the sentinel protects;
  //   - Diego is the NEW client, in Node, and he's the one putting frames on the wire.
  //
  // And the order is the argument: first we measure the BUG, the query with the
  // call room removes whoever queries from the room -, and only then show that
  // the query as this code sends it doesn't remove anyone. Without the first half,
  // the second would pass because the frame never got anywhere.
  // ---------------------------------------------------------------------------
  await a.getByRole("button", { name: "Comunidades" }).click()
  await abrirSalaComum(a)
  await abrirSalaComum(b)
  await c.getByRole("button", { name: "Comunidades" }).click()
  await abrirSalaComum(c)
  check("a Ana entra na sala de voz da sala comum", await entrarNaVoz(a))
  check("e o Bruno também", await entrarNaVoz(b))
  check("os dois ligam-se um ao outro", (await ateNaChamada(a, 2)) && (await ateNaChamada(b, 2)), `${await quantosNaChamada(a)} e ${await quantosNaChamada(b)}`)
  check("e a Carla, de fora, vê duas pessoas na sala de voz", await ateVerNaVoz(c, 2), `${await quantosNaVoz(c)}`)

  // The fourth is the NEW client, in Node. Joins the common room by card, like
  // any new account in community mode.
  const diogo = await contaNova("Diogo")
  let naSalaComum = false
  for (let volta = 0; volta < 60 && !naSalaComum; volta++) {
    await wait(500)
    naSalaComum = diogo.session.channels.includes(SALA_COMUM)
  }
  check("o cliente novo entra na sala comum por cartão", naSalaComum, diogo.session.channels.join(","))

  // The voice room by IDENTIFIER, read from the list of rooms published on the channel:
  // it's the same one old clients use, because it comes from the same `channel.meta`.
  const salaDeVoz = diogo.session.roomsOf(SALA_COMUM).find((sala) => sala.kind === "voice")?.room ?? ""
  check("e lê o identificador da sala de voz do canal", Boolean(salaDeVoz), salaDeVoz)

  await diogo.call.join(SALA_COMUM, { room: salaDeVoz })
  check("a Carla passa a ver três pessoas na sala", await ateVerNaVoz(c, 3), `${await quantosNaVoz(c)}`)

  /*
    The BUG, measured, OR SKIPPED, with the reason written.

    It's the form the query had before the fix: without `room`, which on the
    reader side means `""`, the room of a channel call or a direct conversation.
    Here we say the room in full to reproduce it in a voice room, which is what
    this test rig can set up; the condition is the same (the frame's room matches
    the room where the person is) and the effect is what we wanted to see.

    **This is a NEGATIVE CONTROL, and a negative control cannot reproduce on an
    already-fixed client.** Against a fixture with the sentinel, this would fail
    for no reason, and a red for no reason ends up ignored. It skips, and with it
    skip the two checks that DEPEND on it happening: the count never leaves three,
    so asserting it goes back to three asserts nothing. The rest of the block stays,
    and now measures the BEFORE/AFTER difference of each frame instead of a level,
    because "it was already three and stays three" doesn't tell a harmless sentinel
    from a client that ignores all signaling.
  */
  if (TEM_GUARDA_DA_PERGUNTA) {
    const razao = "a fixtura já traz a sentinela `?quem`: o defeito não existe nela para ser reproduzido"
    saltar("a pergunta com a sala da chamada TIRA quem pergunta da sala (é o defeito)", razao)
    saltar("e ele volta ao reanunciar-se, porque nunca tinha saído", `${razao} — e sem a saída não há regresso a medir`)
  } else {
    await diogo.session.send(SALA_COMUM, {
      t: "voice.leave",
      at: Date.now(),
      room: salaDeVoz,
      quemEsta: true,
    })
    check(
      "a pergunta com a sala da chamada TIRA quem pergunta da sala (é o defeito)",
      await ateVerNaVoz(c, 2),
      `${await quantosNaVoz(c)}`,
    )

    // He re-announces himself, and comes back to the room: never left.
    diogo.call.reafirmarPresenca()
    check("e ele volta ao reanunciar-se, porque nunca tinha saído", await ateVerNaVoz(c, 3), `${await quantosNaVoz(c)}`)
  }

  /*
    And now the query AS THIS CODE SENDS IT, with the sentinel room.

    The frame is what `Call.perguntarQuemEsta` puts on the wire, the form is
    locked in `call.quem-esta.test.ts` -, and here we send it directly because
    the method skips, on purpose, the channel where this device is on a call. The
    premise is ANOTHER device on the same account, which is when the query is
    risky: rosters are indexed by account address.
  */
  const antesDaSentinela = await quantosNaVoz(c)
  await diogo.session.send(SALA_COMUM, {
    t: "voice.leave",
    at: Date.now(),
    room: SALA_DA_PERGUNTA,
    quemEsta: true,
  })
  await wait(4000)
  const depoisDaSentinela = await quantosNaVoz(c)
  /*
    The DIFFERENCE, not the level.
    
    `=== 3` on a count that was already 3 passes even in a client that ignores
    all voice signaling, and would pass green next to a skipped negative control,     three empty passes pretending the block measured something. Measuring before
    and after says what the line promises: this frame didn't change the roster.
    */
  check(
    "a pergunta com a sala sentinela não tira ninguém",
    antesDaSentinela === 3 && depoisDaSentinela === antesDaSentinela,
    `${antesDaSentinela} antes, ${depoisDaSentinela} depois`,
  )
  check(
    "e a chamada da Ana e do Bruno fica de pé, com os dois lá dentro",
    (await quantosNaChamada(a)) === 2 && (await quantosNaChamada(b)) === 2,
    `${await quantosNaChamada(a)} e ${await quantosNaChamada(b)}`,
  )

  /*
    And a `voice.join` with `aVer`, which is the other field from October 5.

    `aceitarEcra` is what fills it: the choice to see someone's screen travels
    in the announcement, so whoever shares can count watchers. What we measure is
    the announcement being ACCEPTED in full, a rejected payload counted as an
    ignored event, and consecutive ignored events declare the channel deaf and
    trigger the repair that wipes history.
  */
  const antesDoAVer = await quantosNaVoz(c)
  await diogo.call.aceitarEcra(enderecoAna)
  await wait(4000)
  const depoisDoAVer = await quantosNaVoz(c)
  // The difference, for the same reason as the sentinel above.
  check(
    "um `voice.join` com `aVer` não tira ninguém da sala",
    antesDoAVer === 3 && depoisDoAVer === antesDoAVer,
    `${antesDoAVer} antes, ${depoisDoAVer} depois`,
  )
  check(
    "e a chamada continua de pé depois dele",
    (await quantosNaChamada(a)) === 2 && (await quantosNaChamada(b)) === 2,
    `${await quantosNaChamada(a)} e ${await quantosNaChamada(b)}`,
  )
  /*
    And the history, which is what the cascade cost.

    A rejected payload counts as an ignored event; consecutive ignored events
    declare the channel deaf and trigger the repair, which is a remove followed
    by an add, the channel history disappearing due to persistent secrecy. We
    measure both ways to tell "there was no cascade" from "the screen is showing
    something else": the message from ten minutes ago stays in the document, and
    the channel still works for a new message.

    `count()` not `waitFor()`: with the call panel open the conversation might
    be out of view, and what we want to know is whether it still EXISTS.
  */
  check("a Ana volta à conversa do canal", await abrirSalaDeTexto(a, "geral"))
  check("e o Bruno também", await abrirSalaDeTexto(b, "geral"))
  check("o histórico do canal continua lá, na Ana", (await a.getByText(daAna, { exact: false }).count()) > 0)
  check("e no Bruno", (await b.getByText(daAna, { exact: false }).count()) > 0)
  const depoisDeTudo = `e ainda falamos, ${Date.now().toString(36)}`
  await dizer(a, depoisDeTudo)
  check("e o canal continua a entregar o que se diz nele", await ouviu(b, depoisDeTudo, 60_000))
  check("e o cliente novo não registou erro nenhum", diogo.erros.length === 0, diogo.erros.join(" | "))

  diogo.session.disconnect()
  await wait(500)

  // ---------------------------------------------------------------------------
  // 4. What the old client DID NOT do, and what it didn't see.
  // ---------------------------------------------------------------------------
  for (const [nome, rede] of [["Ana", redeA], ["Bruno", redeB], ["Carla", redeC]]) {
    // A client on 0.2.3 already sends `manifest.*` (slice 2) and never sends what
    // slice 3 added (`bundle` in a claim, `device` in a publish); a 0.2.4 sends both.
    // What neither can do is halfway, and what neither sends is what slice 4 added:
    // the `pair.*` frames.
    const claims = rede.filter((l) => l.startsWith("TRAMA>") && l.includes('"keypackage.claim"'))
    const publicacoes = rede.filter((l) => l.startsWith("TRAMA>") && l.includes('"keypackage.publish"'))
    const pediuBundle = claims.some((l) => l.includes('"bundle"'))
    const disseAparelho = publicacoes.some((l) => l.includes('"device"'))
    check(`${nome}: o cliente antigo é coerente (0.2.3: nem bundle nem device; 0.2.4: ambos)`, claims.length === 0 || pediuBundle === disseAparelho, `${claims.length} claims${pediuBundle ? " com bundle" : ""}, ${publicacoes.length} publicações${disseAparelho ? " com device" : ""}`)
    check(`${nome}: o cliente antigo nunca manda pair.*`, !rede.some((l) => l.startsWith("TRAMA>") && l.includes('"t":"pair.')))
    const fatais = rede.filter((l) => l.startsWith("TRAMA<") && l.includes('"error"') && l.includes('"fatal":true'))
    check(`${nome}: o servidor não lhe mandou nenhum erro fatal`, fatais.length === 0, fatais.slice(0, 2).join(" | "))
    const erros = errosDe(rede)
    check(`${nome}: sem erros na consola`, erros.length === 0, erros.slice(0, 2).join(" | ").slice(0, 200))
  }
  const servidorLimpo = !/error|Error|TypeError/.test(registoDoServidor)
  check("o homeserver não escreveu erros para a consola", servidorLimpo, servidorLimpo ? "" : registoDoServidor.slice(-300))

  // ---------------------------------------------------------------------------
  // 5. What each admission cost, read from the server database.
  //
  // Ana created the shared room and seated Bruno and Carla when they arrived: one
  // packet each, requested by client 0.2.3 without `bundle`. Carla joined the vault
  // by link, which carries the packet in the request itself: zero from the pool.
  // Ana was never invited by anyone: zero. Read-only, on a copy of the connection;
  // the WAL lets another process read what was already committed.
  // ---------------------------------------------------------------------------
  const contas = db.prepare("SELECT address FROM accounts ORDER BY rowid ASC").all().map((l) => l.address)
  // Four, not three: Ana, Bruno, and Carla on the old client, plus Diego from
  // the new client that section 3b spins up to put frames on the feed.
  check("o servidor tem as quatro contas", contas.length === 4, String(contas.length))
  const semAparelho = (address) => db.prepare("SELECT count(*) AS n FROM key_packages WHERE address = ? AND device IS NULL").get(address).n
  const enderecoCarla = contas[2]
  check("a Ana, que ninguém convidou, continua sem gastar pacote nenhum", gastos(enderecoAna) === 0, String(gastos(enderecoAna)))
  check("o Bruno continua com EXACTAMENTE um gasto", gastos(enderecoBruno) === 1, String(gastos(enderecoBruno)))
  check("a Carla, entrada na sala comum por cartão e na adega por link, não gastou nenhum", gastos(enderecoCarla) === 0, String(gastos(enderecoCarla)))
  check(
    "os pacotes do cliente antigo ficaram atribuídos ao aparelho do login, e não sem aparelho",
    contas.every((c) => semAparelho(c) === 0),
    contas.map((c) => semAparelho(c)).join(","),
  )
  const colunas = db.prepare("PRAGMA table_info(key_packages)").all().map((c) => c.name)
  check("a tabela key_packages tem a coluna device", colunas.includes("device"), colunas.join(","))
  db.close()

  // ---------------------------------------------------------------------------
  // 6. The friends list shown (`friends.shown`), the only new `t` in the friendship
  //    plan (20/10/2026), in a feed that an old client reads.
  //
  // After section 5 on purpose: seating Bruno in Diego's feed claims a packet of
  // his, and the counts there come out right.
  //
  // The old client rejects the payload and counts it as ignored; five in a row,
  // with thirty seconds between the first and the last, declare the channel deaf
  // and fire the new-seat request (`channel.rejoin.request`), the start of the
  // cascade that wipes history. Its state does not read from outside (there is no
  // `deafChannels()` to reach in a browser), and so we measure the effect that
  // deafness HAS on the feed: that request.
  //
  // With positive control: first with the core limit off
  // (`Session.LISTAS_SEGUIDAS_MAX` without cap), five lists in 31 s with nothing
  // else on the feed MUST fire the request; only after, with the limit on, do
  // the same five not. Without the first half, the second would pass because the
  // limit does not measure anything. Lists go raw (`session.send`): Bruno is
  // a follower and not a friend, and what we measure is the feed, not the choice
  // of list.
  // ---------------------------------------------------------------------------
  if (CONHECE_A_LISTA) {
    saltar(
      "a lista de amigos mostrada num cliente antigo (secção 6)",
      "a fixtura já conhece `friends.shown`: não reprova o payload, e não há surdez a reproduzir nem a evitar",
    )
  } else {
  await diogo.session.connect()
  await wait(2000)
  const feedDoDiogo = await diogo.session.ensureFeed()
  await diogo.session.acceptFollower(enderecoBruno)
  let brunoNoFeed = false
  for (let volta = 0; volta < 60 && !brunoNoFeed; volta++) {
    await wait(500)
    brunoNoFeed = redeB.some((l) => l.startsWith("TRAMA>") && l.includes('"channel.subscribe"') && l.includes(feedDoDiogo))
  }
  check("o Bruno, no cliente antigo, entra no feed do Diogo", brunoNoFeed)
  await wait(3000)

  const pedidosDeLugarDesde = (marca) =>
    redeB.slice(marca).filter((l) => l.startsWith("TRAMA>") && l.includes('"channel.rejoin.request"') && l.includes(feedDoDiogo))
  /** Five lists, spaced 31 s apart, with nothing else on the feed. Returns how many the core rejected. */
  async function cincoListas() {
    let recusadas = 0
    for (let vez = 0; vez < 5; vez++) {
      if (vez > 0) await wait(7_750)
      await diogo.session
        .send(feedDoDiogo, { t: "friends.shown", shown: [enderecoAna], updatedAt: Date.now() })
        .catch((erro) => {
          if (/too many friend lists in a row/.test(String(erro?.message))) recusadas += 1
          else throw erro
        })
    }
    await wait(6_000)
    return recusadas
  }

  // The measure SWITCHED OFF: the defect, measured.
  const tectoDasListas = Session.LISTAS_SEGUIDAS_MAX
  Session.LISTAS_SEGUIDAS_MAX = Number.POSITIVE_INFINITY
  const marcaSemMedida = redeB.length
  await cincoListas()
  Session.LISTAS_SEGUIDAS_MAX = tectoDasListas
  const semMedida = pedidosDeLugarDesde(marcaSemMedida)
  check("sem a medida, cinco listas em 31 s põem o feed surdo no cliente antigo (o defeito)", semMedida.length > 0, String(semMedida.length))
  // Diego answers the request with a new seat: wait for Bruno to read again.
  await wait(15_000)

  // The limit on: the same five, and the core stops at three.
  const marcaComMedida = redeB.length
  const recusadas = await cincoListas()
  check("com a medida, o núcleo pára às três listas seguidas", recusadas === 2, String(recusadas))
  const comMedida = pedidosDeLugarDesde(marcaComMedida)
  check("e o feed não fica surdo: nenhum pedido de lugar novo", comMedida.length === 0, String(comMedida.length))
  const chegaram = redeB
    .slice(marcaComMedida)
    .filter((l) => l.startsWith("TRAMA<") && l.includes('"channel.event"') && l.includes(feedDoDiogo))
  check("e as três listas chegaram ao cliente antigo", chegaram.length >= 3, String(chegaram.length))
  const errosDaLista = errosDe(redeB.slice(marcaSemMedida))
  check("e sem erros na consola do Bruno", errosDaLista.length === 0, errosDaLista.slice(0, 2).join(" | ").slice(0, 200))
  }
  diogo.session.disconnect()

  // ---------------------------------------------------------------------------
  // 7. The account channel (phase 5) with an old leaf of the same account.
  //
  // Eva has the account on a new client (Node, with the account key). She joins
  // it with the old browser first, by pairing, and then a new phone (Node). The
  // phone announces itself, and the PC creates the account channel with only it:
  // the old leaf is not invited (see `session.ts`, "Who enters the account
  // channel"). The Welcome goes to the address, and the server also delivers it
  // to the old connection, which does not open it. We measure what matters: after
  // the state runs on the account channel (reads, preferences, archive), the old
  // browser keeps listening and speaking on the shared channel, does not request
  // a seat in that channel, does not show the account channel, and has no console
  // errors.
  // ---------------------------------------------------------------------------
  if (CONHECE_O_ESTADO) {
    saltar("uma folha 0.5.7 da mesma conta com o canal da conta (secção 7)", "a fixtura já conhece o canal da conta: não é uma folha antiga")
  } else {
    const esperarFase = (session, fase, prazoMs = 30_000) =>
      new Promise((resolver, rejeitar) => {
        const prazo = setTimeout(() => {
          desligar()
          rejeitar(new Error(`nunca chegou a fase ${fase}`))
        }, prazoMs)
        const desligar = session.on("pair", (evento) => {
          if (evento.fase === fase) {
            clearTimeout(prazo)
            desligar()
            resolver(evento)
          } else if (evento.fase === "falhou") {
            clearTimeout(prazo)
            desligar()
            rejeitar(new Error(`falhou: ${evento.razao}`))
          }
        })
      })
    const eva = await contaNova("Eva")
    const ouvidasPelaEva = []
    eva.session.on("message", (m) => {
      if (m.payload?.t === "message") ouvidasPelaEva.push(m.payload.body)
    })
    // Opaque address and the name inside the channel, as the interface creates a
    // channel from 1.0 (738311af): a `!lagar-da-eva:` no longer debuts, and the
    // server refuses the commit with `no-seat`.
    const LAGAR = moradaDeSala(parseServerName(NOME))
    await eva.session.createSpaceChannel(LAGAR, "lagar-da-eva")
    await wait(500)

    // 7a. The old browser joins Eva's account by the pasted link.
    const redeV = []
    const ctxV = await browser.newContext(CONTEXTO)
    escutar(ctxV, redeV)
    const v = await ctxV.newPage()
    await v.goto(APP, { waitUntil: "domcontentloaded" })
    await v.getByPlaceholder("Como queres aparecer").waitFor({ timeout: 60_000 })
    const sasEva = esperarFase(eva.session, "sas")
    const { link: linkDaEva } = await eva.session.emparelharComoAnfitriao()
    await v.getByRole("button", { name: "Emparelhar", exact: true }).click()
    await v.getByLabel("Ou cola o link").fill(linkDaEva)
    await v.getByRole("button", { name: "Continuar" }).click()
    const frasesV = v.locator('.gate-card input[type="password"]')
    await frasesV.nth(0).fill(FRASE)
    await frasesV.nth(1).fill(FRASE)
    await v.getByRole("button", { name: "Continuar" }).click()
    await v.locator(".sas-palavras").waitFor({ timeout: 30_000 })
    await sasEva
    const concluiuV = esperarFase(eva.session, "concluido", 60_000)
    await v.getByRole("button", { name: "São as mesmas" }).click()
    await eva.session.confirmarSas()
    await v.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 })
    await concluiuV
    await v.getByRole("button", { name: "Entrar", exact: true }).click()
    await dentro(v)
    check("o browser ANTIGO junta-se à conta da Eva, que vive num cliente novo", true)
    const viuOLagar = await v.locator(".channel-name", { hasText: "lagar-da-eva" }).first().waitFor({ state: "attached", timeout: 90_000 }).then(() => true, () => false)
    check("e é assentado no canal partilhado da Eva", viuOLagar)

    // 7b. A new phone, which announces itself: the account channel is born with it.
    const cofreTel = new Vault(new CofreNaMemoria())
    await cofreTel.create(FRASE)
    const evaTel = new Session(cofreTel)
    const sasPc = esperarFase(eva.session, "sas")
    const { link: linkDoTel } = await eva.session.emparelharComoAnfitriao()
    const sasTel = esperarFase(evaTel, "sas")
    evaTel.emparelharComoConvidado(linkDoTel)
    await Promise.all([sasPc, sasTel])
    const certificado = esperarFase(evaTel, "certificado")
    const concluiuTel = esperarFase(eva.session, "concluido", 60_000)
    await evaTel.confirmarSas()
    await eva.session.confirmarSas()
    await certificado
    evaTel.loadIdentity()
    await evaTel.connect()
    await wait(500)
    evaTel.concluirEmparelhamento()
    await concluiuTel
    const canalDaConta = eva.session.canalDaConta
    let nasceu = false
    for (let volta = 0; volta < 60 && !nasceu; volta++) {
      await wait(500)
      await evaTel.flush()
      nasceu = Boolean(cofreTel.contents.groups?.[canalDaConta])
    }
    check("o canal da conta nasce, com o telemóvel novo lá dentro", nasceu, canalDaConta)
    /*
      The tree of `!self-`, read on Eva's PC: only the PC and the phone. The leaf
      of browser 0.5.7 cannot be there. "Not invited" read here only by browser
      behavior; this reads it in the tree.
    */
    await eva.session.flush()
    const blobDoSelf = eva.session.vault.contents.groups?.[canalDaConta]
    const arvoreDoSelf = blobDoSelf ? (await importSession(canalDaConta, fromBase64(blobDoSelf))).state.ratchetTree : null
    const folhasDoSelf = arvoreDoSelf
      ? leavesOf(arvoreDoSelf, eva.address).map((folha) => toBase64(deviceKeyAtLeaf(arvoreDoSelf, folha))).sort()
      : []
    const esperadas = [toBase64(eva.session.identity.deviceSigningPublicKey), toBase64(evaTel.identity.deviceSigningPublicKey)].sort()
    check(
      "a árvore do canal da conta tem só o PC e o telemóvel: a folha 0.5.7 fica de fora",
      JSON.stringify(folhasDoSelf) === JSON.stringify(esperadas),
      `${folhasDoSelf.length} folhas`,
    )

    // 7c. The state runs on the account channel.
    const marcaDoBrowser = redeV.length
    for (let vez = 0; vez < 5; vez++) {
      await eva.session.definirPreferencia("interface.cor", String(vez % 5))
      await eva.session.marcarLido(LAGAR, Date.now())
      await wait(400)
    }
    // Any conversation to archive: an invented opaque address (1.0 "Archive").
    const velha = `!${"v".repeat(40)}:${NOME}`
    await eva.session.arquivar(velha)
    let chegouAoTel = false
    for (let volta = 0; volta < 40 && !chegouAoTel; volta++) {
      await wait(500)
      chegouAoTel = evaTel.preferencias()["interface.cor"] === "4" && evaTel.arquivo()[velha] !== undefined
    }
    check("o estado chega ao telemóvel novo pelo canal da conta (controlo: o canal fala)", chegouAoTel)
    await wait(4000)

    // 7d. And the old browser does not go deaf.
    await abrirCanalAntigo(v, "lagar-da-eva")
    const daEva = `da Eva no lagar, ${Date.now().toString(36)}`
    await eva.session.send(LAGAR, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: daEva })
    check("depois do estado a correr, o browser antigo ainda ouve o canal partilhado", await ouviu(v, daEva, 60_000))
    const doAntigo = `do browser antigo, ${Date.now().toString(36)}`
    await dizer(v, doAntigo)
    let evaOuviu = false
    for (let volta = 0; volta < 60 && !evaOuviu; volta++) {
      await wait(500)
      evaOuviu = ouvidasPelaEva.includes(doAntigo)
    }
    check("e fala, e o PC da Eva ouve", evaOuviu)
    const pedidosNoLagar = redeV
      .slice(marcaDoBrowser)
      .filter((l) => l.startsWith("TRAMA>") && l.includes('"channel.rejoin.request"') && l.includes(LAGAR))
    check("o browser antigo não pede lugar novo no canal partilhado (não está surdo)", pedidosNoLagar.length === 0, String(pedidosNoLagar.length))
    const pedidosNoSelf = redeV.filter((l) => l.startsWith("TRAMA>") && l.includes('"channel.rejoin.request"') && l.includes(canalDaConta)).length
    console.log(`  ..  pedidos de lugar do browser antigo no canal da conta: ${pedidosNoSelf} (medido; o Welcome que não abre conta como morto)`)
    const listaDoAntigo = await v.locator(".channel-name").allInnerTexts().catch(() => [])
    check("e não mostra o canal da conta na lista", !listaDoAntigo.some((nome) => /self-/.test(nome)), JSON.stringify(listaDoAntigo))
    const errosDoAntigo = errosDe(redeV)
    check("sem erros na consola do browser antigo", errosDoAntigo.length === 0, errosDoAntigo.slice(0, 2).join(" | ").slice(0, 200))
    check("e sem erros visíveis no PC da Eva", eva.erros.length === 0, eva.erros.slice(0, 3).join(" | "))
    evaTel.disconnect()
    eva.session.disconnect()
  }

  // ---------------------------------------------------------------------------
  // 8. Anti-entropy (S4 and S5) on on new clients, with Bruno's old browser in
  //    the same channel.
  //
  // Fabio and Gil are new clients on Node. Gil leaves, Fabio writes ten messages,
  // and the server loses three (deleted from the database). Gil returns and asks
  // for what is missing: the telemetry goes inside the channel, in a `typing` with
  // `until: 0`, which the old one deciphers and throws away. Then, thirty telemetry
  // points by hand in a minute, the rate of s4.6. What we measure on the old one is
  // the effect that deafness HAS on the feed (the new-seat request), duplicates on
  // the screen, and the console.
  // ---------------------------------------------------------------------------
  {
    const fabio = await contaNova("Fábio")
    const gil = await contaNova("Gil")
    // Opaque address and the name inside the channel, as the interface (`App.tsx`)
    // creates a channel from 1.0 (738311af). A `!sincronia-antiga:` is a closed form:
    // the server refuses the first commit with `no-seat`, and the `seat` would blow up
    // with "this device has no seat in this channel".
    const SINCRONIA = moradaDeSala(parseServerName(NOME))
    await fabio.session.createSpaceChannel(SINCRONIA, "sincronia-antiga")
    await wait(500)
    await fabio.session.seat(SINCRONIA, gil.address)
    for (let volta = 0; volta < 60 && !gil.session.channels.includes(SINCRONIA); volta++) await wait(500)
    await fabio.session.seat(SINCRONIA, enderecoBruno)
    let brunoEntrou = false
    for (let volta = 0; volta < 60 && !brunoEntrou; volta++) {
      await wait(500)
      brunoEntrou = redeB.some((l) => l.startsWith("TRAMA>") && l.includes('"channel.subscribe"') && l.includes(SINCRONIA))
    }
    check("8. o Bruno (antigo) entra no canal dos dois clientes novos", brunoEntrou)
    await b.getByRole("button", { name: "Comunidades" }).click().catch(() => {})
    await abrirCanalAntigo(b, "sincronia-antiga")
    const marca = redeB.length

    gil.session.disconnect()
    for (let i = 0; i < 10; i++) {
      await fabio.session.send(SINCRONIA, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: `antiga ${i}`, attachments: [] })
    }
    check("8. o Bruno ouve as dez ao vivo", await ouviu(b, "antiga 9", 60_000))
    const seqs = fabio.session
      .history(SINCRONIA)
      .filter((e) => String(e.payload.body ?? "").startsWith("antiga ") && e.seq >= 0)
      .map((e) => e.seq)
      .sort((x, y) => x - y)
    const base = new DatabaseSync(join(dados, "enclave.sqlite"))
    for (const seq of seqs.slice(3, 6)) base.prepare("DELETE FROM events WHERE channel = ? AND seq = ?").run(SINCRONIA, seq)
    base.close()
    await gil.session.connect()
    let gilIgual = false
    for (let volta = 0; volta < 240 && !gilIgual; volta++) {
      await wait(500)
      gilIgual = gil.session.history(SINCRONIA).filter((e) => String(e.payload.body ?? "").startsWith("antiga ")).length === 10
    }
    check("8. o Gil, de volta, recebe as três que o servidor perdeu, por relato", gilIgual, JSON.stringify(gil.session.estatisticasDaSincronia.relatosAplicados))

    // Thirty telemetry points in a minute, by hand: true items from Fabio, with authorship.
    const proprios = fabio.session.history(SINCRONIA).filter((e) => String(e.payload.body ?? "").startsWith("antiga ") && e.seq >= 0)
    for (let vez = 0; vez < 30; vez++) {
      const item = proprios[vez % proprios.length]
      await fabio.session.send(SINCRONIA, { t: "typing", until: 0, relatos: { v: 1, itens: [{ s: item.seq, a: fabio.address, p: item.payload }] } })
      await wait(2_000)
    }
    await wait(5_000)
    const depois = `depois dos relatos, ${Date.now().toString(36)}`
    await fabio.session.send(SINCRONIA, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: depois, attachments: [] })
    check("8. depois de trinta relatos num minuto, o antigo ainda ouve", await ouviu(b, depois, 60_000))
    const pedidosDeLugar = redeB
      .slice(marca)
      .filter((l) => l.startsWith("TRAMA>") && l.includes('"channel.rejoin.request"') && l.includes(SINCRONIA))
    check("8. e não fica surdo: nenhum pedido de lugar novo", pedidosDeLugar.length === 0, String(pedidosDeLugar.length))
    const repetidas = []
    for (let i = 0; i < 10; i++) {
      const corpo = `antiga ${i}` // text that the script writes for Fabio, not an interface label
      const vezes = await b.getByText(corpo, { exact: true }).count()
      if (vezes !== 1) repetidas.push(`antiga ${i}: ${vezes}`)
    }
    check("8. e não duplica: cada mensagem uma vez no ecrã do antigo", repetidas.length === 0, repetidas.join(", "))
    const errosDoBruno = errosDe(redeB.slice(marca))
    check("8. sem erros na consola do Bruno", errosDoBruno.length === 0, errosDoBruno.slice(0, 2).join(" | ").slice(0, 200))
    check("8. e sem erros visíveis no Fábio e no Gil", fabio.erros.length === 0 && gil.erros.length === 0, [...fabio.erros, ...gil.erros].slice(0, 3).join(" | "))
    fabio.session.disconnect()
    gil.session.disconnect()
  }
} catch (erro) {
  check(`sem excepções pelo caminho: ${erro.message.split("\n")[0]}`, false)
  console.error(erro.stack)
}

const passaram = results.filter(Boolean).length
// The skipped ones on the side and never summed: see `skip`.
const nota = saltados.length > 0 ? ` (${saltados.length} saltada${saltados.length === 1 ? "" : "s"})` : ""
console.log(`\n${passaram}/${results.length} verificações passaram${nota}`)
await arrumar(passaram === results.length ? 0 : 1)
