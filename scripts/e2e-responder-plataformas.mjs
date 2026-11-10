/**
 * Replying to a message: what `e2e-responder.mjs` left unproven.
 *
 *   npm run build && node scripts/e2e-responder-plataformas.mjs
 *
 * The house rule calls for three engines and two devices before production
 * (Chromium and Firefox are already in `e2e-responder.mjs`). Here:
 *
 *  - Ana has TWO devices: Chromium, where the account starts, and a real
 *    desktop app (Electron, `secretaria.mjs`), paired by link and by six
 *    words;
 *  - Bruno is on WebKit;
 *  - Carla is on Chromium with a touch screen (`hasTouch`, 390 px on swipe),
 *    and replies with her finger: swipe left, via real touch events (CDP
 *    `Input.dispatchTouchEvent`), not clicks.
 *
 * The flow:
 *  1. Bruno (WebKit) asks;
 *  2. Ana replies from desktop (Electron), from the action bar, with
 *     "@ Mention" on; Bruno sees the quote and the mention in the bell; Ana's
 *     OTHER device (Chromium) sees the same reply with the same quote;
 *  3. Bruno (WebKit) replies to Ana's reply via right-click menu and R key
 *     (Esc cancels in between); both of Ana's devices see the quote;
 *  4. Carla (touch): short swipe does not reply, vertical swipe does not
 *     reply, full swipe opens "Replying to Bruno"; she sends, and Bruno
 *     (WebKit) and Ana (Electron) see the quote;
 *  5. clicking the quote highlights the original on WebKit and Electron;
 *  6. no errors on the page on any of the five.
 *
 * Carla starts at 1280 px with touch (`hasTouch`) to enter the channel by
 * the usual steps, and switches to 390 px before the swipe.
 *
 * Everything local and disposable, ports 8740 and 8741. Screenshots in
 * `.verify-data/prova-responder-plataformas/`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, consultar, contasDoServidor, criarCanal, dentro, espera, irParaEmparelhar, pedirAmizade, temCanal, verificador } from "./fase7-comum.mjs"
import { abrirSecretaria } from "./secretaria.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "moinho"
const SEGUINTE = /^(Continuar|Seguinte)$/
const PERGUNTA = "Alguem sabe a que horas abre o moinho no sabado?"
const DA_ANA = "Abre as nove, eu vou la."
const DO_BRUNO_MENU = "Obrigado, Ana, levo o milho."
const DO_BRUNO_R = "E a farinha fica pronta no mesmo dia?"
const DA_CARLA = "Eu passo la a meio da manha."
const CAPTURAS = join(RAIZ, ".verify-data/prova-responder-plataformas", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8740, servidor: 8741, sfu: 0, etiqueta: "responder-plataformas" })
const registo = []
const browsers = []
const abertos = []
const fechar = []

async function abrir(motor, nome, opcoesDoContexto = {}) {
  const b = await motor.launch({ headless: true })
  browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 }, ...opcoesDoContexto })
  const page = await ctx.newPage()
  vigiar(page, nome)
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const aparelho = { nome, page }
  abertos.push(aparelho)
  return aparelho
}

function vigiar(page, nome) {
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  page.on("console", (m) => {
    if (m.type() === "error") registo.push(`${nome} CONSOLA ${m.text().slice(0, 300)}`)
  })
}

const caixa = (page) => page.locator(".chat-composer .composer-line input:not([type])").first()
const linhaCom = (page, texto) => page.locator(".message").filter({ hasText: texto }).first()
const barraDe = (page) => page.locator(".composer-resposta")
const errosDe = (nome) => registo.filter((linha) => linha.startsWith(`${nome} PAGEERROR`))
const chega = (page, texto, ms = 60_000) => ate(() => linhaCom(page, texto).isVisible().catch(() => false), ms)

async function citacaoDe(page, texto) {
  const citacao = linhaCom(page, texto).locator(".message-citacao")
  const dentroDela = await citacao.innerText().catch(() => "")
  const rotulo = await citacao.getAttribute("aria-label").catch(() => null)
  return { dentroDela: dentroDela.replace(/\s+/g, " "), rotulo }
}

async function sino(page) {
  await page.locator(".me-bell").first().click()
  await page.locator(".notif-list").first().waitFor({ timeout: 5_000 }).catch(() => {})
  const texto = await page.locator(".notif-list").first().innerText().catch(() => "")
  await page.keyboard.press("Escape")
  return texto
}

async function enviar(page, texto) {
  await caixa(page).pressSequentially(texto, { delay: 10 })
  await page.keyboard.press("Enter")
}

/** One finger: starts at the center of the line and moves `dx` to the side and `dy` down, in steps. */
async function deslizar(page, linha, dx, dy = 0) {
  await linha.scrollIntoViewIfNeeded()
  const caixaDaLinha = await linha.boundingBox()
  const x0 = caixaDaLinha.x + caixaDaLinha.width * 0.6
  const y0 = caixaDaLinha.y + Math.min(caixaDaLinha.height / 2, 30)
  const cdp = await page.context().newCDPSession(page)
  const toque = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] })
  await toque("touchStart", x0, y0)
  const passos = 8
  for (let i = 1; i <= passos; i++) {
    await toque("touchMove", x0 + (dx * i) / passos, y0 + (dy * i) / passos)
    await espera(16)
  }
  await toque("touchEnd", x0 + dx, y0 + dy)
  await cdp.detach().catch(() => {})
}

