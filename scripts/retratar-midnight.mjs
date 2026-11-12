/**
 * The midnight skin and the call window, screenshot captured and verified live.
 *
 *   npm run build && node scripts/retratar-midnight.mjs
 *
 * Opens the built app (`apps/web/dist`) against a throwaway homeserver on ephemeral ports,
 * with two accounts in two Chromium contexts (fake microphone and camera), and
 * saves to `capturas/`:
 *
 *   midnight-portao.png          the gate (create account)
 *   midnight-conversa.png        the chat in the common channel
 *   midnight-chamada-voz.png     the voice room: the mosaic, with two people
 *   midnight-chamada-ecra.png    the shared screen in focus, with the queue above
 *   midnight-chamada-lateral.png the active call in another room: the card on the side
 *   midnight-voz.png             Settings › Microphone and camera (the voice)
 *   midnight-telemovel.png       the chat at 390 px, with the compact bar
 *   midnight-voz-com-chamada.png Settings open from the call view: the card stays
 *   midnight-telemovel-config-com-chamada.png  the same at 390 px, with the compact bar
 *   midnight-anel-1x.png         the halo and ring around an avatar, at 1×
 *   midnight-anel-2x.png         the same, in another context at 2× (devicePixelRatio)
 *   midnight-halo-2x.png         Kaori's halo speaking at −30 dBFS (fake voice), at 2×
 *   midnight-pessoa.png          someone else's page, at 1280 px
 *   midnight-pessoa-publicacoes.png  a post from the feed, open on the page
 *   midnight-pessoa-390.png      the person's page at 390 px, in a column
 *   midnight-feed.png            the feed, with Kaori's posts
 *   midnight-feed-rato.png       the same, with a card under the mouse
 *   midnight-feed-390.png        the feed at 390 px
 *
 * And checks what you see: the font loaded, the background is from the skin, the mosaic
 * has one card per person, the screen goes to the stage, the control bar has names and
 * `aria-pressed`, nothing scrolls horizontally at 390 px, and no request leaves 127.0.0.1.
 * And the surfaces (`paineis-medidas.mjs`): each panel is an almost solid tint without blur,
 * over the aurora, the text passes AA against what is right below it, and the fps of the chat,
 * feed, and call at 1280 and 390 px land in the final report.
 *
 * ALL LOCAL, following the pattern from `e2e-telemovel.mjs`: a homeserver in a temp folder,
 * a front that acts as Caddy on 8482, and no way to point it at production.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { medirContraste, medirFps, verificarPaineis } from "./paineis-medidas.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const CAPTURAS = join(RAIZ, "capturas")
const PORTA_DA_FRENTE = 8482
const PORTA_DO_SERVIDOR = 8483
const PORTA_DO_SFU = 8484
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`
const LARGO = { width: 1280, height: 800 }
const TELEMOVEL = { width: 390, height: 844 }

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
for (const porta of [PORTA_DA_FRENTE, PORTA_DO_SERVIDOR, PORTA_DO_SFU]) {
  if (!(await portaLivre(porta))) {
    console.error(`A porta ${porta} já tem dono. Este guião não mata processos de ninguém: liberta-a e volta a correr.`)
    process.exit(2)
  }
}

// --- the homeserver, disposable -----------------------------------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-midnight-"))
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR),
    ENCLAVE_COMMUNITY_MODE: "true",
    // The media engine (SFU), as in production: the shared screen only reaches
    // whoever requests it here. Local, on 127.0.0.1.
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
  // The `redir /c -> /app/c` from Caddy: invite links are `/c#…` (the fragment
  // stays in the browser and crosses the redirect).
  if (caminho === "/c") {
    resposta.writeHead(302, { location: "/app/c" })
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
  process.exit(codigoDeSaida)
}

if (!(await servidorDePe())) {
  console.error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
  await arrumar(2)
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const dentro = (page) => page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
const fora = []

async function retratar(page, nome) {
  const ficheiro = join(CAPTURAS, `midnight-${nome}.png`)
  await page.screenshot({ path: ficheiro })
  console.log(`  ..  captura: ${ficheiro}`)
}

/** Nothing scrolls horizontally: the document width fits in the window. */
const semRolagemHorizontal = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

/**
 * The surfaces over the aurora, measured live (see `paineis-medidas.mjs`). The fps are
 * not a check: they depend on the machine and headless Chromium. They land in
 * the final report, along with contrast.
 */
const medidas = { fps: {}, contraste: {} }
async function fps(page, onde) {
  const medida = await medirFps(page)
  medidas.fps[onde] = medida
  console.log(`  ..  fps ${onde}: ${medida.fps} (p95 ${medida.p95} ms)`)
}
/** The same fps with one more rule, to know how much each part costs. */
async function fpsCom(page, onde, css) {
  const regra = await page.addStyleTag({ content: css })
  await wait(400)
  await fps(page, onde)
  await regra.evaluate((no) => no.remove())
  await wait(200)
}
const SEM_AURORA_A_ANDAR = "body::before { animation: none !important; }"

async function contraste(page, onde, seletor) {
  // Two measurements six seconds apart: the aurora moves, and the worst case
  // can be in one place or the other.
  const a = await medirContraste(page, seletor)
  await wait(6000)
  const b = await medirContraste(page, seletor)
  const falhas = [...a.falhas, ...b.falhas]
  const piores = [a.pior, b.pior].filter(Boolean).sort((x, y) => x.valor / x.limite - y.valor / y.limite)
  medidas.contraste[onde] = { pior: piores[0] ?? null, medidas: a.medidas + b.medidas, falhas: falhas.length }
  check(
    `contraste sobre os painéis (${onde}): todo o texto passa AA`,
    a.medidas > 0 && falhas.length === 0,
    piores[0] ? `pior ${piores[0].valor}:1 "${piores[0].texto}" sobre ${piores[0].fundo}${falhas.length ? `; falham ${falhas.slice(0, 3).map((f) => `"${f.texto}" ${f.valor}`).join(", ")}` : ""}` : "sem texto",
  )
}

async function novaPessoa(nome, viewport = LARGO, deviceScaleFactor = 1) {
  const ctx = await browser.newContext({
    locale: "pt-PT",
    viewport,
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

mkdirSync(CAPTURAS, { recursive: true })

/**
 * The WAV of the fake voice: the same synthetic voice from `e2e-audio.mjs`
 * (`packages/client-core/testes/audio-sintetico.ts`), 12 s in a loop, at -20 dBFS.
 */
const vozFalsa = join(dados, "voz.wav")
{
  const S = await import(pathToFileURL(join(RAIZ, "packages/client-core/testes/audio-sintetico.ts")).href)
  // −30 dBFS: normal speech from the halo calibration (`lib/medidorDeDb.ts`).
  const amostras = S.normalizar(S.voz(12), -30)
  const corpo = Buffer.alloc(amostras.length * 2)
  for (let i = 0; i < amostras.length; i++) corpo.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(amostras[i] * 32767))), i * 2)
  const cabecalho = Buffer.alloc(44)
  cabecalho.write("RIFF", 0)
  cabecalho.writeUInt32LE(36 + corpo.length, 4)
  cabecalho.write("WAVEfmt ", 8)
  cabecalho.writeUInt32LE(16, 16)
  cabecalho.writeUInt16LE(1, 20)
  cabecalho.writeUInt16LE(1, 22)
  cabecalho.writeUInt32LE(S.TAXA, 24)
  cabecalho.writeUInt32LE(S.TAXA * 2, 28)
  cabecalho.writeUInt16LE(2, 32)
  cabecalho.writeUInt16LE(16, 34)
  cabecalho.write("data", 36)
  cabecalho.writeUInt32LE(corpo.length, 40)
  writeFileSync(vozFalsa, Buffer.concat([cabecalho, corpo]))
}

