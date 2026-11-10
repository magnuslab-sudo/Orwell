/**
 * The half-open connection, end to end: two tabs, three engines, two devices.
 *
 *   node scripts/e2e-meia-ligacao.mjs        (needs `npm run build` first)
 *
 * The report (1.3.6): on the phone "it does not sync" and "I cannot send
 * direct messages". The system suspends the page, the network changes
 * underneath, and the socket stays `OPEN` without ever firing `close`. The
 * app said "connected" and whatever was written went nowhere.
 *
 * The setup:
 *  - Ana in Firefox, on a wide screen;
 *  - Bruno in Chromium, on a wide screen, with TWO tabs (one owns the
 *    connection, the other mirrors it);
 *  - Bruno's phone in WebKit (390x844, touch, `isMobile`), PAIRED with the
 *    computer through the "Add device" link.
 *
 * The phone's socket goes through `routeWebSocket`. "Killing" a socket means
 * passing no frames in either direction, without closing anything: the
 * browser still says `OPEN`, which is exactly the half-open connection. New
 * sockets get through.
 *
 * What this proves:
 *  1. With the socket dead, Ana and the computer write to the phone. The
 *     phone "comes back to the page" (`visibilitychange`) and writes at once.
 *  2. The check detects the death: the status bar stops saying "connected".
 *  3. The connection comes back by itself, and messages pass in both
 *     directions: Ana's and the computer's reach the phone; the phone's
 *     reaches Ana and BOTH computer tabs.
 *  4. With no `visibilitychange` at all, the pulse (25 s) detects the death
 *     by itself.
 *
 * ALL LOCAL AND DISPOSABLE: `servidor-descartavel.mjs`, its own ports, and
 * no way to point it at production.
 */
import { chromium, devices, firefox, webkit } from "playwright"
import { FRASE } from "./ambiente.mjs"
import { criarConta } from "./conta.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const resultados = []
function check(nome, ok, detalhe = "") {
  resultados.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function ate(condicao, ms = 60_000, passo = 300) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    if (await condicao().catch(() => false)) return true
    await espera(passo)
  }
  return false
}

const ANA = "Ana"
const BRUNO = "Bruno"
const LARGO = { locale: "pt-PT", viewport: { width: 1200, height: 860 } }
const dentro = (page) => page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout: 90_000 })
const estado = (page) => page.locator("footer.statusbar").first().innerText().catch(() => "")

/** The phone's sockets, so they can be killed without closing them. */
const sockets = []

