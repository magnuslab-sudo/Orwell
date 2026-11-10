/**
 * "Switch account": two accounts in the same browser, each with its own vault
 * and remembered session. Across all three engines, with a persistent profile.
 *
 *   npm run build && node scripts/e2e-mudar-de-conta.mjs                    (all three)
 *   npm run build && node scripts/e2e-mudar-de-conta.mjs chromium           (this one only)
 *
 * What gets verified, always through the UI:
 *  1. Ana creates an account with the session remembered;
 *  2. in Account › Session, "Switch account" › "Add another account": sign-up
 *     opens in a new account, and Bruno is created there WITHOUT remembering;
 *  3. the server has two accounts, and the browser two vaults (`current` and
 *     `cofre:<id>`); the device list shows both names;
 *  4. "Switch account" › Ana: opens WITHOUT a password (her session stayed);
 *  5. "Switch account" › Bruno: asks for the password (he did not remember);
 *  6. close the browser and reopen: opens Bruno, who asks for the phrase; the
 *     gate has "Switch account", and Ana opens from there without a phrase;
 *  7. Ana exports her account: the file is Ana's and carries no remembered key;
 *  8. "Log out" on Ana forgets only HER session: Bruno stays, and Ana asks for
 *     the phrase.
 *
 * All local and disposable (`servidor-descartavel.mjs`).
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, firefox, webkit } from "playwright"
import { criarConta } from "./conta.mjs"
import { contasDoServidor, verificador } from "./fase7-comum.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

/** The profile names, which are from the script not the interface (`strings.guioes.test.ts`). */
const ANA = "Ana"
const BRUNO = "Bruno"
const FRASE_ANA = "frase-da-ana-2026"
/** The "Devices" section of Settings, where "Export account" lives. */
const DEFINICOES_APARELHOS = "Aparelhos"
const FRASE_BRUNO = "frase-do-bruno-2026"
const MOTORES = { chromium, firefox, webkit }
const pedidos = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))
const escolhidos = pedidos.length ? pedidos : Object.keys(MOTORES)

const { check, resumo } = verificador()
const srv = await levantarServidor({ frente: 8496, servidor: 8497, etiqueta: "mudar-de-conta" })
const perfis = []

const configuracoes = (page) => page.getByRole("button", { name: "Configurações", exact: true }).first()
const campoDaFrase = (page) => page.locator('.gate-card input[type="password"]')
const nomeProprio = (page) => page.locator(".me-name-text").first()

async function oQueAbre(page, timeout = 60_000) {
  await configuracoes(page).or(campoDaFrase(page)).first().waitFor({ timeout })
  return (await configuracoes(page).count()) > 0 ? "dentro" : "pede-frase"
}

/** Waits for the app and says whose it is: the name on the account card. */
async function quemEsta(page) {
  await configuracoes(page).waitFor({ timeout: 90_000 })
  await nomeProprio(page).waitFor({ timeout: 30_000 })
  return (await nomeProprio(page).textContent())?.trim() ?? ""
}

async function destrancar(page, frase) {
  await campoDaFrase(page).waitFor({ timeout: 30_000 })
  await campoDaFrase(page).fill(frase)
  const caixa = page.locator('input[name="memorizar"]')
  if (await caixa.count()) await caixa.setChecked(false)
  await campoDaFrase(page).press("Enter")
}

/** Account › Session › "Switch account", and the sheet open. */
async function abrirMudarDeConta(page) {
  await irAConta(page)
  await page.getByRole("button", { name: "Mudar de conta", exact: true }).click()
  return page.getByRole("dialog", { name: "Mudar de conta" })
}

/** Settings › Account (the section opens to the last one seen). */
async function irAConta(page) {
  await configuracoes(page).click()
  await page.getByRole("button", { name: "Conta", exact: true }).first().click()
  await page.getByRole("button", { name: "Terminar sessão" }).waitFor({ timeout: 15_000 })
}

/** The text appears in the sheet (the list reads after the sheet opens). */
const temTexto = (folha, texto) =>
  folha.getByText(texto, { exact: true }).first().waitFor({ timeout: 10_000 }).then(
    () => true,
    () => false,
  )

async function esperarRecarregar(page, accao) {
  await Promise.all([page.waitForEvent("load", { timeout: 30_000 }), accao()])
}

async function chavesDoIndexedDB(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const pedido = indexedDB.open("enclave", 1)
        pedido.onerror = () => reject(pedido.error)
        pedido.onsuccess = () => {
          const chaves = pedido.result.transaction("vault", "readonly").objectStore("vault").getAllKeys()
          chaves.onsuccess = () => resolve([...chaves.result].map(String).sort())
          chaves.onerror = () => reject(chaves.error)
        }
      }),
  )
}

