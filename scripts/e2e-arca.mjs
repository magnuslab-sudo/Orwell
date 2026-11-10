/**
 * Live proof of 1.0 "Arca", before cutoff, in a real browser.
 *
 *   node scripts/e2e-arca.mjs          (needs `npm run build` first)
 *
 * Three accounts (Ana, Bia, Carla), each in its own Chromium context, against
 * a homeserver and a web built from this commit. What is tested, by buttons
 * that a person clicks:
 *
 *  1. Ana and Bia create accounts (Setup with "No, create account").
 *  2. Ana creates the "Club" room and an invite. The short link
 *     is `/c#<8>.<16>` and has a QR code. Bia opens it: sees "Ana's invite to 'Club'"
 *     (the name comes from the seal), joins, and sees the room name in the sidebar. The
 *     room's opaque address does not appear anywhere on Bia's screen.
 *  3. Before that, the same short link with the code swapped: "This link is
 *     wrong…", no `invite.redeem`, and the invite stays at 0 uses.
 *  4. The short friend link `/a#<id>`: Bia opens Ana's and requests friendship,
 *     Ana accepts, the private chat opens on both sides, at an opaque address,
 *     the same on both, and messages flow in both directions.
 *  5. The feed: Ana publishes, Bia (a friend) sees it. Carla, who shares nothing
 *     with Ana, does not see the post, and no trace leads to Ana's feed address.
 *  6. The server database at the end: no rows with `!dm-`, `!feed-`, `!self-`,
 *     and no "Club" in the clear (`sqlite3 .dump`, and the file and WAL bytes).
 *  7. The gate with a vault from beta (without the `orwv2` header): "Orwell has left
 *     beta.", no password field, and "Create new account" opens Setup.
 *  8. At each step, at 1280 and 390 px, no horizontal scroll. Screenshots
 *     go in `.verify-data/prova-arca/` (one folder per run).
 *
 * ALL LOCAL AND ALL DISPOSABLE, after the pattern of `e2e-convite-link.mjs`: its own
 * homeserver with no community mode, database in a temporary folder that is
 * cleaned up at the end, and a front that acts as Caddy (the app in `/app/`, the `302`
 * redirects from `/c` and `/a` in `infra/Caddyfile`, the rest to the homeserver). Ports 8481
 * and 8482, or `E2E_PORTA_DA_FRENTE` and `E2E_PORTA_DO_SERVIDOR`. Takes no target
 * by argument: there is no way to point it at production.
 */
import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { eMoradaOpaca } from "@enclave/protocol"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8481)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8482)
const NOME = `localhost:${PORTA_DA_FRENTE}`
const ORIGEM = `http://${NOME}`
const APP = `${ORIGEM}/app/?lingua=pt`
const FRASE = "frase-de-verificacao-2026"
const LARGO = { width: 1280, height: 860 }
const TELEMOVEL = { width: 390, height: 844 }
const CORRIDA = new Date().toISOString().replace(/[:.]/g, "-")
const CAPTURAS = join(RAIZ, ".verify-data/prova-arca", CORRIDA)
mkdirSync(CAPTURAS, { recursive: true })

const results = []
function check(nome, ok, detalhe = "") {
  results.push({ nome, ok: Boolean(ok) })
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}
const passo = (titulo) => console.log(`\n== ${titulo}`)

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

// --- the homeserver, disposable ----------------------------------------------
// Without `ENCLAVE_SO_MORADAS_OPACAS`: since slice 6a the server speaks only opaque
// addresses and nobody reads this variable (`apps/server/src/config.ts`).
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-arca-"))
const BASE = join(dados, "enclave.sqlite")
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
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

// --- The frontend that acts as Caddy. ----------------------------------------
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json", ".wasm": "application/wasm" }
const acessos = []
// The block from `infra/Caddyfile` (5b-1): `/c` and `/a` go to `/app/c` and `/app/a`
// with a 302. The fragment stays in the browser and crosses the redirect.
const REDIRECCOES = { "/c": "/app/c", "/c/": "/app/c", "/a": "/app/a", "/a/": "/app/a" }

