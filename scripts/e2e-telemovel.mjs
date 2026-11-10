/**
 * Phone in hand: the drawer, the rooms, the long press, the people panel
 * and the keyboard.
 *
 *   node scripts/e2e-telemovel.mjs           (needs `npm run build` first)
 *
 * **Why this script had to exist.** Duarte used Orwell on a 390px screen for
 * the first time and reported: "can't see the different channels or the rooms".
 * No script proved that path. `e2e-mobile-scroll.mjs` measures four scrollers
 * (and runs against PRODUCTION); `medir-destinos.mjs` opens the drawer with
 * `click({ force: true })`, which passes through any panel on top, in other
 * words, it would hide exactly the bug that was there. This one taps like a
 * finger taps: `tap()`, no `force`, in a 390x844 context with touch.
 *
 * The path, which is the complaint read backwards:
 *   1. open the drawer from the hamburger;
 *   2. tap a channel WITH rooms: rooms appear and the drawer STAYS;
 *   3. tap a room: the drawer leaves and the conversation appears;
 *   4. tap a channel WITHOUT rooms: the drawer leaves, because there is nothing left to say;
 *   5. long press a channel: opens the menu that right-click used to open;
 *   6. the people panel opens and closes by the overlay;
 *   7. focus on the input bar does not hide it below the keyboard.
 *
 * ALL LOCAL AND ALL DISPOSABLE, following the pattern of `e2e-emparelhar.mjs`:
 * your own homeserver in a temp folder, a front end acting as Caddy on 8472, and
 * no way to point it at production.
 *
 * **What this script CANNOT prove, noted so you do not trust it too much.** Headless
 * Chromium emulates touch, not the SYSTEM: Safari's native text selection menu
 * (the "Copy / Search" bubble that a finger on text opens on iOS, and which
 * `-webkit-touch-callout: none` in `screens.css` exists to silence) does not
 * appear here, nor do the compatibility mouse events at real WebKit timings. The
 * virtual keyboard also does not exist: we measure the mechanics that receive it,
 * pushing `--teclado` by hand. These three only show up on device, and are noted
 * in `docs/PENDENTES.md`.
 *
 * The account and channels are set up with the window WIDE, where the sidebar is
 * a column not a drawer, what we want to measure is the drawer working, not a
 * setup that depends on it. Only then the window shrinks to 390x844.
 *
 * Screenshots in `capturas/telemovel-*.png`, one per step, to look at.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
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
const CAPTURAS = join(RAIZ, "capturas")
const PORTA_DA_FRENTE = 8472
const PORTA_DO_SERVIDOR = 8473
const NOME = `localhost:${PORTA_DA_FRENTE}`
const APP = `http://${NOME}/app/?lingua=pt`
const FRASE = "frase-de-verificacao-2026"
/** Duarte's phone screen, where the complaint was born. */
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
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-telemovel-"))
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
const dentro = (page) => page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })

let passo = 0
async function retratar(page, nome) {
  passo += 1
  const ficheiro = join(CAPTURAS, `telemovel-${String(passo).padStart(2, "0")}-${nome}.png`)
  await page.screenshot({ path: ficheiro })
  console.log(`  ..  captura: ${ficheiro}`)
  return ficheiro
}

/** Is the drawer out? It is the class that CSS reads to slide it. */
const gavetaAberta = (page) => page.evaluate(() => document.querySelector(".sidebar")?.classList.contains("open") === true)

/** The rooms drawn in the tree, by name. Empty when there is no tree. */
const salasNoEcra = (page) => page.evaluate(() => [...document.querySelectorAll(".room-tree .room-name")].map((n) => n.textContent))

/**
 * Close the channel drawer by tapping the overlay.
 *
 * On the stripe to the right, not in the corner: the overlay starts at 60px from
 * the sidebar and the 280px drawer sits on top of it, so the top left corner of
 * the overlay is UNDER the drawer. A tap there is a tap on the drawer, that is
 * what this script did silently until we went to see what was on top of what.
 */
async function fecharGavetaPeloVeu(page) {
  if (!(await gavetaAberta(page))) return true
  const veu = page.locator(".drawer-scrim")
  const caixa = await veu.boundingBox()
  if (!caixa) return false
  await veu.tap({ position: { x: Math.round(caixa.width - 12), y: Math.round(caixa.height / 2) } })
  await wait(400)
  return (await gavetaAberta(page)) === false
}

