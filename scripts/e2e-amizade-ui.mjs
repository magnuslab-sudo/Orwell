/**
 * Friendships through the interface, end to end, in a real browser.
 *
 *   node scripts/e2e-amizade-ui.mjs          (needs `npm run build` first)
 *
 * Two accounts, Ana and Bruno, on a server with no community mode. What you
 * prove, always by clicking the buttons a person would click:
 *
 *  1. "Find" shows Ana's QR and friendship link.
 *  2. Bruno pastes the link, opens Ana's profile and requests friendship.
 *     The request appears in his "Sent" and her "Received", and in her bell.
 *  3. Bruno cancels. The request leaves "Sent", "Received" and the bell.
 *  4. Bruno requests again, and Ana accepts. The title says "Friends (1)".
 *  5. Ana shows the friends list in her profile. Bruno sees the list in the
 *     "Friends" tab on her page, and goes back by Escape and browser.
 *  6. Bruno blocks Ana. The direct channel locks, Ana leaves the list, and
 *     appears in Settings › Privacy, under "Blocked".
 *  7. On 375 px, "Find" has no horizontal scroll.
 *
 * ALL LOCAL AND ALL DISPOSABLE, in the mold of `e2e-convite-link.mjs`: its own
 * homeserver, with the database in a temporary folder that gets deleted
 * at the end, and a front end that acts as Caddy (the friendship link points to
 * the host that serves the app). It takes no target by argument or by
 * environment: there is no way to point it at production. With
 * `ORWELL_CAPTURAS=<pasta>` saves screenshots at 1200 e to 375 px.
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
const PORTA_DA_FRENTE = 8486
const PORTA_DO_SERVIDOR = 8487
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
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-amizade-ui-"))
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

const dentro = (page) => page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
/*
  Account names in constants: they are text that the script writes (via
  `criarConta`), not UI labels. See `strings.guioes.test.ts`.
*/
const ANA = "Ana"
const BRUNO = "Bruno"
const PEDIDO_DO_BRUNO = `${BRUNO} quer ser teu amigo`
const AMIGOS_DA_ANA = `Amigos de ${ANA}`
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

async function capturar(page, nome) {
  if (!process.env.ORWELL_CAPTURAS) return
  // The UI transitions take tenths of a second: the screenshot waits for them.
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(process.env.ORWELL_CAPTURAS, `amizade-${nome}.png`) })
}

/** Go to Friends and pick a tab. */
async function separador(page, nome) {
  await page.getByRole("button", { name: "Amigos", exact: true }).first().click()
  await page.locator(".people-destination").waitFor({ timeout: 15_000 })
  await page.locator(".people-tabs").getByRole("button", { name: nome }).click()
}

/** The URL that an account's friendship link leads to. */
async function meuLink(page) {
  await separador(page, "Encontrar")
  return page.getByLabel("O teu link de amizade", { exact: true }).inputValue()
}

/** Paste a link in "Find" and request friendship on the profile page. */
async function pedirPeloLink(page, link) {
  await separador(page, "Encontrar")
  await page.getByLabel("Cola um link ou endereço").fill(link)
  await page.getByRole("button", { name: "Abrir perfil" }).click()
  const folha = page.locator(".person-profile")
  await folha.waitFor({ timeout: 15_000 })
  await folha.getByRole("button", { name: "Pedir amizade" }).click()
  await folha.getByRole("status").filter({ hasText: "Pedido enviado" }).waitFor({ timeout: 30_000 })
  await page.keyboard.press("Escape")
  await folha.waitFor({ state: "detached", timeout: 10_000 }).catch(() => {})
}

