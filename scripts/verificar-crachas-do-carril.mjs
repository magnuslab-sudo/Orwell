/**
 * The rail badges, live and with ruler.
 *
 * Tree tests prove what we COUNT, that a mention lights the number, that any
 * conversation doesn't, that going to Feed clears it. What they cannot prove is
 * what this script measures, because JSDOM has no layout: that the number does not
 * push the icon, that it stays in the 60-pixel column, and that it still fits on
 * a phone.
 *
 * It was precisely because there is no layout that an empty column survived 1313
 * tests, it is written in `medir-destinos.mjs`, and the lesson applies here.
 *
 * **What is measured, and why each one:**
 *
 * 1. The icon center with and without badge. A badge in the flow pushed the
 *    design to the side, and an icon that jumps when a message arrives is worse
 *    than no warning at all.
 * 2. The badge inside the column. It sits at the button corner and sticks out
 *    on purpose; what it cannot do is leave the bar, where it would sit over
 *    content or be cut by the edge.
 * 3. The bar width at 1280 and at 390. If the badge widened it, it widened the
 *    entire app.
 * 4. The page without horizontal scroll at both widths.
 * 5. Font size and shape height at 390, which is where readability is decided.
 *
 * And it measures the behavior that gives the number meaning: **it vanishes when
 * handled.** A friend request lights Friends; accepting it clears it.
 *
 * Geometry is read by `getBoundingClientRect` and `getComputedStyle` on simple
 * properties, never by regex on modern values (`color-mix`, `clamp`), those
 * return garbage to whoever tries to read them that way.
 *
 * Usage, with the dev server and Vite running:
 *   sh scripts/dev-reiniciar-servidor.sh &
 *   npm run dev:web &
 *   node scripts/verificar-crachas-do-carril.mjs
 *
 * LOCAL on purpose: creates throwaway accounts and sends friend requests.
 */
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { alvo, alvoApp, FRASE } from "./ambiente.mjs"

const URL_BASE = alvoApp(arg("--url"))
const SERVIDOR = alvo(arg("--servidor"))
const CORRIDA = `crachas-${Date.now().toString(36)}`

/**
 * The names of the destinations, as the rail calls them today.
 *
 * This is how the script reaches the buttons (`aria-label`), so renaming the rail
 * without renaming this breaks the entire script silently. The keys match the names
 * on purpose: a key `contactos` pointing to "Amigos" is the drift that the rename
 * on August 20, 2026 was meant to undo.
 */
const CARRIL = {
  eu: "Eu",
  comunidades: "Comunidades",
  feed: "Feed",
  amigos: "Amigos",
  config: "Configurações",
}

function arg(nome) {
  return process.argv.find((entrada) => entrada.startsWith(`${nome}=`))?.split("=").slice(1).join("=")
}

const resultados = []
function verificar(rotulo, ok, detalhe = "") {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FALHA"}  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
}

async function conta(nome, etiqueta, largura = 1280) {
  const ctx = await chromium.launchPersistentContext(`${process.cwd()}/.dev-data/${CORRIDA}-${etiqueta}`, {
    headless: true,
    viewport: { width: largura, height: 900 },
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  page.on("pageerror", (e) => console.log(`   [${nome}] PAGEERROR ${String(e.message).slice(0, 160)}`))
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome, frase: FRASE, servidor: SERVIDOR })
  await page.locator(".rail").waitFor({ timeout: 90_000 })
  return { nome, ctx, page }
}

const enderecoDe = (page) =>
  page.evaluate(() => {
    const el = document.querySelector(".me-address")
    return el?.getAttribute("title") ?? el?.textContent?.trim() ?? null
  })

/**
 * The geometry of a rail destination, with the badge if there is one.
 *
 * The icon is the button's `svg`, and we measure its CENTER: that is what has
 * to stay still. The bar box comes along because that is what decides if the
 * badge left the column.
 */
