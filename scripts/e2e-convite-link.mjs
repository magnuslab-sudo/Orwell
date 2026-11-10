/**
 * The invite link, end to end, in a real browser.
 *
 *   node scripts/e2e-convite-link.mjs          (needs `npm run build` first)
 *
 * What it proves: account A forges an https link; a CLEAN browser opens it, sees the gate with the invite line, creates an account, gets the prompt, says yes, and the channel opens. And above all, what DOES NOT happen along the way: the invite code never appears in any HTTP request, in any WebSocket frame, or in the address bar after startup.
 *
 * ALL LOCAL AND ALL DISPOSABLE, on purpose. This script does not use the development server on 8452 or `.dev-data`: it spins up its own homeserver, with a database in a temp folder it deletes on exit, and refuses to run if the port is in use. It takes no target argument or env var: no way to point it at production.
 *
 * Why a server up front. In production the same host serves the app (`/app/`, via `index.html`) and the homeserver (`/_enclave/`), and THAT is what makes the link work: the link's host is the homeserver of the forger. In development they are two (Vite on 5173, server on 8452) and the link would point to a place that doesn't serve the app. The front end here acts like Caddy: files from `apps/web/dist` on `/app/`, everything else to the homeserver, and an access log like what a proxy would keep, which is one of the things we inspect at the end.
 */
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
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
const PORTA_DA_FRENTE = 8472
const PORTA_DO_SERVIDOR = 8473
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
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-convite-link-"))
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

// --- the full network, from each context -----------------------------------------
/** Everything that left the browser: request URLs and bodies, WebSocket URLs and frames. */
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
  })
}

/*
  Language comes from the context's `locale`, not from `?lingua=pt`, unlike the
  other scripts: an invite link with a query is refused (that's the rule we prove here),
  so whoever opens the link has nowhere to ask for language. Portuguese because the text
  we search for below is in Portuguese.
*/
const CONTEXTO = { locale: "pt-PT" }

const dentro = (page) => page.getByRole("button", { name: "Configurações" }).waitFor({ timeout: 90_000 })

