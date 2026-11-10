/**
 * Permissions per room live (1.2, parity plan §4), with three accounts and
 * two browsers.
 *
 *   npm run build && node scripts/e2e-cargos-permissoes.mjs
 *
 * Ana founds the channel (Chromium). Bruno has the role "Guide", only with "move"
 * (another Chromium context). Carla has no role (Firefox). Via the interface:
 *  1. Ana creates voice rooms "Arena" and "Studio", creates the "Guide" role with
 *     "move", and gives it to Bruno;
 *  2. on the "Roles" tab, under "Permissions per room", Ana removes "move" from
 *     Guide in Studio;
 *  3. Bruno moves Carla from "voice" to "Arena": the ladder shows "Arena" and not
 *     "Studio", and Ana sees Carla in Arena;
 *  4. Ana puts Carla in Studio; Bruno's menu for Carla in Studio does not have
 *     "Move to" (it is refused in the second room);
 *  5. Carla, with no role, has no "Move to" over Bruno in either room;
 *  6. at 1280 and 390 px, no horizontal scroll on the "Roles" tab.
 *
 * All local and throwaway, ports 8691 to 8693. Screenshots in
 * `.verify-data/prova-cargos-permissoes/`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, entrarNaVoz, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "permissoes"
const ARENA = "Arena"
const ESTUDIO = "Estúdio"
const CAPTURAS = join(RAIZ, ".verify-data/prova-cargos-permissoes", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8691, servidor: 8692, sfu: process.env.SEM_SFU ? 0 : 8693, etiqueta: "cargos-permissoes" })
const browsers = []
const abertos = []
const registo = []

function microfoneFalso() {
  const falso = async () => {
    const contexto = new AudioContext()
    const oscilador = contexto.createOscillator()
    const destino = contexto.createMediaStreamDestination()
    oscilador.connect(destino)
    oscilador.start()
    return destino.stream
  }
  if (typeof MediaDevices !== "undefined") {
    Object.defineProperty(MediaDevices.prototype, "getUserMedia", { value: falso, configurable: true, writable: true })
  }
  if (navigator.mediaDevices) {
    try {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: falso, configurable: true, writable: true })
    } catch {}
  }
}

async function abrir(motor, nome, browser = null) {
  const b = browser ?? (await motor.launch({ headless: true }))
  if (!browser) browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  await ctx.addInitScript(microfoneFalso)
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  page.on("console", (m) => {
    if (m.type() === "error") registo.push(`${nome} CONSOLA ${m.text().slice(0, 300)}`)
  })
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const aparelho = { nome, browser: b, ctx, page }
  abertos.push(aparelho)
  return aparelho
}

const linhaDa = (page, nome) => page.locator(".room-row").filter({ has: page.locator(".room-name", { hasText: nome }) }).first()
const salaDa = (page, nome) =>
  page.locator(".room-list > li").filter({ has: page.locator(".room-row .room-name", { hasText: new RegExp(`^${nome}$`) }) }).first()
const quemEstaEm = async (page, nome) => (await salaDa(page, nome).locator(".room-voice-members li").allInnerTexts().catch(() => [])).join(" ")

async function criarSalaDeVoz(page, nome) {
  await page.locator(".room-row button.room-new").first().click()
  await page.getByPlaceholder("Anúncios").fill(nome)
  await page.getByRole("button", { name: "Voz", exact: true }).click()
  await page.getByRole("button", { name: "Criar", exact: true }).click()
  await linhaDa(page, nome).waitFor({ timeout: 30_000 })
}

async function abaCargos(page) {
  await page.locator(".channel-list .channel-row").filter({ has: page.locator(".channel-name", { hasText: CANAL }) }).first().click({ button: "right" })
  await page.getByRole("menuitem", { name: /propriedades/i }).first().click()
  const folha = page.getByRole("dialog").first()
  await folha.getByRole("tab", { name: "Cargos", exact: true }).click()
  const painel = folha.getByRole("tabpanel", { name: "Cargos" })
  await painel.waitFor({ timeout: 15_000 })
  return { folha, painel }
}

async function menuNaVoz(page, sala, nome) {
  const botao = salaDa(page, sala).locator("button.voice-member").filter({ hasText: nome }).first()
  await botao.waitFor({ timeout: 60_000 })
  await botao.click({ button: "right" })
  const menu = page.locator(".context-menu").first()
  await menu.waitFor({ timeout: 10_000 })
  return menu
}

/** Join a voice room by exact name (the common `entrarNaVoz` only knows "voice"). */
async function entrarEm(page, nome) {
  const sala = page
    .locator(".room-row button.room")
    .filter({ has: page.locator(".room-name", { hasText: new RegExp(`^${nome}$`) }) })
    .first()
  if (!(await sala.isVisible({ timeout: 10_000 }).catch(() => false))) return false
  await sala.click()
  return true
}

