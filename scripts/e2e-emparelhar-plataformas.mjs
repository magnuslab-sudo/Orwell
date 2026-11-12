/**
 * Pair across platforms, and revoke. Line 3 of phase 7.
 *
 *   npm run build && node scripts/e2e-emparelhar-plataformas.mjs                (both)
 *   node scripts/e2e-emparelhar-plataformas.mjs --so=web-sec                    (one)
 *
 * Browser with browser is already tested in `e2e-emparelhar.mjs` (via camera).
 * Here: the main browser and the new desktop app (`web-sec`), and the reverse
 * (`sec-web`). In each combination, via the UI:
 *  1. Ana is created in the main browser; Bruno (browser) sends her a friend
 *     request, she accepts; Bruno creates the channel and invites her; she joins;
 *  2. the main browser opens "Add device" and shows the link; the new one chooses
 *     to pair, pastes the link, and both confirm the same six words;
 *  3. the new device enters the account without creating one, receives the channel
 *     and direct message, reads Bruno and Bruno reads them;
 *  4. the main browser revokes the new device in Settings: the new one is removed
 *     and shown why, its sheet leaves the channel (a new commit, next epoch), and
 *     what Bruno writes next reaches the main browser and not the revoked one.
 */
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, abrirDirecta, aceitarAmizade, ate, consultar, contasDoServidor, criarCanal, dentro, dizer, escutar, irParaEmparelhar, moradaNova, moradasEstreadas, ouviu, pedirAmizade, temCanal, verificador } from "./fase7-comum.mjs"
import { abrirSecretaria } from "./secretaria.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const so = process.argv.find((a) => a.startsWith("--so="))?.split("=")[1]
const COMBINACOES = [
  ["web", "sec"],
  ["sec", "web"],
].filter(([p, n]) => !so || so === `${p}-${n}`)
const AVISO = "Este aparelho foi tirado da conta noutro aparelho"
const SEGUINTE = /^(Continuar|Seguinte)$/

const { check, resumo } = verificador()
const registo = []
const srv = await levantarServidor({ frente: 8488, servidor: 8489, etiqueta: "emparelhar-plataformas" })
const browser = await chromium.launch({ headless: true })
const abertos = []
const aparelhos = []

async function abrirAparelho(tipo, rotulo) {
  let aparelho
  if (tipo === "sec") {
    const sec = await abrirSecretaria({ rotulo })
    abertos.push(() => sec.fechar())
    aparelho = { tipo, rotulo, page: sec.page, sec }
  } else {
    const ctx = await browser.newContext({ locale: "pt-PT" })
    escutar(ctx, registo, rotulo)
    const page = await ctx.newPage()
    await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
    abertos.push(() => ctx.close())
    aparelho = { tipo, rotulo, page }
  }
  aparelhos.push(aparelho)
  return aparelho
}

const eventosDe = (canal, tipo) => consultar(srv.base, "SELECT count(*) AS n FROM events WHERE channel = ? AND kind = ?", canal, tipo)[0].n

