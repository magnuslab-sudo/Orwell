/**
 * The four captures of the website homepage, in midnight skin.
 *
 *   npm run build && npm run build -w @enclave/server
 *   node scripts/retratar-site.mjs
 *
 * Replaces `scripts/retratar-homepage.mjs`, which captured the old skin and
 * depended on the swarm. This follows the pattern of `retratar-midnight.mjs`: the built
 * app (`apps/web/dist`), a disposable homeserver in a temp folder, a front
 * that acts as Caddy at 127.0.0.1, and no way to point it at production.
 *
 * Four made-up accounts (Inês, Tomás, Leonor and Marta) in a channel "Oficina".
 * Inês is the viewer, the 2×. Tomás and Leonor are in the voice room, Marta
 * writes and leaves (so there is someone offline in the members panel), and
 * Tomás publishes a photo that is drawn here in SVG, never read from disk.
 *
 * Saves to `apps/site/public/capturas/`, with the name and size that the page requests
 * (see `apps/site/index.html`, section `.provas`):
 *
 *   salas.webp     470×446   sidebar: the channel, rooms, people in voice
 *   conversa.webp  918×N     text room conversation, five messages
 *   pessoas.webp   448×560   members panel, with presence
 *   mural.webp     450×N     feed with two posts, photo, likes
 *                            and one comment
 *
 * The conversation and feed no longer fit the 4:1 da old skin banners: in midnight
 * skin each message is a bubble (max. 640 px) and each post is a card
 * (max. 600 px). Height comes from content, and width is double what the
 * page gives them at 1280-1440 px (459 e 225 px CSS, measured).
 *
 * Each crop is taken at 2× with the final proportions already correct, then
 * resized and converted by `cwebp`, quality 82.
 */
import { execFile, spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"

const correr = promisify(execFile)
const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const DESTINO = join(RAIZ, "apps/site/public/capturas")
// Dedicated ports, away from those in `retratar-midnight.mjs` (8482-8484): both
// scripts can run on the same machine without conflict.
const PORTA_DA_FRENTE = 8492
const PORTA_DO_SERVIDOR = 8493
const PORTA_DO_SFU = 8494
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`
const JANELA = { width: 1440, height: 900 }
const ESCALA = 2
// 82 by default; use `--qualidade=70` for another. Check the page weight cap
// (`scripts/medir-homepage.mjs`): the four screenshots together weigh what it measures.
const QUALIDADE = Number(process.argv.find((a) => a.startsWith("--qualidade="))?.split("=")[1] ?? 82)
const TECTO_BYTES = 120 * 1024

const results = []
function check(nome, ok, detalhe = "") {
  results.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}

for (const [o_que, caminho] of [["a web construída", join(DIST, "index.html")], ["o servidor construído", SERVIDOR_JS]]) {
  if (!existsSync(caminho)) {
    console.error(`Falta ${o_que}: ${caminho}. Corre \`npm run build\` e \`npm run build -w @enclave/server\` primeiro.`)
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
for (const porta of [PORTA_DA_FRENTE, PORTA_DO_SERVIDOR, PORTA_DO_SFU]) {
  if (!(await portaLivre(porta))) {
    console.error(`A porta ${porta} já tem dono. Este guião não mata processos de ninguém: liberta-a e volta a correr.`)
    process.exit(2)
  }
}

// --- the homeserver, disposable -----------------------------------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-site-"))
const recortes = mkdtempSync(join(tmpdir(), "orwell-site-recortes-"))
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR),
    ENCLAVE_COMMUNITY_MODE: "true",
    ENCLAVE_SFU_PORT: String(PORTA_DO_SFU),
    ENCLAVE_SFU_ANNOUNCED_IP: "127.0.0.1",
  },
  stdio: ["ignore", "pipe", "pipe"],
})
let registoDoServidor = ""
servidor.stdout.on("data", (bocado) => (registoDoServidor += bocado))
servidor.stderr.on("data", (bocado) => (registoDoServidor += bocado))