try {
  for (const motor of escolhidos) {
    console.log(`\n=== ${motor} ===`)
    const perfil = mkdtempSync(join(tmpdir(), `orwell-mudar-${motor}-`))
    perfis.push(perfil)
    const abrir = () => MOTORES[motor].launchPersistentContext(perfil, { headless: true, locale: "pt-PT", acceptDownloads: true })
    let ctx = await abrir()
    const erros = []
    const vigiar = (page) => page.on("pageerror", (erro) => erros.push(String(erro?.stack ?? erro?.message ?? erro)))
    try {
      let page = ctx.pages()[0] ?? (await ctx.newPage())
      vigiar(page)
      const antes = contasDoServidor(srv.base).length

      // 1. Ana with the session remembered.
      await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
      await criarConta(page, { nome: "Ana", frase: FRASE_ANA, servidor: srv.NOME, memorizar: true })
      check(`[${motor}] a Ana entra`, (await quemEsta(page)) === "Ana")

      // 2. Add another account: signup opens in a new account.
      const folha = await abrirMudarDeConta(page)
      check(`[${motor}] com uma conta só, a folha diz que não há outra`, await temTexto(folha, "Ainda não há outra conta neste aparelho."))
      await esperarRecarregar(page, () => folha.getByRole("button", { name: "Acrescentar outra conta" }).click())
      await criarConta(page, { nome: "Bruno", frase: FRASE_BRUNO, servidor: srv.NOME, memorizar: false })
      check(`[${motor}] o Bruno nasce na conta nova`, (await quemEsta(page)) === "Bruno")

      // 3. Two accounts on the server, two vaults in the browser, two names in the list.
      const contas = contasDoServidor(srv.base)
      check(`[${motor}] o servidor tem as duas contas`, contas.length === antes + 2, `${contas.length - antes}`)
      const chaves = await chavesDoIndexedDB(page)
      check(
        `[${motor}] dois cofres no browser, e só a Ana com sessão memorizada`,
        chaves.includes("current") && chaves.includes("sessao") && chaves.some((c) => c.startsWith("cofre:")) && !chaves.some((c) => c.startsWith("sessao:")),
        chaves.join(","),
      )
      const lista = await page.evaluate(() => JSON.parse(localStorage.getItem("orwell.contas") ?? "null"))
      check(`[${motor}] a lista do aparelho diz os dois nomes`, JSON.stringify(lista?.contas?.map((c) => c.nome)) === JSON.stringify(["Ana", "Bruno"]), JSON.stringify(lista))

      // 4. Switch to Ana: opens without password.
      let outra = await abrirMudarDeConta(page)
      check(`[${motor}] a folha diz que a Ana abre sem palavra-passe`, await temTexto(outra, "Abre sem pedir a palavra-passe."))
      await esperarRecarregar(page, () => outra.getByRole("button", { name: ANA }).click())
      check(`[${motor}] mudar para a Ana abre sem palavra-passe`, (await oQueAbre(page)) === "dentro" && (await quemEsta(page)) === "Ana")

      // 5. Switch to Bruno: asks for password.
      outra = await abrirMudarDeConta(page)
      check(`[${motor}] e diz que o Bruno pede a palavra-passe`, await temTexto(outra, "Pede a palavra-passe."))
      await esperarRecarregar(page, () => outra.getByRole("button", { name: BRUNO }).click())
      check(`[${motor}] mudar para o Bruno pede a palavra-passe`, (await oQueAbre(page)) === "pede-frase")
      await destrancar(page, FRASE_BRUNO)
      check(`[${motor}] com a frase dele, entra o Bruno`, (await quemEsta(page)) === "Bruno")

      // 6. Close the browser and reopen: Bruno asks for the passphrase; the gate switches to Ana.
      await ctx.close()
      ctx = await abrir()
      page = ctx.pages()[0] ?? (await ctx.newPage())
      vigiar(page)
      await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
      check(`[${motor}] reabrir o browser abre o Bruno, que pede a frase`, (await oQueAbre(page)) === "pede-frase")
      await page.getByRole("button", { name: "Mudar de conta", exact: true }).click()
      const noPortao = page.getByRole("dialog", { name: "Mudar de conta" })
      await esperarRecarregar(page, () => noPortao.getByRole("button", { name: ANA }).click())
      check(`[${motor}] no portão, "Mudar de conta" abre a Ana sem frase`, (await oQueAbre(page)) === "dentro" && (await quemEsta(page)) === "Ana")

      // 7. The export is from the open account and carries no remembered session.
      await configuracoes(page).click()
      await page.getByRole("button", { name: DEFINICOES_APARELHOS, exact: true }).first().click()
      const exportar = page.getByRole("button", { name: "Exportar conta", exact: true }).first()
      await exportar.waitFor({ timeout: 15_000 }).catch(() => {})
      if (await exportar.count()) {
        const [descarga] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), exportar.click()])
        const caminho = await descarga.path()
        const { readFileSync } = await import("node:fs")
        const texto = readFileSync(caminho, "utf8")
        check(`[${motor}] a Ana exporta um ficheiro de conta`, texto.includes("enclave-vault"))
        check(`[${motor}] e o ficheiro não leva sessão nenhuma`, !/sessao|webcrypto|safeStorage/.test(texto))
      } else {
        check(`[${motor}] a Ana exporta um ficheiro de conta`, false, "sem botão de exportar")
      }

      // 8. "Sign out" on Ana forgets only her session.
      await irAConta(page)
      await page.getByRole("button", { name: "Terminar sessão" }).click()
      await campoDaFrase(page).waitFor({ timeout: 30_000 })
      const depois = await chavesDoIndexedDB(page)
      check(
        `[${motor}] "Terminar sessão" na Ana apaga a sessão dela, e os dois cofres ficam`,
        !depois.includes("sessao") && depois.includes("current") && depois.some((c) => c.startsWith("cofre:")),
        depois.join(","),
      )
      check(`[${motor}] nenhum erro de página`, erros.length === 0, erros[0]?.slice(0, 1500) ?? "")
    } catch (erro) {
      check(`[${motor}] o guião chegou ao fim`, false, String(erro?.message ?? erro).split("\n")[0])
      for (const page of ctx?.pages() ?? []) {
        const texto = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => "(sem página)")
        console.log(`    [${motor}] ecrã: ${texto.replace(/\s+/g, " ")}`)
      }
    } finally {
      await ctx?.close().catch(() => {})
    }
  }
} finally {
  srv.fechar()
  for (const perfil of perfis) rmSync(perfil, { recursive: true, force: true })
}
process.exit(resumo() ? 0 : 1)
