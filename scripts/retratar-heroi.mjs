/**
 * The hero picture of the website: the whole app window, in the dark theme and
 * in the light theme, in English and in Portuguese.
 *
 *   npx tsc -b && npm run build -w @enclave/web && npm run build -w @enclave/server
 *   node scripts/retratar-heroi.mjs [--linguas=en,pt] [--previas=<dir>] [--tecto=70000] [--pausa=20]
 *
 * Built like `retratar-site.mjs`: the built app (`apps/web/dist`), a disposable
 * homeserver in a temp folder, a front that acts as Caddy at 127.0.0.1, and no
 * way to point it at production. One fresh homeserver per language, so each
 * picture has one channel and four accounts and nothing else.
 *
 * Four made-up accounts: Sofia (the viewer), Tomas, Leonor and Rui, in a
 * channel "Night Owls" ("Noctivagos" in Portuguese). They talk about meeting
 * in the voice room tonight, Tomas and Leonor sit in the voice room, and Rui
 * writes and leaves, so the member list has someone offline.
 *
 * The accounts are created and invited through the Portuguese interface,
 * because `conta.mjs` and `convite.mjs` look for Portuguese labels. Only the
 * capture opens the app in the language of the picture. The rooms a channel is
 * born with are shown in the language of who reads (`nomesDeOrigem.ts`), so a
 * channel created in Portuguese reads "chat" and "voice" in English.
 *
 * Saves to `apps/site/public/capturas/` (git ignores it):
 *
 *   aplicacao-<lingua>-<escuro|claro>-<hash8>.webp
 *
 * `hash8` is the first 8 hex characters of the sha256 of the file: the site
 * caches these for ever, so the name changes with the content. Older files of
 * the same language and theme are removed.
 *
 * The window is 1280x800 CSS px at 2x. The site has a page weight cap
 * (`medir-homepage.mjs`), so each WebP has to fit under `--tecto` bytes: the
 * script tries 1920x1200, 1600x1000 and 1440x900, at quality 80, 76, 72 and
 * 70, and keeps the largest size where EVERY picture fits, so all of them come
 * out with the same pixel dimensions. It prints the size and quality chosen.
 *
 * `cwebp` is not needed: the resize and the WebP encoding are done by the
 * browser itself, on a canvas. `--previas=<dir>` also writes each final WebP
 * decoded back to PNG, to look at what the encoder did.
 *
 * Playwright's own Chromium is used when it is installed; otherwise Edge
 * (`channel: "msedge"`).
 */
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar, etiquetaDe } from "./convite.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const DESTINO = join(RAIZ, "apps/site/public/capturas")
// Dedicated ports, away from those of `retratar-site.mjs` (8492-8494) and
// `retratar-midnight.mjs` (8482-8484). A busy port is skipped, never freed.
const PRIMEIRA_PORTA = 8592
const JANELA = { width: 1280, height: 800 }
const ESCALA = 2
const TAMANHOS = [
  [1920, 1200],
  [1600, 1000],
  [1440, 900],
]
const QUALIDADES = [80, 76, 72, 70]

const argumento = (nome, omissao) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3) ?? omissao
const LINGUAS = argumento("linguas", "en,pt").split(",").filter(Boolean)
const PREVIAS = argumento("previas", "") ? resolve(argumento("previas", "")) : null
// 70 000 bytes: under 70 kB whether a kB is 1000 or 1024 bytes.
const TECTO_BYTES = Number(argumento("tecto", "70000"))
// Seconds between two messages. `--pausa=0` for a quick run while changing the script.
const PAUSA_SEGUNDOS = Number(argumento("pausa", "20"))
/**
 * Requests that are not the app's: an antivirus on this machine that writes its
 * own script into every page served over plain HTTP. They are refused like any
 * other request to the outside and listed at the end, but they do not fail the run.
 */
const RUIDO_DA_MAQUINA = [/(^|\.)kaspersky-labs\.com$/]

