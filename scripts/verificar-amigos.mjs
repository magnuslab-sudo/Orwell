// Live test of Friends destination, with two real accounts.
//
// A direct chat can't prove itself alone. You need someone on the other end to
// have a chat, for the column to have something to list, and for the person's
// menu to have a person. Two separate Chromium persistent contexts give two
// separate IndexedDB stores. That's what makes them two accounts, not two windows
// of the same one.
//
//   node scripts/verificar-amigos.mjs [webPort] [serverName]
import { chromium } from "playwright"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { criarConta } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const WEB = comLingua(`http://127.0.0.1:${process.argv[2] ?? "5199"}`)
const SERVIDOR = process.argv[3] ?? "localhost:8461"
const FRASE = "frase-de-teste-1234"

const resultados = []
function check(rotulo, ok, detalhe = "") {
  resultados.push([rotulo, ok])
  console.log(`${ok ? "PASS" : "FAIL"}  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
}

/** A new account, in its own browser profile. */
async function conta(nome, largura = 1280, altura = 900) {
  const dir = mkdtempSync(join(tmpdir(), `orwell-verif-${nome}-`))
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true,
    viewport: { width: largura, height: altura },
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`   [${nome}: erro de consola] ${m.text()}`)
  })
  await page.goto(WEB, { waitUntil: "domcontentloaded" })

  // The gate: one prompt at a time. Name, color, phrase, confirm.
  await criarConta(page, { nome, frase: FRASE, servidor: SERVIDOR })

  // The track is the sign you got in.
  await page.locator(".rail").waitFor({ timeout: 60_000 })
  const endereco = await page.evaluate(() => localStorage.getItem("enclave.address"))
  return { nome, ctx, page, endereco }
}

/** The account address, read from the ID card on the sidebar. */
async function enderecoDe(page) {
  const alvo = page.locator(".me-address, .sidebar-me .me-address").first()
  if ((await alvo.count()) > 0) {
    const texto = (await alvo.textContent())?.trim()
    if (texto) return texto
  }
  return await page.evaluate(() => {
    const el = document.querySelector("[title^='@']")
    return el?.getAttribute("title") ?? null
  })
}

const A = await conta("Ana")
const B = await conta("Bruno")
console.log(`Ana:   ${(await enderecoDe(A.page)) ?? "?"}`)
console.log(`Bruno: ${(await enderecoDe(B.page)) ?? "?"}`)
const enderecoB = await enderecoDe(B.page)
if (!enderecoB) throw new Error("não se conseguiu ler o endereço do Bruno")

// ---------------------------------------------------------------- Amigos
await A.page.getByRole("button", { name: "Amigos" }).click()
await A.page.locator(".people-destination").waitFor({ timeout: 15_000 })
check("o destino Amigos monta a coluna e a faixa", true)

check(
  "a faixa superior existe, com os separadores",
  (await A.page.locator(".people-bar .people-tabs .people-tab").count()) === 3,
)
check("a coluna das conversas existe", (await A.page.locator(".people-aside").count()) === 1)

// The column is to the left of the body, not on top of it. It's a column, not a drawer, while the screen is wide.
const caixaColuna = await A.page.locator(".people-aside").boundingBox()
const caixaFaixa = await A.page.locator(".people-bar").boundingBox()
check(
  "em ecrã largo a coluna fica ao lado, e a faixa por cima do corpo",
  caixaColuna.x < caixaFaixa.x && caixaFaixa.y <= caixaColuna.y + 4,
  `coluna x=${Math.round(caixaColuna.x)} faixa x=${Math.round(caixaFaixa.x)}`,
)

// ------------------------------------------- A opens chat with B (friendship)
// Through the real path: "Find" accepts a pasted address.
await A.page.getByRole("button", { name: "Encontrar", exact: true }).click()
const caixaEndereco = A.page.getByLabel("Cola um link ou endereço")
await caixaEndereco.fill(enderecoB)
await A.page.getByRole("button", { name: "Abrir perfil" }).click()
// The address opens the profile sheet; the request is made there, with the single button.
await A.page.locator(".person-profile").getByRole("button", { name: "Pedir amizade" }).click()
// The sheet stays open after the request and covers the page: close it.
await A.page.keyboard.press("Escape")
await A.page.waitForTimeout(6000)

// The chat must be in the column, and the open chat in the middle.
const linhas = await A.page.locator(".people-aside .direct-row").count()
check("a conversa directa aparece na coluna de Amigos", linhas >= 1, `${linhas} linha(s)`)

// Open the chat from the column. That's the gesture the owner asked for: "the chat should open in Friends on the sidebar".
await A.page.locator(".people-aside .direct-row .direct-open").first().click()
await A.page.waitForTimeout(2500)

// The chat opened INSIDE Friends, not in the chat destination. The write box living under the banner proves it.
check(
  "a caixa de escrita da conversa está dentro do destino Amigos",
  (await A.page.locator(".people-column .chat-composer").count()) >= 1,
)
check("a faixa não desapareceu com a conversa aberta", (await A.page.locator(".people-bar").count()) === 1)
// The banner sits ON TOP of the chat. That's the "top banner" that was requested.
const caixaEscrita = await A.page.locator(".people-column .chat-composer").first().boundingBox()
const faixaAcima = await A.page.locator(".people-bar").boundingBox()
check(
  "a faixa fica acima da conversa, e a conversa ocupa o espaço principal",
  faixaAcima.y + faixaAcima.height <= caixaEscrita.y,
  `faixa termina em ${Math.round(faixaAcima.y + faixaAcima.height)}, escrita começa em ${Math.round(caixaEscrita.y)}`,
)
// And we stay in Friends. The destination didn't change when the chat opened.
check(
  "continua-se em Amigos depois de abrir a conversa",
  (await A.page.locator(".people-destination").count()) === 1,
)

// ------------------------------------------------ B accepts, and they talk with links
await B.page.getByRole("button", { name: "Amigos" }).click()
await B.page.waitForTimeout(2000)
const aceitar = B.page.getByRole("button", { name: "Aceitar" })
if ((await aceitar.count()) === 0) {
  await B.page.getByRole("button", { name: /Pendentes/ }).click()
  await B.page.waitForTimeout(1500)
}
const temPedido = (await B.page.getByRole("button", { name: "Aceitar" }).count()) > 0
check("o pedido chega ao Bruno e vive no separador Pendentes", temPedido)
if (temPedido) {
  await B.page.getByRole("button", { name: "Aceitar" }).first().click()
  await B.page.waitForTimeout(8000)
}

// B opens the chat and writes a message with a web address.
await B.page.locator(".people-aside .direct-row .direct-open").first().click()
await B.page.waitForTimeout(1500)
const escrita = B.page.locator(".chat-composer input:not([type=file])").first()
await escrita.fill("olha isto https://example.com/artigo")
await escrita.press("Enter")
await B.page.waitForTimeout(6000)

// ------------------------------------------------------- links (Tarefa 2)
await A.page.waitForTimeout(3000)
const link = A.page.locator(".people-destination a.linkified").first()
const temLink = (await link.count()) > 0
check("o endereço web na conversa é um link clicável", temLink)
if (temLink) {
  check(
    "o link leva noopener e noreferrer",
    (await link.getAttribute("rel")) === "noopener noreferrer",
    (await link.getAttribute("rel")) ?? "sem rel",
  )
  check("o link abre em separador novo", (await link.getAttribute("target")) === "_blank")
}
// Never as rendered HTML. The text stays text, split into pieces.
const marcacaoInjectada = await A.page.evaluate(
  () => document.querySelectorAll(".timeline script, .timeline iframe").length,
)
check("nada de marcação interpretada na conversa", marcacaoInjectada === 0)

// -------------------------------------- context menu (Tasks 2 and 4)
const linha = A.page.locator(".people-aside .direct-row").first()
await linha.click({ button: "right" })
await A.page.locator(".context-menu").waitFor({ timeout: 5000 })
const itens = await A.page.locator(".context-menu [role=menuitem]").allTextContents()
console.log(`   menu da conversa: ${itens.join(" · ")}`)
check("o menu da conversa oferece Ver perfil", itens.includes("Ver perfil"))
check("o menu da conversa oferece Fechar conversa", itens.includes("Fechar conversa"))
check(
  "o menu da conversa NÃO oferece nada que apague o canal",
  !itens.includes("Eliminar canal") && !itens.includes("Sair do canal"),
)

// Right-click also works over the close button.
await A.page.keyboard.press("Escape")
await A.page.waitForTimeout(300)
await A.page.locator(".people-aside .direct-row .direct-close").first().click({ button: "right", force: true })
const menuNoFechar = (await A.page.locator(".context-menu").count()) > 0
check("o botão direito também abre o menu sobre o botão de fechar", menuNoFechar)
if (menuNoFechar) await A.page.keyboard.press("Escape")

// -------------------------------------------------- the profile opens (Task 4)
await A.page.waitForTimeout(300)
await linha.click({ button: "right" })
await A.page.locator(".context-menu").waitFor({ timeout: 5000 })
await A.page.locator(".context-menu [role=menuitem]", { hasText: "Ver perfil" }).first().click()
const folha = A.page.locator(".pagina-da-pessoa")
await folha.waitFor({ timeout: 8000 })
check('"Ver perfil" abre a página do perfil', true)

// --------------------------- no admin in a direct chat (Task 3)
const temPapeis = (await folha.locator(".member-roles").count()) > 0
check("a folha do perfil de uma directa NÃO tem secção de papéis", !temPapeis)
const textoFolha = await folha.innerText()
check(
  "a folha não fala de administrador nem de fundador",
  !/administrador/i.test(textoFolha) && !/fundou/i.test(textoFolha),
)
await A.page.locator(".pagina-da-pessoa").getByRole("button", { name: "Voltar", exact: true }).first().click()
await A.page.waitForTimeout(500)

// The person's menu from inside the direct chat: no admin controls.
const membro = A.page.locator(".members .member-row").first()
if ((await membro.count()) === 0) {
  const alternar = A.page.locator(".members-toggle").first()
  if ((await alternar.count()) > 0) await alternar.click()
  await A.page.waitForTimeout(600)
}
const membroVisivel = A.page.locator(".members .member-row").first()
if ((await membroVisivel.count()) > 0) {
  await membroVisivel.click({ button: "right" })
  await A.page.locator(".context-menu").waitFor({ timeout: 5000 })
  const itensPessoa = await A.page.locator(".context-menu [role=menuitem]").allTextContents()
  console.log(`   menu da pessoa (numa directa): ${itensPessoa.join(" · ")}`)
  check(
    "numa conversa directa o menu da pessoa NÃO oferece tornar administrador",
    !itensPessoa.includes("Tornar administrador") && !itensPessoa.includes("Deixar de ser administrador"),
  )
  check("e continua a oferecer Ver perfil", itensPessoa.includes("Ver perfil"))
  await A.page.keyboard.press("Escape")
} else {
  check("painel de membros alcançável para provar o menu da pessoa", false, "não se encontrou linha de membro")
}

// -------------------------------------------- close doesn't delete (Task 2)
const antes = await A.page.locator(".people-aside .direct-row").count()
await A.page.waitForTimeout(300)
await linha.click({ button: "right" })
await A.page.locator(".context-menu").waitFor({ timeout: 5000 })
await A.page.locator(".context-menu [role=menuitem]", { hasText: "Fechar conversa" }).first().click()
await A.page.waitForTimeout(1200)
const depois = await A.page.locator(".people-aside .direct-row").count()
check("fechar tira a conversa da lista", depois === antes - 1, `${antes} → ${depois}`)

// And it comes back when a message arrives. Nothing was deleted.
await B.page.locator(".chat-composer input:not([type=file])").first().fill("voltei")
await B.page.locator(".chat-composer input:not([type=file])").first().press("Enter")
await A.page.waitForTimeout(8000)
const voltou = await A.page.locator(".people-aside .direct-row").count()
check("a conversa VOLTA sozinha quando chega mensagem: fechar não apagou", voltou === antes, `${depois} → ${voltou}`)

// --------------------------------------------------- 390px, no overflow
await A.page.setViewportSize({ width: 390, height: 780 })
await A.page.waitForTimeout(1200)
const transbordo = await A.page.evaluate(() => ({
  doc: document.documentElement.scrollWidth,
  win: window.innerWidth,
}))
check(
  "a 390px nada transborda na horizontal",
  transbordo.doc <= transbordo.win + 1,
  `scrollWidth=${transbordo.doc} innerWidth=${transbordo.win}`,
)
// The column becomes a drawer: hidden, reachable by the banner's handle.
const colunaEstreita = await A.page.locator(".people-aside").boundingBox()
const pega = A.page.locator(".people-bar-conversas")
check("a 390px a coluna sai do caminho", colunaEstreita === null || colunaEstreita.x < 0, JSON.stringify(colunaEstreita))
check("a 390px há uma pega para as conversas na faixa", (await pega.count()) === 1 && (await pega.isVisible()))
await pega.click()
await A.page.waitForTimeout(700)
const gaveta = await A.page.locator(".people-aside.open").count()
check("a pega abre a gaveta das conversas", gaveta === 1)
const caixaGaveta = await A.page.locator(".people-aside").boundingBox()
check(
  "a gaveta aberta cabe no ecrã",
  caixaGaveta && caixaGaveta.x >= 0 && caixaGaveta.x + caixaGaveta.width <= 391,
  JSON.stringify(caixaGaveta),
)
// Picking a chat closes the drawer, like the channel bar does.
await A.page.locator(".people-aside .direct-row .direct-open").first().click()
await A.page.waitForTimeout(700)
check("escolher uma conversa fecha a gaveta", (await A.page.locator(".people-aside.open").count()) === 0)
const transbordoDepois = await A.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
check("e continua sem transbordo depois de abrir a conversa", transbordoDepois)

await A.page.screenshot({ path: "scripts/.verif-amigos-390.png" })
await A.page.setViewportSize({ width: 1280, height: 900 })
await A.page.waitForTimeout(800)
await A.page.screenshot({ path: "scripts/.verif-amigos-1280.png" })

// ------------------------------------------------------------------ fim
await A.ctx.close()
await B.ctx.close()

const falhas = resultados.filter(([, ok]) => !ok)
console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram`)
if (falhas.length > 0) {
  console.log("falhas:")
  for (const [rotulo] of falhas) console.log(`  - ${rotulo}`)
  process.exit(1)
}
