/**
 * End-to-end reports, before ship (1.3.0): 2 separadores, 3
 * browsers and 2 aparelhos, on a disposable local server.
 *
 *   npm run build && node scripts/e2e-denuncias.mjs
 *
 * Accounts and browsers:
 *  - Ana, channel founder: Chromium (device 1, with two tabs) and
 *    Firefox (device 2, paired by link);
 *  - Bruno, who reports: WebKit;
 *  - Carla, who is reported: Firefox, in another context.
 *
 * Through the interface:
 *  1. Bruno reports a message from Carla (reason 3, note, good faith, no
 *     email) and then Carla from the person menu (reason 5);
 *  2. the copy to the founder lands on the server with delay: the server runs
 *     with `ENCLAVE_DENUNCIA_ATRASO_HORAS=1-1`, Ana's inbox does not deliver it, and the
 *     `entregarEm` saved is an hour old. The script advances the clock on
 *     the copy (only on disk of this test server) and the copy arrives;
 *  3. Ana, in a second Chromium tab that takes ownership, opens
 *     Properties > Moderation: the report is there without Bruno's name and without
 *     his messages. Before that, the paired Firefox (without the account key)
 *     says "There are 2 denorts waiting."; then, it gets the same ones by
 *     the account channel (finishing, 4/11/2026);
 *  4. `scripts/denuncias.mjs` in local mode: list, read, suspend Carla,
 *     close both (suspended and no action), and Bruno sees both decisions
 *     in the bell;
 *  5. Carla logs back in and sees the full notice; asks for review; the
 *     script sees the request, lifts the suspension, and Carla joins.
 *
 * Screenshots in `.verify-data/prova-denuncias/<hora>/`.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, aceitarAmizade, ate, consultar, contasDoServidor, criarCanal, dentro, dizer, irParaEmparelhar, ouviu, pedirAmizade, verificador } from "./fase7-comum.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const SEGUINTE = /^(Continuar|Seguinte)$/
const CANAL = "praca"
const CAPTURAS = join(RAIZ, ".verify-data/prova-denuncias", new Date().toISOString().replace(/[:.]/g, "-"))
mkdirSync(CAPTURAS, { recursive: true })

process.env.ENCLAVE_DENUNCIA_ATRASO_HORAS = "1-1"
const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8520, servidor: 8521, etiqueta: "denuncias" })
const PASTA = join(srv.dados, "denuncias")
const browsers = []
const paginas = []
const numeros = {}

async function abrir(motor, nome, browser) {
  const b = browser ?? (await motor.launch({ headless: true }))
  if (!browser) browsers.push(b)
  const ctx = await b.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  paginas.push({ nome, page })
  return { nome, browser: b, ctx, page }
}

/** Foreground first: a background tab has frozen timers, and the screenshot was catching the veil opening on top of it. */
const foto = async (page, nome) => {
  await page.bringToFront().catch(() => {})
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(CAPTURAS, `${nome}.png`) }).catch(() => {})
}

/**
 * After reload: the password, if the gate asks for it. A tab that just created
 * an account can log back in without it (the session stays in the browser memory),
 * so there is no field.
 */
async function destrancar(page) {
  const campo = page.locator('.gate-card input[type="password"]').first()
  const lado = page.getByRole("button", { name: "Configurações", exact: true }).first()
  const suspensa = page.getByRole("heading", { name: "Conta suspensa" })
  await campo.or(lado).or(suspensa).first().waitFor({ timeout: 60_000 })
  if (!(await campo.isVisible().catch(() => false))) return
  await campo.fill(FRASE)
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
}

/** The VPS script, in local mode against this server. Returns { codigo, saida }. */
function guiao(...args) {
  try {
    const saida = execFileSync(process.execPath, [join(RAIZ, "scripts/denuncias.mjs"), ...args], {
      encoding: "utf8",
      env: { ...process.env, ORWELL_ALVO: "", ORWELL_BASE: srv.base, ORWELL_DENUNCIAS: PASTA },
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { codigo: 0, saida }
  } catch (erro) {
    return { codigo: erro.status ?? 1, saida: `${erro.stdout ?? ""}${erro.stderr ?? ""}` }
  }
}

/** All .json files under a folder. */
function jsonsDe(pasta) {
  if (!existsSync(pasta)) return []
  const lista = []
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome)
    if (statSync(caminho).isDirectory()) lista.push(...jsonsDe(caminho))
    else if (nome.endsWith(".json")) lista.push(caminho)
  }
  return lista
}

