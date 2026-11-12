/**
 * The Contacts screen, measured in a real layout engine.
 *
 * This exists instead of more tests because the tests for this screen run in
 * jsdom, and **jsdom applies no stylesheets at all.** It says the search box
 * exists and the list has eight rows; it does not know if it is centered in the
 * body or stuck to the left, or if the list scrolls inside the screen or grows
 * below it and out of reach. "Centered" and "aligned" are calculated pixels,
 * and to have them you need a browser.
 *
 *   node scripts/medir-contactos.mjs
 *   ANTIGO=1 node scripts/medir-contactos.mjs
 *
 * The second form restores the previous layout by CSS, the column stuck to the
 * left, with no center axis, and the measurements that bite must show RED. If
 * they match in both, they are not measuring anything. It is the same trick the
 * old account card script used, and it exists for the same reason: a measurement
 * that passes with the bug restored is not a measurement, it is a pep talk.
 *
 * What it DOES NOT prove: that search filters correctly (that is
 * `PeopleScreen.test.tsx`, in jsdom, which is where that question is answered
 * well).
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { alvo } from "./ambiente.mjs"

const AQUI = dirname(fileURLToPath(import.meta.url))
/* Captures of the restored layout do not overwrite the good ones: whoever runs
   both forms wants to put them side by side. */
const MARCA = process.env.ANTIGO ? "-antigo" : ""
const SAIDA = join(AQUI, ".saida-contactos")
const RAIZ = join(AQUI, "..")

mkdirSync(SAIDA, { recursive: true })

/**
 * Eight people: more than fits at a glance and less than needs scrolling at
 * 900px height. The number matters because the question is about the AXIS of the
 * column, and a two-row list centers itself by accident in any layout.
 */
const NOMES = [
  "Ana Bivar",
  "Bruno Cardoso",
  "Célia Matos",
  "Duarte Nunes",
  "Eva Pinto",
  "Filipe Rocha",
  "Gabriela Sá",
  "Hugo Teles",
]

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { PeopleScreen } from ${JSON.stringify(join(RAIZ, "packages/ui/src/screens/people/PeopleScreen.js"))}
import { PeopleDestination } from ${JSON.stringify(join(RAIZ, "packages/ui/src/screens/people/PeopleDestination.js"))}
import { ToastContext } from ${JSON.stringify(join(RAIZ, "packages/ui/src/components/Toast.js"))}
import ${JSON.stringify(join(RAIZ, "packages/ui/src/styles.css"))}

const NOMES = ${JSON.stringify(NOMES)}
const SERVIDOR = ${JSON.stringify(alvo())}

const enderecoDe = (nome) =>
  "@" + nome.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "") + ":" + SERVIDOR

const directory = new Map(
  NOMES.map((nome, i) => [
    enderecoDe(nome),
    { displayName: nome, donations: [], statusText: i % 2 ? "a fazer pão" : "" },
  ]),
)
const amigos = new Set(directory.keys())

function Demo() {
  return (
    <ToastContext.Provider value={() => {}}>
      {/* \`sem-barra\` é o que Amigos usa: duas colunas, sem a barra dos canais.
          Sem ela o destino cai na coluna de 236px, a de \`1fr\` fica vazia, e
          mede-se um corpo de zero de largura. */}
      <div className="app sem-barra">
        {/* O carril ocupa a primeira coluna da grelha da aplicação. Sem ele o
            corpo começa no zero e mede-se um eixo que ninguém vê. */}
        <div className="rail" />
        <PeopleDestination
          tab="todos"
          onTab={() => {}}
          pending={0}
          aside={{
            directs: [],
            active: null,
            unreads: new Map(),
            directory,
            nameFor: (a) => a,
            onOpen: () => {},
            onClose: () => {},
          }}
          conversaAberta={false}
          listaAberta={false}
          onOpenLista={() => {}}
          onCloseLista={() => {}}
        >
          <PeopleScreen
            directory={directory}
            me={null}
            connection="online"
            connectionDetail={null}
            friends={amigos}
            tab="todos"
            onMessage={() => {}}
            onOpenProfile={() => {}}
          />
        </PeopleDestination>
      </div>
    </ToastContext.Provider>
  )
}

createRoot(document.getElementById("raiz")).render(<Demo />)
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

/**
 * The PREVIOUS layout, restored by CSS.
 *
 * It is not a faithful reconstruction of the old commit, it is enough to bring
 * back the bug that these measurements say has gone away: the column starting at
 * the left margin of the body instead of on an axis, and the list growing past
 * the bottom of the screen instead of scrolling inside it.
 */
