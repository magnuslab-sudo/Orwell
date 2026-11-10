/**
 * The order of roles live (4/11/2026, owner request: "the founder/admin
 * must be able to reorganize the order in which roles are displayed"), with
 * two accounts and two browsers.
 *
 *   npm run build && node scripts/e2e-ordem-cargos.mjs
 *
 * Ana creates the channel (Chromium). Bruno is a member (Firefox). Using the UI:
 *  1. Ana creates the roles "Chief" and "Guide" and gives both to Bruno;
 *  2. Bruno sees himself in the "Chief" group, with the sub-line "Chief, Guide";
 *  3. Ana moves Chief down VIA KEYBOARD (Tab to the arrow, Enter); the screen
 *     reader hears the new position; Bruno moves to the "Guide" group,
 *     "Guide, Chief";
 *  4. Ana puts Chief back on top BY DRAG; Bruno sees it again;
 *  5. with reduced motion, the line that changes continues to settle, more slowly;
 *  6. in Bruno's profile, opened by Ana, his roles appear in the same order;
 *  7. screenshots at 1280 and 390 px, no horizontal scroll.
 *
 * All local and disposable, ports 8711 and 8712. Screenshots in
 * `.verify-data/prova-ordem-cargos/`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "ordem"
const CAPTURAS = join(RAIZ, ".verify-data/prova-ordem-cargos", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8711, servidor: 8712, sfu: 0, etiqueta: "ordem-cargos" })
const browsers = []
const abertos = []
const registo = []

async function abrir(motor, nome) {
  const b = await motor.launch({ headless: true })
  browsers.push(b)
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

async function abaCargos(page) {
  await page.locator(".channel-list .channel-row").filter({ has: page.locator(".channel-name", { hasText: CANAL }) }).first().click({ button: "right" })
  await page.getByRole("menuitem", { name: /propriedades/i }).first().click()
  const folha = page.getByRole("dialog").first()
  await folha.getByRole("tab", { name: "Cargos", exact: true }).click()
  const painel = folha.getByRole("tabpanel", { name: "Cargos" })
  await painel.waitFor({ timeout: 15_000 })
  return { folha, painel }
}

async function fecharFolha(page) {
  await page.keyboard.press("Escape")
  await page.getByRole("dialog").first().waitFor({ state: "hidden", timeout: 5000 }).catch(() => {})
}

async function criarCargo(page, nome) {
  const { folha, painel } = await abaCargos(page)
  await painel.getByRole("button", { name: "Novo cargo" }).click()
  await folha.getByLabel("Nome do cargo", { exact: true }).fill(nome)
  await folha.getByRole("button", { name: "Criar cargo" }).click()
  await painel.locator(".role-card .role-name", { hasText: nome }).first().waitFor({ timeout: 15_000 })
  await fecharFolha(page)
}

/** The declared role names, top to bottom, in the editor (without `admin`, which is first). */
const ordemNoEditor = async (painel) => (await painel.locator(".role-editor > ul > .role-card:not([data-embutido]) .role-name").allInnerTexts()).map((t) => t.trim())

/** The group headers in the member list, for those present. Lowercase: the sheet makes them uppercase. */
const gruposDe = async (page) =>
  (await page.locator(".member-list .member-group:not(.offline) > .member-group-head").allTextContents()).map((t) => t.trim().toLowerCase())

/** Bruno's sub-line in the member list. */
const subLinhaDoBruno = async (page) =>
  ((await page.locator(".member-row").filter({ hasText: "Bruno" }).first().locator(".member-role").innerText().catch(() => "")) || "").trim()

async function semRolagem(page, rotulo) {
  const rola = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check(`${rotulo}: sem rolagem horizontal`, !rola)
}

