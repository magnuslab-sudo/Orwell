/**
 * Pairing end-to-end on two real browsers: a computer that has the account and
 * a phone that joins it via QR.
 *
 *   node scripts/e2e-emparelhar.mjs          (needs `npm run build` first)
 *
 * What gets tested: Ana creates an account and a channel on the computer; in
 * Settings, Devices, Add device, a QR appears; a phone (390x844, `isMobile`)
 * with no account chooses "Pair", READS THE QR VIA CAMERA (a fake Chromium
 * camera showing the QR from the computer screen), chooses the password, and
 * both screens show the SAME six words; the person confirms on both; the phone
 * enters the account, channel, and common room; a third person invites the
 * account and both devices receive it; and what DOES NOT happen: the link
 * secret does not appear in request, trace, console or logs, and the phone's
 * vault does not hold the account's private key.
 *
 * And the Welcome portrait (phase 1 of 1.1): before pairing, Carla enters the
 * vault where Ana creates the "barrica" room and closes the browser. The phone
 * sits in the vault with Carla offline and still has her name (with her authorship,
 * not the `partial` copy the computer reports) and the room, read from its vault.
 *
 * And the state (phase 5): before pairing, Ana reads the channel, archives the
 * chat with Bruno and blocks him. The phone is born with the read marks, archive
 * and blocked status from the computer, read from its vault. (The highlight
 * color left Settings in 0.9: there stopped being a color to choose.)
 *
 * ALL LOCAL AND ALL DISPOSABLE, like `e2e-convite-link.mjs` which this is copied
 * from: its own homeserver in a temp folder, a front end acting as Caddy (serves
 * `apps/web/dist` at `/app/` and proxies the rest), its own ports, and no way to
 * point it to production.
 *
 * The fake camera: `--use-fake-device-for-media-stream` with
 * `--use-file-for-fake-video-capture=<ficheiro.y4m>`. The y4m is generated HERE
 * from the QR the computer shows (read the `path` from the SVG in the DOM and
 * rasterize to Y'CbCr 4:2:0), and the phone browser starts after that, because
 * the camera is a startup option. If reading from the camera does not finish
 * in twenty seconds, the script pastes the link and SAYS the QR was proven only
 * by the decoder test (`qr.test.ts`), without hiding the difference.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { argon2id } from "@noble/hashes/argon2.js"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const CAPTURAS = join(RAIZ, "capturas")
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
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-emparelhar-"))
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
async function arrumar(codigoDeSaida) {
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
 * Open a channel from the sidebar. On a narrow screen the sidebar is a drawer
 * closed: tap the rail button before tapping the channel row to open it.
 *
 * And it CLOSES after, which is what changed in September 2026. Choosing a
 * channel with rooms stopped closing the drawer on purpose, rooms draw below
 * the open channel, and closing it in the same gesture made the tree appear
 * behind a panel leaving the screen (that was the complaint: "can't see the
 * various channels or the rooms"). Who closes the drawer now is choosing a ROOM,
 * or the overlay. Here, when you just want to get to the channel conversation,
 * it closes with the same button that opened it.
 */
async function abrirCanal(page, nome) {
  const linha = page.locator(".channel-name", { hasText: nome }).first()
  const gaveta = page.getByRole("button", { name: "Abrir o painel lateral" })
  if (!(await linha.isVisible().catch(() => false))) {
    if ((await gaveta.getAttribute("aria-expanded").catch(() => null)) !== "true") await gaveta.click()
  }
  await linha.click()
  if ((await gaveta.getAttribute("aria-expanded").catch(() => null)) === "true") await gaveta.click()
  await page.locator('input[placeholder="Escreve uma mensagem"]').waitFor({ timeout: 30_000 })
}

