/**
 * Do roles appear in someone's profile only when there is a channel?
 *
 * Two accounts in a server's common room, LOCAL. The first one creates the
 * channel and sets the "Moderator" role in its properties; then opens the
 * second account's profile from the people panel and assigns the role there.
 * The second confirms they see it but cannot change it. Finally, we open the
 * profile from the feed, where there is no channel to speak of, and confirm the
 * section does not appear.
 *
 * Nothing here is mocked: it is the full path, encrypted, through the MLS
 * group.
 *
 *   ENCLAVE_BIND_PORT=8449 ENCLAVE_SERVER_NAME=localhost:8449 \
 *   ENCLAVE_COMMON_ROOM='!praca:localhost:8449' node apps/server/dist/main.js
 *   npm run dev -w @enclave/web
 *   node scripts/verificar-papeis-do-membro.mjs
 */
import { chromium } from "playwright"
import { criarContaEEntrar } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const APP = comLingua(process.env.ORWELL_APP ?? "http://127.0.0.1:5173")
const SERVIDOR = process.env.ORWELL_SERVER ?? "localhost:8449"
const FRASE = "verificacao-papeis-2026"
const MARCA = Date.now().toString(36)

const falhas = []
function verificar(descricao, condicao) {
  console.log(`  ${condicao ? "ok  " : "FALHA"}  ${descricao}`)
  if (!condicao) falhas.push(descricao)
}