const medir = (page, destino) =>
  page.evaluate((nome) => {
    const botao = [...document.querySelectorAll(".rail-btn")].find(
      (b) => b.getAttribute("aria-label") === nome,
    )
    if (!botao) return null
    const caixa = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height, direita: r.right, esquerda: r.left }
    }
    const cracha = botao.querySelector(".rail-count")
    const icone = botao.querySelector("svg")
    const estilo = cracha ? getComputedStyle(cracha) : null
    return {
      botao: caixa(botao),
      icone: caixa(icone),
      cracha: caixa(cracha),
      texto: cracha?.textContent?.trim() ?? null,
      ponto: botao.querySelector(".rail-dot") !== null,
      descricao: (() => {
        const id = botao.getAttribute("aria-describedby")
        return id ? (document.getElementById(id)?.textContent?.trim() ?? null) : null
      })(),
      letra: estilo ? Number.parseFloat(estilo.fontSize) : null,
      barra: caixa(document.querySelector(".rail")),
      pagina: { rolagem: document.documentElement.scrollWidth, janela: window.innerWidth },
    }
  }, destino)

/** Send a friend request the real way: the address pasted in "Find". */
async function pedirAmizade(bot, endereco) {
  await bot.page.getByRole("button", { name: CARRIL.amigos, exact: true }).click()
  await bot.page.locator(".people-destination").waitFor({ timeout: 15_000 })
  await bot.page.getByRole("button", { name: "Encontrar", exact: true }).click()
  await bot.page.getByLabel("Cola um link ou endereço").fill(endereco)
  await bot.page.getByRole("button", { name: "Abrir perfil" }).click()
  // The address opens the profile sheet; the request is made there, with the single button.
  await bot.page.locator(".person-profile").getByRole("button", { name: "Pedir amizade" }).click()
  // The sheet stays open after the request and covers the page: close it.
  await bot.page.keyboard.press("Escape")
}

const centro = (caixa) => ({ x: caixa.x + caixa.w / 2, y: caixa.y + caixa.h / 2 })
const iguais = (a, b, folga = 0.5) => Math.abs(a - b) <= folga