/** The line of a channel, by the name that reads in it. */
const linhaDoCanal = (page, nome) => page.locator(".channel-row", { has: page.locator(`.channel-name[title="${nome}"]`) }).first()

/**
 * A real long press: the finger lands, stays half a second, and lifts.
 *
 * With pointer events not `tap()`: it is `pointerdown` … wait … `pointerup`
 * that the app listens for (see `useToqueLongo`), and that is what we exercise.
 * `pointerType: "touch"` because the hook refuses the mouse on purpose.
 */
async function toqueLongo(alvo, ms = 800) {
  const caixa = await alvo.boundingBox()
  if (!caixa) throw new Error("o alvo do toque longo não está no ecrã")
  const x = Math.round(caixa.x + caixa.width / 2)
  const y = Math.round(caixa.y + caixa.height / 2)
  await alvo.evaluate(
    (el, { x, y, ms }) =>
      new Promise((resolve) => {
        const opcoes = { bubbles: true, cancelable: true, clientX: x, clientY: y }
        const baixo = new MouseEvent("pointerdown", opcoes)
        Object.defineProperty(baixo, "pointerType", { value: "touch" })
        el.dispatchEvent(baixo)
        setTimeout(() => {
          const cima = new MouseEvent("pointerup", opcoes)
          Object.defineProperty(cima, "pointerType", { value: "touch" })
          el.dispatchEvent(cima)
          resolve()
        }, ms)
      }),
    { x, y, ms },
  )
}

mkdirSync(CAPTURAS, { recursive: true })

