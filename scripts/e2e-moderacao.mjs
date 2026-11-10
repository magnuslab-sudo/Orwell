/**
 * Live voice and role moderation (owner request, 2/11/2026), with three
 * accounts and two browsers.
 *
 *   npm run build && node scripts/e2e-moderacao.mjs
 *
 * Ana starts the channel (Chromium). Bruno is a moderator: he has one role with
 * only "move" (different context, Chromium). Carla is a member with no role
 * (Firefox). Through the interface:
 *  1. the moderator opens Carla's menu in a voice room: there is ONE entry
 *     "Move to", and the submenu has the voice rooms by category, except the
 *     one Carla is in; the right arrow opens it, the left closes it;
 *  2. the moderator moves Carla to "Studio" without her doing anything: Carla
 *     sees "Bruno moved you to Studio.", and Ana sees her in "Studio";
 *  3. Carla (without "move") does not have "Move to" in Bruno's menu;
 *  4. the moderator hangs up Carla: she leaves the call;
 *  5. the founder renames the "Administrator" role and Bruno's role in the
 *     list, in place; Bruno and Carla see the new names;
 *  6. the founder removes Carla from the person menu, with the phrase of what
 *     happens: Carla no longer sees the channel, and Bruno sees her leave;
 *  7. at 1280 and 390 px, no horizontal scroll; on mobile the submenu opens
 *     as a sheet.
 *
 * All local and disposable (`servidor-descartavel.mjs`), ports 8498 and 8499.
 * Screenshots in `.verify-data/prova-moderacao/`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, entrarNaVoz, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const CANAL = "moderacao"
const ESTUDIO = "Estúdio"
const CAPTURAS = join(RAIZ, ".verify-data/prova-moderacao", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8498, servidor: 8499, sfu: process.env.SEM_SFU ? 0 : 8500, etiqueta: "moderacao" })
const browsers = []
const abertos = []
const registo = []

function microfoneFalso() {
  /*
    A record of what the screenshot does, to prove the "move": how many times
    the microphone is requested, whether there was a user gesture at that
    instant, and what state the audio contexts end up in. A context created
    without a gesture starts suspended, and a suspended context yields a muted
    track.
    */
  window.__capturas = []
  window.__contextos = []
  const Original = window.AudioContext
  if (Original) {
    window.AudioContext = class extends Original {
      constructor(...args) {
        super(...args)
        window.__contextos.push(this)
      }
    }
  }
  const falso = async () => {
    window.__capturas.push({ gesto: navigator.userActivation?.isActive ?? null, em: Date.now() })
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
  // The audio policy of a real browser: without a gesture, the audio context does not start.
  const args = motor === chromium ? ["--autoplay-policy=user-gesture-required"] : []
  const b = browser ?? (await motor.launch({ headless: true, args }))
  if (!browser) browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  await ctx.addInitScript(microfoneFalso)
  const page = await ctx.newPage()
  page.on("pageerror", (erro) => registo.push(`${nome} PAGEERROR ${erro.message}`))
  page.on("console", (m) => {
    if (m.type() === "error" || /voice|call|mov/i.test(m.text())) registo.push(`${nome} CONSOLA ${m.type()} ${m.text().slice(0, 300)}`)
  })
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const aparelho = { nome, browser: b, ctx, page }
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
/** The entire room in the sidebar: the line and below it, who is there. */
const salaDa = (page, nome) =>
  page.locator(".room-list > li").filter({ has: page.locator(".room-row .room-name", { hasText: new RegExp(`^${nome}$`) }) }).first()
/** Names of people shown in the sidebar during a voice room. */
const quemEstaEm = async (page, nome) => (await salaDa(page, nome).locator(".room-voice-members li").allInnerTexts().catch(() => [])).join(" ")

async function criarSalaDeVoz(page, nome) {
  await page.locator(".room-row button.room-new").first().click()
  await page.getByPlaceholder("Anúncios").fill(nome)
  await page.getByRole("button", { name: "Voz", exact: true }).click()
  await page.getByRole("button", { name: "Criar", exact: true }).click()
  await linhaDa(page, nome).waitFor({ timeout: 30_000 })
}

async function propriedadesDoCanal(page) {
  await page.locator(".channel-list .channel-row").filter({ has: page.locator(".channel-name", { hasText: CANAL }) }).first().click({ button: "right" })
  await page.getByRole("menuitem", { name: /propriedades/i }).first().click()
  const folha = page.getByRole("dialog").first()
  await folha.getByText("Cargos", { exact: true }).first().waitFor({ timeout: 15_000 })
  // Properties by section (3/11/2026): roles live in the "Roles" tab.
  await folha.getByRole("tab", { name: "Cargos", exact: true }).click().catch(() => {})
  return folha
}

async function abrirMenuNaVoz(page, sala, nome) {
  const botao = salaDa(page, sala).locator("button.voice-member").filter({ hasText: nome }).first()
  await botao.waitFor({ timeout: 60_000 })
  await botao.click({ button: "right" })
  await page.locator(".context-menu").first().waitFor({ timeout: 10_000 })
}

try {
  // 0. Three accounts, friendships, the channel and invites.
  const ana = await abrir(chromium, "ana")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(chromium, "bruno", ana.browser)
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const carla = await abrir(process.env.CARLA_CHROMIUM ? chromium : firefox, "carla")
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

  await abrirCanal(ana.page, CANAL)
  await criarSalaDeVoz(ana.page, ESTUDIO)

  // Bruno's role: move only.
  {
    const folha = await propriedadesDoCanal(ana.page)
    await folha.getByRole("button", { name: "Novo cargo" }).click()
    await folha.getByLabel("Nome do cargo").fill("Moderação")
    await folha.getByRole("tab", { name: "Permissões" }).click()
    await folha.getByRole("switch", { name: "mover" }).click()
    await folha.getByRole("button", { name: "Criar cargo" }).click()
    await folha.getByText("Moderação").first().waitFor({ timeout: 15_000 })
    await ana.page.getByRole("button", { name: "Cancelar" }).first().click()
    await ana.page.locator(".member-row").filter({ hasText: "Bruno" }).first().click()
    const caixa = ana.page.getByRole("switch", { name: "Moderação" }).first()
    await caixa.waitFor({ timeout: 15_000 })
    await caixa.click()
    await ana.page.waitForTimeout(1500)
    check("a Ana dá o cargo ao Bruno", (await caixa.getAttribute("aria-checked")) === "true")
    await ana.page.getByRole("button", { name: "Voltar" }).first().click().catch(() => {})
    await abrirCanal(ana.page, CANAL)
  }

  for (const p of [bruno, carla]) {
    await abrirCanal(p.page, CANAL)
    await linhaDa(p.page, ESTUDIO).waitFor({ timeout: 60_000 })
  }

  // 1. Carla joins voice; Bruno's menu appears over her.
  check('a Carla entra em "voz"', await entrarNaVoz(carla.page))
  await carla.page.locator(".call-barra").waitFor({ timeout: 30_000 })
  const brunoVeCarla = await ate(async () => (await quemEstaEm(bruno.page, "voz")).includes("Carla"), 60_000)
  check('o Bruno vê a Carla em "voz"', brunoVeCarla >= 0)
  // The join gesture has passed: a click activation lasts 5 s, and moving someone
  // happens minutes later, without the person touching anything.
  await carla.page.waitForTimeout(6_000)
  const capturasAntes = await carla.page.evaluate(() => window.__capturas.length)

  await abrirMenuNaVoz(bruno.page, "voz", "Carla")
  const menuB = bruno.page.locator(".context-menu").first()
  const itens = await menuB.locator("[role=menuitem]").allInnerTexts()
  console.log("   menu do Bruno sobre a Carla:", JSON.stringify(itens))
  check('o menu tem UMA entrada "Mover para"', itens.filter((t) => /^Mover para/.test(t.trim())).length === 1)
  check("e nenhuma linha por sala", !itens.some((t) => t.includes(ESTUDIO)))
  check('o Bruno tem "Desligar da chamada"', itens.some((t) => t.includes("Desligar da chamada")))
  const entrada = menuB.getByRole("menuitem", { name: /Mover para/ })
  // From the keyboard: right arrow opens, left arrow closes.
  await entrada.focus()
  await bruno.page.keyboard.press("ArrowRight")
  const escada = bruno.page.locator(".context-escada")
  check("a seta direita abre a escada ao lado", await escada.isVisible().catch(() => false))
  const salasNaEscada = await escada.locator("[role=menuitem]").allInnerTexts()
  console.log("   escada:", JSON.stringify(salasNaEscada))
  check('a escada tem "Estúdio" e não tem "voz", onde a Carla está', salasNaEscada.includes(ESTUDIO) && !salasNaEscada.includes("voz"))
  await bruno.page.waitForTimeout(400)
  const caixaMenu = await menuB.boundingBox()
  const caixaEscada = await escada.boundingBox()
  check("a escada abre à direita do menu", caixaMenu && caixaEscada && caixaEscada.x >= caixaMenu.x + caixaMenu.width - 8)
  await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-escada-1280.png") })
  await bruno.page.keyboard.press("ArrowLeft")
  check("a seta esquerda fecha a escada", !(await escada.isVisible().catch(() => false)))
  await bruno.page.keyboard.press("ArrowRight")

  // 2. Bruno moves Carla without her doing anything.
  await escada.getByRole("menuitem", { name: ESTUDIO }).click()
  const carlaMovida = await ate(async () => (await quemEstaEm(ana.page, ESTUDIO)).includes("Carla"), 30_000)
  check('a Ana vê a Carla em "Estúdio"', carlaMovida >= 0)
  check('a Carla lê "Bruno moveu-te para Estúdio."', await carla.page.getByText(/^Bruno moveu-te para Estúdio\.$/).first().isVisible().catch(() => false))
  check('o Bruno lê "Moveste Carla para Estúdio."', await bruno.page.getByText(/^Moveste Carla para Estúdio\.$/).first().isVisible().catch(() => false))
  await carla.page.waitForTimeout(2000)
  const depois = await carla.page.evaluate(() => ({ capturas: window.__capturas.length, contextos: window.__contextos.map((c) => c.state) }))
  check("ao ser movida, a Carla não volta a pedir o microfone", depois.capturas === capturasAntes, `${depois.capturas - capturasAntes} pedidos novos`)
  check("e nenhum contexto de áudio fica suspenso", !depois.contextos.includes("suspended"), depois.contextos.join(","))
  check("a Carla continua na chamada", await carla.page.locator(".call-barra").isVisible().catch(() => false))
  await capturar(carla.page, "carla-movida")

  // 3. Who cannot move has no entry.
  check('o Bruno entra em "voz"', await entrarNaVoz(bruno.page))
  await bruno.page.locator(".call-barra").waitFor({ timeout: 30_000 })
  await ate(async () => (await quemEstaEm(carla.page, "voz")).includes("Bruno"), 60_000)
  await abrirMenuNaVoz(carla.page, "voz", "Bruno")
  const daCarla = await carla.page.locator(".context-menu [role=menuitem]").allInnerTexts()
  console.log("   menu da Carla sobre o Bruno:", JSON.stringify(daCarla))
  check('a Carla não tem "Mover para" nem "Desligar da chamada"', !daCarla.some((t) => /Mover para|Desligar da chamada/.test(t)))
  await carla.page.keyboard.press("Escape")

  // 4. Bruno disconnects Carla from the call.
  await abrirMenuNaVoz(bruno.page, ESTUDIO, "Carla")
  await bruno.page.locator(".context-menu").getByRole("menuitem", { name: "Desligar da chamada" }).click()
  const saiu = await carla.page.locator(".call-barra").waitFor({ state: "detached", timeout: 20_000 }).then(() => true, () => false)
  check("a Carla sai da chamada", saiu)
  check('a Carla lê "Bruno desligou-te da chamada."', await carla.page.getByText(/^Bruno desligou-te da chamada\.$/).first().isVisible().catch(() => false))
  const anaVeSair = await ate(async () => !(await quemEstaEm(ana.page, ESTUDIO)).includes("Carla"), 30_000)
  check('a Ana deixa de ver a Carla em "Estúdio"', anaVeSair >= 0)

  // 7 (mobile). Menu at 390 px: the sheet opens like a panel.
  await bruno.page.setViewportSize({ width: 390, height: 844 })
  check('a Carla volta a "voz"', await entrarNaVoz(carla.page))
  await carla.page.locator(".call-barra").waitFor({ timeout: 30_000 })
  {
    const gaveta = bruno.page.getByRole("button", { name: "Abrir o painel lateral" })
    if ((await gaveta.getAttribute("aria-expanded").catch(() => null)) !== "true") await gaveta.click().catch(() => {})
    await ate(async () => (await quemEstaEm(bruno.page, "voz")).includes("Carla"), 60_000)
    await abrirMenuNaVoz(bruno.page, "voz", "Carla")
    await bruno.page.locator(".context-menu").getByRole("menuitem", { name: /Mover para/ }).click()
    const folha = bruno.page.locator(".context-folha")
    check("a 390 px a escada abre como folha", await folha.isVisible().catch(() => false))
    // After the entry animation, which scales the sheet.
    await bruno.page.waitForTimeout(500)
    const caixa = await folha.boundingBox()
    check("a folha tem 16 px de margem dos lados", caixa && Math.round(caixa.x) === 16 && Math.round(390 - caixa.x - caixa.width) === 16)
    check('a folha tem "Voltar"', await folha.getByRole("menuitem", { name: /Voltar/ }).isVisible().catch(() => false))
    await bruno.page.screenshot({ path: join(CAPTURAS, "bruno-folha-390.png") })
    const rola = await bruno.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    check("a 390 px, sem rolagem horizontal com a folha aberta", !rola)
    await folha.getByRole("menuitem", { name: ESTUDIO }).click()
    const movida = await ate(async () => (await quemEstaEm(ana.page, ESTUDIO)).includes("Carla"), 30_000)
    check("escolher na folha move a Carla", movida >= 0)
    await bruno.page.setViewportSize({ width: 1280, height: 860 })
    if ((await gaveta.getAttribute("aria-expanded").catch(() => null)) === "true") await gaveta.click().catch(() => {})
  }

  // 5. The founder renames roles on the spot.
  {
    const folha = await propriedadesDoCanal(ana.page)
    await folha.getByTitle(/^Mudar o nome do cargo Moderação$/).click()
    const campo = folha.getByLabel(/^Nome novo do cargo Moderação$/)
    await campo.fill("Vigia")
    await campo.press("Enter")
    await folha.getByText("Vigia", { exact: true }).first().waitFor({ timeout: 15_000 })
    check("o Enter do nome não fecha as propriedades", await folha.isVisible())
    await folha.getByTitle(/^Mudar o nome do cargo Administrador$/).click()
    const campoAdmin = folha.getByLabel(/^Nome novo do cargo Administrador$/)
    await campoAdmin.fill("Direcção")
    await campoAdmin.press("Enter")
    await folha.getByText("Direcção", { exact: true }).first().waitFor({ timeout: 15_000 })
    check("a fundadora muda o nome do cargo de administrador", true)
    await capturar(ana.page, "ana-cargos")
    await ana.page.getByRole("button", { name: "Cancelar" }).first().click()
  }
  const brunoVeVigia = await ate(async () => (await bruno.page.locator(".member-group-head").allInnerTexts()).some((t) => /VIGIA|Vigia/.test(t)), 30_000)
  check('o Bruno vê o grupo "Vigia" na lista de membros', brunoVeVigia >= 0)
  const carlaVeVigia = await ate(async () => (await carla.page.locator(".member-group-head").allInnerTexts()).some((t) => /VIGIA|Vigia/.test(t)), 30_000)
  check('a Carla vê o grupo "Vigia" na lista de membros', carlaVeVigia >= 0)
  // The built-in name shows in who has it: Ana names Bruno administrator.
  await ana.page.locator(".member-row").filter({ hasText: "Bruno" }).first().click({ button: "right" })
  await ana.page.locator(".context-menu").getByRole("menuitem", { name: "Tornar administrador" }).click()
  const carlaVeDireccao = await ate(async () => (await carla.page.locator(".member-group-head").allInnerTexts()).some((t) => /DIRECÇÃO|Direcção/.test(t)), 30_000)
  check('a Carla vê o Bruno no grupo "Direcção"', carlaVeDireccao >= 0)

  // 6. The founder removes Carla through the person's menu.
  await ana.page.locator(".member-row").filter({ hasText: "Carla" }).first().click({ button: "right" })
  await ana.page.locator(".context-menu").getByRole("menuitem", { name: "Expulsar do canal" }).click()
  const folhaExpulsar = ana.page.getByRole("alertdialog").filter({ hasText: "Expulsar Carla do canal" }).first()
  await folhaExpulsar.waitFor({ timeout: 10_000 })
  check(
    "a confirmação diz o que acontece",
    (await folhaExpulsar.innerText()).includes("A pessoa deixa de ler o canal. Para voltar, precisa de um convite novo."),
  )
  await capturar(ana.page, "ana-expulsar")
  await folhaExpulsar.getByLabel(/Escreve "Carla"/).fill("Carla")
  await folhaExpulsar.getByRole("button", { name: "Expulsar", exact: true }).click()
  const carlaSemCanal = await ate(
    async () => (await carla.page.locator(`.channel-list .channel-name`, { hasText: CANAL }).count()) === 0,
    60_000,
  )
  check("a Carla deixa de ver o canal", carlaSemCanal >= 0)
  check("a Carla saiu da chamada com o canal", !(await carla.page.locator(".call-barra").isVisible().catch(() => false)))
  const brunoVeSair = await ate(
    async () => !(await bruno.page.locator(".member-row").allInnerTexts()).some((t) => t.includes("Carla")),
    60_000,
  )
  check("o Bruno vê a Carla sair da lista de membros", brunoVeSair >= 0)
  await capturar(carla.page, "carla-expulsa")
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
