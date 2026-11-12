/**
 * `@all` live (item #10 of the parity plan), with three accounts and two
 * browsers.
 *
 *   npm run build && node scripts/e2e-mencionar-todos.mjs
 *
 * Ana founds the channel (Chromium). Bruno is admin (another Chromium context).
 * Carla has no role (Firefox). Via the interface:
 *  1. Ana makes Bruno admin;
 *  2. Bruno's @ suggests "@all" at the end of the list; Carla's doesn't;
 *  3. Bruno picks "@all" and sends: Ana and Carla receive the mention in the bell;
 *  4. Carla types "@all" by hand and sends: the message reaches Ana and Bruno,
 *     and enters no one's bell;
 *  5. at 390 px, Bruno's list with "@all" fits without horizontal scroll.
 *
 * Everything local and disposable, ports 8694 to 8696. Captures in
 * `.verify-data/prova-mencionar-todos/`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, espera, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "anuncios"
const CAPTURAS = join(RAIZ, ".verify-data/prova-mencionar-todos", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8694, servidor: 8695, sfu: 0, etiqueta: "mencionar-todos" })
const browsers = []
const abertos = []
const registo = []

async function abrir(motor, nome, browser = null) {
  const b = browser ?? (await motor.launch({ headless: true }))
  if (!browser) browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
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

const caixa = (page) => page.locator('input[placeholder="Escreve uma mensagem"]').first()

/** The mention list names, with @ alone in the box. Leaves the box empty. */
async function sugestoesDaArroba(page) {
  const campo = caixa(page)
  await campo.click()
  await campo.fill("")
  await campo.pressSequentially("@", { delay: 60 })
  await page.locator(".mention-picker").first().waitFor({ timeout: 10_000 }).catch(() => {})
  const nomes = await page.locator(".mention-picker .mention-name").allTextContents()
  await page.keyboard.press("Escape")
  await campo.fill("")
  return nomes
}

/** The bell's text. */
async function sino(page) {
  await page.locator(".me-bell").first().click()
  await page.locator(".notif-list").first().waitFor({ timeout: 5_000 }).catch(() => {})
  const texto = await page.locator(".notif-list").first().innerText().catch(() => "")
  await page.keyboard.press("Escape")
  return texto
}

const viuMensagem = (page, texto) => page.locator(".message").filter({ hasText: texto }).first().isVisible().catch(() => false)

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

  // 1. Bruno becomes an administrator.
  await abrirCanal(ana.page, CANAL)
  await ana.page.locator(".member-row").filter({ hasText: "Bruno" }).first().click({ button: "right" })
  await ana.page.locator(".context-menu").getByRole("menuitem", { name: "Tornar administrador" }).click()
  for (const p of [bruno, carla]) await abrirCanal(p.page, CANAL)
  const carlaVeDireccao = await ate(
    async () => (await carla.page.locator(".member-group-head").allInnerTexts()).some((t) => /ADMINISTRA|Administra/.test(t)),
    60_000,
  )
  check("a Carla vê o Bruno administrador", carlaVeDireccao >= 0)

  // 2. The suggestion: only to those with permission, and at the end.
  let doBruno = []
  await ate(async () => (doBruno = await sugestoesDaArroba(bruno.page)).includes("@all"), 60_000, 1500)
  console.log("   sugestões do Bruno:", JSON.stringify(doBruno))
  check('a arroba do Bruno sugere "@all"', doBruno.includes("@all"))
  check('"@all" vem no fim da lista, e Enter não o escolhe por engano', doBruno.at(-1) === "@all" && doBruno[0] !== "@all")
  const daCarla = await sugestoesDaArroba(carla.page)
  console.log("   sugestões da Carla:", JSON.stringify(daCarla))
  check('a arroba da Carla não sugere "@all"', daCarla.length > 0 && !daCarla.includes("@all"))

  // 3. Bruno chooses "@all" and sends.
  {
    const campo = caixa(bruno.page)
    await campo.click()
    await campo.pressSequentially("@al", { delay: 60 })
    await bruno.page.locator(".mention-picker").first().waitFor({ timeout: 10_000 })
    await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-lista-1280.png") })
    await bruno.page.locator(".mention-picker .mention-option").filter({ hasText: "@all" }).first().click()
    await bruno.page.setViewportSize({ width: 390, height: 844 })
    await espera(300)
    await campo.pressSequentially("reuniao as 9", { delay: 20 })
    check("a caixa do Bruno diz @all por extenso", (await campo.inputValue()).startsWith("@all "), await campo.inputValue())
    await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-caixa-390.png") })
    const rola = await bruno.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    check("a 390 px, sem rolagem horizontal", !rola)
    await bruno.page.setViewportSize({ width: 1280, height: 860 })
    await bruno.page.keyboard.press("Enter")
  }
  for (const p of [ana, carla]) {
    const chegou = await ate(() => viuMensagem(p.page, "reuniao as 9"), 60_000)
    check(`a mensagem do Bruno chega a ${p.nome}`, chegou >= 0)
    let texto = ""
    const avisou = await ate(async () => /Bruno mencionou-te/.test((texto = await sino(p.page))), 30_000, 1000)
    check(`${p.nome} tem a menção do Bruno no sino`, avisou >= 0, texto.replace(/\s+/g, " ").slice(0, 120))
    await p.page.screenshot({ path: join(CAPTURAS, `${p.nome}-sino-1280.png`) })
  }

  // 4. Carla types "@all" manually, without permission.
  {
    const campo = caixa(carla.page)
    await campo.click()
    await campo.pressSequentially("@all ola a todos", { delay: 20 })
    await carla.page.keyboard.press("Escape")
    await carla.page.keyboard.press("Enter")
  }
  for (const p of [ana, bruno]) {
    const chegou = await ate(() => viuMensagem(p.page, "ola a todos"), 60_000)
    check(`a mensagem da Carla chega a ${p.nome}, com o texto "@all"`, chegou >= 0)
  }
  await espera(3000)
  for (const p of [ana, bruno]) {
    const texto = await sino(p.page)
    check(`a mensagem da Carla não entra no sino de ${p.nome}`, !/Carla mencionou-te/.test(texto), texto.replace(/\s+/g, " ").slice(0, 120))
  }
  await ana.page.screenshot({ path: join(CAPTURAS, "ana-conversa-1280.png") })
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
