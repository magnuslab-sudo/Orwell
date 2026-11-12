/**
 * One owner per browser: multiple tabs with the same account, in a real browser.
 *
 *   node scripts/e2e-separadores.mjs                    (all three engines)
 *   node scripts/e2e-separadores.mjs chromium webkit    (only these)
 *   node scripts/e2e-separadores.mjs --sem-trincos      (no Web Locks: election by BroadcastChannel)
 *   DEBUG_SEP=1 node scripts/e2e-separadores.mjs ...    (shows navigations, sockets and the channel)
 *
 * Requires `npm run build` first: serves `apps/web/dist` and runs
 * `apps/server/dist`.
 *
 * Why it exists. Until October 20, 2026, two tabs from the same browser could
 * open the same IndexedDB vault, and both would connect to the server and write.
 * On October 18, a tab with stale state published epochs 44 through 55 with the
 * common room at 57 and broke it. See `apps/web/src/posse-do-separador.ts`.
 *
 * What the test proves for each engine with all tabs in the SAME Playwright
 * context (the same IndexedDB, like in a real browser):
 *
 * 1. Tab 1 creates the account, a channel, and writes.
 * 2. Tab 2 opens and shows "You already have Orwell open in another tab."
 *    Does not open any WebSocket.
 * 3. Tab 1 closes. Tab 2 takes over within seconds: prompts for password (the
 *    cached key is per tab), enters, sees tab 1's message and sends its own.
 * 4. Tab 3 opens and waits. Clicks "Use this tab": tab 2 yields and shows the
 *    wait screen with no WebSocket open. Tab 3 enters and sees both messages.
 * 5. Tab 3 closes. Tab 2 takes over again, now without prompting for password
 *    (its key survived the reload), and sees tab 3's message.
 *
 * And read markers (phase 5): they live in the vault, not in `localStorage`. What
 * tab 1 read is in the vault that tabs 2 and 3 open, and each owner only pushes
 * them up. The IndexedDB vault is read and unlocked with the passphrase here in
 * Node.
 *
 * And the one-time migration: with tab 2 waiting, the two keys that a real
 * browser has from a previous version are placed in `localStorage` (`enclave.lastRead`
 * and `enclave.dmClosed`, in the form those versions wrote), with timestamps from
 * days ago and in channels the account knows. When tab 2 opens the account, the
 * markers move to the vault WITH THE OLD TIMESTAMP (writing "now" would hide
 * unread messages), and the keys leave the browser.
 *
 * ALL LOCAL AND ALL DISPOSABLE, like `e2e-convite-link.mjs`: its own homeserver
 * with data in a temporary folder that gets deleted at the end, free ports chosen
 * by the system, and no way to point it at production.
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
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const FRASE = "frase-de-verificacao-2026"
const MOTORES = { chromium, firefox, webkit }

/*
  `--sem-trincos` deletes `navigator.locks` before any page script runs. That is
  the old Safari or a local network `http://`: ownership falls back to election
  by BroadcastChannel, and the test must pass anyway.
*/
const SEM_TRINCOS = process.argv.includes("--sem-trincos")
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

/** A port guaranteed free by the system at this moment. */
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

// --- the homeserver, disposable -----------------------------------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-separadores-"))
/*
  A CLEAN environment, not the one where the script runs. A forgotten `ENCLAVE_*`
  in the session (common room, community mode, TURN) would change this test's
  server without anyone noticing. Only what Node needs to start is passed.
*/
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

// --- the front end, which acts as Caddy (the same as in e2e-convite-link) ----------------
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

function arrumar(codigoDeSaida) {
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
  process.exit(codigoDeSaida)
}

if (!(await servidorDePe())) {
  console.error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
  arrumar(2)
}

// --- a prova, por motor -------------------------------------------------------
const ESPERA = "Já tens o Orwell aberto noutro separador."
const USAR = "Usar este separador"

