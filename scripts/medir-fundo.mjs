/**
 * THE APPLICATION BACKGROUND, measured in a real rendering engine.
 *
 * A background is the only thing in this interface that you cannot judge by reading
 * the code. `npm test` runs in jsdom, and **jsdom applies no CSS at all**: no
 * pixel composition, no GPU layer, no contrast. A test on the class name `.app::before`
 * would always say yes, even with opacity at zero, with the gradient behind opaque
 * panels, or with text unreadable on top.
 *
 *   node scripts/medir-fundo.mjs
 *   SEM_FUNDO=1 node scripts/medir-fundo.mjs
 *
 * The second form sets `--fundo-luz` and `--fundo-grao` to zero and removes shadows
 * from the layers, which is, exactly, the design before this work. Measurements that
 * break MUST turn red there. If they give the same in both, they measure nothing, and
 * that is why the second form exists.
 *
 * What is measured, and why:
 *
 *   1. CONTRAST, of composed pixels, not CSS. The veil and grain sit ON TOP of the text:
 *      what the stylesheet says the text is stopped being what the eye receives.
 *      Measure what comes out of the compositor, in each theme, and compare both
 *      against the WCAG minimum.
 *   2. COST. Frames dropped while scrolling the conversation, with background and without,
 *      on the same machine and in the same run. An absolute number in headless Chromium
 *      means nothing; the DIFFERENCE between the two does.
 *   3. THE LAYER. That the animation is composited (`transform`/`opacity`) and that, without
 *      motion requested, no layer gets promoted to consume memory.
 *   4. THE SPEED. That the motion takes minutes: measure real displacement in two seconds
 *      of wall clock time.
 *   5. THE ORDER. That a sheet opening on top carries no veil, and that the veil does not
 *      catch clicks.
 *   6. THE WEIGHT. That a single network request does not come in because of this.
 *
 * WHAT IT DOES NOT PROVE. It does not open the real app with real data, it mounts
 * the shell (`.app`, rail, bar, conversation, people) with real classes and the
 * real stylesheet. It is enough for the background, which is a property of
 * SURFACES and not content; it is not enough to say a concrete screen is right.
 * For that there are the other `medir-*.mjs`.
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-fundo")
const RAIZ = join(AQUI, "..")
const SEM_FUNDO = Boolean(process.env.SEM_FUNDO)

mkdirSync(SAIDA, { recursive: true })

/* ------------------------------------------------------------- the page */

/**
 * The application shell, with real classes.
 *
 * It is not the whole `App` on purpose: that needs a bridge, an account and
 * a server, and none of that changes a pixel of the background. What does change
 * are the surfaces, rail, bar, conversation, people, and these are them.
 */
const LINHAS = [
  ["Ana", "As chaves nunca saem daqui. É a única promessa que interessa."],
  ["Bento", "Confirmo. O servidor vê metadados de entrega e mais nada."],
  ["Carla", "E o número de segurança? Continua a ler-se em voz alta?"],
  ["Ana", "Continua. Doze grupos de quatro, monoespaçado, para se conferir ao lado."],
  ["Duarte", "Vou pôr isso na folha de segurança amanhã de manhã."],
  ["Bento", "O grupo roda a chave a cada entrada e a cada saída."],
  ["Carla", "Isso não dá conversa perdida para quem esteve fora?"],
  ["Ana", "Não. Fica selada com a chave da época em que foi escrita."],
]

const shell = () => {
  const canais = ["geral", "protocolo", "desenho", "servidores", "avisos", "arquivo"]
  const mensagens = Array.from({ length: 40 }, (_, i) => {
    const [quem, texto] = LINHAS[i % LINHAS.length]
    return `<div class="message">
        <span class="message-gutter">09:${String(10 + (i % 48)).padStart(2, "0")}</span>
        <div class="message-body">
          <span class="author">${quem}</span>
          <div class="message-text">${texto}</div>
        </div>
      </div>`
  }).join("")
  return `
  <div class="app">
    <nav class="rail">
      <span class="rail-logo"></span>
      <button class="rail-btn active"></button>
      <button class="rail-btn"></button>
      <button class="rail-btn"></button>
      <span class="rail-spacer"></span>
    </nav>
    <aside class="sidebar open">
      <div class="sidebar-header">Comunidades</div>
      <div class="sidebar-body">
        <ul class="channel-list">
          ${canais
            .map(
              (c, i) =>
                `<li class="channel-row${i === 1 ? " current" : ""}"><span class="channel"><span class="channel-name">${c}</span></span></li>`,
            )
            .join("")}
        </ul>
      </div>
    </aside>
    <main class="main with-members">
      <header class="topbar"><h1>protocolo</h1></header>
      <div class="timeline" id="conversa">${mensagens}</div>
      <div class="chat-composer"><div class="composer-line"><input placeholder="Escrever em protocolo" /></div></div>
      <aside class="members">
        <div class="members-header">Online — 3</div>
      </aside>
    </main>
  </div>
  <!-- Escondido por \`style\` e NÃO por \`hidden\`: \`.overlay\` declara
       \`display: grid\`, e um selector de classe ganha ao \`display: none\` que o
       atributo \`hidden\` traz da folha do browser. Com \`hidden\`, este véu preto
       a 55% ficava por cima da aplicação inteira durante a corrida toda — e a
       primeira versão deste guião mediu o contraste de tudo através dele,
       2,44:1 na conversa, e acusou o fundo. -->
  <!-- O ecrã de entrada, que é outra raiz: não vive dentro do \`.app\`. Tem luz
       própria (um radial de realce que \`screens.css\` já lhe dava) e recebe o
       GRÃO, para a matéria da aplicação começar na primeira coisa que se vê.
       Fica aqui montado, escondido, para o guião o poder acender. -->
  <div class="gate" id="entrada" style="display: none">
    <div class="gate-card">
      <h1>Orwell</h1>
      <p class="gate-lead">As chaves nunca saem deste aparelho.</p>
    </div>
  </div>
  <div class="overlay" id="veu" style="display: none">
    <div class="sheet narrow">
      <div class="sheet-header"><h2>Número de segurança</h2></div>
      <div class="sheet-body"><p class="sheet-lead">Leia estas palavras em voz alta à outra pessoa.</p></div>
    </div>
  </div>`
}

/**
 * The PREVIOUS design, restored by variables.
 *
 * It is not a reconstruction from the old commit: it is what it takes to restore each
 * flaw these measurements say has disappeared, no light, no grain, no steps between
 * panels, and sheets without a shadow again.
 */
const ANTIGO = `
  :root { --fundo-luz: 0; --fundo-grao: 0; }
  .sidebar, .main, .members { background-image: none; }
  .prompt, .sheet { box-shadow: none; }
`

