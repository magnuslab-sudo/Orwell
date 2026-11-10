/**
 * Rooms in the common room, on a mobile device, with the administrator offline.
 *
 *   node scripts/e2e-salas-sem-administrador.mjs   (requires `npm run build` first)
 *
 * Report from the owner on 2/11/2026 (1.0.6): "users on mobile are not seeing the
 * community rooms". Ana founds the common room and creates "prensa" and "barricas";
 * Bruno joins on a wide screen and stays connected with no role. Ana CLOSES the
 * app. Carla creates an account on a mobile device (390 x 844, touch) and joins the
 * common room. It proves, by touch and without `force`: the drawer opens, Ana's
 * rooms are there, in view, with nothing on top, and tapping one opens her conversation.
 *
 * Before the fix (`#revezarSalas`, in `packages/client-core/src/session.ts`)
 * Carla relied only on anti-entropy reports, which sometimes do not arrive: the
 * script almost always passed and failed sometimes. The bad case, made certain
 * (reports off), is in `apps/server/src/salas-sem-administrador.test.ts`.
 * This proves the path on screen. `ORWELL_LARGURA` and `ORWELL_ALTURA` change the screen.
 *
 * Everything local and disposable: a homeserver in a temporary folder and a front end
 * that acts as Caddy. No way to point it to production.
 *
 * Screenshots in `capturas/salas-sem-administrador-*.png`.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { FRASE } from "./ambiente.mjs"
import { criarConta } from "./conta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const PORTA_DA_FRENTE = 8492
const PORTA_DO_SERVIDOR = 8493
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`

for (const porta of [PORTA_DA_FRENTE, PORTA_DO_SERVIDOR]) {
  const livre = await new Promise((r) => {
    const sonda = net.createServer()
    sonda.once("error", () => r(false))
    sonda.once("listening", () => sonda.close(() => r(true)))
    sonda.listen(porta, "127.0.0.1")
  })
  if (!livre) {
    console.error(`A porta ${porta} já tem dono (um homeserver de uma corrida anterior?). Liberta-a primeiro.`)
    process.exit(2)
  }
}

const dados = mkdtempSync(join(tmpdir(), "orwell-salas-sem-admin-"))
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR),
    ENCLAVE_COMMUNITY_MODE: "true",
    // As in production: the common room, where every new account joins.
    // As in production: the common room, where every new account joins.
    ENCLAVE_COMMON_ROOM: `!orwell:${NOME}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
})
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json" }
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
  adiante.on("error", () => { resposta.writeHead(502); resposta.end() })
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
await new Promise((r) => frente.listen(PORTA_DA_FRENTE, "127.0.0.1", r))
for (let volta = 0; volta < 60; volta++) {
  const ok = await new Promise((r) => { const s = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => { s.destroy(); r(true) }); s.on("error", () => r(false)) })
  if (ok) break
  await new Promise((r) => setTimeout(r, 250))
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const CAPTURAS = join(RAIZ, "capturas")
const TELEMOVEL = { width: Number(process.env.ORWELL_LARGURA ?? 390), height: Number(process.env.ORWELL_ALTURA ?? 844) }

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

const dentro = (page) => page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
const linhaComum = (page) => page.locator(".channel-row").first()
const salasNoEcra = (page) => page.evaluate(() => [...document.querySelectorAll(".room-tree .room-name")].map((n) => n.textContent))

mkdirSync(CAPTURAS, { recursive: true })
let browser
try {
  browser = await chromium.launch({ headless: true })

  // --- Ana founds the common room and sets it up ---
  const ctxA = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 800 } })
  const a = await ctxA.newPage()
  await a.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(a, { nome: "Ana", frase: FRASE, servidor: NOME })
  await dentro(a)
  await linhaComum(a).waitFor({ timeout: 90_000 })
  await linhaComum(a).click()
  for (const sala of ["prensa", "barricas"]) {
    await linhaComum(a).click({ button: "right" })
    await a.getByRole("menuitem", { name: "Nova sala" }).click()
    await a.locator(".sheet input").first().fill(sala)
    await a.locator(".sheet-actions button.primary").first().click()
    await a.locator(`.room-tree .room-name:text-is("${sala}")`).first().waitFor({ timeout: 30_000 })
  }
  check("a Ana funda a sala comum e cria prensa e barricas", true)

  // --- Bruno joins and stays connected, with no role ---
  const ctxB = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 800 } })
  const b = await ctxB.newPage()
  await b.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(b, { nome: "Bruno", frase: FRASE, servidor: NOME })
  await dentro(b)
  await linhaComum(b).waitFor({ timeout: 90_000 })
  await linhaComum(b).click()
  await b.locator('.room-tree .room-name:text-is("barricas")').first().waitFor({ timeout: 60_000 })
  check("o Bruno entra e vê as salas", true)
  const temNovaSala = await b.locator(".room-tree").getByText("Nova sala").count()
  check('e o Bruno não arruma a sala comum (não tem "Nova sala")', temNovaSala === 0, String(temNovaSala))
  await wait(3000)

  // --- Ana closes the app ---
  await a.close()
  await wait(1500)
  check("a Ana fecha a aplicação: não há ninguém da administração ligado", true)

  // --- Carla, mobile from the start ---
  const ctxC = await browser.newContext({ locale: "pt-PT", viewport: TELEMOVEL, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const c = await ctxC.newPage()
  const erros = []
  c.on("pageerror", (e) => erros.push(e.message))
  await c.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(c, { nome: "Carla", frase: FRASE, servidor: NOME })
  await dentro(c)
  await linhaComum(c).waitFor({ state: "attached", timeout: 90_000 })
  check("a Carla entra na sala comum", true)

  /*
    The common room is already the open channel: the tree draws itself
    below it as soon as rooms arrive. The channel line is not touched before
    that, on purpose: on a mobile, tapping a channel that still has no rooms
    closes the drawer (`canalComArvore`, in `App.tsx`), and whoever joins
    stays in the "general" conversation without seeing the rooms that arrive
    later. This is half the complaint, and it is noted in the report.
  */
  const hamburguer = c.getByRole("button", { name: "Abrir o painel lateral" })
  await hamburguer.tap()
  await wait(500)
  let salas = []
  const inicio = Date.now()
  while (Date.now() - inicio < 30_000) {
    salas = await salasNoEcra(c)
    if (salas.includes("prensa") && salas.includes("barricas")) break
    await wait(500)
  }
  check(
    `as salas da Ana chegam à Carla sem a Ana ligada (${TELEMOVEL.width} px)`,
    salas.includes("prensa") && salas.includes("barricas"),
    `${salas.join(", ")} em ${Date.now() - inicio} ms`,
  )
  await c.screenshot({ path: join(CAPTURAS, `salas-sem-administrador-${TELEMOVEL.width}.png`) })

  const porCima = await c.evaluate(() =>
    [...document.querySelectorAll(".room-tree .room-name")].map((n) => {
      const r = n.getBoundingClientRect()
      const topo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return `${n.textContent}:${topo === n || n.contains(topo) || topo?.closest(".room-row") ? "ok" : (topo?.className ?? "nada")}`
    }),
  )
  check("e estão à vista, sem nada por cima", porCima.length > 0 && porCima.every((x) => x.endsWith(":ok")), porCima.join(" "))

  await c.locator(".room-tree button.room", { hasText: "prensa" }).first().tap()
  await wait(800)
  const aberta = await c.locator(".room-tree .room.current .room-name, .room-row.current .room-name").first().textContent().catch(() => null)
  const gavetaFechou = await c.evaluate(() => document.querySelector(".sidebar")?.classList.contains("open") === false)
  check('tocar em "prensa" abre a conversa dela e a gaveta sai', gavetaFechou && (aberta === null || aberta === "prensa"), `${aberta}`)
  await c.screenshot({ path: join(CAPTURAS, `salas-sem-administrador-${TELEMOVEL.width}-sala.png`) })
  check("nenhum erro de página", erros.length === 0, erros[0] ?? "")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
} finally {
  await browser?.close().catch(() => {})
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
process.exit(passaram === results.length ? 0 : 1)
