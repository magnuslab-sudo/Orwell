/**
 * The gate in midnight skin, captured and checked live.
 *
 *   npm run build && node scripts/retratar-portao.mjs
 *
 * Opens the built app (`apps/web/dist`) against a disposable homeserver and saves to `capturas/`:
 *
 *   midnight-portao.png             log in with password (1280 × 800)
 *   midnight-portao-nome.png        create account: name prompt
 *   midnight-portao-criar.png       create account: password prompt
 *   midnight-portao-importar.png    import account: file chosen, wrong passphrase, error with code
 *   midnight-portao-emparelhar.png  pair this device (QR and link)
 *   midnight-portao-separador.png   Orwell open in another tab
 *   midnight-saiu-de-beta.png       a beta vault: "Orwell is out of beta."
 *   midnight-portao-390.png         log in, at 390 px
 *   midnight-abrir-1.png … -3.png   three frames of the startup
 *   midnight-abrir-reduzido.png     startup with reduced motion
 *   midnight-abrir-saida.png        startup at 30 s, with the "Reload" link
 *
 * And verifies: startup doesn't say how long; the link appears only at 30 s; the ring spins and the banners light up (with reduced motion the ring still spins, slower, since October 27, 2026, and the banners stay lit); the card has a border, 18 px corners and near-solid ink without blur; primary is a gradient; nothing scrolls horizontally at 390 px; no request leaves 127.0.0.1. With a beta vault: the cutover screen without password field, and the button wipes the vault without opening it and opens Setup.
 *
 * For startup to stay on screen, the script hangs IndexedDB (an `open` that never responds): it is exactly the stuck startup that the emergency exit serves.
 *
 * ALL LOCAL, following the pattern in `retratar-midnight.mjs`.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
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
const CAPTURAS = join(RAIZ, "capturas")
const PORTA_DA_FRENTE = 8486
const PORTA_DO_SERVIDOR = 8487
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`
const LARGO = { width: 1280, height: 800 }
const TELEMOVEL = { width: 390, height: 844 }

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
const dados = mkdtempSync(join(tmpdir(), "orwell-portao-"))
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
servidor.stdout.on("data", (bocado) => (registoDoServidor += bocado))
servidor.stderr.on("data", (bocado) => (registoDoServidor += bocado))

// --- The frontend that acts as Caddy. ----------------------------------------
const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".wasm": "application/wasm",
}
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
  const adiante = http.request(
    { host: "127.0.0.1", port: PORTA_DO_SERVIDOR, path: pedido.url, method: pedido.method, headers: pedido.headers },
    (vinda) => {
      resposta.writeHead(vinda.statusCode ?? 502, vinda.headers)
      vinda.pipe(resposta)
    },
  )
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fora = []

async function retratar(page, nome) {
  const ficheiro = join(CAPTURAS, `midnight-${nome}.png`)
  await page.screenshot({ path: ficheiro })
  console.log(`  ..  captura: ${ficheiro}`)
}

const semRolagemHorizontal = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

async function novoContexto(viewport = LARGO, extra = {}) {
  const ctx = await browser.newContext({ locale: "pt-PT", viewport, ...extra })
  ctx.on("request", (pedido) => {
    const url = new URL(pedido.url())
    if (!["localhost", "127.0.0.1"].includes(url.hostname) && url.protocol !== "data:" && url.protocol !== "blob:") {
      fora.push(pedido.url())
    }
  })
  return ctx
}

/** IndexedDB hung: an `open` that never responds. Startup stays on screen. */
const PENDURAR_O_COFRE = () => {
  const pendente = () => ({ onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, addEventListener() {}, removeEventListener() {} })
  indexedDB.open = () => pendente()
}

/** The style of the gate card, as the browser calculates it. */
const estiloDoCartao = (page) =>
  page.evaluate(() => {
    const cartao = document.querySelector(".gate-card")
    const primario = document.querySelector(".gate .primary")
    if (!cartao) return null
    const c = getComputedStyle(cartao)
    return {
      canto: c.borderTopLeftRadius,
      contorno: c.borderTopColor,
      largura: c.borderTopWidth,
      primario: primario ? getComputedStyle(primario).backgroundImage : "",
      desfoca: [getComputedStyle(cartao), getComputedStyle(cartao, "::before")].some((e) => e.backdropFilter && e.backdropFilter !== "none"),
      tinta: c.backgroundColor,
    }
  })

mkdirSync(CAPTURAS, { recursive: true })

