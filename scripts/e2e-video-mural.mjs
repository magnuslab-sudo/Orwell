/**
 * Video in the feed, end to end, in a real browser.
 *
 *   node scripts/e2e-video-mural.mjs        (needs `npm run build` first)
 *
 * Two accounts, Ana and Bruno, friends via friend link. What we prove, by the
 * buttons one person clicks:
 *
 *  1. Ana records a WebM in her own browser (an animated `canvas`, via
 *     `MediaRecorder`), picks it in the "Attach video" button, sees the
 *     thumbnail and duration in the draft, and publishes. Progress shows the
 *     part uploading.
 *  2. Bruno sees the post with the thumbnail and play button, and no
 *     `<video>` before clicking (no autoplay).
 *  3. On click, a `<video controls playsinline preload="none">` appears with
 *     `src` at a `blob:`, and the video plays.
 *  4. The bytes of the `blob:` match the SHA-256 of the file Ana recorded.
 *  5. No CSP denial, no requests to any address outside 127.0.0.1.
 *  6. At 390 px the video fills the post width, and nothing scrolls horizontally.
 *
 * Screenshots in `capturas/midnight-mural-video.png` (1280 px) and
 * `capturas/midnight-mural-video-390.png`.
 *
 * ALL LOCAL AND ALL DISPOSABLE, following the pattern of `e2e-amizade-ui.mjs`:
 * a homeserver in a temp folder, a front end that acts as Caddy on 8495, and
 * no way to point it at production.
 */
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const CAPTURAS = join(RAIZ, "capturas")
const PORTA_DA_FRENTE = 8495
const PORTA_DO_SERVIDOR = 8496
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`
const FRASE = "frase-de-verificacao-2026"
const LEGENDA = "O vídeo do lagar, gravado agora."

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

// --- the homeserver, disposable -----------------------------------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-video-"))
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

const dentro = (page) => page.getByRole("button", { name: "Configurações" }).waitFor({ timeout: 90_000 })
const ANA = "Ana"
const BRUNO = "Bruno"
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function ate(condicao, ms = 60_000, passo = 500) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await condicao().catch(() => false)) return true
    await espera(passo)
  }
  return false
}

async function separador(page, nome) {
  await page.getByRole("button", { name: "Amigos", exact: true }).first().click()
  await page.locator(".people-destination").waitFor({ timeout: 15_000 })
  await page.locator(".people-tabs").getByRole("button", { name: nome }).click()
}

/** Console errors and external requests, by page. */
function vigiar(page) {
  const registo = { csp: [], fora: [] }
  page.on("console", (mensagem) => {
    const texto = mensagem.text()
    if (/Content Security Policy|Refused to load/i.test(texto)) registo.csp.push(texto)
  })
  page.on("request", (pedido) => {
    const url = pedido.url()
    if (/^(https?|wss?):/.test(url) && !url.includes("127.0.0.1") && !url.includes("localhost")) registo.fora.push(url)
  })
  return registo
}

async function semRolagemHorizontal(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
}

try {
  browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=user-gesture-required"] })
  const CONTEXTO = { locale: "pt-PT", viewport: { width: 1280, height: 800 } }

  const ctxA = await browser.newContext(CONTEXTO)
  const a = await ctxA.newPage()
  const vigiaA = vigiar(a)
  await a.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(a, { nome: ANA, frase: FRASE, servidor: NOME })
  await dentro(a)

  const ctxB = await browser.newContext(CONTEXTO)
  /*
    The bytes of each `blob:` the page creates, stored separately. CSP won't let
    the page read a `blob:` via `fetch` (`connect-src` is only 'self'), and that's
    good: that's how we verify what the reader received.
  */
  await ctxB.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL)
    window.__blobs = {}
    URL.createObjectURL = (blob) => {
      const url = original(blob)
      window.__blobs[url] = blob
      return url
    }
  })
  const b = await ctxB.newPage()
  const vigiaB = vigiar(b)
  await b.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(b, { nome: BRUNO, frase: FRASE, servidor: NOME })
  await dentro(b)

  // ---------------------------------------------------------------------------
  // Friends via link: Bruno requests, Ana accepts. Only then does Bruno have a spot in her feed.
  // ---------------------------------------------------------------------------
  await separador(a, "Encontrar")
  const linkDaAna = await a.getByLabel("O teu link de amizade", { exact: true }).inputValue()
  await separador(b, "Encontrar")
  await b.getByLabel("Cola um link ou endereço").fill(linkDaAna)
  await b.getByRole("button", { name: "Abrir perfil" }).click()
  const folha = b.locator(".person-profile")
  await folha.waitFor({ timeout: 15_000 })
  await folha.getByRole("button", { name: "Pedir amizade" }).click()
  await folha.getByRole("status").filter({ hasText: "Pedido enviado" }).waitFor({ timeout: 30_000 })
  await b.keyboard.press("Escape")
  await separador(a, "Recebidos")
  check("o pedido de amizade chega à Ana", await ate(async () => a.getByRole("button", { name: "Aceitar" }).isVisible(), 60_000))
  await a.getByRole("button", { name: "Aceitar" }).click()
  await separador(b, "Todos")
  check(
    "o Bruno vê a Ana na lista de amigos",
    await ate(async () => {
      await separador(b, "Todos")
      return b.locator(".people-scroll .person-row", { hasText: ANA }).isVisible()
    }, 90_000, 2_000),
  )
  // A few seconds for Bruno's spot in Ana's feed to settle.
  await espera(4_000)

  // ---------------------------------------------------------------------------
  // 1. Ana records a WebM in the browser and publishes it.
  // ---------------------------------------------------------------------------
  const base64 = await a.evaluate(async () => {
    const canvas = document.createElement("canvas")
    canvas.width = 640
    canvas.height = 360
    const contexto = canvas.getContext("2d")
    const gravador = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 6_000_000 })
    const bocados = []
    gravador.ondataavailable = (evento) => bocados.push(evento.data)
    gravador.start(250)
    const inicio = performance.now()
    await new Promise((acabar) => {
      const desenhar = () => {
        const t = (performance.now() - inicio) / 1000
        contexto.fillStyle = `hsl(${(t * 120) % 360} 60% 35%)`
        contexto.fillRect(0, 0, 640, 360)
        // Noise, so the encoder has something to work with: the file ends up with multiple parts.
        for (let i = 0; i < 400; i++) {
          contexto.fillStyle = `hsl(${Math.random() * 360} 80% 60%)`
          contexto.fillRect(Math.random() * 640, Math.random() * 360, 12, 12)
        }
        contexto.fillStyle = "#fff"
        contexto.font = "bold 56px sans-serif"
        contexto.fillText(`Orwell ${t.toFixed(1)} s`, 40, 200)
        if (t < 4) requestAnimationFrame(desenhar)
        else acabar()
      }
      desenhar()
    })
    const parou = new Promise((acabar) => (gravador.onstop = acabar))
    gravador.stop()
    await parou
    const bytes = new Uint8Array(await new Blob(bocados, { type: "video/webm" }).arrayBuffer())
    let texto = ""
    for (let i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(texto)
  })
  const bytesDoVideo = Buffer.from(base64, "base64")
  const pastaDoVideo = mkdtempSync(join(tmpdir(), "orwell-e2e-video-ficheiro-"))
  const ficheiro = join(pastaDoVideo, "lagar.webm")
  writeFileSync(ficheiro, bytesDoVideo)
  const shaDoFicheiro = createHash("sha256").update(bytesDoVideo).digest("base64url")
  check("o WebM gravado no browser tem mais do que uma parte", bytesDoVideo.length > 1024 * 1024, `${(bytesDoVideo.length / 1048576).toFixed(2)} MB`)

  await a.getByRole("button", { name: "Feed", exact: true }).first().click()
  await a.getByPlaceholder(/Escreve uma publicação/).waitFor({ timeout: 15_000 })
  await a.locator('input[type="file"][accept="video/mp4,video/webm,video/quicktime"]').setInputFiles(ficheiro)
  const rascunho = a.locator(".draft-video")
  check("o rascunho mostra a miniatura do vídeo", await rascunho.locator("img").waitFor({ timeout: 30_000 }).then(() => true, () => false))
  const miniatura = await rascunho.locator("img").getAttribute("src")
  check("a miniatura é uma imagem em data URL", /^data:image\/(webp|jpeg|png);base64,/.test(miniatura ?? ""), (miniatura ?? "").slice(0, 30))
  check("e a duração", /0:0[3-5]/.test(await rascunho.innerText()), (await rascunho.innerText()).replace(/\s+/g, " "))
  await a.getByPlaceholder(/Escreve uma publicação/).fill(LEGENDA)
  await a.getByRole("button", { name: "Publicar" }).click()
  const progresso = await a.locator(".envio-do-video").getByRole("status").innerText({ timeout: 15_000 }).catch(() => "")
  check("o progresso diz a parte que está a sair", /A enviar o vídeo: parte \d+ de \d+\./.test(progresso), progresso)
  check(
    "a publicação aparece no feed da Ana, com o vídeo",
    await ate(async () => (await a.locator(".card.post .video-da-publicacao").count()) > 0 && !(await a.locator(".envio-do-video").count()), 60_000),
  )

  // ---------------------------------------------------------------------------
  // 2 and 3. Bruno sees the thumbnail and clicks.
  // ---------------------------------------------------------------------------
  await b.getByRole("button", { name: "Feed", exact: true }).first().click()
  const doBruno = b.locator(".video-da-publicacao").first()
  check("a publicação com o vídeo chega ao Bruno", await doBruno.waitFor({ timeout: 90_000 }).then(() => true, () => false))
  check("com a miniatura", (await doBruno.locator(".video-tocar img").getAttribute("src")) === miniatura)
  check("e nenhum <video> antes de tocar", (await b.locator("video").count()) === 0)
  // Bytes arrive in parts: only play once the "arriving" notice is gone.
  const tocar = doBruno.getByRole("button", { name: /Ver o vídeo lagar\.webm/ })
  let leitor = b.locator(".video-da-publicacao video")
  const tocou = await ate(async () => {
    await tocar.click()
    return (await leitor.count()) > 0
  }, 60_000, 2_000)
  check("ao tocar, aparece o leitor", tocou)
  leitor = b.locator(".video-da-publicacao video").first()
  const atributos = await leitor.evaluate((video) => ({
    src: video.getAttribute("src"),
    controls: video.hasAttribute("controls"),
    playsinline: video.hasAttribute("playsinline"),
    preload: video.getAttribute("preload"),
    autoplay: video.hasAttribute("autoplay"),
  }))
  check("<video controls playsinline preload=none>, sem autoplay", atributos.controls && atributos.playsinline && atributos.preload === "none" && !atributos.autoplay, JSON.stringify(atributos))
  check("a partir de um blob:", (atributos.src ?? "").startsWith("blob:"), atributos.src)
  const anda = await ate(async () => leitor.evaluate((video) => video.currentTime > 0.3), 20_000)
  check("o vídeo anda", anda, await leitor.evaluate((video) => `t=${video.currentTime.toFixed(2)} readyState=${video.readyState} erro=${video.error?.code ?? "-"}`))
  await leitor.evaluate((video) => video.pause())

  // ---------------------------------------------------------------------------
  // 4. Same bytes, via SHA-256.
  // ---------------------------------------------------------------------------
  const shaDoBlob = await leitor.evaluate(async (video) => {
    const bytes = new Uint8Array(await window.__blobs[video.getAttribute("src")].arrayBuffer())
    const resumo = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
    return btoa(String.fromCharCode(...resumo)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  })
  check("o Bruno tem os mesmos bytes que a Ana gravou (SHA-256)", shaDoBlob === shaDoFicheiro, `${shaDoBlob.slice(0, 12)}… = ${shaDoFicheiro.slice(0, 12)}…`)

  // ---------------------------------------------------------------------------
  // 5. CSP and network.
  // ---------------------------------------------------------------------------
  check("nenhuma recusa da CSP", vigiaA.csp.length + vigiaB.csp.length === 0, [...vigiaA.csp, ...vigiaB.csp].join(" | ").slice(0, 200))
  check("nenhum pedido fora de 127.0.0.1", vigiaA.fora.length + vigiaB.fora.length === 0, [...vigiaA.fora, ...vigiaB.fora].join(" ").slice(0, 200))

  // ---------------------------------------------------------------------------
  // 6. As capturas, a 1280 e a 390 px.
  // ---------------------------------------------------------------------------
  mkdirSync(CAPTURAS, { recursive: true })
  await doBruno.scrollIntoViewIfNeeded()
  await b.waitForTimeout(600)
  await b.screenshot({ path: join(CAPTURAS, "midnight-mural-video.png") })
  await b.setViewportSize({ width: 390, height: 844 })
  await b.waitForTimeout(800)
  await b.locator(".video-da-publicacao").first().scrollIntoViewIfNeeded()
  const larguras = await b.evaluate(() => {
    const video = document.querySelector(".video-da-publicacao")
    const cartao = video?.closest(".card.post")
    const grelha = video?.closest(".post-images")
    return {
      video: Math.round(video?.getBoundingClientRect().width ?? 0),
      grelha: Math.round(grelha?.getBoundingClientRect().width ?? 0),
      cartao: Math.round(cartao?.getBoundingClientRect().width ?? 0),
      janela: window.innerWidth,
    }
  })
  check("a 390 px o vídeo ocupa a largura da publicação", larguras.video > 0 && larguras.video >= larguras.grelha - 1, JSON.stringify(larguras))
  check("a 390 px nada rola na horizontal", await semRolagemHorizontal(b))
  await b.waitForTimeout(400)
  await b.screenshot({ path: join(CAPTURAS, "midnight-mural-video-390.png") })
  rmSync(pastaDoVideo, { recursive: true, force: true })
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
await arrumar(passaram === results.length ? 0 : 1)
