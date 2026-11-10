/**
 * The two interface pieces requested by the owner, seen live.
 *
 *   1. **THE CALL DOCK** says, top to bottom, the state ("In call"), the place
 *      (channel name / room name) and has a way to disconnect. It does NOT say
 *      "Sharing screen", because screen sharing does not exist yet.
 *   2. **THE FRIEND REQUEST CARD** lives in the conversation, standing above it
 *      and outside the scrolling list, and there is only ONE.
 *
 * Two real accounts, in two persistent Chromium profiles: two separate IndexedDB
 * instances is what makes them two accounts and not two windows of the same one.
 *
 *   sh scripts/dev-servidor-sem-comunidade.sh   # 8453, and the reason is inside
 *   npm run dev:web
 *   node scripts/ver-doca-e-pedido.mjs http://127.0.0.1:5173/app/ localhost:8453
 *
 * **Does not run against the 8452 server**, and that is not just a port detail:
 * 8452 is in community mode, where everyone is already friends with everyone and
 * so there is no friend request for the card to show.
 *
 * Production is locked in `ambiente.mjs` and does not turn off by argument.
 */
import { chromium } from "playwright"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { alvo, alvoApp, FRASE } from "./ambiente.mjs"
import { criarContaEEntrar } from "./conta.mjs"

const APP = alvoApp(process.argv[2])
const SERVIDOR = alvo(process.argv[3])

/** Portraits go in the project folder: `/tmp` disappears between sessions. */
const CAPTURAS = process.env.ORWELL_CAPTURAS ?? join(process.cwd(), "capturas")
mkdirSync(CAPTURAS, { recursive: true })

/** Fake media: without this, `getUserMedia` on a call never responds. */
const ARGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
]

const falhas = []
function verificar(descricao, condicao, extra = "") {
  console.log(`  ${condicao ? "ok   " : "FALHA"}  ${descricao}${extra ? `  — ${extra}` : ""}`)
  if (!condicao) falhas.push(descricao)
}

/**
 * A new account, in its own browser profile.
 *
 * `esperarCanal` only for those who really need a channel: the common room is
 * moderated, and whoever arrives later only enters if there is an online member
 * who admits them. The second account here does not need it for anything, what
 * it comes to do is respond to a request in a two-person conversation.
 */
async function abrir(nome, { esperarCanal = false } = {}) {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), `orwell-doca-${nome}-`)), {
    headless: true,
    args: ARGS,
    viewport: { width: 1280, height: 900 },
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const erros = []
  page.on("pageerror", (erro) => erros.push(String(erro.message).slice(0, 200)))
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await criarContaEEntrar(page, { nome, frase: FRASE, servidor: SERVIDOR, timeout: 30_000, entrada: 120_000 })
  await page.locator(".rail").waitFor({ timeout: 240_000 })
  if (esperarCanal) await page.locator("button.channel").first().waitFor({ timeout: 240_000 })
  return { nome, ctx, page, erros }
}

/** The account address, read from the screen itself. */
async function enderecoDe(page) {
  const texto = await page.locator("body").innerText()
  return texto.match(/@[a-z0-9-]+:[a-z0-9.:-]+/i)?.[0] ?? null
}

console.log(`app ${APP}  ·  servidor ${SERVIDOR}`)
console.log("a criar duas contas...")
const ana = await abrir("Ana", { esperarCanal: true })
const bruno = await abrir("Bruno")
for (const quem of [ana, bruno]) await quem.page.waitForTimeout(3000)

// ====================================================== 1. the call dock
console.log("\n=== a doca da chamada: o quê, onde, e por onde sair ===")

await ana.page.locator("button.channel").first().click()
await ana.page.waitForTimeout(2000)
const canal = (await ana.page.locator(".topbar h1").first().innerText()).trim()

// A channel is born with a voice room called "voz": entering it is the call.
await ana.page.locator(".room-row").filter({ hasText: "voz" }).first().click()
await ana.page.getByRole("button", { name: /sair da chamada/i }).first().waitFor({ timeout: 60_000 })
await ana.page.waitForTimeout(3000)

// The dock only appears when the panel leaves the screen. Leaving for Social is
// the real gesture: the call continues and the dock is what remains of it.
await ana.page.getByRole("button", { name: "Feed" }).first().click()
await ana.page.locator(".call-dock").waitFor({ timeout: 30_000 })