/**
 * The LIGHT theme, simulated.
 *
 * The app today has one theme only, `tokens.css` declares `color-scheme: dark` and
 * there is not a single `prefers-color-scheme` in the entire repository (searched
 * August 21, 2026). That does not skip the question, it skips the easy answer:
 * the background has to be written so as not to assume the wall is black, and the only
 * way to PROVE it is to flip the surface staircase backwards and measure again.
 *
 * What swap here are the surfaces, the text and the shadow color, the same three
 * groups a real light theme would swap. If the background were written with blacks
 * and whites by hand, this pass would break; it is written in `--luz`, `--sombra-cor`
 * and a medium gray, and that is why it holds up.
 *
 * **This is not a light theme and must not be confused with one.** It is a portability
 * proof, and nothing more: it does not look at a single state color, badges, highlights,
 * or the hundred places where this codebase wrote `rgb(0 0 0 / …)` by hand outside my domain.
 */
const CLARO = `
  :root {
    --bg-deep: #e7e8ec; --bg-rail: #dcdee4; --bg-side: #eef0f4;
    --bg-main: #f7f8fa; --bg-raised: #ffffff; --bg-hover: #ffffff;
    --line: #c9ccd6;
    --text: #16181d; --text-dim: #4c5262; --text-faint: #5c6273;
    --sombra-cor: 18 20 28; --brilho-cor: 255 255 255;
    color-scheme: light;
  }
`

const ENTRADA = join(SAIDA, "entrada.js")
writeFileSync(ENTRADA, `import ${JSON.stringify(join(RAIZ, "packages/ui/src/styles.css"))}\n`, "utf8")

await build({
  entryPoints: [ENTRADA],
  bundle: true,
  outfile: join(SAIDA, "pagina.js"),
  loader: { ".css": "css" },
  format: "iife",
  logLevel: "error",
})

const CSS_CONSTRUIDO = join(SAIDA, "pagina.css")

/**
 * The stylesheet goes EMBEDDED in the HTML, not in a `<link>`.
 *
 * In a `file://`, Chromium treats each file as an opaque origin: `cssRules` of a linked
 * sheet throws `SecurityError`, and the measurement that walks the keyframes to prove
 * the animation only touches `transform` and `opacity` got an empty list, and failed
 * without saying why. Embedded, the stylesheet is part of the document and reads fine.
 */
const CSS = readFileSync(CSS_CONSTRUIDO, "utf8")

writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><style>${CSS}</style>` +
    (SEM_FUNDO ? `<style>${ANTIGO}</style>` : "") +
    // `tema` swaps the surface staircase; `desliga` erases the background without
    // reloading the page, so the two measurements of the pair run in the SAME
    // run, on the same machine and at the same point of the gradient.
    `<style id="tema"></style><style id="desliga"></style>` +
    `<body>${shell()}</body>`,
  "utf8",
)

/* ------------------------------------------------------------- measurements */

const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push({ etiqueta, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? ` — ${detalhe}` : ""}`)
}
const nota = (texto) => console.log(`      ${texto}`)

const browser = await chromium.launch()

/**
 * A PNG decoder with zero dependencies: the browser itself.
 *
 * You need to read COMPOSED pixels, veil, grain and text already mixed, and
 * the page cannot photograph itself. Playwright capture gives a PNG; a second
 * blank tab draws it in a `<canvas>` and returns the bytes. No `pngjs`,
 * no `sharp`, nothing that is not already installed.
 */
const lupa = await browser.newContext()
const lupaPage = await lupa.newPage()
await lupaPage.setContent("<canvas id=c></canvas>")

async function pixeis(png) {
  return lupaPage.evaluate(async (base64) => {
    const img = new Image()
    img.src = "data:image/png;base64," + base64
    await img.decode()
    const c = document.getElementById("c")
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext("2d", { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    return { largura: c.width, altura: c.height, dados: Array.from(d) }
  }, png.toString("base64"))
}

/** Relative luminance of the WCAG, from an sRGB of 0-255. */
function luminancia(r, g, b) {
  const f = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const razao = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/** A tab with the shell mounted, and what it saw happen: errors and network. */
async function abrir(largura = 1280, altura = 800, opcoes = {}) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura }, ...opcoes })
  const page = await ctx.newPage()
  const erros = []
  const rede = []
  page.on("pageerror", (e) => erros.push(String(e)))
  page.on("request", (r) => {
    if (!r.url().startsWith("file://")) rede.push(r.url())
  })
  await page.goto(`file://${join(SAIDA, "index.html")}`)
  await page.waitForSelector(".timeline .message")

  /**
   * WAIT FOR THE APPLICATION TO FINISH LOADING. Without this, everything measured
   * after is a lie, and it was.
   *
   * `components.css` gives `.main` an entry animation, `view-in`, 200ms, raising
   * opacity from zero. A capture taken before it ends catches the conversation mid-entry,
   * composited over `--bg-deep`. That is exactly what happened: the first capture of the
   * pair came out at roughly 42% opacity and the second, 250ms later, was already complete.
   * The difference grid then said the background darkened the conversation by TWENTY-TWO
   * points out of 255, and what it was measuring was one entry animation against itself
   * already finished. The true value is +1.3, sixteen times smaller and with the sign flipped.
   *
   * Do not wait for a random number of milliseconds: ask the browser which animations
   * are running and wait for the ones that end. The background light is infinite and
   * never ends, that one stays out, or this would hang.
   */
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => {
          const t = a.effect?.getTiming?.()
          return t && t.iterations !== Infinity
        })
        .map((a) => a.finished.catch(() => {})),
    ),
  )
  // The mouse away from everything: a highlight placed lies about the resting state.
  await page.mouse.move(2, 2)
  return { ctx, page, erros, rede }
}

/**
 * CONTRAST, measured with probes, not antialiasing.
 *
 * The first version of this script photographed the text box and built a histogram:
 * the fullest bucket was the wall, the opposite bucket was the ink. It gave 7.04:1
 * for the conversation, where the CSS declares 12.6:1, and the whole difference was
 * antialiasing. At 14px, almost no pixel of an `s` reaches the full color of the letter;
 * what was being measured was the fringe, not the ink. Worse: where the text is small
 * and the box has padding (the people list header, 11px inside 12px of space), the ink
 * did not even reach half a percent of pixels and the script returned 1.00:1, a number
 * that looks like a disaster and is a measurement looking the wrong way.
 *
 * The WCAG are defined on SPECIFIED colors, not rasterization. What this work could
 * have broken is not rasterization, it is composition: there are two layers on top
 * of the text, and what the stylesheet declares stopped being what the eye receives.
 *
 * So it is measured like this: at the exact spot of each zone, and INSIDE the same
 * stacking order, two rectangles are drawn, one with the declared text color, another
 * with the declared color of the surface below it. Both are photographed. Both went through
 * the same veil, the same grain and the same point of the gradient. The contrast between
 * what comes out is, literally, what the person reads.
 *
 * Also returned is the WORST PIXEL: grain is noise, and there are pixels where it pushes
 * the ink near the wall. If the worst pixel of grain cost contrast for real, it would
 * show up here.
 */
