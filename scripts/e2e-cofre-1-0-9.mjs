/**
 * A vault saved by 1.0.9 "Archive" opens with the new code, and vice versa.
 *
 *   ORWELL_DIST_109=<apps/web/dist from 1.0.9> node scripts/e2e-cofre-1-0-9.mjs [chromium firefox webkit]
 *
 * The template is from `e2e-cofre-entre-versoes.mjs`: the SAME origin in both
 * moments (the front swaps the folder it serves without changing the port) and
 * the SAME browser profile, closed and reopened. In each engine:
 *
 * 1. 1.0.9 creates the account (no vault yet: it does not know them) and writes
 *    in a channel;
 * 2. the new code opens THAT vault with the password, with the account and the
 *    message inside, and remembers the session;
 * 3. close and reopen with the new code, it opens without the password;
 * 4. back to 1.0.9 (going back to an earlier version): the vault still opens
 *    with the password, and the `session` record next to it does not bother it.
 *
 * Everything local and disposable.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST_NOVA = join(RAIZ, "apps/web/dist")
const DIST_ANTIGA = process.env.ORWELL_DIST_109 ? resolve(process.env.ORWELL_DIST_109) : ""
/** The folder the front serves NOW: swapped without changing the port, so IndexedDB stays the same. */
let DIST = DIST_NOVA
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const FRASE = "frase-de-verificacao-2026"
const MOTORES = { chromium, firefox, webkit }

const pedidos = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
const escolhidos = pedidos.length ? pedidos : Object.keys(MOTORES)
for (const nome of escolhidos) {
  if (!MOTORES[nome]) {
    console.error(`Motor desconhecido: ${nome}. Usa chromium, firefox ou webkit.`)
    process.exit(2)
  }
}
if (!DIST_ANTIGA) {
  console.error("Falta ORWELL_DIST_109: o \`apps/web/dist\` construído da 1.0.9 (commit 0d62bedf).")
  process.exit(2)
}
for (const [o_que, caminho] of [["a web construída", join(DIST_NOVA, "index.html")], ["a web da 1.0.9", join(DIST_ANTIGA, "index.html")], ["o servidor construído", SERVIDOR_JS]]) {
  if (!existsSync(caminho)) {
    console.error(`Falta ${o_que}: ${caminho}. Corre \`npm run build\` primeiro.`)
    process.exit(2)
  }
}

async function portaLivre() {
  return new Promise((resolve, reject) => {
    const sonda = net.createServer()
    sonda.once("error", reject)
    sonda.listen(0, "127.0.0.1", () => {
      const { port } = sonda.address()
      sonda.close(() => resolve(port))
    })
  })
}

