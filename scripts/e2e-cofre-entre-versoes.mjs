/**
 * A vault from ONE version, opened by the NEXT, the missing proof.
 *
 *   ORWELL_DIST_030=<dist 0.3.0> ORWELL_DIST_031=<dist 0.3.1> \
 *   ORWELL_DIST_024=<dist 0.2.4> node scripts/e2e-cofre-entre-versoes.mjs
 *
 * **Why this script had to exist.** No test ever opened a vault CREATED BY AN
 * EARLIER VERSION. The `e2e-telemovel.mjs` creates the account and opens it in the same run,
 * with the same code: it proves the 0.3.1 understands itself, and nothing else.
 * Whoever has an account has a vault written by the 0.3.0 (or before it), and
 * that is what the gate of 0.3.1 must open.
 *
 * What shifts between the two is WHERE Argon2id runs: the 0.3.1 moved it to a
 * Worker (`apps/web/src/kdf.ts`). If the derived key diverged, one byte, the symptom
 * would be "wrong password" to whoever types it right. This is the experience
 * that says so.
 *
 * **The mechanics, which is the whole point.** IndexedDB is per ORIGIN and the
 * browser profile is where it lives. Therefore:
 *   - the SAME origin (`localhost:<porta>/app/`) at both times: the front
 *     swaps the folder it serves without changing port or name;
 *   - the SAME profile (`userDataDir`), closed and reopened between the two: this is
 *     what a person does when they close the app and come back the next day.
 * Serving the new version on another port would create a new empty vault, and
 * the script would pass without proving anything.
 *
 * We measure, for each pair: whether it opens, how long it takes, and what shows
 * on screen and in the console when it does not open.
 *
 * ALL LOCAL AND ALL DISPOSABLE, by the template of `e2e-cliente-antigo.mjs`: your own
 * homeserver in a temporary folder, browser profiles in a temporary folder,
 * ports checked free, and no way to point it at production.
 *
 * **What this proved, on 30 September 2026.** Run with the `dist` from
 * 0.2.4, from 0.3.0 and from 0.3.1, in both directions and on desktop and mobile
 * screen: all six pairs open, between 1 586 e 1 875 ms. Moving Argon2id to
 * a Worker DID NOT change the key, and the vault of someone who already had an
 * account opens the same. That ruled out the first suspicion of the gate breaking.
 *
 * With `ORWELL_SEM_WORKER=1` it measures the engine without Worker (a CSP that refuses it, an
 * old browser): all six open the same, in 1 573 ms, by falling back to the main
 * thread. A blocked Worker costs a frozen screen, never the account.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const CAPTURAS = join(RAIZ, "capturas")
const PORTA_DA_FRENTE = Number(process.env.ORWELL_PORTA_FRENTE ?? 8472)
const PORTA_DO_SERVIDOR = Number(process.env.ORWELL_PORTA_SERVIDOR ?? 8473)
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`

/**
 * The passphrase, with accents and a space on purpose.
 *
 * It is what crosses the `postMessage` border as a `string` and becomes bytes
 * on the other side. A phrase of only ASCII would not tell well-formed UTF-8
 * from ill-formed, which is one way the key could diverge.
 */
const FRASE = "trás-os-montes é onde a névoa 2026"

const DISTS = {
  "0.2.4": process.env.ORWELL_DIST_024 ? resolve(process.env.ORWELL_DIST_024) : "",
  "0.3.0": process.env.ORWELL_DIST_030 ? resolve(process.env.ORWELL_DIST_030) : "",
  "0.3.1": process.env.ORWELL_DIST_031 ? resolve(process.env.ORWELL_DIST_031) : "",
}

/**
 * The combinations. The first is the complaint; the last two are the control.
 *
 * Without the control (create and open with the SAME version), a failure does
 * not tell itself from a badly written script.
 */
const MATRIZ = [
  { nome: "cofre da 0.3.0 aberto pela 0.3.1", cria: "0.3.0", abre: "0.3.1", ecra: "secretaria" },
  { nome: "cofre da 0.3.0 aberto pela 0.3.1", cria: "0.3.0", abre: "0.3.1", ecra: "telemovel" },
  { nome: "cofre da 0.2.4 aberto pela 0.3.1", cria: "0.2.4", abre: "0.3.1", ecra: "secretaria" },
  { nome: "cofre da 0.3.1 aberto pela 0.3.0 (sentido inverso)", cria: "0.3.1", abre: "0.3.0", ecra: "secretaria" },
  { nome: "CONTROLO: 0.3.1 consigo própria", cria: "0.3.1", abre: "0.3.1", ecra: "secretaria" },
  { nome: "CONTROLO: 0.3.0 consigo própria", cria: "0.3.0", abre: "0.3.0", ecra: "secretaria" },
]

