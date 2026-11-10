// The profile, measured with a layout engine: the list scrolls, and open
// posts bring thumbs and comments.
//
// Why this exists instead of another test: profile tests run in jsdom, and
// jsdom DOES NOT APPLY ANY STYLESHEETS. It says lines exist and dividers
// count right; it doesn't know if the posts column scrolls within the screen
// or grows below it out of reach. Those are calculated pixels, and you need a
// real browser.
//
// What it does NOT prove: that `bridge.social.react` reaches the server. That's
// the network, and you measure it with scripts `verificar-publicacoes.mjs` and
// `verificar-apagar-comentario.mjs`.
//
//   node scripts/medir-perfil.mjs
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { deflateSync } from "node:zlib"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-perfil")
const RAIZ = join(AQUI, "..")

mkdirSync(SAIDA, { recursive: true })

/**
 * Thirty text posts: the number where a list stops fitting on any screen and
 * the question "does this scroll?" gets an answer.
 */
const QUANTAS = 30

/**
 * A real PNG, made here, so screenshots are real.
 *
 * A made-up string, `data:image/png;base64,xxx`, passes in jsdom and fails
 * here: the browser tries to decode it, fails, and the image ends up with zero
 * height. A measurement that accepted that would say "the photo is there"
 * looking at a hole. These bytes decode, and that's why the `naturalWidth` of
 * each `<img>` is a check, not a formality.
 */
const TABELA_CRC = (() => {
  const tabela = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabela[n] = c
  }
  return tabela
})()

function crc32(buffer) {
  let c = -1
  for (const byte of buffer) c = TABELA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function pedaco(tipo, dados) {
  const tamanho = Buffer.alloc(4)
  tamanho.writeUInt32BE(dados.length)
  const corpo = Buffer.concat([Buffer.from(tipo, "latin1"), dados])
  const soma = Buffer.alloc(4)
  soma.writeUInt32BE(crc32(corpo))
  return Buffer.concat([tamanho, corpo, soma])
}

/**
 * A solid-color rectangle, in PNG, as a data URL.
 *
 * **Large on purpose.** Scaling never stretches an image beyond its size,  * `max-width: 100%` and no `width`, so a 64px photo would open at 64px next to
 * a 203px thumbnail, and the "larger than the thumbnail" measurement would flag
 * a bug that didn't exist. A 900x600 portrait is what a real photo is, and the
 * question goes back to the product instead of to the test material.
 */
function pngLiso(largura, alturaPx, [r, g, b]) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(largura, 0)
  ihdr.writeUInt32BE(alturaPx, 4)
  ihdr[8] = 8 // 8 bits per channel
  ihdr[9] = 2 // true color, no alpha
  const linhas = []
  for (let y = 0; y < alturaPx; y++) {
    const linha = Buffer.alloc(1 + largura * 3) // the leading 0 is the "no filter" filter
    for (let x = 0; x < largura; x++) {
      linha[1 + x * 3] = r
      linha[2 + x * 3] = g
      linha[3 + x * 3] = b
    }
    linhas.push(linha)
  }
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco("IHDR", ihdr),
    pedaco("IDAT", deflateSync(Buffer.concat(linhas))),
    pedaco("IEND", Buffer.alloc(0)),
  ])
  return `data:image/png;base64,${bytes.toString("base64")}`
}

const FOTO_A = pngLiso(900, 600, [122, 84, 58])
const FOTO_B = pngLiso(900, 600, [58, 92, 122])

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { BridgeContext } from ${JSON.stringify(join(RAIZ, "packages/ui/src/App.js"))}
import { ToastProvider } from ${JSON.stringify(join(RAIZ, "packages/ui/src/components/Toast.js"))}
import { ProfileScreen } from ${JSON.stringify(join(RAIZ, "packages/ui/src/screens/profile/ProfileScreen.js"))}
import { PersonProfile } from ${JSON.stringify(join(RAIZ, "packages/ui/src/screens/profile/PersonProfile.js"))}
import ${JSON.stringify(join(RAIZ, "packages/ui/src/styles.css"))}

// Uma morada opaca de mural (1.0 «Arca»); a ficha vem da ponte (`channels.fichas`).
const CANAL = "!mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm:s"
const EU = "@me:s"

