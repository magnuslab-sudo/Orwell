/**
 * Phase 1e: the profile the same across all devices on the account, in two browsers.
 *
 *   node scripts/e2e-perfil-entre-aparelhos.mjs          (needs `npm run build` first)
 *
 * Owner report (27/10/2026): "I log into the app: I do not have the same
 * profile picture I had in the browser".
 *
 * What is proved, by the buttons someone presses: Ana creates an account on
 * the computer and puts a picture in the profile (Settings, Account, Edit
 * profile). Then she pairs a phone via the link (Settings, Devices, Add device;
 * the QR via camera is proved in `e2e-emparelhar.mjs`). Without the person
 * doing anything else:
 *  - the phone's vault has the SAME picture and same name as the computer;
 *  - the phone's screen shows that picture;
 *  - the warning "Your profile has not arrived yet" does not appear;
 *  - and a name change on the computer reaches the phone via the account channel.
 *
 * ALL LOCAL AND ALL DISPOSABLE, following the pattern of `e2e-emparelhar.mjs`:
 * its own homeserver in a temp folder, a front that acts as Caddy, ports 8466
 * and 8467 (only for this script), and no way to point it at production.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { argon2id } from "@noble/hashes/argon2.js"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { irParaEmparelhar } from "./fase7-comum.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const PORTA_DA_FRENTE = 8466
const PORTA_DO_SERVIDOR = 8467
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
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-perfil-entre-aparelhos-"))
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
const NOME_NOVO = "Ana Maria"
const AVISO_DO_PERFIL = "O teu perfil ainda não chegou do aparelho principal."

/** Wait until the condition is true, or time runs out. Returns whether it happened. */
async function ate(condicao, ms = 60_000, passo = 1_000) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await condicao().catch(() => false)) return true
    await wait(passo)
  }
  return false
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


/** Open the profile editor: Settings, Account, Edit profile. */
async function editorDoPerfil(page) {
  await page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await page.getByRole("button", { name: "Conta", exact: true }).first().click()
  await page.getByRole("button", { name: "Editar perfil" }).first().click()
  const folha = page.locator(".sheet").first()
  await folha.waitFor({ timeout: 15_000 })
  return folha
}

