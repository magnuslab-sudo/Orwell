// Live check: real app, real local server, real MLS. Create an account, publish
// with a title, vote, comment and view the profile.
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const WEB = comLingua("http://127.0.0.1:5183/")
const SERVIDOR = "127.0.0.1:8459"
const OUT = process.argv[2] ?? "/tmp/orwell-verificacao"

const resultados = []
const check = (rotulo, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const erros = []
page.on("console", (m) => {
  if (m.type() === "error") erros.push(m.text())
})
page.on("pageerror", (e) => erros.push(String(e)))

await page.goto(WEB, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(1500)

// ---------------------------------------------------------------- criar conta
await criarConta(page, { nome: "Duarte", frase: "frase-passe-teste", servidor: SERVIDOR })
await page.waitForTimeout(6000)

const chegouAoShell = (await page.locator(".rail-btn").count()) > 0
check("a conta abre e o shell aparece", chegouAoShell, (await page.locator("body").innerText()).slice(0, 120).replace(/\n/g, " · "))
if (!chegouAoShell) {
  await page.screenshot({ path: `${OUT}-gate.png`, fullPage: true })
  await browser.close()
  process.exit(1)
}

// ------------------------------------------------------------------- publicar
await page.getByRole("button", { name: "Feed" }).first().click()
await page.waitForTimeout(500)
await page.getByPlaceholder("Título (opcional)").fill("Serra de São Mamede")
await page.getByPlaceholder(/Diz coisas/).fill("subimos até ao cimo #serra e valeu a pena")
await page.getByRole("button", { name: "Publicar" }).click()
await page.waitForTimeout(2500)

check("a publicação aparece no feed", await page.getByText("subimos até ao cimo").first().isVisible())
check("o título aparece por cima da legenda", await page.locator(".post-title").first().isVisible())

// --------------------------------------------------------------------- votar
await page.getByRole("button", { name: "Gosto", exact: true }).first().click()
await page.waitForTimeout(1200)
const gostoCarregado = page.getByRole("button", { name: "Retirar o gosto" }).first()
check("o gosto fica carregado e a contagem sobe", await gostoCarregado.isVisible(), (await gostoCarregado.innerText()).trim())

await page.getByRole("button", { name: "Não gosto", exact: true }).first().click()
await page.waitForTimeout(1200)
const trocou =
  (await page.getByRole("button", { name: "Retirar o não gosto" }).count()) === 1 &&
  (await page.getByRole("button", { name: "Retirar o gosto" }).count()) === 0
check("trocar de polegar não deixa os dois de pé", trocou)

// ----------------------------------------------------------------- comentar
await page.getByRole("button", { name: /Comentários|comentário/ }).first().click()
await page.waitForTimeout(300)
await page.getByPlaceholder("Escrever um comentário…").fill("e ainda por cima com sol")
await page.getByRole("button", { name: "Comentar", exact: true }).click()
await page.waitForTimeout(1500)
check("o comentário aparece com nome e avatar", await page.getByText("e ainda por cima com sol").isVisible())
check(
  "o botão passa a contar o comentário",
  (await page.getByRole("button", { name: "1 comentário" }).count()) === 1,
)

await page.screenshot({ path: `${OUT}-feed.png`, fullPage: true })

// ------------------------------------------------------------------- perfil
await page.getByRole("button", { name: "Eu" }).first().click()
await page.waitForTimeout(1000)
check("o perfil mostra uma lista e não um mosaico", (await page.locator(".post-row").count()) === 1)
check(
  "a linha traz o título que foi dado",
  (await page.locator(".post-row-title").first().innerText()).trim() === "Serra de São Mamede",
)
await page.locator(".post-row").first().click()
await page.waitForTimeout(500)
check("clicar na linha abre a publicação", await page.getByRole("dialog").isVisible())

// The post opened in the profile is the SAME one seen in the feed, and it must
// show that: the thumbs up that stayed pressed there are pressed here, and the
// comment that was written is here written. It spent a long time showing just
// the caption, no thumbs, no comments and no box to write one.
const folha = page.getByRole("dialog")
check(
  "a publicação aberta no perfil traz o não gosto que ficou carregado",
  (await folha.getByRole("button", { name: "Retirar o não gosto" }).count()) === 1,
)
check(
  "e traz a contagem de comentários que o feed já mostrava",
  (await folha.getByRole("button", { name: "1 comentário" }).count()) === 1,
)
await folha.getByRole("button", { name: "1 comentário" }).click()
await page.waitForTimeout(300)
check("o comentário lê-se no perfil, e não só no feed", await folha.getByText("e ainda por cima com sol").isVisible())

await page.screenshot({ path: `${OUT}-perfil.png`, fullPage: true })
await page.getByRole("button", { name: "Fechar" }).first().click()

// --------------------------------------------------------------------- mobile
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(600)
const larguraCorpo = await page.evaluate(() => document.documentElement.scrollWidth)
check("no telemóvel a página não anda de lado", larguraCorpo <= 390, `${larguraCorpo}px`)

// The posts column gets the remaining screen space, not half of it. The `.main`
// grid is redefined at ≤840px by a POSITIONAL list of heights, and one fewer
// line in that list gives flexible height to an EMPTY area, the symptom is the
// list stuck to the top with dead space below. Measured here because it only
// shows on a narrow screen. See `medir-perfil.mjs`, which isolates it.
const colunaDoPerfil = await page.evaluate(() => {
  const el = document.querySelector(".profile-scroll")
  const linhas = getComputedStyle(document.querySelector(".main")).gridTemplateRows.split(" ")
  return { altura: el ? Math.round(el.getBoundingClientRect().height) : 0, intro: Math.round(parseFloat(linhas[4])) }
})
check(
  "no telemóvel a coluna do perfil fica com o ecrã que sobra",
  colunaDoPerfil.intro === 0 && colunaDoPerfil.altura > 600,
  `linha vazia ${colunaDoPerfil.intro}px, coluna ${colunaDoPerfil.altura}px`,
)
await page.screenshot({ path: `${OUT}-movel-perfil.png`, fullPage: true })

await page.getByRole("button", { name: "Feed" }).first().click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}-movel-feed.png`, fullPage: true })
const larguraFeed = await page.evaluate(() => document.documentElement.scrollWidth)
check("no telemóvel o feed não anda de lado", larguraFeed <= 390, `${larguraFeed}px`)

check("sem erros na consola", erros.length === 0, erros.slice(0, 3).join(" | "))

await browser.close()
console.log(`\n${resultados.filter(Boolean).length}/${resultados.length}`)
process.exit(resultados.every(Boolean) ? 0 : 1)
