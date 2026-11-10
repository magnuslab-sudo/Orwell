/**
 * Phase 1d: two crossed friend requests, in the same second, in two browsers.
 *
 *   node scripts/e2e-amizade-cruzada.mjs          (needs `npm run build` first)
 *
 * Owner report (27/10/2026): "if one user sends a friend request at the same
 * time another does, they are automatically accepted. I see accepted and pending
 * requests at the same time". The cause was two folds in friendships, the core
 * one and the UI one; now there is one, the core one.
 *
 * What is proved, on both browsers, by the buttons someone presses: both open
 * the other's profile by the friendship link and press "Request friendship" at
 * the SAME instant (both clicks go out together, marked for the same time),
 * WITHOUT a direct open before. Both open the direct at that same instant: this
 * is the case of phase 1g, where two MLS groups with the same name were born.
 * Then, from each side, and during a time window not a single instant:
 *  - the Friends title says "Friends (1)";
 *  - Received says "Nothing waiting." and Sent "No requests waiting.";
 *  - the bell has no "Accept" button;
 *  - never, in any sample after "Friends (1)", does "pending" appear next to
 *    "friends" (the Received counter and title at the same time).
 *
 * ALL LOCAL AND ALL DISPOSABLE, in the mold of `e2e-amizade-ui.mjs`: its own
 * homeserver without community mode, in a temp folder, ports 8464 and 8465
 * (this script only), and a front that acts as Caddy. Does not take target
 * by argument.
 *
 * Ports change by environment variable, so two agents in the same worktree do
 * not fight over them: `E2E_PORTA_DA_FRENTE` and `E2E_PORTA_DO_SERVIDOR`.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
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
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8464)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8465)
const NOME = `localhost:${PORTA_DA_FRENTE}`
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

// --- the homeserver, disposable -----------------------------------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-amizade-cruzada-"))
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
/** The access log: the method and target of the request, as a proxy would record them. */
const acessos = []

const frente = http.createServer((pedido, resposta) => {
  acessos.push(`${pedido.method} ${pedido.url}`)
  const caminho = (pedido.url ?? "/").split("?")[0]
  if (caminho.startsWith("/app")) {
    const relativo = normalize(decodeURIComponent(caminho.slice("/app".length))).replace(/^(\.\.[/\\])+/, "")
    let ficheiro = join(DIST, relativo)
    // Caddy's `try_files`: anything that is not a file routes to the app.
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
// The gateway's WebSocket: pass the request as-is, then it becomes a pipe.
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

// Wait for the homeserver to respond, through the frontend.
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

const dentro = (page) => page.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 90_000 })
// Account names are text that the script writes, not UI labels.
const ANA = "Ana"
const BRUNO = "Bruno"
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Wait until the condition is true, or time runs out. Returns whether it happened. */
async function ate(condicao, ms = 60_000, passo = 500) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await condicao().catch(() => false)) return true
    await espera(passo)
  }
  return false
}

/** Go to Friends and pick a tab. */
async function separador(page, nome) {
  await page.getByRole("button", { name: "Amigos", exact: true }).first().click()
  await page.locator(".people-destination").waitFor({ timeout: 15_000 })
  await page.locator(".people-tabs").getByRole("button", { name: nome }).click()
}

async function meuLink(page) {
  await separador(page, "Encontrar")
  return page.getByLabel("O teu link de amizade", { exact: true }).inputValue()
}

/** Open the other person's profile from a pasted link, and return the button to press. */
async function abrirPerfil(page, link) {
  await separador(page, "Encontrar")
  await page.getByLabel("Cola um link ou endereço").fill(link)
  await page.getByRole("button", { name: "Abrir perfil" }).click()
  const folha = page.locator(".person-profile")
  await folha.waitFor({ timeout: 15_000 })
  const botao = folha.getByRole("button", { name: "Pedir amizade" })
  await botao.waitFor({ timeout: 15_000 })
  return { folha, botao }
}

/** What one side shows right now: the title, the counters, and the bell. */
async function estado(page) {
  await separador(page, "Todos")
  const titulo = await page.locator(".people-bar-title").innerText().catch(() => "")
  const pendentes = await page.getByLabel(/pedidos? à espera de resposta/).count()
  await separador(page, "Recebidos")
  const recebidosVazio = await page.getByText("Nada à espera.").isVisible().catch(() => false)
  await separador(page, "Enviados")
  const enviadosVazio = await page.getByText("Nenhum pedido à espera.").isVisible().catch(() => false)
  await page.locator(".me-bell").first().click()
  const aceitarNoSino = await page.locator(".notif-list").getByRole("button", { name: "Aceitar" }).count()
  const sino = await page.locator(".notif-list").innerText().catch(() => "")
  await page.keyboard.press("Escape")
  return { titulo, pendentes, recebidosVazio, enviadosVazio, aceitarNoSino, sino: sino.replace(/\s+/g, " ").slice(0, 120) }
}

const amigosSo = (e) => e.titulo === "Amigos (1)" && e.pendentes === 0 && e.recebidosVazio && e.enviadosVazio && e.aceitarNoSino === 0

