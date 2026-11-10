/**
 * Session saved on TWO devices: a real desktop app
 * (`secretaria.mjs`) and a browser (Chromium), and "Switch account" on desktop.
 *
 *   npm run build && node scripts/e2e-memorizar-sessao-aparelhos.mjs
 *
 * What we prove, always via the interface:
 *  1. Ana creates account on desktop: registration asks for password (F3: no more
 *     keychain-only vault) and the "Remember session" box comes on;
 *  2. close the app and reopen: opens without password (`sessao.enc`, wrapped
 *     by `safeStorage`), and `vault.enc` didn't change shape;
 *  3. browser pairs with Ana, box on: reload without the tab key opens without password;
 *  4. "Switch account" on desktop: add Bruno in a new account, and
 *     return to Ana without password; reopen the app opens the active account;
 *  5. "Sign out" on desktop: asks for password, Ana's `sessao.enc` leaves, and
 *     reopening the app also asks for it;
 *  6. Ana revokes the browser: the browser is kicked out, forgets his session
 *     (the `sessao` entry leaves IndexedDB) and reload asks for password.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { ate, contasDoServidor, dentro, irParaEmparelhar, verificador } from "./fase7-comum.mjs"
import { abrirSecretaria } from "./secretaria.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

/** The profile names, which are from the script not the interface (`strings.guioes.test.ts`). */
const ANA = "Ana"
const BRUNO = "Bruno"
const FRASE_ANA = "frase-da-ana-2026"
const FRASE_BRUNO = "frase-do-bruno-2026"
const FRASE_BROWSER = "frase-do-browser-2026"
const SEGUINTE = /^(Continuar|Seguinte)$/
const AVISO = "Este aparelho foi tirado da conta noutro aparelho"

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8498, servidor: 8499, etiqueta: "memorizar-aparelhos" })
const browser = await chromium.launch({ headless: true })
let sec = null
let dados = null
const erros = []

const configuracoes = (page) => page.getByRole("button", { name: "Configurações", exact: true }).first()
const campoDaFrase = (page) => page.locator('.gate-card input[type="password"]')
const nomeProprio = (page) => page.locator(".me-name-text").first()

async function oQueAbre(page, timeout = 60_000) {
  await configuracoes(page).or(campoDaFrase(page)).first().waitFor({ timeout })
  return (await configuracoes(page).count()) > 0 ? "dentro" : "pede-frase"
}

async function quemEsta(page) {
  await dentro(page)
  await nomeProprio(page).waitFor({ timeout: 30_000 })
  return (await nomeProprio(page).textContent())?.trim() ?? ""
}

async function irAConta(page) {
  await configuracoes(page).click()
  await page.getByRole("button", { name: "Conta", exact: true }).first().click()
  await page.getByRole("button", { name: "Terminar sessão" }).waitFor({ timeout: 15_000 })
}

async function reabrirSecretaria() {
  await sec.fechar({ guardarDados: true })
  sec = await abrirSecretaria({ rotulo: "secretaria", dados })
  sec.page.on("pageerror", (erro) => erros.push(`sec: ${erro.message}`))
}

const temTexto = (local, texto) =>
  local.getByText(texto, { exact: true }).first().waitFor({ timeout: 10_000 }).then(
    () => true,
    () => false,
  )

async function registoDaSessaoNoBrowser(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const pedido = indexedDB.open("enclave", 1)
        pedido.onerror = () => reject(pedido.error)
        pedido.onsuccess = () => {
          const leitura = pedido.result.transaction("vault", "readonly").objectStore("vault").get("sessao")
          leitura.onsuccess = () => resolve(leitura.result !== undefined)
          leitura.onerror = () => reject(leitura.error)
        }
      }),
  )
}

