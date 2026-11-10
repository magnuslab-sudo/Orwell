/**
 * The right-click menu on someone in a voice room, and drag-and-drop.
 *
 * Three real accounts, real call, with mock media devices. What it proves:
 *
 *   1. The menu over a person in a voice room is THE PERSON'S MENU, profile,
 *      address, message, not a list of destinations. It was only destinations,
 *      and anyone without the `move` permission saw nothing: right-click did
 *      absolutely nothing.
 *   2. Who HAS the permission sees the person's menu PLUS destinations.
 *   3. Who DOESN'T see the person's menu and no destinations at all.
 *   4. Over your own name there's a menu, no destinations: moving yourself is
 *      just clicking the other room.
 *   5. With only one voice room, there are no destinations, the menu still
 *      stands.
 *   6. Drag-and-drop actually moves someone from one voice room to another.
 *
 * Move is convention not cryptography: what comes out of here is an encrypted
 * request to the other person's client, and an altered client stays where it is.
 * What we verify is that the HONEST client obeys.
 *
 *   sh scripts/dev-reiniciar-servidor.sh
 *   npm run dev:web
 *   node scripts/verificar-menu-voz.mjs
 */
import { chromium } from "playwright"
import { criarContaEEntrar } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const APP = comLingua(process.env.ORWELL_APP ?? "http://127.0.0.1:5173")
const SERVIDOR = process.env.ORWELL_SERVER ?? "localhost:8452"
const FRASE = "verificacao-menu-voz-2026"
const MARCA = Date.now().toString(36)

const ARGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
]

const falhas = []
function verificar(descricao, condicao, extra = "") {
  console.log(`  ${condicao ? "ok  " : "FALHA"}  ${descricao}${extra ? `  — ${extra}` : ""}`)
  if (!condicao) falhas.push(descricao)
}

async function abrir(indice, nome) {
  const ctx = await chromium.launchPersistentContext(`/tmp/orwell-menu-voz/${MARCA}-${indice}`, {
    headless: true,
    args: ARGS,
    viewport: { width: 1280, height: 900 },
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e.message).slice(0, 200)))
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await criarContaEEntrar(page, {
    nome,
    frase: FRASE,
    servidor: SERVIDOR,
    timeout: 30_000,
    entrada: 120_000,
  })
  await page.locator("button.channel").first().waitFor({ timeout: 240_000 })
  return { ctx, page, nome, erros }
}

/** The labels of the menu open right now. */
async function letreiros(page) {
  return page.getByRole("menuitem").allInnerTexts()
}

/** Right-click on a person in a voice room's list. */
async function menuDe(page, quem) {
  const linha = page.locator(".voice-member").filter({ hasText: quem }).first()
  await linha.waitFor({ timeout: 30_000 })
  await linha.click({ button: "right" })
  await page.waitForTimeout(600)
  const lista = await letreiros(page)
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)
  return lista
}

console.log("a criar tres contas...")
const a = await abrir(0, "Ana")
const b = await abrir(1, "Rui")
const c = await abrir(2, "Carla")
for (const cliente of [a, b, c]) await cliente.page.waitForTimeout(4000)
for (const cliente of [a, b, c]) await cliente.page.locator("button.channel").first().click()
await a.page.waitForTimeout(2000)

// ------------------------------------------------------------- one room only
/*
  The voice room the channel already has, and no other.
  
  A channel is born with a voice room called "voz" (see `SALAS_INICIAIS`), and
  that's the normal state for almost all of them: ONE voice room, zero
  destinations. It's the case where this menu did absolutely nothing, so it's
  the first to measure, creating a second room before measuring it would be
  measuring something else.
  */
console.log("\n=== so a sala de voz de fabrica: as tres entram nela ===")
await a.page.locator(".room-row").filter({ hasText: "voz" }).first().click()
await a.page.getByRole("button", { name: /sair da chamada/i }).first().waitFor({ timeout: 60_000 })
await a.page.waitForTimeout(4000)

/** Invitees enter through the banner: they join the SAME voice room where people already are. */
async function entrarPelaFaixa(cliente) {
  const botao = cliente.page.getByRole("button", { name: /^entrar$/i }).first()
  await botao.waitFor({ timeout: 120_000 })
  await botao.click()
  await cliente.page.getByRole("button", { name: /sair da chamada/i }).first().waitFor({ timeout: 60_000 })
}
await entrarPelaFaixa(b)
await entrarPelaFaixa(c)
await a.page.waitForTimeout(8000)

const comUmaSala = await menuDe(a.page, "Carla")
console.log(`  menu da Ana sobre a Carla, com uma sala de voz so: ${JSON.stringify(comUmaSala)}`)
verificar("com uma sala de voz so, ha menu — e era aqui que nao havia nada", comUmaSala.length > 0)
verificar("e e o menu da pessoa: ver perfil", comUmaSala.some((linha) => /Ver perfil/.test(linha)))
verificar("copiar endereco", comUmaSala.some((linha) => /Copiar endereço/.test(linha)))
verificar("mensagem", comUmaSala.some((linha) => /^Mensagem$/.test(linha)))
verificar("e nao ha destino nenhum, porque nao existe nenhum", !comUmaSala.some((linha) => /^Mover para/.test(linha)))

