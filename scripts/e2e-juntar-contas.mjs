/**
 * Phase 8.2, "Merge accounts", end to end, in four real browsers.
 *
 *   node scripts/e2e-juntar-contas.mjs        (needs `npm run build` first)
 *
 * Owner order (27/10/2026): "merge friends and channels, and merge nothing
 * else; the secondary account is destroyed and hidden from all spaces".
 *
 * The people: Ana is the extra account (the secondary). She is friends with
 * Bruno and is in a channel founded by Carla. Dora is the main account. All
 * four in desktop browsers (1200x860).
 *
 *  1. Race that fails: Ana opens "Merge another account", pastes Dora's link,
 *     types the new password and "delete", and Dora says "They are not the same".
 *     Ana stays whole: same account key on disk, channel in the sidebar; Bruno
 *     and Carla get no warning.
 *  2. Race that ends well: "They are the same" on both screens. Ana warns, exits
 *     everything, and the device becomes Dora's. Ana's password opens nothing
 *     more; the new one opens a device vault, no account private key.
 *  3. Bruno sees, once, "Ana became Dora" and "Add Dora?"; taps, Dora
 *     accepts, and Bruno has Dora in friends, Ana gone.
 *  4. Carla sees "Invite Dora to ...?"; taps, and Dora joins the channel
 *     with no action needed. Ana drops from Carla's member list.
 *
 * ALL LOCAL AND ALL DISPOSABLE, like `e2e-amizade-cruzada.mjs` and
 * `e2e-emparelhar-substituir.mjs`: its own homeserver with no community mode,
 * in a temp folder, ports 8456 and 8457 (this script only), and a frontend that
 * acts as Caddy. Takes no target by argument: never points at production. Ports
 * change by `E2E_PORTA_DA_FRENTE` and `E2E_PORTA_DO_SERVIDOR`.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { argon2id } from "@noble/hashes/argon2.js"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar, etiquetaDe } from "./convite.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const PORTA_DA_FRENTE = Number(process.env.E2E_PORTA_DA_FRENTE ?? 8456)
const PORTA_DO_SERVIDOR = Number(process.env.E2E_PORTA_DO_SERVIDOR ?? 8457)
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
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-juntar-contas-"))
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
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const FRASE_NOVA = "frase-nova-do-telemovel-2026"
const CAPTURAS = join(RAIZ, "capturas")

/** Wait until the condition is true, or time runs out. Returns whether it happened. */
async function ate(condicao, ms = 60_000, passo = 500) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await condicao().catch(() => false)) return true
    await espera(passo)
  }
  return false
}

