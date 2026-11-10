/**
 * The channel portrait in Welcome, on three real browsers (phase 1 of
 * `docs/planos/estado-cifrado-plano.md`).
 *
 *   npm run build && node scripts/e2e-retrato.mjs
 *
 * The case the owner saw: someone entering by link with no admins online
 * ended up with "general" and no idea who is in charge. Via the interface:
 *
 *  1. Ana (Chromium) founds the channel "lagar", creates rooms "prensa" and
 *     "tonel" and the role "Gatekeeper" (invite only), and gives it to Carla;
 *  2. Carla (WebKit, with no admin role) mints a link;
 *  3. Ana CLOSES the browser: no admins are online;
 *  4. Bruno (Firefox) opens the link, creates an account and joins; he sees
 *     the channel name, both rooms, and Carla's role, with no Ana;
 *  5. Bruno opens a second tab (waits), closes the first, and the second takes
 *     over: asks for the password and shows the same, read from the vault.
 *
 * And, with `ORWELL_DIST_ANTIGO` (the `apps/web/dist` from a released version,
 * say 1.0.8, saved BEFORE touching the client), backward compatibility: the old
 * web on another port, same server. The 1.0.8 invites a new client (Welcome
 * with no portrait: the old path) and is invited by it (its sheet does not
 * declare the extension, so no portrait goes and the cascade runs). Both ways
 * the channel arrives with the name and rooms, and messages pass.
 *
 * Two tabs, three browsers. EVERYTHING LOCAL AND DISPOSABLE: a homeserver
 * in a temp folder (`servidor-descartavel.mjs`), its own ports, no way to
 * point it at production. No screenshots: disk is tight.
 */
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { argon2id } from "@noble/hashes/argon2.js"
import { existsSync, readFileSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { extname, join, normalize } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, ate, contasDoServidor, criarCanal, dentro, dizer, ouviu, verificador } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "lagar"
const SALAS = ["prensa", "tonel"]
const CARGO = "Porteiro"
const ESPERA = "Já tens o Orwell aberto noutro separador."

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8540, servidor: 8541, etiqueta: "retrato" })
const browsers = []
const paginas = []

async function abrir(motor, nome, app = srv.APP) {
  const browser = await motor.launch({ headless: true })
  browsers.push(browser)
  const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (erro) => erros.push(erro.message))
  await page.goto(app, { waitUntil: "domcontentloaded" })
  const aparelho = { nome, browser, ctx, page, erros }
  paginas.push(aparelho)
  return aparelho
}

/** The browser vault, read from IndexedDB and opened with the passphrase, here in Node (template from `e2e-emparelhar.mjs`). */
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
  const ficheiro = JSON.parse(bruto.startsWith("orwv2\n") ? bruto.slice(6) : bruto)
  const b64 = (texto) => Buffer.from(texto.replace(/-/g, "+").replace(/_/g, "/"), "base64")
  const chave = argon2id(new TextEncoder().encode(FRASE), b64(ficheiro.salt), { t: 3, m: 65_536, p: 4, dkLen: 32 })
  return JSON.parse(new TextDecoder().decode(xchacha20poly1305(chave, b64(ficheiro.nonce)).decrypt(b64(ficheiro.ciphertext))))
}

/** The name and rooms of lagar in the vault: the channel whose banner is "lagar". */
function lagarNoCofre(cofre) {
  const canal = Object.keys(cofre?.spaceMeta ?? {}).find((c) => cofre.spaceMeta[c]?.payload?.name === CANAL)
  return { canal, salas: canal ? Object.values(cofre.channelRooms?.[canal] ?? {}).map((sala) => sala?.payload?.name) : [] }
}

const linhaDe = (page, nome) => page.locator(".channel-list .channel-row").filter({ has: page.locator(".channel-name", { hasText: nome }) }).first()
const linhaDoCanal = (page) => linhaDe(page, CANAL)

/** A new room in the channel, from the channel menu. */
async function salaNova(page, canal, sala) {
  await linhaDe(page, canal).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Nova sala" }).click()
  await page.locator(".sheet input").first().fill(sala)
  await page.locator(".sheet-actions button.primary").first().click()
  await page.locator(`.room-tree .room-name:text-is("${sala}")`).first().waitFor({ timeout: 30_000 })
}

/** Whether this page shows the channel by name and with these rooms. */
async function veCanal(page, canal, salas, ms = 30_000) {
  await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  const inicio = Date.now()
  while (Date.now() - inicio < ms) {
    await linhaDe(page, canal).click({ timeout: 2_000 }).catch(() => {})
    const nome = (await page.locator(`.channel-name[title="${canal}"]`).count()) > 0
    const vistas = await salasNoEcra(page)
    if (nome && salas.every((sala) => vistas.includes(sala))) return true
    await page.waitForTimeout(300)
  }
  return false
}

