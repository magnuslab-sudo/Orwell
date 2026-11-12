/**
 * The ticket room, with a real server and two clients.
 *
 * Three questions that no unit test answers, because all three cross the MLS,
 * the vault and the screen:
 *
 * 1. A ticket room created by one person REACHES the other as a ticket room?
 *    That is the lesson of this session: the `channel.meta` was encrypted in an
 *    epoch that the second account does not have, and `republishRooms` is what
 *    tells it so. If it threw the metadata away, the second account would see a
 *    chat room and nothing in this bench would flag it, the screen worked, it was
 *    just the wrong kind.
 * 2. Does the frame actually draw, with real CSS? jsdom does not compute layout:
 *    a broken grid passes the tests and shows up here.
 * 3. Permissions, from both sides and on different machines: whoever has `atender`
 *    sees the button and uses it; whoever does not have it, does not see it, and
 *    the state the first one wrote appears on the second one's screen.
 */
import { chromium } from "playwright"
import { APP, SERVIDOR } from "./ambiente.mjs"
import { criarContaEEntrar } from "./conta.mjs"

const FRASE = process.env.ORWELL_DIAG_PASSPHRASE ?? "carga-2026"
const MARCA = Date.now().toString(36)
const ASSUNTO = `Impressora avariada ${MARCA.slice(-3)}`

let falhas = 0
function verificar(o, condicao) {
  console.log(`  ${condicao ? "ok  " : "FALHA"}  ${o}`)
  if (!condicao) falhas++
}

async function abrir(indice, nome) {
  const ctx = await chromium.launchPersistentContext(`/tmp/orwell-tickets/${MARCA}-${indice}`, { headless: true })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const erros = []
  page.on("console", (m) => {
    if (m.type() === "error") erros.push(m.text().slice(0, 200))
  })
  page.on("pageerror", (e) => erros.push("PAGEERROR: " + String(e.message).slice(0, 200)))
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)
    // The server is explicit: without it, `criarConta` uses the address where the
  // page was served from (vite, on 5173) and the account is created against a
  // server that does not exist. That is what happened on the first run of this script.
  await criarContaEEntrar(page, { nome, frase: FRASE, servidor: SERVIDOR })
  return { ctx, page, nome, erros }
}

async function esperarSalaComum(page, limiteSegundos = 120) {
  const limite = Date.now() + limiteSegundos * 1000
  for (;;) {
    const lista = (await page.locator("body").innerText()).split("Entrar com um link")[0] ?? ""
    if (/\borwell\b/i.test(lista)) return true
    if (Date.now() > limite) return false
    await page.waitForTimeout(3000)
  }
}

console.log("a criar duas contas...")
const a = await abrir(0, "Ana")
console.log("  Ana pronta")
const b = await abrir(1, "Bento")
console.log("  Bento pronto")

for (const cliente of [a, b]) {
  const dentro = await esperarSalaComum(cliente.page)
  console.log(`  ${cliente.nome} na sala comum: ${dentro ? "sim" : "NAO"}`)
}
await a.page.waitForTimeout(4000)

// ---------------------------------------------------------------- the room
console.log("\n=== a Ana cria uma sala de tickets ===")
await a.page.locator("button.channel").first().click({ button: "right" })
await a.page.getByRole("menuitem", { name: "Nova sala" }).first().click()
const folha = a.page.getByRole("dialog")
await folha.getByLabel("Nome").fill("Apoio")
await folha.getByRole("button", { name: "Tickets", exact: true }).click()
const ressalva = await folha.getByText(/sala de texto com outra disposição/).isVisible().catch(() => false)
verificar("a folha avisa que por baixo é uma sala de texto", ressalva)
await folha.getByRole("button", { name: "Criar" }).click()
await a.page.waitForTimeout(4000)

await a.page.getByRole("button", { name: /Apoio/ }).first().click()
await a.page.waitForTimeout(1500)
const quadroDaAna = await a.page.locator("section.tickets").isVisible().catch(() => false)
verificar("a Ana vê o quadro de tickets, e não a conversa", quadroDaAna)
verificar(
  "com a ressalva de que um ticket não é privado",
  await a.page.getByText(/Um ticket não é privado/).isVisible().catch(() => false),
)

// -------------------------------------------- the room reaches the other account
console.log("\n=== e a sala chega ao Bento COMO sala de tickets ===")
const linhaNoBento = b.page.getByRole("button", { name: /Apoio/ }).first()
await linhaNoBento.waitFor({ timeout: 60_000 }).catch(() => {})
verificar("o Bento vê a sala na lista", await linhaNoBento.isVisible().catch(() => false))
await linhaNoBento.click()
await b.page.waitForTimeout(2000)
verificar(
  "e ela abre-lhe um QUADRO, e não uma conversa — é o republishRooms a levar a disposição",
  await b.page.locator("section.tickets").isVisible().catch(() => false),
)