const FOTO_A = ${JSON.stringify(FOTO_A)}
const FOTO_B = ${JSON.stringify(FOTO_B)}

/**
 * Com \`?fotos=1\`, as publicações levam duas fotografias cada uma.
 *
 * Sem isto o perfil media-se inteiro sem uma única imagem — foi por isso que a
 * fotografia pôde deixar de se abrir sem nada avisar. As de texto continuam a
 * ser o caso por omissão porque são elas que enchem a lista que rola.
 *
 * E com \`&uma=1\`, uma só. Não é uma versão mais fraca do caso de duas: é o
 * caso em que o carrossel NÃO deve pôr setas nem pontos, e uma seta que aparece
 * sem ter para onde ir só se apanha a pedir explicitamente uma fotografia
 * sozinha.
 */
const COM_FOTOS = new URLSearchParams(location.search).has("fotos")
const SO_UMA = new URLSearchParams(location.search).has("uma")

/** Uma publicação de texto, com título, para a lista ter linhas com nome. */
const publicacao = (i) => ({
  channel: CANAL,
  seq: i + 1,
  sender: EU,
  payload: {
    t: "post",
    id: "p" + i,
    postedAt: 1_700_000_000_000 + i * 60_000,
    title: "Publicação número " + i,
    caption: "O corpo da publicação número " + i + ", com palavras que chegam para uma linha inteira.",
    media: COM_FOTOS
      ? SO_UMA
        ? [{ inline: FOTO_A, name: "cabeco-" + i + ".png", mediaType: "image/png" }]
        : [
            { inline: FOTO_A, name: "cabeco-" + i + ".png", mediaType: "image/png" },
            { inline: FOTO_B, name: "azinheira-" + i + ".png", mediaType: "image/png" },
          ]
      : [],
    links: [],
    tags: [],
  },
})

/**
 * Poucas publicações é um caso à parte e não uma versão mais fraca do outro.
 *
 * Com a lista mais alta do que o ecrã, uma grelha mal contada disfarça-se: não
 * sobra espaço, e a linha errada fica a zero na mesma. O vão morto só aparece
 * quando o conteúdo é curto — foi assim que ele apareceu.
 */
const publicacoes = Array.from(
  { length: new URLSearchParams(location.search).has("poucas") ? 3 : ${QUANTAS} },
  (_, i) => publicacao(i),
)

/**
 * As mensagens do fio: as publicações, mais um gosto de outra pessoa e um
 * comentário, para os polegares terem número e a caixa ter o que mostrar.
 */
const mensagens = [
  ...publicacoes,
  {
    channel: CANAL,
    seq: 900,
    sender: "@ana:s",
    payload: { t: "post.reaction", id: "r1", target: "p0", emoji: "👍", at: 1_700_000_100_000, remove: false },
  },
  {
    channel: CANAL,
    seq: 901,
    sender: "@ana:s",
    payload: { t: "post.comment", id: "c1", target: "p0", postedAt: 1_700_000_200_000, body: "Muito bom." },
  },
]

const perfil = { displayName: "Eu Próprio", donations: [], bio: "Uma biografia curta." }
const directorio = new Map([["@ana:s", { displayName: "Ana", donations: [] }]])

/**
 * Um bridge que diz que sim e não fala com ninguém.
 *
 * O que aqui se mede é o desenho: se os botões existem, se têm corpo e se
 * cabem. Que o voto chega ao servidor é outra pergunta, e tem guião próprio:
 * o verificar-publicacoes.mjs, contra um servidor a sério.
 */
const bridge = {
  social: {
    react: async () => ({ ok: true }),
    comment: async () => ({ ok: true }),
    removeComment: async () => ({ ok: true }),
  },
}

const qual = new URLSearchParams(location.search).get("qual") ?? "proprio"