/** The copies waiting in an account's inbox: { caminho, guardado }. */
function naCaixa(endereco) {
  return jsonsDe(PASTA)
    .map((caminho) => {
      try {
        return { caminho, guardado: JSON.parse(readFileSync(caminho, "utf8")) }
      } catch {
        return null
      }
    })
    .filter((f) => f && f.guardado && f.guardado.endereco === endereco && typeof f.guardado.entregarEm === "number")
}

async function menuDaMensagem(page, texto) {
  await page.locator(".message", { hasText: texto }).first().click({ button: "right" })
  await page.locator(".context-menu").first().waitFor({ timeout: 10_000 })
}

/** Fill the report form through "Report sent.". Returns the preview text. */
async function preencherDenuncia(page, { motivo, nota, rotulo }) {
  const folha = page.locator(".sheet.denunciar").first()
  await folha.waitFor({ timeout: 15_000 })
  await folha.getByRole("radio", { name: motivo }).check()
  // Since 4/11/2026 the note and good faith are in the reason step, below the reasons.
  await folha.locator("textarea").first().fill(nota)
  await folha.getByRole("checkbox").first().check()
  await foto(page, `${rotulo}-1-detalhes`)
  await folha.getByRole("button", { name: "Continuar" }).click()
  await folha.getByText("O que sai do aparelho").waitFor({ timeout: 15_000 })
  await ate(async () => !(await folha.getByText("A preparar a denúncia…").isVisible().catch(() => false)), 30_000)
  const previa = (await folha.innerText()).replace(/\s+/g, " ")
  await foto(page, `${rotulo}-2-previsualizacao`)
  const botao = folha.getByRole("button", { name: /^(Continuar|Enviar denúncia)$/ })
  const temAviso = (await botao.innerText()) === "Continuar"
  await botao.click()
  let aviso = ""
  if (temAviso) {
    aviso = (await folha.locator(".field-note.warn").first().innerText().catch(() => "")).trim()
    await foto(page, `${rotulo}-3-aviso`)
    await folha.getByRole("button", { name: "Enviar denúncia" }).click()
  }
  const enviada = await folha.getByText("Denúncia enviada.").waitFor({ timeout: 30_000 }).then(() => true, () => false)
  await foto(page, `${rotulo}-4-enviada`)
  await folha.getByRole("button", { name: "Fechar" }).last().click().catch(() => {})
  return { previa, aviso, enviada }
}

async function abrirModeracao(page) {
  await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  await page.locator(".channel-list .channel-row").filter({ has: page.locator(".channel-name", { hasText: CANAL }) }).first().click({ button: "right" })
  await page.getByRole("menuitem", { name: /propriedades/i }).first().click()
  const folha = page.getByRole("dialog").first()
  await folha.waitFor({ timeout: 15_000 })
  await folha.getByRole("tab", { name: "Moderação", exact: true }).click()
  const seccao = folha.locator(".seccao-denuncias")
  await seccao.waitFor({ timeout: 15_000 })
  await ate(async () => !(await seccao.getByText("A ler as denúncias…").isVisible().catch(() => false)), 20_000)
  return { folha, seccao }
}