const ECRAS = {
  secretaria: { viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  telemovel: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
}

const results = []
function check(nome, ok, detalhe = "") {
  results.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}

for (const [versao, caminho] of Object.entries(DISTS)) {
  if (!caminho) {
    console.error(`Falta o dist da ${versao}. Ver o cabeçalho deste ficheiro.`)
    process.exit(2)
  }
  if (!existsSync(join(caminho, "index.html"))) {
    console.error(`Não é um dist: ${caminho} (falta index.html).`)
    process.exit(2)
  }
}
if (!existsSync(SERVIDOR_JS)) {
  console.error(`Falta o servidor construído: ${SERVIDOR_JS}. Corre \`npm run build\` primeiro.`)
  process.exit(2)
}

async function portaLivre(porta) {
  return new Promise((resolver) => {
    const sonda = net.createServer()
    sonda.once("error", () => resolver(false))
    sonda.once("listening", () => sonda.close(() => resolver(true)))
    sonda.listen(porta, "127.0.0.1")
  })
}
for (const porta of [PORTA_DA_FRENTE, PORTA_DO_SERVIDOR]) {
  if (!(await portaLivre(porta))) {
    console.error(`A porta ${porta} já tem dono. Este guião não mata processos de ninguém: liberta-a e volta a correr.`)
    process.exit(2)
  }
}

// --- the production homeserver (0.3.1), disposable -------------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-cofre-versoes-"))
const perfis = mkdtempSync(join(tmpdir(), "orwell-perfis-"))
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

/**
 * The front, which acts as Caddy, and SWAPS folders without changing origin.
 *
 * `distActual` is read at each request, on purpose: this is what lets us serve
 * 0.3.0 at one moment and 0.3.1 the next, on the same `localhost:<porta>`, which is
 * the only way for the IndexedDB from the first moment to reach the second.
 */
let distActual = DISTS["0.3.1"]
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json", ".wasm": "application/wasm" }
const frente = http.createServer((pedido, resposta) => {
  const caminho = (pedido.url ?? "/").split("?")[0]
  if (caminho.startsWith("/app")) {
    const base = distActual
    const relativo = normalize(decodeURIComponent(caminho.slice("/app".length))).replace(/^(\.\.[/\\])+/, "")
    let ficheiro = join(base, relativo)
    if (!ficheiro.startsWith(base) || !existsSync(ficheiro) || statSync(ficheiro).isDirectory()) ficheiro = join(base, "index.html")
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
await new Promise((resolver) => frente.listen(PORTA_DA_FRENTE, "127.0.0.1", resolver))

async function servidorDePe() {
  for (let volta = 0; volta < 60; volta++) {
    const ok = await new Promise((resolver) => {
      const sonda = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => {
        sonda.destroy()
        resolver(true)
      })
      sonda.on("error", () => resolver(false))
    })
    if (ok) return true
    await new Promise((resolver) => setTimeout(resolver, 250))
  }
  return false
}

async function arrumar(codigoDeSaida) {
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
  rmSync(perfis, { recursive: true, force: true })
  process.exit(codigoDeSaida)
}

if (!(await servidorDePe())) {
  console.error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
  await arrumar(2)
}

const espera = (ms) => new Promise((resolver) => setTimeout(resolver, ms))
mkdirSync(CAPTURAS, { recursive: true })

/** Open a persistent profile. It is the same browser that someone closes and reopens. */
async function abrirPerfil(pasta, ecra) {
  const ctx = await chromium.launchPersistentContext(pasta, {
    headless: true,
    locale: "pt-PT",
    ...ECRAS[ecra],
  })
  /*
    The engine without a Worker: a `new Worker` that throws, which is what a
    CSP refusing it (or an old engine) does. The `kdf.ts` promises a silent
    fallback to the main thread; this measures if the gate opens the same, and
    at what cost.
    */
  if (process.env.ORWELL_SEM_WORKER) {
    await ctx.addInitScript(() => {
      Object.defineProperty(window, "Worker", {
        configurable: true,
        value: function () {
          throw new Error("Refused to create a worker (CSP simulada)")
        },
      })
    })
  }
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const erros = []
  const consola = []
  page.on("pageerror", (erro) => erros.push(`${erro.message}`))
  page.on("console", (m) => consola.push(`${m.type()}: ${m.text()}`.slice(0, 300)))
  return { ctx, page, erros, consola }
}

const dentro = (page, ms = 90_000) => page.getByRole("button", { name: "Configurações" }).waitFor({ timeout: ms })

let caso = 0
async function correr({ nome, cria, abre, ecra }) {
  caso += 1
  const etiqueta = `${String(caso).padStart(2, "0")} ${cria}->${abre} ${ecra}`
  console.log(`\n=== ${etiqueta} — ${nome} ===`)
  const pasta = join(perfis, `perfil-${caso}`)
  mkdirSync(pasta, { recursive: true })
  const relato = { etiqueta, nome, cria, abre, ecra }

  // --- moment 1: the account is born in the old version -------------------
  distActual = DISTS[cria]
  {
    const { ctx, page, erros } = await abrirPerfil(pasta, ecra)
    try {
      await page.goto(APP, { waitUntil: "domcontentloaded" })
      await criarConta(page, { nome: `Dono${caso}`, frase: FRASE, servidor: NOME })
      await dentro(page)
      relato.criou = true
    } catch (caught) {
      relato.criou = false
      relato.erroACriar = `${caught}`.split("\n")[0]
      relato.errosACriar = erros.slice(0, 5)
    }
    // A moment for IndexedDB to settle before the app closes.
    await espera(1000)
    await ctx.close()
  }
  if (!relato.criou) {
    check(`${etiqueta}: a conta cria-se na ${cria}`, false, relato.erroACriar)
    return relato
  }
  check(`${etiqueta}: a conta cria-se na ${cria}`, true)

  // --- moment 2: the new version opens the vault that was already there ----
  distActual = DISTS[abre]
  {
    const { ctx, page, erros, consola } = await abrirPerfil(pasta, ecra)
    try {
      await page.goto(APP, { waitUntil: "domcontentloaded" })

      // The gate must ASK for the phrase. If the creation screen shows instead, the
      // vault was lost, worse than not opening.
      const pedeFrase = page.locator('.gate-card input[type="password"]').first()
      const ecraDeCriacao = page.getByPlaceholder("Como queres aparecer")
      const desfecho = await Promise.race([
        pedeFrase.waitFor({ timeout: 60_000 }).then(() => "pede-frase"),
        ecraDeCriacao.waitFor({ timeout: 60_000 }).then(() => "cofre-perdido"),
        dentro(page, 60_000).then(() => "abriu-sozinho"),
      ]).catch(() => "nem-uma-coisa-nem-outra")
      relato.portao = desfecho
      if (desfecho !== "pede-frase") {
        relato.abriu = false
        relato.ecraFinal = (await page.locator("body").innerText()).slice(0, 400)
        await page.screenshot({ path: join(CAPTURAS, `cofre-versoes-${etiqueta.replace(/[ >.]/g, "-")}.png`) })
        check(`${etiqueta}: o portão pede a frase-passe`, false, desfecho)
        await ctx.close()
        return relato
      }
      check(`${etiqueta}: o portão pede a frase-passe`, true)

      await pedeFrase.fill(FRASE)
      // The value as the DOM has it, BEFORE submitting: catches a field the app may
      // have cleared under whoever typed it.
      relato.valorNoDom = await pedeFrase.inputValue()

      const marca = Date.now()
      await page.getByRole("button", { name: "Entrar", exact: true }).click()

      const erro = page.locator(".error").first()
      const resultado = await Promise.race([
        dentro(page, 120_000).then(() => "abriu"),
        erro.waitFor({ timeout: 120_000 }).then(() => "recusou"),
      ]).catch(() => "pendurado")
      relato.ms = Date.now() - marca
      relato.resultado = resultado
      if (resultado === "recusou") relato.mensagem = await erro.innerText()
      if (resultado === "pendurado") relato.ecraFinal = (await page.locator("body").innerText()).slice(0, 400)
      relato.abriu = resultado === "abriu"
      relato.erros = erros.slice(0, 5)
      relato.consola = consola.filter((l) => /error|warn|kdf|worker/i.test(l)).slice(0, 10)
      await page.screenshot({ path: join(CAPTURAS, `cofre-versoes-${etiqueta.replace(/[ >.]/g, "-")}.png`) })
      check(
        `${etiqueta}: a frase-passe certa abre o cofre da ${cria}`,
        relato.abriu,
        `${resultado}, ${relato.ms} ms${relato.mensagem ? `, "${relato.mensagem}"` : ""}`,
      )
    } catch (caught) {
      relato.abriu = false
      relato.resultado = `excepção: ${`${caught}`.split("\n")[0]}`
      check(`${etiqueta}: a frase-passe certa abre o cofre da ${cria}`, false, relato.resultado)
    }
    await ctx.close()
  }
  return relato
}

const relatos = []
try {
  for (const combinacao of MATRIZ) relatos.push(await correr(combinacao))
} catch (caught) {
  console.error(caught)
  check("o guião chega ao fim", false, `${caught}`.split("\n")[0])
}

console.log("\n================ QUADRO ================")
for (const r of relatos) {
  console.log(
    `${r.abriu ? "ABRE  " : "NÃO   "} ${r.cria} -> ${r.abre} (${r.ecra})  ${r.ms ?? "-"} ms  ${r.resultado ?? r.portao ?? ""} ${r.mensagem ? `"${r.mensagem}"` : ""}`,
  )
  if (r.valorNoDom !== undefined && r.valorNoDom !== FRASE) console.log(`        !! o campo tinha "${r.valorNoDom}" e não a frase escrita`)
  if (r.erros?.length) console.log(`        erros: ${r.erros.join(" | ")}`)
  if (r.consola?.length) console.log(`        consola: ${r.consola.join(" | ")}`)
}
const falhas = results.filter((r) => !r).length
console.log(`\n${results.length - falhas}/${results.length} verificações passaram.`)
await arrumar(falhas === 0 ? 0 : 1)