async function realceNoOriginal(page, resposta, original) {
  const citacao = linhaCom(page, resposta).locator(".message-citacao")
  await citacao.scrollIntoViewIfNeeded()
  await citacao.click()
  return ate(() => page.locator(".message.destacada").filter({ hasText: original }).count().then((n) => n === 1), 5_000, 50)
}

try {
  // 0. Ana on Chromium, Bruno on WebKit, Carla on mobile.
  const ana = await abrir(chromium, "ana-chromium")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(webkit, "bruno-webkit")
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  // Touch from the start; at 1280 to enter the channel by the same steps as
  // the others, and at 390 px before the swipe (step 4).
  const carla = await abrir(chromium, "carla-toque", { hasTouch: true })
  await criarConta(carla.page, { nome: "Carla", frase: FRASE, servidor: srv.NOME })
  await dentro(carla.page)
  const [enderecoAna, enderecoBruno, enderecoCarla] = contasDoServidor(srv.base)
  check("três contas no servidor", [enderecoAna, enderecoBruno, enderecoCarla].every(Boolean))
  const toqueDaCarla = await carla.page.evaluate(() => ({ pontos: navigator.maxTouchPoints, grosso: matchMedia("(pointer: coarse)").matches }))
  check("a Carla está num ecrã de toque", toqueDaCarla.pontos > 0, JSON.stringify(toqueDaCarla))
  await pedirAmizade(bruno.page, enderecoAna)
  check("a Ana aceita o Bruno", (await aceitarAmizade(ana.page)) >= 0)
  await pedirAmizade(carla.page, enderecoAna)
  check("a Ana aceita a Carla", (await aceitarAmizade(ana.page)) >= 0)
  await criarCanal(ana.page, CANAL)
  check("a Ana convida o Bruno", await convidar(ana.page, CANAL, enderecoBruno))
  check("o Bruno entra no canal", await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))
  check("a Ana convida a Carla", await convidar(ana.page, CANAL, enderecoCarla))
  check("a Carla entra no canal", await aceitarConvite(carla.page, CANAL, { espera: 60_000 }))

  // 0b. Ana's second device: the desktop app, via link.
  await ana.page.keyboard.press("Escape").catch(() => {})
  await ana.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await ana.page.getByRole("button", { name: "Aparelhos", exact: true }).click()
  await ana.page.getByRole("button", { name: "Acrescentar aparelho" }).click()
  const folha = ana.page.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")
  const sec = await abrirSecretaria({ rotulo: "ana-electron" })
  fechar.push(() => sec.fechar())
  const anaSec = { nome: "ana-electron", page: sec.page }
  vigiar(anaSec.page, anaSec.nome)
  abertos.push(anaSec)
  await irParaEmparelhar(anaSec.page)
  await anaSec.page.getByLabel("Ou cola o link").fill(link)
  await anaSec.page.getByRole("button", { name: SEGUINTE }).first().click()
  await anaSec.page.getByRole("heading", { name: "Palavra-passe deste aparelho" }).waitFor({ timeout: 15_000 })
  const campos = anaSec.page.locator('.gate-card input[type="password"]')
  for (let i = 0; i < (await campos.count()); i++) await campos.nth(i).fill(FRASE)
  await anaSec.page.getByRole("button", { name: SEGUINTE }).first().click()
  await anaSec.page.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  const palavras = [
    await anaSec.page.locator(".sas-palavras").getAttribute("data-palavras"),
    await folha.locator(".sas-palavras").getAttribute("data-palavras"),
  ]
  check("as mesmas seis palavras no Chromium e na secretária", palavras[0] === palavras[1] && palavras[0]?.split("-").length === 6, palavras[0] ?? "")
  await anaSec.page.getByRole("button", { name: "São as mesmas" }).click()
  await folha.getByRole("button", { name: "São as mesmas" }).click()
  const emparelhado = await anaSec.page.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 }).then(() => true, () => false)
  await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await ana.page.keyboard.press("Escape").catch(() => {})
  await anaSec.page.getByRole("button", { name: "Entrar", exact: true }).click()
  await dentro(anaSec.page)
  const manifesto = consultar(srv.base, "SELECT manifest FROM device_manifests WHERE address = ?", enderecoAna)[0]
  const aparelhosDaAna = manifesto ? JSON.parse(manifesto.manifest).devices.length : 0
  check("a Ana tem dois aparelhos (Chromium e secretária)", emparelhado && aparelhosDaAna === 2, String(aparelhosDaAna))
  check("a secretária recebe o canal", await temCanal(anaSec.page, CANAL, 90_000))
  for (const p of [ana, bruno, carla, anaSec]) {
    await abrirCanal(p.page, CANAL).catch(async () => {
      await p.page.keyboard.press("Escape").catch(() => {})
      await abrirCanal(p.page, CANAL)
    })
  }

  // 1. O Bruno (WebKit) pergunta.
  await caixa(bruno.page).fill(PERGUNTA)
  await bruno.page.keyboard.press("Enter")
  check("a pergunta chega à secretária da Ana", (await chega(anaSec.page, PERGUNTA)) >= 0)
  check("e ao Chromium da Ana", (await chega(ana.page, PERGUNTA)) >= 0)
  check("e à Carla", (await chega(carla.page, PERGUNTA)) >= 0)

  // 2. Ana replies from desktop, from the action bar, with the mention.
  const originalSec = linhaCom(anaSec.page, PERGUNTA)
  await originalSec.hover()
  await originalSec.getByRole("button", { name: "Responder" }).click()
  await barraDe(anaSec.page).waitFor({ timeout: 5_000 })
  const textoDaBarra = (await barraDe(anaSec.page).innerText()).replace(/\s+/g, " ")
  check('secretária: a barra diz "A responder a Bruno"', /A responder a Bruno/.test(textoDaBarra), textoDaBarra)
  check('secretária: "@ Mencionar" vem ligado', (await barraDe(anaSec.page).getByRole("button", { name: /@ Mencionar/ }).getAttribute("aria-pressed")) === "true")
  check("secretária: o foco está na caixa", await caixa(anaSec.page).evaluate((el) => el === document.activeElement))
  await anaSec.page.screenshot({ path: join(CAPTURAS, "ana-electron-barra.png") })
  await enviar(anaSec.page, DA_ANA)
  check("secretária: a barra fecha depois de enviar", (await ate(async () => (await barraDe(anaSec.page).count()) === 0, 10_000)) >= 0)

  check("o Bruno (WebKit) recebe a resposta da Ana", (await chega(bruno.page, DA_ANA)) >= 0)
  let c = await citacaoDe(bruno.page, DA_ANA)
  check("WebKit: a resposta da Ana mostra a citação da pergunta", c.dentroDela.includes("Alguem sabe a que horas"), c.dentroDela)
  check("WebKit: a citação é um botão com rótulo", c.rotulo === "Ir para a mensagem de Bruno", String(c.rotulo))
  let textoDoSino = ""
  const avisou = await ate(async () => /Ana mencionou-te/.test((textoDoSino = await sino(bruno.page))), 30_000, 1000)
  check("WebKit: o Bruno tem a menção da Ana no sino", avisou >= 0, textoDoSino.replace(/\s+/g, " ").slice(0, 160))
  await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-webkit-citacao.png") })

  check("o Chromium da Ana (o outro aparelho) recebe a resposta que saiu da secretária", (await chega(ana.page, DA_ANA)) >= 0)
  c = await citacaoDe(ana.page, DA_ANA)
  check("Chromium da Ana: a mesma citação", c.dentroDela.includes("Alguem sabe a que horas"), c.dentroDela)
  check("a Carla (toque) vê a citação da resposta da Ana", (await chega(carla.page, DA_ANA)) >= 0 && (await citacaoDe(carla.page, DA_ANA)).dentroDela.includes("Alguem sabe"))

  // 3. Bruno (WebKit) replies to Ana: via right-click menu, and R key.
  await linhaCom(bruno.page, DA_ANA).click({ button: "right", position: { x: 200, y: 12 } })
  const itemDoMenu = bruno.page.getByRole("menuitem", { name: "Responder" })
  check("WebKit: o menu de botão direito tem Responder", await itemDoMenu.waitFor({ timeout: 5_000 }).then(() => true, () => false))
  await itemDoMenu.click()
  await barraDe(bruno.page).waitFor({ timeout: 5_000 })
  check("WebKit: a barra diz \"A responder a Ana\"", /A responder a\s+Ana/.test(await barraDe(bruno.page).innerText()))
  await enviar(bruno.page, DO_BRUNO_MENU)
  await ate(async () => (await barraDe(bruno.page).count()) === 0, 10_000)

  const daAnaNoBruno = linhaCom(bruno.page, DA_ANA)
  await daAnaNoBruno.hover()
  await daAnaNoBruno.getByRole("button", { name: "Copiar texto" }).focus()
  await bruno.page.keyboard.press("r")
  check("WebKit: a tecla R abre a barra", (await ate(() => barraDe(bruno.page).isVisible().catch(() => false), 5_000)) >= 0)
  await bruno.page.keyboard.press("Escape")
  check("WebKit: o Esc cancela", (await ate(async () => (await barraDe(bruno.page).count()) === 0, 5_000)) >= 0)
  await daAnaNoBruno.hover()
  await daAnaNoBruno.getByRole("button", { name: "Copiar texto" }).focus()
  await bruno.page.keyboard.press("r")
  await barraDe(bruno.page).waitFor({ timeout: 5_000 })
  await enviar(bruno.page, DO_BRUNO_R)

  for (const [quem, page] of [["secretária", anaSec.page], ["Chromium", ana.page]]) {
    for (const texto of [DO_BRUNO_MENU, DO_BRUNO_R]) {
      const chegou = await chega(page, texto)
      const citacao = chegou >= 0 ? await citacaoDe(page, texto) : { dentroDela: "", rotulo: null }
      check(
        `${quem} da Ana: "${texto}" chega com a citação da resposta dela`,
        chegou >= 0 && citacao.dentroDela.includes("Abre as nove") && citacao.rotulo === "Ir para a mensagem de Ana",
        `${citacao.dentroDela} · ${citacao.rotulo}`,
      )
    }
  }
  // Only the immediate original: Bruno's reply quote does not bring the question.
  check(
    "só o original imediato, sem árvore",
    !(await citacaoDe(anaSec.page, DO_BRUNO_MENU)).dentroDela.includes("Alguem sabe"),
  )
  await anaSec.page.screenshot({ path: join(CAPTURAS, "ana-electron-citacoes.png") })

  // 4. Carla, with her finger, at 390 px.
  await carla.page.setViewportSize({ width: 390, height: 844 })
  await espera(500)
  await abrirCanal(carla.page, CANAL).catch(() => {})
  await chega(carla.page, PERGUNTA, 10_000)
  const perguntaNaCarla = linhaCom(carla.page, PERGUNTA)
  await deslizar(carla.page, perguntaNaCarla, -30)
  await espera(400)
  check("toque: um deslize curto (30 px) não responde", (await barraDe(carla.page).count()) === 0)
  await deslizar(carla.page, perguntaNaCarla, -20, 120)
  await espera(400)
  check("toque: um deslize na vertical não responde", (await barraDe(carla.page).count()) === 0)
  await deslizar(carla.page, perguntaNaCarla, -110)
  const abriu = await ate(() => barraDe(carla.page).isVisible().catch(() => false), 5_000)
  check("toque: o deslize até ao fim (110 px) abre a barra", abriu >= 0)
  const barraDaCarla = abriu >= 0 ? (await barraDe(carla.page).innerText()).replace(/\s+/g, " ") : ""
  check('toque: a barra diz "A responder a Bruno"', /A responder a Bruno/.test(barraDaCarla), barraDaCarla)
  const transform = await perguntaNaCarla.evaluate((el) => getComputedStyle(el).transform)
  check("toque: a mensagem volta ao sítio depois de largar", transform === "none" || /matrix\(1, 0, 0, 1, 0, 0\)/.test(transform), transform)
  const rola = await carla.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check("toque: a 390 px, a barra cabe sem rolagem horizontal", !rola)
  await carla.page.screenshot({ path: join(CAPTURAS, "carla-toque-barra-390.png") })
  await caixa(carla.page).fill(DA_CARLA)
  await carla.page.keyboard.press("Enter")
  for (const [quem, page] of [["WebKit (Bruno)", bruno.page], ["secretária (Ana)", anaSec.page]]) {
    const chegou = await chega(page, DA_CARLA)
    const citacao = chegou >= 0 ? await citacaoDe(page, DA_CARLA) : { dentroDela: "" }
    check(`${quem}: a resposta da Carla chega com a citação da pergunta`, chegou >= 0 && citacao.dentroDela.includes("Alguem sabe"), citacao.dentroDela)
  }

  // 5. Clicking the quote highlights the original, on WebKit and desktop.
  check("WebKit: o clique na citação acende o original", (await realceNoOriginal(bruno.page, DA_CARLA, PERGUNTA)) >= 0)
  await espera(300)
  await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-webkit-realce.png") })
  check("secretária: o clique na citação acende o original", (await realceNoOriginal(anaSec.page, DO_BRUNO_R, DA_ANA)) >= 0)
  check(
    "secretária: o foco vai para o original",
    await anaSec.page.evaluate((texto) => document.activeElement?.closest(".message")?.textContent?.includes(texto) ?? false, DA_ANA),
  )

  // 6. No errors on the page.
  for (const a of abertos) check(`${a.nome}: sem erros na página`, errosDe(a.nome).length === 0, errosDe(a.nome).join(" | "))
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const a of abertos) {
    const texto = await a.page.locator("body").innerText({ timeout: 2000 }).catch(() => "(fechado)")
    console.log(`--- ${a.nome} mostra: "${texto.replace(/\s+/g, " ").slice(0, 600)}"`)
    await a.page.screenshot({ path: join(CAPTURAS, `falha-${a.nome}.png`) }).catch(() => {})
  }
}
for (const linha of registo.slice(-40)) console.log(linha)

for (const f of fechar) await f().catch(() => {})
for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
console.log(`\nCapturas: ${CAPTURAS}`)
process.exit(resumo() ? 0 : 1)
