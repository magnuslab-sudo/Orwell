/**
 * One account in three browsers (Chromium, Firefox, WebKit), paired, with two
 * tabs in each. Line 4 of phase 7.
 *
 *   npm run build && node scripts/e2e-tres-browsers.mjs
 *
 * By the interface:
 *  1. Ana is born in Chromium; Bruno (another Chromium context) asks her for
 *     friendship and invites her to a channel;
 *  2. Firefox and WebKit pair with Chromium via the link, each with the same
 *     six words;
 *  3. in each browser a second tab of the same origin opens: it says "You
 *     already have Orwell open in another tab" and does not act; in Firefox
 *     the second one clicks "Use this tab" and becomes the owner;
 *  4. Bruno writes in the channel and the three owners read; each owner writes
 *     and Bruno reads all three; Bruno's direct message reaches all three.
 *
 * A browser is a device: all three have different device keys, and the account
 * manifest ends up with three.
 */
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, abrirDirecta, aceitarAmizade, ate, consultar, contasDoServidor, criarCanal, dentro, dizer, irParaEmparelhar, ouviu, pedirAmizade, temCanal, verificador } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const SEGUINTE = /^(Continuar|Seguinte)$/
const ESPERA = "Já tens o Orwell aberto noutro separador."
const USAR = "Usar este separador"
const CANAL = "celeiro"

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8490, servidor: 8491, etiqueta: "tres-browsers" })
const browsers = []
const aparelhos = []

async function abrir(motor, nome) {
  const browser = await motor.launch({ headless: true })
  browsers.push(browser)
  const ctx = await browser.newContext({ locale: "pt-PT" })
  const page = await ctx.newPage()
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const aparelho = { nome, browser, ctx, page }
  aparelhos.push(aparelho)
  return aparelho
}

async function destrancar(page) {
  const campo = page.locator('.gate-card input[type="password"]').first()
  await campo.waitFor({ timeout: 30_000 })
  await campo.fill(FRASE)
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
  await dentro(page)
}