async function principal() {
  console.log(`app=${URL_BASE}  servidor=${SERVIDOR}`)

  const ana = await conta("Ana", "ana")
  const bruno = await conta("Bruno", "bruno")
  const enderecoDoBruno = await enderecoDe(bruno.page)

  console.log("\n1) antes de acontecer nada: nenhum destino tem número")
  const antes = {}
  for (const [chave, nome] of Object.entries(CARRIL)) {
    antes[chave] = await medir(bruno.page, nome)
    verificar(`${nome} sem crachá`, antes[chave]?.cracha === null, antes[chave]?.texto ?? "")
  }

  console.log("\n2) a Ana manda um pedido de amizade: Amigos acende")
  await pedirAmizade(ana, enderecoDoBruno)
  await bruno.page.waitForTimeout(9000)
  const aceso = await medir(bruno.page, CARRIL.amigos)
  verificar("o número aparece por cima do ícone", aceso?.texto === "1", `texto=${aceso?.texto}`)
  verificar(
    "e vai por palavras a quem não vê o ecrã",
    aceso?.descricao === "1 por atender",
    `descrição=${aceso?.descricao}`,
  )

  console.log("\n3) e não empurra o ícone")
  const antesCentro = centro(antes.amigos.icone)
  const depoisCentro = centro(aceso.icone)
  verificar(
    "o centro do ícone não se mexeu",
    iguais(antesCentro.x, depoisCentro.x) && iguais(antesCentro.y, depoisCentro.y),
    `antes=(${antesCentro.x.toFixed(1)}, ${antesCentro.y.toFixed(1)}) depois=(${depoisCentro.x.toFixed(1)}, ${depoisCentro.y.toFixed(1)})`,
  )
  verificar(
    "e o botão continua com a mesma medida",
    iguais(antes.amigos.botao.w, aceso.botao.w) && iguais(antes.amigos.botao.h, aceso.botao.h),
    `${aceso.botao.w}×${aceso.botao.h}`,
  )

  console.log("\n4) e não sai da coluna, a 1280")
  verificar(
    "o crachá fica dentro da barra",
    aceso.cracha.esquerda >= aceso.barra.esquerda && aceso.cracha.direita <= aceso.barra.direita,
    `crachá [${aceso.cracha.esquerda.toFixed(1)}, ${aceso.cracha.direita.toFixed(1)}] barra [${aceso.barra.esquerda}, ${aceso.barra.direita}]`,
  )
  verificar("a barra continua com 60px", iguais(aceso.barra.w, 60), `${aceso.barra.w}px`)
  verificar(
    "e a página não ganhou rolagem horizontal",
    aceso.pagina.rolagem <= aceso.pagina.janela,
    `${aceso.pagina.rolagem} <= ${aceso.pagina.janela}`,
  )

  console.log("\n5) num telefone (390px), o mesmo")
  await bruno.page.setViewportSize({ width: 390, height: 844 })
  await bruno.page.waitForTimeout(600)
  const estreito = await medir(bruno.page, CARRIL.amigos)
  verificar("o número continua lá", estreito?.texto === "1", `texto=${estreito?.texto}`)
  verificar(
    "dentro da barra",
    estreito.cracha.esquerda >= estreito.barra.esquerda && estreito.cracha.direita <= estreito.barra.direita,
    `crachá [${estreito.cracha.esquerda.toFixed(1)}, ${estreito.cracha.direita.toFixed(1)}] barra [${estreito.barra.esquerda}, ${estreito.barra.direita}]`,
  )
  verificar("a barra continua com 60px", iguais(estreito.barra.w, 60), `${estreito.barra.w}px`)
  verificar(
    "sem rolagem horizontal",
    estreito.pagina.rolagem <= estreito.pagina.janela,
    `${estreito.pagina.rolagem} <= ${estreito.pagina.janela}`,
  )
  // Readability: the text does not shrink with width, and the shape must stay a
  // visible target, 15px of content plus a 2px ring on each side.
  verificar("a letra continua com 10px", iguais(estreito.letra, 10), `${estreito.letra}px`)
  verificar(
    "e a forma tem 19px de lado",
    iguais(estreito.cracha.w, 19) && iguais(estreito.cracha.h, 19),
    `${estreito.cracha.w}×${estreito.cracha.h}`,
  )
  await bruno.page.setViewportSize({ width: 1280, height: 900 })
  await bruno.page.waitForTimeout(400)

  console.log("\n6) atender apaga o número")
  await bruno.page.getByRole("button", { name: CARRIL.amigos, exact: true }).click()
  await bruno.page.waitForTimeout(2000)
  if ((await bruno.page.getByRole("button", { name: "Aceitar" }).count()) === 0) {
    await bruno.page.getByRole("button", { name: /Pendentes/ }).click()
    await bruno.page.waitForTimeout(1500)
  }
  await bruno.page.getByRole("button", { name: "Aceitar" }).first().click()
  await bruno.page.waitForTimeout(6000)
  const atendido = await medir(bruno.page, CARRIL.amigos)
  verificar("o crachá desapareceu", atendido?.cracha === null, `texto=${atendido?.texto}`)
  verificar(
    "e o botão deixou de se descrever",
    atendido?.descricao === null,
    `descrição=${atendido?.descricao}`,
  )

  console.log("\n7) o destino Eu nunca ganha número nenhum")
  const perfil = await medir(bruno.page, CARRIL.eu)
  verificar("Eu sem crachá", perfil?.cracha === null, perfil?.texto ?? "")

  await ana.ctx.close()
  await bruno.ctx.close()

  const falhas = resultados.filter((ok) => !ok).length
  console.log(`\n${resultados.length - falhas}/${resultados.length} pontos`)
  process.exit(falhas === 0 ? 0 : 1)
}

principal().catch((erro) => {
  console.error(erro)
  process.exit(1)
})