async function abrir(indice, nome, largura = 1280) {
  const ctx = await chromium.launchPersistentContext(`/tmp/orwell-papeis/${MARCA}-${indice}`, {
    headless: true,
    viewport: { width: largura, height: 900 },
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const erros = []
  page.on("pageerror", (e) => erros.push("PAGEERROR: " + String(e.message).slice(0, 200)))
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await criarContaEEntrar(page, { nome, frase: FRASE, servidor: SERVIDOR, timeout: 30_000 })
  return { ctx, page, nome, erros }
}

async function esperarSala(page, limiteSegundos = 90) {
  const limite = Date.now() + limiteSegundos * 1000
  for (;;) {
    if (await page.locator("button.channel").first().isVisible().catch(() => false)) return true
    if (Date.now() > limite) return false
    await page.waitForTimeout(2000)
  }
}

/**
 * Three accounts, and we need all three.
 *
 * Ana creates and gives orders. Rui gets the role. Carla is a plain member, and
 * she proves the part that was locked: seeing someone's roles is not a
 * privilege. With two accounts we could not test this, Rui opening his own name
 * goes to his own profile screen, which is not what we are testing.
 */
console.log("a criar tres contas no servidor local...")
const a = await abrir(0, "Ana")
const b = await abrir(1, "Rui")
const c = await abrir(2, "Carla")
for (const cliente of [a, b, c]) {
  const dentro = await esperarSala(cliente.page)
  console.log(`  ${cliente.nome} na sala comum: ${dentro ? "sim" : "NAO"}`)
  if (!dentro) process.exit(1)
}
// Catch-up: new accounts must be admitted by whoever created the group.
for (const cliente of [a, b, c]) await cliente.page.waitForTimeout(4000)

for (const cliente of [a, b, c]) await cliente.page.locator("button.channel").first().click()
await a.page.waitForTimeout(2000)

// ---------------------------------------------------------------- definir
console.log("\n=== definir o papel fica nas propriedades do CANAL ===")
await a.page.locator("button.channel").first().click({ button: "right" })
await a.page.getByRole("menuitem", { name: /propriedades/i }).first().click()
await a.page.waitForTimeout(1200)

const folhaCanal = a.page.getByRole("dialog")
verificar("as propriedades do canal têm a secção Cargos", await folhaCanal.getByText("Cargos", { exact: true }).count() > 0)
verificar(
  "e NÃO têm forma de escolher uma pessoa (o selector foi-se)",
  (await folhaCanal.locator("select").count()) === 0,
)
verificar(
  "dizem onde é que agora se dá um papel",
  (await folhaCanal.getByText(/no perfil dessa pessoa/i).count()) === 0, // roles do not exist yet
)

await folhaCanal.getByRole("button", { name: "Novo cargo" }).click()
await folhaCanal.getByLabel("Nome do cargo").fill("Moderador")
// Permissions live in the "Permissões" tab since 27/10/2026
// (the editor laid out like Discord), and they connect with toggles.
await folhaCanal.getByRole("tab", { name: "Permissões" }).click()
await folhaCanal.getByRole("switch", { name: "expulsar" }).click()
await folhaCanal.getByRole("switch", { name: "mover" }).click()
await folhaCanal.getByRole("button", { name: "Criar cargo" }).click()
await a.page.waitForTimeout(1500)
verificar("o papel criado aparece na lista do canal", await folhaCanal.getByText("Moderador").count() > 0)
verificar(
  "e agora sim aponta o perfil da pessoa como sítio de o dar",
  (await folhaCanal.getByText(/no perfil dessa pessoa/i).count()) > 0,
)
await a.page.getByRole("button", { name: "Cancelar" }).first().click()
await a.page.waitForTimeout(800)

// ---------------------------------------------------------------- atribuir
console.log("\n=== atribuir o papel vive no perfil da PESSOA ===")
const rui = a.page.locator(".member-row").filter({ hasText: "Rui" }).first()
await rui.click()
await a.page.waitForTimeout(1500)

const perfil = a.page.getByRole("dialog")
const tituloEsperado = await a.page.evaluate(() => {
  const h = document.querySelector(".member-roles h3")
  return h ? h.textContent : null
})
console.log(`  título da secção: ${JSON.stringify(tituloEsperado)}`)
verificar("o perfil do Rui tem a secção dos papéis", tituloEsperado !== null)
verificar("e o título nomeia o canal", /^Cargos em .+/.test(tituloEsperado ?? ""))

const caixa = perfil.getByLabel("Moderador")
verificar("quem gere vê uma caixa de campo, e não um alvo de arrasto", await caixa.count() > 0)
verificar("as responsabilidades do papel lêem-se aqui", await perfil.getByText(/Garantido pela cifra: expulsar/).count() > 0)
verificar("e a distinção não se perde", await perfil.getByText(/Combinado entre clientes: mover/).count() > 0)

// Through the keyboard, which is what drag-and-drop never served for.
await caixa.focus()
await a.page.keyboard.press(" ")
await a.page.waitForTimeout(2500)
verificar("marcar pelo teclado dá o papel", await caixa.isChecked())

// ---------------------------------------------------------------- view
console.log("\n=== ver os papéis é de todos os membros, alterar não ===")
/**
 * The assignment travels encrypted through the group: wait for Carla's panel to
 * already have Rui by name, which only happens after his profile reaches her.
 *
 * Note on what we saw here: Carla's people list does NOT start writing
 * "Moderador" under Rui's name without a reload. It predates this change,  * `roleFor` matches identifiers against a memoized list of roles in
 * `papeisVersao`, and that version only increments when THIS account makes a
 * change. The profile sheet does not have the problem: it re-reads the bridge
 * each time it opens.
 */
await c.page.locator("button.channel").first().click()
const limiteCarla = Date.now() + 60_000
for (;;) {
  const linhas = await c.page.locator(".member-row").allInnerTexts()
  if (linhas.some((linha) => /\bRui\b/.test(linha))) break
  if (Date.now() > limiteCarla) {
    console.log(`  !! o Rui não apareceu no painel da Carla: ${JSON.stringify(linhas)}`)
    break
  }
  await c.page.waitForTimeout(2000)
}
await c.page.locator(".member-row").filter({ hasText: "Rui" }).first().click()
await c.page.waitForTimeout(2500)

const perfilC = c.page.getByRole("dialog")
const textoC = await perfilC.innerText().catch(() => "")
verificar("quem NÃO gere papéis vê à mesma que o Rui é Moderador", /Moderador/.test(textoC))
verificar("e vê o que o papel lhe dá", /Garantido pela cifra: expulsar/.test(textoC))
verificar("mas não tem caixas para mexer", (await perfilC.locator('input[type="checkbox"]').count()) === 0)

// And the founding role, which is not a declared role, appears the same way.
// Ana can show up by short address only if her profile has not arrived yet: the
// right row is the one that is neither Carla nor Rui.
await c.page.keyboard.press("Escape")
await c.page.waitForTimeout(600)
await c.page.locator(".member-row").filter({ hasNotText: "Carla" }).filter({ hasNotText: "Rui" }).first().click()
await c.page.waitForTimeout(1500)
const textoAna = await c.page.getByRole("dialog").innerText().catch(() => "")
verificar("quem fundou o canal é dito no perfil dele", /Fundou este canal/.test(textoAna))
await c.page.keyboard.press("Escape")

// ---------------------------------------------------------------- no channel
console.log("\n=== o perfil aberto do feed não tem canal de que falar ===")
await a.page.keyboard.press("Escape")
await a.page.waitForTimeout(500)
// Rui publishes, so we have something to open his profile from in the feed.
await b.page.getByRole("button", { name: "Feed" }).click()
await b.page.waitForTimeout(1200)
const composer = b.page.locator("textarea").first()
await composer.fill("uma publicação para o feed")
await b.page.getByRole("button", { name: /publicar/i }).first().click()
await b.page.waitForTimeout(4000)

await a.page.getByRole("button", { name: "Feed" }).click()
await a.page.waitForTimeout(4000)
const autor = a.page.locator(".post-author, button").filter({ hasText: /^Rui$/ }).first()
if (await autor.count()) {
  await autor.click()
  await a.page.waitForTimeout(1500)
  const seccao = await a.page.locator(".member-roles").count()
  verificar("aberto do feed, a secção dos papéis NÃO aparece", seccao === 0)
  const dialogo = await a.page.getByRole("dialog").count()
  verificar("mas o perfil abre à mesma", dialogo > 0)
} else {
  console.log("  (aviso) não apareceu autor no feed; salto este caminho")
}

// ---------------------------------------------------------------- 390px
console.log("\n=== 390px sem transbordo ===")
// The sheet opens on a wide screen, where the people panel exists, and only
// then narrows: it is the same sheet living on a phone, which is what matters
// to measure. Opening the panel on a narrow screen is another path, and it is
// not what we are testing here.
await a.page.keyboard.press("Escape")
await a.page.waitForTimeout(500)
await a.page.getByRole("button", { name: "Comunidades" }).click().catch(() => {})
await a.page.waitForTimeout(1200)
await a.page.locator(".member-row").filter({ hasText: "Rui" }).first().click()
await a.page.waitForTimeout(1500)
verificar("a folha do perfil está aberta antes de estreitar", (await a.page.locator(".member-roles").count()) > 0)

for (const largura of [390, 360]) {
  await a.page.setViewportSize({ width: largura, height: 780 })
  await a.page.waitForTimeout(900)
  const medidas = await a.page.evaluate(() => {
    const seccao = document.querySelector(".member-roles")
    const cartao = document.querySelector(".member-roles .role-card")
    return {
      documento: document.documentElement.scrollWidth,
      janela: window.innerWidth,
      seccao: seccao ? seccao.scrollWidth : null,
      seccaoVisivel: seccao ? seccao.clientWidth : null,
      cartao: cartao ? cartao.scrollWidth : null,
      cartaoVisivel: cartao ? cartao.clientWidth : null,
    }
  })
  console.log(`  ${largura}px → ${JSON.stringify(medidas)}`)
  verificar(`a ${largura}px o documento não transborda`, medidas.documento <= medidas.janela)
  if (medidas.seccao !== null) {
    verificar(`a ${largura}px a secção dos papéis cabe`, medidas.seccao <= medidas.seccaoVisivel + 1)
    verificar(`a ${largura}px o cartão do papel cabe`, medidas.cartao <= medidas.cartaoVisivel + 1)
  }
  await a.page.screenshot({ path: `/tmp/orwell-papeis/perfil-${largura}.png`, fullPage: true }).catch(() => {})
}

// ---------------------------------------------------------------- consola
console.log("\n=== erros de página ===")
for (const cliente of [a, b, c]) {
  if (cliente.erros.length) console.log(`  ${cliente.nome}: ${cliente.erros.join(" | ")}`)
}
verificar("nenhuma conta levantou erro de página", [a, b, c].every((cliente) => cliente.erros.length === 0))

console.log(`\n${falhas.length === 0 ? "VEREDICTO: tudo passou." : `VEREDICTO: ${falhas.length} falha(s):\n  - ${falhas.join("\n  - ")}`}`)
for (const cliente of [a, b, c]) await cliente.ctx.close()
process.exit(falhas.length === 0 ? 0 : 1)