try {
  browser = await chromium.launch({ headless: true })

  // ------------------------------------------------------------ a abertura
  {
    const ctx = await novoContexto(LARGO)
    await ctx.addInitScript(PENDURAR_O_COFRE)
    const page = await ctx.newPage()
    await page.goto(APP, { waitUntil: "domcontentloaded" })
    await page.locator(".abertura").waitFor({ timeout: 30_000 })
    await page.evaluate(() => document.fonts.ready)
    const texto = await page.locator(".abertura").innerText()
    check('a abertura diz "A abrir…"', texto.includes("A abrir…"), texto.replace(/\s+/g, " "))
    check("e não diz que demora", !/demor/i.test(texto))
    check("sem o link antes dos 30 s", (await page.getByRole("button", { name: "Recarregar" }).count()) === 0)
    const fotogramas = []
    for (const n of [1, 2, 3]) {
      await wait(n === 1 ? 200 : 650)
      await retratar(page, `abrir-${n}`)
      fotogramas.push(
        await page.evaluate(() => ({
          anel: getComputedStyle(document.querySelector(".abertura-anel"), "::after").transform,
          tarjas: [...document.querySelectorAll(".abertura-marca path")].map((p) => getComputedStyle(p).opacity).join(","),
        })),
      )
    }
    check("o anel gira", new Set(fotogramas.map((f) => f.anel)).size > 1, fotogramas.map((f) => f.anel).join(" | "))
    check("as tarjas acendem por partes", new Set(fotogramas.map((f) => f.tarjas)).size > 1)
    const sinal = await page.evaluate(() => {
      const anel = document.querySelector(".abertura-anel").getBoundingClientRect()
      return { x: anel.x + anel.width / 2, y: anel.y + anel.height / 2, w: innerWidth, h: innerHeight }
    })
    check("o sinal está centrado", Math.abs(sinal.x - sinal.w / 2) < 2, JSON.stringify(sinal))
    // The skin background is on the `html`; the `body` stays transparent for the dawn.
    const fundo = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)
    check("o fundo é o da pele, desde o arranque", fundo === "rgb(8, 12, 26)", fundo)
    // The emergency exit, at 30 s and not before.
    await wait(26_000)
    check("aos 28 s ainda sem link", (await page.getByRole("button", { name: "Recarregar" }).count()) === 0)
    await page.getByRole("button", { name: "Recarregar" }).waitFor({ timeout: 6_000 })
    const link = await page.getByRole("button", { name: "Recarregar" }).evaluate((b) => ({
      letra: getComputedStyle(b).fontSize,
      cor: getComputedStyle(b).color,
    }))
    check('aos 30 s aparece o link "Recarregar", de 12 px', link.letra === "12px", JSON.stringify(link))
    await retratar(page, "abrir-saida")
    await ctx.close()
  }

  // --------------------------------------- the startup, with reduced motion
  {
    const ctx = await novoContexto(LARGO, { reducedMotion: "reduce" })
    await ctx.addInitScript(PENDURAR_O_COFRE)
    const page = await ctx.newPage()
    await page.goto(APP, { waitUntil: "domcontentloaded" })
    await page.locator(".abertura").waitFor({ timeout: 30_000 })
    const a = await page.evaluate(() => ({
      anel: getComputedStyle(document.querySelector(".abertura-anel"), "::after").animationName,
      tarja: getComputedStyle(document.querySelector(".abertura-marca path")).animationName,
      marca: getComputedStyle(document.querySelector(".abertura-marca")).animationName,
    }))
    // Since October 27, 2026 the ring keeps spinning with reduced motion (the owner's Windows reads effects off as reduced motion and startup seemed stuck); since the 28th it spins with speeds.
    check("movimento reduzido: o anel gira na mesma", a.anel === "abertura-gira-vivo", a.anel)
    check("e as tarjas não acendem por partes", a.tarja === "none", a.tarja)
    check("só a marca pulsa a opacidade", a.marca === "abertura-pulsa", a.marca)
    await wait(400)
    await retratar(page, "abrir-reduzido")
    await ctx.close()
  }

  // ------------------------------------------------------- the beta vault
  {
    /*
      A 0.9.x vault pretending: the usual JSON, no `orwv2` header
      (`packages/client-core/src/cabecalhoDoCofre.ts`). The content doesn't matter, because 1.0 never reads it; what matters is the first byte being `{`. It's written to IndexedDB from a page of the same origin that is NOT the app (the homeserver health check, from the front), so the app only starts after.
      */
    const ctx = await novoContexto(LARGO)
    const page = await ctx.newPage()
    page.on("pageerror", (erro) => console.log("  !!  erro na página:", erro.message))
    await page.goto(`http://${NOME}/_enclave/health`, { waitUntil: "domcontentloaded" })
    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const pedido = indexedDB.open("enclave", 1)
          pedido.onupgradeneeded = () => pedido.result.createObjectStore("vault")
          pedido.onerror = () => reject(pedido.error)
          pedido.onsuccess = () => {
            const tx = pedido.result.transaction("vault", "readwrite")
            const beta = new TextEncoder().encode(JSON.stringify({ v: 2, salt: "AAAA", wrappedKey: "AAAA", data: "AAAA" }))
            tx.objectStore("vault").put(beta.buffer, "current")
            tx.oncomplete = () => {
              pedido.result.close()
              resolve(true)
            }
            tx.onerror = () => reject(tx.error)
          }
        }),
    )
    await page.goto(APP, { waitUntil: "domcontentloaded" })
    await page.getByRole("heading", { name: "O Orwell saiu de beta." }).waitFor({ timeout: 60_000 })
    await page.evaluate(() => document.fonts.ready)
    await wait(300)
    await retratar(page, "saiu-de-beta")
    const campos = await page.locator('input[type="password"]').count()
    check("o ecrã do beta não tem campo de palavra-passe", campos === 0, `${campos} campo(s)`)
    check('nem o "Entrar" do portão', (await page.getByRole("button", { name: "Entrar", exact: true }).count()) === 0)
    await page.setViewportSize(TELEMOVEL)
    await wait(300)
    check("a 390 px o ecrã do beta não rola na horizontal", await semRolagemHorizontal(page))
    await page.setViewportSize(LARGO)
    await page.getByRole("button", { name: "Criar conta nova" }).click()
    await page.getByRole("heading", { name: "Já usas o Orwell noutro aparelho?" }).waitFor({ timeout: 30_000 })
    check('"Criar conta nova" abre o Setup', true)
    const restou = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const pedido = indexedDB.open("enclave", 1)
          pedido.onsuccess = () => {
            const ler = pedido.result.transaction("vault", "readonly").objectStore("vault").get("current")
            ler.onsuccess = () => {
              pedido.result.close()
              resolve(ler.result === undefined ? "nada" : "ficou")
            }
          }
        }),
    )
    check("e o cofre do beta saiu do disco", restou === "nada", restou)
    await ctx.close()
  }

  // ------------------------------------------------- criar, importar, emparelhar
  const ctx = await novoContexto(LARGO)
  const primeira = await ctx.newPage()
  primeira.on("pageerror", (erro) => console.log("  !!  erro na página:", erro.message))
  await primeira.goto(APP, { waitUntil: "domcontentloaded" })
  // Since 8.1 (phase 4 of 0.9) Setup asks first if there's already an account on another device; the screenshot is of creating an account, so "No".
  await primeira.getByRole("heading", { name: "Já usas o Orwell noutro aparelho?" }).waitFor({ timeout: 60_000 })
  await primeira.getByRole("button", { name: "Não, criar conta" }).click()
  await primeira.getByPlaceholder("Como queres aparecer").waitFor({ timeout: 60_000 })
  await primeira.evaluate(() => document.fonts.ready)

  const cartao = await estiloDoCartao(primeira)
  // 18 px: the radius of panels (`--painel-raio`), since 10/26/2026. Was 14.
  check("o cartão tem cantos de 18 px", cartao?.canto === "18px", cartao?.canto)
  check("e não desfoca: tinta quase sólida por cima da aurora", cartao?.desfoca === false && cartao?.tinta === "rgba(12, 17, 35, 0.9)", `${cartao?.desfoca} ${cartao?.tinta}`)
  check("e um contorno ciano ténue", /rgba\(139, 233, 253/.test(cartao?.contorno ?? ""), cartao?.contorno)
  check("o primário é um degradé", (cartao?.primario ?? "").startsWith("linear-gradient"), cartao?.primario)
  const textoDoSetup = await primeira.locator(".gate-card").innerText()
  check("o portão não fala de cofre, chave, época nem MLS", !/cofre|chave|época|MLS/i.test(textoDoSetup), textoDoSetup.replace(/\s+/g, " ").slice(0, 160))

  // Import: choose a file, wrong passphrase, error with code.
  const ficheiro = join(dados, "conta.enclave")
  writeFileSync(ficheiro, JSON.stringify({ v: 1, estragado: true }))
  await primeira.locator('.import-account input[type="file"]').setInputFiles(ficheiro)
  const campoDoFicheiro = primeira.locator('input[name="import-password"]')
  await campoDoFicheiro.waitFor({ timeout: 10_000 })
  await campoDoFicheiro.fill("errada-de-proposito")
  await primeira.getByRole("button", { name: "Importar", exact: true }).click()
  await primeira.locator(".import-account .error").waitFor({ timeout: 30_000 })
  const erro = await primeira.locator(".import-account .error").innerText()
  check("o erro da importação traz o código", /^Erro \d{3}/.test(erro), erro.replace(/\s+/g, " "))
  await primeira.locator(".import-account").scrollIntoViewIfNeeded()
  await wait(200)
  await retratar(primeira, "portao-importar")

  // Emparelhar.
  await primeira.reload({ waitUntil: "domcontentloaded" })
  await primeira.getByRole("button", { name: "Emparelhar", exact: true }).click()
  await primeira.getByRole("heading", { name: "Emparelhar este aparelho" }).waitFor({ timeout: 10_000 })
  await wait(300)
  await retratar(primeira, "portao-emparelhar")
  await primeira.getByRole("button", { name: "Voltar" }).click()

  // Create account: the password prompt, with a short passphrase error.
  await primeira.getByPlaceholder("Como queres aparecer").fill("Vesna")
  // The name step, before advancing: the field and "We don't ask for email..." below it, no gap in between.
  await wait(250)
  await retratar(primeira, "portao-nome")
  const folgaDoNome = await primeira.evaluate(() => {
    const campo = document.querySelector(".setup-pane input")?.getBoundingClientRect()
    const promessa = document.querySelector(".setup-pane .setup-promise")?.getBoundingClientRect()
    return campo && promessa ? Math.round(promessa.top - campo.bottom) : -1
  })
  check('no passo do nome, "Não pedimos email…" fica logo por baixo do campo', folgaDoNome >= 0 && folgaDoNome <= 32, `${folgaDoNome} px`)
  await primeira.getByRole("button", { name: "Continuar" }).click()
  const frase = primeira.locator('.gate-card input[type="password"]').first()
  await frase.waitFor({ timeout: 10_000 })
  await frase.fill("curta")
  await primeira.getByRole("button", { name: "Continuar" }).click()
  await primeira.locator(".gate-card .error").waitFor({ timeout: 5_000 })
  await frase.focus()
  await wait(250)
  await retratar(primeira, "portao-criar")
  await primeira.reload({ waitUntil: "domcontentloaded" })
  await criarConta(primeira, { nome: "Vesna", frase: FRASE, servidor: NOME })
  await primeira.getByRole("button", { name: "Configurações" }).waitFor({ timeout: 90_000 })
  check("a conta abre", true)

  // Another tab.
  const segunda = await ctx.newPage()
  await segunda.goto(APP, { waitUntil: "domcontentloaded" })
  await segunda.getByText("Já tens o Orwell aberto noutro separador.").waitFor({ timeout: 30_000 })
  await segunda.evaluate(() => document.fonts.ready)
  await wait(200)
  await retratar(segunda, "portao-separador")
  await segunda.close()

  // Log in: the password gate, wide and at 390 px. A new tab, not reload: the tab keeps the key in `sessionStorage` and would open without asking for the password.
  await primeira.close()
  const page = await ctx.newPage()
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await page.getByRole("heading", { name: "Bem-vindo de volta" }).waitFor({ timeout: 60_000 })
  await page.evaluate(() => document.fonts.ready)
  const entrar = await page.locator(".gate-card").innerText()
  check('entrar diz "Entrar"', (await page.getByRole("button", { name: "Entrar", exact: true }).count()) === 1)
  check("e não fala de cofre nem chave", !/cofre|chave/i.test(entrar), entrar.replace(/\s+/g, " "))
  await page.locator('input[name="password"]').fill("errada-de-proposito")
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
  await page.locator(".gate-card .error").waitFor({ timeout: 60_000 })
  const erroDeEntrar = await page.locator(".gate-card .error").innerText()
  check("a palavra-passe errada dá um erro com código, a rosa", /^Erro \d{3}/.test(erroDeEntrar), erroDeEntrar.replace(/\s+/g, " "))
  await page.locator('input[name="password"]').focus()
  await wait(250)
  await retratar(page, "portao")

  await page.setViewportSize(TELEMOVEL)
  await wait(300)
  check("a 390 px nada rola na horizontal", await semRolagemHorizontal(page))
  const largura = await page.evaluate(() => document.querySelector(".gate-card").getBoundingClientRect().width)
  check("e o cartão cabe com folga de 16 px", largura <= 390 - 32 + 0.5, `${largura}px`)
  await retratar(page, "portao-390")
  await page.locator('input[name="password"]').fill(FRASE)
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
  await page.getByRole("button", { name: "Configurações" }).first().waitFor({ timeout: 90_000 })
  check("com a palavra-passe certa, entra", true)

  check("nenhum pedido saiu de 127.0.0.1", fora.length === 0, fora.slice(0, 3).join(", "))
} catch (erro) {
  console.error(erro)
  results.push(false)
}

const falhas = results.filter((r) => !r).length
console.log(falhas ? `\n${falhas} FALHA(S)` : `\nTudo certo: ${results.length} verificações.`)
await arrumar(falhas ? 1 : 0)