try {
  browser = await chromium.launch({ headless: true })

  // ---------------------------------------------------------------------------
  // 1. Account A creates a channel and forges the link, via the UI.
  // ---------------------------------------------------------------------------
  const redeA = []
  const ctxA = await browser.newContext(CONTEXTO)
  escutar(ctxA, redeA)
  const a = await ctxA.newPage()
  await a.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(a, { nome: "Ana", frase: FRASE, servidor: NOME })
  await dentro(a)

  await a.getByRole("button", { name: "Criar canal" }).first().click()
  await a.locator("form.prompt input").first().fill("adega")
  await a.locator("form.prompt button.primary").first().click()
  await a.getByRole("heading", { name: "adega" }).waitFor({ timeout: 30_000 })

  async function cunhar(page) {
    // The single invite sheet, in "by link" mode.
    await page.getByRole("button", { name: "Convidar…" }).first().click()
    await page.locator(".sheet").first().getByRole("button", { name: "Por link" }).click()
    const folha = page.locator(".sheet").first()
    await folha.waitFor({ timeout: 10_000 })
    await folha.getByRole("button", { name: "Criar link" }).click()
    const campo = folha.getByLabel("O teu link")
    await campo.waitFor({ timeout: 15_000 })
    const link = await campo.inputValue()
    const nota = await folha.innerText()
    await folha.getByRole("button", { name: "Fechar" }).click()
    return { link, nota }
  }

  const { link, nota } = await cunhar(a)
  const url = new URL(link)
  const [canalCodificado, codigo] = url.hash.slice(1).split("/")
  const canal = decodeURIComponent(canalCodificado ?? "")
  check("A cunha um link http(s) para o seu próprio anfitrião", url.origin === `http://${NOME}`, url.origin)
  check("o caminho é o literal /app/convite, sem query", url.pathname === "/app/convite" && url.search === "", url.pathname + url.search)
  check("o fragmento é canal/código, com um código de 32 caracteres", canal.startsWith("!") && /^[A-Za-z0-9_-]{32}$/.test(codigo ?? ""))
  check("a folha diz o cuidado a ter com o link", nota.includes("prazo curto"))
  check("e no browser não diz que o link abre no browser", !nota.includes("aplicação instalada"))

  const hash = createHash("sha256").update(codigo).digest("base64url")
  /*
    The code, in every form it could leave in without looking like itself: as-is
    (base64url), in the classic base64 alphabet (`+` and `/` instead of `-` and `_`),
    and encoded AGAIN in base64, both alphabets, which is what would show up if
    someone fed it to `btoa` on the way to a body or header. Without the trailing `=`,
    to catch the version with and without padding. What must emerge is the `sha256`
    of it, and we search for that separately, by verification.
  */
  const variantes = (segredo) => {
    const outraVez = Buffer.from(segredo, "utf8")
    return [
      segredo,
      segredo.replace(/-/g, "+").replace(/_/g, "/"),
      outraVez.toString("base64").replace(/=+$/, ""),
      outraVez.toString("base64url"),
    ]
  }
  const segredos = [...new Set(variantes(codigo))]
  const levouOSegredo = (saco) => saco.filter((linha) => segredos.some((segredo) => linha.includes(segredo)))

  // ---------------------------------------------------------------------------
  // 2. A CLEAN browser opens the link.
  // ---------------------------------------------------------------------------
  const redeB = []
  const ctxB = await browser.newContext(CONTEXTO)
  escutar(ctxB, redeB)
  const b = await ctxB.newPage()
  // Before any page script runs: what it sees when born.
  await b.addInitScript(() => {
    window.__aoNascer = { href: location.href }
  })
  await b.goto(link, { waitUntil: "domcontentloaded" })
  await b.getByPlaceholder("Como queres aparecer").waitFor({ timeout: 60_000 })

  const depois = await b.evaluate(() => ({ pathname: location.pathname, hash: location.hash, search: location.search, historia: history.length, nascer: window.__aoNascer.href }))
  check("(a) logo após o arranque o caminho é /app/", depois.pathname === "/app/", depois.pathname)
  check("(a) e o fragmento está vazio", depois.hash === "" && depois.search === "", `${depois.search}${depois.hash}`)
  check("(a) a página nasceu mesmo com o link inteiro (a limpeza é obra dela)", depois.nascer === link)
  // A new context is born at about:blank (1) and navigates to the link (2). A
  // third entry was the `pushState` which this CANNOT be.
  check("(a) a entrada do histórico foi substituída, e não empilhada", depois.historia <= 2, `length=${depois.historia}`)

  check("o portão diz que há um convite à espera", await b.getByText("Tens um convite à espera. Entra ou cria conta para o abrir.").isVisible())
  check("e não pergunta nada enquanto não há conta", !(await b.getByText("Convite para um canal").isVisible().catch(() => false)))

  const guardado = await b.evaluate(() => sessionStorage.getItem("enclave.convite-pendente"))
  check("o convite ficou no sessionStorage do separador", typeof guardado === "string" && JSON.parse(guardado).channel === canal)
  check("e não no localStorage", await b.evaluate((segredo) => !JSON.stringify({ ...localStorage }).includes(segredo), codigo))

  // Create account: the server comes from the production host; on localhost the screen
  // assumes 8448, so we pass it this run's address.
  await criarConta(b, { nome: "Bruno", frase: FRASE, servidor: NOME })
  await dentro(b)

  const titulo = b.getByRole("heading", { name: "Convite para um canal" })
  await titulo.waitFor({ timeout: 60_000 })
  const pergunta = await b.locator(".convite-chegado").innerText()
  if (process.env.ORWELL_CAPTURAS) await b.screenshot({ path: join(process.env.ORWELL_CAPTURAS, "convite-pergunta.png") })
  // The phrase from `invite.arrivedBody` (STE100, commit e862136): the name comes from the
  // link, could be fake, and is only confirmed after joining.
  check(
    "a pergunta diz que o nome do canal pode ser falso",
    pergunta.includes("O nome pode ser falso") && pergunta.includes("Só o confirmas depois de entrares"),
  )
  check("depois do portão, pergunta, e diz o servidor", pergunta.includes(NOME), pergunta.replace(/\s+/g, " ").slice(0, 120))
  const tramasAntes = redeB.filter((linha) => linha.startsWith("TRAMA>") && linha.includes("invite.redeem")).length
  check("NUNCA entra sozinho: antes do sim, nenhum invite.redeem saiu", tramasAntes === 0, `${tramasAntes}`)

  await b.getByRole("button", { name: "Entrar", exact: true }).click()
  await b.getByRole("heading", { name: "adega" }).waitFor({ timeout: 60_000 }).then(
    () => check("Entrar: o canal aparece e abre", true),
    (erro) => check("Entrar: o canal aparece e abre", false, erro.message.split("\n")[0]),
  )
  check("e o convite saiu do sessionStorage", (await b.evaluate(() => sessionStorage.getItem("enclave.convite-pendente"))) === null)

  const redimidos = redeB.filter((linha) => linha.startsWith("TRAMA>") && linha.includes("invite.redeem"))
  check("(b) saiu exactamente um invite.redeem", redimidos.length === 1, `${redimidos.length}`)
  check("(b) e o que ele leva é o sha256 do código", redimidos.length === 1 && redimidos[0].includes(hash))

  // ---------------------------------------------------------------------------
  // 3. Refusing does not redeem, and cleans up.
  // ---------------------------------------------------------------------------
  const segundo = await cunhar(a)
  for (const variante of variantes(new URL(segundo.link).hash.split("/")[1])) if (!segredos.includes(variante)) segredos.push(variante)
  const redeC = []
  const ctxC = await browser.newContext(CONTEXTO)
  escutar(ctxC, redeC)
  const c = await ctxC.newPage()
  await c.goto(segundo.link, { waitUntil: "domcontentloaded" })
  await criarConta(c, { nome: "Carla", frase: FRASE, servidor: NOME })
  await dentro(c)
  await c.getByRole("heading", { name: "Convite para um canal" }).waitFor({ timeout: 60_000 })
  await c.getByRole("button", { name: "Agora não" }).click()
  await c.waitForTimeout(3_000)
  check("(d) recusar não manda invite.redeem", redeC.filter((linha) => linha.startsWith("TRAMA>") && linha.includes("invite.redeem")).length === 0)
  check("(d) e limpa o sessionStorage", (await c.evaluate(() => sessionStorage.getItem("enclave.convite-pendente"))) === null)
  check("(d) o canal não aparece a quem recusou", !(await c.getByRole("heading", { name: "adega" }).isVisible().catch(() => false)))
  await c.reload({ waitUntil: "domcontentloaded" })
  await dentro(c)
  await c.waitForTimeout(2_000)
  check("(d) e recarregar não volta a perguntar", !(await c.getByRole("heading", { name: "Convite para um canal" }).isVisible().catch(() => false)))

  // ---------------------------------------------------------------------------
  // 4. The old link, pasted in, still joins. It's the same refused invite: the
  //    use of it is unspent, and the old form builds with the same pieces.
  // ---------------------------------------------------------------------------
  const urlDois = new URL(segundo.link)
  const [canalDois, codigoDois] = urlDois.hash.slice(1).split("/")
  const antigo = `enclave://join/${NOME}/${canalDois}#${codigoDois}`
  await c.locator("button.join-link").first().click()
  const campo = c.locator("form.prompt input").first()
  await campo.waitFor({ timeout: 10_000 })
  check("o exemplo do campo é um https, e não o esquema antigo", ((await campo.getAttribute("placeholder")) ?? "").startsWith("https://"))
  await campo.fill(antigo)
  await c.locator("form.prompt button.primary").first().click()
  await c.getByRole("heading", { name: "adega" }).waitFor({ timeout: 60_000 }).then(
    () => check("(c) um enclave:// antigo, colado, continua a entrar", true),
    (erro) => check("(c) um enclave:// antigo, colado, continua a entrar", false, erro.message.split("\n")[0]),
  )

  // ---------------------------------------------------------------------------
  // 5. From another server it does not redeem.
  // ---------------------------------------------------------------------------
  const antesDoAlheio = redeC.filter((linha) => linha.startsWith("TRAMA>") && linha.includes("invite.redeem")).length
  const alheio = `http://localhost:9999/app/convite#${encodeURIComponent("!x:localhost:9999")}/${"Z".repeat(32)}`
  await c.locator("button.join-link").first().click()
  await c.locator("form.prompt input").first().fill(alheio)
  await c.locator("form.prompt button.primary").first().click()
  await c.getByText("Só podes usar convites do teu servidor", { exact: false }).first().waitFor({ timeout: 10_000 }).then(
    () => check("um convite de outro servidor é recusado com a frase certa", true),
    () => check("um convite de outro servidor é recusado com a frase certa", false),
  )
  check("e não sai nenhum invite.redeem por causa dele", redeC.filter((linha) => linha.startsWith("TRAMA>") && linha.includes("invite.redeem")).length === antesDoAlheio)

  // ---------------------------------------------------------------------------
  // 5a. The forged name. A TRUE invite for the vault, with another channel's name
  //     written in the link: the server cannot catch it (it only sees the code hash).
  //     The prompt must say where the name came from, and whoever accepts must know
  //     they joined somewhere else.
  // ---------------------------------------------------------------------------
  const terceiro = await cunhar(a)
  const codigoTres = new URL(terceiro.link).hash.split("/")[1]
  for (const variante of variantes(codigoTres)) if (!segredos.includes(variante)) segredos.push(variante)
  const forjado = `http://${NOME}/app/convite#${encodeURIComponent(`!geral:${NOME}`)}/${codigoTres}`
  const ctxE = await browser.newContext(CONTEXTO)
  const e = await ctxE.newPage()
  await e.goto(forjado, { waitUntil: "domcontentloaded" })
  await criarConta(e, { nome: "Eva", frase: FRASE, servidor: NOME })
  await dentro(e)
  await e.getByRole("heading", { name: "Convite para um canal" }).waitFor({ timeout: 60_000 })
  const perguntaForjada = await e.locator(".convite-chegado").innerText()
  check(
    "nome forjado: a pergunta mostra o nome do link, e diz que pode ser falso",
    /"[^"]*geral[^"]*"/.test(perguntaForjada) && perguntaForjada.includes("O nome pode ser falso"),
    perguntaForjada.replace(/\s+/g, " ").slice(0, 160),
  )
  await e.getByRole("button", { name: "Entrar", exact: true }).click()
  await e.getByText("o nome que ele dizia não era o verdadeiro", { exact: false }).first().waitFor({ timeout: 60_000 }).then(
    () => check("nome forjado: quem aceita é avisado de que o canal que apareceu é outro", true),
    (erro) => check("nome forjado: quem aceita é avisado de que o canal que apareceu é outro", false, erro.message.split("\n")[0]),
  )
  check("nome forjado: e o canal verdadeiro está à vista na barra", await e.locator(".channel-name", { hasText: "adega" }).first().isVisible().catch(() => false))
  await ctxE.close()

  // ---------------------------------------------------------------------------
  // 5b. The gate on a phone, with the invite line on top. Just checks the line
  //     fits and doesn't cover the card; with ORWELL_CAPTURAS=<folder> it saves it.
  // ---------------------------------------------------------------------------
  const ctxD = await browser.newContext({ ...CONTEXTO, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const d = await ctxD.newPage()
  await d.goto(link, { waitUntil: "domcontentloaded" })
  await d.getByPlaceholder("Como queres aparecer").waitFor({ timeout: 60_000 })
  const medidas = await d.evaluate(() => {
    const linha = document.querySelector(".gate-convite").getBoundingClientRect()
    const cartao = document.querySelector(".gate-card").getBoundingClientRect()
    return { linha: { topo: linha.top, fundo: linha.bottom, esquerda: linha.left, direita: linha.right }, cartaoTopo: cartao.top, largura: innerWidth, rolagem: document.documentElement.scrollWidth }
  })
  check("a 390 px a linha do convite cabe no ecrã", medidas.linha.esquerda >= 0 && medidas.linha.direita <= medidas.largura && medidas.rolagem <= medidas.largura, JSON.stringify(medidas.linha))
  check("e não tapa o cartão do portão", medidas.linha.fundo <= medidas.cartaoTopo, `linha acaba em ${Math.round(medidas.linha.fundo)}, cartão começa em ${Math.round(medidas.cartaoTopo)}`)
  if (process.env.ORWELL_CAPTURAS) await d.screenshot({ path: join(process.env.ORWELL_CAPTURAS, "convite-portao-390.png") })
  await ctxD.close()

  // ---------------------------------------------------------------------------
  // 6. The secret, searched for in everything that left any of the three browsers and
  //    in everything the front end logged.
  // ---------------------------------------------------------------------------
  await b.waitForTimeout(1_000)
  for (const [nome, saco] of [["A (quem cunhou)", redeA], ["B (quem abriu o link)", redeB], ["C (quem recusou e depois colou)", redeC]]) {
    const fugas = levouOSegredo(saco)
    check(`(b) nenhum pedido, corpo, trama ou consola de ${nome} levou o código`, fugas.length === 0, fugas.length ? `${fugas.length} linhas, a 1.ª começa por "${fugas[0].slice(0, 40)}"` : `${saco.length} linhas vistas`)
  }
  const pedidosDeB = redeB.filter((linha) => linha.startsWith("PEDIDO"))
  check("(b) e B fez mesmo pedidos (a guarda olhou para alguma coisa)", pedidosDeB.length > 3 && redeB.some((linha) => linha.startsWith("TRAMA>")), `${pedidosDeB.length} pedidos`)

  const doConvite = acessos.filter((linha) => linha.includes("/app/convite"))
  check("o registo de acessos da frente viu o convite ser aberto", doConvite.length >= 2, `${doConvite.length}`)
  check("e só viu o caminho literal: nem canal, nem código, nem query", doConvite.every((linha) => linha === "GET /app/convite"), [...new Set(doConvite)].join(" | "))
  check("em registo de acessos nenhum aparece um código", levouOSegredo(acessos).length === 0)
  check("nem no que o homeserver escreveu para a consola", levouOSegredo([registoDoServidor]).length === 0)
  // The channel id is only searched HERE, in the access log. In the WebSocket frames
  // it travels legitimately (subscribe, send, `invite.create` itself): the server routes
  // by channel and always knows which. What the link promises is that opening it
  // doesn't tell whoever logs HTTP requests who it was for.
  const canalNoRegisto = acessos.filter((linha) => linha.includes(encodeURIComponent(canal)) || linha.includes(canal))
  check("e o id do canal também não passou por nenhum URL", canalNoRegisto.length === 0, canalNoRegisto[0]?.slice(0, 60) ?? "")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
await arrumar(passaram === results.length ? 0 : 1)