const frente = http.createServer((pedido, resposta) => {
  acessos.push(`${pedido.method} ${pedido.url}`)
  const caminho = (pedido.url ?? "/").split("?")[0]
  if (REDIRECCOES[caminho]) {
    resposta.writeHead(302, { location: REDIRECCOES[caminho] })
    resposta.end()
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

// --- ajudas -------------------------------------------------------------------
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function ate(condicao, ms = 60_000, intervalo = 500) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await condicao().catch(() => false)) return true
    await espera(intervalo)
  }
  return false
}
const dentro = (page, timeout = 90_000) => page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout })

/** A page that reloads in an existing vault: unlock, if the gate asks. */
async function destrancar(page) {
  const campo = page.locator('.gate-card input[type="password"]')
  const config = page.getByRole("button", { name: "Configurações", exact: true }).first()
  await campo.or(config).first().waitFor({ timeout: 60_000 })
  if (await campo.count()) {
    await campo.fill(FRASE)
    await page.keyboard.press("Enter")
  }
  await dentro(page)
}

/** The WebSocket frames of a context, already parsed as JSON when they are. */
function escutar(context) {
  const tramas = []
  const ler = (sentido, payload) => {
    const texto = typeof payload === "string" ? payload : payload.toString("utf8")
    let json = null
    try {
      json = JSON.parse(texto)
    } catch {}
    tramas.push({ sentido, texto, json, em: Date.now() })
  }
  context.on("page", (page) => {
    page.on("websocket", (ws) => {
      ws.on("framesent", (trama) => ler(">", trama.payload))
      ws.on("framereceived", (trama) => ler("<", trama.payload))
    })
  })
  return tramas
}
const enviadas = (tramas, tipo, desde = 0) => tramas.filter((t) => t.sentido === ">" && t.json?.t === tipo && t.em >= desde)

/** No horizontal scroll. Both screenshots of the step: 1280 and 390 px. */
const larguras = []
async function retratar(page, nome) {
  await page.waitForTimeout(400)
  const medir = () => page.evaluate(() => ({ rola: document.documentElement.scrollWidth, janela: window.innerWidth }))
  await page.screenshot({ path: join(CAPTURAS, `${nome}-1280.png`) })
  const largo = await medir()
  await page.setViewportSize(TELEMOVEL)
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(CAPTURAS, `${nome}-390.png`) })
  const estreito = await medir()
  await page.setViewportSize(LARGO)
  await page.waitForTimeout(300)
  const ok = largo.rola <= largo.janela + 1 && estreito.rola <= estreito.janela + 1
  larguras.push({ nome, ok, largo, estreito })
  if (!ok) console.log(`  nota: ${nome} rola na horizontal (1280: ${largo.rola}/${largo.janela}; 390: ${estreito.rola}/${estreito.janela})`)
}

/** Test server database rows via `sqlite3` (read-only). */
function sql(consulta) {
  return execFileSync("sqlite3", ["-readonly", BASE, consulta], { encoding: "utf8" }).trim()
}

/**
 * Where a needle appears in what a person can read on screen: visible text,
 * labels (aria-label, title, placeholder, alt) and field values.
 * Returns the list of locations with surrounding context for the report.
 */
const ondeAparece = (page, agulha) =>
  page.evaluate((agulha) => {
    const achados = []
    const ver = (fonte, texto) => {
      const i = (texto ?? "").indexOf(agulha)
      if (i >= 0) achados.push(`${fonte}: ${texto.slice(Math.max(0, i - 60), i + agulha.length + 20).replace(/\s+/g, " ")}`)
    }
    ver("título", document.title)
    ver("texto", document.body.innerText)
    for (const el of document.querySelectorAll("*")) {
      const quem = `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""}`
      for (const atributo of ["aria-label", "title", "placeholder", "alt", "aria-description"]) ver(`${quem}[${atributo}]`, el.getAttribute(atributo))
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) ver(`${quem}.value`, el.value)
    }
    return achados
  }, agulha)

async function separador(page, nome) {
  await page.getByRole("button", { name: "Amigos", exact: true }).first().click()
  await page.locator(".people-destination").waitFor({ timeout: 15_000 })
  await page.locator(".people-tabs").getByRole("button", { name: nome }).click()
}

