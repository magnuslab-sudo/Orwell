/**
 * "Remember session" (F1), in a real browser, on all three engines.
 *
 *   node scripts/e2e-memorizar-sessao.mjs                    (all three engines)
 *   node scripts/e2e-memorizar-sessao.mjs chromium webkit    (only these)
 *
 * Requires `npm run build` first: serves `apps/web/dist` and runs
 * `apps/server/dist`.
 *
 * What we prove, in each engine, with a persistent browser profile (the
 * same IndexedDB after closing and reopening the browser):
 *
 * 1. Create the account with the box on (comes on by default). The vault on disk stays
 *    as it was (no new field) and the `sessao` entry sits beside it.
 * 2. Reload WITHOUT the tab key: enters without password.
 * 3. Close the browser and reopen: enters without password.
 * 4. Second tab: waits; the first closes and the second takes over without
 *    asking for the password.
 * 5. "Sign out" in the second tab: the gate asks for the password, the entry
 *    leaves IndexedDB, and a new tab also asks for it.
 * 6. Enter with the box OFF: reload asks for the password.
 * 7. The switch in Account › Session: turning it on hides "Expire session" and
 *    reload enters by itself; turning it off asks for the password again.
 *
 * Everything local and disposable: its own homeserver in a temp folder,
 * free ports, and no way to point it at production.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
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
for (const [o_que, caminho] of [["a web construída", join(DIST, "index.html")], ["o servidor construído", SERVIDOR_JS]]) {
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
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-memorizar-"))
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
const ESPERA = "Já tens o Orwell aberto noutro separador."

const configuracoes = (page) => page.getByRole("button", { name: "Configurações", exact: true }).first()
const dentro = (page, timeout = 90_000) => configuracoes(page).waitFor({ timeout })
const campoDaFrase = (page) => page.locator('.gate-card input[type="password"]')

/** What appears first: the app open, or the gate asking for the phrase. */
async function oQueAbre(page, timeout = 60_000) {
  const app = configuracoes(page)
  const frase = campoDaFrase(page)
  await app.or(frase).first().waitFor({ timeout })
  return (await app.count()) > 0 ? "dentro" : "pede-frase"
}

async function destrancar(page, { memorizar }) {
  await campoDaFrase(page).waitFor({ timeout: 30_000 })
  await campoDaFrase(page).fill(FRASE)
  const caixa = page.locator('input[name="memorizar"]')
  await caixa.waitFor({ timeout: 10_000 })
  await caixa.setChecked(memorizar)
  // Enter in the field, like typing: on WebKit, Enter with focus on the
  // box does not submit the form.
  await campoDaFrase(page).press("Enter")
  await dentro(page)
}

/** Reload without the tab key: only memory can open it. */
async function recarregarSemChaveDoSeparador(page) {
  await page.evaluate(() => sessionStorage.clear())
  await page.reload({ waitUntil: "domcontentloaded" })
}

/** The vault store keys and the shape of the envelope on disk. */
async function oQueEstaNoIndexedDB(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const pedido = indexedDB.open("enclave", 1)
        pedido.onerror = () => reject(pedido.error)
        pedido.onsuccess = () => {
          const store = pedido.result.transaction("vault", "readonly").objectStore("vault")
          const chaves = store.getAllKeys()
          const cofre = store.get("current")
          const sessao = store.get("sessao")
          sessao.onsuccess = () => {
            const bruto = cofre.result ? new TextDecoder().decode(cofre.result) : null
            const envelope = bruto ? JSON.parse(bruto.startsWith("orwv2\n") ? bruto.slice(6) : bruto) : null
            const registo = sessao.result
            resolve({
              chaves: [...chaves.result].map(String).sort(),
              camposDoCofre: envelope ? Object.keys(envelope).sort() : null,
              sessao: registo
                ? { via: registo.via, extraivel: registo.chave?.extractable, algoritmo: registo.chave?.algorithm?.name }
                : null,
            })
          }
          sessao.onerror = () => reject(sessao.error)
        }
      }),
  )
}

async function irAConta(page) {
  await configuracoes(page).click()
  await page.getByRole("button", { name: "Terminar sessão" }).waitFor({ timeout: 15_000 })
}

const resultadoPorMotor = {}