try {
  browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      // A synthetic voice in place of the beep from the fake microphone: the beep is a
      // pure tone, and noise suppression on the Normal profile erases it. With it you
      // could not tell if the other person still hears us. See `vozFalsa`.
      `--use-file-for-fake-audio-capture=${vozFalsa}`,
      "--use-fake-ui-for-media-stream",
      "--auto-select-desktop-capture-source=Entire screen",
      "--autoplay-policy=no-user-gesture-required",
      // ORWELL_GPU=1: draw with the graphics card (Metal, on Mac). Without this
      // headless Chromium draws in software (SwiftShader), and fps measure the
      // processor, not what a person sees.
      ...(process.env.ORWELL_GPU ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : []),
    ],
  })

  // ---------------------------------------------------------------- the gate
  const vesna = await novaPessoa("Vesna")
  await vesna.page.goto(APP, { waitUntil: "domcontentloaded" })
  // Since phase 8.1, the gate can open with "Already using Orwell on another
  // device?" before the name (see `conta.mjs`). We wait for what comes next.
  await vesna.page
    .getByPlaceholder("Como queres aparecer")
    .or(vesna.page.getByRole("button", { name: "Não, criar conta" }))
    .first()
    .waitFor({ timeout: 60_000 })
  await vesna.page.evaluate(() => document.fonts.ready)
  await wait(300)
  await retratar(vesna.page, "portao")
  const fonte = await vesna.page.evaluate(() => ({
    familia: getComputedStyle(document.body).fontFamily,
    carregada: document.fonts.check('14px "Space Grotesk"'),
    fundo: getComputedStyle(document.documentElement).getPropertyValue("--fundo").trim(),
    // The skin background is in the `html`; the `body` stays transparent so the
    // dawn (`body::before`) shows through (see `fundo.css`).
    corpo: getComputedStyle(document.documentElement).backgroundColor,
  }))
  check("a fonte da pele é a Space Grotesk, servida pelo site", fonte.familia.startsWith('"Space Grotesk"') && fonte.carregada, fonte.familia)
  check("o fundo é o da pele", fonte.fundo === "#080c1a" && fonte.corpo === "rgb(8, 12, 26)", `${fonte.fundo} ${fonte.corpo}`)

  await criarConta(vesna.page, { nome: "Vesna", servidor: NOME })
  await dentro(vesna.page)
  check("a conta da Vesna abre", true)

  // ------------------------------------------------------------ the conversation
  // A new channel: born with "announcements", "conversation" and the voice room "voz".
  await vesna.page.getByRole("button", { name: "Criar canal" }).first().click()
  await vesna.page.locator("form.prompt input").first().fill("nexo")
  await vesna.page.locator("form.prompt button.primary").first().click()
  await vesna.page.getByRole("heading", { name: "nexo" }).waitFor({ timeout: 30_000 })
  const sala = (page, nome) => page.locator(`.room-tree .room-name:text-is("${nome}")`).first()
  await sala(vesna.page, "conversa").click()
  const caixa = () => vesna.page.locator(".chat-composer input:not([type=file])").first()
  await caixa().waitFor({ timeout: 60_000 })
  /*
    A normal conversation between friends, nothing about the app itself. Owner
    request on November 2, 2026: "I tested it with shared screen and it didn't
    crash" made the app look fragile in the website screenshot.
  */
  const dizer = async (frase) => {
    await caixa().fill(frase)
    await caixa().press("Enter")
    await vesna.page.getByText(frase).first().waitFor({ timeout: 30_000 })
  }
  await dizer("Onde está o Adam?")

  // Kaori joins via an invite link (the template in `e2e-convite-link.mjs`).
  await vesna.page.getByRole("button", { name: "Convidar…" }).first().click()
  await vesna.page.locator(".sheet").first().getByRole("button", { name: "Por link" }).click()
  const folha = vesna.page.locator(".sheet").first()
  await folha.getByRole("button", { name: "Criar link" }).click()
  const campo = folha.getByLabel("O teu link")
  await campo.waitFor({ timeout: 15_000 })
  const link = await campo.inputValue()
  await folha.getByRole("button", { name: "Fechar" }).click()

  // Kaori appears at 2x: that confirms the ring on a high-density screen.
  const kaori = await novaPessoa("Kaori", LARGO, 2)
  await kaori.page.goto(link, { waitUntil: "domcontentloaded" })
  await criarConta(kaori.page, { nome: "Kaori", servidor: NOME })
  await dentro(kaori.page)
  await kaori.page.getByRole("heading", { name: "Convite para um canal" }).waitFor({ timeout: 60_000 })
  await kaori.page.getByRole("button", { name: "Entrar", exact: true }).click()
  await kaori.page.getByRole("heading", { name: "nexo" }).waitFor({ timeout: 60_000 })
  await sala(kaori.page, "conversa").click()
  const kcaixa = kaori.page.locator(".chat-composer input:not([type=file])").first()
  await kcaixa.fill("Disse que chegava em 5.")
  await kcaixa.press("Enter")
  await vesna.page.getByText("Disse que chegava em 5.").first().waitFor({ timeout: 60_000 })
  await dizer("Ok, esperamos por ele.")
  // "Kaori is typing..." stays for a few seconds after she sends: the website
  // screenshot waits for it to fade.
  await vesna.page.locator(".timeline-typing").waitFor({ state: "detached", timeout: 30_000 }).catch(() => {})
  await wait(500)
  await retratar(vesna.page, "conversa")
  check("sem rolagem horizontal na conversa larga", await semRolagemHorizontal(vesna.page))
  const balao = await vesna.page.evaluate(() => {
    const corpo = document.querySelector(".message .message-body")
    return corpo ? getComputedStyle(corpo).borderTopLeftRadius : null
  })
  check("as mensagens são balões", balao === "4px", String(balao))
  {
    const problemas = await verificarPaineis(vesna.page, [".rail", ".sidebar", ".topbar", ".members", ".chat-composer .composer-line"])
    check("painéis em tinta quase sólida, sem desfoque, sobre a aurora (carril, barra lateral, cabeçalho, membros, barra de escrita)", problemas.length === 0, problemas.join("; "))
    const balao = await vesna.page.evaluate(() => {
      const b = document.querySelector(".message .message-body")
      return b ? getComputedStyle(b).backdropFilter : "?"
    })
    check("os balões não desfocam", balao === "none", balao)
  }
  await contraste(vesna.page, "conversa", ".message-body, .sidebar, .members, .topbar, .chat-composer")
  await fps(vesna.page, "conversa 1280")
  await fpsCom(vesna.page, "conversa 1280, aurora parada", SEM_AURORA_A_ANDAR)
  medidas.gpu = await vesna.page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl")
    const info = gl?.getExtension("WEBGL_debug_renderer_info")
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "sem WebGL"
  })
  console.log(`  ..  o Chromium desenha com: ${medidas.gpu}`)

  // ------------------------------------------------------- the Invite sheet
  // Three modes, at 1280: by address (the default), by link, and add now.
  await vesna.page.getByRole("button", { name: "Convidar…" }).first().click()
  const convidar = vesna.page.locator(".sheet.convidar").first()
  await convidar.waitFor({ timeout: 15_000 })
  await wait(300)
  await retratar(vesna.page, "convidar")
  await convidar.getByRole("button", { name: "Por link" }).click()
  await wait(600)
  await retratar(vesna.page, "convidar-link")
  await convidar.getByRole("button", { name: "Adicionar já" }).click().catch(() => {})
  await wait(300)
  await retratar(vesna.page, "convidar-meter")
  await vesna.page.keyboard.press("Escape")
  await wait(300)

  // Each at 1280, and in each one the same measure: nothing scrolls horizontally,
  // and no pair of stacked blocks stick together (less than 4 px between them),
  // which is how "decomposed" looks when a skin rule eats the `gap`.
  const medirFolha = (page) =>
    page.evaluate(() => {
      const caixa = document.querySelector(".overlay .sheet, .overlay .prompt, .context-menu")
      if (!caixa) return { ok: false, detalhe: "sem folha" }
      const colados = []
      const visiveis = (el) => [...el.children].filter((c) => {
        const r = c.getBoundingClientRect()
        return r.height > 0 && r.width > 0 && getComputedStyle(c).position !== "absolute"
      })
      // Direct children of the sheet (header, body, footer) touch on purpose: their
      // spacing is each one's `padding`.
      for (const el of caixa.querySelectorAll("*")) {
        const estilo = getComputedStyle(el)
        const empilha =
          estilo.display === "block" || (estilo.display === "flex" && estilo.flexDirection === "column")
        if (!empilha || el.matches(".field, label, button, li, .context-menu, .context-menu *")) continue
        const filhos = visiveis(el).filter((c) => !["inline", "inline-block", "inline-flex"].includes(getComputedStyle(c).display))
        for (let i = 1; i < filhos.length; i++) {
          const antes = filhos[i - 1].getBoundingClientRect()
          const depois = filhos[i].getBoundingClientRect()
          const folga = depois.top - antes.bottom
          // Two lines of text from the same block (name and subtitle) touch.
          if (filhos[i - 1].tagName === "SPAN" && filhos[i].tagName === "SPAN") continue
          if (folga > -1 && folga < 4) colados.push(`${filhos[i - 1].className || filhos[i - 1].tagName}→${filhos[i].className || filhos[i].tagName} (${folga.toFixed(1)} px)`)
        }
      }
      // A scroll is a box with content wider than itself that lets you scroll.
      // Those that cut with ellipsis (`text-overflow`) cut on purpose.
      const rola = [caixa, ...caixa.querySelectorAll("*")].find((el) => {
        const estilo = getComputedStyle(el)
        return (
          el.scrollWidth > el.clientWidth + 1 &&
          ["auto", "scroll"].includes(estilo.overflowX) &&
          !el.matches("input, textarea, select")
        )
      })
      return {
        ok: colados.length === 0 && !rola,
        detalhe: [...colados.slice(0, 4), rola ? `rola na horizontal: ${rola.className || rola.tagName} ${rola.scrollWidth}/${rola.clientWidth}` : ""].filter(Boolean).join(" · "),
      }
    })
  // At 390 px (see end of script) we also measure the keyboard: with the field
  // focused, the window shrinks 300 px, like on Android (`resizes-content`), and
  // the field must stay in view.
  let aTelemovel = false
  const retratarFolha = async (nome, abrir, fechar = () => vesna.page.keyboard.press("Escape")) => {
    const sufixo = aTelemovel ? "-390" : ""
    try {
      await abrir()
      await wait(450)
      // Those in Invite are named by the sheet name; the others, `folha-<name>`.
      await retratar(vesna.page, `${nome.startsWith("convidar") ? "" : "folha-"}${nome}${sufixo}`)
      const medida = await medirFolha(vesna.page)
      check(`a folha "${nome}" está composta${aTelemovel ? " a 390 px" : ""}`, medida.ok, medida.detalhe)
      if (aTelemovel) {
        check(`e "${nome}" não rola na horizontal a 390 px`, await semRolagemHorizontal(vesna.page))
        const campo = vesna.page.locator(".overlay input:not([type=file]):not([type=radio]):not([type=checkbox]), .overlay textarea").first()
        if ((await campo.count()) > 0) {
          await campo.focus()
          await vesna.page.setViewportSize({ width: TELEMOVEL.width, height: TELEMOVEL.height - 300 })
          await wait(350)
          const caixa = await campo.boundingBox()
          await vesna.page.setViewportSize(TELEMOVEL)
          check(
            `e com o teclado aberto o campo de "${nome}" fica à vista`,
            caixa !== null && caixa.y >= 0 && caixa.y + caixa.height <= TELEMOVEL.height - 300,
            caixa ? `${Math.round(caixa.y)}–${Math.round(caixa.y + caixa.height)} em ${TELEMOVEL.height - 300}` : "sem caixa",
          )
        }
      }
    } catch (erro) {
      check(`a folha "${nome}" abre`, false, String(erro.message).split("\n")[0])
    }
    await fechar()
    await wait(300)
  }
  const canalNaBarra = () => vesna.page.locator(".sidebar").getByText("nexo", { exact: true }).first()
  const menuDoCanal = async (item) => {
    await canalNaBarra().click({ button: "right" })
    if (item) await vesna.page.getByRole("menuitem", { name: item }).click()
  }
  await retratarFolha("convidar-link", async () => {
    await vesna.page.getByRole("button", { name: "Convidar…" }).first().click()
    await vesna.page.locator(".sheet.convidar").getByRole("button", { name: "Por link" }).click()
  })
  await retratarFolha("menu-canal", () => menuDoCanal(null))
  await retratarFolha("nova-sala", () => menuDoCanal("Nova sala"))
  await retratarFolha("propriedades", () => menuDoCanal("Propriedades"))
  await retratarFolha("papeis", async () => {
    await menuDoCanal("Propriedades")
    await wait(300)
    await vesna.page.locator(".overlay .sheet-body").first().evaluate((corpo) => corpo.scrollTo(0, corpo.scrollHeight))
  })
  await retratarFolha(
    "nova-categoria",
    () => menuDoCanal("Nova categoria"),
    async () => {
      // Create it for real: it's the category the next sheet opens.
      await vesna.page.locator(".overlay input").first().fill("Arquivo")
      await vesna.page.keyboard.press("Enter")
    },
  )
  await retratarFolha("categoria", async () => {
    await vesna.page.locator(".sidebar").getByText("Arquivo", { exact: false }).first().click({ button: "right" })
    await vesna.page.getByRole("menuitem", { name: "Quem vê esta categoria" }).click()
  })

  // Delete the empty category (bug in 0.8.0: the gesture did nothing). Gone from
  // Vesna's and Kaori's side bars.
  await vesna.page.locator(".sidebar .category-name", { hasText: "Arquivo" }).first().click({ button: "right" })
  await vesna.page.getByRole("menuitem", { name: "Apagar categoria" }).click()
  const semArquivo = (page) =>
    page
      .waitForFunction(() => ![...document.querySelectorAll(".sidebar .category-name")].some((c) => /arquivo/i.test(c.textContent ?? "")), null, {
        timeout: 20_000,
      })
      .then(() => true)
      .catch(() => false)
  check("apagar a categoria vazia tira-a da barra lateral", await semArquivo(vesna.page))
  check("e da barra lateral da Kaori", await semArquivo(kaori.page))
  await retratarFolha(
    "confirmar",
    () => menuDoCanal("Sair do canal"),
    () => vesna.page.locator(".overlay").getByRole("button", { name: "Cancelar" }).first().click(),
  )
  await retratarFolha("menu-mensagem", async () => {
    const mensagem = vesna.page.locator(".message", { hasText: "Onde está o Adam?" }).first()
    await mensagem.hover()
    await mensagem.getByRole("button", { name: "Mais acções nesta mensagem" }).click({ force: true, timeout: 10_000 })
  })
  await retratarFolha("perfil-editar", async () => {
    await vesna.page.getByRole("button", { name: "Eu", exact: true }).first().click()
    await vesna.page.getByRole("button", { name: "Editar perfil" }).first().click()
  })
  await retratarFolha("aparelho", async () => {
    await vesna.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
    await vesna.page.getByRole("button", { name: "Aparelhos", exact: true }).first().click()
    await vesna.page.getByRole("button", { name: "Acrescentar aparelho" }).first().click()
  })
  await vesna.page.getByRole("button", { name: "Comunidades" }).first().click()
  await sala(vesna.page, "conversa").click()
  await wait(300)

  // ----------------------------------------------------------- a chamada
  await sala(vesna.page, "voz").click()
  await vesna.page.locator("section.call.call-sala").waitFor({ timeout: 30_000 })
  await sala(kaori.page, "voz").click()
  await kaori.page.locator("section.call.call-sala").waitFor({ timeout: 30_000 })
  const doisCartoes = async (page) =>
    page
      .waitForFunction(() => document.querySelectorAll("section.call .call-people .call-person").length >= 2, null, {
        timeout: 60_000,
      })
      .then(() => true)
      .catch(() => false)
  check("a Vesna vê dois cartões no mosaico", await doisCartoes(vesna.page))
  check("a Kaori vê dois cartões no mosaico", await doisCartoes(kaori.page))
  const barra = vesna.page.getByRole("toolbar", { name: "Controlo da chamada" })
  check("a barra de controlo tem nome", await barra.isVisible())
  const premidos = await barra.locator("button[aria-pressed]").count()
  check("os botões da barra dizem o estado por aria-pressed", premidos >= 3, `${premidos}`)
  check("a sala de voz esconde a conversa e a barra de escrita", !(await vesna.page.locator(".main .chat-composer").isVisible()))
  await wait(1500)
  await retratar(vesna.page, "chamada-voz")
  await fps(vesna.page, "chamada 1280")
  await fpsCom(vesna.page, "chamada 1280, aurora parada", SEM_AURORA_A_ANDAR)

  // The halo and ring around the avatar (board A3, "Halo"): a halo layer that
  // only changes opacity and scale, and a 1 px ring in SVG. No double-level
  // shadow on the avatar, which was what pixelated.
  const anel = await vesna.page.evaluate(() => {
    const cartao = document.querySelector("section.call .call-people .call-chip")
    const avatar = cartao?.querySelector(".message-avatar")
    const halo = cartao?.querySelector(".halo-de-voz")
    const estilo = halo ? getComputedStyle(halo) : null
    return {
      halos: cartao?.querySelectorAll(".halo-de-voz").length ?? 0,
      aneis: cartao?.querySelectorAll(".anel-de-voz circle").length ?? 0,
      sombra: avatar ? getComputedStyle(avatar).boxShadow : "?",
      camada: estilo?.willChange ?? "?",
      forca: cartao ? getComputedStyle(cartao).getPropertyValue("--voz").trim() : "",
      opacidade: estilo?.opacity ?? "?",
    }
  })
  check("o avatar tem um halo e o anel de 1 px (repouso e fala)", anel.halos === 1 && anel.aneis === 2, `${anel.halos} · ${anel.aneis}`)
  check("o avatar já não tem sombra em anel", anel.sombra === "none", anel.sombra)
  check("o halo é uma camada própria (opacidade e escala)", anel.camada === "opacity, transform", anel.camada)
  check(
    "o halo lê a força medida",
    anel.forca !== "" && Math.abs(Number(anel.opacidade) - Number(anel.forca)) < 0.15,
    `--voz ${anel.forca} · opacidade ${anel.opacidade}`,
  )

  // The clip is the ring's, with margin, so the halo fits.
  const recorteDoAnel = async (page) => {
    const caixa = await page.locator("section.call .call-people .anel-de-voz").first().boundingBox()
    const folga = 36
    return { x: caixa.x - folga, y: caixa.y - folga, width: caixa.width + 2 * folga, height: caixa.height + 2 * folga }
  }
  const anelDe = async (page, ficheiro) => page.screenshot({ path: join(CAPTURAS, ficheiro), clip: await recorteDoAnel(page) })
  await anelDe(vesna.page, "midnight-anel-1x.png")
  const png2x = await anelDe(kaori.page, "midnight-anel-2x.png")
  console.log(`  ..  captura: ${join(CAPTURAS, "midnight-anel-1x.png")} e -2x`)

  // The smooth edge, measured in the 2x screenshot. For each angle, the stroke
  // center of the ring is the centroid of the extra light in the band around the
  // radius, accurate below the pixel. A smoothed stroke has that center at the
  // same distance at every angle; a fringe at the steps (from the old ring) does not.
  const borda = await kaori.page.evaluate(async (base64) => {
    const imagem = new Image()
    imagem.src = `data:image/png;base64,${base64}`
    await imagem.decode()
    const tela = document.createElement("canvas")
    tela.width = imagem.width
    tela.height = imagem.height
    const ctx = tela.getContext("2d")
    ctx.drawImage(imagem, 0, 0)
    const { data } = ctx.getImageData(0, 0, tela.width, tela.height)
    const luz = (x, y) => {
      const i = (Math.round(y) * tela.width + Math.round(x)) * 4
      return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    }
    const cx = tela.width / 2
    const cy = tela.height / 2
    const escala = window.devicePixelRatio
    const raio = 128 * 0.453 * escala
    const pontos = []
    for (let grau = 0; grau < 360; grau += 2) {
      // The presence dot sits bottom right, on top of the ring.
      if (grau >= 15 && grau <= 75) continue
      const a = (grau * Math.PI) / 180
      const amostras = []
      for (let d = raio - 4 * escala; d <= raio + 4 * escala; d += 0.25) amostras.push([d, luz(cx + Math.cos(a) * d, cy + Math.sin(a) * d)])
      const fundo = Math.min(...amostras.map(([, l]) => l))
      let peso = 0
      let soma = 0
      for (const [d, l] of amostras) {
        peso += l - fundo
        soma += (l - fundo) * d
      }
      if (peso > 0) {
        const d = soma / peso
        pontos.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d])
      }
    }
    // Center and radius from the circle that best fits the points (Kåsa, by least
    // squares): the clip rounds to the pixel, and a center half a pixel to the side
    // looked pixelated.
    let [sx, sy, sxx, syy, sxy, sxz, syz, sz] = [0, 0, 0, 0, 0, 0, 0, 0]
    for (const [x, y] of pontos) {
      const z = x * x + y * y
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z
    }
    const n = pontos.length
    const resolver = (m, v) => {
      const det = (a) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
      const d = det(m)
      return [0, 1, 2].map((coluna) => det(m.map((linha, i) => linha.map((valor, j) => (j === coluna ? v[i] : valor)))) / d)
    }
    const [A, B, C] = resolver([[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], [sxz, syz, sz])
    const ox = A / 2
    const oy = B / 2
    const media = Math.sqrt(C + ox * ox + oy * oy)
    const raios = pontos.map(([x, y]) => Math.hypot(x - ox, y - oy))
    const desvio = Math.sqrt(raios.reduce((a, b) => a + (b - media) ** 2, 0) / raios.length)
    return { angulos: raios.length, media, desvio, escala }
  }, png2x.toString("base64"))
  check(
    "a 2×, o anel tem a borda lisa: o traço está à mesma distância em todos os ângulos",
    borda.escala === 2 && borda.angulos > 140 && borda.desvio < 0.25,
    `${borda.angulos} ângulos, raio ${borda.media.toFixed(2)} px, desvio ${borda.desvio.toFixed(2)} px a ${borda.escala}×`,
  )

  // The halo for real, with fake voice at -30 dBFS: Kaori's own card (measured
  // before the gate, by the chain) caught mid-sentence.
  const aFalar = await kaori.page
    .waitForFunction(
      () => Number(getComputedStyle(document.querySelector("section.call .call-people .call-chip")).getPropertyValue("--voz")) >= 0.3,
      null,
      { timeout: 20_000, polling: 50 },
    )
    .then(() => true)
    .catch(() => false)
  const vozDoHalo = await kaori.page.evaluate(() =>
    getComputedStyle(document.querySelector("section.call .call-people .call-chip")).getPropertyValue("--voz").trim(),
  )
  check("a fala a −30 dBFS acende o halo a meio, e não quase apagado", aFalar, `--voz ${vozDoHalo}`)
  await kaori.page.screenshot({ path: join(CAPTURAS, "midnight-halo-2x.png"), clip: await recorteDoAnel(kaori.page) })
  console.log(`  ..  captura: ${join(CAPTURAS, "midnight-halo-2x.png")} (fala a −30 dBFS, --voz ${vozDoHalo})`)

  // The shared screen: Kaori shares, Vesna chooses to watch.
  await kaori.page.locator('.call-controls [data-ecra="1"]').click()
  // Since the "A with C" card (November 2, 2026), the offer is the "View the
  // broadcast" button above the card, only shown on hover: we expect it to exist,
  // and the click is forced.
  const ver = vesna.page.getByRole("button", { name: /^Ver a transmissão de Kaori$/ })
  const ofereceu = await ver
    .waitFor({ state: "attached", timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
  check("a oferta do ecrã chega à Vesna", ofereceu)
  if (ofereceu) {
    await ver.click({ force: true })
    const emFoco = await vesna.page
      .locator(".call-corpo.com-foco .call-palco video")
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false)
    check("o ecrã vai para o foco, com os cartões em fila por cima", emFoco)
    if (!emFoco) {
      await retratar(vesna.page, "debug-ecra-vesna")
      await retratar(kaori.page, "debug-ecra-kaori")
    }
    check("e há por onde parar de ver", await vesna.page.getByRole("button", { name: /^Parar de ver o ecrã de Kaori$/ }).isVisible())
    await wait(2500)
    await retratar(vesna.page, "chamada-ecra")
    const contagem = await kaori.page.locator(".call-espectadores").innerText().catch(() => "")
    check("a Kaori vê quantos estão a ver", /1 a ver/.test(contagem), contagem)
  }

  // "View stage only" and Esc.
  const soPalco = vesna.page.getByRole("button", { name: "Ver só o palco" })
  await soPalco.click()
  check('"Ver só o palco" esconde as barras', (await vesna.page.locator(".app.so-palco").count()) === 1)
  check("e fica premido", (await soPalco.getAttribute("aria-pressed")) === "true")
  await vesna.page.keyboard.press("Escape")
  check("Esc sai do palco", (await vesna.page.locator(".app.so-palco").count()) === 0)

  // Kaori can be in another view (the person's page, below): we tell by the count
  // on her call card, which exists in any view.
  const kaoriVeDuas = () =>
    kaori.page
      .waitForFunction(
        () =>
          document.querySelectorAll("section.call .call-people .call-person").length >= 2 ||
          [...document.querySelectorAll(".call-dock-where, .call-dock-count")].some((c) => /\b2 pessoas\b/.test(c.textContent ?? "")),
        null,
        { timeout: 20_000 },
      )
      .then(() => true)
      .catch(() => false)

  // Bug in 0.8.0: "when users navigate to settings, the call disappears". From
  // the call view straight to Settings, and measure what the person loses: the
  // "Connected" card, the incoming sound, and the call on Kaori's side (who keeps
  // seeing Vesna in there).
  await vesna.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await vesna.page.getByRole("button", { name: "Microfone e câmara", exact: true }).first().click()
  await wait(1500)
  const nasConfig = await vesna.page.evaluate(() => {
    const cartao = document.querySelector(".sidebar .call-dock.lateral")
    const caixas = [...document.querySelectorAll("video, audio")].filter((m) => m.srcObject && m.srcObject.getAudioTracks().length > 0)
    return {
      cartao: cartao !== null && cartao.getBoundingClientRect().height > 0,
      caixas: caixas.length,
      aTocar: caixas.filter((m) => !m.paused && !m.muted).length,
    }
  })
  check('nas Configurações, o cartão "Ligado" está na barra lateral', nasConfig.cartao)
  check("e o som continua a chegar (há quem o toque)", nasConfig.aTocar >= 1, `${nasConfig.aTocar} a tocar de ${nasConfig.caixas}`)
  check("e a Kaori continua a ver a Vesna na chamada", await kaoriVeDuas())
  await retratar(vesna.page, "voz-com-chamada")
  await vesna.page.locator(".sidebar .call-dock.lateral .call-dock-back").click()
  const voltou = await vesna.page
    .locator("section.call.call-sala")
    .waitFor({ timeout: 15_000 })
    .then(() => true)
    .catch(() => false)
  check("e o cartão volta à vista da chamada", voltou)

  // The live call in another room: the side card.
  await sala(vesna.page, "conversa").click()
  const lateral = vesna.page.locator(".sidebar .call-dock.lateral")
  check("noutra sala, a chamada fica no cartão da barra lateral", await lateral.isVisible())
  check("e não há doca a flutuar", (await vesna.page.locator(".call-dock:not(.lateral)").count()) === 0)
  check("o cartão toca o som (as caixas estão nele)", (await lateral.locator(".call-dock-audio video").count()) >= 2)
  await wait(800)
  await retratar(vesna.page, "chamada-lateral")

  // The card reads in full: "Connected" on top, and the room, channel and count on
  // the bottom line, smaller. Each text must fit in the box, no clipping. In
  // English with a long name, test by putting the sentence in the same element,
  // same font, same width.
  const cabe = (seletor, frase) =>
    lateral.evaluate(
      (cartao, [seletor, frase]) => {
        const texto = cartao.querySelector(seletor)
        const botao = cartao.querySelector(".call-dock-back")
        if (!texto || !botao) return { ok: false, detalhe: "sem elemento" }
        const antes = texto.textContent
        if (frase) texto.textContent = frase
        const caixa = texto.getBoundingClientRect()
        const limite = botao.getBoundingClientRect()
        const ok =
          caixa.right <= limite.right + 0.5 &&
          texto.scrollWidth <= texto.clientWidth + 0.5 &&
          [...cartao.querySelectorAll(".call-dock-state, .call-dock-where")].every((l) => l.scrollWidth <= l.clientWidth + 0.5)
        const detalhe = `${texto.textContent}: ${Math.round(caixa.width)} px em ${Math.round(limite.width)} px, ${Math.round(caixa.height)} px de alto`
        texto.textContent = antes
        return { ok, detalhe }
      },
      [seletor, frase],
    )
  const estado = ".call-dock-state .call-dock-texto"
  const pt = await cabe(estado, null)
  check("o estado do cartão lateral lê-se inteiro em português", pt.ok, pt.detalhe)
  const en = await cabe(estado, "Connected")
  check('e em inglês ("Connected")', en.ok, en.detalhe)
  /*
    The bottom line became just the location, "Channel · Room", in an `Andante`:
    when it doesn't fit, it scrolls instead of breaking. With a long name, test
    that the box doesn't widen the card or go over the button (the ribbon scrolls).
  */
  const onde = (frase) =>
    lateral.evaluate((cartao, frase) => {
      const caixa = cartao.querySelector(".call-dock-where")
      const texto = caixa?.querySelector(".andante-fita > span")
      const botao = cartao.querySelector(".call-dock-back")
      if (!caixa || !texto || !botao) return { ok: false, detalhe: "sem elemento", texto: "" }
      const antes = texto.textContent
      const largura = cartao.getBoundingClientRect().width
      if (frase) texto.textContent = frase
      const c = caixa.getBoundingClientRect()
      const b = botao.getBoundingClientRect()
      const ok =
        c.right <= b.right + 0.5 &&
        Math.abs(cartao.getBoundingClientRect().width - largura) < 0.5 &&
        (frase ? true : texto.scrollWidth <= caixa.clientWidth + 1)
      const detalhe = `${texto.textContent}: ${Math.round(texto.scrollWidth)} px numa caixa de ${Math.round(caixa.clientWidth)} px`
      texto.textContent = antes
      return { ok, detalhe, texto: antes }
    }, frase)
  const baixo = await onde(null)
  check('a linha de baixo é o sítio, "Canal · Sala"', baixo.texto === "nexo · voz", baixo.texto)
  check("e lê-se inteira", baixo.ok, baixo.detalhe)
  const longo = await onde("nexo · sala de voz do fundo do corredor")
  check("e com um nome de sala comprido, a caixa não alarga o cartão (a fita anda)", longo.ok, longo.detalhe)

  // ------------------------------------------------- Settings › Voice
  await vesna.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await vesna.page.getByRole("button", { name: "Microfone e câmara", exact: true }).first().click()
  const perfis = vesna.page.getByRole("radiogroup", { name: "Redução de ruído" })
  check("Configurações › Voz mostra os quatro perfis", (await perfis.getByRole("radio").count()) === 4)
  await wait(1200)
  await retratar(vesna.page, "voz")

  // ------------------- Settings › Voice and Microphone with live call
  // Owner report: "you drop the call when you go to settings, or you stop hearing
  // others". At each step, measure on both sides the sound coming through the call
  // boxes: the first box is ours (muted on purpose), the others are from other
  // people. The level is measured on a clone of the strip, with an audio context
  // just for this script, during 400 ms.
  const ouvido = (page) =>
    page.evaluate(async () => {
      const caixas = [...document.querySelectorAll(".call-video video, .call-dock-audio video")]
      const lista = caixas.filter((c) => c.srcObject && c.srcObject.getAudioTracks().length > 0)
      const remotasComSom = lista.filter((c) => {
        const irmas = [...(c.closest(".call-video, .call-dock-audio")?.querySelectorAll("video") ?? [])]
        return irmas.indexOf(c) > 0
      })
      const contexto = new AudioContext()
      const medir = async (faixa) => {
        const clone = faixa.clone()
        const fonte = contexto.createMediaStreamSource(new MediaStream([clone]))
        const analisador = contexto.createAnalyser()
        analisador.fftSize = 2048
        fonte.connect(analisador)
        const amostras = new Float32Array(analisador.fftSize)
        let maximo = 0
        // 2.4 s: the fake voice speaks 1.2 s per 2 s, and the window catches a sentence.
        for (let i = 0; i < 48; i++) {
          await new Promise((r) => setTimeout(r, 50))
          analisador.getFloatTimeDomainData(amostras)
          let soma = 0
          for (const v of amostras) soma += v * v
          maximo = Math.max(maximo, Math.sqrt(soma / amostras.length))
        }
        fonte.disconnect()
        clone.stop()
        return maximo
      }
      const remotas2 = []
      for (const caixa of remotasComSom) {
        const faixa = caixa.srcObject.getAudioTracks()[0]
        remotas2.push({
          rms: await medir(faixa),
          estado: faixa.readyState,
          paused: caixa.paused,
          muted: caixa.muted,
          volume: caixa.volume,
        })
      }
      const local = lista.find((c) => !remotasComSom.includes(c))
      const faixaLocal = local?.srcObject.getAudioTracks()[0]
      void contexto.close()
      return {
        remotas: remotas2,
        ouve: remotas2.some((r) => r.rms > 0.01 && r.estado === "live" && !r.paused && !r.muted && r.volume > 0),
        micro: faixaLocal ? faixaLocal.readyState : "sem faixa",
      }
    })
  const passoDeAudio = async (nome, { podeCalar = false } = {}) => {
    await wait(900)
    const daVesna = await ouvido(vesna.page)
    const daKaori = await ouvido(kaori.page)
    const resumo = (o) => o.remotas.map((r) => `${r.rms.toFixed(3)}${r.paused ? " pausa" : ""}${r.muted ? " muda" : ""}`).join(",")
    if (!podeCalar) check(`${nome}: a Vesna continua a ouvir a Kaori`, daVesna.ouve, resumo(daVesna))
    check(`${nome}: a faixa do microfone da Vesna continua viva`, daVesna.micro === "live", daVesna.micro)
    check(`${nome}: a Kaori continua a ouvir a Vesna`, daKaori.ouve, resumo(daKaori))
  }
  await passoDeAudio("Configurações › Voz com a chamada viva: os outros continuam a tocar")
  check("e Voz diz que o teste usa o microfone da chamada", await vesna.page.getByText("Estás numa chamada. O teste usa o mesmo microfone.").first().isVisible())
  await perfis.getByRole("radio", { name: /Leve/ }).check()
  await passoDeAudio("Voz, perfil Leve")
  await perfis.getByRole("radio", { name: /Normal/ }).check()
  await passoDeAudio("Voz, de volta ao Normal")
  const ouvirMe = vesna.page.getByRole("button", { name: "Ouvir-me" })
  await ouvirMe.click()
  await passoDeAudio('Voz, "Ouvir-me" ligado', { podeCalar: true })
  await ouvirMe.click()
  await passoDeAudio('Voz, "Ouvir-me" desligado')
  await vesna.page.getByRole("button", { name: "Microfone e câmara", exact: true }).first().click()
  await passoDeAudio("Configurações › Microfone e câmara")
  check("e Microfone diz que o teste usa o microfone da chamada", await vesna.page.getByText("Estás numa chamada. O teste usa o mesmo microfone.").first().isVisible())
  await retratar(vesna.page, "microfone-com-chamada")
  await vesna.page.getByRole("button", { name: "Comunidades" }).first().click()
  await passoDeAudio("de volta às Comunidades")
  await vesna.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await vesna.page.getByRole("button", { name: "Microfone e câmara", exact: true }).first().click()

  // The other destinations, just to look (ORWELL_TODAS=1): profile, feed, friends,
  // settings (Appearance came out in 0.9: Account stays, opens first). Not checked:
  // they are the applied skin, and their scripts measure them.
  if (process.env.ORWELL_TODAS) {
    for (const [botao, nome] of [["Eu", "perfil"], ["Feed", "feed"], ["Amigos", "amigos"]]) {
      await vesna.page.getByRole("button", { name: botao, exact: true }).first().click()
      await wait(800)
      await retratar(vesna.page, nome)
    }
    await vesna.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
    await vesna.page.getByRole("button", { name: "Conta", exact: true }).first().click()
    await wait(500)
    await retratar(vesna.page, "configuracoes")
  }

  // ------------------------------------------------- the person page
  // Vesna opens Kaori's page by name in a message. Requests friendship, Kaori
  // accepts and publishes, and the page gains a wall.
  await vesna.page.getByRole("button", { name: "Comunidades", exact: true }).first().click()
  await sala(vesna.page, "conversa").click()
  const nomeDaKaori = vesna.page.locator(".message .author-botao", { hasText: "Kaori" }).first()
  await nomeDaKaori.waitFor({ timeout: 30_000 })
  const abrirKaori = async () => {
    await nomeDaKaori.click()
    await pessoa.waitFor({ timeout: 15_000 })
  }
  const pessoa = vesna.page.locator("main.pagina-da-pessoa")
  await abrirKaori()
  check("o nome numa mensagem abre a página da pessoa, na área principal", await pessoa.isVisible())
  check("a página não é um diálogo", (await vesna.page.getByRole("dialog").count()) === 0)
  const titulo = await pessoa.evaluate((pagina) => {
    const h1 = pagina.querySelector("h1")
    return { texto: h1?.textContent, foco: document.activeElement === h1 }
  })
  check("o nome é o <h1>, e o foco vai para ele", titulo.texto === "Kaori" && titulo.foco, JSON.stringify(titulo))
  check("três separadores numa lista de separadores", (await pessoa.getByRole("tablist").getByRole("tab").count()) === 3)
  // The ink is on the surface itself (`paineis.css`), nothing blurs.
  const pele = await pessoa.evaluate((pagina) => {
    const camada = (sel) => {
      const c = getComputedStyle(pagina.querySelector(sel))
      return `${c.backgroundColor} ${c.backdropFilter === "none" ? "sem desfoque" : "desfocada"}`
    }
    return {
      topo: camada(".pessoa-topo"),
      cabeca: camada(".pessoa-cabeca"),
      accoes: camada(".pessoa-accoes"),
      primario: getComputedStyle(pagina.querySelector(".pessoa-accoes .primary")).backgroundImage,
    }
  })
  check(
    "cabeçalho e cabeça na tinta dos painéis, acções em poço, sem desfoque, primário em degradé",
    pele.topo === "rgba(12, 17, 35, 0.9) sem desfoque" &&
      pele.cabeca === "rgba(12, 17, 35, 0.9) sem desfoque" &&
      pele.accoes === "rgba(6, 9, 20, 0.92) sem desfoque" &&
      pele.primario.startsWith("linear-gradient"),
    JSON.stringify(pele),
  )

  await pessoa.getByRole("button", { name: "Pedir amizade" }).click()
  await pessoa.getByRole("status").filter({ hasText: "Pedido enviado" }).waitFor({ timeout: 30_000 })
  await kaori.page.getByRole("button", { name: "Amigos", exact: true }).first().click()
  await kaori.page.locator(".people-tabs").getByRole("button", { name: "Recebidos" }).click()
  const aceitar = kaori.page.getByRole("button", { name: "Aceitar" }).first()
  check("o pedido chega à Kaori", await aceitar.waitFor({ timeout: 60_000 }).then(() => true, () => false))
  await aceitar.click()
  /*
    Kaori publishes right after accepting, without waiting for anything from
    Vesna's side: feed delivery doesn't need it (`apps/server/src/feed-amizade-nova.test.ts`
    proves the five orders). Until 26/10/2026 there was a 5 s delay here and a
    "Request posts" call at 45 s, for a failure in 2 out of 8 runs from this
    script: the wait for the text caught the text box itself (React puts the
    `<textarea>` text in the DOM), didn't wait for the post, and the next title
    was written while the last one was still going out. The composer clears the
    draft when the post finishes, and took that title. The second post went out
    without a title, and the wall never showed "Neon and Glass". Now we wait for
    the post in the feed, for the title, outside the composer.
  */
  await kaori.page.getByRole("button", { name: "Feed", exact: true }).first().click()
  for (const [tituloDaPublicacao, texto] of [
    ["Chuva em Shibuya", "Ainda a pôr as fotos da viagem em ordem. Amanhã há mais."],
    ["Néon e vidro", "Quem joga hoje à noite? Começamos às 21h."],
  ]) {
    await kaori.page.getByPlaceholder("Título (opcional)").fill(tituloDaPublicacao)
    await kaori.page.getByPlaceholder(/Escreve uma publicação/).fill(texto)
    await kaori.page.getByRole("button", { name: "Publicar" }).click()
    await kaori.page.locator("article.post", { hasText: tituloDaPublicacao }).filter({ hasText: texto }).first().waitFor({ timeout: 30_000 })
    // And the composer is now clear: the next title can't be written before that.
    await kaori.page.waitForFunction(() => document.querySelector(".post-title-input")?.value === "", null, { timeout: 30_000 })
  }
  const mural = pessoa.getByRole("button", { name: /Néon e vidro/ })
  const chegou = await mural.waitFor({ timeout: 30_000 }).then(() => true, () => false)
  check("as publicações da Kaori chegam ao mural da página", chegou)
  check(
    'a amizade vê-se no botão "Amigos" da página',
    await pessoa.getByRole("button", { name: "Amigos", exact: true }).waitFor({ timeout: 30_000 }).then(() => true, () => false),
  )
  await pessoa.getByRole("tab", { name: /Em comum/ }).click()
  check('"Em comum" mostra o canal nexo', await pessoa.getByRole("list", { name: /Canais em comum/ }).getByText("nexo").isVisible())
  await pessoa.getByRole("tab", { name: /Publicações/ }).click()
  await vesna.page.evaluate(() => document.fonts.ready)
  await wait(800)
  await retratar(vesna.page, "pessoa")
  {
    const problemas = await verificarPaineis(vesna.page, [".pessoa-cabeca", ".pessoa-accoes", ".post-row"])
    check("painéis em tinta quase sólida, sem desfoque, sobre a aurora (página da pessoa)", problemas.length === 0, problemas.join("; "))
  }
  await contraste(vesna.page, "página da pessoa", ".pagina-da-pessoa")
  check("sem rolagem horizontal na página larga", await semRolagemHorizontal(vesna.page))

  // A wall post, opened inside the page: the body, likes and comments, like in the
  // feed. It's a stack entry, and browser "back" closes it before closing the page.
  await pessoa.getByRole("button", { name: /Néon e vidro/ }).click()
  await pessoa.locator(".post-engagement").waitFor({ timeout: 15_000 })
  await pessoa.getByRole("button", { name: "Gosto", exact: true }).first().click()
  await wait(800)
  await retratar(vesna.page, "pessoa-publicacoes")
  await vesna.page.evaluate(() => history.back())
  check(
    'o "voltar" do browser fecha primeiro a publicação, e a página fica',
    await pessoa
      .getByRole("heading", { level: 1, name: "Kaori" })
      .waitFor({ timeout: 10_000 })
      .then(() => true, () => false),
  )

  // Back: Escape, then the browser back button.
  await vesna.page.keyboard.press("Escape")
  check("o Escape volta à conversa", await pessoa.waitFor({ state: "detached", timeout: 10_000 }).then(() => true, () => false))
  await abrirKaori()
  await vesna.page.evaluate(() => history.back())
  check('o "voltar" do browser também', await pessoa.waitFor({ state: "detached", timeout: 10_000 }).then(() => true, () => false))
  check("e a conversa está onde estava", await vesna.page.getByText("Disse que chegava em 5.").first().isVisible())

  // Vesna's wall, with Kaori's posts: cards in the panel ink, the composer too, and the card under the cursor slightly lighter.
  await vesna.page.getByRole("button", { name: "Feed", exact: true }).first().click()
  await vesna.page.locator("article.post", { hasText: "Néon e vidro" }).first().waitFor({ timeout: 30_000 })
  await wait(800)
  await retratar(vesna.page, "feed")
  {
    const problemas = await verificarPaineis(vesna.page, [".composer-card", "article.post"])
    check("painéis em tinta quase sólida, sem desfoque, sobre a aurora (mural)", problemas.length === 0, problemas.join("; "))
  }
  await contraste(vesna.page, "mural", ".feed")
  await fps(vesna.page, "mural 1280")
  await fpsCom(vesna.page, "mural 1280, aurora parada", SEM_AURORA_A_ANDAR)
  await vesna.page.locator("article.post").first().hover()
  await wait(300)
  const sobRato = await vesna.page.evaluate(() => {
    const post = document.querySelector("article.post")
    return { fundo: getComputedStyle(post).backgroundColor }
  })
  check("o cartão debaixo do rato fica mais claro, e não sólido", sobRato.fundo === "rgba(22, 30, 58, 0.9)", JSON.stringify(sobRato))
  await retratar(vesna.page, "feed-rato")
  await vesna.page.getByRole("button", { name: "Comunidades", exact: true }).first().click()
  await sala(vesna.page, "conversa").click()

  // At 390 px: one column, and the separators scroll within their track.
  await abrirKaori()
  await vesna.page.setViewportSize(TELEMOVEL)
  await wait(800)
  const coluna = await pessoa.evaluate((pagina) => ({
    direccao: getComputedStyle(pagina.querySelector(".pessoa-cabeca")).flexDirection,
    faixa: getComputedStyle(pagina.querySelector(".pessoa-separadores")).overflowX,
    margem: getComputedStyle(pagina.querySelector(".pessoa-corpo")).paddingLeft,
  }))
  check("a 390 px a página é uma coluna, com 16 px de margem", coluna.direccao === "column" && coluna.margem === "16px", JSON.stringify(coluna))
  check("os separadores rolam na faixa deles", coluna.faixa === "auto", coluna.faixa)
  check("sem rolagem horizontal na página a 390 px", await semRolagemHorizontal(vesna.page))
  await retratar(vesna.page, "pessoa-390")
  await vesna.page.keyboard.press("Escape")
  await pessoa.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {})
  await vesna.page.setViewportSize(LARGO)

  // ------------------------------------------------------- the phone
  await vesna.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await vesna.page.setViewportSize(TELEMOVEL)
  await vesna.page.getByRole("button", { name: "Comunidades" }).first().click().catch(() => {})
  await wait(800)
  check("a 390 px a chamada fica na barra compacta", await vesna.page.locator(".call-dock:not(.lateral)").isVisible())
  check("sem rolagem horizontal a 390 px", await semRolagemHorizontal(vesna.page))
  await retratar(vesna.page, "telemovel")
  await fps(vesna.page, "conversa 390")
  // The channel rooms, in the drawer, with the live call (the complaint from 0.8.0: "on mobile users don't see the rooms").
  await vesna.page.getByRole("button", { name: "Abrir o painel lateral" }).click()
  await wait(500)
  const salasNaGaveta = await vesna.page.evaluate(() =>
    [...document.querySelectorAll(".room-tree .room-row .room-name")].map((n) => {
      const r = n.getBoundingClientRect()
      const topo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return { nome: n.textContent?.trim() ?? "", ok: r.height > 0 && r.bottom <= innerHeight && Boolean(topo && n.closest(".room-row")?.contains(topo)) }
    }),
  )
  check(
    "a 390 px as salas do canal vêem-se na gaveta, com a chamada viva",
    salasNaGaveta.length >= 3 && salasNaGaveta.every((sala) => sala.ok),
    salasNaGaveta.map((sala) => `${sala.nome}${sala.ok ? "" : "✗"}`).join(", "),
  )
  // The cursor leaves the hamburger: this context has a cursor, and its tooltip covered the channel line in the screenshot. On a phone there is no tooltip (`movel.css`).
  await vesna.page.mouse.move(200, 600)
  await wait(300)
  await retratar(vesna.page, "telemovel-salas")
  // Close the drawer by the overlay, outside it (the drawer goes from 60 to 340 px).
  await vesna.page.mouse.click(380, 420)
  await wait(400)
  const gavetaFechou = await vesna.page.evaluate(() => !document.querySelector(".sidebar")?.classList.contains("open"))
  check("e o véu fecha a gaveta outra vez", gavetaFechou)
  // The compact bar takes you back to the call room.
  await vesna.page.getByRole("button", { name: "Voltar ao canal" }).click()
  await vesna.page.locator("section.call.call-sala").waitFor({ timeout: 15_000 })
  check("a barra compacta volta à sala da chamada", true)
  await wait(800)
  check("sem rolagem horizontal na chamada a 390 px", await semRolagemHorizontal(vesna.page))
  await retratar(vesna.page, "telemovel-chamada")
  await fps(vesna.page, "chamada 390")

  // Same bug at 390 px: from the call to Settings, the compact bar stays and the sound continues.
  await vesna.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await wait(1200)
  const configEstreita = await vesna.page.evaluate(() => {
    const caixas = [...document.querySelectorAll("video, audio")].filter((m) => m.srcObject && m.srcObject.getAudioTracks().length > 0)
    const doca = document.querySelector(".call-dock:not(.lateral)")
    return { doca: doca !== null && doca.getBoundingClientRect().height > 0, aTocar: caixas.filter((m) => !m.paused && !m.muted).length }
  })
  check("a 390 px, nas Configurações a barra compacta da chamada fica", configEstreita.doca)
  check("e o som continua a chegar", configEstreita.aTocar >= 1, String(configEstreita.aTocar))
  check("e a Kaori continua a ver a Vesna na chamada (390 px)", await kaoriVeDuas())
  await retratar(vesna.page, "telemovel-config-com-chamada")
  await vesna.page.getByRole("button", { name: "Feed", exact: true }).first().click()
  await vesna.page.locator("article.post").first().waitFor({ timeout: 30_000 })
  await wait(800)
  await retratar(vesna.page, "feed-390")
  await contraste(vesna.page, "mural 390", ".feed")
  await fps(vesna.page, "mural 390")
  await vesna.page.getByRole("button", { name: "Voltar ao canal" }).click()
  await vesna.page.locator("section.call.call-sala").waitFor({ timeout: 15_000 })

  // The sheets at 390 px: no horizontal scrolling, and the keyboard doesn't cover the field.
  aTelemovel = true
  const gaveta = async () => {
    await vesna.page.getByRole("button", { name: "Abrir o painel lateral" }).click()
    await wait(400)
  }
  const menuDoCanal390 = async (item) => {
    await gaveta()
    await canalNaBarra().click({ button: "right" })
    await vesna.page.getByRole("menuitem", { name: item }).click()
  }
  await retratarFolha("convidar", () => menuDoCanal390("Convidar…"))
  await retratarFolha("convidar-link", async () => {
    await menuDoCanal390("Convidar…")
    await vesna.page.locator(".sheet.convidar").getByRole("button", { name: "Por link" }).click()
  })
  await retratarFolha("nova-sala", () => menuDoCanal390("Nova sala"))
  await retratarFolha("propriedades", () => menuDoCanal390("Propriedades"))
  await retratarFolha("nova-categoria", () => menuDoCanal390("Nova categoria"))
  await retratarFolha(
    "confirmar",
    () => menuDoCanal390("Sair do canal"),
    () => vesna.page.locator(".overlay").getByRole("button", { name: "Cancelar" }).first().click(),
  )
  await retratarFolha("perfil-editar", async () => {
    await vesna.page.getByRole("button", { name: "Eu", exact: true }).first().click()
    await vesna.page.getByRole("button", { name: "Editar perfil" }).first().click()
  })
  aTelemovel = false

  check("nenhum erro de página", [...vesna.erros, ...kaori.erros].length === 0, [...vesna.erros, ...kaori.erros].join(" | "))
} catch (erro) {
  console.error(erro)
  results.push(false)
}

check("nenhum pedido saiu de 127.0.0.1", fora.length === 0, fora.slice(0, 3).join(" "))
console.log(`\nAs superfícies sobre a aurora, medidas (o Chromium desenha com: ${medidas.gpu ?? "?"}):`)
for (const [onde, m] of Object.entries(medidas.fps)) console.log(`  fps ${onde}: ${m.fps} (p95 ${m.p95} ms)`)
for (const [onde, m] of Object.entries(medidas.contraste)) {
  console.log(`  contraste ${onde}: pior ${m.pior ? `${m.pior.valor}:1 "${m.pior.texto}" (${m.pior.cor} sobre ${m.pior.fundo})` : "?"}, ${m.medidas} medidas, ${m.falhas} abaixo de AA`)
}
const falhas = results.filter((ok) => !ok).length
console.log(`\n${results.length - falhas}/${results.length} verificações passaram.`)
await arrumar(falhas === 0 ? 0 : 1)