async function sondar(page, zona) {
  const caixa = await page.locator(zona.selector).first().boundingBox()
  if (!caixa || caixa.width < 4 || caixa.height < 4) return { erro: "sem caixa" }

  const cores = await page.evaluate((selector) => {
    const el = document.querySelector(selector)
    const tinta = getComputedStyle(el).color
    // The surface: the first ancestor with a background that is not transparent.
    // That is the wall the WCAG say to measure against, and that is what the
    // conversation and bar give to this text.
    let no = el
    let parede = null
    while (no && !parede) {
      const c = getComputedStyle(no).backgroundColor
      if (c && !/rgba?\([^)]*,\s*0\)$/.test(c) && c !== "transparent") parede = c
      no = no.parentElement
    }
    return { tinta, parede: parede ?? getComputedStyle(document.body).backgroundColor }
  }, zona.selector)

  /**
   * The probe goes INSIDE the `.app`, and that is not tidying.
   *
   * The veil is `.app::before` with `z-index: 1`; a rectangle hung on the `body`
   * with high `z-index` would pass over it and measure pure color, which is
   * exactly the number this script exists not to believe. Inside the `.app` and with no
   * `z-index`, the probe ends up where the text is: below.
   */
  const medir = async (cor) => {
    await page.evaluate(
      ({ cor, caixa }) => {
        document.getElementById("sonda")?.remove()
        const d = document.createElement("div")
        d.id = "sonda"
        d.style.cssText = `position:fixed;left:${caixa.x}px;top:${caixa.y}px;width:${caixa.width}px;height:${caixa.height}px;background:${cor}`
        document.querySelector(".app").append(d)
      },
      { cor, caixa },
    )
    /*
      The capture steps back 2px per side.
      
      The probe is a rectangle in fractional coordinates (layout boxes don't fall on
      pixel boundaries), so the outer line of each edge is a mix of the probe and what
      is around it. That line entered the min and max, and the "worst grain pixel"
      of a message author once gave 1.01:1, which would be invisible text, and it is
      just the probe's own edge being measured as if it were ink.
      */
    const png = await page.screenshot({
      clip: {
        x: caixa.x + 2,
        y: caixa.y + 2,
        width: Math.max(1, Math.ceil(caixa.width) - 4),
        height: Math.max(1, Math.ceil(caixa.height) - 4),
      },
    })
    const p = await pixeis(png)
    const luzes = []
    for (let i = 0; i < p.dados.length; i += 4) luzes.push(luminancia(p.dados[i], p.dados[i + 1], p.dados[i + 2]))
    return {
      media: luzes.reduce((s, l) => s + l, 0) / luzes.length,
      min: Math.min(...luzes),
      max: Math.max(...luzes),
    }
  }

  const tinta = await medir(cores.tinta)
  const parede = await medir(cores.parede)
  await page.evaluate(() => document.getElementById("sonda")?.remove())

  // The worst pair the grain can produce: the tint closest to the wall
  // against the wall closest to the tint.
  const escuroPrimeiro = tinta.media < parede.media
  const pior = escuroPrimeiro ? razao(tinta.max, parede.min) : razao(tinta.min, parede.max)
  return { razao: razao(tinta.media, parede.media), pior, cores }
}

const ZONAS = [
  { nome: "conversa", selector: ".timeline .message:nth-child(4) .message-text" },
  { nome: "autor da mensagem", selector: ".timeline .message:nth-child(4) .author" },
  { nome: "nome do canal, na barra", selector: ".channel-row:nth-child(3) .channel-name" },
  { nome: "cabeçalho da barra", selector: ".sidebar-header" },
  { nome: "lista de pessoas (--text-faint, 11px)", selector: ".members-header" },
  {
    nome: "hora no vão (--text-faint, 11px)",
    selector: ".timeline .message:nth-child(4) .message-gutter",
  },
]

/** The minimum of WCAG 2.2 AA for normal text. */
const MINIMO = 4.5

/**
 * Measure once with the background and once without it, on the SAME page.
 *
 * The number that matters is not the absolute contrast, that was a palette
 * decision made before this work, and it is the same in both cases. What
 * matters is the COST: how much these two layers take away from what was
 * already there. This is the only question this work is responsible for.
 */
