/**
 * What happens when it is the PASSWORD MANAGER writing to the field.
 *
 *   ORWELL_DIST_030=<dist 0.3.0> ORWELL_DIST_031=<dist 0.3.1> \
 *     node scripts/prova-preenchimento-do-gestor.mjs
 *
 * **Why this is measured.** At 0.3.1 the gate became a form that Keychain and
 * Android Manager recognize-`<form>`, an identity field, `autocomplete="current-password"`.
 * It was the REQUESTED change: it is what delivers Face ID. But it is also the
 * first time someone other than the user writes to that field, and `Unlock` derives
 * the key from REACT STATE (`attempt(passphrase)`), not from what the field holds.
 *
 * The two stay in sync only while the writer fires the events React listens to.
 * A fill that does not fire them-or fires `change` but not `input`-leaves the
 * field full to the eye and the state empty to the app: the key derives from the
 * WRONG phrase and the screen says "wrong password" to someone with the right one.
 *
 * Each fill method is tested against the same account and the same phrase. All
 * local and disposable, following the `e2e-cofre-entre-versoes.mjs` pattern.
 *
 * **What this proved, on 30 September 2026: THIS is the owner's bug.** Account
 * created in 0.3.0, opened in 0.3.1, same passphrase by four paths. Three opened.
 * The fourth-the manager filling the field without firing any event-gave, with the
 * RIGHT phrase visible in the field:
 *
 *     "Wrong passphrase, or the vault is corrupt."
 *
 * Which is, word for word, what the owner described. Fixed that same day
 * (`fraseDoCampo`, on all three gate screens): 4/4 open.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const PORTA_DA_FRENTE = Number(process.env.ORWELL_PORTA_FRENTE ?? 8472)
const PORTA_DO_SERVIDOR = Number(process.env.ORWELL_PORTA_SERVIDOR ?? 8473)
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`
const FRASE = "trás-os-montes é onde a névoa 2026"
const DIST_030 = resolve(process.env.ORWELL_DIST_030 ?? "")
const DIST_031 = resolve(process.env.ORWELL_DIST_031 ?? "")

/**
 * The ways to fill a field, from most polite to most raw.
 *
 * `teclado` is the user. The others are what a password manager, an extension or
 * WebKit does-and none of them are in our control.
 */
const MANEIRAS = [
  { nome: "a pessoa escreve à mão (controlo)", como: "teclado" },
  { nome: "o gestor preenche e dispara input+change (Chrome de hoje)", como: "input-e-change" },
  { nome: "o gestor preenche e dispara só change", como: "so-change" },
  { nome: "o gestor preenche e não dispara nada", como: "nada" },
]

const results = []
function check(nome, ok, detalhe = "") {
  results.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}

for (const [o_que, caminho] of [["o dist da 0.3.0", join(DIST_030, "index.html")], ["o dist da 0.3.1", join(DIST_031, "index.html")], ["o servidor", SERVIDOR_JS]]) {
  if (!existsSync(caminho)) {
    console.error(`Falta ${o_que}: ${caminho}`)
    process.exit(2)
  }
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
    console.error(`A porta ${porta} já tem dono. Liberta-a e volta a correr.`)
    process.exit(2)
  }
}

const dados = mkdtempSync(join(tmpdir(), "orwell-gestor-"))
const perfis = mkdtempSync(join(tmpdir(), "orwell-gestor-perfis-"))
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: { ...process.env, ENCLAVE_DATA_DIR: dados, ENCLAVE_SERVER_NAME: NOME, ENCLAVE_BIND_HOST: "127.0.0.1", ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR), ENCLAVE_COMMUNITY_MODE: "true" },
  stdio: ["ignore", "pipe", "pipe"],
})
let registoDoServidor = ""
servidor.stdout.on("data", (b) => (registoDoServidor += b))
servidor.stderr.on("data", (b) => (registoDoServidor += b))