/** What each language writes. The names have no accents, so they read the same in both. */
const CENAS = {
  en: {
    locale: "en-US",
    canal: "Night Owls",
    conversa: "chat",
    mensagens: [
      ["Tomas", "Anyone up for a few rounds tonight?"],
      ["Leonor", "Me! Voice room after dinner?"],
      ["Sofia", "Count me in. I can share my screen and show you the new map."],
      ["Rui", "Save me a seat, I will be a little late."],
      ["Tomas", "No rush. Leonor and I are already in voice, warming up."],
      ["Leonor", "Sofia, bring snacks. Virtual ones count."],
      ["Sofia", "Deal. See you all tonight!"],
    ],
  },
  pt: {
    locale: "pt-PT",
    canal: "Noctivagos",
    conversa: "conversa",
    mensagens: [
      ["Tomas", "Alguém alinha numas partidas logo à noite?"],
      ["Leonor", "Eu! Sala de voz depois do jantar?"],
      ["Sofia", "Contem comigo. Partilho o ecrã e mostro-vos o mapa novo."],
      ["Rui", "Guardem-me um lugar, chego um bocadinho atrasado."],
      ["Tomas", "Sem pressa. Eu e a Leonor já estamos na voz, a aquecer."],
      ["Leonor", "Sofia, traz petiscos. Os virtuais também contam."],
      ["Sofia", "Combinado. Até logo, malta!"],
    ],
  },
}
const TEMAS = ["escuro", "claro"]

const results = []
function check(nome, ok, detalhe = "") {
  results.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}
const wait = (ms) => new Promise((resolver) => setTimeout(resolver, ms))

for (const lingua of LINGUAS) {
  if (!CENAS[lingua]) {
    console.error(`Unknown language "${lingua}". Known: ${Object.keys(CENAS).join(", ")}.`)
    process.exit(2)
  }
}
for (const [o_que, caminho] of [["the built web app", join(DIST, "index.html")], ["the built server", SERVIDOR_JS]]) {
  if (!existsSync(caminho)) {
    console.error(`Missing ${o_que}: ${caminho}. Run \`npx tsc -b\`, \`npm run build -w @enclave/web\` and \`npm run build -w @enclave/server\` first.`)
    process.exit(2)
  }
}

function portaLivre(porta) {
  return new Promise((resolver) => {
    const sonda = net.createServer()
    sonda.once("error", () => resolver(false))
    sonda.once("listening", () => sonda.close(() => resolver(true)))
    sonda.listen(porta, "127.0.0.1")
  })
}

/** Three free ports from `PRIMEIRA_PORTA` up. Nobody's process is killed to get them. */
async function tresPortas() {
  const livres = []
  for (let porta = PRIMEIRA_PORTA; porta < PRIMEIRA_PORTA + 40 && livres.length < 3; porta++) {
    if (await portaLivre(porta)) livres.push(porta)
  }
  if (livres.length < 3) throw new Error(`no three free ports between ${PRIMEIRA_PORTA} and ${PRIMEIRA_PORTA + 39}`)
  return livres
}

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

/**
 * A disposable homeserver and the front that acts as Caddy: `/app/` is the
 * built web app, everything else (and the WebSocket) goes to the homeserver.
 */