try {
  // 1. Ana on desktop, with password and session remembered.
  sec = await abrirSecretaria({ rotulo: "secretaria" })
  dados = sec.dados
  sec.page.on("pageerror", (erro) => erros.push(`sec: ${erro.message}`))
  const antes = contasDoServidor(srv.base).length
  await criarConta(sec.page, { nome: "Ana", frase: FRASE_ANA, servidor: srv.NOME, memorizar: true })
  check("a Ana entra na secretária", (await quemEsta(sec.page)) === "Ana")
  const envelope = JSON.parse(readFileSync(join(dados, "vault.enc"), "utf8").replace(/^orwv2\n/, ""))
  check("F3: o cofre novo da secretária tem palavra-passe, e não é só do porta-chaves", envelope.protection === "passphrase" && !("wrappedKey" in envelope), envelope.protection)
  check("o sessao.enc está ao lado do vault.enc", existsSync(join(dados, "sessao.enc")))
  check(
    "o vault.enc não ganhou campo nenhum",
    JSON.stringify(Object.keys(envelope).sort()) === JSON.stringify(["ciphertext", "nonce", "protection", "salt", "version"]),
    Object.keys(envelope).sort().join(","),
  )
  check("o sessao.enc não tem a chave em claro", !readFileSync(join(dados, "sessao.enc"), "utf8").includes('"chave"'))

  // 2. Fechar e reabrir a app.
  await reabrirSecretaria()
  check("reabrir a secretária abre sem palavra-passe", (await oQueAbre(sec.page)) === "dentro" && (await quemEsta(sec.page)) === "Ana")

  // 3. Browser pairs with Ana, and remembers.
  await configuracoes(sec.page).click()
  await sec.page.getByRole("button", { name: "Aparelhos", exact: true }).click()
  await sec.page.getByRole("button", { name: "Acrescentar aparelho" }).click()
  const folha = sec.page.locator(".sheet").first()
  await folha.locator(".qr-code").waitFor({ timeout: 20_000 })
  const link = await folha.locator("code[data-link]").getAttribute("data-link")
  const ctx = await browser.newContext({ locale: "pt-PT" })
  const web = await ctx.newPage()
  web.on("pageerror", (erro) => erros.push(`web: ${erro.message}`))
  await web.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await irParaEmparelhar(web)
  await web.getByLabel("Ou cola o link").fill(link)
  await web.getByRole("button", { name: SEGUINTE }).first().click()
  await web.getByRole("heading", { name: "Palavra-passe deste aparelho" }).waitFor({ timeout: 15_000 })
  const campos = web.locator('.gate-card input[type="password"]')
  for (let i = 0; i < (await campos.count()); i++) await campos.nth(i).fill(FRASE_BROWSER)
  check("o emparelhamento no browser tem a caixa, ligada", await web.locator('input[name="memorizar"]').isChecked())
  await web.getByRole("button", { name: SEGUINTE }).first().click()
  await web.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await folha.locator(".sas-palavras").waitFor({ timeout: 30_000 })
  await web.getByRole("button", { name: "São as mesmas" }).click()
  await folha.getByRole("button", { name: "São as mesmas" }).click()
  await web.getByRole("heading", { name: "Este aparelho já é da conta" }).waitFor({ timeout: 90_000 })
  await folha.getByRole("button", { name: "Fechar" }).first().click().catch(() => {})
  await web.getByRole("button", { name: "Entrar", exact: true }).click()
  check("o browser entra na conta da Ana", (await quemEsta(web)) === "Ana")
  check("o browser memorizou a sessão", await registoDaSessaoNoBrowser(web))
  await web.evaluate(() => sessionStorage.clear())
  await web.reload({ waitUntil: "domcontentloaded" })
  check("recarregar o browser sem a chave do separador abre sem palavra-passe", (await oQueAbre(web)) === "dentro")
  check("o servidor tem uma conta nova, e não duas", contasDoServidor(srv.base).length === antes + 1)

  // 4. "Switch account" on desktop.
  await sec.page.keyboard.press("Escape").catch(() => {})
  await irAConta(sec.page)
  await sec.page.getByRole("button", { name: "Mudar de conta", exact: true }).click()
  let folhaDasContas = sec.page.getByRole("dialog", { name: "Mudar de conta" })
  await Promise.all([sec.page.waitForEvent("load", { timeout: 30_000 }), folhaDasContas.getByRole("button", { name: "Acrescentar outra conta" }).click()])
  await criarConta(sec.page, { nome: "Bruno", frase: FRASE_BRUNO, servidor: srv.NOME, memorizar: false })
  check("o Bruno nasce numa conta nova da secretária", (await quemEsta(sec.page)) === "Bruno")
  const pastas = existsSync(join(dados, "contas")) ? readdirSync(join(dados, "contas")) : []
  check("a conta nova tem a pasta dela, com o cofre dela", pastas.length === 1 && existsSync(join(dados, "contas", pastas[0], "vault.enc")), pastas.join(","))
  const lista = JSON.parse(readFileSync(join(dados, "contas.json"), "utf8"))
  check("o contas.json diz os dois nomes", JSON.stringify(lista.contas.map((c) => c.nome)) === JSON.stringify(["Ana", "Bruno"]), JSON.stringify(lista))
  await irAConta(sec.page)
  await sec.page.getByRole("button", { name: "Mudar de conta", exact: true }).click()
  folhaDasContas = sec.page.getByRole("dialog", { name: "Mudar de conta" })
  check("a folha diz que a Ana abre sem palavra-passe", await temTexto(folhaDasContas, "Abre sem pedir a palavra-passe."))
  await Promise.all([sec.page.waitForEvent("load", { timeout: 30_000 }), folhaDasContas.getByRole("button", { name: ANA }).click()])
  check("voltar à Ana na secretária abre sem palavra-passe", (await oQueAbre(sec.page)) === "dentro" && (await quemEsta(sec.page)) === "Ana")
  await reabrirSecretaria()
  check("reabrir a app abre a conta activa (a Ana), sem palavra-passe", (await oQueAbre(sec.page)) === "dentro" && (await quemEsta(sec.page)) === "Ana")

  // 5. "Sign out" on desktop.
  await irAConta(sec.page)
  await sec.page.getByRole("button", { name: "Terminar sessão" }).click()
  check(
    '"Terminar sessão" na secretária pede a palavra-passe',
    await campoDaFrase(sec.page).waitFor({ timeout: 30_000 }).then(
      () => true,
      () => false,
    ),
  )
  check("e o sessao.enc da Ana saiu", !existsSync(join(dados, "sessao.enc")))
  await reabrirSecretaria()
  check("reabrir a app depois de terminar pede a palavra-passe", (await oQueAbre(sec.page)) === "pede-frase")
  await campoDaFrase(sec.page).fill(FRASE_ANA)
  await sec.page.locator('input[name="memorizar"]').setChecked(false)
  await campoDaFrase(sec.page).press("Enter")
  check("com a frase, a Ana volta a entrar", (await quemEsta(sec.page)) === "Ana")

  // 6. Ana revokes the browser: it forgets the remembered session.
  await configuracoes(sec.page).click()
  await sec.page.getByRole("button", { name: "Aparelhos", exact: true }).click()
  const revogar = sec.page.locator(".aparelhos-lista li:not(.este)").getByRole("button", { name: /^Revogar/ }).first()
  await revogar.waitFor({ timeout: 20_000 })
  await revogar.click()
  await sec.page.getByRole("alertdialog").getByRole("button", { name: "Revogar" }).click()
  const msAviso = await ate(async () => (await web.locator("body").innerText()).includes(AVISO), 60_000, 500)
  check("o browser revogado é posto fora e diz porquê", msAviso >= 0, `${msAviso} ms`)
  const msEsqueceu = await ate(async () => !(await registoDaSessaoNoBrowser(web)), 15_000, 300)
  check("e esquece a sessão memorizada dele", msEsqueceu >= 0, `${msEsqueceu} ms`)
  await web.reload({ waitUntil: "domcontentloaded" })
  check("recarregar o revogado pede a palavra-passe", (await oQueAbre(web)) === "pede-frase")

  check("nenhum erro de página nos dois aparelhos", erros.length === 0, erros[0]?.slice(0, 200) ?? "")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  const texto = await sec?.page.locator("body").innerText({ timeout: 2000 }).catch(() => "(fechado)")
  console.log(`--- secretária mostra: "${String(texto).replace(/\s+/g, " ").slice(-600)}"`)
  if (process.env.DEBUG_CONTAS) console.log(await sec?.page.evaluate(() => window.enclaveHost?.contas?.listar().then((r) => JSON.stringify(r), (e) => String(e))))
  console.log(sec?.registo.slice(-15).join("\n"))
} finally {
  await sec?.fechar().catch(() => {})
  await browser.close().catch(() => {})
  srv.fechar()
}
process.exit(resumo() ? 0 : 1)
