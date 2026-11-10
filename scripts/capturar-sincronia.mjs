/**
 * New views of account sync (S5), in a real browser, with captures in `capturas/`.
 *
 *   node scripts/capturar-sincronia.mjs          (needs `npm run build` first)
 *
 * Ana and Bruno are sessions in Node; Carla enters through the UI. Ana creates
 * a channel, talks with Bruno, and publishes a photo to her wall. Ana leaves.
 * Bruno sits Carla in Ana's channel and wall. What Carla sees:
 *
 *  1. The bar "Receiving channel...", showing what is missing by type. To see it,
 *     Bruno's telemetry cap drops to 12 KB per minute during this.
 *  2. In the chat, the marker "You joined here...", at the join point, at 1200
 *     and 390 px. Nothing from before.
 *  3. In Settings › Help and Diagnostics, the channel row.
 *  4. In the feed, Ana's photo without bytes, with "Ask other members"; after
 *     asking, the photo.
 *
 * ALL LOCAL AND DISPOSABLE, following the pattern of `e2e-amizade-ui.mjs`: its own
 * homeserver in a temp folder, and a front end serving the app.
 */
import { spawn } from "node:child_process"
import { webcrypto } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { Session, TECTOS_DA_SINCRONIA, Vault } from "@enclave/client-core"
import { moradaDeSala, parseServerName } from "@enclave/protocol"
import { criarConta } from "./conta.mjs"

if (!globalThis.crypto) globalThis.crypto = webcrypto

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const CAPTURAS = join(RAIZ, "capturas")
const PORTA_DA_FRENTE = 8496
const PORTA_DO_SERVIDOR = 8497
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`
const FRASE = "frase-de-verificacao-2026"
/** Text the script writes (not a UI label). See `strings.guioes.test.ts`. */
const DITO_ANTES = "Isto foi dito antes de a Carla entrar."

const resultados = []
function verificar(nome, ok, detalhe = "") {
  resultados.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}

for (const [o_que, caminho] of [["a web construída", join(DIST, "index.html")], ["o servidor construído", SERVIDOR_JS]]) {
  if (!existsSync(caminho)) {
    console.error(`Falta ${o_que}: ${caminho}. Corre \`npm run build\` primeiro.`)
    process.exit(2)
  }
}
mkdirSync(CAPTURAS, { recursive: true })

// --- homeserver and front end, disposable ---------------------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-capturar-sincronia-"))
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

let browser
const sessoes = []
async function arrumar(codigo) {
  for (const s of sessoes) s.disconnect()
  await browser?.close().catch(() => {})
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
  process.exit(codigo)
}
if (!(await servidorDePe())) {
  console.error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
  await arrumar(2)
}

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

async function conta(nome) {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create(FRASE)
  const session = new Session(vault)
  await session.createIdentity(NOME)
  await session.updateProfile({ displayName: nome, donations: [] })
  await session.connect()
  sessoes.push(session)
  return { vault, session, address: session.identity.address }
}

/** A small, valid "photo": a one-pixel green PNG. Screen size comes from CSS. */
function fotografia() {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
}

async function capturar(page, nome) {
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(CAPTURAS, `sincronia-${nome}.png`) })
  console.log(`  captura: capturas/sincronia-${nome}.png`)
}