try {
  // 0. Three accounts, friendships, the channel and invites.
  const ana = await abrir(chromium, "ana-chromium")
  await criarConta(ana.page, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana.page)
  const bruno = await abrir(webkit, "bruno-webkit")
  await criarConta(bruno.page, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno.page)
  const carla = await abrir(firefox, "carla-firefox")
  await criarConta(carla.page, { nome: "Carla", frase: FRASE, servidor: srv.NOME })
  await dentro(carla.page)
  const [enderecoAna, enderecoBruno, enderecoCarla] = contasDoServidor(srv.base)
  check("três contas no servidor", [enderecoAna, enderecoBruno, enderecoCarla].every(Boolean))

  await pedirAmizade(bruno.page, enderecoAna)
  check("a Ana aceita o Bruno", (await aceitarAmizade(ana.page)) >= 0)
  await pedirAmizade(carla.page, enderecoAna)
  check("a Ana aceita a Carla", (await aceitarAmizade(ana.page)) >= 0)
  await criarCanal(ana.page, CANAL)
  check("a Ana convida o Bruno", await convidar(ana.page, CANAL, enderecoBruno))
  check("o Bruno entra no canal", await aceitarConvite(bruno.page, CANAL, { espera: 60_000 }))
  check("a Ana convida a Carla", await convidar(ana.page, CANAL, enderecoCarla))
  check("a Carla entra no canal", await aceitarConvite(carla.page, CANAL, { espera: 60_000 }))

  // 0b. Ana's second device: Firefox, via link.
  await ana.page.keyboard.press("Escape").catch(() => {})
  await ana.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await ana.page.getByRole("button", { name: "Aparelhos", exact: true }).click()
  await ana.page.getByRole("button", { name: "Acrescentar aparelho" }).click()
  const folhaPar = ana.page.locator(".sheet").first()
  await folhaPar.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folhaPar.locator("code[data-link]").getAttribute("data-link")
  const ana2 = await abrir(firefox, "ana-firefox", carla.browser)
  await irParaEmparelhar(ana2.page)
  await ana2.page.getByLabel("Ou cola o link").fill(link)
  await ana2.page.getByRole("button", { name: SEGUINTE }).first().click()
  await ana2.page.getByRole("heading", { name: "Palavra-passe deste aparelho" }).waitFor({ timeout: 15_000 })
  const campos = ana2.page.locator('.gate-card input[type="password"]')
  for (let i = 0; i < (await campos.count()); i++) await campos.nth(i).fill(FRASE)
  await ana2.page.getByRole("button", { name: SEGUINTE }).first().click()
  await ana2.page.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await folhaPar.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await ana2.page.getByRole("button", { name: "São as mesmas" }).click()
  await folhaPar.getByRole("button", { name: "São as mesmas" }).click()
  const emparelhado = await ana2.page.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 }).then(() => true, () => false)
  await folhaPar.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await ana.page.keyboard.press("Escape").catch(() => {})
  await ana2.page.getByRole("button", { name: "Entrar", exact: true }).click()
  await dentro(ana2.page)
  const manifesto = consultar(srv.base, "SELECT manifest FROM device_manifests WHERE address = ?", enderecoAna)[0]
  numeros.aparelhosDaAna = manifesto ? JSON.parse(manifesto.manifest).devices.length : 0
  check("a Ana tem dois aparelhos (Chromium e Firefox)", emparelhado && numeros.aparelhosDaAna === 2, String(numeros.aparelhosDaAna))

  // 1. Messages in the channel: Bruno before and after, Carla in between.
  await abrirCanal(bruno.page, CANAL)
  await abrirCanal(carla.page, CANAL)
  const marca = Date.now().toString(36)
  const doBrunoAntes = `bruno antes ${marca}`
  const daCarla = `carla ameaca ${marca}`
  const daCarla2 = `carla outra vez ${marca}`
  const doBrunoDepois = `bruno depois ${marca}`
  await dizer(bruno.page, doBrunoAntes)
  await ouviu(carla.page, doBrunoAntes)
  await dizer(carla.page, daCarla)
  await ouviu(bruno.page, daCarla)
  await dizer(carla.page, daCarla2)
  await ouviu(bruno.page, daCarla2)
  await dizer(bruno.page, doBrunoDepois)
  check("o Bruno lê as duas mensagens da Carla", (await ouviu(bruno.page, daCarla2)) >= 0)

  // 1a. Report the message.
  await menuDaMensagem(bruno.page, daCarla)
  await bruno.page.locator(".context-menu").getByRole("menuitem", { name: "Denunciar…" }).click()
  const d1 = await preencherDenuncia(bruno.page, { motivo: "Assédio ou perseguição", nota: `nota de teste ${marca}`, rotulo: "01-mensagem" })
  check("a pré-visualização mostra a mensagem denunciada", d1.previa.includes(daCarla), d1.previa.slice(0, 160))
  check("e o contexto, com as mensagens de quem denuncia (a nossa cópia leva-as)", d1.previa.includes(doBrunoAntes))
  check("o aviso da cópia ao fundador aparece antes de enviar", d1.aviso.startsWith("O fundador do canal recebe uma cópia sem o teu nome."), d1.aviso)
  check('"Denúncia enviada." (mensagem)', d1.enviada)

  // 1b. Report the person from their menu in the member list.
  await bruno.page.locator(".member-row").filter({ hasText: "Carla" }).first().click({ button: "right" })
  await bruno.page.locator(".context-menu").getByRole("menuitem", { name: "Denunciar…" }).click()
  const d2 = await preencherDenuncia(bruno.page, { motivo: "Burla, phishing ou spam", nota: `pessoa ${marca}`, rotulo: "02-pessoa" })
  check('"Denúncia enviada." (pessoa)', d2.enviada)

  // Both on the server disk, with the reporter's address.
  const ficheiros = jsonsDe(PASTA).filter((c) => /[/\\]\d+\.json$/.test(c))
  const guardadas = ficheiros.map((c) => JSON.parse(readFileSync(c, "utf8")))
  numeros.denunciasNoDisco = guardadas.length
  check("o servidor guardou as duas denúncias", guardadas.length === 2, String(guardadas.length))
  const texto1 = JSON.stringify(guardadas)
  check("a nossa cópia tem o endereço de quem denunciou", texto1.includes(enderecoBruno))

  // 2. The founder's copy: saved with a delay.
  const copias = naCaixa(enderecoAna)
  numeros.copiasNaCaixa = copias.length
  const atrasos = copias.map((c) => Math.round((c.guardado.entregarEm - Date.now()) / 60_000))
  numeros.atrasoMinutos = atrasos
  check("há duas cópias ao fundador à espera (as duas denúncias vieram do canal)", copias.length === 2, String(copias.length))
  check("a cópia está guardada para daqui a ~1 hora", atrasos.every((m) => m >= 55 && m <= 61), atrasos.join(","))
  const textoDaCopia = JSON.stringify(copias.map((c) => c.guardado))
  check("a cópia guardada não tem o endereço de quem denunciou", !textoDaCopia.includes(enderecoBruno))

  // Before the delay, Ana receives nothing (reload reads the inbox at 5 s).
  await ana.page.reload({ waitUntil: "domcontentloaded" })
  await destrancar(ana.page)
  await dentro(ana.page)
  await ana.page.waitForTimeout(9000)
  const antes = await abrirModeracao(ana.page)
  const vazioAntes = await antes.seccao.getByText("Ninguém denunciou nada neste canal.").isVisible().catch(() => false)
  await foto(ana.page, "03-fundador-antes-do-atraso")
  check("antes do atraso, o fundador ainda não tem a cópia", vazioAntes)
  await ana.page.keyboard.press("Escape").catch(() => {})

  // Advance the copy's clock, disk only on this test server.
  for (const c of copias) writeFileSync(c.caminho, JSON.stringify({ ...c.guardado, entregarEm: Date.now() - 1000 }))

  // 3a. Ana's device 2 (Firefox, paired, no account key) reads the inbox first:
  // it does not open the copies, but knows they are there, and does not say
  // "Nobody reported anything".
  await ana2.page.reload({ waitUntil: "domcontentloaded" })
  await destrancar(ana2.page)
  await dentro(ana2.page)
  await ana2.page.waitForTimeout(9000)
  const aEspera = await abrirModeracao(ana2.page)
  const viuAEspera = await ate(async () => (await aEspera.seccao.innerText()).includes("Há 2 denúncias à espera."), 20_000, 500)
  const textoAEspera = (await aEspera.seccao.innerText()).replace(/\s+/g, " ")
  await foto(ana2.page, "05a-aparelho-2-a-espera")
  check('o aparelho 2 diz "Há 2 denúncias à espera."', viuAEspera >= 0, textoAEspera.slice(0, 200))
  check('e não diz "Ninguém denunciou nada"', !textoAEspera.includes("Ninguém denunciou nada"))
  await ana2.page.keyboard.press("Escape").catch(() => {})

  // 3. Two tabs: the second one in Chromium takes ownership and reads the inbox.
  const ana1b = await ana.ctx.newPage()
  paginas.push({ nome: "ana-chromium-2", page: ana1b })
  await ana1b.goto(srv.APP, { waitUntil: "domcontentloaded" })
  const espera = await ate(async () => (await ana1b.locator("body").innerText()).includes("Já tens o Orwell aberto noutro separador."), 20_000, 500)
  check("o segundo separador da Ana espera pelo primeiro", espera >= 0)
  await ana1b.getByRole("button", { name: "Usar este separador" }).click()
  await destrancar(ana1b)
  await dentro(ana1b)
  const cedeu = await ate(async () => (await ana.page.locator("body").innerText()).includes("Já tens o Orwell aberto noutro separador."), 15_000, 500)
  check("o primeiro separador cede a posse", cedeu >= 0)
  await ana1b.waitForTimeout(9000)
  const depois = await abrirModeracao(ana1b)
  const denunciasVistas = await ate(async () => (await depois.seccao.locator("li.denuncia").count()) > 0, 30_000)
  const textoFundador = (await depois.seccao.innerText()).replace(/\s+/g, " ")
  await foto(ana1b, "04-fundador-segundo-separador")
  numeros.denunciasNoFundador = await depois.seccao.locator("li.denuncia").count()
  check("o fundador vê a denúncia no segundo separador", denunciasVistas >= 0, textoFundador.slice(0, 200))
  check("com a mensagem denunciada e o motivo", textoFundador.includes(daCarla) && textoFundador.includes("Assédio ou perseguição"))
  check("a mensagem é Verificada", textoFundador.includes("Verificada"))
  check("sem o nome de quem denunciou", !textoFundador.includes("Bruno"))
  check("sem as mensagens de quem denunciou", !textoFundador.includes(doBrunoAntes) && !textoFundador.includes(doBrunoDepois))
  await ana1b.keyboard.press("Escape").catch(() => {})

  // 3b. Ana's device 2 (Firefox): the same reports arrive via the account,
  // opened by the device with the key. No reload: the section re-reads on open.
  let textoFirefox = ""
  const chegaramAo2 = await ate(async () => {
    const noFirefox = await abrirModeracao(ana2.page)
    numeros.denunciasNoAparelho2 = await noFirefox.seccao.locator("li.denuncia").count()
    textoFirefox = (await noFirefox.seccao.innerText()).replace(/\s+/g, " ")
    if (numeros.denunciasNoAparelho2 === numeros.denunciasNoFundador) return true
    await ana2.page.keyboard.press("Escape").catch(() => {})
    return false
  }, 60_000, 3000)
  await foto(ana2.page, "05-fundador-aparelho-2")
  check("o aparelho 2 da Ana vê as mesmas denúncias que o 1", chegaramAo2 >= 0 && numeros.denunciasNoAparelho2 === 2, `${numeros.denunciasNoAparelho2} de ${numeros.denunciasNoFundador}`)
  check("com a mensagem denunciada, o motivo e Verificada", textoFirefox.includes(daCarla) && textoFirefox.includes("Assédio ou perseguição") && textoFirefox.includes("Verificada"))
  check("já sem nada à espera", !textoFirefox.includes("à espera"))
  check("e no aparelho 2 também não aparece o Bruno", !textoFirefox.includes("Bruno") && !textoFirefox.includes(doBrunoAntes))
  await ana2.page.keyboard.press("Escape").catch(() => {})

  // 4. The VPS script, in local mode.
  const listar = guiao("listar")
  numeros.listar = listar.saida.trim()
  check("denuncias.mjs listar", listar.codigo === 0 && /\b1\b/.test(listar.saida) && /\b2\b/.test(listar.saida), listar.saida.slice(0, 300))
  const ler = guiao("ler", "1")
  check("denuncias.mjs ler 1 mostra a mensagem e quem denunciou", ler.codigo === 0 && ler.saida.includes(daCarla) && ler.saida.includes(enderecoBruno))
  writeFileSync(join(CAPTURAS, "guiao-listar.txt"), listar.saida)
  writeFileSync(join(CAPTURAS, "guiao-ler-1.txt"), ler.saida)
  const suspender = guiao(
    "suspender", enderecoCarla, "--denuncia", "1", "--motivo", "3",
    "--ambito", "Conta neste servidor: entrar, enviar e ser convidada.",
    "--factos", "Mensagem de assédio no canal praca, verificada.",
    "--norma", "Termos, Denúncias: actividades ilegais.",
  )
  check("denuncias.mjs suspender", suspender.codigo === 0, suspender.saida.slice(0, 300))
  check("denuncias.mjs fechar 1 --decisao suspensa", guiao("fechar", "1", "--decisao", "suspensa").codigo === 0)
  check("denuncias.mjs fechar 2 --decisao sem-accao", guiao("fechar", "2", "--decisao", "sem-accao").codigo === 0)

  // 4b. Bruno receives both decisions in the bell.
  numeros.decisoesNaCaixaDoBruno = naCaixa(enderecoBruno).length
  const consolaDoBruno = []
  bruno.page.on("console", (m) => consolaDoBruno.push(`${m.type()}: ${m.text()}`.slice(0, 300)))
  bruno.page.on("pageerror", (e) => consolaDoBruno.push(`pageerror: ${e.message}`.slice(0, 300)))
  bruno.page.on("response", (r) => {
    if (r.url().includes("/_enclave/denuncia")) consolaDoBruno.push(`rede: ${r.status()} ${r.url()}`)
  })
  await bruno.page.reload({ waitUntil: "domcontentloaded" })
  await destrancar(bruno.page)
  await dentro(bruno.page)
  let textoSino = ""
  const sino = await ate(async () => {
    await bruno.page.locator(".me-bell").first().click()
    const janela = bruno.page.locator(".notif-janela").first()
    await janela.waitFor({ timeout: 10_000 })
    await bruno.page.waitForTimeout(1500)
    textoSino = (await janela.innerText()).replace(/\s+/g, " ")
    const tem = textoSino.includes("A tua denúncia foi analisada: conta suspensa.") && textoSino.includes("A tua denúncia foi analisada: sem acção.")
    if (!tem) await janela.locator(".notif-fechar").click().catch(() => {})
    return tem
  }, 60_000, 4000)
  writeFileSync(join(CAPTURAS, "sino-do-bruno.txt"), textoSino)
  writeFileSync(join(CAPTURAS, "consola-do-bruno.txt"), consolaDoBruno.join("\n"))
  numeros.decisoesNaCaixaDoBrunoDepois = naCaixa(enderecoBruno).length
  await foto(bruno.page, "06-quem-denunciou-sino")
  check("quem denunciou vê as duas decisões no sino", sino >= 0)
  check("com as vias de reparação e o contacto único", textoSino.includes("orwell.eu@proton.me") && textoSino.includes("ANACOM"))
  await bruno.page.keyboard.press("Escape").catch(() => {})

  // 5. Carla suspended: the notice and the review request.
  await carla.page.reload({ waitUntil: "domcontentloaded" })
  await destrancar(carla.page)
  const suspensa = await carla.page.getByRole("heading", { name: "Conta suspensa" }).waitFor({ timeout: 60_000 }).then(() => true, () => false)
  await carla.page.getByText("Medida: suspensão da conta.").waitFor({ timeout: 20_000 }).catch(() => {})
  const aviso = (await carla.page.locator(".gate-card").first().innerText().catch(() => "")).replace(/\s+/g, " ")
  await foto(carla.page, "07-conta-suspensa-aviso")
  check("a Carla vê \"Conta suspensa\"", suspensa)
  for (const [rotulo, frase] of [
    ["a medida", "Medida: suspensão da conta."],
    ["o motivo", "Motivo: Assédio ou perseguição"],
    ["a duração", "até à revisão"],
    ["o âmbito", "Âmbito: Conta neste servidor"],
    ["os factos", "Factos: Mensagem de assédio"],
    ["a origem", "Veio de uma denúncia."],
    ["sem meios automáticos", "Não houve meios automáticos"],
    ["a norma", "Norma ou cláusula: Termos"],
    ["os tribunais", "Podes recorrer aos tribunais."],
    ["a ANACOM", "ANACOM"],
  ]) {
    check(`o aviso diz ${rotulo}`, aviso.includes(frase), frase)
  }
  await carla.page.locator(".gate-card textarea").first().fill(`peço revisão ${marca}`)
  await carla.page.getByRole("button", { name: "Pedir revisão" }).click()
  const pedida = await carla.page.getByText("Pedido de revisão enviado.").waitFor({ timeout: 30_000 }).then(() => true, () => false)
  await foto(carla.page, "08-revisao-pedida")
  check('"Pedido de revisão enviado."', pedida)
  const revisoes = guiao("revisoes")
  writeFileSync(join(CAPTURAS, "guiao-revisoes.txt"), revisoes.saida)
  check("denuncias.mjs revisoes vê o pedido", revisoes.codigo === 0 && revisoes.saida.includes(enderecoCarla), revisoes.saida.slice(0, 300))
  check("denuncias.mjs levantar", guiao("levantar", enderecoCarla, "--nota", "Revista: levantada.").codigo === 0)
  await carla.page.reload({ waitUntil: "domcontentloaded" })
  await destrancar(carla.page)
  const entrou = await dentro(carla.page, 60_000).then(() => true, () => false)
  await foto(carla.page, "09-levantada-entra")
  check("depois de levantada, a Carla volta a entrar", entrou)
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const { nome, page } of paginas) {
    await foto(page, `falha-${nome}`)
    const texto = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "(fechado)")
    console.log(`--- ${nome} mostra: "${texto.replace(/\s+/g, " ").slice(0, 400)}"`)
  }
}

writeFileSync(join(CAPTURAS, "servidor.log"), srv.registo.texto.slice(-200_000))
writeFileSync(join(CAPTURAS, "numeros.json"), `${JSON.stringify(numeros, null, 2)}\n`)
console.log(`capturas: ${CAPTURAS}`)
console.log(`números: ${JSON.stringify(numeros)}`)
for (const b of browsers) await b.close().catch(() => {})
srv.fechar()
process.exit(resumo() ? 0 : 1)