async function medirContraste(page, etiquetaTema) {
  const linhas = []
  for (const zona of ZONAS) {
    await page.evaluate(() => (document.getElementById("desliga").textContent = ""))
    const com = await sondar(page, zona)
    await page.evaluate(
      () => (document.getElementById("desliga").textContent = ":root { --fundo-luz: 0; --fundo-grao: 0; }"),
    )
    const sem = await sondar(page, zona)
    await page.evaluate(() => (document.getElementById("desliga").textContent = ""))
    linhas.push({ ...zona, com, sem })
  }

  const abaixo = linhas.filter((l) => l.com.razao !== undefined && l.com.razao < MINIMO)
  check(
    `${etiquetaTema}: todo o texto continua acima dos ${MINIMO}:1 das WCAG com o fundo por cima`,
    abaixo.length === 0,
    abaixo.map((p) => `${p.nome} ${p.com.razao.toFixed(2)}:1`).join(", "),
  )

  /*
    And the WORST PIXEL too, with half a point of headroom over the minimum.
    
    The grain is noise: there are pixels where it pushes the tint toward the
    wall. The average passing is not enough, whoever reads 11px does not read
    the average, they read the pixels that are there. 5.0:1 and not 4.5:1
    because the WCAG minimum is a floor and not a target, and because this
    number has to survive a miscalibrated monitor on top.
    */
  const PIOR_MINIMO = 5.0
  const piores = linhas.filter((l) => l.com.pior !== undefined && l.com.pior < PIOR_MINIMO)
  check(
    `${etiquetaTema}: e o pior pixel do grão fica acima de ${PIOR_MINIMO}:1 — meio ponto de folga sobre o mínimo`,
    piores.length === 0,
    piores.map((p) => `${p.nome} ${p.com.pior.toFixed(2)}:1`).join(", "),
  )

  /*
    COST, measured on the only scale that makes sense: HEADROOM above the minimum.
    
    Neither absolute difference nor percentage works, and both were tried. Text
    at 13.88:1 that drops to 12.86 loses 1.02 points and 7.3%, and loses nothing
    that reads, because it stays at triple the minimum. Text at 5.40:1 that loses
    0.14 points (2.6%) gets much closer to a real problem. Both calculations rank the
    first as worse, and the first one does not matter.
    
    What gets measured is headroom: `(contraste − 4.5)`, which separates each text from the
    WCAG minimum, and how much of that headroom the background eats. Then the
    numbers align, the veil eats a similar slice across the interface, and that
    slice must stay small.
    */
  const folga = (r) => r - MINIMO
  const custos = linhas
    .filter((l) => l.com.razao !== undefined)
    .map((l) => ({
      nome: l.nome,
      pontos: l.sem.razao - l.com.razao,
      comido: 1 - folga(l.com.razao) / folga(l.sem.razao),
    }))
  /*
    ONE QUARTER, no less, and why it cannot be less.
    
    The weakest text in this house, `--text-faint` at 11px, starts at 5.40:1,
    which means 0.90 of headroom above the minimum. The background takes 0.21
    points, which is 23% of that headroom and is, in absolute terms, very little.
    A cap of 15% would force you to erase the background until it does nothing,     and a background that does nothing is the worst of both worlds: you pay in
    contrast and get no design.
    
    One quarter of the headroom is the budget, stated with the number in front
    instead of hidden. What holds it from below is the worst pixel line, which
    is absolute.
    */
  check(
    `${etiquetaTema}: e o fundo come menos de um quarto da folga que cada texto tinha acima do mínimo`,
    custos.every((c) => c.comido < 0.25),
    custos
      .filter((c) => c.comido >= 0.25)
      .map((c) => `${c.nome} ${(c.comido * 100).toFixed(1)}%`)
      .join(", "),
  )

  for (const l of linhas) {
    if (l.com.razao === undefined) {
      nota(`${l.nome}: ${l.com.erro}`)
      continue
    }
    const c = custos.find((x) => x.nome === l.nome)
    nota(
      `${l.nome}: ${l.com.razao.toFixed(2)}:1 — sem fundo era ${l.sem.razao.toFixed(2)}:1 ` +
        `(−${c.pontos.toFixed(2)} pontos, ${(c.comido * 100).toFixed(1)}% da folga; ` +
        `pior pixel do grão ${l.com.pior.toFixed(2)}:1)`,
    )
  }
  return linhas
}

/* ------------------------------------------- 1. contrast, in both themes */

console.log(`\n— CONTRASTE, com sondas por baixo do fundo ${SEM_FUNDO ? "(SEM FUNDO)" : ""}\n`)
const custoEscuro = {}
{
  const { ctx, page, erros } = await abrir()
  check("a casca desenha sem erros de página", erros.length === 0, erros[0] ?? "")
  const linhas = await medirContraste(page, "tema escuro")
  for (const l of linhas) {
    if (l.com.razao !== undefined) custoEscuro[l.nome] = l.sem.razao - l.com.razao
  }
  await page.screenshot({ path: join(AQUI, "_saida-fundo-escuro.png") })
  await ctx.close()
}

console.log("")
{
  const { ctx, page } = await abrir()
  await page.evaluate((css) => (document.getElementById("tema").textContent = css), CLARO)
  const linhas = await medirContraste(page, "tema claro simulado")
  /*
    The question for this section, and only this: does the background cost the
    SAME on both sides? Comparing absolute contrasts would say nothing, the
    light ladder in this simulation is invented, and would have whatever contrast
    I gave it. What I did not invent is the cost of the veil and the grain, and
    that is what must be symmetric. A background drawn with whites by hand would
    cost almost nothing in the dark and tear apart the light; a medium-gray grain
    costs the same to both, and that is why it is medium-gray.
  */
  /*
    Compared in POINTS of contrast, not in the headroom slice.

    The headroom slice is the right measure within one theme, and the wrong one
    between two: the light ladder in this simulation is invented by me, gives
    each text a different starting headroom, and the same absolute loss shows up
    as a different percentage just because of that. What I did not invent, and
    what must be symmetric, is how much contrast the veil and grain take.
  */
  const assimetrias = linhas
    .filter((l) => l.com.razao !== undefined && custoEscuro[l.nome] !== undefined)
    .map((l) => ({ nome: l.nome, claro: l.sem.razao - l.com.razao, escuro: custoEscuro[l.nome] }))
  check(
    "o fundo não foi desenhado para um tema só: custa o mesmo, a meio ponto, nos dois",
    assimetrias.every((a) => Math.abs(a.claro - a.escuro) < 0.5),
    assimetrias
      .filter((a) => Math.abs(a.claro - a.escuro) >= 0.5)
      .map((a) => `${a.nome}: −${a.escuro.toFixed(2)} no escuro, −${a.claro.toFixed(2)} no claro`)
      .join(", "),
  )
  for (const a of assimetrias) {
    nota(`${a.nome}: custa −${a.escuro.toFixed(2)} pontos no escuro, −${a.claro.toFixed(2)} no claro`)
  }
  await page.screenshot({ path: join(AQUI, "_saida-fundo-claro.png") })
  await ctx.close()
}

/* ------------------------------------------- 1c. the surface ladder */

console.log("\n— A ESCADA: o fundo não pode inverter a hierarquia dos painéis\n")

/**
 * The conversation is brighter than the bar, and the bar is brighter than the
 * rail. This is how this palette tells you what sits in front of what, and a
 * background on top cannot contradict the palette.
 *
 * This is not theory: the first placement of the light well put the light in
 * the upper left corner, which is the convention of lighting, and there sit the
 * rail and the bar, the two darkest steps. The light lifted them, the drain
 * darkened the conversation, and the ladder was upside down. No text contrast
 * would expose it (all stayed above the minimum); what exposes it is this.
 */
{
  const { ctx, page } = await abrir()
  const amostra = async (x, y) => {
    const p = await pixeis(await page.screenshot({ clip: { x, y, width: 24, height: 24 } }))
    let soma = 0
    for (let i = 0; i < p.dados.length; i += 4) soma += luminancia(p.dados[i], p.dados[i + 1], p.dados[i + 2])
    return soma / (p.dados.length / 4)
  }
  // Three points with no text on top, one in each panel, all at the same height.
  const carril = await amostra(18, 420)
  const barra = await amostra(150, 420)
  const conversa = await amostra(700, 420)
  nota(`luminância: carril ${carril.toFixed(4)}, barra ${barra.toFixed(4)}, conversa ${conversa.toFixed(4)}`)
  check(
    "a escada aguenta: carril < barra < conversa, com o fundo por cima",
    carril < barra && barra < conversa,
    `${carril.toFixed(4)} / ${barra.toFixed(4)} / ${conversa.toFixed(4)}`,
  )
  await ctx.close()
}

