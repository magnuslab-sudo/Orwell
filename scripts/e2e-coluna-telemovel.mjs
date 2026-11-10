/**
 * The channel column on a real phone, step by step.
 *
 *   node scripts/e2e-coluna-telemovel.mjs     (needs `npm run build` first)
 *
 * Owner report on 2/11/2026, after the first room fix: "rooms show up on the
 * phone but are not visually visible.. the column disappears".
 *
 * The cause: when someone joins the common room and opens the drawer and taps
 * the common room BEFORE the rooms arrive, the drawer rule read "the vault knows
 * no rooms" as "channel with no rooms" and closed the drawer. The rooms arrived
 * two to six seconds later (from the `#revezarSalas` rotation), with the drawer
 * off screen: they were in the DOM and invisible. See `gavetaSaiAoTocar`, in
 * `packages/ui/src/App.tsx`.
 *
 * The bad case, made certain: Ana founds the common room and creates "press" and
 * "barrels"; Bruno joins and stays unpromoted; Ana closes the app. So rooms
 * arrive only to those joining via rotation, with real delay. Then, for each
 * device (iPhone 13 on WebKit, Pixel 7 on Chromium, with the touch, `userAgent`
 * and screen from `playwright.devices`), a fresh account:
 *
 *   1. joins, opens the drawer by hamburger and taps the common room right away;
 *   2. the drawer STAYS, and rooms appear in it, visible and tappable;
 *   3. tapping a room closes the drawer (end of the path);
 *   4. the hamburger reopens the drawer, with rooms visible;
 *   5. rotate the screen: in landscape the column is visible, back to portrait
 *      the drawer closes;
 *   6. the browser bar changes height: the drawer follows;
 *   7. enter a voice room and reopen the drawer (Chromium only, it has fake mic).
 *
 * At each step it measures the `getBoundingClientRect` of the column and what is
 * on top of each room (`elementFromPoint`). All local and disposable: no way to
 * point it at production. Screenshots in `capturas/coluna-telemovel-*.png`.
 *
 * What this does NOT prove: Safari on iOS and Chrome on Android on real devices.
 * The engines here are the same, but the system (bars, notch) is not.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, devices, webkit } from "playwright"
import { FRASE } from "./ambiente.mjs"
import { criarConta } from "./conta.mjs"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/web/dist")
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const PORTA_DA_FRENTE = 8512
const PORTA_DO_SERVIDOR = 8513
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`

for (const porta of [PORTA_DA_FRENTE, PORTA_DO_SERVIDOR]) {
  const livre = await new Promise((r) => {
    const sonda = net.createServer()
    sonda.once("error", () => r(false))
    sonda.once("listening", () => sonda.close(() => r(true)))
    sonda.listen(porta, "127.0.0.1")
  })
  if (!livre) {
    console.error(`A porta ${porta} já tem dono (um homeserver de uma corrida anterior?). Liberta-a primeiro.`)
    process.exit(2)
  }
}

const dados = mkdtempSync(join(tmpdir(), "orwell-coluna-telemovel-"))
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR),
    ENCLAVE_COMMUNITY_MODE: "true",
    // Like production: the common room, where every new account joins.
    ENCLAVE_COMMON_ROOM: `!orwell:${NOME}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
})
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json" }
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
  adiante.on("error", () => { resposta.writeHead(502); resposta.end() })
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
  const ok = await new Promise((r) => { const s = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => { s.destroy(); r(true) }); s.on("error", () => r(false)) })
  if (ok) break
  await new Promise((r) => setTimeout(r, 250))
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const CAPTURAS = join(RAIZ, "capturas")

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


const dentro = (page) => page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
const linhaComum = (page) => page.locator(".channel-row").first()
const SALAS_DA_ANA = ["prensa", "barricas"]

/** The column, measured: where it is, whether it shows, and how many rooms are visible and tappable. */
async function medir(page) {
  return page.evaluate(() => {
    const coluna = document.querySelector(".sidebar")
    if (!coluna) return { existe: false, aberta: false, visivel: false, salas: [], salasAVista: 0, caixa: "" }
    const r = coluna.getBoundingClientRect()
    const estilo = getComputedStyle(coluna)
    const dentroDoEcra = r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1
    const nomes = [...document.querySelectorAll(".room-tree .room-name")]
    const salasAVista = nomes.filter((nome) => {
      const q = nome.getBoundingClientRect()
      if (q.height === 0 || q.bottom <= 0 || q.top >= innerHeight) return false
      const topo = document.elementFromPoint(q.x + 4, q.y + q.height / 2)
      return Boolean(topo && (topo === nome || nome.contains(topo) || topo.closest(".room-row")))
    }).length
    return {
      existe: true,
      aberta: coluna.classList.contains("open"),
      visivel: dentroDoEcra && estilo.visibility !== "hidden" && estilo.display !== "none",
      salas: nomes.map((n) => n.textContent),
      salasAVista,
      caixa: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} em ${innerWidth}x${innerHeight}`,
    }
  })
}

async function esperarSalas(page, ms = 30_000) {
  const inicio = Date.now()
  while (Date.now() - inicio < ms) {
    const salas = await page.evaluate(() => [...document.querySelectorAll(".room-tree .room-name")].map((n) => n.textContent))
    if (SALAS_DA_ANA.every((s) => salas.includes(s))) return Date.now() - inicio
    await wait(250)
  }
  return null
}

mkdirSync(CAPTURAS, { recursive: true })
const browsers = []
try {
  // --- Ana founds the common room; Bruno joins; Ana leaves ---------------
  const secretaria = await chromium.launch({ headless: true })
  browsers.push(secretaria)
  const a = await (await secretaria.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 800 } })).newPage()
  await a.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(a, { nome: "Ana", frase: FRASE, servidor: NOME })
  await dentro(a)
  await linhaComum(a).waitFor({ timeout: 90_000 })
  await linhaComum(a).click()
  for (const sala of SALAS_DA_ANA) {
    await linhaComum(a).click({ button: "right" })
    await a.getByRole("menuitem", { name: "Nova sala" }).click()
    await a.locator(".sheet input").first().fill(sala)
    await a.locator(".sheet-actions button.primary").first().click()
    await a.locator(`.room-tree .room-name:text-is("${sala}")`).first().waitFor({ timeout: 30_000 })
  }
  const b = await (await secretaria.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 800 } })).newPage()
  await b.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(b, { nome: "Bruno", frase: FRASE, servidor: NOME })
  await dentro(b)
  await linhaComum(b).waitFor({ timeout: 90_000 })
  await linhaComum(b).click()
  await b.locator('.room-tree .room-name:text-is("barricas")').first().waitFor({ timeout: 60_000 })
  await wait(3000)
  await a.close()
  await wait(1500)
  check("preparação: a Ana funda a sala comum com prensa e barricas, o Bruno fica ligado, a Ana sai", true)

  for (const [motor, aparelho, rotulo] of [
    [webkit, "iPhone 13", "iphone"],
    [chromium, "Pixel 7", "pixel"],
  ]) {
    console.log(`\n--- ${aparelho} (${rotulo === "iphone" ? "WebKit" : "Chromium"}) ---`)
    const comMicrofone = motor === chromium
    const navegador = await motor.launch({
      headless: true,
      args: comMicrofone ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] : [],
    })
    browsers.push(navegador)
    const perfil = devices[aparelho]
    const ctx = await navegador.newContext({ ...perfil, locale: "pt-PT", ...(comMicrofone ? { permissions: ["microphone"] } : {}) })
    const c = await ctx.newPage()
    const erros = []
    c.on("pageerror", (e) => erros.push(e.message))
    let passo = 0
    const retratar = async (nome) => {
      passo += 1
      await c.screenshot({ path: join(CAPTURAS, `coluna-telemovel-${rotulo}-${String(passo).padStart(2, "0")}-${nome}.png`) })
    }
    const hamburguer = c.getByRole("button", { name: "Abrir o painel lateral" })

    await c.goto(APP, { waitUntil: "domcontentloaded" })
    await criarConta(c, { nome: `Carla ${rotulo}`, frase: FRASE, servidor: NOME })
    await dentro(c)
    await linhaComum(c).waitFor({ state: "attached", timeout: 90_000 })

    // 1. Opens the drawer and immediately taps the common room, before rooms arrive.
    await hamburguer.tap()
    await wait(400)
    let m = await medir(c)
    check(`${rotulo}: o hambúrguer abre a gaveta, à vista`, m.aberta && m.visivel, m.caixa)
    const salasJaLa = m.salas.filter((s) => SALAS_DA_ANA.includes(s)).length
    await linhaComum(c).locator("button.channel").tap()
    await wait(400)
    m = await medir(c)
    check(`${rotulo}: tocar na sala comum com as salas ainda a caminho deixa a gaveta à vista`, m.aberta && m.visivel, `${m.caixa}; salas da Ana já lá: ${salasJaLa}`)
    await retratar("toque-antes-das-salas")

    // 2. Rooms arrive and are visible.
    const demorou = await esperarSalas(c)
    await wait(300)
    m = await medir(c)
    check(`${rotulo}: as salas chegam com a gaveta aberta`, demorou !== null && m.aberta && m.visivel, `${demorou} ms`)
    check(`${rotulo}: e estão à vista e ao dedo, sem nada por cima`, m.salasAVista >= m.salas.length && m.salas.length >= 4, `${m.salasAVista}/${m.salas.length}`)
    await retratar("salas-a-vista")

    // 3. Tapping a room closes the drawer.
    await c.locator(".room-tree button.room", { hasText: "prensa" }).first().tap()
    await wait(600)
    m = await medir(c)
    check(`${rotulo}: tocar em "prensa" fecha a gaveta`, !m.aberta && !m.visivel, m.caixa)
    await retratar("sala-aberta")

    // 4. The menu reopens it, with rooms visible.
    await hamburguer.tap()
    await wait(500)
    m = await medir(c)
    check(`${rotulo}: o hambúrguer reabre a gaveta com as salas à vista`, m.aberta && m.visivel && m.salasAVista >= 4, `${m.salasAVista} salas, ${m.caixa}`)
    await retratar("reaberta")

    // 5. Rotate the screen. In landscape the phone becomes wide: the column becomes a column.
    const { width, height } = perfil.viewport
    await c.setViewportSize({ width: Math.max(height, 844), height: width })
    await wait(800)
    m = await medir(c)
    check(`${rotulo}: deitado, a coluna está à vista com salas`, m.visivel && m.salasAVista >= 1, `${m.salasAVista} salas, ${m.caixa}`)
    await retratar("deitado")
    await c.setViewportSize({ width, height })
    await wait(800)
    m = await medir(c)
    if (!m.aberta) {
      await hamburguer.tap()
      await wait(500)
      m = await medir(c)
    }
    check(`${rotulo}: de pé outra vez, a gaveta volta com as salas`, m.aberta && m.visivel && m.salasAVista >= 4, `${m.salasAVista} salas, ${m.caixa}`)

    // 6. A barra do browser aparece e encolhe a janela.
    await c.setViewportSize({ width, height: height - 80 })
    await wait(500)
    m = await medir(c)
    check(`${rotulo}: com a barra do browser à vista, a gaveta cabe no ecrã`, m.aberta && m.visivel && m.salasAVista >= 4, m.caixa)
    await c.setViewportSize({ width, height })
    await wait(400)

    // 7. A voice room, and the drawer again.
    if (comMicrofone) {
      await c.locator(".room-tree button.room", { hasText: "voz" }).first().tap()
      await wait(2500)
      m = await medir(c)
      check(`${rotulo}: entrar na sala de voz fecha a gaveta`, !m.aberta, m.caixa)
      await hamburguer.tap()
      await wait(600)
      m = await medir(c)
      check(`${rotulo}: na chamada, o hambúrguer abre a gaveta com as salas à vista`, m.aberta && m.visivel && m.salasAVista >= 4, `${m.salasAVista} salas, ${m.caixa}`)
      await retratar("na-chamada")
    }
    check(`${rotulo}: nenhum erro de página`, erros.length === 0, erros[0] ?? "")
    await navegador.close()
  }
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
} finally {
  for (const navegador of browsers) await navegador.close().catch(() => {})
  frente.close()
  servidor.kill()
  rmSync(dados, { recursive: true, force: true })
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
process.exit(passaram === results.length ? 0 : 1)
