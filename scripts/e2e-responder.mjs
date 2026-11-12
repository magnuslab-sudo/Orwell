/**
 * Reply to a message, live, on two engines and with an old client.
 *
 *   npm run build && ORWELL_DIST_ANTIGO=<apps/web/dist from 1.3.2> node scripts/e2e-responder.mjs
 *
 * Bruno (Firefox) asks. Ana (Chromium) replies twice, via the interface: via
 * the action bar, with "@ Mention" on; and via the R key, with mention off.
 * Bruno sees both quotes, has ONE mention in the bell, and clicking the quote
 * takes him to the original, which lights up (with and without reduced motion).
 * Carla (Chromium, the web from 1.3.2 served on the same origin) sees both replies
 * as normal messages, with no console errors.
 *
 * Screenshots at 1280 e to 390 px: the reply bar, the quote and the highlight.
 *
 * The old web comes from environment and is a folder on disk, never a network
 * target. To get it: copy `apps/web/dist` BEFORE touching the client (that's what
 * was done on 4/11/2026, from 88d08569 onward), or `git archive 88d08569 | tar -x
 * -C <pasta>` and there `npm ci && npm run build`. Without it, Carla's part skips,
 * with the reason printed.
 *
 * Everything local and disposable, ports 8730 e 8731. Screenshots in
 * `.verify-data/prova-responder/`.
 */