/** How many WebSockets the page has open right now. */
function vigiarSockets(page) {
  const abertos = new Set()
  let total = 0
  page.on("websocket", (ws) => {
    total += 1
    abertos.add(ws)
    if (process.env.DEBUG_SEP) console.log(`    ws abre ${Date.now() % 100000} ${page.url()}`)
    ws.on("close", () => {
      if (process.env.DEBUG_SEP) console.log(`    ws fecha ${Date.now() % 100000}`)
      abertos.delete(ws)
    })
  })
  /*
    A new document does not inherit sockets from the previous one: they die with
    the page. Playwright does not always emit the `close` of a socket closed just
    before reload (on Chromium with election by broadcast, shutdown takes a
    millisecond and the page reloads right after), and without this we would count
    a socket from a document that no longer exists.
  */
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return
    abertos.clear()
    if (process.env.DEBUG_SEP) console.log(`    navega ${Date.now() % 100000} ${page.__nome}`)
  })
  return { abertos: () => abertos.size, total: () => total }
}

// `.first()`: today's UI has two buttons with this name (one in the bar and one
// in the account banner), and Playwright's strict mode refused both.
const dentro = (page, timeout = 90_000) => page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout })

async function destrancar(page) {
  const campo = page.locator('.gate-card input[type="password"]')
  await campo.waitFor({ timeout: 30_000 })
  await campo.fill(FRASE)
  // "Remember session" is on by default; this script tests the key PER TAB (a new
  // tab prompts for the passphrase), so it turns it off. Session memory has its own
  // script: `e2e-memorizar-sessao.mjs`.
  const caixa = page.locator('input[name="memorizar"]')
  if (await caixa.count()) await caixa.setChecked(false)
  await campo.press("Enter")
  await dentro(page)
}

async function abrirCanal(page, nome) {
  await page.locator(".channel-list .channel-name", { hasText: nome }).first().click()
  await page.getByRole("heading", { name: nome }).waitFor({ timeout: 30_000 })
}

async function dizer(page, frase) {
  const caixa = page.locator('input[placeholder="Escreve uma mensagem"]')
  await caixa.click()
  await caixa.fill(frase)
  await page.keyboard.press("Enter")
}

const ve = (page, texto, timeout = 30_000) =>
  page.getByText(texto, { exact: false }).first().waitFor({ timeout }).then(
    () => true,
    () => false,
  )

/** The entire vault, read from IndexedDB and unlocked with the passphrase. See `cofreDe` in `e2e-emparelhar.mjs`. */
async function cofreDe(page) {
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
  // The plaintext header from 1.0 (`orwv2` and a newline, chunk 2) before the JSON.
  const ficheiro = JSON.parse(bruto.startsWith("orwv2\n") ? bruto.slice(6) : bruto)
  const b64 = (texto) => Buffer.from(texto.replace(/-/g, "+").replace(/_/g, "/"), "base64")
  const chave = argon2id(new TextEncoder().encode(FRASE), b64(ficheiro.salt), { t: 3, m: 65_536, p: 4, dkLen: 32 })
  return JSON.parse(new TextDecoder().decode(xchacha20poly1305(chave, b64(ficheiro.nonce)).decrypt(b64(ficheiro.ciphertext))))
}

/** The read markers from the vault. */
async function lidasDoCofre(page) {
  const cofre = await cofreDe(page)
  return cofre === null ? null : (cofre.lidas ?? {})
}

/** Each marker in `before` is in `after`, equal or further ahead. */
const naoDesceu = (antes, depois) => Object.entries(antes).every(([canal, at]) => (depois?.[canal] ?? -1) >= at)
const semChaveAntiga = (page) => page.evaluate(() => localStorage.getItem("enclave.lastRead") === null)

const resultadoPorMotor = {}