const servidor = await levantarServidor({ frente: 8791, servidor: 8792, etiqueta: "meia-ligacao" })
const browsers = []
try {
  const bFf = await firefox.launch({ headless: true })
  const bCr = await chromium.launch({ headless: true })
  const bWk = await webkit.launch({ headless: true })
  browsers.push(bFf, bCr, bWk)

  // --- Bruno on the computer, and the paired phone ---------------------------
  const ctxPc = await bCr.newContext(LARGO)
  const pc = await ctxPc.newPage()
  await pc.goto(servidor.APP, { waitUntil: "domcontentloaded" })
  await criarConta(pc, { nome: BRUNO, servidor: servidor.NOME })
  await dentro(pc)

  await pc.getByRole("button", { name: "Configurações" }).first().click()
  await pc.getByRole("button", { name: "Aparelhos", exact: true }).click()
  await pc.getByRole("button", { name: "Acrescentar aparelho" }).click()
  const folha = pc.locator(".sheet").first()
  await folha.locator("code[data-link]").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")

  const ctxTel = await bWk.newContext({ ...devices["iPhone 13"], locale: "pt-PT" })
  await ctxTel.routeWebSocket(/\/_enclave\/gateway/, (ws) => {
    const registo = { morto: false }
    sockets.push(registo)
    const doServidor = ws.connectToServer()
    ws.onMessage((mensagem) => {
      if (!registo.morto) doServidor.send(mensagem)
    })
    doServidor.onMessage((mensagem) => {
      if (!registo.morto) ws.send(mensagem)
    })
  })
  const tel = await ctxTel.newPage()
  await tel.goto(servidor.APP, { waitUntil: "domcontentloaded" })
  await tel.getByRole("button", { name: "Sim, emparelhar este aparelho" }).click({ timeout: 60_000 })
  await tel.getByLabel("Ou cola o link").fill(link)
  await tel.getByRole("button", { name: "Continuar" }).click()
  const frases = tel.locator('.gate-card input[type="password"]')
  await frases.nth(0).waitFor({ timeout: 15_000 })
  await frases.nth(0).fill(FRASE)
  await frases.nth(1).fill(FRASE)
  await tel.getByRole("button", { name: "Continuar" }).click()
  await tel.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await tel.getByRole("button", { name: "São as mesmas" }).click()
  await folha.getByRole("button", { name: "São as mesmas" }).click()
  await tel.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 })
  await folha.getByRole("button", { name: "Fechar" }).first().click()
  await tel.getByRole("button", { name: "Entrar", exact: true }).click()
  await dentro(tel)
  check("o telemóvel (WebKit) está emparelhado com o computador (Chromium) e dentro da conta", true)

  // --- Ana, and the friendship ------------------------------------------------
  const ctxAna = await bFf.newContext(LARGO)
  const ana = await ctxAna.newPage()
  await ana.goto(servidor.APP, { waitUntil: "domcontentloaded" })
  await criarConta(ana, { nome: ANA, servidor: servidor.NOME })
  await dentro(ana)
  const separador = async (page, nome) => {
    await page.getByRole("button", { name: "Amigos", exact: true }).first().click()
    await page.locator(".people-destination").waitFor({ timeout: 15_000 })
    await page.locator(".people-tabs").getByRole("button", { name: nome }).click()
  }
  await separador(ana, "Encontrar")
  const linkDaAna = await ana.getByLabel("O teu link de amizade", { exact: true }).inputValue()
  await separador(pc, "Encontrar")
  await pc.getByLabel("Cola um link ou endereço").fill(linkDaAna)
  await pc.getByRole("button", { name: "Abrir perfil" }).click()
  const perfil = pc.locator(".person-profile")
  await perfil.waitFor({ timeout: 15_000 })
  await perfil.getByRole("button", { name: "Pedir amizade" }).click()
  await perfil.getByRole("button", { name: "Mensagem" }).click()
  await separador(ana, "Recebidos")
  await ana.getByRole("button", { name: "Aceitar" }).waitFor({ timeout: 60_000 })
  await ana.getByRole("button", { name: "Aceitar" }).click()

  /** Open the direct chat with someone: Friends, All, the name, Message. */
  const abrirDirecta = async (page, nome) => {
    const chegou = await ate(async () => {
      await separador(page, "Todos")
      return page.locator(".people-scroll .person-row", { hasText: nome }).first().isVisible()
    }, 120_000, 2_000)
    if (!chegou) throw new Error(`${nome} nunca apareceu nos amigos`)
    await page.locator(".people-scroll .person-row", { hasText: nome }).first().locator(".person-name-link").click()
    await page.locator(".pagina-da-pessoa, .person-profile").first().getByRole("button", { name: "Mensagem" }).click()
    await page.getByPlaceholder("Escreve uma mensagem").waitFor({ timeout: 90_000 })
  }
  await abrirDirecta(ana, BRUNO)
  await abrirDirecta(pc, ANA)
  await abrirDirecta(tel, ANA)
  check("a directa Ana e Bruno está aberta no Firefox, no Chromium e no telemóvel", true)

  // The computer's second tab: the same browser, the same account.
  const pc2 = await ctxPc.newPage()
  await pc2.goto(servidor.APP, { waitUntil: "domcontentloaded" })
  const usarEste = pc2.getByRole("button", { name: "Usar este separador" })
  check("o segundo separador do computador diz que a conta está aberta no primeiro", await usarEste.waitFor({ timeout: 30_000 }).then(() => true, () => false))

  const escrever = async (page, texto) => {
    const caixa = page.getByPlaceholder("Escreve uma mensagem")
    await caixa.fill(texto)
    await caixa.press("Enter")
  }
  // In the conversation, not just anywhere: the conversations drawer (hidden on the
  // phone) also shows the last message, and `first()` would catch that one.
  const ve = (page, texto) => page.locator(".timeline").getByText(texto, { exact: true }).first().isVisible().catch(() => false)

  // Before killing: the connection works.
  await escrever(ana, "antes-da-queda")
  check("antes da queda, a mensagem da Ana chega ao telemóvel", await ate(() => ve(tel, "antes-da-queda"), 60_000))
  check('e o telemóvel diz "ligado"', (await estado(tel)) === "ligado", await estado(tel))

  // --- 1. Kill the phone's socket, without closing it -------------------------
  // Start counting the states the bar goes through, before killing.
  await tel.evaluate(() => {
    const historico = []
    window.__estados = historico
    const barra = () => document.querySelector("footer.statusbar")
    const ler = () => {
      const texto = barra()?.textContent ?? ""
      if (historico[historico.length - 1] !== texto) historico.push(texto)
    }
    ler()
    new MutationObserver(ler).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  const vivosAntes = sockets.filter((s) => !s.morto).length
  for (const registo of sockets) registo.morto = true
  check("o socket do telemóvel está morto nos dois sentidos, sem close", vivosAntes >= 1, `${vivosAntes} socket(s)`)
  await espera(1_500)
  check('sem verificação, a avaria: o telemóvel continua a dizer "ligado"', (await estado(tel)) === "ligado", await estado(tel))

  await escrever(ana, "da-ana-na-queda")
  await escrever(pc, "do-computador-na-queda")
  await espera(1_500)
  check("com o socket morto, nada chega ao telemóvel", !(await ve(tel, "da-ana-na-queda")))

  // The phone comes back to the page, and the person writes at once.
  await tel.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
  await escrever(tel, "do-telemovel-ao-voltar")

  // --- 2. The check detects the death -----------------------------------------
  const deuPorEla = await ate(async () => (await tel.evaluate(() => window.__estados)).some((texto) => texto !== "ligado"), 15_000)
  check('a verificação dá pela morte: a barra deixa de dizer "ligado"', deuPorEla, (await tel.evaluate(() => window.__estados)).join(" > "))

  // --- 3. The connection comes back, and everything passes both ways ----------
  check("o telemóvel volta a ligar sozinho", await ate(async () => (await estado(tel)) === "ligado", 60_000), (await tel.evaluate(() => window.__estados)).join(" > "))
  check("com um socket novo", sockets.some((s) => !s.morto))
  check("a mensagem da Ana escrita durante a queda chega ao telemóvel", await ate(() => ve(tel, "da-ana-na-queda"), 90_000))
  check("a do computador também", await ate(() => ve(tel, "do-computador-na-queda"), 90_000))
  check("a do telemóvel, escrita ao voltar, chega à Ana (Firefox)", await ate(() => ve(ana, "do-telemovel-ao-voltar"), 90_000))
  check("e ao computador, no separador dono (Chromium)", await ate(() => ve(pc, "do-telemovel-ao-voltar"), 90_000))
  check("o segundo separador continua à espera, sem tomar a ligação ao primeiro", (await usarEste.isVisible().catch(() => false)) && (await estado(pc)) === "ligado", `dono: ${await estado(pc)}`)

  // The second tab takes over the account, and the direct chat still passes in both directions.
  await usarEste.click()
  // Without "Remember the session", the tab that takes over asks for the password.
  const frase2 = pc2.locator('.gate-card input[type="password"]')
  await pc2.getByRole("button", { name: "Configurações", exact: true }).first().or(frase2).first().waitFor({ timeout: 60_000 })
  if (await frase2.count()) {
    await frase2.fill(FRASE)
    await frase2.press("Enter")
  }
  await dentro(pc2)
  check("o primeiro separador pára, e o segundo fica com a conta", await ate(() => pc.getByRole("button", { name: "Usar este separador" }).isVisible(), 30_000))
  await abrirDirecta(pc2, ANA)
  await escrever(tel, "do-telemovel-ao-segundo-separador")
  check("o segundo separador, agora dono, recebe a mensagem do telemóvel", await ate(() => ve(pc2, "do-telemovel-ao-segundo-separador"), 90_000))
  await escrever(pc2, "do-segundo-separador")
  check("e o telemóvel recebe a dele", await ate(() => ve(tel, "do-segundo-separador"), 90_000))

  // --- 4. No signal at all from the page: the pulse -----------------------------
  await tel.evaluate(() => {
    window.__estados.length = 0
    window.__estados.push(document.querySelector("footer.statusbar")?.textContent ?? "")
  })
  for (const registo of sockets) registo.morto = true
  const peloPulso = await ate(async () => (await tel.evaluate(() => window.__estados)).some((texto) => texto !== "ligado"), 40_000, 500)
  check("sem visibilitychange, o pulso dá pela morte em menos de 40 s", peloPulso, (await tel.evaluate(() => window.__estados)).join(" > "))
  check("e volta a ligar", await ate(async () => (await estado(tel)) === "ligado", 60_000))
  await escrever(ana, "depois-do-pulso")
  check("e a mensagem seguinte da Ana chega ao telemóvel", await ate(() => ve(tel, "depois-do-pulso"), 60_000))
} catch (erro) {
  check("o percurso correu até ao fim", false, String(erro?.message ?? erro).split("\n")[0])
} finally {
  for (const browser of browsers) await browser.close().catch(() => {})
  servidor.fechar()
}

const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações passaram`)
process.exit(falhas === 0 ? 0 : 1)
