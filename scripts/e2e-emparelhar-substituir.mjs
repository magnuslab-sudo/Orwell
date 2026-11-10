/**
 * "Sign in with another account" via pairing, on a device that ALREADY HAS an
 * account (core 1j: the temporary vault).
 *
 *   node scripts/e2e-emparelhar-substituir.mjs     (needs `npm run build` first)
 *
 * The bug: the local account was deleted on "delete" BEFORE the link was created.
 * A pairing that failed after left the phone with no account at all. Now pairing
 * runs in a temporary vault, in memory, and the local account only leaves disk
 * when the new one enters.
 *
 * What gets tested, on two real browsers:
 *
 *  1. Ana has the account on the computer. Carla has a DIFFERENT account on the phone.
 *  2. A run that fails halfway: on the phone gate, "Sign in with another account",
 *     "Pair", the link, the new password, "delete" confirmed, the six words on
 *     both screens, and the computer says "They don't match". The phone shows the
 *     error; the vault on disk is still Carla's, byte for byte; "Back" goes to
 *     the gate, and Carla's password opens her account.
 *  3. A run that completes: the same path, "They match" on both screens. The phone
 *     enters Ana's account; the vault on disk opens with the new password, is a
 *     device vault (without the account's private key), and Carla's password
 *     opens nothing.
 *
 * ALL LOCAL AND ALL DISPOSABLE, like the `e2e-emparelhar.mjs` it comes from:
 * a homeserver in a temp folder, a front end acting as Caddy, its own ports,
 * and no way to point it to production.
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

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const CAPTURAS = join(RAIZ, "capturas")
const PORTA_DA_FRENTE = 8476
const PORTA_DO_SERVIDOR = 8477
const NOME = `localhost:${PORTA_DA_FRENTE}`
const SALA_COMUM = `!orwell:${NOME}`
const APP = `http://${NOME}/app/?lingua=pt`
const FRASE = "frase-de-verificacao-2026"
const FRASE_CARLA = "frase-da-carla-2026"
const FRASE_NOVA = "frase-nova-do-telemovel-2026"

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
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-emparelhar-substituir-"))
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

mkdirSync(CAPTURAS, { recursive: true })

/** The vault bytes on the phone's disk (IndexedDB), as they are. */
async function bytesDoCofre(page) {
  return page.evaluate(
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
}

/** Does the passphrase open the disk vault? */
async function abre(page, frase) {
  return cofreDe(page, frase).then(() => true, () => false)
}

/**
 * A new tab on the phone, at the gate. The tab's key lives in `sessionStorage`,
 * so a new tab asks for the password; and the old tab closes first, because
 * a browser has one owner.
 */
async function portaoNovo(ctx, anterior) {
  await anterior?.close()
  const page = await ctx.newPage()
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await page.getByRole("heading", { name: "Bem-vindo de volta" }).waitFor({ timeout: 60_000 })
  return page
}

/** On the computer: Settings, Devices, Add device. Returns the sheet and the link. */
async function abrirCaixa(pc) {
  await pc.getByRole("button", { name: "Configurações" }).first().click()
  await pc.getByRole("button", { name: "Aparelhos", exact: true }).click()
  await pc.getByRole("button", { name: "Acrescentar aparelho" }).click()
  const folha = pc.locator(".sheet").first()
  await folha.locator("code[data-link]").waitFor({ timeout: 20_000 })
  return { folha, link: await folha.locator("code[data-link]").getAttribute("data-link") }
}

/** On the phone, from gate to six words: another account, pair, link, new key, "delete". */
async function ateAsPalavras(tel, link) {
  await tel.getByRole("button", { name: "Entrar com outra conta" }).click()
  await tel.getByRole("dialog", { name: "Entrar com outra conta" }).getByRole("button", { name: "Emparelhar com o aparelho principal" }).click()
  await tel.getByLabel("Ou cola o link").fill(link)
  await tel.getByRole("button", { name: "Continuar" }).click()
  await tel.getByRole("heading", { name: "Palavra-passe deste aparelho" }).waitFor({ timeout: 10_000 })
  const frases = tel.locator('.gate-card input[type="password"]')
  await frases.nth(0).fill(FRASE_NOVA)
  await frases.nth(1).fill(FRASE_NOVA)
  await tel.getByRole("button", { name: "Continuar" }).click()
  const pergunta = tel.getByRole("alertdialog", { name: "Apagar a conta?" })
  await pergunta.getByLabel('Escreve "apagar" para confirmar').fill("apagar")
  await pergunta.getByRole("button", { name: "Apagar para sempre" }).click()
  await tel.locator(".sas-palavras").waitFor({ timeout: 30_000 })
}

try {
  browser = await chromium.launch({ headless: true })

  // 1. Ana on the computer; Carla, with another account, on the phone.
  const redePc = []
  const ctxPc = await browser.newContext(CONTEXTO)
  escutar(ctxPc, redePc)
  const pc = await ctxPc.newPage()
  await pc.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(pc, { nome: "Ana", frase: FRASE, servidor: NOME })
  await dentro(pc)
  check("a Ana cria conta no computador", true)

  const redeTel = []
  const ctxTel = await browser.newContext({ ...CONTEXTO, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  escutar(ctxTel, redeTel)
  let tel = await ctxTel.newPage()
  await tel.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(tel, { nome: "Carla", frase: FRASE_CARLA, servidor: NOME })
  await dentro(tel)
  await wait(1500)
  const carlaAntes = await cofreDe(tel, FRASE_CARLA)
  check("a Carla cria OUTRA conta no telemóvel (é um aparelho principal: tem a chave privada)", carlaAntes.signingPrivateKey?.length === 43)

  // 2. The run that fails halfway: the computer says "They don't match".
  tel = await portaoNovo(ctxTel, tel)
  const discoAntes = await bytesDoCofre(tel)
  const primeira = await abrirCaixa(pc)
  await ateAsPalavras(tel, primeira.link)
  await primeira.folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  check('as seis palavras aparecem nos dois ecrãs, depois do "apagar" escrito', true)
  check("com o emparelhamento a decorrer, o cofre no disco continua a ser o da Carla, byte a byte", (await bytesDoCofre(tel)) === discoAntes)
  await tel.getByRole("button", { name: "São as mesmas" }).click()
  await primeira.folha.getByRole("button", { name: "Não são" }).click()
  const falhou = await tel.getByRole("heading", { name: "O emparelhamento falhou" }).waitFor({ timeout: 30_000 }).then(() => true, () => false)
  check("o telemóvel mostra que o emparelhamento falhou", falhou)
  await tel.screenshot({ path: join(CAPTURAS, "emparelhar-substituir-falhou.png") })
  check("depois da falha, o cofre no disco continua a ser o da Carla, byte a byte", (await bytesDoCofre(tel)) === discoAntes)
  check("e a palavra-passe nova não abre nada", !(await abre(tel, FRASE_NOVA)))
  await tel.getByRole("button", { name: "Voltar" }).click()
  const noPortao = await tel.getByRole("heading", { name: "Bem-vindo de volta" }).waitFor({ timeout: 15_000 }).then(() => true, () => false)
  check('o "Voltar" leva ao portão da conta de cá, e não ao princípio', noPortao)
  await tel.locator('.gate-card input[type="password"]').first().fill(FRASE_CARLA)
  await tel.getByRole("button", { name: "Entrar", exact: true }).click()
  await dentro(tel)
  await wait(1000)
  const carlaDepois = await cofreDe(tel, FRASE_CARLA)
  check("a palavra-passe da Carla abre a conta dela, com a mesma chave de conta", carlaDepois.signingPrivateKey === carlaAntes.signingPrivateKey)
  await primeira.folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await pc.keyboard.press("Escape").catch(() => {})

  // 3. The run that completes.
  tel = await portaoNovo(ctxTel, tel)
  await pc.goto(APP, { waitUntil: "domcontentloaded" })
  await dentro(pc)
  const segunda = await abrirCaixa(pc)
  await ateAsPalavras(tel, segunda.link)
  await segunda.folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await tel.getByRole("button", { name: "São as mesmas" }).click()
  await segunda.folha.getByRole("button", { name: "São as mesmas" }).click()
  const entrou = await tel.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 }).then(() => true, () => false)
  check("o telemóvel recebeu o certificado, ligou-se e gravou a conta nova", entrou)
  await tel.getByRole("button", { name: "Entrar", exact: true }).click()
  await dentro(tel)
  await wait(1500)
  const novo = await cofreDe(tel, FRASE_NOVA).catch(() => null)
  check("o cofre no disco abre com a palavra-passe nova", novo !== null)
  check("e é um cofre de aparelho: chave pública de conta, certificado, sem a privada", novo?.signingPrivateKey === "" && novo?.accountPublicKey?.length === 43 && novo?.deviceCert?.length === 86)
  check("a palavra-passe da Carla já não abre nada: a conta dela saiu no fim", !(await abre(tel, FRASE_CARLA)))

  const erros = [...redePc, ...redeTel].filter((l) => l.startsWith("PAGEERROR"))
  check("nenhum erro de página nos dois browsers", erros.length === 0, erros[0]?.slice(0, 80) ?? "")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
await arrumar(passaram === results.length ? 0 : 1)
