/**
 * Export an account on one device and import it on another, in all three
 * combinations: browser to browser, browser to desktop app, and desktop to browser.
 * Line 2 of phase 7.
 *
 *   npm run build && node scripts/e2e-exportar-importar.mjs                 (all three)
 *   node scripts/e2e-exportar-importar.mjs --so=sec-web                     (one)
 *
 * In each combination, everything through the UI:
 *  1. Ana is created on the SOURCE device; Bruno (browser) asks her for friendship,
 *     she accepts; Bruno creates the "lagar" channel and invites her; she joins;
 *  2. Ana exports in Settings › Devices. On the browser the file comes out sealed
 *     by the account password; on desktop the vault is in the keychain, and the
 *     app ASKS for an export passphrase (the keychain does not travel);
 *  3. the DESTINATION device, with no account, imports the file at the gate;
 *  4. after importing: the destination has the channel and Bruno in friends, reads
 *     what Bruno writes in the channel and in the direct message, and Bruno reads him;
 *  5. and the source, still connected, can no longer use the account: the server
 *     closes it when the destination assumes ownership of the device, it returns to
 *     the gate saying why, and reloaded with the passphrase it stays refused. That
 *     is what the UI promises ("Import moves the account to this device. The old
 *     device will no longer be able to use it."). Until October 27, 2026 it was
 *     not true: the source kept talking and reading, and the two copies broke the
 *     channel for each other.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, abrirDirecta, aceitarAmizade, ate, consultar, contasDoServidor, criarCanal, dentro, dizer, escutar, espera, irParaONome, moradaNova, moradasEstreadas, ouviu, pedirAmizade, separador, temCanal, verificador } from "./fase7-comum.mjs"
import { abrirSecretaria } from "./secretaria.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const FRASE_DE_EXPORTACAO = "frase-do-ficheiro-2026"
const so = process.argv.find((a) => a.startsWith("--so="))?.split("=")[1]
const COMBINACOES = [
  ["web", "web"],
  ["web", "sec"],
  ["sec", "web"],
].filter(([o, d]) => !so || so === `${o}-${d}`)

const { check, resumo } = verificador()
const registo = []
const pastaDosFicheiros = mkdtempSync(join(tmpdir(), "orwell-e2e-ficheiros-"))
const srv = await levantarServidor({ frente: 8482, servidor: 8483, etiqueta: "exportar-importar" })
const browser = await chromium.launch({ headless: true })
const abertos = []
/** The open devices, so a failure diagnosis can say what each screen showed. */
const aparelhos = []

async function abrirAparelho(tipo, rotulo) {
  if (tipo === "sec") {
    const sec = await abrirSecretaria({ rotulo })
    abertos.push(() => sec.fechar())
    sec.page.on("console", () => {})
    const aparelho = { tipo, rotulo, page: sec.page, sec }
    aparelhos.push(aparelho)
    return aparelho
  }
  const ctx = await browser.newContext({ locale: "pt-PT", acceptDownloads: true })
  escutar(ctx, registo, rotulo)
  const page = await ctx.newPage()
  await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
  abertos.push(() => ctx.close())
  const aparelho = { tipo, rotulo, page, ctx }
  aparelhos.push(aparelho)
  return aparelho
}

/** Settings › Devices › Export account. Returns the file path. */
async function exportar(aparelho, destino) {
  const { page } = aparelho
  await page.getByRole("button", { name: "Configurações", exact: true }).first().click()
  await page.getByRole("button", { name: "Aparelhos", exact: true }).click()
  const botao = page.getByRole("button", { name: "Exportar conta" }).first()
  if (aparelho.tipo === "sec") {
    /*
      In the installed app the `<a download>` opens the system save dialog, and the
      user picks the folder. Here the main process receives the choice already made
      (`setSavePath` in `will-download`), which is what the dialog would do.
    */
    await aparelho.sec.app.evaluate(({ BrowserWindow }, caminho) => {
      for (const janela of BrowserWindow.getAllWindows()) {
        janela.webContents.session.once("will-download", (_evento, item) => item.setSavePath(caminho))
      }
    }, destino)
    await botao.click()
    const campo = page.locator('input[name="export-password"]')
    const pediu = await campo.waitFor({ timeout: 15_000 }).then(() => true, () => false)
    check(`${aparelho.rotulo}: o cofre do porta-chaves pede uma frase de exportação`, pediu)
    await campo.fill(FRASE_DE_EXPORTACAO)
    await page.locator("form.export-pass").getByRole("button", { name: "Exportar conta" }).click()
    const ms = await ate(async () => existsSync(destino), 60_000, 300)
    return ms >= 0 ? destino : null
  }
  const descarga = page.waitForEvent("download", { timeout: 60_000 })
  await botao.click()
  const d = await descarga
  await d.saveAs(destino)
  return destino
}