for (const nomeDoMotor of escolhidos) {
  const results = []
  const check = (nome, ok, detalhe = "") => {
    results.push(Boolean(ok))
    console.log(`${ok ? "  ok  " : " FALHA"} [${nomeDoMotor}] ${nome}${detalhe ? `  (${detalhe})` : ""}`)
  }
  const perfil = mkdtempSync(join(tmpdir(), `orwell-perfil-${nomeDoMotor}-`))
  perfis.push(perfil)
  const abrirBrowser = () => MOTORES[nomeDoMotor].launchPersistentContext(perfil, { headless: true, locale: "pt-PT" })
  let ctx
  const erros = []
  const vigiar = (c) => c.on("page", (page) => page.on("pageerror", (erro) => erros.push(String(erro?.message ?? erro))))
  try {
    ctx = await abrirBrowser()
    vigiar(ctx)
    // 1. Create the account, box on.
    const p1 = ctx.pages()[0] ?? (await ctx.newPage())
    p1.on("pageerror", (erro) => erros.push(String(erro?.message ?? erro)))
    await p1.goto(APP, { waitUntil: "domcontentloaded" })
    await criarConta(p1, { nome: "Ana", frase: FRASE, servidor: NOME, memorizar: true })
    await dentro(p1)
    let idb = await oQueEstaNoIndexedDB(p1)
    check("criar com a caixa ligada deixa o registo `sessao` ao lado do cofre", idb.sessao !== null, idb.chaves.join(","))
    check(
      "o registo é uma CryptoKey AES-GCM que não se exporta",
      idb.sessao?.via === "webcrypto" && idb.sessao?.extraivel === false && idb.sessao?.algoritmo === "AES-GCM",
      JSON.stringify(idb.sessao),
    )
    check(
      "o cofre em disco não ganhou campo nenhum",
      JSON.stringify(idb.camposDoCofre) === JSON.stringify(["ciphertext", "nonce", "protection", "salt", "version"]),
      JSON.stringify(idb.camposDoCofre),
    )

    // 2. Reload without the tab key.
    await recarregarSemChaveDoSeparador(p1)
    check("recarregar sem a chave do separador entra sem palavra-passe", (await oQueAbre(p1)) === "dentro")

    // 3. Close the browser and reopen it.
    await ctx.close()
    ctx = await abrirBrowser()
    vigiar(ctx)
    const p1b = ctx.pages()[0] ?? (await ctx.newPage())
    await p1b.goto(APP, { waitUntil: "domcontentloaded" })
    check("fechar o browser e reabrir entra sem palavra-passe", (await oQueAbre(p1b)) === "dentro")

    // 4. Second tab: waits, and takes over without phrase when the first closes.
    const p2 = await ctx.newPage()
    await p2.goto(APP, { waitUntil: "domcontentloaded" })
    check(
      "o segundo separador fica à espera",
      await p2.getByText(ESPERA).first().waitFor({ timeout: 15_000 }).then(
        () => true,
        () => false,
      ),
    )
    await p1b.close()
    check("o primeiro fecha e o segundo assume sem pedir a palavra-passe", (await oQueAbre(p2, 30_000)) === "dentro")

    // 5. "Sign out" in the second tab.
    await irAConta(p2)
    await p2.getByRole("button", { name: "Terminar sessão" }).click()
    // The Settings button is still on screen at the moment of click: wait for the gate.
    check(
      '"Terminar sessão" volta ao portão a pedir a palavra-passe',
      await campoDaFrase(p2).waitFor({ timeout: 30_000 }).then(
        () => true,
        () => false,
      ),
    )
    idb = await oQueEstaNoIndexedDB(p2)
    check("e o registo `sessao` saiu do IndexedDB", idb.sessao === null && idb.chaves.includes("current"), idb.chaves.join(","))
    const p3 = await ctx.newPage()
    await p3.goto(APP, { waitUntil: "domcontentloaded" })
    check("um separador novo à espera não abre nada", await p3.getByText(ESPERA).first().waitFor({ timeout: 15_000 }).then(() => true, () => false))
    await p2.close()
    check("e quando assume, pede a palavra-passe", (await oQueAbre(p3, 30_000)) === "pede-frase")

    // 6. A caixa desligada.
    await destrancar(p3, { memorizar: false })
    idb = await oQueEstaNoIndexedDB(p3)
    check("entrar com a caixa desligada não memoriza", idb.sessao === null)
    await recarregarSemChaveDoSeparador(p3)
    check("e recarregar sem a chave do separador pede a palavra-passe", (await oQueAbre(p3)) === "pede-frase")
    await destrancar(p3, { memorizar: false })

    // 7. The switch in Account › Session.
    await irAConta(p3)
    const interruptor = p3.getByRole("switch", { name: "Memorizar a sessão neste aparelho" })
    check("o interruptor está desligado", (await interruptor.getAttribute("aria-checked")) === "false")
    check('e "Expirar sessão" está à vista', (await p3.getByText("Expirar sessão").count()) > 0)
    await interruptor.click()
    await p3.waitForFunction(
      () => document.querySelector('[role="switch"][aria-checked="true"]') !== null,
      null,
      { timeout: 10_000 },
    )
    check('ligá-lo esconde "Expirar sessão", com a linha a dizer porquê', (await p3.getByText("Expirar sessão", { exact: true }).count()) === 0 && (await p3.getByText("a sessão não expira").count()) > 0)
    await recarregarSemChaveDoSeparador(p3)
    check("com o interruptor ligado, recarregar entra sozinho", (await oQueAbre(p3)) === "dentro")
    await irAConta(p3)
    await p3.getByRole("switch", { name: "Memorizar a sessão neste aparelho" }).click()
    await p3.waitForFunction(
      () => document.querySelector('[role="switch"][aria-checked="false"]:not([disabled])') !== null,
      null,
      { timeout: 10_000 },
    )
    idb = await oQueEstaNoIndexedDB(p3)
    check("desligá-lo apaga o registo", idb.sessao === null)
    await recarregarSemChaveDoSeparador(p3)
    check("e recarregar volta a pedir a palavra-passe", (await oQueAbre(p3)) === "pede-frase")

    check("nenhum erro de página", erros.length === 0, erros[0]?.slice(0, 120) ?? "")
  } catch (erro) {
    check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
    // What each tab showed, for whoever has to understand the failure.
    for (const page of ctx?.pages() ?? []) {
      const texto = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => "(sem página)")
      console.log(`    [${nomeDoMotor}] ecrã: ${texto.replace(/\s+/g, " ")}`)
    }
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