/* ------------------------------------- 1b. the portrait of what the background does */

/**
 * The difference between with and without, amplified 12 times.
 *
 * A background designed not to be seen cannot be judged in a screenshot, and a
 * background you could see in a screenshot would be wrong. This image subtracts
 * the two versions and multiplies the rest: it is the drawing of the veil and
 * grain, alone, without the interface underneath. This is where you see if the
 * light well is where it should be, if the gradient has banding, and if the
 * grain is grain or a repeating pattern.
 *
 * It has no assertions on purpose. This is for looking.
 */
{
  const { ctx, page } = await abrir()
  const com = await pixeis(await page.screenshot())
  await page.evaluate(
    () => (document.getElementById("desliga").textContent = ":root { --fundo-luz: 0; --fundo-grao: 0; }"),
  )
  await page.waitForTimeout(200)
  const sem = await pixeis(await page.screenshot())
  await ctx.close()

  const AMPLIFICACAO = 12
  const png = await lupaPage.evaluate(
    ({ a, b, largura, altura, k }) => {
      const c = document.getElementById("c")
      c.width = largura
      c.height = altura
      const ctx2 = c.getContext("2d")
      const saida = ctx2.createImageData(largura, altura)
      for (let i = 0; i < a.length; i += 4) {
        for (let j = 0; j < 3; j++) saida.data[i + j] = Math.min(255, 128 + (a[i + j] - b[i + j]) * k)
        saida.data[i + 3] = 255
      }
      ctx2.putImageData(saida, 0, 0)
      return c.toDataURL("image/png").split(",")[1]
    },
    { a: com.dados, b: sem.dados, largura: com.largura, altura: com.altura, k: AMPLIFICACAO },
  )
  writeFileSync(join(AQUI, "_saida-fundo-diferenca.png"), Buffer.from(png, "base64"))
  nota(`a diferença entre com e sem fundo, ×${AMPLIFICACAO}, em _saida-fundo-diferenca.png`)

  /*
    And the same in numbers, in a 6x4 grid.

    The amplified image deceives the naked eye: ×12 saturates, and a zone one
    point darker looks the same as a zone ten points darker. This is how reading
    the image once told me the drain was swallowing the conversation when it was
    taking ONE point out of 255. The image serves to see the SHAPE of the light;
    the grid serves to know how much it is worth.
  */
  const grelha = []
  for (let f = 0; f < 4; f++) {
    const celas = []
    for (let c = 0; c < 6; c++) {
      const x0 = Math.floor((c * com.largura) / 6)
      const x1 = Math.floor(((c + 1) * com.largura) / 6)
      const y0 = Math.floor((f * com.altura) / 4)
      const y1 = Math.floor(((f + 1) * com.altura) / 4)
      let soma = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * com.largura + x) * 4
          soma += (com.dados[i] - sem.dados[i] + (com.dados[i + 1] - sem.dados[i + 1]) + (com.dados[i + 2] - sem.dados[i + 2])) / 3
          n++
        }
      }
      celas.push(soma / n)
    }
    grelha.push(celas)
  }
  nota("o que o fundo faz a cada zona, em pontos de 255 (+ clareia, − escurece):")
  for (const f of grelha) nota("  " + f.map((v) => (v >= 0 ? "+" : "") + v.toFixed(2).padStart(6)).join("  "))

  /*
    The AMPLITUDE, which is the difference between a gradient and a solid
    background color.
    
    This is the number that was missing, and its absence cost an entire version.
    A veil that lifts the window equally all over is not light at all, it is a
    fourth surface color, which you pay for in contrast and never see. This is
    what happened when the light color was `--bg-hover`: the entire grid between
    +1.04 and +1.37, an amplitude of 0.33 points out of 255, far below what any
    eye can tell apart.
    
    The cap exists for the opposite reason and is the most important of the two:
    a background with ten or fifteen points of amplitude stops being depth and
    becomes a blotch, and a blotch, in a product that sells restraint, is the
    wrong thing. Between 2.5 and 8 points there is depth without there being
    design.
    */
  const todas = grelha.flat()
  const amplitude = Math.max(...todas) - Math.min(...todas)
  check(
    "a luz é um GRADIENTE e não uma cor de fundo: 2,5 a 8 pontos de 255 entre a zona mais clara e a mais escura",
    amplitude >= 2.5 && amplitude <= 8,
    `${amplitude.toFixed(2)} pontos`,
  )
}

/* --------------------------------------------------- 2. the cost, while scrolling */

console.log("\n— CUSTO: frames a rolar a conversa\n")

/**
 * Scroll the conversation for three seconds and count the frames that dropped.
 *
 * Measure TWICE in the same run and on the same machine: with the background,
 * and with it turned off by variable in the same document. The absolute number
 * from a headless Chromium is worthless, there is no real vsync, but both runs
 * pay the same tax, and the difference between them is the cost of the
 * background.
 *
 * Scroll by `scrollTop` inside `requestAnimationFrame`: that is the path the
 * mouse wheel takes, and it is what forces the compositor to redraw the entire
 * area.
 */
const ROLAR = `
  (segundos) => new Promise((resolve) => {
    const alvo = document.getElementById("conversa")
    const marcas = []
    const fim = performance.now() + segundos * 1000
    let direccao = 1
    function passo(t) {
      marcas.push(t)
      alvo.scrollTop += direccao * 24
      if (alvo.scrollTop <= 0 || alvo.scrollTop >= alvo.scrollHeight - alvo.clientHeight) direccao *= -1
      if (t < fim) requestAnimationFrame(passo)
      else {
        const intervalos = marcas.slice(1).map((m, i) => m - marcas[i]).sort((a, b) => a - b)
        const p = (q) => intervalos[Math.min(intervalos.length - 1, Math.floor(intervalos.length * q))] ?? 0
        resolve({
          frames: marcas.length,
          mediana: p(0.5),
          p95: p(0.95),
          pior: intervalos[intervalos.length - 1] ?? 0,
          perdidos: intervalos.filter((i) => i > 32).length,
        })
      }
    }
    requestAnimationFrame(passo)
  })
`