// -------------------------------------------------------- second room
console.log("\n=== a Ana cria a SEGUNDA sala de voz: agora ha para onde mover ===")
await a.page.locator("button.channel").first().click({ button: "right" })
await a.page.getByRole("menuitem", { name: "Nova sala" }).first().click()
const folha2 = a.page.getByRole("dialog")
await folha2.getByLabel("Nome").fill("Estudio")
await folha2.getByRole("button", { name: "Voz", exact: true }).click()
await folha2.getByRole("button", { name: "Criar" }).click()
await a.page.waitForTimeout(4000)

const comDuas = await menuDe(a.page, "Carla")
console.log(`  menu da Ana sobre a Carla, com duas salas: ${JSON.stringify(comDuas)}`)
verificar("quem tem a responsabilidade ve o menu da pessoa", comDuas.some((linha) => /Ver perfil/.test(linha)))
verificar("MAIS o destino", comDuas.some((linha) => /Mover para Estudio/.test(linha)))
verificar("e nunca a sala onde ela ja esta", !comDuas.some((linha) => /Mover para voz$/.test(linha)))

const sobreMim = await menuDe(a.page, "Ana")
console.log(`  menu da Ana sobre si propria: ${JSON.stringify(sobreMim)}`)
verificar("sobre o proprio nome ha menu", sobreMim.length > 0)
verificar("com o perfil la dentro", sobreMim.some((linha) => /Ver perfil/.test(linha)))
verificar("e sem destinos: mover-se a si propria e entrar noutra sala", !sobreMim.some((linha) => /^Mover para/.test(linha)))
verificar("e sem pedir amizade a si propria", !sobreMim.some((linha) => /amizade/i.test(linha)))

// ------------------------------------------- who cannot move anyone
console.log("\n=== o Rui, sem a responsabilidade `mover` ===")
const doRui = await menuDe(b.page, "Carla")
console.log(`  menu do Rui sobre a Carla: ${JSON.stringify(doRui)}`)
verificar("quem nao pode mover ve o menu da pessoa na mesma", doRui.length > 0)
verificar("com ver perfil", doRui.some((linha) => /Ver perfil/.test(linha)))
verificar("com copiar endereco", doRui.some((linha) => /Copiar endereço/.test(linha)))
verificar("e NAO ve destino nenhum", !doRui.some((linha) => /^Mover para/.test(linha)))

// ------------------------------------------------------------- o arrasto
console.log("\n=== o arrasto: a Ana leva a Carla para a outra sala ===")
const antesDaCarla = await c.page.evaluate(() => {
  const linha = document.querySelector(".room-row.current .room-name")
  return linha ? linha.textContent : null
})
console.log(`  a Carla estava em: ${JSON.stringify(antesDaCarla)}`)

const pessoa = a.page.locator(".room-voice-members li").filter({ hasText: "Carla" }).first()
const destino = a.page.locator(".room-row").filter({ hasText: "Estudio" }).first()
verificar("a linha da Carla e arrastavel para quem pode mover", (await pessoa.getAttribute("draggable")) === "true")
await pessoa.dragTo(destino)
await a.page.waitForTimeout(6000)

const naSalaNova = await c.page
  .locator(".room-row")
  .filter({ hasText: "Estudio" })
  .first()
  .evaluate((no) => no.classList.contains("current"))
  .catch(() => false)
verificar("a Carla passou mesmo para a outra sala de voz", naSalaNova)

const presentesEstudio = await a.page.evaluate(() => {
  const linhas = [...document.querySelectorAll(".room-row")]
  const estudio = linhas.find((linha) => linha.textContent?.includes("Estudio"))
  const lista = estudio?.parentElement?.querySelector(".room-voice-members")
  return lista ? lista.innerText : ""
})
verificar("e a lista da Ana ja a mostra la dentro", /Carla/.test(presentesEstudio), JSON.stringify(presentesEstudio))

// The edge case: Rui cannot move anyone at all. We check the whole list, not by
// name, the profile of someone who just arrived may not have reached him yet,
// and the row shows by address.
const arrastaveisDoRui = await b.page.evaluate(() =>
  [...document.querySelectorAll(".room-voice-members li")].filter((li) => li.getAttribute("draggable") === "true").length,
)
verificar("quem nao tem a responsabilidade nem consegue pegar em ninguem", arrastaveisDoRui === 0)

// ------------------------------------------------------------------ fim
for (const cliente of [a, b, c]) {
  if (cliente.erros.length > 0) {
    console.log(`\n  erros de pagina em ${cliente.nome}:`)
    for (const erro of cliente.erros) console.log(`    ${erro}`)
    falhas.push(`erros de pagina em ${cliente.nome}`)
  }
}

console.log(`\n${falhas.length === 0 ? "TUDO OK" : `FALHAS (${falhas.length}):`}`)
for (const falha of falhas) console.log(`  - ${falha}`)
for (const cliente of [a, b, c]) await cliente.ctx.close()
process.exit(falhas.length === 0 ? 0 : 1)