const estado = (await ana.page.locator(".call-dock-state").first().innerText()).trim()
const onde = (await ana.page.locator(".call-dock-where").first().innerText()).trim()
console.log(`  a doca diz: ${JSON.stringify(estado)} / ${JSON.stringify(onde)}`)

verificar("a primeira linha diz o estado", estado.includes("Em chamada"), JSON.stringify(estado))
verificar("a segunda linha diz o canal e a sala", onde === `${canal} / voz`, JSON.stringify(onde))
verificar(
  "e por esta ordem: o estado por cima do sítio",
  (await ana.page.locator(".call-dock-state").first().boundingBox()).y <
    (await ana.page.locator(".call-dock-where").first().boundingBox()).y,
)
verificar("há botão de desligar", (await ana.page.locator(".call-dock .call-btn.hangup").count()) === 1)

// Screen sharing does not yet exist in the product: the dock cannot announce it.
const textoDaDoca = await ana.page.locator(".call-dock").first().innerText()
verificar("não anuncia partilha de ecrã, que ainda não existe", !/partilhar ecrã/i.test(textoDaDoca))

// The dock stays inside the screen, with both lines in view.
const caixa = await ana.page.locator(".call-dock").first().boundingBox()
const janela = ana.page.viewportSize()
verificar(
  "a doca inteira cabe no ecrã",
  caixa.y + caixa.height <= janela.height + 1 && caixa.x + caixa.width <= janela.width + 1,
  `fundo em ${Math.round(caixa.y + caixa.height)} de ${janela.height}`,
)

await ana.page.screenshot({ path: join(CAPTURAS, "doca-largo.png") })

// And on a phone, where the dock gained height and could have gone past the edge.
await ana.page.setViewportSize({ width: 390, height: 844 })
await ana.page.waitForTimeout(1200)
const estreita = await ana.page.locator(".call-dock").first().boundingBox()
verificar(
  "num telemóvel a doca continua inteira dentro do ecrã",
  estreita.y + estreita.height <= 845 && estreita.x >= 0 && estreita.x + estreita.width <= 391,
  `${Math.round(estreita.x)},${Math.round(estreita.y)} ${Math.round(estreita.width)}x${Math.round(estreita.height)}`,
)
verificar(
  "e continua a dizer onde é",
  (await ana.page.locator(".call-dock-where").first().innerText()).trim() === `${canal} / voz`,
)
await ana.page.screenshot({ path: join(CAPTURAS, "doca-telemovel.png") })
await ana.page.setViewportSize({ width: 1280, height: 900 })
await ana.page.waitForTimeout(800)

await ana.page.locator(".call-dock .call-btn.hangup").click()
await ana.page.waitForTimeout(3000)
verificar("desligar pela doca acaba mesmo a chamada", (await ana.page.locator(".call-dock").count()) === 0)

// ============================================ 2. the friend request card
console.log("\n=== o cartão do pedido de amizade, na conversa ===")

const enderecoBruno = await enderecoDe(bruno.page)
if (!enderecoBruno) throw new Error("não se conseguiu ler o endereço do Bruno")

await ana.page.getByRole("button", { name: "Amigos" }).first().click()
await ana.page.locator(".people-destination").waitFor({ timeout: 15_000 })
await ana.page.getByRole("button", { name: "Encontrar", exact: true }).first().click()
await ana.page.getByLabel("Cola um link ou endereço").fill(enderecoBruno)
await ana.page.getByRole("button", { name: "Abrir perfil" }).click()
// The address opens the profile sheet; the request is made there, with the single button.
await ana.page.locator(".person-profile").getByRole("button", { name: "Pedir amizade" }).click()
// The sheet stays open after the request and covers the page: close it.
await ana.page.keyboard.press("Escape")
await ana.page.waitForTimeout(8000)

// Ana writes after the request. This is what pushed the card off screen when it
// was a line in the conversation.
await ana.page.locator(".people-aside .direct-row .direct-open").first().click()
await ana.page.waitForTimeout(2000)
const escrita = ana.page.locator(".chat-composer input:not([type=file])").first()
for (let i = 0; i < 8; i++) {
  await escrita.fill(`assunto ${i}`)
  await escrita.press("Enter")
  await ana.page.waitForTimeout(400)
}
await ana.page.waitForTimeout(4000)