{
  const { ctx, page } = await abrir()
  // A warmup that no one measures: the first raster of the grain and the first
  // layer promotion happen here, not inside the sample.
  await page.evaluate(`(${ROLAR})(1)`)

  const com = await page.evaluate(`(${ROLAR})(3)`)
  await page.evaluate(() => {
    document.getElementById("tema").textContent = ":root { --fundo-luz: 0; --fundo-grao: 0; }"
  })
  await page.waitForTimeout(300)
  const sem = await page.evaluate(`(${ROLAR})(3)`)

  nota(`com fundo:  ${com.frames} frames, mediana ${com.mediana.toFixed(1)}ms, p95 ${com.p95.toFixed(1)}ms, ${com.perdidos} acima de 32ms`)
  nota(`sem fundo:  ${sem.frames} frames, mediana ${sem.mediana.toFixed(1)}ms, p95 ${sem.p95.toFixed(1)}ms, ${sem.perdidos} acima de 32ms`)
  const delta = com.mediana - sem.mediana
  nota(`diferença na mediana: ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}ms por frame`)
  check(
    "o fundo custa menos de 1ms por frame ao rolar a conversa",
    delta < 1,
    `${delta.toFixed(2)}ms`,
  )
  check(
    "e não acrescenta frames perdidos",
    com.perdidos <= sem.perdidos + 2,
    `${com.perdidos} com, ${sem.perdidos} sem`,
  )
  await ctx.close()
}

/* --------------------------------------------------------- 3. as camadas */

console.log("\n— A CAMADA: composta a mexer, largada em repouso\n")
{
  const { ctx, page } = await abrir()
  const camadas = await page.evaluate(() => {
    const estilo = getComputedStyle(document.querySelector(".app"), "::before")
    return {
      animacao: estilo.animationName,
      duracao: estilo.animationDuration,
      // What the animation touches. Only `transform` and `opacity` run on the
      // compositor; any other property forces the main thread to work 60 times a
      // second, forever.
      propriedades: [...document.styleSheets]
        .flatMap((f) => {
          try {
            return [...f.cssRules]
          } catch {
            return []
          }
        })
        .filter((r) => r.type === CSSRule.KEYFRAMES_RULE && r.name === "fundo-respira")
        .flatMap((r) => [...r.cssRules].flatMap((k) => [...k.style]))
        .filter((v, i, a) => a.indexOf(v) === i),
      willChange: estilo.willChange,
    }
  })
  check("a luz respira", camadas.animacao === "fundo-respira", camadas.animacao)

  /*
    And the TWO layers do not enter the grid of `.app`.

    The `.app` is `display: grid` with three named columns, and a `::before` or
    `::after` on a grid container is, by default, a grid item: two extra items
    here would push the rail, bar, and conversation to the side, or create new
    lines. What takes them out of the flow is `position: fixed`, and that is a
    statement about the layout engine, you measure it, you do not guess. Sixty,
    two hundred and thirty-six, and the rest.
  */
  const colunas = await page.evaluate(() => ({
    grelha: getComputedStyle(document.querySelector(".app")).gridTemplateColumns,
    carril: Math.round(document.querySelector(".rail").getBoundingClientRect().width),
    barra: Math.round(document.querySelector(".sidebar").getBoundingClientRect().width),
  }))
  check(
    "as duas camadas não entram na grelha: o carril continua com 60px e a barra com 236",
    colunas.carril === 60 && colunas.barra === 236,
    `${colunas.carril} / ${colunas.barra} — ${colunas.grelha}`,
  )
  check(
    "e a animação só toca em `transform` e `opacity` — nada que obrigue o fio principal a repintar",
    camadas.propriedades.length > 0 && camadas.propriedades.every((p) => p === "transform" || p === "opacity"),
    camadas.propriedades.join(", "),
  )
  check(
    "sem `will-change`: a camada é promovida pela animação e largada quando ela pára",
    camadas.willChange === "auto",
    camadas.willChange,
  )
  await ctx.close()
}

{
  const { ctx, page } = await abrir(1280, 800, { reducedMotion: "reduce" })
  const parado = await page.evaluate(() => {
    const estilo = getComputedStyle(document.querySelector(".app"), "::before")
    return { animacao: estilo.animationName, opacidade: estilo.opacity, transformacao: estilo.transform }
  })
  /*
    The trap that already caught the elbow and the bell of this house: `base.css`
    puts `animation-duration: 0.01ms !important` on EVERYTHING, and a duration
    written as an exception loses to it. What wins is removing the name. If this
    ever goes back to "0.01ms", the light does not stop, it jumps to the end of
    the path and stays there, and nobody notices reading the CSS.
  */
  check(
    "com `prefers-reduced-motion`, a luz PÁRA — sem nome de animação, e não com uma duração de 0,01ms",
    parado.animacao === "none",
    parado.animacao,
  )
  check(
    "e fica visível, parada: um fundo quieto não é movimento nenhum",
    parseFloat(parado.opacidade) > 0.01,
    parado.opacidade,
  )
  await ctx.close()
}

/* ----------------------------------------------------- 4. a velocidade */

console.log("\n— A VELOCIDADE: minutos, e não segundos\n")
{
  const { ctx, page } = await abrir()
  const ler = () =>
    page.evaluate(() => {
      const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".app"), "::before").transform)
      return { x: m.m41, y: m.m42, escala: m.a }
    })
  const t0 = await ler()
  await page.waitForTimeout(2000)
  const t1 = await ler()
  const andou = Math.hypot(t1.x - t0.x, t1.y - t0.y)
  nota(`em 2 segundos a luz andou ${andou.toFixed(2)}px`)
  /*
    1px per two seconds, and the number is not round by accident.
    
    The entire path is 3.2% of the layer, which at 1280px window width is ~59px;
    over 210s that is 0.28px/s average. With a sinusoid, the peak is π/2 of that
    , 0.44px/s, or 0.88px in two seconds, and that is where this measurement
    catches the light (it starts at the initial keyframe, but Chromium begins the
    cycle where the document clock tells it to). One pixel is the cap with a
    tenth of headroom.
    
    This limit is what caught the house's `--ease` putting 2.47px here.
    */
  check("a luz anda menos de 1px em dois segundos", andou < 1, `${andou.toFixed(2)}px`)
  check("mas anda mesmo — não está congelada", andou > 0.001, `${andou.toFixed(4)}px`)

  const ciclo = await page.evaluate(
    () => getComputedStyle(document.documentElement).getPropertyValue("--fundo-ciclo").trim(),
  )
  const segundos = parseFloat(ciclo)
  check("o ciclo conta-se em minutos", segundos >= 120, ciclo)
  nota(`ciclo ${segundos}s por sentido, ${(segundos * 2) / 60} minutos de ida e volta`)
  await ctx.close()
}

/* ---------------------------------------------------------- 5. a ordem */