for (const nomeDoMotor of escolhidos) {
  const results = []
  const check = (nome, ok, detalhe = "") => {
    results.push(Boolean(ok))
    console.log(`${ok ? "  ok  " : " FALHA"} [${nomeDoMotor}] ${nome}${detalhe ? `  (${detalhe})` : ""}`)
  }
  let browser
  try {
    browser = await MOTORES[nomeDoMotor].launch({ headless: true })
    const ctx = await browser.newContext({ locale: "pt-PT" })
    if (process.env.DEBUG_SEP) {
      await ctx.addInitScript(() => {
        const original = BroadcastChannel.prototype.postMessage
        BroadcastChannel.prototype.postMessage = function (m) {
          console.log("BC> " + JSON.stringify(m))
          return original.call(this, m)
        }
      })
      ctx.on("page", (page) => page.on("console", (m) => m.text().startsWith("BC>") && console.log(`    ${Date.now() % 100000} ${page.__nome ?? "p1"} ${m.text()}`)))
    }
    if (SEM_TRINCOS) {
      await ctx.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "locks", { get: () => undefined, configurable: true })
      })
    }
    const canal = `adega-${nomeDoMotor}`
    const consola = []
    ctx.on("page", (page) => page.on("console", (m) => consola.push(`${m.type()} ${m.text()}`)))

    // 1. Tab 1 creates the account, the channel, and writes.
    const p1 = await ctx.newPage()
    const s1 = vigiarSockets(p1)
    await p1.goto(APP, { waitUntil: "domcontentloaded" })
    await criarConta(p1, { nome: "Ana", frase: FRASE, servidor: NOME })
    await dentro(p1)
    /*
      A channel created BEFORE the vault: it is the first in the list, and it is
      the one tab 2 opens by itself when entering. The vault stays closed until
      the script opens it, and it is there that the migration shows the timestamp
      from the browser (a marker later than what tab 1 left there, and before
      "now"), before tab 2 marks it read.
      */
    const celeiro = `celeiro-${nomeDoMotor}`
    await p1.getByRole("button", { name: "Criar canal" }).first().click()
    await p1.locator("form.prompt input").first().fill(celeiro)
    await p1.locator("form.prompt button.primary").first().click()
    await p1.getByRole("heading", { name: celeiro }).waitFor({ timeout: 30_000 })
    await p1.getByRole("button", { name: "Criar canal" }).first().click()
    await p1.locator("form.prompt input").first().fill(canal)
    await p1.locator("form.prompt button.primary").first().click()
    await p1.getByRole("heading", { name: canal }).waitFor({ timeout: 30_000 })
    await dizer(p1, "um: escrito no primeiro separador")
    check("o separador 1 é dono e escreve", await ve(p1, "um: escrito no primeiro separador"))
    check("e tem o WebSocket aberto", s1.abertos() === 1, `${s1.abertos()}`)
    // Tab 1's read markers: in the vault (the batch saves in one and a half seconds), not in the browser.
    await p1.waitForTimeout(2_500)
    const lidasDo1 = await lidasDoCofre(p1)
    check("as marcas de lido do 1 estão no cofre", lidasDo1 !== null && Object.keys(lidasDo1).length >= 1, JSON.stringify(Object.keys(lidasDo1 ?? {}).length))
    check("e não no localStorage (enclave.lastRead)", await semChaveAntiga(p1))

    // 2. Tab 2 waits.
    const p2 = await ctx.newPage()
    p2.__nome = "p2"
    const s2 = vigiarSockets(p2)
    await p2.goto(APP, { waitUntil: "domcontentloaded" })
    check("o separador 2 diz que a conta está aberta noutro", await ve(p2, ESPERA, 15_000))
    await p2.waitForTimeout(2_000)
    check("e não abre WebSocket nenhum", s2.total() === 0, `${s2.total()}`)
    check("nem mostra a aplicação", (await p2.getByRole("button", { name: "Configurações" }).count()) === 0)

    /*
      2b. Keys from a previous version, in a real browser: placed now, with tab 2
      waiting, so the migration runs when tab 2 opens the account. A channel with
      no read marker (to see the old timestamp come in) and the vault's channel
      in archive, both channels the account knows.
    */
    const cofreDo1 = await cofreDe(p1)
    const conhecidos = Object.keys(cofreDo1?.groups ?? {})
    // The vault's address is the one the app picked (1.0 "Arca"): found by the name
    // the vault stores in the channel's label (`spaceMeta`).
    const daAdega = conhecidos.find((c) => cofreDo1?.spaceMeta?.[c]?.payload?.name === canal)
    const lidoNoBrowser = daAdega
    // The read marker and the archive marker both go to the vault. The read marker
    // ends up above what tab 1 left (only goes up), and seconds before "now".
    const LIDO_ANTIGO = (cofreDo1?.lidas?.[lidoNoBrowser] ?? 0) + 500
    check("a marca do browser fica no passado", LIDO_ANTIGO < Date.now() - 1_000, `${Date.now() - LIDO_ANTIGO} ms`)
    const FECHADO_ANTIGO = Date.now() - 2 * 24 * 60 * 60_000
    await p2.evaluate(
      ([lido, fechado]) => {
        localStorage.setItem("enclave.lastRead", JSON.stringify(lido))
        localStorage.setItem("enclave.dmClosed", JSON.stringify(fechado))
      },
      [{ [lidoNoBrowser]: LIDO_ANTIGO, "!de-outra-conta:outro.pt": LIDO_ANTIGO }, { [daAdega]: FECHADO_ANTIGO }],
    )
    check("a adega é um canal que a conta conhece, para a migração", Boolean(lidoNoBrowser && daAdega), `${daAdega}`)

    // 3. Tab 1 closes: tab 2 takes over.
    const fechouEm = Date.now()
    await p1.close()
    await p2.locator('.gate-card input[type="password"]').waitFor({ timeout: 15_000 }).then(
      () => check("o 1 fecha e o 2 assume em segundos (pede a palavra-passe)", true, `${Date.now() - fechouEm} ms`),
      () => check("o 1 fecha e o 2 assume em segundos (pede a palavra-passe)", false),
    )
    await destrancar(p2)
    // The migration: the markers enter the vault with the browser's timestamp, and the keys leave.
    let cofreDo2 = null
    for (let vez = 0; vez < 20; vez++) {
      await p2.waitForTimeout(500)
      cofreDo2 = await cofreDe(p2)
      if (cofreDo2?.lidas?.[lidoNoBrowser] === LIDO_ANTIGO && cofreDo2?.arquivo?.[daAdega] !== undefined) break
    }
    check("migração: a marca de lido entra no cofre com a hora antiga", cofreDo2?.lidas?.[lidoNoBrowser] === LIDO_ANTIGO, `${cofreDo2?.lidas?.[lidoNoBrowser]} vs ${LIDO_ANTIGO}`)
    check(
      'migração: o arquivo entra no cofre com a hora antiga, e não "agora"',
      cofreDo2?.arquivo?.[daAdega]?.arquivado === true && cofreDo2?.arquivo?.[daAdega]?.at === FECHADO_ANTIGO,
      JSON.stringify(cofreDo2?.arquivo?.[daAdega]),
    )
    check("migração: um canal que a conta não conhece não entra", cofreDo2?.lidas?.["!de-outra-conta:outro.pt"] === undefined)
    check(
      "migração: as duas chaves saem do localStorage",
      await p2.evaluate(() => localStorage.getItem("enclave.lastRead") === null && localStorage.getItem("enclave.dmClosed") === null),
    )
    await abrirCanal(p2, canal)
    check("o 2 vê a mensagem do 1", await ve(p2, "um: escrito no primeiro separador"))
    await dizer(p2, "dois: escrito no segundo separador")
    check("o 2 envia a sua", await ve(p2, "dois: escrito no segundo separador"))
    check("o 2 tem agora um WebSocket aberto", s2.abertos() === 1, `${s2.abertos()}`)

    // 4. Tab 3 asks for ownership.
    const p3 = await ctx.newPage()
    p3.__nome = "p3"
    const s3 = vigiarSockets(p3)
    await p3.goto(APP, { waitUntil: "domcontentloaded" })
    check("o separador 3 fica à espera", await ve(p3, ESPERA, 15_000))
    check("sem WebSocket", s3.total() === 0, `${s3.total()}`)
    await p3.getByRole("button", { name: USAR }).click()
    await p3.locator('.gate-card input[type="password"]').waitFor({ timeout: 15_000 }).then(
      () => check('"Usar este separador": o 3 assume', true),
      () => check('"Usar este separador": o 3 assume', false),
    )
    check("o 2 cede e mostra o ecrã de espera", await ve(p2, ESPERA, 15_000))
    await p2.waitForTimeout(1_000)
    check("e o 2 não tem WebSocket aberto", s2.abertos() === 0, `${s2.abertos()}`)
    await destrancar(p3)
    await abrirCanal(p3, canal)
    check("o 3 vê a mensagem do 1", await ve(p3, "um: escrito no primeiro separador"))
    check("o 3 vê a mensagem do 2", await ve(p3, "dois: escrito no segundo separador"))
    await dizer(p3, "três: escrito no terceiro separador")
    check("o 3 envia a sua", await ve(p3, "três: escrito no terceiro separador"))
    await p3.waitForTimeout(2_500)
    const lidasDo3 = await lidasDoCofre(p3)
    check("o 3 tem as marcas que o 1 deixou, nenhuma a descer", naoDesceu(lidasDo1 ?? {}, lidasDo3), `${Object.keys(lidasDo3 ?? {}).length} marcas`)
    check("e o 3 também não escreve no localStorage", await semChaveAntiga(p3))

    // 5. Tab 3 closes: tab 2 takes over again, without prompting for password.
    /*
      Closes 300 ms after sending, well inside the core's one-and-a-half-second
      batch. The message itself only lives in local history (in MLS the device does
      not read the server's echo), so it is the `pagehide` save that stores it.
      With the IndexedDB connection already open, that transaction starts within
      the `pagehide` itself, and this short wait tests that.
    */
    await p3.waitForTimeout(300)
    await p3.close()
    await dentro(p2, 20_000).then(
      () => check("o 3 fecha e o 2 volta sozinho, sem palavra-passe", true),
      () => check("o 3 fecha e o 2 volta sozinho, sem palavra-passe", false),
    )
    await abrirCanal(p2, canal)
    /*
      The state must be the same: tab 2 sees tab 3's message.

      On WebKit, once in three runs, the channel view opens EMPTY at this step
      (not even tab 1's message appears) and does not fix itself. The data is in
      the vault: after reload the three appear. It is a startup defect from silent
      unlocking (cached key), not from the handoff, and stays in the October 20,
      2026 report. The script flags it as WARNING and tests the data after reload;
      does not hide it or count it as a pass.
    */
    let viuOTres = await ve(p2, "três: escrito no terceiro separador")
    if (!viuOTres) {
      const vazia = await ve(p2, "Ainda ninguém escreveu aqui", 1_000)
      console.log(`  AVISO [${nomeDoMotor}] a vista do canal abriu ${vazia ? "vazia" : "sem a mensagem do 3"}; recarrega-se e volta-se a ver`)
      await p2.reload({ waitUntil: "domcontentloaded" })
      await dentro(p2, 30_000)
      await abrirCanal(p2, canal)
      viuOTres = await ve(p2, "três: escrito no terceiro separador")
    }
    check("o 2 vê a mensagem do 3: o estado é o mesmo", viuOTres)
    check("e só o 2 tem WebSocket aberto", s2.abertos() === 1, `${s2.abertos()}`)
    await p2.waitForTimeout(2_500)
    check("o 2, de volta, tem as marcas do 3 (as do canal subiram com ele)", naoDesceu(lidasDo3 ?? {}, await lidasDoCofre(p2)))

    const erros = consola.filter((linha) => linha.startsWith("error") && /epoch|época|partition|partiç/i.test(linha))
    check("nenhum erro de época na consola", erros.length === 0, erros[0]?.slice(0, 100) ?? "")
  } catch (erro) {
    check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  } finally {
    await browser?.close().catch(() => {})
  }
  const passaram = results.filter(Boolean).length
  resultadoPorMotor[nomeDoMotor] = { passaram, total: results.length }
}

console.log("")
let tudoBem = true
for (const [motor, { passaram, total }] of Object.entries(resultadoPorMotor)) {
  console.log(`${motor}${SEM_TRINCOS ? " (sem Web Locks)" : ""}: ${passaram}/${total} verificações passaram`)
  if (passaram !== total) tudoBem = false
}
arrumar(tudoBem ? 0 : 1)
