/**
 * Who sees a category: the three paths, live, with three accounts.
 *
 * None of this is mocked. Three accounts in the main room of a LOCAL server, the
 * MLS group for real, and category declarations traveling encrypted between them.
 * What we prove is not that the sheet draws well, that has unit tests, but that
 * the choice made on one account actually changes what the other two see in the
 * sidebar.
 *
 *   Ana   founds the channel and administers. Administrator, and has no role declared.
 *   Rui   regular member. He gets the role midway, so we can see his list change
 *         without touching anything else.
 *   Carla regular member, and stays that way. She is the witness: it is her screen
 *         where we read the effect of each restriction.
 *
 * The four paths:
 *
 *   1. Everyone        , whoever has no role sees the category and the rooms.
 *   2. Administration only, whoever does not administer sees neither the category
 *                            nor the rooms; whoever administers sees them.
 *   3. Specific roles   , whoever has the role sees it; whoever does not, does not;
 *                          and whoever administers always sees, even without the role.
 *   4. Create the role from inside the sheet, give it to them, and they start to see.
 *
 *   sh scripts/dev-reiniciar-servidor.sh   # port 8452, clean database
 *   npm run dev:web
 *   node scripts/verificar-visibilidade-categoria.mjs
 */
import { chromium } from "playwright"
import { criarContaEEntrar } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const APP = comLingua(process.env.ORWELL_APP ?? "http://127.0.0.1:5173")
const SERVIDOR = process.env.ORWELL_SERVER ?? "localhost:8452"
const FRASE = "verificacao-categorias-2026"
const MARCA = Date.now().toString(36)
const CATEGORIA = "Direccao"
const SALA = "actas"

const falhas = []
function verificar(descricao, condicao) {
  console.log(`  ${condicao ? "ok  " : "FALHA"}  ${descricao}`)
  if (!condicao) falhas.push(descricao)
}