const corpo =
  qual === "pessoa" ? (
    <PersonProfile
      address="@ana:s"
      name="Ana"
      profile={{ displayName: "Ana", donations: [] }}
      posts={publicacoes}
      messages={mensagens}
      me={EU}
      directory={directorio}
      nameFor={(quem) => directorio.get(quem)?.displayName ?? quem}
      onVote={() => {}}
      onComment={() => {}}
      onDeleteComment={() => {}}
      onMessage={() => {}}
      onClose={() => {}}
    />
  ) : (
    <ProfileScreen
      profile={perfil}
      address={EU}
      posts={publicacoes}
      messages={mensagens}
      me={EU}
      directory={directorio}
      nameFor={(quem) => directorio.get(quem)?.displayName ?? quem}
      onVote={() => {}}
      onComment={() => {}}
      onDeleteComment={() => {}}
      onCompose={() => {}}
      onEdit={() => {}}
      connection="online"
      connectionDetail={null}
    />
  )

createRoot(document.getElementById("raiz")).render(
  <BridgeContext.Provider value={bridge}>
    <ToastProvider>
      {/* A mesma concha da aplicação: a grelha de três colunas com a barra e a
          lista à esquerda. Sem ela, o \`.main\` cai na coluna de 60px e o que se
          estava a medir era outra coisa. */}
      <div className="app">
        <nav className="rail" />
        <aside className="sidebar" />
        {corpo}
      </div>
    </ToastProvider>
  </BridgeContext.Provider>,
)
`,
  "utf8",
)

await build({
  entryPoints: [ENTRADA],
  bundle: true,
  outfile: join(SAIDA, "pagina.js"),
  jsx: "automatic",
  loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts" },
  format: "iife",
  logLevel: "error",
})

writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="pagina.css">` +
    `<body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

const browser = await chromium.launch()
const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? ` — ${detalhe}` : ""}`)
}

async function abrir(qual, largura, altura, extra = "") {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(`file://${join(SAIDA, "index.html")}?qual=${qual}${extra}`)
  // List or grid: with photos the profile opens on the photos section, which is
  // a grid of squares, not rows.
  await page.waitForSelector(".post-list, .post-grid", { timeout: 10_000 })
  return { ctx, page, erros }
}

