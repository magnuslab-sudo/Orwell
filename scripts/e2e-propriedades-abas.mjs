/**
 * Channel properties by section (3/11/2026, parity plan §5.3),
 * in the real app with a real homeserver.
 *
 * A new account creates the "Club" channel and opens properties from the
 * channel menu. Then: changes the name in General, goes to Roles and back (the
 * written name stays), moves between sections with arrows, and closes with Esc
 * (the sheet asks to discard, discards, and the channel name reverts).
 *
 * Saves screenshots of each section at 1440 and 390 px in
 * `capturas/propriedades-<secção>-<largura>.png`. At 390 px the browser window
 * shrinks with the sheet open: the CSS and the sheet's `matchMedia` respond to
 * size, and that is what we want to see.
 *
 *   node scripts/e2e-propriedades-abas.mjs   (needs `npx tsc -b` and web build)
 *
 * All local and disposable, like `e2e-canal-comum-opcional-browser.mjs`.
 * Ports 8475 (front) and 8474 (server), or E2E_PORTA_DA_FRENTE/E2E_PORTA_DO_SERVIDOR.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const CAPTURAS = join(RAIZ, "capturas")
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8475)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8474)
const NOME = `localhost:${PORTA_DA_FRENTE}`
const pausa = (ms) => new Promise((r) => setTimeout(r, ms))

const SECCOES = ["Geral", "Salas", "Cargos", "Membros", "Convites", "Moderação", "Eventos"]
const FICHEIRO = { Geral: "geral", Salas: "salas", Cargos: "cargos", Membros: "membros", Convites: "convites", Moderação: "moderacao", Eventos: "eventos" }

mkdirSync(join(RAIZ, ".dev-data-scr"), { recursive: true })
mkdirSync(CAPTURAS, { recursive: true })
const dados = mkdtempSync(join(RAIZ, ".dev-data-scr", "propriedades-abas-"))
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR),
    ENCLAVE_COMMUNITY_MODE: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
})
let registoDoServidor = ""
servidor.stdout.on("data", (b) => (registoDoServidor += b))
servidor.stderr.on("data", (b) => (registoDoServidor += b))

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".wasm": "application/wasm" }
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
await new Promise((r) => frente.listen(PORTA_DA_FRENTE, "127.0.0.1", r))
for (let i = 0; i < 60; i++) {
  if (registoDoServidor.includes("listening")) break
  await pausa(250)
}

let browser
async function arrumar(codigo) {
  await browser?.close().catch(() => {})
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
  process.exit(codigo)
}

const falhas = []
const verificar = (ok, frase, detalhe = "") => {
  console.log(`  ${ok ? "ok  " : "FALHA"} ${frase}${detalhe ? ` (${detalhe})` : ""}`)
  if (!ok) falhas.push(frase)
}

browser = await chromium.launch()
const contexto = await browser.newContext({ locale: "pt-PT", viewport: { width: 1440, height: 900 } })
const page = await contexto.newPage()
const erros = []
page.on("pageerror", (e) => erros.push(String(e.message).slice(0, 160)))
await page.goto(`http://${NOME}/app/?lingua=pt`)
try {
  await criarConta(page, { nome: "Ana", servidor: NOME, canalOficial: false })
  await page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
} catch (erro) {
  await page.screenshot({ path: join(RAIZ, ".dev-data-scr", "propriedades-abas-registo.png") })
  console.log(`  FALHA o registo não chegou à app: ${erro.message.split("\n")[0]}`)
  await arrumar(1)
}

console.log("\n1. A Ana cria o canal Clube e abre as propriedades")
await page.getByRole("button", { name: "Criar canal" }).first().click()
await page.locator("form.prompt input").first().fill("Clube")
await page.locator("form.prompt button.primary").first().click()
await page.getByRole("heading", { name: "Clube" }).waitFor({ timeout: 30_000 })
await pausa(1_000)
await page.locator(".channel-row").filter({ hasText: "Clube" }).first().click({ button: "right" })
await page.getByRole("menuitem", { name: "Propriedades" }).click()
const folha = page.getByRole("dialog", { name: "Propriedades do canal" })
await folha.waitFor({ timeout: 10_000 })
const coluna = folha.getByRole("tablist", { name: "Secções das propriedades" })
const abas = await coluna.getByRole("tab").allInnerTexts()
verificar(abas.join(",") === SECCOES.join(","), "a fundadora vê as sete secções, pela ordem", abas.join(", "))
const aba = (nome) => coluna.getByRole("tab", { name: nome, exact: true })
verificar((await aba("Geral").getAttribute("aria-selected")) === "true", "abre em Geral")

const caixa = async (seletor) => (await page.locator(seletor).first().boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
const colunaCx = await caixa(".propriedades-seccoes")
const conteudoCx = await caixa(".propriedades-conteudo")
verificar(colunaCx.x + colunaCx.width <= conteudoCx.x + 1 && Math.abs(colunaCx.y - conteudoCx.y) < 4, "a 1440, a coluna fica à esquerda do conteúdo")

console.log("\n2. Capturas a 1440 px")
for (const nome of SECCOES) {
  await aba(nome).click()
  await pausa(150)
  await page.screenshot({ path: join(CAPTURAS, `propriedades-${FICHEIRO[nome]}-1440.png`) })
}
// A role opened: the role editor with its two columns, next to ours.
await aba("Cargos").click()
await folha.getByRole("tabpanel", { name: "Cargos" }).getByRole("button", { name: "Ver", exact: true }).first().click()
await pausa(250)
const cargoAberto = await page.evaluate(() => {
  const folha = document.querySelector(".sheet")?.getBoundingClientRect()
  const cargo = document.querySelector(".cargos-folha")?.getBoundingClientRect()
  return { folha: folha?.right ?? 0, cargo: cargo?.right ?? 0, largura: cargo?.width ?? 0 }
})
verificar(cargoAberto.largura > 300 && cargoAberto.cargo <= cargoAberto.folha + 0.5, "um cargo aberto cabe na folha, ao lado da coluna", JSON.stringify(cargoAberto))
await page.screenshot({ path: join(CAPTURAS, "propriedades-cargos-aberto-1440.png") })

console.log("\n3. Mudar o nome, mudar de secção, voltar, e fechar com Esc")
await aba("Geral").click()
const nome = folha.getByLabel("Nome", { exact: true })
await nome.fill("Clube dos Sábados")
await aba("Cargos").click()
verificar(await folha.getByRole("tabpanel", { name: "Cargos" }).isVisible(), "Cargos mostra o painel dos cargos")
verificar((await folha.locator(".sheet-actions").getByRole("button", { name: "Guardar", exact: true }).count()) === 0, 'em Cargos não há "Guardar" no pé')
await aba("Geral").click()
verificar((await nome.inputValue()) === "Clube dos Sábados", "de volta a Geral, o nome escrito continua lá")
// The arrows, with focus in the column.
await aba("Geral").focus()
await page.keyboard.press("ArrowDown")
verificar((await aba("Salas").getAttribute("aria-selected")) === "true", "a seta para baixo abre Salas")
verificar(await aba("Salas").evaluate((no) => no === document.activeElement), "e o foco vai com ela")
// Focus does not leave the window with Tab.
for (let i = 0; i < 12; i++) await page.keyboard.press("Tab")
verificar(await folha.evaluate((no) => no.contains(document.activeElement)), "doze Tabs depois, o foco continua dentro da janela")
await page.keyboard.press("Escape")
const pergunta = page.getByRole("alertdialog", { name: "Descartar as alterações?" })
verificar(await pergunta.isVisible().catch(() => false), "Esc com o nome mudado pergunta se descarta")
await pergunta.getByRole("button", { name: "Descartar", exact: true }).click()
await folha.waitFor({ state: "detached", timeout: 5_000 }).catch(() => {})
verificar((await folha.count()) === 0, "e a janela fecha")
verificar((await page.getByRole("heading", { name: "Clube", exact: true }).count()) > 0, "o canal continua a chamar-se Clube")

console.log("\n4. Guardar um nome novo, e fechar com Esc sem nada por guardar")
await page.locator(".channel-row").filter({ hasText: "Clube" }).first().click({ button: "right" })
await page.getByRole("menuitem", { name: "Propriedades" }).click()
await folha.waitFor({ timeout: 10_000 })
await folha.getByLabel("Nome", { exact: true }).fill("Clube dos Sábados")
await folha.getByRole("button", { name: "Guardar", exact: true }).click()
await folha.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {})
verificar(await page.getByRole("heading", { name: "Clube dos Sábados" }).isVisible().catch(() => false), "o nome guardado chega ao cabeçalho")
await page.locator(".channel-row").filter({ hasText: "Clube dos Sábados" }).first().click({ button: "right" })
await page.getByRole("menuitem", { name: "Propriedades" }).click()
await folha.waitFor({ timeout: 10_000 })
await aba("Membros").click()
await page.keyboard.press("Escape")
await folha.waitFor({ state: "detached", timeout: 5_000 }).catch(() => {})
verificar((await folha.count()) === 0, "Esc sem nada por guardar fecha logo")

console.log("\n5. Capturas a 390 px")
await page.locator(".channel-row").filter({ hasText: "Clube dos Sábados" }).first().click({ button: "right" })
await page.getByRole("menuitem", { name: "Propriedades" }).click()
await folha.waitFor({ timeout: 10_000 })
await page.setViewportSize({ width: 390, height: 844 })
await pausa(400)
const colunaEstreita = await caixa(".propriedades-seccoes")
const conteudoEstreito = await caixa(".propriedades-conteudo")
verificar(colunaEstreita.y + colunaEstreita.height <= conteudoEstreito.y + 1, "a 390, as abas ficam em cima do conteúdo")
verificar((await coluna.getAttribute("aria-orientation")) === "horizontal", 'a 390, a fila diz-se "horizontal"')
const largura = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, janela: window.innerWidth, folha: document.querySelector(".sheet")?.getBoundingClientRect().right ?? 0 }))
verificar(largura.folha <= largura.janela + 0.5, "a folha cabe na largura do telemóvel", JSON.stringify(largura))
for (const nome of SECCOES) {
  await aba(nome).click()
  await pausa(150)
  await page.screenshot({ path: join(CAPTURAS, `propriedades-${FICHEIRO[nome]}-390.png`) })
}

verificar(erros.length === 0, "sem erros de página", erros[0] ?? "")
console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : "\ntudo ok")
await arrumar(falhas.length ? 1 : 0)