/** A static front end for an old web, on another port, passing the rest to the same server. */
async function frenteDe(dist, porta, portaDoServidor) {
  const tipos = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".wasm": "application/wasm" }
  const frente = http.createServer((pedido, resposta) => {
    const caminho = (pedido.url ?? "/").split("?")[0]
    if (caminho.startsWith("/app")) {
      const relativo = normalize(decodeURIComponent(caminho.slice("/app".length))).replace(/^(\.\.[/\\])+/, "")
      let ficheiro = join(dist, relativo)
      if (!ficheiro.startsWith(dist) || !existsSync(ficheiro) || statSync(ficheiro).isDirectory()) ficheiro = join(dist, "index.html")
      resposta.writeHead(200, { "content-type": tipos[extname(ficheiro)] ?? "application/octet-stream", "cache-control": "no-cache" })
      resposta.end(readFileSync(ficheiro))
      return
    }
    const adiante = http.request({ host: "127.0.0.1", port: portaDoServidor, path: pedido.url, method: pedido.method, headers: pedido.headers }, (vinda) => {
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
    const destino = net.connect(portaDoServidor, "127.0.0.1", () => {
      const linhas = [`${pedido.method} ${pedido.url} HTTP/${pedido.httpVersion}`]
      for (let i = 0; i < pedido.rawHeaders.length; i += 2) linhas.push(`${pedido.rawHeaders[i]}: ${pedido.rawHeaders[i + 1]}`)
      destino.write(`${linhas.join("\r\n")}\r\n\r\n`)
      if (cabeca.length) destino.write(cabeca)
      socket.pipe(destino).pipe(socket)
    })
    destino.on("error", () => socket.destroy())
    socket.on("error", () => destino.destroy())
  })
  await new Promise((resolve) => frente.listen(porta, "127.0.0.1", resolve))
  return frente
}
const salasNoEcra = (page) => page.evaluate(() => [...document.querySelectorAll(".room-tree .room-name")].map((n) => n.textContent?.trim() ?? ""))

/** What this page shows of the channel: the name in the bar, the rooms, and Carla's role in her profile. */
async function oQueSeVe(page, ms = 30_000) {
  await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  const nome = await page.locator(`.channel-name[title="${CANAL}"]`).first().waitFor({ state: "attached", timeout: ms }).then(() => true, () => false)
  let salas = []
  const inicio = Date.now()
  while (Date.now() - inicio < ms) {
    // The open channel might be another one (the shared room, on unlock): we open lagar until the tree is its own.
    await linhaDoCanal(page).click({ timeout: 2_000 }).catch(() => {})
    salas = await salasNoEcra(page)
    if (SALAS.every((sala) => salas.includes(sala))) break
    await page.waitForTimeout(300)
  }
  let cargo = false
  const carla = page.locator(".member-row").filter({ hasText: "Carla" }).first()
  if (await carla.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await carla.click()
    cargo = await page.locator(".role-card .role-name", { hasText: CARGO }).first().waitFor({ timeout: 10_000 }).then(() => true, () => false)
    await page.keyboard.press("Escape").catch(() => {})
  }
  return { nome, salas, cargo, ms: Date.now() - inicio }
}

try {
  // 1. A Ana funda e arruma, no Chromium.
  const ana = await abrir(chromium, "chromium")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  await criarCanal(ana.page, CANAL)
  for (const sala of SALAS) await salaNova(ana.page, CANAL, sala)
  check("a Ana funda o lagar e cria prensa e tonel", true)

  await linhaDoCanal(ana.page).click({ button: "right" })
  await ana.page.getByRole("menuitem", { name: /propriedades/i }).first().click()
  const propriedades = ana.page.getByRole("dialog").first()
  // Properties by section (3/11/2026): roles live in the "Roles" tab.
  await propriedades.getByRole("tab", { name: "Cargos", exact: true }).click()
  await propriedades.getByRole("button", { name: "Novo cargo" }).click()
  await propriedades.getByLabel("Nome do cargo").fill(CARGO)
  await propriedades.getByRole("tab", { name: "Permissões" }).click()
  await propriedades.getByRole("switch", { name: "convidar" }).click()
  await propriedades.getByRole("button", { name: "Criar cargo" }).click()
  check("e o cargo Porteiro (só convidar)", await propriedades.getByText(CARGO).first().waitFor({ timeout: 15_000 }).then(() => true, () => false))
  await ana.page.getByRole("button", { name: "Cancelar" }).first().click().catch(() => {})
  await ana.page.keyboard.press("Escape").catch(() => {})

  // Carla, on WebKit, enters by address and gets the role.
  const carla = await abrir(webkit, "webkit")
  await criarConta(carla.page, { nome: "Carla", frase: FRASE, servidor: srv.NOME })
  await dentro(carla.page)
  const enderecoCarla = contasDoServidor(srv.base)[1]
  check("a Ana convida a Carla", await convidar(ana.page, CANAL, enderecoCarla))
  check("a Carla entra no lagar", await aceitarConvite(carla.page, CANAL, { espera: 60_000 }))
  await linhaDoCanal(ana.page).click()
  const carlaNaAna = ana.page.locator(".member-row").filter({ hasText: "Carla" }).first()
  await carlaNaAna.waitFor({ timeout: 60_000 })
  await carlaNaAna.click()
  // Giving a role is a toggle with the role name (`MemberRoles`), in that person's profile.
  const interruptor = ana.page.locator(".role-card").getByRole("switch", { name: CARGO }).first()
  await interruptor.waitFor({ timeout: 15_000 })
  await interruptor.click()
  check("a Ana dá o cargo à Carla", (await ate(async () => (await interruptor.getAttribute("aria-checked")) === "true", 15_000, 300)) >= 0)
  await ana.page.keyboard.press("Escape").catch(() => {})

  // 2. Carla mints the link (can invite; does not manage the channel).
  await carla.page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  let link = null
  const inicioDoLink = Date.now()
  while (!link && Date.now() - inicioDoLink < 60_000) {
    await linhaDoCanal(carla.page).click({ button: "right" })
    const convidarItem = carla.page.getByRole("menuitem", { name: "Convidar…" }).first()
    if (!(await convidarItem.isVisible({ timeout: 3000 }).catch(() => false))) {
      await carla.page.keyboard.press("Escape").catch(() => {})
      await carla.page.waitForTimeout(1000)
      continue
    }
    await convidarItem.click()
    const folha = carla.page.locator(".sheet").first()
    await folha.getByRole("button", { name: "Por link" }).click().catch(() => {})
    await folha.getByRole("button", { name: "Criar link" }).click()
    const campo = folha.getByLabel("O teu link")
    link = await campo.waitFor({ timeout: 15_000 }).then(() => campo.inputValue(), () => null)
    await folha.getByRole("button", { name: "Fechar" }).click().catch(() => {})
  }
  check("a Carla (porteira, sem arrumar) cunha um link", typeof link === "string" && /\/(c|app\/convite)[/#]/.test(link), String(link))

  // 3. Ana closes the browser.
  await ana.browser.close()
  await carla.page.waitForTimeout(1500)
  check("a Ana fecha o browser: ninguém da administração ligado", true)

  // 4. Bruno, on Firefox, opens the link.
  // Creates an account and pastes the link in "Join with a link" (this script's front end does not serve `/c/`).
  const bruno = await abrir(firefox, "firefox")
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  await bruno.page.locator("button.join-link").first().click()
  await bruno.page.locator("form.prompt input").first().fill(link)
  await bruno.page.locator("form.prompt button.primary").first().click()
  const pergunta = bruno.page.getByRole("heading", { name: "Convite para um canal" })
  if (await pergunta.waitFor({ timeout: 20_000 }).then(() => true, () => false)) {
    await bruno.page.getByRole("button", { name: "Entrar", exact: true }).click()
  }
  const entrou = Date.now()
  const vista = await oQueSeVe(bruno.page)
  check("firefox: o Bruno vê o canal pelo nome, sem a Ana", vista.nome)
  check("firefox: e as duas salas da Ana", SALAS.every((sala) => vista.salas.includes(sala)), `${vista.salas.join(", ")} em ${Date.now() - entrou} ms`)
  check("firefox: e o cargo da Carla", vista.cargo)

  const noCofre = lagarNoCofre(await cofreDe(bruno.page).catch(() => null))
  check("firefox: o nome e as salas ficaram no cofre do browser", noCofre.canal !== undefined && SALAS.every((sala) => noCofre.salas.includes(sala)), noCofre.salas.join(", "))

  // 5. Two tabs: the second waits, the first closes, the second takes over.
  const segundo = await bruno.ctx.newPage()
  await segundo.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const esperou = await ate(async () => (await segundo.locator("body").innerText()).includes(ESPERA), 20_000, 500)
  check("firefox: o segundo separador espera", esperou >= 0)
  await bruno.page.close()
  const campo = segundo.locator('.gate-card input[type="password"]').first()
  const pediu = await campo.waitFor({ timeout: 30_000 }).then(() => true, () => false)
  check("firefox: fechado o primeiro, o segundo assume e pede a palavra-passe", pediu)
  if (pediu) {
    await campo.fill(FRASE)
    await segundo.getByRole("button", { name: "Entrar", exact: true }).click()
    await dentro(segundo)
    const depois = await oQueSeVe(segundo)
    const canais = await segundo.locator(".channel-list .channel-name").allInnerTexts().catch(() => [])
    check(
      "firefox, segundo separador: o mesmo nome, as mesmas salas e o mesmo cargo, do cofre",
      depois.nome && SALAS.every((sala) => depois.salas.includes(sala)) && depois.cargo,
      `nome ${depois.nome}, salas ${depois.salas.join(", ")}, cargo ${depois.cargo}, canais ${canais.join(" | ")}`,
    )
  }
  for (const aparelho of paginas) check(`${aparelho.nome}: nenhum erro de página`, aparelho.erros.length === 0, aparelho.erros[0] ?? "")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const aparelho of paginas) {
    for (const p of aparelho.ctx.pages()) {
      const texto = await p.locator("body").innerText({ timeout: 2000 }).catch(() => "(fechado)")
      console.log(`--- ${aparelho.nome} mostra: "${texto.replace(/\s+/g, " ").slice(0, 400)}"`)
    }
  }
}

// 6. Backward compatibility with a released web (only with ORWELL_DIST_ANTIGO).
const DIST_ANTIGO = process.env.ORWELL_DIST_ANTIGO
let frenteAntiga = null
if (DIST_ANTIGO) {
  try {
    if (!existsSync(join(DIST_ANTIGO, "index.html"))) throw new Error(`ORWELL_DIST_ANTIGO sem index.html: ${DIST_ANTIGO}`)
    frenteAntiga = await frenteDe(DIST_ANTIGO, 8542, 8541)
    const antiga = await abrir(chromium, "chromium antigo", "http://localhost:8542/app/?lingua=pt")
    await criarConta(antiga.page, { nome: "Rita", frase: FRASE, servidor: srv.NOME })
    await dentro(antiga.page)
    const novo = await abrir(firefox, "firefox novo")
    await criarConta(novo.page, { nome: "Rui", frase: FRASE, servidor: srv.NOME })
    await dentro(novo.page)
    const contas = contasDoServidor(srv.base)
    const [enderecoRita, enderecoRui] = contas.slice(-2)

    // a) Old web invites new: Welcome with no portrait, and Rita's cascade (online) does the rest.
    await criarCanal(antiga.page, "moinho")
    await salaNova(antiga.page, "moinho", "mo")
    check("antiga: a Rita convida o Rui (novo) para o moinho", await convidar(antiga.page, "moinho", enderecoRui))
    check("novo: o Rui entra no moinho", await aceitarConvite(novo.page, "moinho", { espera: 60_000 }))
    check("novo: e vê o moinho pelo nome, com a sala da Rita", await veCanal(novo.page, "moinho", ["mo"]))

    // b) New invites old: Rita's sheet does not declare the extension, no portrait goes, cascade runs.
    await criarCanal(novo.page, "forno")
    await salaNova(novo.page, "forno", "lenha")
    check("novo: o Rui convida a Rita (antiga) para o forno", await convidar(novo.page, "forno", enderecoRita))
    check("antiga: a Rita entra no forno", await aceitarConvite(antiga.page, "forno", { espera: 60_000 }))
    check("antiga: e vê o forno pelo nome, com a sala do Rui", await veCanal(antiga.page, "forno", ["lenha"]))

    // And no one goes deaf: messages pass on both channels, both ways.
    for (const [canal, quem, quemOuve, rotulo] of [
      ["moinho", antiga.page, novo.page, "a Rita fala no moinho e o Rui lê"],
      ["moinho", novo.page, antiga.page, "o Rui fala no moinho e a Rita lê"],
      ["forno", novo.page, antiga.page, "o Rui fala no forno e a Rita lê"],
      ["forno", antiga.page, novo.page, "a Rita fala no forno e o Rui lê"],
    ]) {
      await abrirCanal(quem, canal)
      await abrirCanal(quemOuve, canal)
      const frase = `${canal} ${Date.now().toString(36)}`
      await dizer(quem, frase)
      const ms = await ouviu(quemOuve, frase)
      check(rotulo, ms >= 0, `${ms} ms`)
    }
    check("antiga e nova: nenhum erro de página", antiga.erros.length === 0 && novo.erros.length === 0, antiga.erros[0] ?? novo.erros[0] ?? "")
  } catch (erro) {
    check("a parte da compatibilidade chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  }
}

for (const b of browsers) await b.close().catch(() => {})
frenteAntiga?.close()
srv.fechar()
process.exit(resumo() ? 0 : 1)