const ANTIGO = `
  .people-scroll { align-items: stretch; }
  .people-search, .people-list, .people-section, .people-requests, .people-add { max-width: none; }
  /* A linha da grelha que dava altura ao corpo, outra vez desalinhada das
     áreas: a lista deixa de ter caixa e cresce por baixo do ecrã. */
  .main.sem-cabecalho { grid-template-rows: auto 0 auto auto minmax(0, 1fr) auto auto; }
`

writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="pagina.css">` +
    (process.env.ANTIGO ? `<style>${ANTIGO}</style>` : "") +
    `<body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

const browser = await chromium.launch()
const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push({ etiqueta, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? ` — ${detalhe}` : ""}`)
}

async function abrir(largura, altura) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(`file://${join(SAIDA, "index.html")}`)
  await page.waitForSelector(".people-list", { timeout: 10_000 })
  return { ctx, page, erros }
}

/** The boxes that matter, rounded, from the viewer's point of view. */
const CAIXAS = `
  (() => {
    const caixa = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        esquerda: Math.round(r.left),
        direita: Math.round(r.right),
        largura: Math.round(r.width),
        topo: Math.round(r.top),
        fundo: Math.round(r.bottom),
        centro: Math.round(r.left + r.width / 2),
      }
    }
    const corpo = document.querySelector(".people-column")
    const rolo = document.querySelector(".people-scroll")
    return {
      corpo: caixa(".people-column"),
      faixa: caixa(".people-bar"),
      rolo: caixa(".people-scroll"),
      busca: caixa(".people-search"),
      lista: caixa(".people-list"),
      seccao: caixa(".people-section"),
      linha: caixa(".person-row"),
      // A caixa de conteúdo do rolo, sem o enchimento: é contra ela que se
      // pergunta se a lista usa a largura toda, e não contra a caixa de fora.
      roloDentro: rolo
        ? {
            esquerda: Math.round(rolo.getBoundingClientRect().left + parseFloat(getComputedStyle(rolo).paddingLeft)),
            direita: Math.round(rolo.getBoundingClientRect().right - parseFloat(getComputedStyle(rolo).paddingRight)),
            topo: Math.round(rolo.getBoundingClientRect().top + parseFloat(getComputedStyle(rolo).paddingTop)),
            largura: Math.round(
              rolo.clientWidth -
                parseFloat(getComputedStyle(rolo).paddingLeft) -
                parseFloat(getComputedStyle(rolo).paddingRight),
            ),
          }
        : null,
      // Rola dentro de si, ou cresce por baixo do ecrã?
      rolaDentro: rolo ? rolo.scrollHeight <= rolo.clientHeight + 1 || rolo.clientHeight < rolo.scrollHeight : null,
      alturaVisivel: rolo ? Math.round(rolo.clientHeight) : 0,
      alturaTotal: rolo ? Math.round(rolo.scrollHeight) : 0,
      janela: window.innerHeight,
      corpoCentro: corpo ? Math.round(corpo.getBoundingClientRect().left + corpo.getBoundingClientRect().width / 2) : 0,
    }
  })()
`