try {
  browser = await chromium.launch({
    headless: true,
    // Fake microphone: section 6b enters a voice room.
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  })
  /*
    A context with TOUCH from the start (it is a context property not a window
    one), but wide for setup. `isMobile` turns on Chromium's mobile emulation,
    * which is what makes `pointer: coarse` and `hover: none` work, and those are
    the media queries the whole slice uses.
  */
  const ctx = await browser.newContext({
    locale: "pt-PT",
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    permissions: ["microphone"],
  })
  const erros = []
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => erros.push(`${erro.message}\n${erro.stack ?? ""}`))
  const consola = []
  page.on("console", (m) => consola.push(`${m.type()}: ${m.text()}`.slice(0, 200)))

  // ---------------------------------------------------------------------------
  // 0. Setup, with the window wide: account, two channels, and rooms in one.
  // ---------------------------------------------------------------------------
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome: "Duarte", frase: FRASE, servidor: NOME })
  await dentro(page)
  check("a conta abre", true)

  for (const canal of ["adega", "lagar"]) {
    await page.getByRole("button", { name: "Criar canal" }).first().click()
    await page.locator("form.prompt input").first().fill(canal)
    await page.locator("form.prompt button.primary").first().click()
    await page.getByRole("heading", { name: canal }).waitFor({ timeout: 30_000 })
  }
  check("dois canais criados: adega e lagar", true)

  // Rooms go to storage via the channel menu. The main view stays with the
  // conversation alone, which is the other side of the rule we are measuring.
  await linhaDoCanal(page, "adega").click()
  for (const sala of ["prensa", "barricas"]) {
    await linhaDoCanal(page, "adega").click({ button: "right" })
    await page.getByRole("menuitem", { name: "Nova sala" }).click()
    await page.locator(".sheet input").first().fill(sala)
    await page.locator(".sheet-actions button.primary").first().click()
    await page.locator(`.room-tree .room-name:text-is("${sala}")`).first().waitFor({ timeout: 30_000 })
  }
  const salasDaAdega = await salasNoEcra(page)
  check("a adega ganha duas salas", salasDaAdega.includes("prensa") && salasDaAdega.includes("barricas"), salasDaAdega.join(", "))

  // ---------------------------------------------------------------------------
  // THE WINDOW SHRINKS. From here on is Duarte's phone.
  // ---------------------------------------------------------------------------
  await page.setViewportSize(TELEMOVEL)
  await wait(800)
  check("a barra lateral deixa de ser uma coluna e passa a gaveta fechada", (await gavetaAberta(page)) === false)
  await retratar(page, "conversa-sem-gaveta")

  // ---------------------------------------------------------------------------
  // 1. The hamburger opens the drawer. Real tap, no `force`.
  // ---------------------------------------------------------------------------
  const hamburguer = page.getByRole("button", { name: "Abrir o painel lateral" })
  check("o hambúrguer está à vista e é alcançável (sem force)", await hamburguer.isVisible())
  await hamburguer.tap()
  await wait(400)
  check("tocar no hambúrguer abre a gaveta", await gavetaAberta(page))
  const alvoDoHamburguer = await hamburguer.boundingBox()
  check(
    "e o hambúrguer tem 44px de alvo, que é o mínimo a que um dedo acerta",
    (alvoDoHamburguer?.width ?? 0) >= 44 && (alvoDoHamburguer?.height ?? 0) >= 44,
    `${Math.round(alvoDoHamburguer?.width ?? 0)}x${Math.round(alvoDoHamburguer?.height ?? 0)}`,
  )
  /*
    The drawer covers the conversation entirely, and nothing sits on top of it.

    The complaint from 0.8.0 ("in mobile version users do not see the rooms")
    had two visible causes: the skin's glass (66%) let messages pass under the
    room names, and the hamburger hint got stuck by the `:hover` touch over the
    open channel line.
  */
  const gavetaOpaca = await page.evaluate(() => {
    // The ink is in the drawer itself (`paineis.css`).
    const cor = getComputedStyle(document.querySelector(".sidebar")).backgroundColor
    const alfa = /rgba?\(([^)]+)\)/.exec(cor)?.[1].split(/[ ,/]+/).filter(Boolean)[3]
    return { cor, opaca: alfa === undefined || Number(alfa) >= 0.99 }
  })
  check("a gaveta é opaca: a conversa não passa por baixo das salas", gavetaOpaca.opaca, gavetaOpaca.cor)
  const linhasAoDedo = await page.evaluate(() =>
    [...document.querySelectorAll(".sidebar .channel-row")].map((linha) => {
      const r = linha.getBoundingClientRect()
      const topo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      const dica = topo ? getComputedStyle(topo, "::after").content : ""
      return linha.contains(topo) && (dica === "none" || dica === "normal" || !dica.includes("painel"))
    }),
  )
  const dicaDoHamburguer = await hamburguer.evaluate((botao) => getComputedStyle(botao, "::after").display)
  check(
    "e nada se pousa em cima dos canais: a dica do hambúrguer não existe ao dedo",
    linhasAoDedo.length > 0 && linhasAoDedo.every(Boolean) && dicaDoHamburguer === "none",
    `${linhasAoDedo.join(",")} | ::after ${dicaDoHamburguer}`,
  )
  await retratar(page, "gaveta-aberta")

  // ---------------------------------------------------------------------------
  // 2. THE COMPLAINT. Tap a channel: rooms appear, and the drawer STAYS.
  //
  // Note on the other side of the rule: a channel WITHOUT a tree closes the drawer
  // on tap, because there is nothing left to show. Today there is no way to make
  // one here, every channel is born with three rooms (`Session.SALAS_INICIAIS`),
  // and that half only shows up in channels before rooms existed. It stays trapped
  // in component test, in `App.gaveta.test.tsx`, and is mentioned here so it does
  // not look forgotten.
  // ---------------------------------------------------------------------------
  await linhaDoCanal(page, "lagar").locator("button.channel").tap()
  await wait(700)
  const salasDoLagar = await salasNoEcra(page)
  check("tocar no lagar mostra as salas dele", salasDoLagar.includes("conversa") && salasDoLagar.includes("voz"), salasDoLagar.join(", "))
  check("E A GAVETA FICA ABERTA: é a queixa, medida", await gavetaAberta(page))
  await retratar(page, "lagar-com-salas")

  await linhaDoCanal(page, "adega").locator("button.channel").tap()
  await wait(700)
  const salasVisiveis = await salasNoEcra(page)
  check("e tocar na adega troca para as salas DELA, sem fechar nada", salasVisiveis.includes("prensa") && salasVisiveis.includes("barricas"), salasVisiveis.join(", "))
  check("a gaveta continua aberta ao segundo canal", await gavetaAberta(page))
  await retratar(page, "salas-com-gaveta-aberta")

  // ---------------------------------------------------------------------------
  // 3. Tap a room: the drawer leaves and the conversation appears.
  // ---------------------------------------------------------------------------
  const prensa = page.locator('.room-tree button.room', { hasText: "prensa" }).first()
  await prensa.tap()
  await wait(600)
  check("tocar numa sala fecha a gaveta: é o fim do percurso", (await gavetaAberta(page)) === false)
  // The conversation is in front and it is THIS room: the input box in view, no
  // panel on top, and the room highlighted in the drawer when you open it again.
  check("e a conversa está à frente, com a caixa de escrita à vista", await page.locator('input[placeholder="Escreve uma mensagem"]').isVisible())
  await retratar(page, "sala-aberta")
  await hamburguer.tap()
  await wait(400)
  const salaAcesa = await page.locator(".room-row.current .room-name").first().innerText().catch(() => "")
  check("e é a sala em que se tocou que está aberta", salaAcesa.trim() === "prensa", salaAcesa.trim())
  check("e o véu dos canais fecha a gaveta ao toque", await fecharGavetaPeloVeu(page))

  // ---------------------------------------------------------------------------
  // 4. The long press opens the menu that right-click used to open.
  // ---------------------------------------------------------------------------
  await hamburguer.tap()
  await wait(400)
  await toqueLongo(linhaDoCanal(page, "adega"))
  await wait(400)
  const menuAberto = await page.locator(".context-menu").first().isVisible().catch(() => false)
  check("manter o dedo pousado num canal abre o menu de contexto", menuAberto)
  const itensDoMenu = menuAberto ? await page.locator(".context-menu button").allInnerTexts() : []
  check("e o menu traz as acções do canal (mudar o nome, nova sala, …)", itensDoMenu.length >= 3, itensDoMenu.slice(0, 4).join(" | "))
  await retratar(page, "toque-longo-menu")
  /*
    And closes with a TAP outside, just like it does in real life.
    
    There used to be an Escape here, and it proved nothing that matters: the menu
    listens for `pointerdown` (not `mousedown`, see `ContextMenu.tsx`), and that is
    the half a finger exercises. With Escape, the menu could close from the key
    and stay stuck on touch without anyone noticing.
    
    The tap goes on the sidebar, which is always outside the menu and outside the
    drawer.
    */
  await page.locator(".rail").tap({ position: { x: 30, y: 400 } })
  await wait(400)
  check("e um toque fora dispensa o menu", (await page.locator(".context-menu").count()) === 0)
  if (!(await gavetaAberta(page))) await hamburguer.tap()
  await wait(400)

  // The other side of the same rule: a swipe does not open a menu. Without this,
  // the channel list could not be scrolled with a finger.
  const linhaParaDeslizar = linhaDoCanal(page, "adega")
  const caixa = await linhaParaDeslizar.boundingBox()
  await linhaParaDeslizar.evaluate(
    (el, { x, y }) =>
      new Promise((resolve) => {
        const fazer = (tipo, cx, cy) => {
          const evento = new MouseEvent(tipo, { bubbles: true, cancelable: true, clientX: cx, clientY: cy })
          Object.defineProperty(evento, "pointerType", { value: "touch" })
          el.dispatchEvent(evento)
        }
        fazer("pointerdown", x, y)
        setTimeout(() => fazer("pointermove", x, y - 60), 120)
        setTimeout(() => {
          fazer("pointerup", x, y - 60)
          resolve()
        }, 900)
      }),
    { x: Math.round(caixa.x + caixa.width / 2), y: Math.round(caixa.y + caixa.height / 2) },
  )
  await wait(300)
  check("mas um DESLIZE não abre menu nenhum: a lista continua a percorrer-se", (await page.locator(".context-menu").count()) === 0)
  await fecharGavetaPeloVeu(page)

  // ---------------------------------------------------------------------------
  // 5. The people panel opens, and closes by the overlay.
  // ---------------------------------------------------------------------------
  const pegaDasPessoas = page.getByRole("button", { name: "Membros" })
  const alvoDasPessoas = await pegaDasPessoas.boundingBox()
  check(
    "a pega da lista de pessoas tem 44px de alvo",
    (alvoDasPessoas?.width ?? 0) >= 44 && (alvoDasPessoas?.height ?? 0) >= 44,
    `${Math.round(alvoDasPessoas?.width ?? 0)}x${Math.round(alvoDasPessoas?.height ?? 0)}`,
  )
  await pegaDasPessoas.tap()
  await wait(500)
  check("tocar na pega abre a lista de pessoas", await page.evaluate(() => document.querySelector(".members")?.classList.contains("open") === true))
  const veu = page.locator(".members-scrim")
  check("e há um véu por baixo dela, que até aqui não existia", await veu.isVisible())
  await retratar(page, "pessoas-com-veu")
  // In a corner of the overlay, not the center: the 280px panel covers the middle
  // of the screen, and a tap in the center of the overlay was a tap on the panel.
  await veu.tap({ position: { x: 10, y: 10 } })
  await wait(500)
  check("tocar no véu fecha a lista: já não é preciso acertar outra vez na pega", await page.evaluate(() => document.querySelector(".members")?.classList.contains("open") !== true))

  // ---------------------------------------------------------------------------
  // 6. The keyboard. Focus on the input bar does not send it off screen.
  // ---------------------------------------------------------------------------
  const caixaDeEscrita = page.locator('input[placeholder="Escreve uma mensagem"]')
  await caixaDeEscrita.tap()
  await wait(400)
  const posicao = await caixaDeEscrita.boundingBox()
  const altura = TELEMOVEL.height
  check(
    "com a barra de escrita focada, ela continua dentro do ecrã",
    posicao !== null && posicao.y >= 0 && posicao.y + posicao.height <= altura + 1,
    posicao ? `topo ${Math.round(posicao.y)}, fundo ${Math.round(posicao.y + posicao.height)} de ${altura}` : "sem caixa",
  )
  /*
    The real keyboard does not exist in a headless browser, what we measure here
    is the MECHANICS that receive it: the sheet has to add `--teclado` to the
    bottom margin, and the app has to shrink when that variable grows. Push the
    variable by hand and watch the input bar rise. Without the rule in `movel.css`,
    this does not move a pixel.
  */
  const antes = (await caixaDeEscrita.boundingBox())?.y ?? 0
  await page.evaluate(() => document.documentElement.style.setProperty("--teclado", "300px"))
  await wait(400)
  const depois = (await caixaDeEscrita.boundingBox())?.y ?? 0
  check("e sobe com o teclado, em vez de ficar por baixo dele", depois < antes - 250, `${Math.round(antes)} -> ${Math.round(depois)}`)
  await retratar(page, "teclado-a-levantar-a-barra")
  await page.evaluate(() => document.documentElement.style.removeProperty("--teclado"))

  // ---------------------------------------------------------------------------
  // 6b. Rooms are visible and open, with a person page open before and a call
  //     running.
  //
  // The 0.8.0 complaint ("in mobile version users do not see the rooms") did not
  // show up here, nor on WebKit, nor with the common room, nor with 23 rooms.
  // The two paths that 0.8.0 brought back are stuck: the person page (which hides
  // the prior view) and the compact call bar.
  // ---------------------------------------------------------------------------
  /** The rooms of the open channel: on screen, with height, and nothing on top of the center. */
  const salasAoDedo = (pg) =>
    pg.evaluate(() =>
      [...document.querySelectorAll(".room-tree .room-row .room-name")].map((n) => {
        const r = n.getBoundingClientRect()
        const topo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        const dentroDoEcra = r.height > 0 && r.y >= 0 && r.bottom <= innerHeight && r.x >= 0 && r.right <= innerWidth
        return { nome: n.textContent?.trim() ?? "", ok: dentroDoEcra && Boolean(topo && n.closest(".room-row")?.contains(topo)) }
      }),
    )
  const salasCertas = (lista) => ["prensa", "barricas"].every((nome) => lista.some((s) => s.nome === nome && s.ok))

  // With a person page open before. This script has only one account, and the face
  // of the writer is their own: opening the "Me" destination. It goes back via the
  // sidebar, like it does in real life. (The page of ANOTHER person, over the
  // channel, is measured with two accounts in `scripts/sondar-salas-telemovel.mjs`.)
  await page.locator('input[placeholder="Escreve uma mensagem"]').fill("a prensa já trabalha")
  await page.locator('input[placeholder="Escreve uma mensagem"]').press("Enter")
  const cara = page.locator(".message-avatar-botao").last()
  await cara.waitFor({ timeout: 30_000 })
  await cara.tap()
  await wait(800)
  const destinoDepoisDaCara = await page.locator(".rail-btn.active").first().getAttribute("aria-label").catch(() => "")
  check('(salas) tocar na própria cara abre a página "Eu"', destinoDepoisDaCara === "Eu", destinoDepoisDaCara ?? "")
  await page.locator(".rail").getByRole("button", { name: "Comunidades", exact: true }).first().tap()
  await wait(600)
  if (!(await gavetaAberta(page))) await hamburguer.tap()
  await wait(500)
  const comPagina = await salasAoDedo(page)
  check("(salas) de volta às Comunidades, as salas da adega vêem-se na gaveta", salasCertas(comPagina), comPagina.map((s) => `${s.nome}${s.ok ? "" : "✗"}`).join(", "))
  await page.locator('.room-tree button.room', { hasText: "barricas" }).first().tap()
  await wait(800)
  check("(salas) e tocar numa sala abre a conversa dela", await page.locator('input[placeholder="Escreve uma mensagem"]').isVisible())

  // With a call: enter the voice room, and go back to a text room via the drawer.
  await hamburguer.tap()
  await wait(500)
  await page.locator('.room-tree button.room', { hasText: "voz" }).first().tap()
  await page.locator(".call").first().waitFor({ timeout: 30_000 })
  await wait(1500)
  check("(salas) tocar na sala de voz entra na chamada", await page.locator(".call").first().isVisible())
  await hamburguer.tap()
  await wait(500)
  const naChamada = await salasAoDedo(page)
  check("(salas) com a chamada a decorrer, as salas vêem-se na gaveta", salasCertas(naChamada), naChamada.map((s) => `${s.nome}${s.ok ? "" : "✗"}`).join(", "))
  await retratar(page, "salas-com-chamada")
  await page.locator('.room-tree button.room', { hasText: "prensa" }).first().tap()
  await wait(800)
  check("(salas) e tocar numa sala de texto abre a conversa, com a chamada viva", await page.locator('input[placeholder="Escreve uma mensagem"]').isVisible())
  await hamburguer.tap()
  await wait(500)
  const depoisDaChamada = await salasAoDedo(page)
  check("(salas) e as salas continuam na gaveta com a barra da chamada", salasCertas(depoisDaChamada), depoisDaChamada.map((s) => `${s.nome}${s.ok ? "" : "✗"}`).join(", "))
  await fecharGavetaPeloVeu(page)

  // ---------------------------------------------------------------------------
  // 7. The gate, which is the Face ID screen.
  //
  // You reach it the way you reach it in real life: the app closes and opens again
  // later. The session key lives in `sessionStorage` and dies with the tab, so
  // clearing it and reloading is exactly the state Duarte finds Orwell in every
  // time he opens it, that is the complaint.
  //
  // And NOT by "Sign out": with a channel open, that button blanks the app instead
  // of showing the gate. Not from this slice, it happens the same way on 0.3.0
  // that is in production, and is noted in the report with steps to reproduce.
  // ---------------------------------------------------------------------------
  await page.evaluate(() => sessionStorage.removeItem("enclave-session-key"))
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.locator('input[type="password"]').waitFor({ timeout: 60_000 })
  const campo = page.locator('input[type="password"]').first()
  check("reabrir a aplicação leva ao portão, que pede a frase-passe", true)
  check(
    "e o campo pede ao gestor do sistema para preencher (é o que faz aparecer o Face ID)",
    (await campo.getAttribute("autocomplete")) === "current-password",
    String(await campo.getAttribute("autocomplete")),
  )
  check("dentro de um formulário a sério", await campo.evaluate((el) => el.closest("form") !== null))
  check("com um campo de identidade para o gestor nomear o registo", (await page.locator('input[autocomplete="username"]').count()) === 1)
  await retratar(page, "portao-com-face-id")
  await campo.fill(FRASE)
  const antesDeAbrir = Date.now()
  await page.getByRole("button", { name: "Entrar", exact: true }).tap()
  await dentro(page)
  check("e a frase-passe abre o cofre: a chave derivada no Worker é a mesma de sempre", true, `${Date.now() - antesDeAbrir} ms`)
  await retratar(page, "reaberto-depois-do-portao")

  check("nenhum erro de página durante o percurso todo", erros.length === 0, erros[0]?.slice(0, 100) ?? "")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
console.log(`capturas em ${CAPTURAS}/telemovel-*.png`)
await arrumar(passaram === results.length ? 0 : 1)
