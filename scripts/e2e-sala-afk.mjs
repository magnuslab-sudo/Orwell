/**
 * The AFK room live (2/11/2026), on three paired browsers and two tabs.
 *
 *   npm run build && node scripts/e2e-sala-afk.mjs
 *
 * Via the interface:
 *  1. Ana (Chromium) and Bruno (another Chromium context) become friends; Ana
 *     creates the channel and invites Bruno;
 *  2. Ana creates the voice room "Dormir" with "AFK Room" on: both their
 *     sidebars mark it with "AFK";
 *  3. Firefox and WebKit pair with Chromium (three of Ana's devices);
 *  4. on each of Ana's three devices: enter "voice", mute the mic, the
 *     browser clock advances 15 minutes, and the call moves on its own to
 *     "Dormir" with the warning and "Return" button; the room has no text box;
 *     Bruno sees Ana in "Dormir"; "Return" takes her back to "voice";
 *  5. with the mic on, 20 minutes pass and nothing happens;
 *  6. a second Chromium tab waits ("You already have Orwell open in another
 *     tab.") and does not enter any call.
 *
 * The mic is fake on all engines (an oscillator), and the clock is Playwright's
 * (`clock.install` + `fastForward`) only on Ana's contexts: the server and
 * Bruno run in real time. Screenshots at 1280 and 390 px in
 * `.verify-data/prova-sala-afk/`. Everything local and disposable.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, entrarNaVoz, irParaEmparelhar, pedirAmizade, temCanal, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const SEGUINTE = /^(Continuar|Seguinte)$/
const CANAL = "dormitorio"
const AFK = "Dormir"
const MOVIDO = "Estiveste silenciado 15 minutos. Passaste para a sala AFK."
const SEM_VOZ = "Na sala AFK não há voz nem texto."
const MIC_LIGADO = "Microfone ligado. Desligar microfone."
const ESPERA = "Já tens o Orwell aberto noutro separador."
const CAPTURAS = join(RAIZ, ".verify-data/prova-sala-afk", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8496, servidor: 8497, etiqueta: "sala-afk" })
const browsers = []
const abertos = []
const registo = []

/** A mic that works on any engine with no dialog: an oscillator. */
function microfoneFalso() {
  const falso = async () => {
    const contexto = new AudioContext()
    const oscilador = contexto.createOscillator()
    const destino = contexto.createMediaStreamDestination()
    oscilador.connect(destino)
    oscilador.start()
    return destino.stream
  }
  // On the prototype, not the instance: WebKit ignores direct assignment.
  if (typeof MediaDevices !== "undefined") {
    Object.defineProperty(MediaDevices.prototype, "getUserMedia", { value: falso, configurable: true, writable: true })
  }
  if (navigator.mediaDevices) {
    try {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: falso, configurable: true, writable: true })
    } catch {}
  }
}

async function abrir(motor, nome, { relogio = false } = {}) {
  const browser = await motor.launch({ headless: true })
  browsers.push(browser)
  const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  await ctx.addInitScript(microfoneFalso)
  if (relogio) await ctx.clock.install()
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  page.on("console", (m) => {
    if (m.type() === "error") registo.push(`${nome} CONSOLA ${m.text().slice(0, 300)}`)
  })
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const aparelho = { nome, browser, ctx, page }
  abertos.push(aparelho)
  return aparelho
}

async function capturar(page, nome) {
  for (const [largura, altura] of [[1280, 860], [390, 844]]) {
    await page.setViewportSize({ width: largura, height: altura })
    await page.screenshot({ path: join(CAPTURAS, `${nome}-${largura}.png`) })
    const rola = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    check(`${nome} a ${largura}px: sem rolagem horizontal`, !rola)
  }
  await page.setViewportSize({ width: 1280, height: 860 })
}

const linhaDa = (page, nome) => page.locator(".room-row").filter({ has: page.locator(".room-name", { hasText: nome }) }).first()

async function criarSalaAfk(page) {
  await page.locator(".room-row button.room-new").first().click()
  await page.getByPlaceholder("Anúncios").fill(AFK)
  await page.getByRole("button", { name: "Voz", exact: true }).click()
  await page.getByRole("switch", { name: "Sala AFK" }).click()
  await page.getByRole("button", { name: "Criar", exact: true }).click()
  await linhaDa(page, AFK).waitFor({ timeout: 30_000 })
}

async function emparelhar(ana, motor, nome) {
  await ana.page.keyboard.press("Escape").catch(() => {})
  await ana.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await ana.page.getByRole("button", { name: "Aparelhos", exact: true }).click()
  await ana.page.getByRole("button", { name: "Acrescentar aparelho" }).click()
  const folha = ana.page.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")
  const novo = await abrir(motor, nome, { relogio: true })
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
  const feito = await novo.page.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 }).then(() => true, () => false)
  await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await novo.page.getByRole("button", { name: "Entrar", exact: true }).click()
  await dentro(novo.page)
  await ana.page.keyboard.press("Escape").catch(() => {})
  check(`o ${nome} emparelha com o Chromium`, feito)
  return novo
}

async function sairDaChamada(page) {
  await page.locator(".call-barra").getByRole("button", { name: "Sair da chamada" }).click().catch(() => {})
  await page.locator(".call-barra").waitFor({ state: "detached", timeout: 15_000 }).catch(() => {})
}