// --- The frontend that acts as Caddy. ----------------------------------------
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".wasm": "application/wasm",
}
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
  const adiante = http.request(
    { host: "127.0.0.1", port: PORTA_DO_SERVIDOR, path: pedido.url, method: pedido.method, headers: pedido.headers },
    (vinda) => {
      resposta.writeHead(vinda.statusCode ?? 502, vinda.headers)
      vinda.pipe(resposta)
    },
  )
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
  rmSync(recortes, { recursive: true, force: true })
  process.exit(codigoDeSaida)
}

if (!(await servidorDePe())) {
  console.error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
  await arrumar(2)
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const dentro = (page) => page.getByRole("button", { name: "Configurações" }).waitFor({ timeout: 90_000 })
const fora = []

async function novaPessoa(nome, deviceScaleFactor = 1) {
  const ctx = await browser.newContext({
    locale: "pt-PT",
    viewport: JANELA,
    deviceScaleFactor,
    permissions: ["microphone", "camera"],
  })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (erro) => erros.push(erro.message))
  page.on("request", (pedido) => {
    const url = new URL(pedido.url())
    if (!["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol !== "data:" && url.protocol !== "blob:") {
      fora.push(pedido.url())
    }
  })
  return { ctx, page, erros, nome }
}

/**
 * The post photo, drawn here: late afternoon over plains, in gradients and
 * hills. Rasterized by Chromium itself to PNG, in memory; no external file
 * enters the script.
 */
async function fotografiaSintetica() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="600" viewBox="0 0 1800 600">
    <defs>
      <linearGradient id="ceu" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#14183a"/>
        <stop offset="0.45" stop-color="#5a3a78"/>
        <stop offset="0.75" stop-color="#e0785a"/>
        <stop offset="1" stop-color="#f6c27a"/>
      </linearGradient>
      <radialGradient id="sol" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#fff2c8"/>
        <stop offset="0.5" stop-color="#ffd27a" stop-opacity="0.9"/>
        <stop offset="1" stop-color="#ffb060" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1800" height="600" fill="url(#ceu)"/>
    <circle cx="1240" cy="400" r="190" fill="url(#sol)"/>
    <path d="M0 400 C 260 340 480 380 720 360 S 1180 320 1400 360 S 1700 390 1800 370 V600 H0Z" fill="#3a2a52"/>
    <path d="M0 460 C 300 420 560 470 860 440 S 1380 420 1800 460 V600 H0Z" fill="#241c3c"/>
    <path d="M0 520 C 420 490 900 540 1300 505 S 1700 515 1800 505 V600 H0Z" fill="#141126"/>
    <g fill="#0c0a18">
      <ellipse cx="380" cy="480" rx="46" ry="30"/><rect x="376" y="480" width="8" height="40"/>
      <ellipse cx="520" cy="490" rx="34" ry="22"/><rect x="517" y="490" width="6" height="30"/>
      <ellipse cx="1500" cy="486" rx="52" ry="32"/><rect x="1496" y="486" width="8" height="42"/>
    </g>
  </svg>`
  const pagina = await browser.newPage({ viewport: { width: 1800, height: 600 } })
  await pagina.setContent(`<html><body style="margin:0">${svg}</body></html>`)
  const png = await pagina.screenshot({ type: "png" })
  await pagina.close()
  return png
}

/**
 * Crops a rectangle (in CSS px), taken at 2×, and scales to site size.
 *
 * The caller chooses the rectangle; final height comes from requested width and
 * rectangle proportion, so scaling only shrinks, never distorts.
 */
async function recortar(page, nome, caixa, largura, alturaPedida = 0) {
  await page.mouse.move(JANELA.width - 2, JANELA.height - 2)
  await wait(500)
  const clip = { x: Math.round(caixa.x), y: Math.round(caixa.y), width: Math.round(caixa.width), height: Math.round(caixa.height) }
  // Height requested by the site, if any; otherwise, the crop's own height.
  const altura = alturaPedida || Math.round((largura * clip.height) / clip.width)
  const png = join(recortes, `${nome}.png`)
  await page.screenshot({ path: png, clip })
  const webp = join(DESTINO, `${nome}.webp`)
  await correr("cwebp", ["-quiet", "-q", String(QUALIDADE), "-resize", String(largura), String(altura), png, "-o", webp])
  const bytes = statSync(webp).size
  check(`${nome}.webp ${largura}×${altura}, ${(bytes / 1024).toFixed(1)} kB`, bytes < TECTO_BYTES, `recorte ${clip.width}×${clip.height} px CSS a ${ESCALA}×`)
}

/** Bounding box of an element, with padding, in CSS px. */
const caixaDe = (page, selector, folga = 0) =>
  page.locator(selector).first().evaluate((el, f) => {
    const r = el.getBoundingClientRect()
    return { x: r.left - f, y: r.top - f, width: r.width + 2 * f, height: r.height + 2 * f }
  }, folga)

/** Bounding box combining multiple elements, with padding, in CSS px. */
const caixaDeTodos = (page, selector, folga = 0) =>
  page.evaluate(
    ([sel, f]) => {
      const rs = [...document.querySelectorAll(sel)].map((el) => el.getBoundingClientRect())
      const x = Math.min(...rs.map((r) => r.left)) - f
      const y = Math.min(...rs.map((r) => r.top)) - f
      return { x, y, width: Math.max(...rs.map((r) => r.right)) + f - x, height: Math.max(...rs.map((r) => r.bottom)) + f - y }
    },
    [selector, folga],
  )

/** No error message visible on the captured screen. */
async function semErroAVista(page, onde) {
  const texto = await page.evaluate(() => document.body.innerText)
  const erro = /\bErro\s+\d+/.exec(texto)
  check(`sem "Erro …" à vista (${onde})`, !erro, erro?.[0] ?? "")
}

try {
  browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  })

  // ------------------------------------------------------------- a fundadora
  const ines = await novaPessoa("Inês", ESCALA)
  await ines.page.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(ines.page, { nome: "Inês", servidor: NOME })
  await dentro(ines.page)

  await ines.page.getByRole("button", { name: "Criar canal" }).first().click()
  await ines.page.locator("form.prompt input").first().fill("Oficina")
  await ines.page.locator("form.prompt button.primary").first().click()
  await ines.page.getByRole("heading", { name: "Oficina" }).waitFor({ timeout: 30_000 })
  const sala = (page, nome) => page.locator(`.room-tree .room-name:text-is("${nome}")`).first()
  await sala(ines.page, "conversa").click()

  const escrever = async (pessoa, frase) => {
    const caixa = pessoa.page.locator(".chat-composer input:not([type=file])").first()
    await caixa.waitFor({ timeout: 60_000 })
    await caixa.fill(frase)
    await caixa.press("Enter")
    await ines.page.getByText(frase).first().waitFor({ timeout: 60_000 })
  }

  /** A new invite link created by Inês. One per person. */
  const convite = async () => {
    await ines.page.getByRole("button", { name: "Convidar…" }).first().click()
    await ines.page.locator(".sheet").first().getByRole("button", { name: "Por link" }).click()
    const folha = ines.page.locator(".sheet").first()
    await folha.getByRole("button", { name: "Criar link" }).click()
    const campo = folha.getByLabel("O teu link")
    await campo.waitFor({ timeout: 15_000 })
    const link = await campo.inputValue()
    await folha.getByRole("button", { name: "Fechar" }).click()
    return link
  }

  const entrar = async (nome) => {
    const link = await convite()
    const pessoa = await novaPessoa(nome)
    await pessoa.page.goto(link, { waitUntil: "domcontentloaded" })
    await criarConta(pessoa.page, { nome, servidor: NOME })
    await dentro(pessoa.page)
    await pessoa.page.getByRole("heading", { name: "Convite para um canal" }).waitFor({ timeout: 60_000 })
    await pessoa.page.getByRole("button", { name: "Entrar", exact: true }).click()
    await pessoa.page.getByRole("heading", { name: "Oficina" }).waitFor({ timeout: 60_000 })
    await sala(pessoa.page, "conversa").click()
    return pessoa
  }

  const tomas = await entrar("Tomás")
  const leonor = await entrar("Leonor")
  const marta = await entrar("Marta")
  check("quatro contas no canal Oficina", true)

  // --------------------------------------------------------------- a conversa
  await escrever(ines, "Alguém tem a lista das peças para sábado?")
  await escrever(tomas, "Tenho. Ponho-a fixada na sala daqui a nada.")
  await escrever(tomas, "Faltam as dobradiças e duas tábuas de pinho.")
  await escrever(marta, "As dobradiças trago eu, passo na loja amanhã de manhã.")
  await escrever(ines, "Perfeito. Então às dez na garagem do Tomás.")

  // Marta leaves: the member panel shows who is online and who is not.
  await marta.ctx.close()

  // ------------------------------------------------------------ voice room
  for (const pessoa of [tomas, leonor]) {
    await sala(pessoa.page, "voz").click()
    await pessoa.page.locator("section.call.call-sala").waitFor({ timeout: 30_000 })
  }
  const naVoz = await ines.page
    .waitForFunction(
      () => {
        const nomes = [...document.querySelectorAll(".room-tree")].map((el) => el.textContent ?? "")
        return nomes.some((t) => t.includes("Tomás") && t.includes("Leonor"))
      },
      null,
      { timeout: 60_000 },
    )
    .then(() => true, () => false)
  check("a Inês vê o Tomás e a Leonor na sala de voz", naVoz)

  // --------------------------------------------------------------- friendship
  // The feed only shows posts from friends. Inês requests friendship with Tomás by
  // his name in the conversation, and he accepts.
  await ines.page.locator(".message .author-botao", { hasText: "Tomás" }).first().click()
  const pagina = ines.page.locator("main.pagina-da-pessoa")
  await pagina.waitFor({ timeout: 15_000 })
  await pagina.getByRole("button", { name: "Pedir amizade" }).click()
  await pagina.getByRole("status").filter({ hasText: "Pedido enviado" }).waitFor({ timeout: 30_000 })
  await tomas.page.getByRole("button", { name: "Amigos", exact: true }).first().click()
  await tomas.page.locator(".people-tabs").getByRole("button", { name: "Recebidos" }).click()
  const aceitar = tomas.page.getByRole("button", { name: "Aceitar" }).first()
  await aceitar.waitFor({ timeout: 60_000 })
  await aceitar.click()
  check(
    "a amizade fica feita",
    await pagina
      .getByRole("button", { name: "Amigos", exact: true })
      .waitFor({ timeout: 60_000 })
      .then(() => true, () => false),
  )
  await ines.page.keyboard.press("Escape")
  await wait(5000)

  // ----------------------------------------------------------------- o mural
  await ines.page.getByRole("button", { name: "Feed", exact: true }).first().click()
  await ines.page.getByPlaceholder(/Escreve uma publicação/).fill("Lista fechada para sábado. Quem quiser ajudar a pintar, aparece.")
  await ines.page.getByRole("button", { name: "Publicar" }).click()
  await ines.page.getByText("Lista fechada para sábado.").first().waitFor({ timeout: 30_000 })

  await tomas.page.getByRole("button", { name: "Feed", exact: true }).first().click()
  await tomas.page.getByPlaceholder("Título (opcional)").fill("Fim de tarde")
  await tomas.page.getByPlaceholder(/Escreve uma publicação/).fill("Vista da garagem, depois de arrumar tudo.")
  await tomas.page
    .locator(".composer-actions input[type=file][accept^='image']")
    .setInputFiles({ name: "fim-de-tarde.png", mimeType: "image/png", buffer: await fotografiaSintetica() })
  await tomas.page.locator(".composer-card img").first().waitFor({ timeout: 30_000 })
  await tomas.page.getByRole("button", { name: "Publicar" }).click()
  await tomas.page.getByText("Vista da garagem").first().waitFor({ timeout: 30_000 })

  const fotografia = ines.page.locator("article.post", { hasText: "Vista da garagem" }).first()
  let chegou = await fotografia.waitFor({ timeout: 60_000 }).then(() => true, () => false)
  if (!chegou) {
    const pedir = ines.page.getByRole("button", { name: "Pedir as publicações" })
    if (await pedir.isVisible().catch(() => false)) await pedir.click()
    chegou = await fotografia.waitFor({ timeout: 90_000 }).then(() => true, () => false)
  }
  check("a publicação do Tomás chega ao feed da Inês", chegou)
  await fotografia.locator(".post-images img").first().waitFor({ timeout: 30_000 })
  await fotografia.getByRole("button", { name: "Gosto", exact: true }).click()
  await fotografia.locator(".vote.wide").click()
  await fotografia.getByPlaceholder("Escrever um comentário…").fill("Ficou tão bonita! Guarda-me um lugar no banco.")
  await fotografia.getByPlaceholder("Escrever um comentário…").press("Enter")
  await fotografia.locator(".comment-text", { hasText: "Guarda-me um lugar" }).waitFor({ timeout: 30_000 })
  // A like from Leonor? She is not a friend: not visible. Tomás's own like counts.
  await tomas.page
    .locator("article.post", { hasText: "Vista da garagem" })
    .first()
    .getByRole("button", { name: "Gosto", exact: true })
    .click()
  await fotografia.locator(".vote.on .vote-count", { hasText: "2" }).waitFor({ timeout: 30_000 }).catch(() => {})

  // ---------------------------------------------------------------- recortes
  await ines.page.evaluate(() => document.fonts.ready)

  // FEED: the two posts, from the top of the first to the end of the second.
  const posts = ines.page.locator("article.post")
  check("o mural tem duas publicações", (await posts.count()) === 2)
  await posts.first().scrollIntoViewIfNeeded()
  await semErroAVista(ines.page, "mural")
  // The window grows to fit the entire feed: the crop only captures what is visible.
  await ines.page.setViewportSize({ width: JANELA.width, height: 1400 })
  await posts.first().evaluate((el) => el.scrollIntoView({ block: "start" }))
  await wait(800)
  // No focus in the comment box: the bright outline is not what shows.
  await ines.page.evaluate(() => document.activeElement?.blur())
  await recortar(ines.page, "mural", await caixaDeTodos(ines.page, "article.post", 4), 450)
  await ines.page.setViewportSize(JANELA)

  // Back to the channel, for the other three.
  await ines.page.getByRole("button", { name: "Comunidades" }).first().click()
  await sala(ines.page, "conversa").click()
  // Text written by the test account itself (not from the library): searched by
  // message content, not by `getByText`, which the script tests reserve for
  // interface text.
  await ines.page.locator(".message, .msg, article, li").filter({ hasText: "dez na garagem" }).first().waitFor({ timeout: 30_000 })
  await wait(1500)
  await semErroAVista(ines.page, "canal")

  // ROOMS: the channel and its room tree, down to who is in voice. Height comes
  // from proportion and stops just above "New room", which would look cut off
  // halfway.
  const arvore = await caixaDe(ines.page, ".channel-list", 6)
  arvore.height = arvore.width * (446 / 470)
  const novaSala = await ines.page.evaluate(() => {
    const el = [...document.querySelectorAll(".room-tree *")].find((e) => e.children.length === 0 && e.textContent.trim() === "Nova sala")
    return el ? el.getBoundingClientRect().top : null
  })
  if (novaSala !== null && arvore.y + arvore.height > novaSala - 6) arvore.y = novaSala - 6 - arvore.height
  await recortar(ines.page, "salas", arvore, 470, 446)

  // PEOPLE: the member panel, from top to a 4:5 proportion.
  const membros = await caixaDe(ines.page, ".members")
  membros.height = membros.width * (560 / 448)
  await recortar(ines.page, "pessoas", membros, 448, 560)

  // CONVERSATION: the five messages, from avatars to the end of the bubbles.
  await recortar(ines.page, "conversa", await caixaDeTodos(ines.page, ".timeline .message-avatar-botao, .timeline .message-body", 14), 918)

  check("nenhum erro de página", [ines, tomas, leonor].every((p) => p.erros.length === 0), [ines, tomas, leonor].flatMap((p) => p.erros).join(" | "))
} catch (erro) {
  console.error(erro)
  results.push(false)
}

check("nenhum pedido saiu de 127.0.0.1", fora.length === 0, fora.slice(0, 3).join(" "))
const falhas = results.filter((ok) => !ok).length
console.log(`\n${results.length - falhas}/${results.length} verificações passaram.`)
await arrumar(falhas === 0 ? 0 : 1)