// Bruno opens the conversation from the column, which is the normal path.
await bruno.page.getByRole("button", { name: "Amigos" }).first().click()
await bruno.page.waitForTimeout(3000)
await bruno.page.locator(".people-aside .direct-row .direct-open").first().click()
await bruno.page.locator(".chat-pedido").waitFor({ timeout: 30_000 })
await bruno.page.waitForTimeout(1500)

const cartao = bruno.page.locator(".chat-pedido .pedido-card").first()
verificar("o cartão está na conversa", (await cartao.count()) === 1)
verificar(
  "com o nome de quem pediu",
  /quer ser teu amigo/i.test(await cartao.innerText()),
  JSON.stringify((await cartao.innerText()).split("\n")[0]),
)
verificar("e com as duas respostas", (await cartao.getByRole("button").allInnerTexts()).join(" · ").includes("Aceitar"))

// Only ONE. Two cards would give two identical buttons on the same screen, and
// that is what the previous attempt produced.
const quantosAceitar = await bruno.page.getByRole("button", { name: "Aceitar" }).count()
verificar('há um botão "Aceitar" e não dois', quantosAceitar === 1, `${quantosAceitar}`)
verificar("e nenhum cartão dentro da lista que rola", (await bruno.page.locator(".timeline .pedido-card").count()) === 0)

// What matters for real: it stays ABOVE the conversation, so it does not scroll up with it.
const caixaCartao = await cartao.boundingBox()
const caixaConversa = await bruno.page.locator(".timeline").first().boundingBox()
verificar(
  "o cartão fica de pé por cima da conversa",
  caixaCartao.y + caixaCartao.height <= caixaConversa.y + 2,
  `cartão acaba em ${Math.round(caixaCartao.y + caixaCartao.height)}, conversa começa em ${Math.round(caixaConversa.y)}`,
)
const textoDaConversa = await bruno.page.locator(".timeline").first().innerText()
verificar("com as oito frases mesmo lá por baixo", /assunto 7/.test(textoDaConversa))
await bruno.page.screenshot({ path: join(CAPTURAS, "pedido-largo.png") })

/*
  And on a phone, which is where this breaks most easily.

  The conversation grid has a new row (`pedido`), and it must exist in all THREE
  area sets: wide, two-column, and narrow. A grid area that the grid does not
  know goes to the end, below the status bar. Already happened with the common
  channel display, at 407px.
*/
await bruno.page.setViewportSize({ width: 390, height: 844 })
await bruno.page.waitForTimeout(1200)
const cartaoEstreito = await bruno.page.locator(".chat-pedido").first().boundingBox()
const conversaEstreita = await bruno.page.locator(".timeline").first().boundingBox()
verificar(
  "num telemóvel o cartão continua por cima da conversa, e não no fim da grelha",
  cartaoEstreito.y + cartaoEstreito.height <= conversaEstreita.y + 2,
  `cartão acaba em ${Math.round(cartaoEstreito.y + cartaoEstreito.height)}, conversa começa em ${Math.round(conversaEstreita.y)}`,
)
await bruno.page.screenshot({ path: join(CAPTURAS, "pedido-telemovel.png") })
await bruno.page.setViewportSize({ width: 1280, height: 900 })
await bruno.page.waitForTimeout(800)

await bruno.page.getByRole("button", { name: "Aceitar" }).first().click()
await bruno.page.waitForTimeout(9000)
verificar("aceitar da conversa faz o cartão desaparecer", (await bruno.page.locator(".chat-pedido").count()) === 0)
verificar("e a conversa fica onde estava", /assunto 7/.test(await bruno.page.locator(".timeline").first().innerText()))

// ------------------------------------------------------------------ fim
for (const quem of [ana, bruno]) {
  if (quem.erros.length > 0) {
    console.log(`\n  erros de página em ${quem.nome}:`)
    for (const erro of quem.erros) console.log(`    ${erro}`)
    falhas.push(`erros de página em ${quem.nome}`)
  }
  await quem.ctx.close()
}

console.log(falhas.length === 0 ? "\nTUDO OK" : `\nFALHAS (${falhas.length}):\n  ${falhas.join("\n  ")}`)
process.exit(falhas.length === 0 ? 0 : 1)