try {
  // 1. The friendship and the channel.
  const ana = await abrir(chromium, "chromium", { relogio: true })
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const ctxBruno = await ana.browser.newContext({ locale: "pt-PT" })
  const bruno = await ctxBruno.newPage()
  await bruno.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(bruno, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno)
  const [enderecoAna, enderecoBruno] = contasDoServidor(srv.base)
  await pedirAmizade(bruno, enderecoAna)
  check("a Ana aceita a amizade do Bruno", (await aceitarAmizade(ana.page)) >= 0)
  await criarCanal(ana.page, CANAL)
  check("a Ana convida o Bruno", await convidar(ana.page, CANAL, enderecoBruno))
  check("o Bruno entra no canal", await aceitarConvite(bruno, CANAL, { espera: 60_000 }))

  // 2. The AFK room, created by the interface.
  await abrirCanal(ana.page, CANAL)
  await criarSalaAfk(ana.page)
  check('a Ana vê "Dormir" marcada AFK', (await linhaDa(ana.page, AFK).getAttribute("class"))?.includes("sala-afk"))
  await abrirCanal(bruno, CANAL)
  const brunoVe = await ate(async () => (await linhaDa(bruno, AFK).getAttribute("class"))?.includes("sala-afk"), 60_000)
  check('o Bruno vê "Dormir" marcada AFK', brunoVe >= 0)

  // 3. Ana's other two devices.
  const aparelhos = [ana, await emparelhar(ana, firefox, "firefox"), await emparelhar(ana, webkit, "webkit")]

  // 4. On each device: muted for 15 minutes, moves to the AFK room, then returns.
  for (const aparelho of aparelhos) {
    const { page, ctx, nome } = aparelho
    await page.keyboard.press("Escape").catch(() => {})
    await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
    check(`${nome}: tem o canal`, await temCanal(page, CANAL, 90_000))
    await abrirCanal(page, CANAL)
    await linhaDa(page, AFK).waitFor({ timeout: 60_000 })
    check(`${nome}: entra em "voz"`, await entrarNaVoz(page))
    await page.locator(".call-barra").waitFor({ timeout: 30_000 })
    const mic = page.locator(".call-barra").getByRole("button", { name: MIC_LIGADO })
    if (await mic.isVisible().catch(() => false)) await mic.click()
    await ctx.clock.fastForward("15:05")
    const movido = await page.getByText(MOVIDO).waitFor({ timeout: 20_000 }).then(() => true, () => false)
    check(`${nome}: ao fim de 15 minutos silenciado, passa para a sala AFK com o aviso`, movido)
    check(`${nome}: a sala AFK diz que não há voz nem texto`, (await page.getByText(SEM_VOZ).count()) > 0)
    check(`${nome}: a sala AFK não tem caixa de escrita`, (await page.locator('input[placeholder="Escreve uma mensagem"]').count()) === 0)
    check(`${nome}: o painel não tem o botão do microfone`, (await page.locator(".call-barra").getByRole("button", { name: /microfone/i }).count()) === 0)
    await capturar(page, `${nome}-na-sala-afk`)
    const naAfk = await ate(async () => (await bruno.locator("li").filter({ has: linhaDa(bruno, AFK) }).first().innerText()).includes("Ana") || (await linhaDa(bruno, AFK).locator(".vozes, [class*=voz]").count()) > 0, 60_000)
    check(`${nome}: o Bruno vê a Ana dentro de "Dormir"`, naAfk >= 0)
    await page.getByRole("button", { name: /^Voltar para / }).click()
    const voltou = await page.getByText(MOVIDO).waitFor({ state: "detached", timeout: 15_000 }).then(() => true, () => false)
    check(`${nome}: "Voltar" devolve a chamada a "voz" e o aviso sai`, voltou)
    const comVoz = await ate(async () => (await page.locator(".call-barra").getByRole("button", { name: /microfone/i }).count()) > 0, 20_000)
    check(`${nome}: de volta, o microfone está outra vez na barra`, comVoz >= 0)
    await sairDaChamada(page)
  }

  // 5. With the microphone on, nothing happens.
  {
    const { page, ctx } = ana
    await entrarNaVoz(page)
    await page.locator(".call-barra").waitFor({ timeout: 30_000 })
    const ligar = page.locator(".call-barra").getByRole("button", { name: "Silenciado. Ligar microfone." })
    if (await ligar.isVisible().catch(() => false)) await ligar.click()
    await ctx.clock.fastForward("20:00")
    await page.waitForTimeout(3_000)
    check("com o microfone ligado, 20 minutos passam e ninguém é movido", (await page.getByText(MOVIDO).count()) === 0)
    await sairDaChamada(page)
  }

  // 6. Chromium's second tab runs nothing.
  const segundo = await ana.ctx.newPage()
  await segundo.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const espera = await ate(async () => (await segundo.locator("body").innerText()).includes(ESPERA), 20_000)
  check("o segundo separador espera, e não abre a aplicação", espera >= 0 && (await segundo.locator(".call-barra").count()) === 0)
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const a of abertos) {
    const texto = await a.page.locator("body").innerText({ timeout: 2000 }).catch(() => "(fechado)")
    console.log(`--- ${a.nome} mostra: "${texto.replace(/\s+/g, " ").slice(0, 600)}"`)
    await a.page.screenshot({ path: join(CAPTURAS, `falha-${a.nome}.png`) }).catch(() => {})
  }
  for (const linha of registo.slice(-30)) console.log(linha)
}

for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
console.log(`\nCapturas: ${CAPTURAS}`)
process.exit(resumo() ? 0 : 1)