async function importar(aparelho, ficheiro, frase) {
  const { page } = aparelho
  await irParaONome(page)
  await page.locator('.import-account input[type="file"]').setInputFiles(ficheiro)
  await page.locator('input[name="import-password"]').fill(frase)
  await page.getByRole("button", { name: "Importar", exact: true }).click()
  await dentro(page)
}

try {
  for (const [origem, destino] of COMBINACOES) {
    const etiqueta = `${origem}→${destino}`
    console.log(`\n=== ${etiqueta} ===`)
    const nomeDaAna = `Ana ${origem}-${destino}`
    const canal = `lagar-${origem}-${destino}`

    // 1. Ana on the source, Bruno on the browser, friendship and channel.
    const antes = contasDoServidor(srv.base).length
    const anaOrigem = await abrirAparelho(origem, `origem-${origem}`)
    await criarConta(anaOrigem.page, { nome: nomeDaAna, frase: FRASE, servidor: srv.NOME })
    await dentro(anaOrigem.page)
    const bruno = await abrirAparelho("web", `bruno-${etiqueta}`)
    await criarConta(bruno.page, { nome: `Bruno ${origem}-${destino}`, frase: FRASE, servidor: srv.NOME })
    await dentro(bruno.page)
    const [enderecoAna, enderecoBruno] = contasDoServidor(srv.base).slice(antes)
    await pedirAmizade(bruno.page, enderecoAna)
    check(`${etiqueta}: a Ana (origem) aceita a amizade do Bruno`, (await aceitarAmizade(anaOrigem.page)) >= 0)
    // The address is the one the app drew (1.0 "Arca"): read from the server.
    const estreadas = moradasEstreadas(srv.base)
    await criarCanal(bruno.page, canal)
    const idDoCanal = await moradaNova(srv.base, estreadas)
    check(`${etiqueta}: o Bruno convida a Ana para o canal`, await convidar(bruno.page, canal, enderecoAna))
    check(`${etiqueta}: a Ana (origem) entra no canal`, await aceitarConvite(anaOrigem.page, canal, { espera: 60_000 }))
    await abrirCanal(anaOrigem.page, canal)
    await abrirCanal(bruno.page, canal)
    const antesDeExportar = `antes de exportar ${Date.now().toString(36)}`
    await dizer(bruno.page, antesDeExportar)
    check(`${etiqueta}: a origem lê o canal antes de exportar`, (await ouviu(anaOrigem.page, antesDeExportar)) >= 0)

    // 2. Exportar.
    const caminho = join(pastaDosFicheiros, `conta-${origem}-${destino}.enclave`)
    const ficheiro = await exportar(anaOrigem, caminho)
    check(`${etiqueta}: a origem exporta o ficheiro da conta`, Boolean(ficheiro) && existsSync(caminho))

    // 3. Importar no destino.
    const anaDestino = await abrirAparelho(destino, `destino-${destino}`)
    const t0 = Date.now()
    await importar(anaDestino, caminho, origem === "sec" ? FRASE_DE_EXPORTACAO : FRASE)
    check(`${etiqueta}: o destino importa e entra na conta`, true, `${Date.now() - t0} ms`)
    check(`${etiqueta}: importar não cria conta nenhuma no servidor`, contasDoServidor(srv.base).length === antes + 2)

    // 4. The destination has the channel and the friend, and talks.
    check(`${etiqueta}: o destino tem o canal ${canal}`, await temCanal(anaDestino.page, canal, 60_000))
    await separador(anaDestino.page, "Todos")
    const temAmigo = await ate(async () => anaDestino.page.locator(".people-scroll .person-row", { hasText: "Bruno" }).first().isVisible(), 30_000, 1000)
    check(`${etiqueta}: o destino tem o Bruno nos amigos`, temAmigo >= 0)
    await abrirCanal(anaDestino.page, canal)
    await abrirCanal(bruno.page, canal)
    const doBruno = `depois de importar, do Bruno ${Date.now().toString(36)}`
    await dizer(bruno.page, doBruno)
    const msDestinoLe = await ouviu(anaDestino.page, doBruno)
    check(`${etiqueta}: o destino lê o canal`, msDestinoLe >= 0, `${msDestinoLe} ms`)
    const doDestino = `do destino ${Date.now().toString(36)}`
    await dizer(anaDestino.page, doDestino)
    const msBrunoLe = await ouviu(bruno.page, doDestino)
    check(`${etiqueta}: o Bruno lê o destino no canal`, msBrunoLe >= 0, `${msBrunoLe} ms`)
    await abrirDirecta(anaDestino.page)
    await abrirDirecta(bruno.page)
    const naDirecta = `directa depois de importar ${Date.now().toString(36)}`
    await dizer(bruno.page, naDirecta)
    const msDirecta = await ouviu(anaDestino.page, naDirecta)
    check(`${etiqueta}: o destino lê a directa do Bruno`, msDirecta >= 0, `${msDirecta} ms`)

    // 5. The source, still connected: can it no longer use the account? The server
    //    closes the old copy when the imported one assumes ownership
    //    (`auth.finish`, in the protocol), and the UI returns to the gate saying why.
    const AVISO = "Este aparelho foi tirado da conta noutro aparelho"
    const msAviso = await ate(async () => (await anaOrigem.page.locator("body").innerText()).includes(AVISO), 30_000, 500)
    check(`${etiqueta}: a origem é posta fora e diz porquê ("${AVISO}")`, msAviso >= 0, `${msAviso} ms`)
    const foraDaApp = await ate(async () => (await anaOrigem.page.getByRole("button", { name: "Configurações", exact: true }).count()) === 0, 15_000, 500)
    check(`${etiqueta}: a origem já não está dentro da aplicação (voltou ao portão)`, foraDaApp >= 0)
    const novoDoBruno = `do Bruno, para ver quem lê ${Date.now().toString(36)}`
    await dizer(bruno.page, novoDoBruno)
    const msDestinoAinda = await ouviu(anaDestino.page, novoDoBruno, 30_000)
    check(`${etiqueta}: e o destino continua a ler`, msDestinoAinda >= 0, `${msDestinoAinda} ms`)
    // Try again on the source: reload and open the vault with the passphrase. The
    // server refuses the old copy at login, and it stays out.
    if (origem === "web") {
      await anaOrigem.page.reload({ waitUntil: "domcontentloaded" })
      const campo = anaOrigem.page.locator('.gate-card input[type="password"]').first()
      if (await campo.waitFor({ timeout: 30_000 }).then(() => true, () => false)) {
        await campo.fill(FRASE)
        await anaOrigem.page.getByRole("button", { name: "Entrar", exact: true }).click()
      }
      const msDeNovo = await ate(async () => (await anaOrigem.page.locator("body").innerText()).includes(AVISO), 30_000, 500)
      const entrou = (await anaOrigem.page.getByRole("button", { name: "Configurações", exact: true }).count()) > 0
      check(`${etiqueta}: recarregada e com a frase, a origem continua recusada`, msDeNovo >= 0 && !entrou, `${msDeNovo} ms`)
    }
    const daOrigemNoServidor = consultar(srv.base, "SELECT count(*) AS n FROM events WHERE channel = ?", idDoCanal)[0].n
    console.log(`  ..  eventos do canal no fim: ${daOrigemNoServidor}`)

    while (abertos.length) await abertos.pop()().catch(() => {})
  }
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  for (const a of aparelhos) {
    const texto = await a.page.locator("body").innerText({ timeout: 2000 }).catch(() => "(fechado)")
    console.log(`--- ${a.rotulo} mostra: "${texto.replace(/\s+/g, " ").slice(0, 1500)}"`)
    if (a.sec) console.log(a.sec.registo.filter((l) => /PRINCIPAL!|PAGEERROR/.test(l)).slice(-15).join("\n"))
  }
  console.log("--- browsers (fim) ---\n" + registo.filter((l) => !l.includes("TRAMA")).slice(-25).join("\n"))
  console.log("--- servidor (fim) ---\n" + srv.registo.texto.split("\n").filter((l) => !/Experimental|trace-warnings/.test(l)).slice(-40).join("\n"))
}

while (abertos.length) await abertos.pop()().catch(() => {})
await browser.close().catch(() => {})
srv.fechar()
rmSync(pastaDosFicheiros, { recursive: true, force: true })
process.exit(resumo() ? 0 : 1)