async function abrir(indice, nome) {
  const ctx = await chromium.launchPersistentContext(`/tmp/orwell-categorias/${MARCA}-${indice}`, {
    headless: true,
    viewport: { width: 1280, height: 900 },
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

/** The names of the categories this account sees in the sidebar right now. */
async function categoriasVisiveis(page) {
  return page.locator(".category-name").allInnerTexts()
}

/** The names of the rooms this account sees in the sidebar right now. */
async function salasVisiveis(page) {
  return page.locator(".room-name").allInnerTexts()
}

/**
 * Wait for someone's sidebar to reach the expected state.
 *
 * Declarations travel encrypted and arrive when they arrive: asserting right away
 * gives a test that fails by haste and passes by luck. The limit is generous on
 * purpose, and whoever fails speaks up.
 */
async function esperarCategoria(page, presente, limiteSegundos = 45) {
  const limite = Date.now() + limiteSegundos * 1000
  for (;;) {
    const vistas = await categoriasVisiveis(page)
    if (vistas.includes(CATEGORIA) === presente) return true
    if (Date.now() > limite) return false
    await page.waitForTimeout(1500)
  }
}

/** Open the "Who sees this category" sheet from the right-click menu. */
async function abrirVisibilidade(page) {
  const cabecalho = page.locator(".category-name").filter({ hasText: CATEGORIA }).first()
  await cabecalho.click({ button: "right" })
  await page.getByRole("menuitem", { name: "Quem vê esta categoria" }).first().click()
  await page.getByRole("dialog").waitFor({ timeout: 10_000 })
  await page.waitForTimeout(500)
}

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

// ------------------------------------------------------------------ montar
console.log("\n=== a Ana cria a categoria e uma sala dentro dela ===")
await a.page.locator("button.channel").first().click({ button: "right" })
await a.page.getByRole("menuitem", { name: "Nova categoria" }).first().click()
await a.page.getByRole("dialog").getByLabel("Nome").fill(CATEGORIA)
await a.page.getByRole("dialog").getByRole("button", { name: "Criar" }).click()
await a.page.waitForTimeout(2000)

await a.page.locator("button.channel").first().click({ button: "right" })
await a.page.getByRole("menuitem", { name: "Nova sala" }).first().click()
const folhaSala = a.page.getByRole("dialog")
await folhaSala.getByLabel("Nome").fill(SALA)
await folhaSala.getByLabel("Categoria").fill(CATEGORIA)
await folhaSala.getByRole("button", { name: "Criar" }).click()
await a.page.waitForTimeout(2500)

verificar("a Ana ve a categoria que acabou de criar", (await categoriasVisiveis(a.page)).includes(CATEGORIA))
verificar("e a sala dentro dela", (await salasVisiveis(a.page)).includes(SALA))

// ----------------------------------------------------------- 1. everyone
console.log("\n=== CAMINHO 1: todos — sem restricao, quem nao tem papel nenhum ve ===")
verificar("a Carla, sem papel nenhum, ve a categoria", await esperarCategoria(c.page, true))
verificar("e ve a sala dela", (await salasVisiveis(c.page)).includes(SALA))
verificar("o Rui tambem", await esperarCategoria(b.page, true))

// The open choice must READ the state, not just write it.
await abrirVisibilidade(a.page)
const folha = a.page.getByRole("dialog")
verificar('a folha abre em "Todos", que e o caso normal', await folha.getByLabel("Todos").isChecked())
verificar("e diz que sao todos os membros do canal", (await folha.getByText("Todos os membros do canal").count()) > 0)

// -------------------------------------------------- 2. so administracao
console.log("\n=== CAMINHO 2: so quem administra ===")
await folha.getByLabel("Só quem administra").check()
verificar(
  "a folha conta as salas que saem da lista de quem nao administra",
  (await folha.getByText(/n[aã]o administrar o canal/i).count()) > 0,
)
await folha.getByRole("button", { name: "Guardar" }).click()
await a.page.waitForTimeout(2500)

verificar("a Ana, que administra, continua a ver a categoria", (await categoriasVisiveis(a.page)).includes(CATEGORIA))
verificar("e continua a ver a sala — senao escondia-se de si propria", (await salasVisiveis(a.page)).includes(SALA))
verificar("a Carla deixa de ver a categoria", await esperarCategoria(c.page, false))
verificar("e deixa de ver a sala dela", !(await salasVisiveis(c.page)).includes(SALA))
verificar("o Rui, que tambem nao administra, deixa de ver", await esperarCategoria(b.page, false))

// ------------------------------------- 3 and 4. roles, created from inside
console.log("\n=== CAMINHOS 3 e 4: papeis especificos, criados de dentro da folha ===")
await abrirVisibilidade(a.page)
const folha2 = a.page.getByRole("dialog")
verificar('a folha reabre em "So quem administra"', await folha2.getByLabel("Só quem administra").isChecked())

await folha2.getByLabel("Cargos específicos").check()
verificar("com papeis, ha onde criar um sem sair daqui", (await folha2.getByLabel("Nome do cargo").count()) > 0)
await folha2.getByLabel("Nome do cargo").fill("Guardas")
await folha2.getByRole("button", { name: "Criar cargo" }).click()
await a.page.waitForTimeout(2500)

const caixaGuardas = folha2.getByLabel("Guardas")
verificar("o papel novo aparece na folha", (await caixaGuardas.count()) > 0)
verificar("e entra ja marcado — foi criado PARA esta categoria", await caixaGuardas.isChecked())
await folha2.getByRole("button", { name: "Guardar" }).click()
await a.page.waitForTimeout(2500)

verificar("a Ana ve a categoria SEM ter o papel, porque administra", (await categoriasVisiveis(a.page)).includes(CATEGORIA))
verificar("e ve a sala dela", (await salasVisiveis(a.page)).includes(SALA))
verificar("o Rui, sem o papel, nao ve", await esperarCategoria(b.page, false))
verificar("a Carla, sem o papel, nao ve", await esperarCategoria(c.page, false))

// --------------------------------------------------- 4. dar o papel
console.log("\n=== CAMINHO 4: dar o papel ao Rui, e o Rui passar a ver ===")
const linhaRui = a.page.locator(".member-row").filter({ hasText: "Rui" }).first()
const limiteRui = Date.now() + 60_000
for (;;) {
  if ((await linhaRui.count()) > 0) break
  if (Date.now() > limiteRui) break
  await a.page.waitForTimeout(2000)
}
await linhaRui.click()
await a.page.waitForTimeout(1500)
const caixaNoPerfil = a.page.getByRole("dialog").getByLabel("Guardas")
verificar("o perfil do Rui tem o papel para lhe dar", (await caixaNoPerfil.count()) > 0)
await caixaNoPerfil.focus()
await a.page.keyboard.press(" ")
await a.page.waitForTimeout(3000)
await a.page.keyboard.press("Escape")

verificar("o Rui passa a ver a categoria", await esperarCategoria(b.page, true, 60))
verificar("e passa a ver a sala dela", (await salasVisiveis(b.page)).includes(SALA))
verificar("a Carla continua sem ver — o papel e dele, nao do canal", !(await categoriasVisiveis(c.page)).includes(CATEGORIA))

// ------------------------------------------------- back to everyone
console.log('\n=== o caminho de volta: "Todos" levanta a restricao ===')
await abrirVisibilidade(a.page)
const folha3 = a.page.getByRole("dialog")
verificar('a folha reabre em "Papeis especificos"', await folha3.getByLabel("Cargos específicos").isChecked())
verificar("com o papel escolhido marcado", await folha3.getByLabel("Guardas").isChecked())
await folha3.getByLabel("Todos").check()
await folha3.getByRole("button", { name: "Guardar" }).click()
await a.page.waitForTimeout(2500)

verificar("a Carla volta a ver a categoria", await esperarCategoria(c.page, true))
verificar("e volta a ver a sala", (await salasVisiveis(c.page)).includes(SALA))

// ------------------------------------------------- renomear leva a restricao
/**
 * Renaming a category once lost a restriction silently.
 *
 * It was fixed, and there is a test. What we prove here is the NEW case: the
 * "administration only" marker is not a declared channel role, it is a path that
 * rebuilt the list from declared roles and threw it away without saying, the
 * category went back to being for everyone because we changed its name.
 */
console.log("\n=== mudar o nome nao levanta a restricao ===")
await abrirVisibilidade(a.page)
const folha4 = a.page.getByRole("dialog")
await folha4.getByLabel("Só quem administra").check()
await folha4.getByRole("button", { name: "Guardar" }).click()
await a.page.waitForTimeout(2500)
verificar("a Carla deixa de ver, outra vez", await esperarCategoria(c.page, false))

const NOVO_NOME = "Direccao Geral"
await a.page.locator(".category-name").filter({ hasText: CATEGORIA }).first().click({ button: "right" })
await a.page.getByRole("menuitem", { name: "Mudar o nome da categoria" }).first().click()
// Since phase 2A the name changes in the house Prompt, not in a window.prompt.
await a.page.locator("form.prompt input").first().fill(NOVO_NOME)
await a.page.locator("form.prompt button.primary").first().click()
await a.page.waitForTimeout(3000)

verificar("a Ana ve a categoria com o nome novo", (await categoriasVisiveis(a.page)).includes(NOVO_NOME))
const limiteNome = Date.now() + 45_000
for (;;) {
  const dela = await categoriasVisiveis(c.page)
  if (!dela.includes(CATEGORIA) && !dela.includes(NOVO_NOME) && (await salasVisiveis(c.page)).length > 0) break
  if (Date.now() > limiteNome) break
  await c.page.waitForTimeout(1500)
}
const carlaDepois = await categoriasVisiveis(c.page)
verificar("a Carla nao ve a categoria renomeada — a restricao foi atras do nome", !carlaDepois.includes(NOVO_NOME))
verificar("nem sobra a antiga na lista dela", !carlaDepois.includes(CATEGORIA))
verificar("e a sala continua escondida dela", !(await salasVisiveis(c.page)).includes(SALA))

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