async function dizer(page, frase) {
  const caixa = page.getByPlaceholder("Escreve uma mensagem").first()
  await caixa.click()
  await caixa.fill(frase)
  await page.keyboard.press("Enter")
}
const ve = (page, texto, timeout = 60_000) =>
  page.getByText(texto, { exact: false }).first().waitFor({ timeout }).then(
    () => true,
    () => false,
  )

const ANA = "Ana"
const BIA = "Bia"
const CARLA = "Carla"
const CONTEXTO = { locale: "pt-PT", viewport: LARGO }
// Alphabet for the invite code (5b-2): Crockford base32, lowercase.
const ALFABETO = "0123456789abcdefghjkmnpqrstvwxyz"
const FORMA_CURTA = new RegExp(`^${ORIGEM.replace(/[.]/g, "\\.")}/c#[a-z0-9]{8}\\.[${ALFABETO}]{16}$`)

try {
  browser = await chromium.launch({ headless: true })

  // ===========================================================================
  passo("1. A Ana e a Bia criam conta")
  // ===========================================================================
  const ctxA = await browser.newContext(CONTEXTO)
  const tramasA = escutar(ctxA)
  const a = await ctxA.newPage()
  await a.goto(APP, { waitUntil: "domcontentloaded" })
  const perguntaA = await a.getByRole("button", { name: "Não, criar conta" }).waitFor({ timeout: 60_000 }).then(() => true, () => false)
  check('o Setup da Ana pergunta "Já usas o Orwell noutro aparelho?" e tem "Não, criar conta"', perguntaA)
  await retratar(a, "01-setup-pergunta")
  await criarConta(a, { nome: ANA, frase: FRASE, servidor: NOME })
  await dentro(a)
  check("a Ana entra na app", true)
  await retratar(a, "01-ana-dentro")

  const ctxB = await browser.newContext(CONTEXTO)
  const tramasB = escutar(ctxB)
  const b = await ctxB.newPage()
  await b.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(b, { nome: BIA, frase: FRASE, servidor: NOME })
  await dentro(b)
  check("a Bia entra na app", true)
  await retratar(b, "01-bia-dentro")

  // ===========================================================================
  passo('2a. A Ana cria a sala "Clube" e a ligação curta do convite')
  // ===========================================================================
  await a.getByRole("button", { name: "Criar canal" }).first().click()
  await a.locator("form.prompt input").first().fill("Clube")
  await a.locator("form.prompt button.primary").first().click()
  await a.getByRole("heading", { name: "Clube" }).waitFor({ timeout: 30_000 })
  check('a sala "Clube" abre do lado da Ana', true)

  const antesDoConvite = Date.now()
  await a.getByRole("button", { name: "Convidar…" }).first().click()
  await a.locator(".sheet").first().getByRole("button", { name: "Por link" }).click()
  const folha = a.locator(".sheet").first()
  await folha.getByRole("button", { name: "Criar link" }).click()
  const campoDoLink = folha.getByLabel("O teu link")
  await campoDoLink.waitFor({ timeout: 15_000 })
  const curta = await campoDoLink.inputValue()
  check("a ligação do convite é a curta /c#<8>.<16>", FORMA_CURTA.test(curta), curta)
  const qr = folha.getByRole("img", { name: "O QR do convite" })
  check("e tem QR", await qr.isVisible().catch(() => false))
  await retratar(a, "02-ana-convite-curto")
  await folha.getByRole("button", { name: "Fechar" }).click()

  const criado = enviadas(tramasA, "invite.create", antesDoConvite)[0]?.json
  const sala = criado?.channel ?? ""
  check("a sala tem morada opaca", eMoradaOpaca(sala), sala)
  check("o convite levou o selo", typeof criado?.selo === "string" && criado.selo.length > 0)
  const [codigoCurto, codigo] = new URL(curta).hash.slice(1).split(".")
  const codeHash = createHash("sha256").update(codigo ?? "").digest("base64")
  const usos = () => sql(`SELECT uses FROM invites WHERE short_code = '${codigoCurto}'`)
  check("a base guarda o convite pelo código curto, com 0 usos", usos() === "0", usos())

  // ===========================================================================
  passo("3. A curta com o código trocado é recusada e não gasta uso")
  // ===========================================================================
  const trocado = `${codigo.slice(0, -1)}${codigo.endsWith("a") ? "b" : "a"}`
  const curtaTrocada = `${ORIGEM}/c#${codigoCurto}.${trocado}`
  const antesDaTrocada = Date.now()
  await b.goto(curtaTrocada, { waitUntil: "domcontentloaded" })
  await destrancar(b)
  const frase358 = await ve(b, "Esta ligação está errada", 30_000)
  check('abrir a curta trocada dá "Esta ligação está errada…"', frase358)
  await retratar(b, "03-bia-curta-trocada")
  await espera(1_500)
  check("nenhum invite.redeem saiu da Bia", enviadas(tramasB, "invite.redeem", antesDaTrocada).length === 0)
  check("o convite continua com 0 usos", usos() === "0", usos())

  // The same, pasted into "Sign in with a link".
  const antesDaColada = Date.now()
  await b.locator("button.join-link").first().click()
  await b.locator("form.prompt input").first().fill(curtaTrocada)
  await b.locator("form.prompt button.primary").first().click()
  check("colada, a curta trocada dá a mesma frase", await ve(b, "Esta ligação está errada", 30_000))
  await retratar(b, "03-bia-curta-trocada-colada")
  await espera(1_000)
  check("e também não manda invite.redeem", enviadas(tramasB, "invite.redeem", antesDaColada).length === 0)
  check("e o convite continua com 0 usos", usos() === "0", usos())
  await b.keyboard.press("Escape")

  // ===========================================================================
  passo('2b. A Bia abre a curta certa e entra no "Clube"')
  // ===========================================================================
  const antesDaCerta = Date.now()
  await b.goto(curta, { waitUntil: "domcontentloaded" })
  const barra = await b.evaluate(() => location.pathname + location.search + location.hash)
  await destrancar(b)
  const pergunta = b.locator(".convite-chegado")
  const chegou = await pergunta.waitFor({ timeout: 60_000 }).then(() => true, () => false)
  const textoDaPergunta = chegou ? (await pergunta.innerText()).replace(/\s+/g, " ") : ""
  check('a Bia vê "Convite de Ana para "Clube"" (o nome pelo selo)', textoDaPergunta.includes('Convite de Ana para "Clube"'), textoDaPergunta.slice(0, 140))
  check("a barra do browser não guarda o fragmento", !barra.includes(codigo), barra)
  const naPergunta = await ondeAparece(b, sala.split(":")[0])
  check("a morada opaca não aparece na pergunta", chegou && naPergunta.length === 0, naPergunta.join(" | "))
  await retratar(b, "02-bia-pergunta-do-convite")
  await b.getByRole("button", { name: "Entrar", exact: true }).click()
  // Between "Sign in" and admission, Bia's screen is seen at 150 em 150 ms: the
  // "waiting" line in the sidebar and the notifications are also screen.
  const enquantoEspera = new Set()
  let admitida = false
  const naBarraPromessa = b.locator(".channel-name", { hasText: "Clube" }).first().waitFor({ timeout: 90_000 }).then(() => true, () => false).finally(() => (admitida = true))
  while (!admitida) {
    const achados = await ondeAparece(b, sala.slice(1, 13)).catch(() => [])
    // First time it appears, the proof stays in the screenshot (1280 only: the wait is short).
    if (achados.length && enquantoEspera.size === 0) await b.screenshot({ path: join(CAPTURAS, "02-bia-a-espera-1280.png") }).catch(() => {})
    for (const achado of achados) enquantoEspera.add(achado)
    await espera(150)
  }
  const naBarra = await naBarraPromessa
  check("enquanto espera a admissão, a morada opaca não aparece no ecrã da Bia", enquantoEspera.size === 0, [...enquantoEspera].slice(0, 3).join(" | "))
  check('a Bia entra e vê "Clube" na barra lateral', naBarra)
  const resgates = enviadas(tramasB, "invite.redeem", antesDaCerta)
  const hashes = [codeHash, createHash("sha256").update(codigo ?? "").digest("base64url")]
  check(
    "saiu um invite.redeem, com o hash do código e a prova",
    resgates.length === 1 && hashes.includes(resgates[0].json.codeHash) && typeof resgates[0].json.prova === "string",
    `${resgates.length}`,
  )
  check("o código do convite nunca saiu do browser da Bia", !tramasB.some((t) => t.sentido === ">" && t.texto.includes(codigo)))
  check("o convite tem agora 1 uso", await ate(async () => usos() === "1", 15_000), usos())
  if (naBarra) await b.locator(".channel-name", { hasText: "Clube" }).first().click()
  await b.getByRole("heading", { name: "Clube" }).waitFor({ timeout: 30_000 }).catch(() => {})
  // The full address and a bit of it (12 characters), which is what a truncated "…" would show.
  const ecraDaBia = [...(await ondeAparece(b, sala.split(":")[0])), ...(await ondeAparece(b, sala.slice(1, 13)))]
  check("a morada opaca da sala não aparece em lado nenhum do ecrã da Bia", ecraDaBia.length === 0, ecraDaBia.slice(0, 4).join(" | "))
  await retratar(b, "02-bia-no-clube")

  // The message in the room, to prove they actually entered.
  await a.locator(".channel-name", { hasText: "Clube" }).first().click()
  await dizer(a, "bem-vinda ao Clube")
  check('a Bia lê o que a Ana diz no "Clube"', await ve(b, "bem-vinda ao Clube", 60_000))

  // ===========================================================================
  passo("4. A ligação curta de amigo, o pedido, e a conversa privada")
  // ===========================================================================
  await separador(a, "Encontrar")
  const linkDaAna = await a.getByLabel("O teu link de amizade", { exact: true }).inputValue()
  check("a ligação de amigo da Ana é a curta /a#<id>", new RegExp(`^${ORIGEM}/a#[a-z0-9-]+$`).test(linkDaAna), linkDaAna)
  await retratar(a, "04-ana-encontrar")

  await b.goto(linkDaAna, { waitUntil: "domcontentloaded" })
  await destrancar(b)
  const perfil = b.locator(".person-profile")
  const abriu = await perfil.waitFor({ timeout: 60_000 }).then(() => true, () => false)
  check("a Bia abre a curta da Ana e vê o perfil dela", abriu && (await perfil.innerText()).includes(ANA))
  await retratar(b, "04-bia-perfil-da-ana")
  await perfil.getByRole("button", { name: "Pedir amizade" }).click()
  check("a Bia pede amizade", await perfil.getByRole("status").filter({ hasText: "Pedido enviado" }).waitFor({ timeout: 30_000 }).then(() => true, () => false))
  await b.keyboard.press("Escape")

  await separador(a, "Recebidos")
  check("o pedido chega à Ana", await ate(async () => a.getByRole("button", { name: "Aceitar" }).first().isVisible(), 60_000))
  await retratar(a, "04-ana-recebidos")
  await a.getByRole("button", { name: "Aceitar" }).first().click()
  await separador(a, "Todos")
  check('a Ana vê "Amigos (1)"', await ate(async () => (await a.locator(".people-bar-title").innerText()) === "Amigos (1)", 60_000))
  await separador(b, "Todos")
  check('a Bia vê "Amigos (1)"', await ate(async () => (await b.locator(".people-bar-title").innerText()) === "Amigos (1)", 60_000))

  // The private conversation, opened by the direct message line in Friends.
  async function abrirDirecta(page, com) {
    const linha = page.locator(".people-aside .direct-row", { hasText: com }).first()
    const ha = await linha.waitFor({ timeout: 60_000 }).then(() => true, () => false)
    if (ha) await linha.click()
    return ha && (await page.getByPlaceholder("Escreve uma mensagem").first().waitFor({ timeout: 30_000 }).then(() => true, () => false))
  }
  check("a conversa privada aparece e abre do lado da Ana", await abrirDirecta(a, BIA))
  check("e do lado da Bia", await abrirDirecta(b, ANA))
  await retratar(a, "04-ana-directa")

  const antesDaAna = Date.now()
  await dizer(a, "olá Bia, daqui fala a Ana")
  check("a Bia lê a mensagem privada da Ana", await ve(b, "olá Bia, daqui fala a Ana", 60_000))
  const antesDaBia = Date.now()
  await dizer(b, "olá Ana, recebi")
  check("a Ana lê a resposta da Bia", await ve(a, "olá Ana, recebi", 60_000))
  await espera(800)
  await retratar(b, "04-bia-directa")
  const canaisA = new Set(enviadas(tramasA, "channel.send", antesDaAna).filter((t) => t.em < antesDaBia).map((t) => t.json.channel))
  const canaisB = new Set(enviadas(tramasB, "channel.send", antesDaBia).map((t) => t.json.channel))
  const comuns = [...canaisA].filter((canal) => canaisB.has(canal) && canal !== sala)
  const directa = comuns[0] ?? ""
  check("a conversa privada é uma morada opaca, a mesma nos dois lados", comuns.length === 1 && eMoradaOpaca(directa), `${directa} (${comuns.length})`)
  const directaNoEcra = [...(await ondeAparece(a, directa.split(":")[0])), ...(await ondeAparece(b, directa.split(":")[0]))]
  check("e não aparece no ecrã de nenhum dos dois", directa !== "" && directaNoEcra.length === 0, directaNoEcra.slice(0, 2).join(" | "))

  // ===========================================================================
  passo("5. O mural: a Ana publica, a Bia vê, a Carla não")
  // ===========================================================================
  const POST = "Primeira publicação da Ana no mural da Arca"
  const antesDoPost = Date.now()
  await a.getByRole("button", { name: "Feed" }).first().click()
  await a.getByPlaceholder(/Escreve uma publicação/).first().fill(POST)
  await a.getByRole("button", { name: "Publicar" }).first().click()
  check("a publicação aparece no mural da Ana", await ve(a, POST, 30_000))
  await retratar(a, "05-ana-mural")
  const enviosDoPost = enviadas(tramasA, "channel.send", antesDoPost).map((t) => t.json.channel)
  const mural = enviosDoPost.find((canal) => canal !== sala && canal !== directa) ?? ""
  check("o mural da Ana é uma morada opaca", eMoradaOpaca(mural), mural)

  await b.getByRole("button", { name: "Feed" }).first().click()
  check("a Bia (amiga) vê a publicação da Ana", await ve(b, POST, 90_000))
  await retratar(b, "05-bia-ve-o-mural")

  const ctxC = await browser.newContext(CONTEXTO)
  const tramasC = escutar(ctxC)
  const c = await ctxC.newPage()
  await c.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(c, { nome: CARLA, frase: FRASE, servidor: NOME })
  await dentro(c)
  await c.getByRole("button", { name: "Feed" }).first().click()
  await espera(8_000)
  check("a Carla não vê a publicação no Feed dela", !(await c.getByText(POST, { exact: false }).count()))
  await retratar(c, "05-carla-feed")
  // And Ana's profile, opened by her link: Carla sees the person, not the wall.
  await c.goto(linkDaAna, { waitUntil: "domcontentloaded" })
  await destrancar(c)
  const perfilC = c.locator(".person-profile")
  await perfilC.waitFor({ timeout: 60_000 }).catch(() => {})
  await espera(5_000)
  check("pelo perfil da Ana, a Carla também não vê a publicação", !(await c.getByText(POST, { exact: false }).count()))
  await retratar(c, "05-carla-perfil-da-ana")
  check("nenhuma trama da Carla leva a morada do mural da Ana", mural !== "" && !tramasC.some((t) => t.texto.includes(mural.split(":")[0])))
  const enderecoDe = (tramas) => tramas.find((t) => t.sentido === "<" && t.json?.t === "auth.ok")?.json.address ?? "?"
  const subscritos = sql(`SELECT address FROM subscriptions WHERE channel = '${mural}'`).split("\n")
  check("na base, a Bia está subscrita ao mural da Ana", subscritos.includes(enderecoDe(tramasB)), subscritos.join(", "))
  check("e a Carla não", !subscritos.includes(enderecoDe(tramasC)), enderecoDe(tramasC))

  // ===========================================================================
  passo("6. A base do servidor de teste")
  // ===========================================================================
  // The WAL stays where it is: `sqlite3` reads it, and bytes are looked up in both.
  const despejo = execFileSync("sqlite3", ["-readonly", BASE, ".dump"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
  const linhas = despejo.split("\n")
  for (const proibido of ["!dm-", "!feed-", "!self-", "Clube"]) {
    const achadas = linhas.filter((linha) => linha.includes(proibido))
    check(`a base não tem nenhuma linha com "${proibido}"`, achadas.length === 0, achadas.length ? achadas[0].slice(0, 120) : `${linhas.length} linhas lidas`)
  }
  const ficheiros = readdirSync(dados).filter((nome) => nome.startsWith("enclave.sqlite"))
  const emBytes = ficheiros.filter((nome) => {
    const bytes = readFileSync(join(dados, nome))
    return ["!dm-", "!feed-", "!self-", "Clube"].some((p) => bytes.includes(Buffer.from(p, "utf8")))
  })
  check("nem nos bytes dos ficheiros da base (com o WAL)", emBytes.length === 0, `${ficheiros.join(", ")}${emBytes.length ? `; em ${emBytes.join(", ")}` : ""}`)
  check("o selo do convite está na base, e o nome não", sql(`SELECT length(selo) FROM invites WHERE short_code = '${codigoCurto}'`) === "736")
  check("a base guarda o hash do código, e não o código", sql(`SELECT code_hash FROM invites WHERE short_code = '${codigoCurto}'`).length > 0 && !despejo.includes(codigo), codeHash.slice(0, 12))

  // ===========================================================================
  passo("7. O portão com um cofre do beta")
  // ===========================================================================
  const ctxD = await browser.newContext(CONTEXTO)
  const d = await ctxD.newPage()
  await d.goto(`${ORIGEM}/_enclave/health`, { waitUntil: "domcontentloaded" })
  await d.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const pedido = indexedDB.open("enclave", 1)
        pedido.onupgradeneeded = () => pedido.result.createObjectStore("vault")
        pedido.onerror = () => reject(pedido.error)
        pedido.onsuccess = () => {
          const tx = pedido.result.transaction("vault", "readwrite")
          // The usual JSON of a vault from 0.9.x, without the `orwv2` header.
          const beta = new TextEncoder().encode(JSON.stringify({ v: 2, salt: "AAAA", wrappedKey: "AAAA", data: "AAAA" }))
          tx.objectStore("vault").put(beta.buffer, "current")
          tx.oncomplete = () => {
            pedido.result.close()
            resolve(true)
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
  await d.goto(APP, { waitUntil: "domcontentloaded" })
  const saiu = await d.getByRole("heading", { name: "O Orwell saiu de beta." }).waitFor({ timeout: 60_000 }).then(() => true, () => false)
  check('o portão mostra "O Orwell saiu de beta."', saiu)
  check("sem campo de palavra-passe", (await d.locator('input[type="password"]').count()) === 0)
  check('e sem o "Entrar" do portão', (await d.getByRole("button", { name: "Entrar", exact: true }).count()) === 0)
  await retratar(d, "07-saiu-de-beta")
  await d.getByRole("button", { name: "Criar conta nova" }).click()
  const setup = await d.getByRole("button", { name: "Não, criar conta" }).waitFor({ timeout: 30_000 }).then(() => true, () => false)
  check('"Criar conta nova" abre o Setup', setup)
  await retratar(d, "07-setup-depois-do-beta")
  await ctxD.close()

  // ===========================================================================
  passo("8. 1280 e 390 px, sem rolagem horizontal")
  // ===========================================================================
  const tortas = larguras.filter((l) => !l.ok)
  check(`as ${larguras.length} vistas não rolam na horizontal, a 1280 e a 390 px`, tortas.length === 0, tortas.map((l) => l.nome).join(", "))
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  if (browser) {
    for (const ctx of browser.contexts()) {
      for (const [i, page] of ctx.pages().entries()) await page.screenshot({ path: join(CAPTURAS, `zz-erro-${browser.contexts().indexOf(ctx)}-${i}.png`) }).catch(() => {})
    }
  }
}

console.log("")
const passaram = results.filter((r) => r.ok).length
console.log(`${passaram}/${results.length} verificações passaram. Capturas: ${CAPTURAS}`)
await arrumar(passaram === results.length ? 0 : 1)
