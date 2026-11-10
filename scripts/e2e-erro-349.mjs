/**
 * Error 349 (2 November 2026): the paired device does not recreate the feed.
 *
 *   npm run build && node scripts/e2e-erro-349.mjs
 *   MOTORES=chromium,webkit node scripts/e2e-erro-349.mjs
 *
 * Ana is born on Chromium, becomes friends with Bruno and enters one of his channels.
 * Then pair the devices from `MOTORES`, in this order (Firefox and WebKit by default).
 * Before the fix, WebKit paired in second place showed "Error 349: The channel
 * "<opaque address>" lost its state and was recreated" in 11 of 12 runs: the first
 * pass through friendships requested the feed before the Welcome for it arrived, and
 * `ensureFeed` made a new group at the same address. Each device stays online for 15s
 * and cannot show the warning.
 */
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { aceitarAmizade, contasDoServidor, criarCanal, dentro, irParaEmparelhar, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"
const FRASE = "frase-de-verificacao-2026"
const SEGUINTE = /^(Continuar|Seguinte)$/
const motores = { chromium, firefox, webkit }
const ordem = (process.env.MOTORES ?? "firefox,webkit").split(",")
const porta = Number(process.env.PORTA ?? 8590)
const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: porta, servidor: porta + 1, etiqueta: "erro-349" })
const browsers = []
async function abrir(motor, nome) {
  const browser = await motor.launch({ headless: true })
  browsers.push(browser)
  const ctx = await browser.newContext({ locale: "pt-PT" })
  const page = await ctx.newPage()
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  return { nome, browser, ctx, page }
}
try {
  const ana = await abrir(chromium, "chromium")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  {
    const ctxBruno = await ana.browser.newContext({ locale: "pt-PT" })
    const bruno = await ctxBruno.newPage()
    await bruno.goto(srv.APP, { waitUntil: "domcontentloaded" })
    await criarConta(bruno, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
    await dentro(bruno)
    const [enderecoAna] = contasDoServidor(srv.base)
    await pedirAmizade(bruno, enderecoAna)
    await aceitarAmizade(ana.page)
    await criarCanal(bruno, "celeiro")
    await convidar(bruno, "celeiro", enderecoAna)
    await aceitarConvite(ana.page, "celeiro", { espera: 60_000 })
  }
  for (const nome of ordem) {
    await ana.page.keyboard.press("Escape").catch(() => {})
    await ana.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
    await ana.page.getByRole("button", { name: "Aparelhos", exact: true }).click()
    await ana.page.getByRole("button", { name: "Acrescentar aparelho" }).click()
    const folha = ana.page.locator(".sheet").first()
    await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
    const link = await folha.locator("code[data-link]").getAttribute("data-link")
    const novo = await abrir(motores[nome], nome)
    await irParaEmparelhar(novo.page)
    await novo.page.getByLabel("Ou cola o link").fill(link)
    await novo.page.getByRole("button", { name: SEGUINTE }).first().click()
    await novo.page.getByRole("heading", { name: "Palavra-passe deste aparelho" }).waitFor({ timeout: 15_000 })
    const campos = novo.page.locator('.gate-card input[type="password"]')
    for (let i = 0; i < (await campos.count()); i++) await campos.nth(i).fill(FRASE)
    await novo.page.getByRole("button", { name: SEGUINTE }).first().click()
    await novo.page.locator(".sas-palavras").waitFor({ timeout: 30_000 })
    await folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
    await novo.page.getByRole("button", { name: "São as mesmas" }).click()
    await folha.getByRole("button", { name: "São as mesmas" }).click()
    await novo.page.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 })
    await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
    await novo.page.getByRole("button", { name: "Entrar", exact: true }).click()
    await dentro(novo.page)
    await new Promise((r) => setTimeout(r, 15_000))
    const texto = await novo.page.locator("body").innerText()
    const m = /Erro 349[^\n]*|[^\n]*perdeu o estado[^\n]*/.exec(texto)
    check(`${nome}: emparelhado, não diz que um canal foi recriado`, m === null, m?.[0] ?? "")
  }
  check("o guião chegou ao fim", true)
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
}
for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
process.exit(resumo() ? 0 : 1)