// ------------------------------------------------- 1440px: a janela larga
{
  const { ctx, page, erros } = await abrir(1440, 900)
  check("o ecrã desenha sem erros de página", erros.length === 0, erros[0] ?? "")

  const m = await page.evaluate(CAIXAS)

  /*
    The axis. The owner's question was this and nothing else: the search box and
    the list centered in the body. Measure the center of each one against the
    center of the column where they live, not against the center of the WINDOW,
    which includes the sidebar and the conversation column and was never the axis
    of anything.
    
    Two pixels of tolerance: an overlay scrollbar or a half-pixel rounding are
    not a misalignment.
    */
  check(
    "a caixa de procura está ao centro do corpo",
    Math.abs(m.busca.centro - m.corpoCentro) <= 2,
    `procura ${m.busca.centro}, corpo ${m.corpoCentro} (procura ${m.busca.esquerda}→${m.busca.direita})`,
  )
  check(
    "a lista está ao centro do corpo",
    Math.abs(m.lista.centro - m.corpoCentro) <= 2,
    `lista ${m.lista.centro}, corpo ${m.corpoCentro} (lista ${m.lista.esquerda}→${m.lista.direita})`,
  )
  check(
    "e as duas partilham o mesmo eixo, uma por cima da outra",
    Math.abs(m.busca.centro - m.lista.centro) <= 1 && Math.abs(m.busca.esquerda - m.lista.esquerda) <= 1,
    `procura ${m.busca.esquerda}→${m.busca.direita}, lista ${m.lista.esquerda}→${m.lista.direita}`,
  )

  /*
    A column that is centered and stretched edge to edge is the same as not being
    centered: the axis only shows when there is margin left over on both sides.
    Real margin is required, at least 40px on each side in a 1440px window.
  */
  const margemEsquerda = m.lista.esquerda - m.rolo.esquerda
  const margemDireita = m.rolo.direita - m.lista.direita
  check(
    "sobra margem dos dois lados, senão o eixo não se vê",
    margemEsquerda >= 40 && margemDireita >= 40,
    `esquerda ${margemEsquerda}px, direita ${margemDireita}px`,
  )
  check(
    "e as duas margens são iguais",
    Math.abs(margemEsquerda - margemDireita) <= 2,
    `esquerda ${margemEsquerda}px, direita ${margemDireita}px`,
  )

  /*
    The VERTICAL axis, which is where the bug was and where the width
    measurements were not looking.

    The `.main` grid declares eight areas and the headerless variant gave it seven
    heights. Each value slid an area, the license to grow went to an empty line
    above the list, and search appeared stuck to the BOTTOM of the screen with
    250px of nothing on top. Horizontally it was centered the whole time, which is
    why only measuring the horizontal axis said everything was fine.

    Measure against the bottom of the TOP BAR, never against the top of the
    scroll itself: the empty line pushed the entire SCROLL down, so search still
    started at zero pixels from its top. A measurement made in there passed with
    the bug in sight, that is what happened to the first version of this line,
    and is why `ANTIGO=1` exists.
  */
  const descaida = m.rolo.topo - m.faixa.fundo
  check(
    "a lista começa logo abaixo da faixa, e não empurrada para o fundo do ecrã",
    descaida <= 4,
    `${descaida}px de vazio entre a faixa e a lista`,
  )
  check(
    "e a lista vem logo a seguir, sem um buraco pelo meio",
    m.seccao.topo - m.busca.fundo <= 32,
    `${m.seccao.topo - m.busca.fundo}px entre a procura e a lista`,
  )

  await page.screenshot({ path: join(AQUI, `_saida-contactos-1440${MARCA}.png`) })
  await ctx.close()
}

// ------------------------------------------------- the list scrolls INSIDE the screen
{
  // Set low on purpose: eight rows do not fit, and that is where you find out if
  // the scrollbar has height or if the list goes off the bottom of the world.
  const { ctx, page } = await abrir(1440, 520)
  const m = await page.evaluate(CAIXAS)
  check(
    "a lista rola dentro do corpo em vez de crescer por baixo do ecrã",
    m.alturaVisivel > 0 && m.alturaVisivel <= m.janela,
    `visível ${m.alturaVisivel}px, total ${m.alturaTotal}px, janela ${m.janela}px`,
  )
  check(
    "e a última linha fica ao alcance do rato, dentro da janela",
    m.rolo.fundo <= m.janela + 1,
    `fundo do rolo ${m.rolo.fundo}px, janela ${m.janela}px`,
  )
  await ctx.close()
}

// ------------------------------------------------- 390px: the phone
{
  const { ctx, page } = await abrir(390, 800)
  const m = await page.evaluate(CAIXAS)
  check(
    "num telefone a lista usa a largura toda, sem margens a roubar espaço",
    m.lista.largura >= m.roloDentro.largura - 2,
    `lista ${m.lista.largura}px, dentro do rolo ${m.roloDentro.largura}px`,
  )
  check(
    "e a lista continua encostada à faixa, também aqui",
    m.rolo.topo - m.faixa.fundo <= 4,
    `${m.rolo.topo - m.faixa.fundo}px de vazio entre a faixa e a lista`,
  )
  check(
    "e nada transborda para a direita da janela",
    m.lista.direita <= 390 && m.busca.direita <= 390,
    `lista até ${m.lista.direita}, procura até ${m.busca.direita}`,
  )
  await page.screenshot({ path: join(AQUI, `_saida-contactos-390${MARCA}.png`) })
  await ctx.close()
}

await browser.close()

const falhas = resultados.filter((r) => !r.ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} passaram`)
if (process.env.ANTIGO) {
  console.log("Com ANTIGO=1, as medições do eixo TÊM de falhar. Se passaram, não estão a medir nada.")
}
process.exit(falhas > 0 && !process.env.ANTIGO ? 1 : 0)