let distActual = DIST_031
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json" }
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
await new Promise((r) => frente.listen(PORTA_DA_FRENTE, "127.0.0.1", r))
for (let volta = 0; volta < 60; volta++) {
  const ok = await new Promise((r) => {
    const s = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => {
      s.destroy()
      r(true)
    })
    s.on("error", () => r(false))
  })
  if (ok) break
  await new Promise((r) => setTimeout(r, 250))
}

async function arrumar(codigo) {
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
  rmSync(perfis, { recursive: true, force: true })
  process.exit(codigo)
}

/**
 * Fill the field as an external agent would fill it.
 *
 * Via the NATIVE setter on the prototype, which is exactly what a manager does
 * (and what React does not see, because React wraps its own setter to know when
 * the value changes from the outside).
 */
async function encher(page, como, frase) {
  const campo = page.locator('.gate-card input[type="password"]').first()
  if (como === "teclado") {
    await campo.click()
    await campo.type(frase, { delay: 12 })
    return
  }
  await campo.evaluate((el, { valor, como }) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
    setter.call(el, valor)
    if (como === "input-e-change") {
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
    } else if (como === "so-change") {
      el.dispatchEvent(new Event("change", { bubbles: true }))
    }
  }, { valor: frase, como })
}

let caso = 0
const relatos = []
try {
  for (const maneira of MANEIRAS) {
    caso += 1
    const pasta = join(perfis, `perfil-${caso}`)
    console.log(`\n=== ${maneira.nome} ===`)

    // The account is born in 0.3.0, like the owner's.
    distActual = DIST_030
    {
      const ctx = await chromium.launchPersistentContext(pasta, { headless: true, locale: "pt-PT", viewport: { width: 1200, height: 900 } })
      const page = ctx.pages()[0] ?? (await ctx.newPage())
      await page.goto(APP, { waitUntil: "domcontentloaded" })
      await criarConta(page, { nome: `Dono${caso}`, frase: FRASE, servidor: NOME })
      await page.getByRole("button", { name: "Configurações" }).waitFor({ timeout: 90_000 })
      await new Promise((r) => setTimeout(r, 1000))
      await ctx.close()
    }

    // And opens in 0.3.1, with the field full in different ways.
    distActual = DIST_031
    const ctx = await chromium.launchPersistentContext(pasta, { headless: true, locale: "pt-PT", viewport: { width: 1200, height: 900 } })
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(APP, { waitUntil: "domcontentloaded" })
    await page.locator('.gate-card input[type="password"]').first().waitFor({ timeout: 60_000 })

    await encher(page, maneira.como, FRASE)
    const noDom = await page.locator('.gate-card input[type="password"]').first().inputValue()

    await page.getByRole("button", { name: "Entrar", exact: true }).click()
    const erro = page.locator(".error").first()
    const desfecho = await Promise.race([
      page.getByRole("button", { name: "Configurações" }).waitFor({ timeout: 90_000 }).then(() => "abriu"),
      erro.waitFor({ timeout: 90_000 }).then(() => "recusou"),
    ]).catch(() => "pendurado")
    const mensagem = desfecho === "recusou" ? await erro.innerText() : ""
    relatos.push({ maneira: maneira.nome, noDom, desfecho, mensagem })
    check(maneira.nome, desfecho === "abriu", `campo tinha "${noDom}", desfecho: ${desfecho}${mensagem ? `, "${mensagem}"` : ""}`)
    await ctx.close()
  }
} catch (caught) {
  console.error(caught)
}

console.log("\n================ QUADRO ================")
for (const r of relatos) {
  console.log(`${r.desfecho === "abriu" ? "ABRE  " : "NÃO   "} ${r.maneira}`)
  console.log(`        o campo mostrava: "${r.noDom}"${r.mensagem ? `   |   o ecrã disse: "${r.mensagem}"` : ""}`)
}
const falhas = results.filter((r) => !r).length
console.log(`\n${results.length - falhas}/${results.length} maneiras abriram a conta.`)
await arrumar(falhas === 0 ? 0 : 1)