// ------------------------------------ the screen grid, line by line named
//
// The `.main` grid declares eight areas and is redefined by screen size with a
// POSITIONAL list of heights. One fewer line in that list doesn't shrink the
// grid: it moves the flexible line to the previous area, and whatever gets the
// space is an empty area. This measures the result, who has the `1fr`, instead
// of counting words in CSS.
for (const [largura, altura] of [
  [1280, 800],
  [390, 844],
]) {
  const { ctx, page } = await abrir("proprio", largura, altura, "&poucas=1")
  const grelha = await page.evaluate(() => {
    const main = document.querySelector(".main")
    const nomes = getComputedStyle(main)
      .gridTemplateAreas.split('" "')
      .map((n) => n.replace(/"/g, "").trim())
    const alturas = getComputedStyle(main)
      .gridTemplateRows.split(" ")
      .map((v) => Math.round(parseFloat(v)))
    const coluna = document.querySelector(".profile-scroll")
    return {
      porNome: Object.fromEntries(nomes.map((nome, i) => [nome, alturas[i] ?? 0])),
      colunaAltura: Math.round(coluna.getBoundingClientRect().height),
      janela: window.innerHeight,
    }
  })
  const { intro = 0, timeline = 0 } = grelha.porNome
  check(
    `a grelha a ${largura}px: a linha vazia \`intro\` não fica com espaço nenhum`,
    intro === 0,
    `intro ${intro}px, timeline ${timeline}px — ${JSON.stringify(grelha.porNome)}`,
  )
  check(
    `a coluna do perfil a ${largura}px ocupa o ecrã que sobra`,
    grelha.colunaAltura >= grelha.janela - 120,
    `${grelha.colunaAltura}px numa janela de ${grelha.janela}px`,
  )
  await ctx.close()
}

/**
 * Real scrolling: put the mouse over it and turn the wheel, like a person.
 * Moving `scrollTop` from JavaScript scrolls containers that CSS won't let a
 * person scroll, it measures the wrong thing.
 */
async function rolarComARoda(page, seletor) {
  const caixa = await page.locator(seletor).boundingBox()
  await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2)
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(250)
  return page.locator(seletor).evaluate((el) => el.scrollTop)
}

async function medirColuna(page, seletor) {
  return page.locator(seletor).evaluate((el) => {
    const caixa = el.getBoundingClientRect()
    const lista = el.querySelector(".post-list, .post-grid")
    const ultima = lista?.lastElementChild?.getBoundingClientRect()
    return {
      rolavel: el.scrollHeight > el.clientHeight,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      fundo: Math.round(caixa.bottom),
      janela: window.innerHeight,
      /** Where the last list line ends. Below the window is out of reach. */
      ultimaLinhaFundo: ultima ? Math.round(ultima.bottom) : null,
    }
  })
}

for (const [qual, nome] of [
  ["proprio", "o meu perfil"],
  ["pessoa", "o perfil de outra pessoa"],
]) {
  for (const [largura, altura] of [
    [1280, 800],
    [390, 844],
  ]) {
    const seletor = qual === "pessoa" ? ".pagina-da-pessoa .pessoa-corpo" : ".profile-scroll"
    const { ctx, page, erros } = await abrir(qual, largura, altura)
    const etiqueta = `${nome} a ${largura}px`
    check(`${etiqueta}: desenha sem erros de página`, erros.length === 0, erros[0] ?? "")

    const antes = await medirColuna(page, seletor)
    check(
      `${etiqueta}: a coluna das publicações é um scroller a sério`,
      antes.rolavel,
      `${antes.clientHeight}px visíveis de ${antes.scrollHeight}px`,
    )
    check(
      `${etiqueta}: a coluna acaba dentro da janela`,
      antes.fundo <= antes.janela + 1,
      `fundo ${antes.fundo}px numa janela de ${antes.janela}px`,
    )

    const depois = await rolarComARoda(page, seletor)
    check(`${etiqueta}: a roda do rato faz a lista andar`, depois > 40, `scrollTop ${Math.round(depois)}px`)

    const fim = await page.locator(seletor).evaluate((el) => {
      el.scrollTop = el.scrollHeight
      const lista = el.querySelector(".post-list, .post-grid")
      const ultima = lista?.lastElementChild
      return {
        texto: ultima?.textContent?.slice(0, 40) ?? "",
        fundo: ultima ? Math.round(ultima.getBoundingClientRect().bottom) : null,
        janela: window.innerHeight,
      }
    })
    check(
      `${etiqueta}: no fim da lista a última publicação está à vista`,
      fim.fundo !== null && fim.fundo <= fim.janela + 1,
      `última linha acaba em ${fim.fundo}px, janela ${fim.janela}px — "${fim.texto}"`,
    )

    await page.screenshot({ path: join(AQUI, `_saida-perfil-${qual}-${largura}.png`) })
    await ctx.close()
  }
}

// ------------------------------------- the thumbs and comments, expanded
for (const [qual, nome, largura, altura] of [
  ["proprio", "o meu perfil", 1280, 800],
  ["pessoa", "o perfil de outra pessoa", 390, 844],
]) {
  const { ctx, page } = await abrir(qual, largura, altura)
  const etiqueta = `${nome} a ${largura}px`

  await page.locator(".post-row").first().click()
  await page.waitForTimeout(200)

  const votos = await page.evaluate(() =>
    [...document.querySelectorAll(".post-engagement .vote")].map((b) => {
      const caixa = b.getBoundingClientRect()
      return {
        etiqueta: b.getAttribute("aria-label") ?? b.textContent?.trim(),
        largura: Math.round(caixa.width),
        altura: Math.round(caixa.height),
        dentroDaJanela: caixa.bottom <= window.innerHeight + 1 && caixa.top >= -1,
      }
    }),
  )
  check(
    `${etiqueta}: a publicação aberta traz gosto, não gosto e comentar`,
    votos.length === 3,
    JSON.stringify(votos.map((v) => v.etiqueta)),
  )
  check(
    `${etiqueta}: os três botões têm corpo e estão à vista`,
    votos.length === 3 && votos.every((v) => v.largura > 24 && v.altura > 18 && v.dentroDaJanela),
    JSON.stringify(votos),
  )

  // The third button is the comments one: it opens the box.
  await page.locator(".post-engagement .vote.wide").click()
  await page.waitForTimeout(150)
  const caixa = await page.evaluate(() => {
    const entrada = document.querySelector(".comment-composer input")
    const comentario = document.querySelector(".comment-text")
    const r = entrada?.getBoundingClientRect()
    return {
      temEntrada: !!entrada,
      entradaLarga: r ? Math.round(r.width) : 0,
      texto: comentario?.textContent ?? "",
      dentro: r ? r.bottom <= window.innerHeight + 1 : false,
    }
  })
  check(`${etiqueta}: a caixa de comentar aparece e tem largura`, caixa.temEntrada && caixa.entradaLarga > 80, JSON.stringify(caixa))
  check(`${etiqueta}: o comentário que já lá estava lê-se`, caixa.texto.includes("Muito bom"), caixa.texto)

  /**
   * And a text post does NOT get a stage.
   *
   * The stage is black and takes up half the sheet; giving it to a post with no
   * photos would be opening a void next to the words. Content decides, and this
   * is the half of the choice you don't see in captures with photos.
   */
  check(
    `${etiqueta}: uma publicação de texto abre sem palco de fotografia`,
    (await page.locator(".post-open").count()) === 0,
    `${await page.locator(".post-open").count()} palcos`,
  )

  await page.screenshot({ path: join(AQUI, `_saida-perfil-${qual}-publicacao.png`) })
  await ctx.close()
}

// ------------------------- the photo post expanded: who is the stage
//
// Two complaints from the owner, months apart, same place.
//
// First: in the profile, an expanded post didn't show the photo large; in the
// feed it did. Fixed, the image became a button and the zoom sheet came into
// `PostDetail`, and it's the second half of this block that locks it down.
//
// Second, this one: "posts in profile (photos) are only opening the text".
// And it was true AFTER the fix. The post opened as a 460px card in the middle
// of a 1280 screen, with the title on top, caption next, and photos shrunk to a
// strip of two 203px thumbnails below the words. The photo was there, opened
// large on the second click, and text still ruled.
//
// That's why these measurements don't ask "does the image exist?", they ask
// whose stage it is. Area, relative position, and who's on top: things only a
// layout engine can answer, and jsdom would hand back as zero.
for (const [qual, nome, largura, altura] of [
  ["proprio", "o meu perfil", 1280, 800],
  ["proprio", "o meu perfil", 390, 844],
  ["pessoa", "o perfil de outra pessoa", 1280, 800],
  ["pessoa", "o perfil de outra pessoa", 390, 844],
]) {
  const { ctx, page, erros } = await abrir(qual, largura, altura, "&fotos=1")
  const etiqueta = `${nome} a ${largura}px, com fotografias`
  const largo = largura >= 900
  check(`${etiqueta}: desenha sem erros de página`, erros.length === 0, erros[0] ?? "")

  /** The grid thumbnail, measured BEFORE opening: it's the ruler for "large". */
  const miniatura = await page
    .locator(".post-tile img")
    .first()
    .evaluate((img) => Math.round(img.getBoundingClientRect().width))

  await page.locator(".post-tile").first().click()
  await page.waitForTimeout(250)

  /**
   * Who takes up what, on the expanded sheet.
   *
   * All in calculated pixels and with images decoded on purpose: a broken `<img>`
   * still has a box if CSS gives it one, and a measurement that accepted that
   * would say "the photo is huge" looking at a hole.
   */
  const palco = await page.evaluate(async () => {
    const img = document.querySelector(".carrossel-palco img")
    if (img && !img.complete) await img.decode().catch(() => null)
    const caixa = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        x: Math.round(r.left),
        y: Math.round(r.top),
        largura: Math.round(r.width),
        altura: Math.round(r.height),
        direita: Math.round(r.right),
        fundo: Math.round(r.bottom),
      }
    }
    return {
      folha: caixa(document.querySelector(".sheet")),
      aberta: caixa(document.querySelector(".post-open")),
      fotografia: caixa(img),
      descodificada: img ? img.naturalWidth > 0 : false,
      lado: caixa(document.querySelector(".post-open-lado")),
      titulo: caixa(document.querySelector(".post-open-lado .post-title")),
      conta: document.querySelector(".carrossel-conta")?.textContent ?? "",
      janela: { largura: window.innerWidth, altura: window.innerHeight },
    }
  })

  check(
    `${etiqueta}: a fotografia abre grande e descodifica`,
    palco.fotografia !== null &&
      palco.descodificada &&
      palco.fotografia.largura >= (largo ? 600 : 320) &&
      palco.fotografia.altura >= 220,
    JSON.stringify(palco.fotografia) + ` descodificada=${palco.descodificada}`,
  )

  /**
   * The owner's ruler: how much larger than the thumbnail you came from.
   *
   * Before this design the expanded photo measured 203px on a 1280 screen and
   * the grid thumbnail measured 203px too, opening the post didn't make the
   * photo a single pixel larger. That's the complaint, and this is the number.
   */
  check(
    `${etiqueta}: aberta, a fotografia é muito maior do que o quadrado do mosaico`,
    palco.fotografia !== null && palco.fotografia.largura >= miniatura * 2,
    `${palco.fotografia?.largura}px aberta contra ${miniatura}px no mosaico`,
  )

  /** Of the stage the sheet gives the post, how much is photo and how much is text. */
  const areaFoto = palco.fotografia ? palco.fotografia.largura * palco.fotografia.altura : 0
  const areaAberta = palco.aberta ? palco.aberta.largura * palco.aberta.altura : 1
  check(
    `${etiqueta}: a fotografia leva a maior fatia da publicação aberta`,
    areaFoto / areaAberta >= 0.33,
    `${Math.round((areaFoto / areaAberta) * 100)}% da área — foto ${areaFoto}px², publicação ${areaAberta}px²`,
  )

  /**
   * And the photo comes FIRST, no matter the design.
   *
   * On a wide screen that means left of the conversation at the same height; on
   * mobile it means above it. Both statements are the same sentence, the photo
   * is not a text accessory, measured in each layout.
   */
  if (largo) {
    check(
      `${etiqueta}: a fotografia fica à ESQUERDA da conversa, lado a lado`,
      palco.fotografia !== null &&
        palco.lado !== null &&
        palco.fotografia.direita <= palco.lado.x + 1 &&
        palco.fotografia.y < palco.lado.fundo &&
        palco.lado.y < palco.fotografia.fundo,
      `foto ${JSON.stringify(palco.fotografia)} · conversa ${JSON.stringify(palco.lado)}`,
    )
    check(
      `${etiqueta}: e a coluna da fotografia é a mais larga das duas`,
      palco.fotografia !== null && palco.lado !== null && palco.fotografia.largura > palco.lado.largura,
      `foto ${palco.fotografia?.largura}px, conversa ${palco.lado?.largura}px`,
    )
  } else {
    check(
      `${etiqueta}: a fotografia fica POR CIMA da conversa, empilhada`,
      palco.fotografia !== null && palco.lado !== null && palco.fotografia.fundo <= palco.lado.y + 1,
      `foto acaba em ${palco.fotografia?.fundo}px, conversa começa em ${palco.lado?.y}px`,
    )
    check(
      `${etiqueta}: e ocupa a largura toda da folha`,
      palco.fotografia !== null &&
        palco.folha !== null &&
        palco.fotografia.largura >= palco.folha.largura - 4,
      `foto ${palco.fotografia?.largura}px numa folha de ${palco.folha?.largura}px`,
    )
  }

  check(
    `${etiqueta}: o título da publicação vem depois da fotografia, não antes`,
    palco.titulo !== null && palco.fotografia !== null && palco.titulo.y >= palco.fotografia.y,
    `título em ${palco.titulo?.y}px, fotografia em ${palco.fotografia?.y}px`,
  )

  check(
    `${etiqueta}: a folha inteira cabe na janela`,
    palco.folha !== null && palco.folha.fundo <= palco.janela.altura + 1 && palco.folha.y >= -1,
    JSON.stringify(palco.folha) + ` numa janela de ${palco.janela.altura}px`,
  )

  /**
   * Thumbs and comments are visible WITHOUT clicking anything.
   *
   * In the feed the box opens on demand, and should: thirty posts all expanded
   * would be a wall. Here there's a whole column next to the photo, and leaving
   * it blank waiting for a click would waste the space you just gave it.
   */
  const conversa = await page.evaluate(() => {
    const botoes = [...document.querySelectorAll(".post-engagement .vote")].map((b) => {
      const r = b.getBoundingClientRect()
      return {
        etiqueta: b.getAttribute("aria-label") ?? b.textContent?.trim(),
        largura: Math.round(r.width),
        altura: Math.round(r.height),
        dentro: r.bottom <= window.innerHeight + 1 && r.top >= -1,
      }
    })
    const comentario = document.querySelector(".comment-text")
    const r = comentario?.getBoundingClientRect()
    return {
      botoes,
      comentario: comentario?.textContent ?? "",
      comentarioDentro: r ? r.bottom <= window.innerHeight + 1 && r.top >= -1 : false,
    }
  })
  check(
    `${etiqueta}: gosto, não gosto e comentários estão à vista por baixo dela`,
    conversa.botoes.length === 3 && conversa.botoes.every((b) => b.largura > 24 && b.altura > 18 && b.dentro),
    JSON.stringify(conversa.botoes),
  )
  check(
    `${etiqueta}: o comentário que já lá estava lê-se sem abrir nada`,
    conversa.comentario.includes("Muito bom") && conversa.comentarioDentro,
    `"${conversa.comentario}" dentro=${conversa.comentarioDentro}`,
  )

  await page.screenshot({ path: join(AQUI, `_saida-perfil-${qual}-fotografia-${largura}.png`) })

  // ----------------------------------------- move from first to second
  //
  // Two photos in one post and only one at a time on stage: with no way to move,
  // the second stopped existing. Three ways, because three different people reach
  // it different ways, and what matters to measure is the RESULT: different bytes
  // on stage, and the counter saying which one we're on.
  const bytesDe = () => page.locator(".carrossel-palco img").getAttribute("src")
  const primeira = await bytesDe()
  check(`${etiqueta}: o contador diz em qual das fotografias vamos`, palco.conta === "1/2", palco.conta)

  await page.locator(".carrossel-passo.seguinte").click()
  await page.waitForTimeout(200)
  const depoisDaSeta = await page.evaluate(() => ({
    conta: document.querySelector(".carrossel-conta")?.textContent ?? "",
    pontoAgora: [...document.querySelectorAll(".carrossel-pontos .ponto")].findIndex((p) =>
      p.classList.contains("agora"),
    ),
  }))
  check(
    `${etiqueta}: a seta leva à segunda fotografia`,
    (await bytesDe()) !== primeira && depoisDaSeta.conta === "2/2" && depoisDaSeta.pontoAgora === 1,
    JSON.stringify(depoisDaSeta),
  )

  // The keyboard, with focus on the arrow just pressed.
  await page.keyboard.press("ArrowLeft")
  await page.waitForTimeout(200)
  check(
    `${etiqueta}: a seta do teclado volta atrás`,
    (await bytesDe()) === primeira,
    `contador ${await page.locator(".carrossel-conta").textContent()}`,
  )

  /**
   * And the finger dragging, which is how you move between photos on mobile.
   *
   * Dragged with the mouse on purpose: pointer events are the same, so this
   * measures at both widths instead of just mobile. What's being measured isn't
   * just the move, it's also that the click the browser fires after a drag does
   * NOT open the zoom sheet. Without that guard, every photo move ended with the
   * image full screen.
   */
  const caixaDoPalco = await page.locator(".carrossel-palco").boundingBox()
  const meioY = caixaDoPalco.y + caixaDoPalco.height / 2
  await page.mouse.move(caixaDoPalco.x + caixaDoPalco.width * 0.7, meioY)
  await page.mouse.down()
  await page.mouse.move(caixaDoPalco.x + caixaDoPalco.width * 0.7 - 120, meioY, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  check(
    `${etiqueta}: arrastar o dedo passa à fotografia seguinte`,
    (await bytesDe()) !== primeira,
    `contador ${await page.locator(".carrossel-conta").textContent()}`,
  )
  check(
    `${etiqueta}: e o arrasto não abre a ampliação por engano`,
    (await page.locator(".lightbox").count()) === 0,
    `${await page.locator(".lightbox").count()} ampliações abertas`,
  )

  // -------------------------------------- and the zoom, already here
  //
  // The earlier fix doesn't get lost because of this one: clicking the photo still
  // opens it at screen size, with the SAME bytes already on stage. Nothing here
  // fetches anything from anywhere, the only way this works in a product where the
  // image traveled encrypted inside the message.
  const noPalco = await bytesDe()
  await page.locator(".carrossel-palco .image-open").click()
  await page.waitForTimeout(250)
  const ampliada = await page.evaluate(async () => {
    const img = document.querySelector(".lightbox img")
    if (!img) return { existe: false }
    if (!img.complete) await img.decode().catch(() => null)
    const caixa = img.getBoundingClientRect()
    return {
      existe: true,
      largura: Math.round(caixa.width),
      altura: Math.round(caixa.height),
      descodificada: img.naturalWidth > 0,
      bytes: img.getAttribute("src"),
    }
  })
  check(`${etiqueta}: clicar na fotografia abre-a do tamanho do ecrã`, ampliada.existe, JSON.stringify(ampliada))
  check(
    `${etiqueta}: e é a fotografia que estava em palco, não a primeira`,
    ampliada.existe && ampliada.descodificada && ampliada.bytes === noPalco,
    `bytes iguais=${ampliada.bytes === noPalco}, descodificada=${ampliada.descodificada}`,
  )
  await page.screenshot({ path: join(AQUI, `_saida-perfil-${qual}-ampliada-${largura}.png`) })

  /**
   * Escape closes the zoom and ONLY the zoom.
   *
   * The profile sheet already warned that two stacked sheets both listen for
   * Escape on the document and one key closes both. The zoom is the second sheet;
   * if it closed the profile behind it, someone pressing Escape to exit a photo
   * would lose where they were reading.
   */
  await page.keyboard.press("Escape")
  await page.waitForTimeout(250)
  const depoisDoEscape = await page.evaluate(() => ({
    ampliacao: !!document.querySelector(".lightbox"),
    publicacao: !!document.querySelector(".carrossel-palco img"),
    perfil: !!document.querySelector(".profile-scroll, .pagina-da-pessoa"),
  }))
  check(
    `${etiqueta}: Escape fecha a ampliação e deixa a publicação aberta`,
    !depoisDoEscape.ampliacao && depoisDoEscape.publicacao && depoisDoEscape.perfil,
    JSON.stringify(depoisDoEscape),
  )

  await ctx.close()
}