const PORTA_DA_FRENTE = await portaLivre()
const PORTA_DO_SERVIDOR = await portaLivre()
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`

// --- the homeserver, disposable, with a clean environment -------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-cofre-109-"))
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
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

// --- the front, which acts as Caddy ----------------------------------------
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

const perfis = []
function arrumar(codigoDeSaida) {
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
  for (const perfil of perfis) rmSync(perfil, { recursive: true, force: true })
  process.exit(codigoDeSaida)
}

if (!(await servidorDePe())) {
  console.error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
  arrumar(2)
}

// --- a prova, por motor -------------------------------------------------------
const configuracoes = (page) => page.getByRole("button", { name: "Configurações", exact: true }).first()
const campoDaFrase = (page) => page.locator('.gate-card input[type="password"]')
const dentro = (page, timeout = 90_000) => configuracoes(page).waitFor({ timeout })

async function oQueAbre(page, timeout = 60_000) {
  await configuracoes(page).or(campoDaFrase(page)).first().waitFor({ timeout })
  return (await configuracoes(page).count()) > 0 ? "dentro" : "pede-frase"
}

async function destrancar(page, { memorizar } = {}) {
  await campoDaFrase(page).waitFor({ timeout: 30_000 })
  await campoDaFrase(page).fill(FRASE)
  const caixa = page.locator('input[name="memorizar"]')
  if (memorizar !== undefined && (await caixa.count())) await caixa.setChecked(memorizar)
  await campoDaFrase(page).press("Enter")
  await dentro(page)
}

const ve = (page, texto, timeout = 30_000) =>
  page.getByText(texto, { exact: false }).first().waitFor({ timeout }).then(
    () => true,
    () => false,
  )

const resultadoPorMotor = {}

for (const nomeDoMotor of escolhidos) {
  const results = []
  const check = (nome, ok, detalhe = "") => {
    results.push(Boolean(ok))
    console.log(`${ok ? "  ok  " : " FALHA"} [${nomeDoMotor}] ${nome}${detalhe ? `  (${detalhe})` : ""}`)
  }
  const perfil = mkdtempSync(join(tmpdir(), `orwell-perfil-109-${nomeDoMotor}-`))
  perfis.push(perfil)
  const abrir = () => MOTORES[nomeDoMotor].launchPersistentContext(perfil, { headless: true, locale: "pt-PT" })
  let ctx
  const canal = `adega-${nomeDoMotor}`
  const frase = `escrito pela 1.0.9 em ${nomeDoMotor}`
  try {
    // 1. 1.0.9 creates the account and writes.
    DIST = DIST_ANTIGA
    ctx = await abrir()
    let page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(APP, { waitUntil: "domcontentloaded" })
    check("a página é a 1.0.9 (sem a caixa nova)", (await page.content()).length > 0 && (await page.locator('input[name="memorizar"]').count()) === 0)
    await criarConta(page, { nome: "Ana", frase: FRASE, servidor: NOME })
    await dentro(page)
    await page.getByRole("button", { name: "Criar canal" }).first().click()
    await page.locator("form.prompt input").first().fill(canal)
    await page.locator("form.prompt button.primary").first().click()
    await page.getByRole("heading", { name: canal }).waitFor({ timeout: 30_000 })
    const caixaDeTexto = page.locator('input[placeholder="Escreve uma mensagem"]')
    await caixaDeTexto.click()
    await caixaDeTexto.fill(frase)
    await page.keyboard.press("Enter")
    check("a 1.0.9 escreve no canal", await ve(page, frase))
    await page.waitForTimeout(2_500)
    await ctx.close()

    // 2. The new code opens that vault with the password, and remembers.
    DIST = DIST_NOVA
    ctx = await abrir()
    page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(APP, { waitUntil: "domcontentloaded" })
    check("o código novo pede a palavra-passe ao cofre da 1.0.9", (await oQueAbre(page)) === "pede-frase")
    check('com a caixa "Memorizar a sessão" ligada', await page.locator('input[name="memorizar"]').isChecked())
    const t0 = Date.now()
    await destrancar(page, { memorizar: true })
    check("o cofre da 1.0.9 abre com a palavra-passe certa", true, `${Date.now() - t0} ms`)
    await page.locator(".channel-list .channel-name", { hasText: canal }).first().click()
    check("com o canal e a mensagem que a 1.0.9 escreveu", await ve(page, frase))
    await page.waitForTimeout(2_500)
    await ctx.close()

    // 3. Reopen with the new code: no password.
    ctx = await abrir()
    page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(APP, { waitUntil: "domcontentloaded" })
    check("reabrir com o código novo abre sem palavra-passe", (await oQueAbre(page)) === "dentro")
    await ctx.close()

    // 4. Back to 1.0.9.
    DIST = DIST_ANTIGA
    ctx = await abrir()
    page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(APP, { waitUntil: "domcontentloaded" })
    check("a 1.0.9 ignora a sessão memorizada e pede a palavra-passe", (await oQueAbre(page)) === "pede-frase")
    await destrancar(page)
    await page.locator(".channel-list .channel-name", { hasText: canal }).first().click()
    check("e abre o cofre que o código novo gravou, com a mensagem", await ve(page, frase))
  } catch (erro) {
    check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  } finally {
    await ctx?.close().catch(() => {})
  }
  const passaram = results.filter(Boolean).length
  resultadoPorMotor[nomeDoMotor] = { passaram, total: results.length }
}

console.log("")
let tudoBem = true
for (const [motor, { passaram, total }] of Object.entries(resultadoPorMotor)) {
  console.log(`${motor}: ${passaram}/${total} verificações passaram`)
  if (passaram !== total) tudoBem = false
}
arrumar(tudoBem ? 0 : 1)