try {
  // Bruno's telemetry cap, deliberately low, so the bar shows.
  TECTOS_DA_SINCRONIA.bytesDeRelatoPorCanalPorMinuto = 12 * 1024
  TECTOS_DA_SINCRONIA.bytesPorTramaDeRelato = 2 * 1024

  const ana = await conta("Ana")
  const bruno = await conta("Bruno")
  // The address is random and the name goes inside (1.0 "Arca", slice 3): the short
  // name goes into `room.created` and `space.meta` at creation, and the display name
  // ("Lagar") only shows who wrote it (Ana, who will be offline), through the usual
  // relay.
  const curto = `lagar-${Math.random().toString(36).slice(2, 8)}`
  const canal = moradaDeSala(parseServerName(NOME))
  await ana.session.createSpaceChannel(canal, curto)
  await ana.session.updateSpaceMeta(canal, { name: "Lagar" })
  await ana.session.seat(canal, bruno.address)
  verificar("o Bruno entra no canal da Ana", await ate(() => bruno.session.channels.includes(canal)))
  for (const corpo of [DITO_ANTES, "E isto também."]) {
    await ana.session.send(canal, { t: "message", id: crypto.randomUUID(), body: corpo, sentAt: Date.now(), attachments: [] })
  }
  // Channel wall: state and posts for the snapshot to carry.
  const ids = []
  for (let i = 0; i < 24; i++) {
    const id = crypto.randomUUID()
    ids.push(id)
    await ana.session.send(canal, { t: "post", id, postedAt: Date.now(), caption: `Nota ${i + 1} do lagar.`, media: [], links: [], tags: [] })
  }
  for (let i = 0; i < 24; i++) await bruno.session.commentOnPost(canal, ids[i], `Comentário ${i + 1}.`)

  // Ana's wall, with one photo.
  const feed = await ana.session.ensureFeed()
  await ana.session.seat(feed, bruno.address)
  verificar("o Bruno entra no mural da Ana", await ate(() => bruno.session.channels.includes(feed)))
  const foto = crypto.randomUUID()
  await ana.session.send(feed, {
    t: "post",
    id: foto,
    postedAt: Date.now(),
    caption: "A vindima deste ano.",
    media: [{ name: "vindima.png", mediaType: "image/png", kind: "image", byteLength: 70, inline: fotografia() }],
    links: [],
    tags: [],
  })
  verificar("o Bruno tem a fotografia", await ate(() => bruno.session.history(feed).some((e) => e.payload.id === foto)))
  verificar(
    "o Bruno igual à Ana no canal",
    await ate(() => bruno.session.history(canal).filter((e) => e.payload.t === "post.comment").length === 24, 60_000),
  )

  // Carla, through the UI.
  browser = await chromium.launch({ headless: true })
  const contexto = await browser.newContext({ locale: "pt-PT", viewport: { width: 1200, height: 860 } })
  const carla = await contexto.newPage()
  await carla.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(carla, { nome: "Carla", frase: FRASE, servidor: NOME })
  await carla.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
  await carla.getByRole("button", { name: "Amigos", exact: true }).first().click()
  await carla.locator(".people-tabs").getByRole("button", { name: "Encontrar" }).click()
  const link = await carla.getByLabel("O teu link de amizade", { exact: true }).inputValue()
  const enderecoDaCarla = decodeURIComponent(new URL(link).hash.slice(1))
  verificar("o endereço da Carla", /^@[^:]+:/.test(enderecoDaCarla), enderecoDaCarla)

  // Ana leaves: what is hers reaches Carla only through Bruno's telemetry.
  ana.session.disconnect()
  await bruno.session.seat(canal, enderecoDaCarla)
  await bruno.session.seat(feed, enderecoDaCarla)

  await carla.getByRole("button", { name: "Comunidades" }).first().click()
  const entrada = carla.getByText(curto, { exact: true }).first()
  verificar("o canal aparece à Carla", await ate(() => entrada.isVisible(), 60_000))
  await entrada.click()
  const barra = carla.locator(".barra-sincronia")
  const viuABarra = await ate(() => barra.isVisible(), 30_000, 100)
  verificar('a barra "A receber o canal…" aparece', viuABarra)
  if (viuABarra) {
    // Progress only shows up when the first summary arrives from whoever responds.
    await ate(async () => /de \d+/.test(await barra.innerText()), 20_000, 100)
    verificar("e diz o que falta", /de \d+/.test(await barra.innerText()), await barra.innerText())
    await capturar(carla, "barra-1200")
  }

  await bruno.session.send(canal, { t: "message", id: crypto.randomUUID(), body: "Bem-vinda, Carla.", sentAt: Date.now(), attachments: [] })
  const marca = carla.locator(".timeline-lugar")
  verificar("o marcador do lugar aparece", await ate(() => marca.isVisible(), 30_000))
  verificar("com a frase", (await marca.innerText()).includes("Entraste aqui. O que foi dito antes não chega a este aparelho."))
  verificar("e nada da conversa de antes", !(await carla.getByText(DITO_ANTES).count()))
  await capturar(carla, "lugar-1200")

  // The bar vanishes on its own (the low cap delays it: we wait for the end).
  verificar("a barra some sozinha quando o canal chega", await ate(async () => !(await barra.isVisible()), 240_000, 1_000))

  await carla.setViewportSize({ width: 390, height: 844 })
  await capturar(carla, "lugar-390")
  await carla.setViewportSize({ width: 1200, height: 860 })

  // Help and Diagnostics.
  await carla.getByRole("button", { name: "Configurações" }).first().click()
  await carla.getByRole("button", { name: "Ajuda e diagnóstico" }).first().click()
  const linha = carla.locator(".estado-sincronia-linha").filter({ hasText: curto })
  verificar("o Diagnóstico tem a linha do canal", await ate(() => linha.isVisible(), 20_000))
  verificar("igual aos outros membros", await ate(async () => (await linha.innerText()).includes("Igual"), 60_000), await linha.innerText().catch(() => ""))
  await linha.scrollIntoViewIfNeeded()
  await capturar(carla, "diagnostico-1200")

  // The feed: Ana's photo, without bytes, and after asking.
  await carla.getByRole("button", { name: "Feed" }).first().click()
  const pedir = carla.getByRole("button", { name: /Pedir aos outros membros/ }).first()
  const temPedir = await ate(() => pedir.isVisible(), 60_000)
  verificar('a fotografia chega só com o nome, com "Pedir aos outros membros"', temPedir)
  if (temPedir) {
    await capturar(carla, "anexo-por-pedir-1200")
    await pedir.click()
    const imagem = carla.locator(".post-images img").first()
    verificar("a pedido, a fotografia chega e mostra-se", await ate(() => imagem.isVisible(), 60_000))
    await capturar(carla, "anexo-pedido-1200")
  }

  const falhas = resultados.filter((ok) => !ok).length
  console.log(falhas === 0 ? `\n${resultados.length}/${resultados.length} provas passaram.` : `\n${falhas} de ${resultados.length} provas FALHARAM.`)
  await arrumar(falhas === 0 ? 0 : 1)
} catch (erro) {
  console.error(erro)
  console.error(registoDoServidor.slice(-2000))
  await arrumar(1)
}