/** A new account in its own context. Returns the page and the address. */
async function conta(nome, opcoes = {}) {
  const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1200, height: 860 }, ...opcoes })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (erro) => erros.push(erro.message))
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome, frase: FRASE, servidor: NOME })
  await dentro(page)
  const link = await meuLink(page)
  // The long connection (`/app/amigo#@<id>:<servidor>`) or the short one from 1.0 (`/a#<id>`, 5b).
  const longa = decodeURIComponent(link).match(/@[a-z0-9-]+:localhost:\d+/)?.[0]
  const curta = link.match(/\/a#([a-z0-9-]+)/)?.[1]
  const address = longa ?? (curta ? `@${curta}:${NOME}` : null)
  return { nome, ctx, page, address, link, erros }
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

/** Ask for friendship by the other's link. */
async function pedirAmizade(page, link) {
  await separador(page, "Encontrar")
  await page.getByLabel("Cola um link ou endereço").fill(link)
  await page.getByRole("button", { name: "Abrir perfil" }).click()
  const folha = page.locator(".person-profile")
  await folha.getByRole("button", { name: "Pedir amizade" }).click({ timeout: 15_000 })
  await page.keyboard.press("Escape")
}

/** The bell text, and tap a button in it (or just read). */
async function sino(page, botao = null) {
  await page.locator(".me-bell").first().click()
  const lista = page.locator(".notif-panel")
  await lista.waitFor({ timeout: 10_000 })
  const texto = (await lista.innerText().catch(() => "")).replace(/\s+/g, " ")
  let carregou = false
  if (botao) {
    const alvo = lista.getByRole("button", { name: botao, exact: true }).first()
    if (await alvo.isVisible().catch(() => false)) {
      await alvo.click()
      carregou = true
    }
  }
  await page.keyboard.press("Escape")
  return { texto, carregou }
}

/** The Friends title ("Friends (1)") and the list names. */
async function amigos(page) {
  await separador(page, "Todos")
  const titulo = await page.locator(".people-bar-title").innerText().catch(() => "")
  const corpo = await page.locator(".people-destination").innerText().catch(() => "")
  return { titulo, corpo }
}

/** The vault on disk (IndexedDB), opened with the phrase here in Node; `null` if it does not open. */
async function cofreDe(page, frase) {
  const bruto = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const pedido = indexedDB.open("enclave", 1)
        pedido.onerror = () => reject(pedido.error)
        pedido.onsuccess = () => {
          const leitura = pedido.result.transaction("vault", "readonly").objectStore("vault").get("current")
          leitura.onsuccess = () => resolve(leitura.result ? new TextDecoder().decode(leitura.result) : null)
          leitura.onerror = () => reject(leitura.error)
        }
      }),
  )
  if (!bruto) return null
  try {
    // The plaintext header from 1.0 (`orwv2` and a newline, chunk 2) before the JSON.
    const ficheiro = JSON.parse(bruto.startsWith("orwv2\n") ? bruto.slice(6) : bruto)
    const b64 = (texto) => Buffer.from(texto.replace(/-/g, "+").replace(/_/g, "/"), "base64")
    const chave = argon2id(new TextEncoder().encode(frase), b64(ficheiro.salt), { t: 3, m: 65_536, p: 4, dkLen: 32 })
    return JSON.parse(new TextDecoder().decode(xchacha20poly1305(chave, b64(ficheiro.nonce)).decrypt(b64(ficheiro.ciphertext))))
  } catch {
    return null
  }
}

/** On Dora: Settings, Devices, Add device. Returns the sheet and the link. */
async function abrirCaixa(pc) {
  await pc.getByRole("button", { name: "Configurações" }).first().click()
  await pc.getByRole("button", { name: "Aparelhos", exact: true }).click()
  await pc.getByRole("button", { name: "Acrescentar aparelho" }).click()
  const folha = pc.locator(".sheet").first()
  await folha.locator("code[data-link]").waitFor({ timeout: 20_000 })
  return { folha, link: await folha.locator("code[data-link]").getAttribute("data-link") }
}

/** On Ana: Devices, "Merge another account", up to the six words. Returns the sheet. */
async function juntarAteAsPalavras(tel, link) {
  await tel.getByRole("button", { name: "Configurações" }).first().click()
  await tel.getByRole("button", { name: "Aparelhos", exact: true }).click()
  await tel.getByRole("button", { name: "Juntar a outra conta" }).click()
  const folha = tel.locator(".juntar-contas")
  await folha.getByText("O que não passa: nem histórico, nem perfil, nem preferências.").waitFor({ timeout: 10_000 })
  await folha.getByRole("button", { name: "Começar" }).click()
  await folha.getByLabel("Ou cola o link").fill(link)
  await folha.getByRole("button", { name: "Continuar" }).click()
  const frases = folha.locator('input[type="password"]')
  await frases.nth(0).fill(FRASE_NOVA)
  await frases.nth(1).fill(FRASE_NOVA)
  await folha.getByRole("button", { name: "Continuar" }).click()
  const pergunta = tel.getByRole("alertdialog", { name: "Apagar a conta?" })
  await pergunta.getByLabel('Escreve "apagar" para confirmar').fill("apagar")
  await pergunta.getByRole("button", { name: "Apagar para sempre" }).click()
  await folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  return folha
}

/** Is the channel in the sidebar? */
async function temCanal(page, etiqueta) {
  await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  return page.locator(".channel-list .channel-name", { hasText: etiqueta }).first().isVisible().catch(() => false)
}

/** The channel members, the way the list shows them. */
async function membros(page, etiqueta) {
  await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  await page.locator(".channel-list .channel-name", { hasText: etiqueta }).first().click()
  await page.locator(".member-list").first().waitFor({ timeout: 10_000 }).catch(() => {})
  return (await page.locator(".member-list").first().innerText().catch(() => "")).replace(/\s+/g, " ")
}