try {
  // 1. Ana in Chromium, Bruno, friendship and the channel.
  const ana = await abrir(chromium, "chromium")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const ctxBruno = await ana.browser.newContext({ locale: "pt-PT" })
  const bruno = await ctxBruno.newPage()
  await bruno.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(bruno, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno)
  const [enderecoAna] = contasDoServidor(srv.base)
  await pedirAmizade(bruno, enderecoAna)
  check("a Ana aceita a amizade no Chromium", (await aceitarAmizade(ana.page)) >= 0)
  await criarCanal(bruno, CANAL)
  check("o Bruno convida a Ana", await convidar(bruno, CANAL, enderecoAna))
  check("a Ana entra no canal", await aceitarConvite(ana.page, CANAL, { espera: 60_000 }))

  // 2. Firefox and WebKit pair with Chromium.
  for (const [motor, nome] of [
    [firefox, "firefox"],
    [webkit, "webkit"],
  ]) {
    await ana.page.keyboard.press("Escape").catch(() => {})
    await ana.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
    await ana.page.getByRole("button", { name: "Aparelhos", exact: true }).click()
    await ana.page.getByRole("button", { name: "Acrescentar aparelho" }).click()
    const folha = ana.page.locator(".sheet").first()
    await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
    const link = await folha.locator("code[data-link]").getAttribute("data-link")
    const novo = await abrir(motor, nome)
    await irParaEmparelhar(novo.page)
    await novo.page.getByLabel("Ou cola o link").fill(link)
    await novo.page.getByRole("button", { name: SEGUINTE }).first().click()
    await novo.page.getByRole("heading", { name: "Palavra-passe deste aparelho" }).waitFor({ timeout: 15_000 })
    const campos = novo.page.locator('.gate-card input[type="password"]')
    for (let i = 0; i < (await campos.count()); i++) await campos.nth(i).fill(FRASE)
    await novo.page.getByRole("button", { name: SEGUINTE }).first().click()
    await novo.page.locator(".sas-palavras").waitFor({ timeout: 30_000 })
    await folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
    const iguais = (await novo.page.locator(".sas-palavras").getAttribute("data-palavras")) === (await folha.locator(".sas-palavras").getAttribute("data-palavras"))
    await novo.page.getByRole("button", { name: "São as mesmas" }).click()
    await folha.getByRole("button", { name: "São as mesmas" }).click()
    const feito = await novo.page.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 }).then(() => true, () => false)
    await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
    await novo.page.getByRole("button", { name: "Entrar", exact: true }).click()
    await dentro(novo.page)
    check(`o ${nome} emparelha com o Chromium (as mesmas seis palavras)`, iguais && feito)
  }
  const manifesto = consultar(srv.base, "SELECT manifest FROM device_manifests WHERE address = ?", enderecoAna)[0]
  const nAparelhos = manifesto ? JSON.parse(manifesto.manifest).devices.length : 0
  check("o manifesto da conta tem três aparelhos, um por browser", nAparelhos === 3, String(nAparelhos))
  check("e o servidor tem as duas contas, e não mais", contasDoServidor(srv.base).length === 2)

  // 3. The second tab in each browser.
  const donos = {}
  for (const a of aparelhos) {
    const p2 = await a.ctx.newPage()
    await p2.goto(srv.APP, { waitUntil: "domcontentloaded" })
    const espera = await ate(async () => (await p2.locator("body").innerText()).includes(ESPERA), 20_000, 500)
    check(`${a.nome}: o segundo separador espera ("${ESPERA}")`, espera >= 0)
    check(`${a.nome}: e não abre a aplicação`, (await p2.getByRole("button", { name: "Configurações", exact: true }).count()) === 0)
    donos[a.nome] = a.page
    if (a.nome === "firefox") {
      await p2.getByRole("button", { name: USAR }).click()
      await destrancar(p2)
      const cedeu = await ate(async () => (await a.page.locator("body").innerText()).includes(ESPERA), 15_000, 500)
      check('firefox: "Usar este separador" passa a posse ao segundo, e o primeiro cede', cedeu >= 0)
      donos.firefox = p2
    }
  }

  // 4. The channel and the direct in all three owners.
  for (const [nome, page] of Object.entries(donos)) {
    // Chromium stayed in Settings (add devices): the channel list only exists in Communities.
    await page.keyboard.press("Escape").catch(() => {})
    await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
    check(`${nome}: o dono vê o canal ${CANAL}`, await temCanal(page, CANAL, 90_000))
    await abrirCanal(page, CANAL)
  }
  await abrirCanal(bruno, CANAL)
  const doBruno = `do Bruno para os três browsers ${Date.now().toString(36)}`
  await dizer(bruno, doBruno)
  for (const [nome, page] of Object.entries(donos)) {
    const ms = await ouviu(page, doBruno)
    check(`${nome}: lê o Bruno no canal`, ms >= 0, `${ms} ms`)
  }
  for (const [nome, page] of Object.entries(donos)) {
    const frase = `do ${nome} ${Date.now().toString(36)}`
    await dizer(page, frase)
    const ms = await ouviu(bruno, frase)
    check(`o Bruno lê o ${nome}`, ms >= 0, `${ms} ms`)
  }
  await abrirDirecta(bruno)
  const naDirecta = `directa para os três ${Date.now().toString(36)}`
  await dizer(bruno, naDirecta)
  for (const [nome, page] of Object.entries(donos)) {
    await abrirDirecta(page).catch(() => {})
    const ms = await ouviu(page, naDirecta)
    check(`${nome}: lê a directa do Bruno`, ms >= 0, `${ms} ms`)
  }
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const a of aparelhos) {
    for (const p of a.ctx.pages()) {
      const texto = await p.locator("body").innerText({ timeout: 2000 }).catch(() => "(fechado)")
      console.log(`--- ${a.nome} mostra: "${texto.replace(/\s+/g, " ").slice(0, 500)}"`)
    }
  }
}

for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
process.exit(resumo() ? 0 : 1)