try {
  // 0. Two accounts, friendship, the channel and the invite.
  const ana = await abrir(chromium, "ana")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(firefox, "bruno")
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const [enderecoAna, enderecoBruno] = contasDoServidor(srv.base)
  await pedirAmizade(bruno.page, enderecoAna)
  check("a Ana aceita a amizade do Bruno", (await aceitarAmizade(ana.page)) >= 0)
  await criarCanal(ana.page, CANAL)
  check("a Ana convida o Bruno", await convidar(ana.page, CANAL, enderecoBruno))
  check("o Bruno entra no canal", await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))

  // 1. The roles, and both given to Bruno from his profile.
  await abrirCanal(ana.page, CANAL)
  await criarCargo(ana.page, "Chefe")
  await criarCargo(ana.page, "Guia")
  await ana.page.locator(".member-row").filter({ hasText: "Bruno" }).first().click()
  for (const nome of ["Guia", "Chefe"]) {
    const caixa = ana.page.getByRole("switch", { name: nome }).first()
    await caixa.waitFor({ timeout: 15_000 })
    await caixa.click()
    await ate(async () => (await caixa.getAttribute("aria-checked")) === "true", 15_000)
  }
  check("a Ana dá o Chefe e o Guia ao Bruno", true)
  await ana.page.getByRole("button", { name: "Voltar" }).first().click().catch(() => {})
  await abrirCanal(ana.page, CANAL)

  // 2. Bruno, in the channel, writing (to be "present"), sees himself under Chief.
  await abrirCanal(bruno.page, CANAL)
  await bruno.page.getByRole("textbox").last().fill("bom dia")
  await bruno.page.keyboard.press("Enter")
  check(
    'o Bruno vê-se no grupo "Chefe"',
    (await ate(async () => (await gruposDe(bruno.page)).some((g) => g.startsWith("chefe")), 60_000)) >= 0,
    JSON.stringify(await gruposDe(bruno.page)),
  )
  check('a sub-linha do Bruno diz "Chefe, Guia"', (await ate(async () => (await subLinhaDoBruno(bruno.page)) === "Chefe, Guia", 30_000)) >= 0)
  await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-antes-1280.png") })

  // 3. Ana moves Chief down via keyboard.
  // Regex: the string comes from `cargosEPermissoes.descer(cargo)` in pt.ts, with the script name.
  const DESCER_CHEFE = /^Descer o cargo Chefe$/
  {
    const { painel } = await abaCargos(ana.page)
    check("o editor mostra Chefe, Guia", JSON.stringify(await ordemNoEditor(painel)) === JSON.stringify(["Chefe", "Guia"]))
    check("o fundador vê UMA lista arrastável (sem a segunda secção da ordem)", (await painel.getByRole("button", { name: DESCER_CHEFE }).count()) === 1)
    const descer = painel.getByRole("button", { name: DESCER_CHEFE })
    await descer.focus()
    await ana.page.keyboard.press("Enter")
    check("o leitor de ecrã ouve o lugar novo", (await ate(async () => (await painel.getByRole("status").innerText()).includes('"Chefe" está agora no lugar 2 de 2.'), 10_000)) >= 0)
    check(
      "o foco fica numa seta do Chefe",
      await ana.page.evaluate(() => /Chefe/.test(document.activeElement?.getAttribute("aria-label") ?? "")),
    )
    check("o editor mostra Guia, Chefe", (await ate(async () => JSON.stringify(await ordemNoEditor(painel)) === JSON.stringify(["Guia", "Chefe"]), 30_000)) >= 0)
    await ana.page.screenshot({ path: join(CAPTURAS, "ana-cargos-1280.png") })
    await semRolagem(ana.page, "a aba Cargos a 1280 px")
    await ana.page.setViewportSize({ width: 390, height: 844 })
    await ana.page.waitForTimeout(400)
    await ana.page.screenshot({ path: join(CAPTURAS, "ana-cargos-390.png") })
    await semRolagem(ana.page, "a aba Cargos a 390 px")
    await ana.page.setViewportSize({ width: 1280, height: 860 })
    await fecharFolha(ana.page)
  }
  check(
    'o Bruno passa ao grupo "Guia" (outro browser, depois do commit)',
    (await ate(async () => (await gruposDe(bruno.page)).some((g) => g.startsWith("guia")), 60_000)) >= 0,
    JSON.stringify(await gruposDe(bruno.page)),
  )
  check('a sub-linha do Bruno diz "Guia, Chefe"', (await ate(async () => (await subLinhaDoBruno(bruno.page)) === "Guia, Chefe", 30_000)) >= 0)
  await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-depois-1280.png") })
  await bruno.page.setViewportSize({ width: 390, height: 844 })
  await bruno.page.waitForTimeout(400)
  // On mobile the people list is a drawer: it opens from the header handle.
  await bruno.page.locator(".members-toggle").first().click().catch(() => {})
  await bruno.page.waitForTimeout(600)
  await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-depois-390.png") })
  await semRolagem(bruno.page, "o Bruno a 390 px")
  await bruno.page.keyboard.press("Escape")
  await bruno.page.setViewportSize({ width: 1280, height: 860 })

  // 4 and 5. Ana puts Chief on top by drag, with reduced motion.
  await ana.page.emulateMedia({ reducedMotion: "reduce" })
  {
    const { painel } = await abaCargos(ana.page)
    const cartao = (nome) => painel.locator(".role-editor > ul > .role-card").filter({ has: ana.page.locator(".role-name", { hasText: nome }) }).first()
    await cartao("Chefe").dragTo(cartao("Guia"))
    const duracao = await ate(async () => {
      const valor = await cartao("Chefe").evaluate((li) => (li.classList.contains("cep-assenta") ? getComputedStyle(li).animationDuration : ""))
      return valor !== "" && valor !== "0.01ms" && valor !== "1e-05s"
    }, 5000)
    const lida = await cartao("Chefe").evaluate((li) => getComputedStyle(li).animationDuration).catch(() => "")
    console.log("   duração com movimento reduzido:", lida)
    check("com movimento reduzido a linha assenta na mesma, mais devagar", duracao >= 0 && /0\.62s|620ms/.test(lida), lida)
    check("o editor mostra Chefe, Guia outra vez", (await ate(async () => JSON.stringify(await ordemNoEditor(painel)) === JSON.stringify(["Chefe", "Guia"]), 30_000)) >= 0)
    await fecharFolha(ana.page)
  }
  check(
    'o Bruno volta ao grupo "Chefe"',
    (await ate(async () => (await gruposDe(bruno.page)).some((g) => g.startsWith("chefe")), 60_000)) >= 0,
    JSON.stringify(await gruposDe(bruno.page)),
  )
  check('a sub-linha do Bruno diz "Chefe, Guia" outra vez', (await ate(async () => (await subLinhaDoBruno(bruno.page)) === "Chefe, Guia", 30_000)) >= 0)

  // 6. Bruno's profile, opened by Ana in the channel: his roles in the same order.
  await abrirCanal(ana.page, CANAL)
  await ana.page.locator(".member-row").filter({ hasText: "Bruno" }).first().click()
  const temDoBruno = ana.page.locator(".member-roles-grupo").first().locator(".role-name")
  const nomesNoPerfil = async () => (await temDoBruno.allTextContents().catch(() => [])).map((t) => t.trim())
  await ate(async () => (await nomesNoPerfil()).length >= 2, 15_000)
  const noPerfil = await nomesNoPerfil()
  console.log("   cargos no perfil do Bruno:", JSON.stringify(noPerfil))
  check("no perfil, os cargos do Bruno vêm pela ordem do canal", JSON.stringify(noPerfil) === JSON.stringify(["Chefe", "Guia"]))
  await ana.page.screenshot({ path: join(CAPTURAS, "ana-perfil-do-bruno-1280.png") })
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