try {
  browserPc = await chromium.launch({ headless: true })

  // ---------------------------------------------------------------------------
  // 1. Ana, on the computer: account and a picture in the profile.
  // ---------------------------------------------------------------------------
  const redePc = []
  const ctxPc = await browserPc.newContext(CONTEXTO)
  escutar(ctxPc, redePc)
  const pc = await ctxPc.newPage()
  await pc.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(pc, { nome: "Ana", frase: FRASE, servidor: NOME })
  await dentro(pc)
  check("a Ana cria conta no computador", true)

  // A real picture: a 96 px PNG drawn on a canvas.
  const png = await pc.evaluate(() => {
    const canvas = document.createElement("canvas")
    canvas.width = 96
    canvas.height = 96
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = "#b03a2e"
    ctx.fillRect(0, 0, 96, 96)
    ctx.fillStyle = "#f4d03f"
    ctx.beginPath()
    ctx.arc(48, 48, 30, 0, Math.PI * 2)
    ctx.fill()
    return canvas.toDataURL("image/png").split(",")[1]
  })
  let folha = await editorDoPerfil(pc)
  await folha.locator('input[type="file"][accept^="image/"]').first().setInputFiles({ name: "cara.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") })
  await folha.locator(".avatar-preview img").waitFor({ timeout: 15_000 })
  await folha.getByRole("button", { name: "Guardar" }).click()
  await folha.waitFor({ state: "detached", timeout: 15_000 }).catch(() => {})
  await pc.keyboard.press("Escape").catch(() => {})
  let retratoDoPc = ""
  check(
    "o cofre do computador tem a fotografia no perfil",
    await ate(async () => {
      retratoDoPc = (await cofreDe(pc, FRASE)).profile?.avatarDataUrl ?? ""
      return retratoDoPc.startsWith("data:image/")
    }, 20_000),
    `${retratoDoPc.length} caracteres`,
  )

  // ---------------------------------------------------------------------------
  // 2. Add device: the link.
  // ---------------------------------------------------------------------------
  await pc.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await pc.getByRole("button", { name: "Aparelhos", exact: true }).click()
  await pc.getByRole("button", { name: "Acrescentar aparelho" }).click()
  folha = pc.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")
  check("o computador mostra o link de emparelhamento", Boolean(link))

  // ---------------------------------------------------------------------------
  // 3. The phone, in a new browser, pastes the link.
  // ---------------------------------------------------------------------------
  browserTel = await chromium.launch({ headless: true })
  const redeTel = []
  const ctxTel = await browserTel.newContext({ ...CONTEXTO, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  escutar(ctxTel, redeTel)
  const tel = await ctxTel.newPage()
  await tel.goto(APP, { waitUntil: "domcontentloaded" })
  await irParaEmparelhar(tel)
  await tel.getByRole("heading", { name: "Emparelhar este aparelho" }).waitFor({ timeout: 10_000 })
  await tel.getByLabel("Ou cola o link").fill(link)
  await tel.getByRole("button", { name: "Continuar" }).click()
  await tel.getByRole("heading", { name: "Palavra-passe deste aparelho" }).waitFor({ timeout: 10_000 })
  const frases = tel.locator('.gate-card input[type="password"]')
  await frases.nth(0).fill(FRASE)
  await frases.nth(1).fill(FRASE)
  await tel.getByRole("button", { name: "Continuar" }).click()
  await tel.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await tel.getByRole("button", { name: "São as mesmas" }).click()
  await folha.getByRole("button", { name: "São as mesmas" }).click()
  await tel.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 })
  const textoFinal = await tel.locator(".gate-card").innerText()
  check("o telemóvel entra na conta, e o estado chegou inteiro", !textoFinal.includes("não chegou a tempo"))
  await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await tel.getByRole("button", { name: "Entrar", exact: true }).click()
  await dentro(tel)

  // ---------------------------------------------------------------------------
  // 4. The phone's profile, without the person doing anything.
  // ---------------------------------------------------------------------------
  const cofreTel = await cofreDe(tel, FRASE)
  check("o cofre do telemóvel tem o MESMO retrato do computador", cofreTel.profile?.avatarDataUrl === retratoDoPc, `${cofreTel.profile?.avatarDataUrl?.length ?? 0} caracteres`)
  check("e o mesmo nome", cofreTel.profile?.displayName === "Ana", cofreTel.profile?.displayName)
  check(
    "o ecrã do telemóvel mostra esse retrato",
    await ate(async () => tel.evaluate((src) => [...document.querySelectorAll("img")].some((img) => img.getAttribute("src") === src), retratoDoPc), 20_000),
  )
  check("o aviso de perfil por chegar não aparece", !(await tel.getByText(AVISO_DO_PERFIL).isVisible().catch(() => false)))

  // ---------------------------------------------------------------------------
  // 5. A change on the computer reaches the phone via the account channel.
  // ---------------------------------------------------------------------------
  await pc.keyboard.press("Escape").catch(() => {})
  folha = await editorDoPerfil(pc)
  const nome = folha.getByLabel("Nome", { exact: true })
  await nome.fill(NOME_NOVO)
  await folha.getByRole("button", { name: "Guardar" }).click()
  await folha.waitFor({ state: "detached", timeout: 15_000 }).catch(() => {})
  let nomeNoTel = ""
  check(
    "o nome novo do computador chega ao cofre do telemóvel",
    await ate(async () => {
      nomeNoTel = (await cofreDe(tel, FRASE)).profile?.displayName ?? ""
      return nomeNoTel === NOME_NOVO
    }, 90_000, 2_000),
    nomeNoTel,
  )
  check("e o retrato fica", (await cofreDe(tel, FRASE)).profile?.avatarDataUrl === retratoDoPc)
  // In the DOM, not "visible": at 390 px the account banner is inside the closed drawer.
  check(
    "e entra no ecrã do telemóvel sem recarregar",
    await ate(async () => tel.evaluate((nome) => document.body.textContent?.includes(nome) ?? false, NOME_NOVO), 30_000),
  )
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
await arrumar(passaram === results.length ? 0 : 1)