import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, espera, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "lagar"
const PERGUNTA = "Quem vem amanha ao lagar para a apanha da azeitona?"
const CAPTURAS = join(RAIZ, ".verify-data/prova-responder", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

const DIST_ANTIGO = process.env.ORWELL_DIST_ANTIGO ?? ""
const COM_ANTIGO = DIST_ANTIGO !== "" && existsSync(join(DIST_ANTIGO, "index.html"))

const { check, resumo } = verificador()
const srv = await levantarServidor({
  frente: 8730,
  servidor: 8731,
  sfu: 0,
  etiqueta: "responder",
  ...(COM_ANTIGO ? { distAntiga: DIST_ANTIGO } : {}),
})
const browsers = []
const abertos = []
const registo = []

async function abrir(motor, nome, { browser = null, antiga = false } = {}) {
  const b = browser ?? (await motor.launch({ headless: true }))
  if (!browser) browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  if (antiga) await ctx.addCookies([{ name: "orwell-dist", value: "antiga", url: `http://${srv.NOME}` }])
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

const caixa = (page) => page.locator(".chat-composer .composer-line input:not([type])").first()
const linhaCom = (page, texto) => page.locator(".message").filter({ hasText: texto }).first()
const errosDe = (nome) => registo.filter((linha) => linha.startsWith(`${nome} PAGEERROR`))

/** The bell's text. */
async function sino(page) {
  await page.locator(".me-bell").first().click()
  await page.locator(".notif-list").first().waitFor({ timeout: 5_000 }).catch(() => {})
  const texto = await page.locator(".notif-list").first().innerText().catch(() => "")
  await page.keyboard.press("Escape")
  return texto
}

try {
  // 0. Three accounts, friendships, the channel and invites.
  const ana = await abrir(chromium, "ana")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(firefox, "bruno")
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const carla = COM_ANTIGO ? await abrir(chromium, "carla", { browser: ana.browser, antiga: true }) : null
  if (carla) {
    await criarConta(carla.page, { nome: "Carla", frase: FRASE, servidor: srv.NOME })
    await dentro(carla.page)
    const versao = await carla.page.evaluate(() => [...document.scripts].map((s) => s.src).join(" "))
    check("a Carla corre a web antiga (outros ficheiros)", versao !== "" && !(await ana.page.evaluate((v) => [...document.scripts].map((s) => s.src).join(" ") === v, versao)))
  } else {
    console.log("   SALTA a Carla: sem ORWELL_DIST_ANTIGO, não há web antiga para servir.")
  }
  const enderecos = contasDoServidor(srv.base)
  const [enderecoAna, enderecoBruno, enderecoCarla] = enderecos
  await pedirAmizade(bruno.page, enderecoAna)
  check("a Ana aceita a amizade do Bruno", (await aceitarAmizade(ana.page)) >= 0)
  if (carla) {
    await pedirAmizade(carla.page, enderecoAna)
    check("a Ana aceita a amizade da Carla", (await aceitarAmizade(ana.page)) >= 0)
  }
  await criarCanal(ana.page, CANAL)
  check("a Ana convida o Bruno", await convidar(ana.page, CANAL, enderecoBruno))
  check("o Bruno entra no canal", await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))
  if (carla) {
    check("a Ana convida a Carla", await convidar(ana.page, CANAL, enderecoCarla))
    check("a Carla entra no canal", await aceitarConvite(carla.page, CANAL, { espera: 60_000 }))
  }
  for (const p of [ana, bruno, carla].filter(Boolean)) await abrirCanal(p.page, CANAL)

  // 1. Bruno asks.
  await caixa(bruno.page).fill(PERGUNTA)
  await bruno.page.keyboard.press("Enter")
  check("a pergunta do Bruno chega à Ana", (await ate(() => linhaCom(ana.page, PERGUNTA).isVisible().catch(() => false), 60_000)) >= 0)

  // 2. Ana replies from the action bar, with "@ Mention" on (by default).
  const original = linhaCom(ana.page, PERGUNTA)
  await original.hover()
  await original.getByRole("button", { name: "Responder" }).click()
  const barra = ana.page.locator(".composer-resposta")
  await barra.waitFor({ timeout: 5_000 })
  const textoDaBarra = await barra.innerText()
  check('a barra diz "A responder a Bruno"', /A responder a\s+Bruno/.test(textoDaBarra), textoDaBarra.replace(/\s+/g, " "))
  check('"@ Mencionar" vem ligado', (await barra.getByRole("button", { name: /@ Mencionar/ }).getAttribute("aria-pressed")) === "true")
  check("o foco está na caixa", await caixa(ana.page).evaluate((el) => el === document.activeElement))
  check(
    "a barra é anunciada",
    (await ana.page.locator('.composer-resposta-anuncio[aria-live="polite"]').innerText()).includes("A responder a Bruno"),
  )
  await ana.page.screenshot({ path: join(CAPTURAS, "ana-barra-1280.png") })
  await caixa(ana.page).pressSequentially("Eu vou, levo as varas.", { delay: 10 })
  await ana.page.keyboard.press("Enter")
  check("a barra fecha depois de enviar", (await ate(async () => (await barra.count()) === 0, 10_000)) >= 0)

  // 3. The second reply: via R key, with mention off; and Esc cancels before.
  await original.hover()
  await original.getByRole("button", { name: "Copiar texto" }).focus()
  await ana.page.keyboard.press("r")
  check("a tecla R, com a mensagem focada, abre a barra", (await ate(() => barra.isVisible().catch(() => false), 5_000)) >= 0)
  await ana.page.keyboard.press("Escape")
  check("o Esc cancela a resposta", (await ate(async () => (await barra.count()) === 0, 5_000)) >= 0)
  await original.hover()
  await original.getByRole("button", { name: "Copiar texto" }).focus()
  await ana.page.keyboard.press("r")
  await barra.waitFor({ timeout: 5_000 })
  await barra.getByRole("button", { name: /@ Mencionar/ }).click()
  check('"@ Mencionar" desliga', (await barra.getByRole("button", { name: /@ Mencionar/ }).getAttribute("aria-pressed")) === "false")
  await ana.page.setViewportSize({ width: 390, height: 844 })
  await espera(300)
  await ana.page.screenshot({ path: join(CAPTURAS, "ana-barra-390.png") })
  const rola = await ana.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  check("a 390 px, a barra cabe sem rolagem horizontal", !rola)
  await ana.page.setViewportSize({ width: 1280, height: 860 })
  await caixa(ana.page).pressSequentially("Eu tambem, mas so de tarde.", { delay: 10 })
  await ana.page.keyboard.press("Enter")

  // 4. Bruno sees both quotes, and only one mention.
  for (const texto of ["Eu vou, levo as varas.", "Eu tambem, mas so de tarde."]) {
    const chegou = await ate(() => linhaCom(bruno.page, texto).isVisible().catch(() => false), 60_000)
    check(`o Bruno recebe "${texto}"`, chegou >= 0)
    const citacao = linhaCom(bruno.page, texto).locator(".message-citacao")
    const dentroDaCitacao = await citacao.innerText().catch(() => "")
    check(`a resposta "${texto}" mostra a citação do original`, dentroDaCitacao.includes("Quem vem amanha"), dentroDaCitacao.replace(/\s+/g, " "))
    check(
      `a citação de "${texto}" é um botão com rótulo`,
      (await citacao.getAttribute("aria-label")) === "Ir para a mensagem de Bruno",
    )
  }
  let textoDoSino = ""
  const avisou = await ate(async () => /Ana mencionou-te/.test((textoDoSino = await sino(bruno.page))), 30_000, 1000)
  check("o Bruno tem a menção da Ana no sino", avisou >= 0, textoDoSino.replace(/\s+/g, " ").slice(0, 160))
  await espera(2000)
  textoDoSino = await sino(bruno.page)
  const mencoes = (textoDoSino.match(/Ana mencionou-te/g) ?? []).length
  check("a resposta sem menção não entra no sino (uma menção só)", mencoes === 1, `menções no sino: ${mencoes}`)
  const citacaoDaPrimeira = linhaCom(bruno.page, "Eu vou, levo as varas.").locator(".message-citacao")
  await citacaoDaPrimeira.scrollIntoViewIfNeeded()
  await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-citacao-1280.png") })

  // 5. Clicking the quote goes to the original, which highlights.
  await citacaoDaPrimeira.click()
  const acendeu = await ate(
    () => bruno.page.locator(".message.destacada").filter({ hasText: PERGUNTA }).count().then((n) => n === 1),
    5_000,
    50,
  )
  check("o clique na citação acende o original", acendeu >= 0)
  check(
    "o foco vai para o original",
    await bruno.page.evaluate((texto) => document.activeElement?.closest(".message")?.textContent?.includes(texto) ?? false, PERGUNTA),
  )
  await espera(400)
  await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-realce-1280.png") })
  const apagou = await ate(() => bruno.page.locator(".message.destacada").count().then((n) => n === 0), 6_000, 100)
  check("o realce apaga-se sozinho (sem movimento reduzido, ~2,6 s)", apagou >= 0)

  // 6. With reduced motion: the highlight still fades, just slower.
  await bruno.page.emulateMedia({ reducedMotion: "reduce" })
  await bruno.page.setViewportSize({ width: 390, height: 844 })
  await espera(300)
  await linhaCom(bruno.page, "Eu vou, levo as varas.").locator(".message-citacao").scrollIntoViewIfNeeded()
  await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-citacao-390.png") })
  await linhaCom(bruno.page, "Eu vou, levo as varas.").locator(".message-citacao").click()
  await bruno.page.locator(".message.destacada").first().waitFor({ timeout: 5_000 })
  const animacao = await bruno.page.locator(".message.destacada").first().evaluate((el) => {
    const estilo = getComputedStyle(el)
    return { nome: estilo.animationName, duracao: estilo.animationDuration }
  })
  check(
    "com movimento reduzido, o realce anima a 4,8 s (não pára)",
    animacao.nome === "procura-acende" && animacao.duracao === "4.8s",
    JSON.stringify(animacao),
  )
  await espera(3000)
  check(
    "com movimento reduzido, aos 3 s o realce ainda lá está",
    (await bruno.page.locator(".message.destacada").count()) === 1,
  )
  await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-realce-390-movimento-reduzido.png") })
  await bruno.page.setViewportSize({ width: 1280, height: 860 })
  await espera(300)
  await linhaCom(bruno.page, "Eu vou, levo as varas.").locator(".message-citacao").click()
  await espera(2600)
  await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-realce-1280-movimento-reduzido-2600ms.png") })
  await bruno.page.emulateMedia({ reducedMotion: "no-preference" })

  // 7. Carla, on 1.3.2, sees the replies as normal messages.
  if (carla) {
    for (const texto of ["Eu vou, levo as varas.", "Eu tambem, mas so de tarde."]) {
      const chegou = await ate(() => linhaCom(carla.page, texto).isVisible().catch(() => false), 60_000)
      check(`a Carla (1.3.2) recebe "${texto}"`, chegou >= 0)
    }
    check("a Carla (1.3.2) não desenha citação nenhuma", (await carla.page.locator(".message-citacao").count()) === 0)
    check("a Carla (1.3.2) vê a pergunta do Bruno", await linhaCom(carla.page, PERGUNTA).isVisible())
    check("a Carla (1.3.2) não tem erros na página", errosDe("carla").length === 0, errosDe("carla").join(" | "))
    await carla.page.screenshot({ path: join(CAPTURAS, "carla-1-3-2-1280.png") })
  }
  check("a Ana e o Bruno não têm erros na página", errosDe("ana").length + errosDe("bruno").length === 0, [...errosDe("ana"), ...errosDe("bruno")].join(" | "))
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