/** The channel is in the list, visible or not (the drawer may be closed): by the row `title`. */
async function temCanal(page, nome, timeout = 90_000) {
  return page.locator(`.channel-name[title="${nome}"]`).first().waitFor({ state: "attached", timeout }).then(() => true, () => false)
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

/**
 * The QR from the computer screen as a y4m file for the fake camera.
 *
 * Y'CbCr 4:2:0 planar, 640x480, the QR centered with 6 px modules and the
 * quiet zone from the standard already in the `path`. White at 235 and black
 * at 16 (video range), neutral chroma. Five identical frames: Chromium's fake
 * camera loops the file.
 */
function y4mDoQr(svg, caminho) {
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
  const lado = Number(viewBox?.[1] ?? 0)
  const modulos = [...svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [Number(m[1]), Number(m[2])])
  if (!lado || modulos.length === 0) throw new Error("o SVG do QR não tem a forma esperada")
  const W = 640
  const H = 480
  const escala = Math.floor(Math.min(W, H) / lado)
  const x0 = Math.floor((W - lado * escala) / 2)
  const y0 = Math.floor((H - lado * escala) / 2)
  const Y = Buffer.alloc(W * H, 235)
  // The background outside the QR also white, dark modules on top.
  for (const [c, l] of modulos) {
    for (let y = 0; y < escala; y++) {
      for (let x = 0; x < escala; x++) Y[(y0 + l * escala + y) * W + x0 + c * escala + x] = 16
    }
  }
  const UV = Buffer.alloc((W / 2) * (H / 2), 128)
  const cabecalho = Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`, "ascii")
  const frame = Buffer.concat([Buffer.from("FRAME\n", "ascii"), Y, UV, UV])
  writeFileSync(caminho, Buffer.concat([cabecalho, frame, frame, frame, frame, frame]))
  return { lado, modulos: modulos.length, escala }
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

const variantes = (segredo) => {
  const outraVez = Buffer.from(segredo, "utf8")
  return [...new Set([segredo, segredo.replace(/-/g, "+").replace(/_/g, "/"), outraVez.toString("base64").replace(/=+$/, ""), outraVez.toString("base64url")])]
}

mkdirSync(CAPTURAS, { recursive: true })

try {
  browserPc = await chromium.launch({ headless: true })

  // ---------------------------------------------------------------------------
  // 1. Ana, on the computer: account, common room, and a channel.
  // ---------------------------------------------------------------------------
  const redePc = []
  const ctxPc = await browserPc.newContext(CONTEXTO)
  escutar(ctxPc, redePc)
  const pc = await ctxPc.newPage()
  await pc.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(pc, { nome: "Ana", frase: FRASE, servidor: NOME })
  await dentro(pc)
  check("a Ana cria conta no computador", true)
  check("a Ana vê a sala comum", await veASalaComum(pc))
  const helloOk = redePc.find((l) => l.startsWith("TRAMA<") && l.includes('"hello.ok"')) ?? ""
  check("o servidor anuncia pairing", helloOk.includes('"pairing"'))

  await pc.getByRole("button", { name: "Criar canal" }).first().click()
  await pc.locator("form.prompt input").first().fill("adega")
  await pc.locator("form.prompt button.primary").first().click()
  await pc.getByRole("heading", { name: "adega" }).waitFor({ timeout: 30_000 })
  check("a Ana cria o canal adega", true)

  // ---------------------------------------------------------------------------
  // 1b. The state the phone must inherit (phase 5): read marks, archive,
  //     blocked and preferences. Bruno is just the other end of the direct.
  // ---------------------------------------------------------------------------
  const ctxB = await browserPc.newContext(CONTEXTO)
  const bruno = await ctxB.newPage()
  await bruno.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(bruno, { nome: "Bruno", frase: FRASE, servidor: NOME })
  await dentro(bruno)
  const dbCedo = new DatabaseSync(join(dados, "enclave.sqlite"), { readOnly: true })
  const enderecoBruno = dbCedo.prepare("SELECT address FROM accounts ORDER BY rowid ASC").all().map((l) => l.address)[1]
  dbCedo.close()
  /** Bruno's profile sheet, opened from the address in Friends › Find. */
  async function perfilDoBruno() {
    await pc.getByRole("button", { name: "Amigos", exact: true }).first().click()
    await pc.locator(".people-destination").waitFor({ timeout: 15_000 })
    await pc.locator(".people-tabs").getByRole("button", { name: "Encontrar" }).click()
    await pc.getByLabel("Cola um link ou endereço").fill(enderecoBruno)
    await pc.getByRole("button", { name: "Abrir perfil" }).click()
    const folhaDoBruno = pc.locator(".person-profile")
    await folhaDoBruno.waitFor({ timeout: 15_000 })
    return folhaDoBruno
  }
  // The direct with Bruno, opened and closed: ends up in archive.
  await (await perfilDoBruno()).getByRole("button", { name: "Mensagem", exact: true }).click()
  // Only after the chat opens: opening reopens the row (`abrirDirectaCom`), and
  // closing before that was undone right after.
  await pc.locator('.people-aside .direct-row button.direct-open[aria-current="page"]').waitFor({ timeout: 60_000 })
  await pc.locator(".people-aside .direct-row").first().waitFor({ timeout: 60_000 })
  await pc.locator(".people-aside .direct-row button.direct-close").first().click()
  const arquivou = await pc
    .locator(".people-aside .direct-row")
    .first()
    .waitFor({ state: "detached", timeout: 15_000 })
    .then(() => true, () => false)
  check("a Ana fecha a conversa com o Bruno (vai para o arquivo)", arquivou)
  // Block Bruno via the "⋯" on the profile sheet.
  const folhaDoBruno = await perfilDoBruno()
  await folhaDoBruno.getByRole("button", { name: /^Mais acções/ }).first().click()
  await pc.getByRole("menuitem", { name: "Bloquear" }).click()
  await pc.getByRole("alertdialog").getByRole("button", { name: "Bloquear" }).click()
  await pc.getByRole("alertdialog").waitFor({ state: "detached", timeout: 15_000 }).catch(() => {})
  await pc.keyboard.press("Escape")
  // The device vault writes in batch: wait for the write before reading it.
  await wait(2500)
  const cofrePcAntes = await cofreDe(pc, FRASE)
  const lidasAntes = cofrePcAntes.lidas ?? {}
  const arquivadasAntes = Object.entries(cofrePcAntes.arquivo ?? {}).filter(([, marca]) => marca.arquivado).map(([canal]) => canal)
  check(
    "o cofre do computador tem lidas, uma conversa arquivada e o Bruno bloqueado",
    Object.keys(lidasAntes).length >= 1 &&
      arquivadasAntes.length === 1 &&
      cofrePcAntes.blocked?.[enderecoBruno] !== undefined,
    `${Object.keys(lidasAntes).length} lidas, arquivo ${JSON.stringify(cofrePcAntes.arquivo ?? {})}, bloqueados ${Object.keys(cofrePcAntes.blocked ?? {}).length}, preferências ${JSON.stringify(cofrePcAntes.preferencias ?? {})}`,
  )

  // ---------------------------------------------------------------------------
  // 1c. The Welcome portrait (phase 1 of 1.1): Carla enters the vault, Ana creates
  //     the room "barrica", and Carla closes the browser before the phone arrives.
  // ---------------------------------------------------------------------------
  const browserCarla = await chromium.launch({ headless: true })
  const carla = await (await browserCarla.newContext(CONTEXTO)).newPage()
  await carla.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(carla, { nome: "Carla", frase: FRASE, servidor: NOME })
  await dentro(carla)
  const dbDaCarla = new DatabaseSync(join(dados, "enclave.sqlite"), { readOnly: true })
  const enderecoCarla = dbDaCarla.prepare("SELECT address FROM accounts ORDER BY rowid ASC").all().map((l) => l.address)[2]
  dbDaCarla.close()
  await pc.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  check("a Ana convida a Carla para a adega", await convidar(pc, "adega", enderecoCarla))
  check("a Carla entra na adega", await aceitarConvite(carla, "adega", { espera: 60_000 }))
  await pc.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  const linhaDaAdega = pc.locator(".channel-list .channel-row").filter({ has: pc.locator(".channel-name", { hasText: "adega" }) }).first()
  await linhaDaAdega.click({ button: "right" })
  await pc.getByRole("menuitem", { name: "Nova sala" }).click()
  await pc.locator(".sheet input").first().fill("barrica")
  await pc.locator(".sheet-actions button.primary").first().click()
  await pc.locator('.room-tree .room-name:text-is("barrica")').first().waitFor({ timeout: 30_000 })
  // Carla's profile reaches Ana in the vault (authored by her since 1.1), and only then she closes.
  await wait(3000)
  await browserCarla.close()
  check("a Ana cria a sala barrica, e a Carla fecha o browser", true)

  // ---------------------------------------------------------------------------
  // 2. Settings, Devices, Add device: the QR code and the link.
  // ---------------------------------------------------------------------------
  await pc.getByRole("button", { name: "Configurações" }).first().click()
  await pc.getByRole("button", { name: "Aparelhos", exact: true }).click()
  // The list comes from the manifest, which is requested from the server: wait for it.
  await pc.locator(".aparelhos-lista li").first().waitFor({ timeout: 15_000 }).catch(() => {})
  const listaAntes = await pc.locator(".aparelhos-lista li").count()
  check("a lista de aparelhos mostra um aparelho, este", listaAntes === 1 && (await pc.locator(".aparelhos-lista li.este").count()) === 1, String(listaAntes))
  await pc.getByRole("button", { name: "Acrescentar aparelho" }).click()
  const folha = pc.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")
  const url = new URL(link)
  const segredo = url.hash.slice(1)
  check("o computador mostra um QR e um link http(s) para o próprio anfitrião", url.origin === `http://${NOME}`, url.origin)
  check("o caminho é o literal /app/emparelhar, sem query, e o segredo são 43 caracteres no fragmento", url.pathname === "/app/emparelhar" && url.search === "" && /^[A-Za-z0-9_-]{43}$/.test(segredo))
  const svg = await folha.locator(".qr-code").evaluate((el) => el.outerHTML)
  const y4m = join(dados, "qr.y4m")
  const desenho = y4mDoQr(svg, y4m)
  check("o QR do ecrã rasterizou para a câmara falsa", desenho.modulos > 100, `${desenho.lado} módulos de lado, ${desenho.modulos} escuros, escala ${desenho.escala}`)
  const segredos = variantes(segredo)
  const levouOSegredo = (saco) => saco.filter((linha) => segredos.some((s) => linha.includes(s)))
  const pairOpen = redePc.filter((l) => l.startsWith("TRAMA>") && l.includes('"pair.open"'))
  check("saiu um pair.open, e o que ele leva não é o segredo", pairOpen.length === 1 && levouOSegredo(pairOpen).length === 0)

  // ---------------------------------------------------------------------------
  // 3. The phone: new browser with the fake camera showing the computer's QR code.
  // ---------------------------------------------------------------------------
  browserTel = await chromium.launch({
    headless: true,
    args: ["--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`, "--use-fake-ui-for-media-stream"],
  })
  const redeTel = []
  const ctxTel = await browserTel.newContext({ ...CONTEXTO, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ["camera"] })
  escutar(ctxTel, redeTel)
  const tel = await ctxTel.newPage()
  await tel.goto(APP, { waitUntil: "domcontentloaded" })
  // From phase 8.1 Setup opens with "Do you use Orwell on another device?": the
  // pairing path is the "Yes" to that question, not a button below the name.
  await tel.getByRole("button", { name: "Sim, emparelhar este aparelho" }).click({ timeout: 60_000 })
  await tel.getByRole("heading", { name: "Emparelhar este aparelho" }).waitFor({ timeout: 10_000 })
  check("o telemóvel tem a terceira via no portão", true)

  await tel.getByRole("button", { name: "Ler o código com a câmara" }).click()
  await tel.locator("video.leitor-qr-video").waitFor({ timeout: 10_000 })
  const leuPelaCamara = await tel
    .getByRole("heading", { name: "Palavra-passe deste aparelho" })
    .waitFor({ timeout: 25_000 })
    .then(() => true, () => false)
  if (leuPelaCamara) {
    check("o telemóvel LEU O QR PELA CÂMARA e passou à palavra-passe", true)
  } else {
    // Stated, not hidden: the QR code is verified only by `qr.test.ts`.
    check("o telemóvel leu o QR pela câmara (NÃO: o link vai colado; o QR fica provado só pelo teste do decodificador)", false)
    await tel.getByRole("button", { name: "Parar a câmara" }).click()
    await tel.getByLabel("Ou cola o link").fill(link)
    await tel.getByRole("button", { name: "Continuar" }).click()
    await tel.getByRole("heading", { name: "Palavra-passe deste aparelho" }).waitFor({ timeout: 10_000 })
  }

  const frases = tel.locator('.gate-card input[type="password"]')
  await frases.nth(0).fill(FRASE)
  await frases.nth(1).fill(FRASE)
  await tel.getByRole("button", { name: "Continuar" }).click()

  // ---------------------------------------------------------------------------
  // 4. The six words, on both screens, identical.
  // ---------------------------------------------------------------------------
  await tel.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  const palavrasTel = await tel.locator(".sas-palavras").getAttribute("data-palavras")
  const palavrasPc = await folha.locator(".sas-palavras").getAttribute("data-palavras")
  check("as seis palavras são as MESMAS nos dois ecrãs", palavrasTel === palavrasPc && palavrasTel.split("-").length === 6, palavrasPc)
  check("e nenhuma delas é o segredo nem o pairId", !segredos.some((s) => palavrasPc.includes(s)))
  await pc.screenshot({ path: join(CAPTURAS, "emparelhar-pc.png") })
  await tel.screenshot({ path: join(CAPTURAS, "emparelhar-telemovel.png") })
  console.log(`  ..  capturas em ${CAPTURAS}/emparelhar-pc.png e emparelhar-telemovel.png`)

  const certificadosAntes = redeTel.filter((l) => l.startsWith("TRAMA<") && l.includes('"pair.message"')).length
  // Confirm first on the phone, then on the computer: this is the order in which
  // the person holds the phone waiting. The other order is verified in
  // `session.dois-aparelhos.test.ts`.
  await tel.getByRole("button", { name: "São as mesmas" }).click()
  await tel.getByText("Confirmado aqui. Falta confirmar no outro aparelho.").waitFor({ timeout: 5_000 })
  await wait(1500)
  check("antes do sim do computador não saiu certificado nenhum (só a chave de aparelho atravessou)", redeTel.filter((l) => l.startsWith("TRAMA<") && l.includes('"pair.message"')).length === certificadosAntes)
  await folha.getByRole("button", { name: "São as mesmas" }).click()

  // ---------------------------------------------------------------------------
  // 5. The phone enters the account; the computer finishes.
  // ---------------------------------------------------------------------------
  await tel.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 }).then(
    () => check("o telemóvel recebeu o certificado, escreveu o cofre e ligou-se", true),
    (erro) => check("o telemóvel recebeu o certificado, escreveu o cofre e ligou-se", false, erro.message.split("\n")[0]),
  )
  const textoFinal = await tel.locator(".gate-card").innerText()
  check("a frase do fim: recebe a partir de agora, as anteriores ficam nos outros aparelhos", textoFinal.includes("Este aparelho recebe as mensagens a partir de agora") && textoFinal.includes("As anteriores ficam nos outros aparelhos"))
  check("e a de que os aparelhos se gerem no aparelho principal", textoFinal.includes("no aparelho principal da conta"))
  await folha.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 30_000 }).then(
    () => check("o computador concluiu", true),
    () => check("o computador concluiu", false),
  )
  await folha.getByRole("button", { name: "Fechar" }).first().click()
  await tel.getByRole("button", { name: "Entrar", exact: true }).click()
  await dentro(tel)
  check("o telemóvel está dentro da aplicação", true)

  const db = new DatabaseSync(join(dados, "enclave.sqlite"), { readOnly: true })
  const contas = db.prepare("SELECT address FROM accounts ORDER BY rowid ASC").all().map((l) => l.address)
  const enderecoAna = contas[0]
  check("o telemóvel não criou conta: as contas são a Ana, o Bruno e a Carla", contas.length === 3 && contas[1] === enderecoBruno && contas[2] === enderecoCarla, String(contas.length))
  const manifesto = db.prepare("SELECT version, manifest FROM device_manifests WHERE address = ?").get(enderecoAna)
  const listados = manifesto ? JSON.parse(manifesto.manifest) : null
  const chavesNoManifesto = listados?.devices?.length ?? 0
  check("o manifesto da conta está na v2 com dois aparelhos", manifesto?.version === 2 && chavesNoManifesto === 2, `v${manifesto?.version} com ${chavesNoManifesto}`)
  const aparelhos = db.prepare("SELECT count(*) AS n FROM devices WHERE address = ?").get(enderecoAna).n
  check("a tabela de aparelhos do servidor tem os dois", aparelhos === 2, String(aparelhos))
  const piscinas = db.prepare("SELECT count(DISTINCT device) AS n FROM key_packages WHERE address = ? AND device IS NOT NULL").get(enderecoAna).n
  check("cada aparelho tem a sua piscina de key packages", piscinas === 2, String(piscinas))

  // ---------------------------------------------------------------------------
  // 6. The phone's vault: public account key and certificate, never the private key.
  // ---------------------------------------------------------------------------
  const cofre = await cofreDe(tel, FRASE)
  check("o cofre do telemóvel NÃO tem signingPrivateKey", cofre.signingPrivateKey === "", JSON.stringify(cofre.signingPrivateKey).slice(0, 10))
  check("e tem accountPublicKey, deviceCert e a sua chave de aparelho", typeof cofre.accountPublicKey === "string" && cofre.accountPublicKey.length === 43 && typeof cofre.deviceCert === "string" && cofre.deviceCert.length === 86 && cofre.deviceSigningPrivateKey.length === 43)
  const cofrePc = await cofreDe(pc, FRASE)
  check("o cofre do computador tem a privada, e a pública do telemóvel é a dela", cofrePc.signingPrivateKey.length === 43 && cofrePc.accountPublicKey === "")
  check("a privada do computador não aparece em nada que saiu do telemóvel nem do computador", [...redeTel, ...redePc].filter((l) => l.includes(cofrePc.signingPrivateKey)).length === 0)

  // The state (phase 5): the phone is born with the computer's.
  check("o fim do emparelhamento não diz que o estado ficou em falta", !textoFinal.includes("não chegou a tempo"))
  const lidasEmFalta = Object.entries(lidasAntes).filter(([canal, at]) => (cofre.lidas?.[canal] ?? 0) < at)
  check("o telemóvel nasce com as marcas de lido do computador", lidasEmFalta.length === 0 && Object.keys(cofre.lidas ?? {}).length >= Object.keys(lidasAntes).length, `${Object.keys(cofre.lidas ?? {}).length} no telemóvel, ${lidasEmFalta.length} em falta`)
  check("com a conversa arquivada", arquivadasAntes.every((canal) => cofre.arquivo?.[canal]?.arquivado === true))
  check("com o Bruno bloqueado", cofre.blocked?.[enderecoBruno] !== undefined)

  // ---------------------------------------------------------------------------
  // 7. The phone enters the channel (seat by the computer) and the common room (card).
  // ---------------------------------------------------------------------------
  const viuAdega = await temCanal(tel, "adega")
  check("o telemóvel entra no canal adega, assentado pelo computador pelo próprio endereço", viuAdega)
  if (!viuAdega) {
    // Diagnostics, only when it fails: what the computer sent and received about the
    // vault after pairing, and what the phone received.
    const resumo = (l) => l.slice(0, 220)
    console.log("  ..  PC, claims/recusas/welcomes:")
    for (const l of redePc.filter((l) => /keypackage\.claim|channel\.rejected|"welcome"|error/.test(l)).slice(-12)) console.log("      " + resumo(l))
    console.log("  ..  telemóvel, welcomes/recusas/erros/consola:")
    for (const l of redeTel.filter((l) => /"welcome"|channel\.rejected|"error"|CONSOLA|PAGEERROR/.test(l)).slice(-12)) console.log("      " + resumo(l))
    console.log("  ..  telemóvel, canais no ecrã: " + JSON.stringify(await tel.locator(".channel-name").allInnerTexts().catch(() => [])))
  }
  check("o telemóvel vê a sala comum (entrou pelo cartão)", await veASalaComum(tel, 60_000))
  /*
    The Welcome portrait (phase 1 of 1.1): Carla is offline since before the
    phone exists, and the phone has her name with her authorship (not the
    `partial` copy from pairing) and Ana's room. Read from the phone's vault
    after the vault is there.
  */
  await wait(2000)
  const cofreDepois = await cofreDe(tel, FRASE)
  const daCarla = cofreDepois.directory?.[enderecoCarla]
  const adega = Object.keys(cofreDepois.channelRooms ?? {}).find((canal) =>
    Object.values(cofreDepois.channelRooms[canal] ?? {}).some((sala) => sala?.payload?.name === "barrica"),
  )
  check(
    "o telemóvel vê os nomes e as salas com o amigo desligado (o retrato do Welcome)",
    daCarla?.payload?.displayName === "Carla" && daCarla?.parcial === undefined && daCarla?.payload?.autoria !== undefined && adega !== undefined,
    `nome ${daCarla?.payload?.displayName ?? "-"}, parcial ${daCarla?.parcial ?? "não"}, autoria ${daCarla?.payload?.autoria ? "sim" : "não"}, sala ${adega ? "sim" : "não"}`,
  )
  const seatDoPc = redePc.filter((l) => l.startsWith("TRAMA>") && l.includes('"keypackage.claim"') && l.includes(enderecoAna))
  check("o computador reclamou key packages da PRÓPRIA conta para assentar o telemóvel", seatDoPc.length >= 1, String(seatDoPc.length))
  const gastosAna = db.prepare("SELECT count(*) AS n FROM key_packages WHERE address = ? AND claimed = 1").get(enderecoAna).n
  // One per channel where the computer seats the phone: the vault, the direct chat with
  // Bruno, and the account channel (phase 5). Never more than Ana's channels.
  check("e gastou pacotes do aparelho do telemóvel, só os que faltavam", gastosAna >= 1 && gastosAna <= 4, String(gastosAna))

  await pc.getByRole("button", { name: "Comunidades" }).click().catch(() => {})
  await abrirCanal(pc, "adega")
  await abrirCanal(tel, "adega")
  await wait(2000)
  const doPc = `do computador, ${Date.now().toString(36)}`
  await dizer(pc, doPc)
  check("o computador fala na adega e o telemóvel lê", await ouviu(tel, doPc, 60_000))
  const doTel = `do telemóvel, ${Date.now().toString(36)}`
  await dizer(tel, doTel)
  check("o telemóvel fala na adega e o computador lê", await ouviu(pc, doTel, 60_000))

  // The common room with both devices of the same account: one speaks, the other reads.
  await abrirCanal(pc, /orwell/i)
  await abrirCanal(tel, /orwell/i)
  await wait(2000)
  const naComum = `na sala comum, ${Date.now().toString(36)}`
  await dizer(tel, naComum)
  check("na sala comum o telemóvel fala e o computador lê (dois aparelhos da mesma conta pelo cartão)", await ouviu(pc, naComum, 60_000))

  // ---------------------------------------------------------------------------
  // 8. A third person invites the account: BOTH devices enter, in one commit.
  //    Both are connected at the same time receiving: measure what came out.
  // ---------------------------------------------------------------------------
  const redeC = []
  const ctxC = await browserPc.newContext(CONTEXTO)
  escutar(ctxC, redeC)
  const c = await ctxC.newPage()
  await c.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(c, { nome: "Carlos", frase: FRASE, servidor: NOME })
  await dentro(c)
  await c.getByRole("button", { name: "Criar canal" }).first().click()
  await c.locator("form.prompt input").first().fill("lagar")
  await c.locator("form.prompt button.primary").first().click()
  await c.getByRole("heading", { name: "lagar" }).waitFor({ timeout: 30_000 })
  await c.getByRole("button", { name: "Amigos" }).click()
  await c.locator(".people-destination").waitFor({ timeout: 15_000 })
  await c.getByRole("button", { name: "Encontrar", exact: true }).click()
  await c.getByLabel("Cola um link ou endereço").fill(enderecoAna)
  await c.getByRole("button", { name: "Abrir perfil" }).click()
  // The address opens the profile sheet. This server is in community mode,
  // where there is no friend request to make: the conversation opens via "Message".
  await c.locator(".person-profile").getByRole("button", { name: "Mensagem", exact: true }).click()
  // The direct chat is the channel the address invite opens: both of Ana's
  // devices must receive it.
  // `attached` and not visible: on the phone the conversation list is a closed drawer,
  // and what we measure is whether the conversation arrived, not whether it is visible.
  const dmNoPc = await pc.getByRole("button", { name: "Amigos" }).click().then(() => pc.locator(".direct-row").first().waitFor({ state: "attached", timeout: 90_000 })).then(() => true, () => false)
  const dmNoTel = await tel.getByRole("button", { name: "Amigos" }).click().then(() => tel.locator(".direct-row").first().waitFor({ state: "attached", timeout: 90_000 })).then(() => true, () => false)
  check("um terceiro convida a conta pelo endereço e o computador recebe", dmNoPc)
  check("e o telemóvel recebe também", dmNoTel)
  // Carlos's direct chat, not Bruno's (which was created earlier, in step 1b).
  // The direct chat is an opaque address (1.0 "Arca"): it is from the computer's vault,
  // by the card, not by the name form on the server.
  const cofrePcDepois = await cofreDe(pc, FRASE)
  const directas = Object.entries(cofrePcDepois.fichasDosCanais ?? {})
    .filter(([, ficha]) => ficha.tipo === "directa")
    .map(([canal]) => canal)
  const dm = db
    .prepare("SELECT channel FROM events GROUP BY channel")
    .all()
    .map((l) => l.channel)
    .filter((canal) => directas.includes(canal))
    .filter((canal) => !arquivadasAntes.includes(canal) && !Object.keys(cofrePcAntes.history ?? {}).includes(canal))
  const commitsNaDm = dm.length ? db.prepare("SELECT count(*) AS n FROM events WHERE channel = ? AND kind = 'handshake'").get(dm[0]).n : 0
  const welcomesNaDm = dm.length ? db.prepare("SELECT count(*) AS n FROM events WHERE channel = ? AND kind = 'welcome'").get(dm[0]).n : 0
  check("os dois aparelhos entraram num commit só, com um welcome", commitsNaDm >= 1 && welcomesNaDm === 1, `${commitsNaDm} commits, ${welcomesNaDm} welcomes em ${dm[0] ?? "?"}`)

  // The race (block E): both of Ana's devices connected at the same time,
  // receiving the same invite and republishing. Measure: how many `stale-epoch`
  // messages came out for both, and whether there is a partition (one message from Carlos
  // must reach BOTH, and one from each of Ana's devices must reach Carlos).
  const staleEpochs = [...redePc, ...redeTel].filter((l) => l.startsWith("TRAMA<") && l.includes('"channel.rejected"') && l.includes("stale-epoch")).length
  console.log(`  ..  stale-epoch recebidos pelos dois aparelhos da Ana até aqui: ${staleEpochs} (medido, não exigido)`)
  /** Open the direct chat in Friends: the row is a button, and on the phone it lives in a drawer. */
  async function abrirDirecta(page) {
    const botao = page.locator(".direct-row button.direct-open").first()
    if (!(await botao.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Abrir o painel lateral" }).click().catch(() => {})
    }
    await botao.click()
    await page.locator('input[placeholder="Escreve uma mensagem"]').waitFor({ timeout: 60_000 })
  }
  // The conversation starts as a friend REQUEST: Ana must accept. Accept on the
  // PHONE on purpose: a commit made by the paired device on a channel where the
  // computer is also present, with both connected. This is where block E (device
  // arbitration) is measured: the acceptance is one commit, the computer sees it
  // come in, and no one ends up in a separate epoch.
  // Since phase 3 of friendships, direct chats are between friends: Carlos asks
  // for friendship in the chat (the footer button), and the request reaches "Received".
  await c.getByRole("button", { name: "Pedir amizade" }).first().click()
  await tel.locator(".people-tabs").getByRole("button", { name: /^Recebidos/ }).click()
  const aceitar = tel.locator(".people-requests").getByRole("button", { name: "Aceitar" }).first()
  if (await aceitar.waitFor({ timeout: 60_000 }).then(() => true, () => false)) await aceitar.click()
  else await tel.screenshot({ path: join(CAPTURAS, "emparelhar-recebidos.png") })
  // The sign that the acceptance reached Carlos: the conversation text box
  // appears to him (before it said he could only write after yes).
  const aceite = await abrirDirecta(c).then(() => true, () => false)
  if (!aceite) await c.screenshot({ path: join(CAPTURAS, "emparelhar-carlos.png") })
  check("a Ana aceita o pedido do Carlos NO TELEMÓVEL, e o Carlos passa a poder escrever", aceite)
  // The acceptance is an application message (`friend.accept`), not a commit:
  // the channel stays in the same epoch, and that is what we check. What the race
  // in block E would produce was one extra commit and a `stale-epoch` to someone.
  const commitsDepois = db.prepare("SELECT count(*) AS n FROM events WHERE channel = ? AND kind = 'handshake'").get(dm[0]).n
  check("a aceitação não mexeu na epoch: o mesmo commit único, dos dois aparelhos ao mesmo tempo", commitsDepois === commitsNaDm, `${commitsNaDm} antes, ${commitsDepois} depois`)
  const doCarlos = `do Carlos, ${Date.now().toString(36)}`
  await dizer(c, doCarlos)
  await abrirDirecta(pc)
  await abrirDirecta(tel)
  check("sem partição: a mensagem do Carlos chega ao computador", await ouviu(pc, doCarlos, 60_000))
  check("sem partição: e chega ao telemóvel", await ouviu(tel, doCarlos, 60_000))
  const respostaDoTel = `resposta do telemóvel, ${Date.now().toString(36)}`
  await dizer(tel, respostaDoTel)
  check("sem partição: o telemóvel responde e o Carlos lê", await ouviu(c, respostaDoTel, 60_000))
  check("sem partição: e o computador lê o que o telemóvel disse", await ouviu(pc, respostaDoTel, 60_000))

  // ---------------------------------------------------------------------------
  // 9. The secret, sought in everything that came out of any browser and in
  //    everything the front end and server logged.
  // ---------------------------------------------------------------------------
  await wait(1000)
  for (const [nome, saco] of [["o computador", redePc], ["o telemóvel", redeTel], ["o Carlos", redeC]]) {
    const fugas = levouOSegredo(saco)
    check(`nenhum pedido, corpo, trama ou consola de ${nome} levou o segredo`, fugas.length === 0, fugas.length ? `${fugas.length} linhas, a 1.ª começa por "${fugas[0].slice(0, 40)}"` : `${saco.length} linhas vistas`)
  }
  check("e o telemóvel fez mesmo pedidos e tramas (a guarda olhou para alguma coisa)", redeTel.filter((l) => l.startsWith("PEDIDO")).length > 3 && redeTel.some((l) => l.startsWith("TRAMA>")))
  const doEmparelhar = acessos.filter((linha) => linha.includes("/app/emparelhar"))
  check("o registo de acessos da frente nunca viu o caminho com query nem com o segredo", doEmparelhar.every((linha) => linha === "GET /app/emparelhar") && levouOSegredo(acessos).length === 0, [...new Set(doEmparelhar)].join(" | ") || "(o QR foi lido pela câmara: o link nunca foi aberto por HTTP)")
  check("nem o homeserver escreveu o segredo para a consola", levouOSegredo([registoDoServidor]).length === 0)
  const pairSend = [...redePc, ...redeTel].filter((l) => l.startsWith("TRAMA>") && l.includes('"pair.send"'))
  check('as tramas pair.send saíram cifradas: nenhuma leva o endereço, a chave de conta ou a palavra "certificado" em claro', pairSend.length >= 4 && pairSend.every((l) => !l.includes(enderecoAna) && !l.includes(cofrePc.signingPrivateKey) && !l.includes('"t":"certificado"')), String(pairSend.length))
  const baseInteira = readFileSync(join(dados, "enclave.sqlite"))
  check("nada da caixa ficou na base: nem o pairId nem os payloads", !baseInteira.includes(url.hash.slice(1)) && !segredos.some((s) => baseInteira.includes(s)))
  const staleNoFim = [...redePc, ...redeTel].filter((l) => l.startsWith("TRAMA<") && l.includes('"channel.rejected"') && l.includes("stale-epoch")).length
  console.log(`  ..  stale-epoch recebidos pelos dois aparelhos da Ana no total: ${staleNoFim} (medido, não exigido: a arbitragem por aparelho e o bloco E)`)
  const erros = [...redePc, ...redeTel, ...redeC].filter((l) => l.startsWith("PAGEERROR"))
  check("nenhum erro de página em nenhum dos três browsers", erros.length === 0, erros[0]?.slice(0, 80) ?? "")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
await arrumar(passaram === results.length ? 0 : 1)