async function semRolagem(page, rotulo) {
  const rola = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check(`${rotulo}: sem rolagem horizontal`, !rola)
}

try {
  // 0. Three accounts, friendships, the channel and invites.
  const ana = await abrir(chromium, "ana")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(chromium, "bruno", ana.browser)
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const carla = await abrir(firefox, "carla")
  await criarConta(carla.page, { nome: "Carla", frase: FRASE, servidor: srv.NOME })
  await dentro(carla.page)
  const [enderecoAna, enderecoBruno, enderecoCarla] = contasDoServidor(srv.base)
  await pedirAmizade(bruno.page, enderecoAna)
  check("a Ana aceita a amizade do Bruno", (await aceitarAmizade(ana.page)) >= 0)
  await pedirAmizade(carla.page, enderecoAna)
  check("a Ana aceita a amizade da Carla", (await aceitarAmizade(ana.page)) >= 0)
  await criarCanal(ana.page, CANAL)
  check("a Ana convida o Bruno", await convidar(ana.page, CANAL, enderecoBruno))
  check("a Ana convida a Carla", await convidar(ana.page, CANAL, enderecoCarla))
  check("o Bruno entra no canal", await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))
  check("a Carla entra no canal", await aceitarConvite(carla.page, CANAL, { espera: 60_000 }))

  // 1. The rooms and the "Guide" role with "move".
  await abrirCanal(ana.page, CANAL)
  await criarSalaDeVoz(ana.page, ARENA)
  await criarSalaDeVoz(ana.page, ESTUDIO)
  {
    const { folha, painel } = await abaCargos(ana.page)
    await painel.getByRole("button", { name: "Novo cargo" }).click()
    await folha.getByLabel("Nome do cargo", { exact: true }).fill("Guia")
    await folha.getByRole("tab", { name: "Permissões" }).click()
    await folha.getByRole("switch", { name: "mover", exact: true }).click()
    await folha.getByRole("button", { name: "Criar cargo" }).click()
    await painel.getByText("Guia").first().waitFor({ timeout: 15_000 })

    // 2. "Permissions per room": remove "move" from Guide in Studio.
    const lugar = painel.getByLabel("Sala ou categoria", { exact: true })
    await lugar.waitFor({ timeout: 15_000 })
    const opcoes = await lugar.locator("option").allInnerTexts()
    console.log("   lugares:", JSON.stringify(opcoes))
    await lugar.selectOption({ label: `Sala ${ESTUDIO}` })
    const celula = painel.getByLabel(new RegExp(`^mover para Guia em Sala ${ESTUDIO}$`)) // "estadoDe" in pt.ts; regex because the room name comes from the script
    await celula.selectOption("tira")
    await ana.page.waitForTimeout(1500)
    check("a Ana tira mover ao Guia no Estúdio", (await celula.inputValue()) === "tira")
    check(
      "a secção diz que é regra da app e não cifra",
      (await painel.innerText()).includes("É uma regra da app: a sala não tem chave própria"),
    )
    await ana.page.screenshot({ path: join(CAPTURAS, "ana-cargos-1280.png") })
    await semRolagem(ana.page, "a aba Cargos a 1280 px")
    await ana.page.setViewportSize({ width: 390, height: 844 })
    await ana.page.waitForTimeout(400)
    await ana.page.screenshot({ path: join(CAPTURAS, "ana-cargos-390.png") })
    await semRolagem(ana.page, "a aba Cargos a 390 px")
    await ana.page.setViewportSize({ width: 1280, height: 860 })
    await ana.page.getByRole("button", { name: "Cancelar" }).first().click().catch(() => ana.page.keyboard.press("Escape"))
  }
  // Bruno's role, from the profile (as in the moderation script).
  await ana.page.locator(".member-row").filter({ hasText: "Bruno" }).first().click()
  const caixa = ana.page.getByRole("switch", { name: "Guia" }).first()
  await caixa.waitFor({ timeout: 15_000 })
  await caixa.click()
  await ana.page.waitForTimeout(1500)
  check("a Ana dá o Guia ao Bruno", (await caixa.getAttribute("aria-checked")) === "true")
  await ana.page.getByRole("button", { name: "Voltar" }).first().click().catch(() => {})
  await abrirCanal(ana.page, CANAL)

  for (const p of [bruno, carla]) {
    await abrirCanal(p.page, CANAL)
    await linhaDa(p.page, ESTUDIO).waitFor({ timeout: 60_000 })
  }

  // 3. Bruno moves Carla from "voice" to Arena; the staircase doesn't have Studio.
  check('a Carla entra em "voz"', await entrarNaVoz(carla.page))
  await carla.page.locator(".call-barra").waitFor({ timeout: 30_000 })
  check('o Bruno vê a Carla em "voz"', (await ate(async () => (await quemEstaEm(bruno.page, "voz")).includes("Carla"), 60_000)) >= 0)
  // Bruno must know about the overlap before opening the menu.
  await bruno.page.waitForTimeout(3000)
  {
    const menu = await menuNaVoz(bruno.page, "voz", "Carla")
    const entrada = menu.getByRole("menuitem", { name: /Mover para/ })
    check('o Bruno tem "Mover para" sobre a Carla em "voz"', (await entrada.count()) === 1)
    await entrada.focus()
    await bruno.page.keyboard.press("ArrowRight")
    const escada = bruno.page.locator(".context-escada")
    const salas = await escada.locator("[role=menuitem]").allInnerTexts()
    console.log("   escada do Bruno:", JSON.stringify(salas))
    check("a escada tem a Arena", salas.includes(ARENA))
    check("a escada NÃO tem o Estúdio (recusado na segunda sala)", !salas.includes(ESTUDIO))
    await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-escada-1280.png") })
    await escada.getByRole("menuitem", { name: ARENA }).click()
    check("a Ana vê a Carla na Arena", (await ate(async () => (await quemEstaEm(ana.page, ARENA)).includes("Carla"), 30_000)) >= 0)
  }

  // 4. Ana puts Carla in Studio; Bruno cannot move her from there.
  {
    const menu = await menuNaVoz(ana.page, ARENA, "Carla")
    await menu.getByRole("menuitem", { name: /Mover para/ }).focus()
    await ana.page.keyboard.press("ArrowRight")
    await ana.page.locator(".context-escada").getByRole("menuitem", { name: ESTUDIO }).click()
    check("a Ana move a Carla para o Estúdio", (await ate(async () => (await quemEstaEm(bruno.page, ESTUDIO)).includes("Carla"), 30_000)) >= 0)
    const doBruno = await menuNaVoz(bruno.page, ESTUDIO, "Carla")
    const itens = await doBruno.locator("[role=menuitem]").allInnerTexts()
    console.log("   menu do Bruno sobre a Carla no Estúdio:", JSON.stringify(itens))
    check('no Estúdio o Bruno não tem "Mover para"', !itens.some((t) => /Mover para/.test(t)))
    await bruno.page.keyboard.press("Escape")
  }

  // 5. Carla, without a role, cannot move Bruno in either room.
  check("o Bruno entra na Arena", await entrarEm(bruno.page, ARENA))
  await bruno.page.locator(".call-barra").waitFor({ timeout: 30_000 })
  {
    await ate(async () => (await quemEstaEm(carla.page, ARENA)).includes("Bruno"), 60_000)
    const menu = await menuNaVoz(carla.page, ARENA, "Bruno")
    const itens = await menu.locator("[role=menuitem]").allInnerTexts()
    console.log("   menu da Carla sobre o Bruno na Arena:", JSON.stringify(itens))
    check('na Arena a Carla não tem "Mover para"', !itens.some((t) => /Mover para|Desligar da chamada/.test(t)))
    await carla.page.keyboard.press("Escape")
  }
  check("o Bruno entra no Estúdio", await entrarEm(bruno.page, ESTUDIO))
  {
    await ate(async () => (await quemEstaEm(carla.page, ESTUDIO)).includes("Bruno"), 60_000)
    const menu = await menuNaVoz(carla.page, ESTUDIO, "Bruno")
    const itens = await menu.locator("[role=menuitem]").allInnerTexts()
    console.log("   menu da Carla sobre o Bruno no Estúdio:", JSON.stringify(itens))
    check('no Estúdio a Carla não tem "Mover para"', !itens.some((t) => /Mover para|Desligar da chamada/.test(t)))
    await carla.page.keyboard.press("Escape")
  }
  await carla.page.screenshot({ path: join(CAPTURAS, "carla-1280.png") })
  await semRolagem(carla.page, "a Carla a 1280 px")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const a of abertos) {
    const texto = await a.page.locator("body").innerText({ timeout: 2000 }).catch(() => "(fechado)")
    console.log(`--- ${a.nome} mostra: "${texto.replace(/\s+/g, " ").slice(0, 600)}"`)
    await a.page.screenshot({ path: join(CAPTURAS, `falha-${a.nome}.png`) }).catch(() => {})
  }
}
for (const linha of registo.slice(-40)) console.log(linha)

for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
console.log(`\nCapturas: ${CAPTURAS}`)
process.exit(resumo() ? 0 : 1)