const linhasDoSino = async (page) => {
  await page.locator(".me-bell").first().click()
  const n = await page.locator(".notif-list li").count()
  const texto = await page.locator(".notif-list").innerText().catch(() => "")
  await page.keyboard.press("Escape")
  return { n, texto }
}

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

  // ---------------------------------------------------------------------------
  // 1. Ana's link and QR code.
  // ---------------------------------------------------------------------------
  const linkDaAna = await meuLink(a)
  const urlDaAna = new URL(linkDaAna)
  const enderecoDaAna = decodeURIComponent(urlDaAna.hash.slice(1))
  check("o link de amizade aponta para /app/amigo, sem query", urlDaAna.pathname === "/app/amigo" && urlDaAna.search === "", linkDaAna)
  check("e leva um endereço de conta no fragmento", /^@[^:]+:/.test(enderecoDaAna), enderecoDaAna)
  check('"Encontrar" mostra o QR', await a.getByRole("img", { name: "O QR do teu link de amizade" }).isVisible())
  await capturar(a, "encontrar-1200")

  // ---------------------------------------------------------------------------
  // 2. Bruno requests via the pasted link.
  // ---------------------------------------------------------------------------
  await pedirPeloLink(b, linkDaAna)
  await separador(b, "Enviados")
  check('o pedido aparece em Enviados, com "Cancelar pedido"', await b.getByRole("button", { name: "Cancelar pedido" }).isVisible().catch(() => false))
  check("e com a data do envio", /Enviado /.test(await b.locator(".people-scroll").innerText()))

  const chegou = await ate(async () => (await a.getByLabel("1 pedido à espera de resposta").count()) > 0)
  check("a Ana vê o contador em Recebidos", chegou)
  await separador(a, "Recebidos")
  check("e o cartão do pedido do Bruno", await a.getByText(PEDIDO_DO_BRUNO).isVisible().catch(() => false))
  check("o sino da Ana tem o pedido", (await linhasDoSino(a)).n >= 1)
  await capturar(a, "recebidos-1200")

  // ---------------------------------------------------------------------------
  // 3. Cancelar.
  // ---------------------------------------------------------------------------
  await separador(b, "Enviados")
  await b.getByRole("button", { name: "Cancelar pedido" }).click()
  check(
    "cancelar tira o pedido de Enviados",
    await ate(async () => b.getByText("Nenhum pedido à espera.").isVisible(), 30_000),
  )
  await separador(a, "Recebidos")
  check("e de Recebidos da Ana", await ate(async () => a.getByText("Nada à espera.").isVisible(), 60_000))
  const sinoDepois = await linhasDoSino(a)
  check("e do sino da Ana, sem notícia nenhuma", !sinoDepois.texto.includes(BRUNO), sinoDepois.texto.replace(/\s+/g, " ").slice(0, 80))

  // ---------------------------------------------------------------------------
  // 4. Request again and accept.
  // ---------------------------------------------------------------------------
  await pedirPeloLink(b, linkDaAna)
  await separador(a, "Recebidos")
  check("o pedido novo chega", await ate(async () => a.getByRole("button", { name: "Aceitar" }).isVisible(), 60_000))
  await a.getByRole("button", { name: "Aceitar" }).click()
  await separador(a, "Todos")
  check('a Ana vê "Amigos (1)"', await ate(async () => (await a.locator(".people-bar-title").innerText()) === "Amigos (1)", 60_000))
  await separador(b, "Todos")
  check(
    "o Bruno vê a Ana na lista",
    await ate(async () => {
      await separador(b, "Todos")
      return b.locator(".people-scroll .person-row", { hasText: ANA }).isVisible()
    }, 90_000, 2_000),
  )

  // ---------------------------------------------------------------------------
  // 5. The friend list in the profile.
  // ---------------------------------------------------------------------------
  await a.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await a.getByRole("button", { name: "Conta", exact: true }).first().click()
  await a.getByRole("button", { name: "Editar perfil" }).first().click()
  const interruptor = a.getByRole("switch", { name: "Mostrar a minha lista de amigos aos meus amigos" })
  await interruptor.waitFor({ timeout: 15_000 })
  check("o interruptor vem desligado", (await interruptor.getAttribute("aria-checked")) === "false")
  await ate(async () => !(await interruptor.isDisabled()), 15_000)
  await interruptor.click()
  check("ligado, lista o Bruno com interruptor próprio", await a.getByRole("switch", { name: BRUNO }).isVisible().catch(() => false))
  await capturar(a, "editor-amigos-1200")
  await a.getByRole("button", { name: "Guardar" }).click()
  await a.locator(".sheet").first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {})

  /*
    The "Friends" tab always exists on the person's page: if the list is empty,
    it says why. What we expect here is the LIST, which arrives with Ana's next
    publish. Until then, go back (Escape) and open it again.
  */
  const temLista = await ate(async () => {
    await separador(b, "Todos")
    await b.locator(".people-scroll .person-row", { hasText: ANA }).locator(".person-name-link").click()
    const pagina = b.locator(".pagina-da-pessoa")
    await pagina.waitFor({ timeout: 10_000 })
    await pagina.getByRole("tab", { name: /Amigos/ }).click()
    const ha = await pagina.getByRole("list", { name: AMIGOS_DA_ANA }).isVisible().catch(() => false)
    if (!ha) await b.keyboard.press("Escape")
    return ha
  }, 90_000, 3_000)
  check('o Bruno vê a lista de amigos no separador "Amigos" da página da Ana', temLista)
  if (temLista) {
    const pagina = b.locator(".pagina-da-pessoa")
    const lista = pagina.getByRole("list", { name: AMIGOS_DA_ANA })
    check("com uma pessoa na lista", (await lista.locator("li").count()) === 1)
    await capturar(b, "perfil-amigos-1200")
    await b.keyboard.press("Escape")
    check(
      "o Escape fecha a página da Ana e devolve Amigos",
      await pagina.waitFor({ state: "detached", timeout: 10_000 }).then(() => true, () => false),
    )
    // And the browser's back button does the same, via the same stack.
    await b.locator(".people-scroll .person-row", { hasText: ANA }).locator(".person-name-link").click()
    await pagina.waitFor({ timeout: 10_000 })
    await b.evaluate(() => history.back())
    check(
      'o "voltar" do browser fecha a página da Ana',
      await pagina.waitFor({ state: "detached", timeout: 10_000 }).then(() => true, () => false),
    )
  }

  // ---------------------------------------------------------------------------
  // 6. Bloquear.
  // ---------------------------------------------------------------------------
  await separador(b, "Todos")
  const linhaDaAna = b.locator(".people-scroll .person-row", { hasText: ANA })
  await linhaDaAna.getByRole("button", { name: /Mais acções/ }).click()
  const itens = await b.getByRole("menuitem").allInnerTexts()
  check('"Bloquear" é a última entrada do menu', itens[itens.length - 1] === "Bloquear", itens.join(" | "))
  await b.getByRole("menuitem", { name: "Bloquear" }).click()
  const pergunta = b.getByRole("alertdialog")
  check("pergunta antes, e diz o que a pessoa deixa de fazer", (await pergunta.innerText()).includes("deixa de te escrever, de te pedir amizade e de ver as tuas publicações"))
  await pergunta.getByRole("button", { name: "Bloquear" }).click()
  check("a Ana sai da lista do Bruno", await ate(async () => !(await linhaDaAna.isVisible()), 15_000))

  const conversa = b.locator(".people-aside .direct-row").first()
  await conversa.click()
  check(
    "a directa fica trancada, com a frase do bloqueio",
    await ate(async () => b.getByText("Bloqueaste esta pessoa.", { exact: false }).first().isVisible(), 15_000),
  )
  await capturar(b, "directa-trancada-1200")

  await b.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await b.getByRole("button", { name: "Privacidade", exact: true }).first().click()
  check("Configurações › Privacidade › Bloqueados lista a Ana", await b.locator(".bloqueados").getByText(ANA).isVisible().catch(() => false))
  check("e diz que a lista passa aos outros aparelhos", await b.getByText("A lista passa aos teus outros aparelhos.", { exact: false }).isVisible())
  check('com "Desbloquear"', await b.locator(".bloqueados").getByRole("button", { name: "Desbloquear" }).isVisible())

  // ---------------------------------------------------------------------------
  // 7. A 375 px.
  // ---------------------------------------------------------------------------
  await a.setViewportSize({ width: 375, height: 760 })
  await separador(a, "Encontrar").catch(async () => {
    // On a narrow screen the panel may be elsewhere: the tab is enough.
    await a.locator(".people-tabs").getByRole("button", { name: "Encontrar" }).click()
  })
  const largura = await a.evaluate(() => ({ rolagem: document.documentElement.scrollWidth, janela: innerWidth }))
  check('a 375 px "Encontrar" não rola na horizontal', largura.rolagem <= largura.janela, JSON.stringify(largura))
  await capturar(a, "encontrar-375")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
await arrumar(passaram === results.length ? 0 : 1)