try {
  browser = await chromium.launch({ headless: true })
  const CONTEXTO = { locale: "pt-PT", viewport: { width: 1200, height: 860 } }

  const ctxA = await browser.newContext(CONTEXTO)
  const a = await ctxA.newPage()
  await a.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(a, { nome: ANA, frase: FRASE, servidor: NOME })
  await dentro(a)

  const ctxB = await browser.newContext(CONTEXTO)
  const b = await ctxB.newPage()
  await b.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(b, { nome: BRUNO, frase: FRASE, servidor: NOME })
  await dentro(b)

  const linkDaAna = await meuLink(a)
  const linkDoBruno = await meuLink(b)
  /*
    No DM open before (phase 1g, 28/10/2026). Until 1g, the DM would open
    first, by Ana, because opening it from both sides at the same instant
    created two MLS groups with the same name. Now the server arbitrates the
    start, and whoever loses waits for the Welcome from the winner.
  */
  const [perfilDoBruno, perfilDaAna] = await Promise.all([abrirPerfil(a, linkDoBruno), abrirPerfil(b, linkDaAna)])

  /*
    Both clicks at the same instant: a race condition in the telemetry. Marked
    for the same time on both pages (the clock is the same, the browser is one),
    and sent by clicking the button in the DOM. With Playwright's `click()` the
    second one waited for the button to settle, and the first request arrived
    meanwhile and redrew the page: it was no longer a race.
  */
  const hora = Date.now() + 1_500
  const clicar = (page) =>
    page.evaluate((quando) => new Promise((resolve) => {
      setTimeout(() => {
        const botao = [...document.querySelectorAll(".person-profile button")].find((b) => b.textContent?.trim() === "Pedir amizade")
        botao?.click()
        resolve({ clicou: Boolean(botao), em: Date.now() })
      }, Math.max(0, quando - Date.now()))
    }), hora)
  const [cliqueA, cliqueB] = await Promise.all([clicar(a), clicar(b)])
  check(
    "as duas cliques saíram no mesmo segundo",
    cliqueA.clicou && cliqueB.clicou && Math.abs(cliqueA.em - cliqueB.em) < 1_000,
    `${Math.abs(cliqueA.em - cliqueB.em)} ms entre as duas`,
  )
  await Promise.all([a.keyboard.press("Escape"), b.keyboard.press("Escape")])
  await Promise.all([
    perfilDoBruno.folha.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {}),
    perfilDaAna.folha.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {}),
  ])

  // Each side lands at "friends", and only "friends".
  let ultimoA = null
  let ultimoB = null
  const chegouA = await ate(async () => amigosSo((ultimoA = await estado(a))), 90_000, 2_000)
  check('a Ana chega a "Amigos (1)", sem pedido pendente em lado nenhum', chegouA, JSON.stringify(ultimoA))
  const chegouB = await ate(async () => amigosSo((ultimoB = await estado(b))), 90_000, 2_000)
  check('o Bruno chega a "Amigos (1)", sem pedido pendente em lado nenhum', chegouB, JSON.stringify(ultimoB))
  /*
    The outcome of the split DM, noted separately: the two of them have only
    their own request in Sent and nothing received. They are two MLS groups with
    the same name (each sends to its own, and the other does not read it).
    Measured on 27/10/2026 in 5 of 9 runs; phase 1g closes it.
  */
  if (!chegouA && !chegouB && ultimoA && ultimoB && !ultimoA.enviadosVazio && !ultimoB.enviadosVazio && ultimoA.recebidosVazio && ultimoB.recebidosVazio) {
    console.log("  nota: cada lado só tem o seu pedido: directa bifurcada (dois grupos com o mesmo nome), e não a dobra dupla")
  }

  /*
    And it stays this way: samples for 20 s, because the telemetry bug appeared
    later, when recovery brought the other's request behind the accept.
  */
  let amostras = 0
  let misturadas = 0
  const fim = Date.now() + 20_000
  while (Date.now() < fim) {
    for (const page of [a, b]) {
      const e = await estado(page)
      amostras += 1
      if (!amigosSo(e)) {
        misturadas += 1
        console.log(`  amostra fora: ${JSON.stringify(e)}`)
      }
    }
    await espera(1_500)
  }
  check('em 20 s de amostras, nenhuma mostra "pendente" ao lado de "amigos"', misturadas === 0, `${amostras} amostras, ${misturadas} fora`)

  // Reload: the state comes from the core vault, and it is the same.
  await Promise.all([a.reload({ waitUntil: "domcontentloaded" }), b.reload({ waitUntil: "domcontentloaded" })])
  for (const [page, nome] of [[a, ANA], [b, BRUNO]]) {
    await dentro(page)
    let ultimo = null
    const ok = await ate(async () => amigosSo((ultimo = await estado(page))), 60_000, 2_000)
    check(`depois de recarregar, ${nome} continua só com "amigos"`, ok, JSON.stringify(ultimo))
  }
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
await arrumar(passaram === results.length ? 0 : 1)