mkdirSync(CAPTURAS, { recursive: true })

try {
  browser = await chromium.launch({ headless: true })
  const ana = await conta("Ana")
  const bruno = await conta("Bruno")
  const carla = await conta("Carla")
  const dora = await conta("Dora")
  check("quatro contas, cada uma com endereço", [ana, bruno, carla, dora].every((c) => c.address), [ana, bruno, carla, dora].map((c) => c.address).join(" "))

  // The setup: Ana friends with Bruno, in Carla's channel.
  await pedirAmizade(ana.page, bruno.link)
  const aceitou = await ate(async () => (await sino(bruno.page, "Aceitar")).carregou, 60_000, 2_000)
  check("o Bruno aceita o pedido da Ana", aceitou)
  check("a Ana e o Bruno são amigos", await ate(async () => (await amigos(ana.page)).titulo === "Amigos (1)", 60_000, 2_000))

  const SALA = `juntar-${Date.now().toString(36)}`
  const ETIQUETA = etiquetaDe(SALA)
  await carla.page.getByRole("button", { name: "Comunidades", exact: true }).first().click()
  await carla.page.getByRole("button", { name: "Criar canal", exact: true }).first().click()
  await carla.page.locator('input[placeholder="geral"]').fill(SALA)
  await carla.page.getByRole("button", { name: "Confirmar" }).click()
  await espera(4_000)
  check("a Carla convida a Ana para o canal", await convidar(carla.page, ETIQUETA, ana.address))
  check("a Ana entra no canal da Carla", await aceitarConvite(ana.page, ETIQUETA))
  const chaveDaAna = (await cofreDe(ana.page, FRASE))?.signingPrivateKey ?? null
  check("a Ana tem a conta neste browser, com a chave privada", chaveDaAna?.length === 43)

  // 1. The race that fails: Dora says "They are not the same".
  const primeira = await abrirCaixa(dora.page)
  const folhaAna = await juntarAteAsPalavras(ana.page, primeira.link)
  await primeira.folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  check('as seis palavras aparecem nos dois ecrãs, depois do "apagar" escrito', true)
  await folhaAna.getByRole("button", { name: "São as mesmas" }).click()
  await primeira.folha.getByRole("button", { name: "Não são" }).click()
  const erro = await folhaAna.getByRole("alert").waitFor({ timeout: 30_000 }).then(() => true, () => false)
  check("a Ana vê que o emparelhamento falhou", erro)
  await ana.page.screenshot({ path: join(CAPTURAS, "juntar-contas-falhou.png") })
  check("depois da falha, a palavra-passe da Ana abre a mesma conta", (await cofreDe(ana.page, FRASE))?.signingPrivateKey === chaveDaAna)
  check("e a palavra-passe nova não abre nada", (await cofreDe(ana.page, FRASE_NOVA)) === null)
  await folhaAna.getByRole("button", { name: "Voltar" }).click()
  await primeira.folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await dora.page.keyboard.press("Escape").catch(() => {})
  await espera(3_000)
  check("a Ana continua no canal da Carla", await temCanal(ana.page, ETIQUETA))
  const sinoDoBrunoAntes = await sino(bruno.page)
  check("o Bruno não recebeu aviso nenhum", !sinoDoBrunoAntes.texto.includes("passou a ser"), sinoDoBrunoAntes.texto.slice(0, 80))
  check("a Ana continua amiga do Bruno", (await amigos(bruno.page)).titulo === "Amigos (1)")

  // 2. The race that ends well.
  await dora.page.goto(APP, { waitUntil: "domcontentloaded" })
  await dentro(dora.page)
  const segunda = await abrirCaixa(dora.page)
  await ana.page.keyboard.press("Escape").catch(() => {})
  const folhaAna2 = await juntarAteAsPalavras(ana.page, segunda.link)
  await segunda.folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await folhaAna2.getByRole("button", { name: "São as mesmas" }).click()
  await segunda.folha.getByRole("button", { name: "São as mesmas" }).click()
  const juntas = await folhaAna2.getByText("Contas juntas").waitFor({ timeout: 120_000 }).then(() => true, () => false)
  // Dora's sheet lands on "done": it closes, so her bell can open.
  await segunda.folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await dora.page.keyboard.press("Escape").catch(() => {})
  check("a Ana avisa, sai de tudo, e o aparelho passa a ser da Dora", juntas)
  await ana.page.screenshot({ path: join(CAPTURAS, "juntar-contas-feito.png") })
  check("a palavra-passe da Ana já não abre nada: a chave dela saiu", (await cofreDe(ana.page, FRASE)) === null)
  const novo = await cofreDe(ana.page, FRASE_NOVA)
  check("a nova abre um cofre de aparelho: chave pública de conta, certificado, sem a privada", novo?.signingPrivateKey === "" && novo?.accountPublicKey?.length === 43 && novo?.deviceCert?.length === 86)

  // 3. Bruno: the notification, once, and the ring.
  let sinoDoBruno = { texto: "" }
  // Bruno never saw Dora's profile: the bell tells him by the address.
  const avisado = await ate(async () => (sinoDoBruno = await sino(bruno.page)).texto.includes(`Ana passou a ser ${dora.address}`), 60_000, 2_000)
  check('o Bruno vê "Ana passou a ser @dora", com quem o diz', avisado && sinoDoBruno.texto.includes("Quem o diz é a conta Ana"), sinoDoBruno.texto.slice(0, 160))
  check('e "Adicionar @dora?"', sinoDoBruno.texto.includes(`Adicionar ${dora.address}?`))
  check('o Bruno carrega em "Adicionar"', (await sino(bruno.page, "Adicionar")).carregou)
  const doraAceitou = await ate(async () => (await sino(dora.page, "Aceitar")).carregou, 60_000, 2_000)
  check("a Dora aceita o pedido do Bruno", doraAceitou)
  let listaDoBruno = { titulo: "", corpo: "" }
  const soDora = await ate(async () => {
    listaDoBruno = await amigos(bruno.page)
    return listaDoBruno.titulo === "Amigos (1)" && listaDoBruno.corpo.includes("Dora") && !/\bAna\b/.test(listaDoBruno.corpo)
  }, 60_000, 2_000)
  check("o Bruno tem a Dora nos amigos, e a Ana desapareceu (amigos e conversas)", soDora, listaDoBruno.corpo.slice(0, 120))
  check('a oferta não volta: o sino do Bruno já não oferece "Adicionar"', !(await sino(bruno.page)).texto.includes("Adicionar "))

  // 4. A Carla: o aviso, o convite, e a Dora entra sozinha.
  let sinoDaCarla = { texto: "" }
  await ate(async () => (sinoDaCarla = await sino(carla.page)).texto.includes(`Convidar ${dora.address} para`), 60_000, 2_000)
  check('a Carla vê "Convidar @dora para ...?"', sinoDaCarla.texto.includes(`Convidar ${dora.address} para`), sinoDaCarla.texto.slice(0, 160))
  check('a Carla carrega em "Convidar"', (await sino(carla.page, "Convidar")).carregou)
  const doraEntrou = await ate(async () => (await temCanal(dora.page, ETIQUETA)) || (await temCanal(ana.page, ETIQUETA)), 90_000, 3_000)
  check("a Dora entra no canal sem tocar em nada", doraEntrou)
  let lista = ""
  const semAna = await ate(async () => {
    lista = await membros(carla.page, ETIQUETA)
    return lista.includes("Dora") && !/\bAna\b/.test(lista)
  }, 60_000, 3_000)
  check("nos membros da Carla está a Dora, e a Ana não", semAna, lista.slice(0, 120))

  const erros = [ana, bruno, carla, dora].flatMap((c) => c.erros)
  check("nenhum erro de página nos quatro browsers", erros.length === 0, erros[0]?.slice(0, 80) ?? "")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  // For the reader of the failure: the entire message (says the locator) and each person's screen.
  console.log(String(erro?.message ?? erro).split("\n").slice(0, 6).join("\n"))
  for (const [i, ctx] of (browser?.contexts() ?? []).entries()) {
    await ctx.pages()[0]?.screenshot({ path: join(CAPTURAS, `juntar-contas-erro-${i}.png`) }).catch(() => {})
  }
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
await arrumar(passaram === results.length ? 0 : 1)
