/**
 * The real app, on a real Chrome: create account, speak, reload.
 *
 * Phase 0 multi-device changes nothing you see, that is the criterion, but it
 * touches the MLS leaf credential, the key that signs login, and what the vault
 * stores. All of this passes under this screen, and an error there shows up here
 * as an account that does not log in or a conversation that does not come back.
 *
 *   ORWELL_WEB=http://127.0.0.1:5179 node scripts/verificar-ecra-fase0.mjs [servidor]
 */
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const WEB = comLingua(process.env.ORWELL_WEB ?? "http://127.0.0.1:5179")
const SERVIDOR = process.argv[2] ?? "localhost:8471"
const FRASE = "frase-passe-de-verificacao"

let passou = 0
let falhou = 0
function check(rotulo, ok, detalhe = "") {
  if (ok) {
    passou++
    console.log(`PASS  ${rotulo}`)
  } else {
    falhou++
    console.log(`FAIL  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
  }
}

const ctx = await chromium.launchPersistentContext("", { headless: true, viewport: { width: 1400, height: 950 } })
const page = ctx.pages()[0] ?? (await ctx.newPage())

const errosDeConsola = []
page.on("console", (m) => {
  if (m.type() === "error") errosDeConsola.push(m.text().slice(0, 200))
})
page.on("pageerror", (e) => errosDeConsola.push(`pageerror: ${String(e.message).slice(0, 200)}`))

await page.goto(WEB, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(1500)

// --- Create account -------------------------------------------------------
// No longer a form with all four fields at once: it is one question at a time,
// and `criarConta` knows how to walk through them.
await criarConta(page, { nome: "Verificação", frase: FRASE, servidor: SERVIDOR })
await page.waitForTimeout(8000)

const textoDepois = await page.locator("body").innerText()
check("a conta é criada e o ecrã de entrada desaparece", !textoDepois.includes("PALAVRA-PASSE DESTE DISPOSITIVO"), textoDepois.slice(0, 200))

// The account address appears in four words, it is the digest of the ACCOUNT
// key, and it stays that key after the leaf becomes signed by the device key.
const enderecoVisivel = /@?[a-z]+-[a-z]+-[a-z]+-[a-z]+/.test(textoDepois)
check("o endereço de quatro palavras está no ecrã", enderecoVisivel)

// --- Join a channel -------------------------------------------------------
await page.getByRole("button", { name: "Criar canal" }).first().click()
await page.waitForTimeout(1000)
// Typed not `fill`: the button only wakes up when the field emits changes one
// by one, and a `fill` that skips that path leaves it disabled.
const nome = page.locator("input:visible").first()
await nome.click()
await page.keyboard.type("sala de verificação")
await page.waitForTimeout(500)
await page.getByRole("button", { name: "Confirmar" }).first().click()
await page.waitForTimeout(8000)

const comCanal = await page.locator("body").innerText()
// The name is normalized to an identifier: "sala de verificação" becomes
// "sala-de-verificacao", and that is how it appears in the list.
check("o canal criado abre-se", comCanal.includes("sala-de-verificacao") && !comCanal.includes("Sem canal aberto"))

// --- Falar ------------------------------------------------------------------
const dito = `verificação da fase 0 ${Date.now()}`
const caixa = page.getByPlaceholder("Escreve uma mensagem").first()
let falou = false
try {
  await caixa.click({ timeout: 10_000 })
  await page.keyboard.type(dito)
  await page.keyboard.press("Enter")
  // Loose on purpose: what the next reload has to find is the message ALREADY
  // written to the vault, and that write is async. Reloading before it finishes
  // gives an empty conversation, which is not a product defect.
  await page.waitForTimeout(8000)
  falou = (await page.locator("body").innerText()).includes(dito)
} catch (error) {
  falou = false
  console.log(`   (caixa de escrita: ${String(error.message).slice(0, 100)})`)
}
check("a mensagem escrita aparece na conversa", falou)

// --- Recarregar -------------------------------------------------------------
errosDeConsola.length = 0
await page.reload({ waitUntil: "domcontentloaded" })
await page.waitForTimeout(3000)

// The vault is locked after reload: the password unlocks it.
const desbloqueio = page.locator("input[type='password']").first()
if (await desbloqueio.count()) {
  await desbloqueio.fill(FRASE)
  await page.keyboard.press("Enter")
  await page.waitForTimeout(8000)
}

// After unlock the conversation still has to be opened: history comes back
// from the vault channel by channel, and the screen picks the last one you were in.
await page.getByText("sala-de-verificacao").first().click({ timeout: 15_000 }).catch(() => {})
await page.waitForTimeout(4000)

const textoFinal = await page.locator("body").innerText()
check("a conta volta a abrir depois de recarregar", !textoFinal.includes("Criar conta"), textoFinal.slice(0, 200))
check("a conversa volta com o que lá estava", textoFinal.includes(dito), textoFinal.slice(0, 300))
check("nenhum erro de consola depois de recarregar", errosDeConsola.length === 0, errosDeConsola.join(" | "))

await ctx.close()
console.log(`\n${passou}/${passou + falhou} verificações passaram`)
process.exit(falhou === 0 ? 0 : 1)