try {
  for (const [tipoPrincipal, tipoNovo] of COMBINACOES) {
    const etiqueta = `${tipoPrincipal}→${tipoNovo}`
    console.log(`\n=== principal ${tipoPrincipal}, novo ${tipoNovo} ===`)
    const canal = `adega-${tipoPrincipal}-${tipoNovo}`

    // 1. Ana in the main browser, Bruno, friend request and channel.
    const antes = contasDoServidor(srv.base).length
    const principal = await abrirAparelho(tipoPrincipal, `principal-${tipoPrincipal}`)
    await criarConta(principal.page, { nome: `Ana ${etiqueta}`, frase: FRASE, servidor: srv.NOME })
    await dentro(principal.page)
    const bruno = await abrirAparelho("web", `bruno-${etiqueta}`)
    await criarConta(bruno.page, { nome: `Bruno ${etiqueta}`, frase: FRASE, servidor: srv.NOME })
    await dentro(bruno.page)
    const [enderecoAna] = contasDoServidor(srv.base).slice(antes)
    await pedirAmizade(bruno.page, enderecoAna)
    check(`${etiqueta}: a Ana aceita a amizade no principal`, (await aceitarAmizade(principal.page)) >= 0)
    // The address is the one the app drew (1.0 "Arca"): read from the server.
    const estreadas = moradasEstreadas(srv.base)
    await criarCanal(bruno.page, canal)
    const idDoCanal = await moradaNova(srv.base, estreadas)
    check(`${etiqueta}: o Bruno convida a Ana`, await convidar(bruno.page, canal, enderecoAna))
    check(`${etiqueta}: o principal entra no canal`, await aceitarConvite(principal.page, canal, { espera: 60_000 }))

    // 2. Add device: the link, pasted into the new one, and the six words.
    await principal.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
    await principal.page.getByRole("button", { name: "Aparelhos", exact: true }).click()
    await principal.page.getByRole("button", { name: "Acrescentar aparelho" }).click()
    const folha = principal.page.locator(".sheet").first()
    await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
    const link = await folha.locator("code[data-link]").getAttribute("data-link")
    check(`${etiqueta}: o principal mostra o QR e o link`, Boolean(link))

    const novo = await abrirAparelho(tipoNovo, `novo-${tipoNovo}`)
    await irParaEmparelhar(novo.page)
    await novo.page.getByLabel("Ou cola o link").fill(link)
    await novo.page.getByRole("button", { name: SEGUINTE }).first().click()
    await novo.page.getByRole("heading", { name: "Palavra-passe deste aparelho" }).waitFor({ timeout: 15_000 })
    // On browser you enter a password; on desktop the key stays in the keychain,
    // like in the installed app, and there is no field.
    const campos = novo.page.locator('.gate-card input[type="password"]')
    for (let i = 0; i < (await campos.count()); i++) await campos.nth(i).fill(FRASE)
    await novo.page.getByRole("button", { name: SEGUINTE }).first().click()
    const t0 = Date.now()
    await novo.page.locator(".sas-palavras").waitFor({ timeout: 30_000 })
    await folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
    const pNovo = await novo.page.locator(".sas-palavras").getAttribute("data-palavras")
    const pPrincipal = await folha.locator(".sas-palavras").getAttribute("data-palavras")
    check(`${etiqueta}: as mesmas seis palavras nos dois ecrãs`, pNovo === pPrincipal && pNovo?.split("-").length === 6, `${pNovo} (${Date.now() - t0} ms)`)
    await novo.page.getByRole("button", { name: "São as mesmas" }).click()
    await folha.getByRole("button", { name: "São as mesmas" }).click()
    const feito = await novo.page.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 }).then(() => true, () => false)
    check(`${etiqueta}: o novo recebe o certificado e fica da conta`, feito, `${Date.now() - t0} ms`)
    await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
    await novo.page.getByRole("button", { name: "Entrar", exact: true }).click()
    await dentro(novo.page)
    check(`${etiqueta}: o novo não criou conta`, contasDoServidor(srv.base).length === antes + 2)

    // 3. The new device in the channel and direct message.
    check(`${etiqueta}: o novo recebe o canal`, await temCanal(novo.page, canal, 90_000))
    await abrirCanal(novo.page, canal)
    await abrirCanal(bruno.page, canal)
    await abrirCanal(principal.page, canal).catch(async () => {
      await principal.page.keyboard.press("Escape")
      await abrirCanal(principal.page, canal)
    })
    const doBruno = `do Bruno para os dois aparelhos ${Date.now().toString(36)}`
    await dizer(bruno.page, doBruno)
    const msNovo = await ouviu(novo.page, doBruno)
    const msPrincipal = await ouviu(principal.page, doBruno)
    check(`${etiqueta}: o Bruno escreve e o novo lê`, msNovo >= 0, `${msNovo} ms`)
    check(`${etiqueta}: e o principal também`, msPrincipal >= 0, `${msPrincipal} ms`)
    const doNovo = `do aparelho novo ${Date.now().toString(36)}`
    await dizer(novo.page, doNovo)
    const msBruno = await ouviu(bruno.page, doNovo)
    check(`${etiqueta}: o novo escreve e o Bruno lê`, msBruno >= 0, `${msBruno} ms`)
    await abrirDirecta(novo.page).catch(() => {})
    await abrirDirecta(bruno.page)
    const naDirecta = `directa para o aparelho novo ${Date.now().toString(36)}`
    await dizer(bruno.page, naDirecta)
    const msDirecta = await ouviu(novo.page, naDirecta)
    check(`${etiqueta}: o novo lê a directa do Bruno`, msDirecta >= 0, `${msDirecta} ms`)

    // 4. Revoke from the main device.
    const commitsAntes = eventosDe(idDoCanal, "handshake")
    await principal.page.getByRole("button", { name: "Configurações", exact: true }).first().click()
    await principal.page.getByRole("button", { name: "Aparelhos", exact: true }).click()
    const revogar = principal.page.locator(".aparelhos-lista li:not(.este)").getByRole("button", { name: /^Revogar/ }).first()
    await revogar.waitFor({ timeout: 20_000 })
    await revogar.click()
    await principal.page.getByRole("alertdialog").getByRole("button", { name: "Revogar" }).click()
    const msRevogado = await ate(async () => (await principal.page.locator("body").innerText()).includes("O aparelho foi revogado."), 60_000, 500)
    check(`${etiqueta}: o principal revoga o novo`, msRevogado >= 0, `${msRevogado} ms`)
    const msAviso = await ate(async () => (await novo.page.locator("body").innerText()).includes(AVISO), 30_000, 500)
    check(`${etiqueta}: o revogado é posto fora e diz porquê`, msAviso >= 0, `${msAviso} ms`)
    const commitsDepois = eventosDe(idDoCanal, "handshake")
    check(`${etiqueta}: a folha do revogado sai do canal (a época seguinte)`, commitsDepois > commitsAntes, `${commitsAntes} → ${commitsDepois} commits`)
    await abrirCanal(principal.page, canal)
    await abrirCanal(bruno.page, canal)
    const depois = `depois de revogar ${Date.now().toString(36)}`
    await dizer(bruno.page, depois)
    const msPrincipalDepois = await ouviu(principal.page, depois)
    check(`${etiqueta}: depois de revogar, o principal continua a ler`, msPrincipalDepois >= 0, `${msPrincipalDepois} ms`)
    const msRevogadoLe = await ouviu(novo.page, depois, 15_000)
    check(`${etiqueta}: e o revogado não`, msRevogadoLe < 0)

    while (abertos.length) await abertos.pop()().catch(() => {})
    aparelhos.length = 0
  }
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const a of aparelhos) {
    const texto = await a.page.locator("body").innerText({ timeout: 2000 }).catch(() => "(fechado)")
    console.log(`--- ${a.rotulo} mostra: "${texto.replace(/\s+/g, " ").slice(0, 900)}"`)
  }
}

while (abertos.length) await abertos.pop()().catch(() => {})
await browser.close().catch(() => {})
srv.fechar()
process.exit(resumo() ? 0 : 1)