// ------------------------------------------------- Bento opens a ticket
console.log("\n=== o Bento abre um ticket ===")
await b.page.getByRole("button", { name: "Abrir ticket" }).first().click()
await b.page.getByPlaceholder("Impressora avariada").fill(ASSUNTO)
await b.page.getByRole("button", { name: "Entrar", exact: true }).click()
await b.page.waitForTimeout(3000)
verificar("o ticket aparece no quadro do Bento", await b.page.getByText(ASSUNTO).first().isVisible().catch(() => false))
verificar(
  "e diz que ninguém o atende",
  await b.page.getByText("Por atender").first().isVisible().catch(() => false),
)

// ------------------------------------------------------ the permissions
console.log("\n=== quem atende, e quem não ===")
await a.page.waitForTimeout(6000)
const noQuadroDaAna = a.page.getByText(ASSUNTO).first()
await noQuadroDaAna.waitFor({ timeout: 60_000 }).catch(() => {})
verificar("o ticket do Bento chega ao quadro da Ana", await noQuadroDaAna.isVisible().catch(() => false))
await noQuadroDaAna.click()
await a.page.waitForTimeout(1200)

const anaAtende = a.page.getByRole("button", { name: "Atender" })
verificar('a Ana fundou o canal, e por isso vê "Atender"', await anaAtende.isVisible().catch(() => false))
await a.page.screenshot({ path: "/tmp/orwell-tickets-ana-ticket.png", fullPage: true })
await anaAtende.click()
await a.page.waitForTimeout(3000)
verificar(
  "depois de atender, o quadro diz que é ela quem atende",
  await a.page.getByText(/Atende Ana/).first().isVisible().catch(() => false),
)

await b.page.waitForTimeout(6000)
await b.page.getByText(ASSUNTO).first().click().catch(() => {})
await b.page.waitForTimeout(1500)

/**
 * This WAITS, and the wait is the measure.
 *
 * In a channel whose founding the client does not yet know, `powersOf` grants
 * everything that can be undone, and `atender` can be undone, so it is allowed in.
 * While Ana's `republishAuthority` has not reached Bento, he is a client with no
 * known owner and sees the button. This is not a bug: it is the rule written in
 * `powersOf` meeting a new responsibility.
 *
 * A dry assertion here would be green or red depending on the network of the day.
 * What matters is whether it CONVERGES, and how long it takes, and that is what we measure.
 */
const comecou = Date.now()
let bentoAindaVe = true
for (let volta = 0; volta < 30; volta++) {
  bentoAindaVe = await b.page.getByRole("button", { name: "Atender" }).isVisible().catch(() => false)
  if (!bentoAindaVe) break
  await b.page.waitForTimeout(2000)
}
console.log(`  o Bento deixou de ver "Atender" ao fim de ${Math.round((Date.now() - comecou) / 1000)}s`)
verificar('e o Bento, que não tem a responsabilidade, acaba por NÃO ver "Atender"', !bentoAindaVe)
verificar(
  'mas vê "Fechar ticket", porque foi ele que o abriu',
  await b.page.getByRole("button", { name: "Fechar ticket" }).isVisible().catch(() => false),
)
verificar(
  "e vê que a Ana passou a atendê-lo",
  await b.page.getByText(/Atende Ana/).first().isVisible().catch(() => false),
)

// ------------------------------------------------------------ the close
console.log("\n=== fechar, e o estado atravessar ===")
await b.page.getByRole("button", { name: "Fechar ticket" }).click()
await b.page.waitForTimeout(3000)
await b.page.getByRole("button", { name: "Voltar ao quadro" }).click()
await b.page.waitForTimeout(1000)
verificar('o quadro do Bento passa a dizer "Fechado"', await b.page.getByText("Fechado").first().isVisible().catch(() => false))
await b.page.screenshot({ path: "/tmp/orwell-tickets-bento-quadro.png", fullPage: true })

await a.page.waitForTimeout(6000)
await a.page.getByRole("button", { name: "Voltar ao quadro" }).click().catch(() => {})
await a.page.waitForTimeout(1500)
verificar(
  "e o fecho atravessa para a Ana",
  await a.page.getByText("Fechado").first().isVisible().catch(() => false),
)
await a.page.screenshot({ path: "/tmp/orwell-tickets-ana-quadro.png", fullPage: true })

// ---------------------------------------------------------- a geometria
console.log("\n=== a geometria, que o jsdom não mede ===")
const caixa = await a.page.locator(".ticket-row").first().boundingBox()
console.log(`  linha do quadro: ${caixa ? `${Math.round(caixa.width)}x${Math.round(caixa.height)}` : "(sem caixa)"}`)
verificar("a linha tem largura e altura a sério", !!caixa && caixa.width > 200 && caixa.height > 30)
const larguraDoCorpo = await a.page.evaluate(() => document.body.scrollWidth - document.body.clientWidth)
verificar("e a página não ganhou barra horizontal", larguraDoCorpo <= 0)

for (const cliente of [a, b]) {
  if (cliente.erros.length) console.log(`\nerros de consola em ${cliente.nome}:\n  ${cliente.erros.join("\n  ")}`)
  verificar(`sem erros de consola em ${cliente.nome}`, cliente.erros.length === 0)
}

await a.ctx.close()
await b.ctx.close()
console.log(`\n${falhas === 0 ? "TUDO OK" : `${falhas} FALHA(S)`}`)
process.exit(falhas === 0 ? 0 : 1)