// ------------------------------------------ one photo alone, no decorations
//
// The case that's not a weaker version of the other: with ONE photo there can be
// no arrows or dots. An arrow that appears with nowhere to go promises a second
// photo that doesn't exist, and you only catch it by explicitly asking for a
// post with a single image.
for (const [qual, nome, largura, altura] of [
  ["proprio", "o meu perfil", 1280, 800],
  ["pessoa", "o perfil de outra pessoa", 390, 844],
]) {
  const { ctx, page } = await abrir(qual, largura, altura, "&fotos=1&uma=1")
  const etiqueta = `${nome} a ${largura}px, com uma fotografia só`

  await page.locator(".post-tile").first().click()
  await page.waitForTimeout(250)

  const sozinha = await page.evaluate(async () => {
    const img = document.querySelector(".carrossel-palco img")
    if (img && !img.complete) await img.decode().catch(() => null)
    const r = img?.getBoundingClientRect()
    return {
      fotografia: r ? { largura: Math.round(r.width), altura: Math.round(r.height) } : null,
      descodificada: img ? img.naturalWidth > 0 : false,
      setas: document.querySelectorAll(".carrossel-passo").length,
      pontos: document.querySelectorAll(".carrossel-pontos .ponto").length,
      conta: document.querySelectorAll(".carrossel-conta").length,
    }
  })

  check(
    `${etiqueta}: a fotografia enche o palco na mesma`,
    sozinha.fotografia !== null &&
      sozinha.descodificada &&
      sozinha.fotografia.largura >= (largura >= 900 ? 600 : 320),
    JSON.stringify(sozinha.fotografia),
  )
  check(
    `${etiqueta}: sem setas, sem pontos e sem contador`,
    sozinha.setas === 0 && sozinha.pontos === 0 && sozinha.conta === 0,
    JSON.stringify(sozinha),
  )

  await ctx.close()
}

await browser.close()
const falhados = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhados}/${resultados.length}`)
process.exit(falhados === 0 ? 0 : 1)