console.log("\n— A ORDEM: o que fica por cima do véu, e o que ele não apanha\n")
{
  const { ctx, page } = await abrir()

  /*
    A sheet that opens on top cannot carry the veil.

    Measure by the composed color, not by the written `z-index`: photograph a
    piece of the sheet and a piece of the same surface (`--bg-side`) drawn
    separately, with the sheet on top of the veil and without it. If the veil
    caught the sheet, the two readings would differ.
  */
  await page.evaluate(() => (document.getElementById("veu").style.display = "grid"))
  await page.waitForTimeout(400)
  const caixa = await page.locator(".sheet .sheet-header").boundingBox()
  const dentroDaFolha = await pixeis(
    await page.screenshot({ clip: { x: caixa.x + 200, y: caixa.y + 4, width: 20, height: 12 } }),
  )
  const media = (p) => {
    let r = 0
    let g = 0
    let b = 0
    const n = p.dados.length / 4
    for (let i = 0; i < p.dados.length; i += 4) {
      r += p.dados[i]
      g += p.dados[i + 1]
      b += p.dados[i + 2]
    }
    return [r / n, g / n, b / n]
  }
  const cor = media(dentroDaFolha)
  const esperado = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement).getPropertyValue("--bg-side").trim()
    const d = document.createElement("div")
    d.style.color = s
    document.body.append(d)
    const rgb = getComputedStyle(d).color.match(/[\d.]+/g).map(Number)
    d.remove()
    return rgb
  })
  const desvio = Math.max(...cor.map((c, i) => Math.abs(c - esperado[i])))
  nota(`a folha lê ${cor.map((c) => Math.round(c)).join(",")}; a superfície declara ${esperado.join(",")}`)
  check(
    "a folha que abre por cima não leva véu nem grão: pinta-se na sua cor declarada",
    desvio <= 3,
    `desvio máximo de ${desvio.toFixed(1)}/255`,
  )

  const sombra = await page.evaluate(() => getComputedStyle(document.querySelector(".sheet")).boxShadow)
  check("e lança sombra — uma folha que não lança sombra está colada", sombra !== "none" && sombra.length > 0, sombra)

  await page.screenshot({ path: join(AQUI, "_saida-fundo-folha.png") })
  await page.evaluate(() => (document.getElementById("veu").style.display = "none"))

  /* The veil does not catch clicks: the element at the top of a point in the
     conversation must be the conversation, not a decoration. */
  const noTopo = await page.evaluate(() => {
    const r = document.querySelector(".timeline .message:nth-child(4)").getBoundingClientRect()
    const el = document.elementFromPoint(r.x + 40, r.y + 6)
    return el ? el.className || el.tagName : null
  })
  check("o fundo não apanha cliques", typeof noTopo === "string" && noTopo.includes("message"), String(noTopo))

  /*
    The step the bar casts IN THE CONVERSATION, the two points INSIDE the
    conversation.
    
    The first version measured at `main.x - 8`, and eight pixels left of the
    conversation edge is the BAR. It was comparing `--bg-side` with `--bg-main`,
    which are two different colors by palette choice and not by shadow: the
    number looked nice and passed even with `background-image: none` on the
    three panes, which is the same as saying it measured nothing. Now they are
    two points on the same surface, one inside the shadow and one outside it.
    */
  const degrau = await (async () => {
    const main = await page.locator(".timeline").boundingBox()
    /*
      And with the TEXT HIDDEN, which was the second mistake of this same
      measurement.
      
      The "middle" point fell at 300px from the edge, which is where the messages
      are. The letter pixels lifted the luminance on that side and the script read
      that as shadow: it gave 0.86 points even with `background-image: none` on
      the three panels. Two versions of this test passed for the wrong reasons.
      With content hidden, what stays is the surface, which is what the shadow
      paints.
      */
    await page.evaluate(() => (document.getElementById("desliga").textContent = ".timeline * { visibility: hidden }"))
    const em = async (dx) =>
      luminancia(
        ...media(await pixeis(await page.screenshot({ clip: { x: main.x + dx, y: main.y + 300, width: 3, height: 40 } }))),
      )
    const valor = (await em(300)) - (await em(2))
    await page.evaluate(() => (document.getElementById("desliga").textContent = ""))
    return valor
  })()
  nota(`dentro da conversa, o pixel encostado à barra é ${(degrau * 100).toFixed(3)} pontos de luminância mais escuro do que o do meio`)
  check("a barra lança sombra na conversa: há um degrau dentro da mesma superfície", degrau > 0.0015, degrau.toFixed(5))

  await ctx.close()
}

/* ------------------------------------------------ 6. the grain, in both directions */

console.log("\n— O GRÃO: cinzento médio, e por isso serve os dois temas\n")

/**
 * The assertion that `fundo.css` makes about the grain, put to the test.
 *
 * The grain is gray 0.5. The assertion is that this makes it LIGHTEN a dark
 * surface and DARKEN a light one, and that is why a texture serves both
 * themes without an extra line. A white grain would only serve the dark, a
 * black grain only the light, and in both cases the sheet would keep compiling
 * and passing all tests. Only this separates the assertion from a nice phrase.
 */
{
  const { ctx, page } = await abrir()
  const superficie = async () => {
    const caixa = await page.locator(".timeline").boundingBox()
    // Far from any text: the empty column between messages and people.
    const p = await pixeis(await page.screenshot({ clip: { x: caixa.x + caixa.width - 40, y: caixa.y + 200, width: 16, height: 16 } }))
    let soma = 0
    for (let i = 0; i < p.dados.length; i += 4) soma += p.dados[i]
    return soma / (p.dados.length / 4)
  }
  const medir = async (tema) => {
    await page.evaluate((css) => (document.getElementById("tema").textContent = css), tema)
    await page.evaluate(() => (document.getElementById("desliga").textContent = ":root{--fundo-luz:0;--fundo-grao:0}"))
    const nu = await superficie()
    await page.evaluate(() => (document.getElementById("desliga").textContent = ":root{--fundo-luz:0}"))
    const comGrao = await superficie()
    return comGrao - nu
  }
  const noEscuro = await medir("")
  const noClaro = await medir(CLARO)
  nota(`o grão move a superfície ${noEscuro >= 0 ? "+" : ""}${noEscuro.toFixed(2)} pontos no escuro, ${noClaro >= 0 ? "+" : ""}${noClaro.toFixed(2)} no claro`)
  check(
    "o grão clareia o escuro e escurece o claro: um cinzento médio serve os dois temas",
    noEscuro > 0.3 && noClaro < -0.3,
    `${noEscuro.toFixed(2)} / ${noClaro.toFixed(2)}`,
  )
  await ctx.close()
}