async function levantarCasa() {
  const [portaDaFrente, portaDoServidor, portaDoSfu] = await tresPortas()
  const nome = `localhost:${portaDaFrente}`
  const dados = mkdtempSync(join(tmpdir(), "orwell-heroi-"))
  const servidor = spawn(process.execPath, [SERVIDOR_JS], {
    env: {
      ...process.env,
      ENCLAVE_DATA_DIR: dados,
      ENCLAVE_SERVER_NAME: nome,
      ENCLAVE_BIND_HOST: "127.0.0.1",
      ENCLAVE_BIND_PORT: String(portaDoServidor),
      ENCLAVE_COMMUNITY_MODE: "true",
      ENCLAVE_SFU_PORT: String(portaDoSfu),
      ENCLAVE_SFU_ANNOUNCED_IP: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let registo = ""
  servidor.stdout.on("data", (bocado) => (registo += bocado))
  servidor.stderr.on("data", (bocado) => (registo += bocado))
  const saiu = new Promise((resolver) => servidor.once("exit", resolver))

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
      { host: "127.0.0.1", port: portaDoServidor, path: pedido.url, method: pedido.method, headers: pedido.headers },
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
  const ligacoes = new Set()
  frente.on("connection", (socket) => {
    ligacoes.add(socket)
    socket.once("close", () => ligacoes.delete(socket))
  })
  frente.on("upgrade", (pedido, socket, cabeca) => {
    const destino = net.connect(portaDoServidor, "127.0.0.1", () => {
      const linhas = [`${pedido.method} ${pedido.url} HTTP/${pedido.httpVersion}`]
      for (let i = 0; i < pedido.rawHeaders.length; i += 2) linhas.push(`${pedido.rawHeaders[i]}: ${pedido.rawHeaders[i + 1]}`)
      destino.write(`${linhas.join("\r\n")}\r\n\r\n`)
      if (cabeca.length) destino.write(cabeca)
      socket.pipe(destino).pipe(socket)
    })
    destino.on("error", () => socket.destroy())
    socket.on("error", () => destino.destroy())
  })
  await new Promise((resolver) => frente.listen(portaDaFrente, "127.0.0.1", resolver))

  const fechar = async () => {
    for (const socket of ligacoes) socket.destroy()
    await new Promise((resolver) => frente.close(resolver))
    servidor.kill()
    await Promise.race([saiu, wait(5000)])
    // The server's files can stay locked for a moment after it dies (Windows).
    for (let volta = 0; volta < 10; volta++) {
      try {
        rmSync(dados, { recursive: true, force: true })
        break
      } catch {
        await wait(300)
      }
    }
  }

  for (let volta = 0; volta < 60; volta++) {
    const ok = await new Promise((resolver) => {
      const sonda = net.connect(portaDoServidor, "127.0.0.1", () => {
        sonda.destroy()
        resolver(true)
      })
      sonda.on("error", () => resolver(false))
    })
    if (ok) return { nome, fechar }
    await wait(250)
  }
  await fechar()
  throw new Error("the homeserver did not start:\n" + registo.slice(-2000))
}

/** Playwright's Chromium when it is installed, Edge when it is not. */
async function lancarBrowser() {
  const opcoes = {
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  }
  let proprio = false
  try {
    proprio = existsSync(chromium.executablePath())
  } catch {
    proprio = false
  }
  if (proprio) return chromium.launch(opcoes)
  console.log("  ..  Playwright's Chromium is not installed: using Edge")
  return chromium.launch({ ...opcoes, channel: "msedge" })
}

const fora = []
const ruido = new Set()
const errosDePagina = []

/** The app is open: the Settings button only exists with an account, connected. */
const dentro = (page) => page.getByRole("button", { name: /^(Configurações|Settings)$/ }).first().waitFor({ timeout: 90_000 })

async function novaPessoa(browser, nome, { locale = "pt-PT", deviceScaleFactor = 1 } = {}) {
  const ctx = await browser.newContext({
    locale,
    viewport: JANELA,
    deviceScaleFactor,
    acceptDownloads: true,
    permissions: ["microphone", "camera"],
  })
  // Nothing leaves this machine: a request to anywhere else is refused and counted.
  await ctx.route(
    (url) => !["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol !== "data:" && url.protocol !== "blob:",
    (rota) => {
      const url = rota.request().url()
      if (RUIDO_DA_MAQUINA.some((padrao) => padrao.test(new URL(url).hostname))) ruido.add(new URL(url).hostname)
      else fora.push(url)
      return rota.abort()
    },
  )
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => errosDePagina.push(`${nome}: ${erro.message}`))
  return { ctx, page, nome }
}

/** The four accounts, the channel, the conversation and the voice room, for one language. */
async function retratarLingua(browser, lingua) {
  const cena = CENAS[lingua]
  const casa = await levantarCasa()
  const app = (qual) => `http://${casa.nome}/app/?lingua=${qual}`
  const pessoas = {}
  const pngs = {}
  try {
    for (const nome of ["Sofia", "Tomas", "Leonor", "Rui"]) {
      const pessoa = await novaPessoa(browser, nome, nome === "Sofia" ? { locale: cena.locale, deviceScaleFactor: ESCALA } : {})
      await pessoa.page.goto(app("pt"), { waitUntil: "domcontentloaded" })
      // `memorizar`: Sofia opens the app again (other language, other theme) without the password.
      await criarConta(pessoa.page, { nome, servidor: casa.nome, memorizar: true, canalOficial: false })
      await dentro(pessoa.page)
      await wait(1500)
      pessoa.addr = (await pessoa.page.evaluate(() => document.body.innerText)).match(/@[a-z0-9-]+:[^\s]+/)?.[0]
      pessoas[nome] = pessoa
    }
    const { Sofia: sofia, Tomas: tomas, Leonor: leonor, Rui: rui } = pessoas
    check(`[${lingua}] four accounts`, Object.values(pessoas).every((p) => p.addr), Object.values(pessoas).map((p) => p.addr).join(" "))

    await sofia.page.getByRole("button", { name: "Criar canal" }).first().click()
    await sofia.page.locator("form.prompt input").first().fill(cena.canal)
    await sofia.page.locator("form.prompt button.primary").first().click()
    await sofia.page.locator(".channel-name", { hasText: cena.canal }).first().waitFor({ timeout: 30_000 })

    const etiqueta = etiquetaDe(cena.canal)
    for (const pessoa of [tomas, leonor, rui]) {
      const entrou = (await convidar(sofia.page, etiqueta, pessoa.addr)) && (await aceitarConvite(pessoa.page, etiqueta))
      check(`[${lingua}] ${pessoa.nome} joins ${cena.canal}`, entrou)
      if (!entrou) throw new Error(`${pessoa.nome} did not join`)
    }

    // Setup runs in Portuguese: the rooms are "conversa" and "voz" on these screens.
    const sala = (page, nome) => page.locator(`.room-tree .room-name:text-is("${nome}")`).first()
    for (const pessoa of Object.values(pessoas)) {
      await sala(pessoa.page, "conversa").click()
      await pessoa.page.locator(".chat-composer textarea").first().waitFor({ timeout: 60_000 })
    }
    for (const [quem, frase] of cena.mensagens) {
      const caixa = pessoas[quem].page.locator(".chat-composer textarea").first()
      await caixa.fill(frase)
      await caixa.press("Enter")
      // Text written by the account itself: looked for in the timeline, on Sofia's screen.
      await sofia.page.locator(".timeline", { hasText: frase }).first().waitFor({ timeout: 60_000 })
      // The pause spreads the messages over a few minutes: seven lines with the
      // same minute beside them read as a script, not as a conversation.
      if (frase !== cena.mensagens.at(-1)[1]) await wait(Math.max(700, PAUSA_SEGUNDOS * 1000))
    }
    check(`[${lingua}] ${cena.mensagens.length} messages reach Sofia`, true)

    // The invitations left Sofia three private conversations and three entries
    // in the bell. She reads them, so the picture has no counters of its own making.
    await sofia.page.locator(".me-bell").first().click()
    const lerTudo = sofia.page.getByRole("button", { name: "Marcar tudo como lido" }).first()
    if (await lerTudo.isVisible({ timeout: 3000 }).catch(() => false)) await lerTudo.click()
    await sofia.page.keyboard.press("Escape")
    await sofia.page.getByRole("button", { name: "Amigos", exact: true }).first().click()
    const conversas = sofia.page.locator(".direct-list li.direct-row button.direct-open")
    await conversas.first().waitFor({ timeout: 15_000 }).catch(() => {})
    for (let i = 0; i < (await conversas.count()); i++) {
      await conversas.nth(i).click()
      await wait(1200)
    }
    await sofia.page.getByRole("button", { name: "Comunidades", exact: true }).first().click()
    await sala(sofia.page, "conversa").click()
    await wait(1000)

    // Rui leaves: the member list shows who is online and who is not.
    await rui.ctx.close()

    for (const pessoa of [tomas, leonor]) {
      await sala(pessoa.page, "voz").click()
      await pessoa.page.locator("section.call.call-sala, .call-chip").first().waitFor({ timeout: 30_000 })
    }

    // -------------------------------------------------------------- captures
    const { page } = sofia
    for (const tema of TEMAS) {
      await page.evaluate((t) => {
        const prefs = JSON.parse(localStorage.getItem("enclave.prefs") ?? "{}")
        // `frasesVistas`: the "first channel" phrase is closed, as after "Got it".
        localStorage.setItem("enclave.prefs", JSON.stringify({ ...prefs, tema: t, frasesVistas: ["conta", "canal"] }))
      }, tema)
      await page.goto(app(lingua), { waitUntil: "domcontentloaded" })
      await dentro(page)
      await sala(page, cena.conversa).click()
      const ultima = cena.mensagens.at(-1)[1]
      await page.locator(".timeline", { hasText: ultima }).first().waitFor({ timeout: 60_000 })

      const naVoz = await page
        .waitForFunction(
          () => {
            const nomes = [...document.querySelectorAll(".room-tree .voice-member-name")].map((el) => el.textContent ?? "")
            return nomes.some((n) => n.includes("Tomas")) && nomes.some((n) => n.includes("Leonor"))
          },
          null,
          { timeout: 60_000 },
        )
        .then(() => true, () => false)
      check(`[${lingua} ${tema}] Tomas and Leonor sit in the voice room`, naVoz)
      const ruiFora = await page
        .locator(".members .member-group.offline", { hasText: "Rui" })
        .first()
        .waitFor({ timeout: 90_000 })
        .then(() => true, () => false)
      check(`[${lingua} ${tema}] Rui is offline in the member list`, ruiFora)
      const ligados = await page.locator(".members .member-group:not(.offline) .member-row").count()
      check(`[${lingua} ${tema}] three people online in the member list`, ligados === 3, `${ligados}`)

      await page.evaluate(() => document.fonts.ready)
      // No focus ring, no tooltip, no hover: nothing focused and the mouse in a corner.
      await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
      await page.mouse.move(JANELA.width - 1, JANELA.height - 1)
      await wait(2000)
      const estado = await page.evaluate(() => ({
        tema: document.documentElement.dataset.theme,
        lingua: document.documentElement.lang,
        texto: document.body.innerText,
        aberto: document.querySelectorAll('[role="dialog"], [role="menu"], [role="tooltip"], .modal, .sheet, .toast').length,
        contadores: document.querySelectorAll(".rail-count, .rail-pill, .rail-toque, .me-bell-count, .channel-list .badge").length,
      }))
      check(`[${lingua} ${tema}] no unread counter in view`, estado.contadores === 0, `${estado.contadores}`)
      check(`[${lingua} ${tema}] the theme and the language are the ones asked for`, estado.tema === tema && estado.lingua.startsWith(lingua), `${estado.tema} ${estado.lingua}`)
      const erro = /\b(Erro|Error)\b[^\n]*/.exec(estado.texto)
      check(`[${lingua} ${tema}] no error text in view`, !erro, erro?.[0] ?? "")
      check(`[${lingua} ${tema}] no dialog, menu, tooltip or toast open`, estado.aberto === 0, `${estado.aberto}`)
      pngs[tema] = await page.screenshot({ type: "png" })
    }
  } finally {
    for (const pessoa of Object.values(pessoas)) await pessoa.ctx.close().catch(() => {})
    await casa.fechar()
  }
  return pngs
}

/**
 * The resize and the WebP encoding, done by the browser on a canvas.
 * Returns the bytes of `png` drawn at `largura` x `altura`, as `tipo`.
 */
async function codificar(oficina, bytes, origem, largura, altura, tipo, qualidade) {
  const dados = await oficina.evaluate(
    async ([base64, mime, l, a, t, q]) => {
      const imagem = new Image()
      imagem.src = `data:${mime};base64,${base64}`
      await imagem.decode()
      const tela = document.createElement("canvas")
      tela.width = l
      tela.height = a
      const pincel = tela.getContext("2d")
      pincel.imageSmoothingEnabled = true
      pincel.imageSmoothingQuality = "high"
      pincel.drawImage(imagem, 0, 0, l, a)
      return tela.toDataURL(t, q).split(",")[1]
    },
    [bytes.toString("base64"), origem, largura, altura, tipo, qualidade],
  )
  return Buffer.from(dados, "base64")
}

let browser
let codigoDeSaida = 1
try {
  browser = await lancarBrowser()
  const retratos = []
  for (const lingua of LINGUAS) {
    console.log(`\n--- ${lingua} ---`)
    const pngs = await retratarLingua(browser, lingua)
    for (const tema of TEMAS) if (pngs[tema]) retratos.push({ lingua, tema, png: pngs[tema] })
  }
  check("every picture was taken", retratos.length === LINGUAS.length * TEMAS.length, `${retratos.length}`)

  // ------------------------------------------------------- size and quality
  console.log("\n--- WebP ---")
  const oficina = await (await browser.newContext({ viewport: { width: 400, height: 300 } })).newPage()
  await oficina.goto("about:blank")
  const webp = (retrato, [largura, altura], qualidade) => codificar(oficina, retrato.png, "image/png", largura, altura, "image/webp", qualidade / 100)

  // The largest size where every picture fits under the cap, at some quality.
  let tamanho = null
  for (const candidato of TAMANHOS) {
    let cabemTodas = true
    for (const retrato of retratos) {
      const menor = (await webp(retrato, candidato, QUALIDADES.at(-1))).length
      console.log(`  ..  ${retrato.lingua} ${retrato.tema} at ${candidato.join("x")} q${QUALIDADES.at(-1)}: ${(menor / 1000).toFixed(1)} kB`)
      if (menor > TECTO_BYTES) cabemTodas = false
    }
    if (cabemTodas) {
      tamanho = candidato
      break
    }
  }
  check(`every picture fits under ${TECTO_BYTES} bytes at one of the sizes`, tamanho !== null)
  if (tamanho === null) tamanho = TAMANHOS.at(-1)

  mkdirSync(DESTINO, { recursive: true })
  if (PREVIAS) mkdirSync(PREVIAS, { recursive: true })
  for (const retrato of retratos) {
    // The highest quality that fits, at the common size.
    let bytes = null
    let qualidade = QUALIDADES.at(-1)
    for (const q of QUALIDADES) {
      const tentativa = await webp(retrato, tamanho, q)
      if (tentativa.length <= TECTO_BYTES || q === QUALIDADES.at(-1)) {
        bytes = tentativa
        qualidade = q
        break
      }
    }
    const base = `aplicacao-${retrato.lingua}-${retrato.tema}`
    for (const antigo of readdirSync(DESTINO)) {
      if (new RegExp(`^${base}-[0-9a-f]{8}\\.webp$`).test(antigo)) rmSync(join(DESTINO, antigo))
    }
    const nome = `${base}-${createHash("sha256").update(bytes).digest("hex").slice(0, 8)}.webp`
    writeFileSync(join(DESTINO, nome), bytes)
    check(`${nome}  ${tamanho.join("x")}  q${qualidade}  ${bytes.length} bytes (${(bytes.length / 1000).toFixed(1)} kB)`, bytes.length <= TECTO_BYTES)
    if (PREVIAS) {
      writeFileSync(join(PREVIAS, `${base}.png`), await codificar(oficina, bytes, "image/webp", tamanho[0], tamanho[1], "image/png", 1))
    }
  }
  console.log(`\n  ..  size chosen for all: ${tamanho.join("x")}`)
  console.log(`  ..  written to ${DESTINO}${PREVIAS ? `, PNG previews in ${PREVIAS}` : ""}`)

  check("no page error", errosDePagina.length === 0, errosDePagina.slice(0, 3).join(" | "))
  check("no request left 127.0.0.1", fora.length === 0, fora.slice(0, 3).join(" "))
  if (ruido.size > 0) console.log(`  ..  refused, not the app's (this machine's antivirus): ${[...ruido].join(", ")}`)
  const falhas = results.filter((ok) => !ok).length
  console.log(`\n${results.length - falhas}/${results.length} checks passed.`)
  codigoDeSaida = falhas === 0 ? 0 : 1
} catch (erro) {
  console.error(erro)
} finally {
  await browser?.close().catch(() => {})
}
process.exit(codigoDeSaida)
