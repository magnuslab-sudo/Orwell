/**
 * The public channel has an owner, and who?
 *
 * Create a new account, join the public room and open properties. What you see
 * answers the question: a "take over" button means no owner; read-only fields
 * mean it has an owner and it is not this account.
 *
 * The server cannot answer this, the foundation record travels encrypted inside
 * the group, like everything else.
 */
import { chromium } from "playwright"
import { APP } from "./ambiente.mjs"
import { criarContaEEntrar } from "./conta.mjs"

const FRASE = process.env.ORWELL_DIAG_PASSPHRASE ?? "carga-2026"
const MARCA = Date.now().toString(36)

const ctx = await chromium.launchPersistentContext(`/tmp/orwell-dono/${MARCA}`, {
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  permissions: ["microphone"],
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto(APP, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(3000)
await criarContaEEntrar(page, { nome: "Verificador", frase: FRASE })
console.log("conta criada")

const limite = Date.now() + 150_000
for (;;) {
  const lista = (await page.locator("body").innerText()).split("Entrar com um link")[0] ?? ""
  if (/\borwell\b/i.test(lista)) break
  if (Date.now() > limite) {
    console.log("!! nao entrou na sala comum")
    await ctx.close()
    process.exit(1)
  }
  await page.waitForTimeout(3000)
}
console.log("entrou na sala comum")

// Give time for catch-up: the foundation record may come in history.
await page.waitForTimeout(8000)

const sala = page.locator("button.channel").filter({ hasText: /orwell/i }).first()
await sala.click({ button: "right" })
await page.waitForTimeout(800)
await page.getByRole("menuitem", { name: /propriedades/i }).first().click()
await page.waitForTimeout(2000)

const texto = await page.locator("body").innerText()
const podeAssumir = texto.includes("Assumir a administração")
const emLeitura = texto.includes("Só quem administra este canal pode mudar isto")
const temGuardar = await page.getByRole("button", { name: /^guardar$/i }).count()

console.log("\n=== o que esta conta vê nas propriedades ===")
console.log(`  botão de assumir: ${podeAssumir ? "SIM (canal SEM dono)" : "não"}`)
console.log(`  aviso de leitura: ${emLeitura ? "SIM (canal COM dono, e não sou eu)" : "não"}`)
console.log(`  botão de guardar: ${temGuardar > 0 ? "sim (posso editar)" : "não (não posso editar)"}`)
console.log("")
if (emLeitura && !podeAssumir && temGuardar === 0) console.log("VEREDICTO: o canal tem dono e está protegido.")
else if (podeAssumir) console.log("VEREDICTO: o canal continua SEM dono — qualquer membro o pode reclamar.")
else console.log("VEREDICTO: estado inesperado, ver acima.")

await ctx.close()