/**
 * The grain is grain, not a mosaic.
 *
 * Two ways this can go wrong without raising an error. First: the color matrix
 * comes out wrong and `feTurbulence` returns a flat sheet, texture written,
 * paid for, and no texture. Measure the standard deviation of pixels on an empty
 * surface: flat sheet gives zero.
 *
 * The second is worse because it looks good to the careless eye: without
 * `stitchTiles='stitch'`, the noise does not close at the mosaic edges and the
 * drawing gains a grid at 128 by 128 pixels, which is exactly the opposite of
 * texture. Compare the jump between columns ON TOP of the seam with the jump
 * between any other columns: if the seam is a seam, it jumps more.
 */
{
  const { ctx, page } = await abrir()
  const caixa = await page.locator(".timeline").boundingBox()
  // A wide band of empty surface, to the right of messages, straddling two seams
  // of the mosaic.
  const x0 = Math.round(caixa.x + caixa.width - 300)
  const p = await pixeis(await page.screenshot({ clip: { x: x0, y: Math.round(caixa.y + 120), width: 288, height: 60 } }))
  const em = (x, y) => p.dados[(y * p.largura + x) * 4]
  const valores = []
  for (let y = 0; y < p.altura; y++) for (let x = 0; x < p.largura; x++) valores.push(em(x, y))
  const mu = valores.reduce((s, v) => s + v, 0) / valores.length
  const desvio = Math.sqrt(valores.reduce((s, v) => s + (v - mu) ** 2, 0) / valores.length)
  nota(`o grão varia com desvio-padrão de ${desvio.toFixed(2)} pontos de 255`)
  check("o grão tem grão: os pixéis variam", desvio > 0.3, `${desvio.toFixed(2)}`)

  // The average jump between adjacent columns, column by column. The mosaic seams
  // fall where `(x0 + x) % 128 === 0`.
  const saltos = []
  for (let x = 1; x < p.largura; x++) {
    let soma = 0
    for (let y = 0; y < p.altura; y++) soma += Math.abs(em(x, y) - em(x - 1, y))
    saltos.push({ costura: (x0 + x) % 128 === 0, salto: soma / p.altura })
  }
  const medio = (quais) => quais.reduce((s, v) => s + v.salto, 0) / Math.max(1, quais.length)
  const naCostura = medio(saltos.filter((s) => s.costura))
  const foraDela = medio(saltos.filter((s) => !s.costura))
  nota(`salto entre colunas: ${foraDela.toFixed(2)} no meio do mosaico, ${naCostura.toFixed(2)} em cima da costura`)
  check(
    "e o mosaico fecha: a costura de 128px não salta mais do que o resto",
    naCostura <= foraDela * 1.5 + 0.05,
    `${naCostura.toFixed(2)} vs ${foraDela.toFixed(2)}`,
  )
  await ctx.close()
}

/* --------------------------------------------------- 6b. the login screen */

console.log("\n— O ECRÃ DE ENTRADA: a mesma matéria, desde o primeiro segundo\n")

/**
 * The `.gate` is another root, it sits outside the `.app`, so it inherits
 * nothing from this. It gets the grain by its own selector, not the light: it
 * has its own, a radial highlight that `screens.css` gave it before this work,
 * and two lights on the same screen compete instead of adding up.
 *
 * It's worth measuring because `.gate` is `display: grid` with `place-items:
 * center`: a pseudo-element in a grid container is, by default, a GRID ITEM
 *, and one extra item here would push the login card out of center. What saves
 * it is `position: fixed`, which takes it out of the flow. That's a claim about
 * the layout engine, and claims about the layout engine get measured.
 */
{
  const { ctx, page } = await abrir()
  await page.evaluate(() => {
    document.querySelector(".app").style.display = "none"
    document.getElementById("entrada").style.display = "grid"
  })
  await page.waitForTimeout(120)
  const visto = await page.evaluate(() => {
    const gate = document.getElementById("entrada")
    const cartao = gate.querySelector(".gate-card").getBoundingClientRect()
    const grao = getComputedStyle(gate, "::after")
    return {
      grao: grao.backgroundImage.slice(0, 22),
      opacidade: grao.opacity,
      posicao: grao.position,
      // The card centered in the window: if the pseudo-element were a grid item, it
      // would occupy a cell and the card would move out of center.
      centroX: Math.round(cartao.left + cartao.width / 2),
      centroY: Math.round(cartao.top + cartao.height / 2),
      janela: [window.innerWidth, window.innerHeight],
    }
  })
  check("o ecrã de entrada leva o mesmo grão", visto.grao.startsWith('url("data:image/svg'), visto.grao)
  check(
    "e o pseudo-elemento não entra na grelha: o cartão fica no centro da janela",
    Math.abs(visto.centroX - visto.janela[0] / 2) <= 1 && Math.abs(visto.centroY - visto.janela[1] / 2) <= 1,
    `cartão em ${visto.centroX},${visto.centroY} numa janela de ${visto.janela.join("×")}`,
  )
  await page.screenshot({ path: join(AQUI, "_saida-fundo-entrada.png") })
  await ctx.close()
}

/* --------------------------------------------------- 7. the narrow screen */

console.log("\n— ECRÃ ESTREITO: a sombra que não tem quem a lance\n")
{
  const { ctx, page } = await abrir(390, 780)
  const sombras = await page.evaluate(() => ({
    conversa: getComputedStyle(document.querySelector(".main")).backgroundImage,
    barra: getComputedStyle(document.querySelector(".sidebar")).boxShadow,
    luz: getComputedStyle(document.querySelector(".app"), "::before").opacity,
  }))
  /*
    Below 840px the bar leaves the flow and becomes a drawer with its own shadow.
    The conversation no longer has a neighbor to the left, and a shadow with no
    one casting it is a blotch stuck to the phone edge.
  */
  check(
    "a conversa larga a sombra da barra quando a barra deixa de estar ao lado",
    sombras.conversa === "none",
    sombras.conversa.slice(0, 80),
  )
  check("a gaveta leva sombra própria", sombras.barra !== "none", sombras.barra)
  check("e a luz continua lá", parseFloat(sombras.luz) > 0.01, sombras.luz)
  await page.screenshot({ path: join(AQUI, "_saida-fundo-estreito.png") })
  await ctx.close()
}

/* ------------------------------------------------------------ 8. the weight */

console.log("\n— O PESO\n")
{
  const { ctx, rede } = await abrir()
  check("o fundo não faz um único pedido de rede", rede.length === 0, rede.join(", "))
  await ctx.close()
}
{
  const bytes = statSync(CSS_CONSTRUIDO).size
  nota(`a folha de estilos construída pesa ${(bytes / 1024).toFixed(1)} kB`)
}

await lupa.close()
await browser.close()

const falhados = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length - falhados.length}/${resultados.length}`)
console.log(`Retratos em ${join(AQUI, "_saida-fundo-*.png")}`)
if (SEM_FUNDO) {
  console.log(
    falhados.length > 0
      ? `\nSem o fundo falharam ${falhados.length}: a medição morde.`
      : "\nSem o fundo não falhou NADA. A medição não está a medir o que diz.",
  )
  process.exit(falhados.length > 0 ? 0 : 1)
}
process.exit(falhados.length === 0 ? 0 : 1)
