/**
 * The account card and the call dock, on the same screen.
 *
 * The dock is `position: fixed` stuck to the bottom right corner; the card lives
 * at the bottom of the left column. On wide screens they sit side by side, but
 * on narrow screens the column is a drawer that slides over the page and both
 * compete for the same bottom band. No jsdom test knows this: it is geometry of
 * two positioned things, and only a real layout engine calculates it.
 *
 *   node scripts/medir-cartao-com-doca.mjs
 *
 * What is locked down here:
 *   1. on wide screens, the dock does not touch the card;
 *   2. on narrow screens, if they overlap, the dock is ON TOP, it is what is
 *      happening now, and disappearing behind a drawer would lose the disconnect
 *      button;
 *   3. the card did not grow: the taller it is, the more the dock hides. This
 *      measurement prevents a polish pass from making this worse without notice,
 *      so the number is written down and checked.
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { alvo } from "./ambiente.mjs"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-cartao-com-doca")
const RAIZ = join(AQUI, "..")

mkdirSync(SAIDA, { recursive: true })

/**
 * The card height before this polish pass, measured.
 *
 * It is not a nice number: it is what the dock hides when both overlap in a
 * narrow drawer. If it grows, more gets hidden, and that growth must be a
 * decision, not a side effect of changing a `padding`.
 */
const ALTURA_MAXIMA = 124

/**
 * The fake address server, taken from `ambiente.mjs`.
 *
 * Nothing here connects anywhere, it is a `file://` with a stylesheet, but
 * the production name is not written in any script. See `guioes.producao.test.ts`:
 * the lock only holds as long as it is the only path.
 */
const CASA = alvo()

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { CartaoDaConta } from ${JSON.stringify(join(RAIZ, "packages/ui/src/screens/profile/CartaoDaConta.js"))}
import { CallDock } from ${JSON.stringify(join(RAIZ, "packages/ui/src/screens/call/CallDock.js"))}
import { ToastContext } from ${JSON.stringify(join(RAIZ, "packages/ui/src/components/Toast.js"))}
import ${JSON.stringify(join(RAIZ, "packages/ui/src/styles.css"))}

const p = new URLSearchParams(location.search)

/** Duas pessoas na chamada, que é o que dá à doca a largura do caso real. */
const participantes = [
  { address: "@bruno:${CASA}", connected: true, stream: null },
  { address: "@carla:${CASA}", connected: true, stream: null },
]

createRoot(document.getElementById("raiz")).render(
  <ToastContext.Provider value={() => {}}>
    <div className="app">
      <div className="rail" />
      <aside className="sidebar open">
        <div className="sidebar-header">Comunidades</div>
        <div className="sidebar-body" />
        <CartaoDaConta
          profile={{ displayName: "Ana", donations: [], statusText: "A fazer pão" }}
          address="@garbicis-xapsensis-giprete-birmyris:${CASA}"
          activity="online"
          onActivityMenu={() => {}}
          onEditProfile={() => {}}
          onNotifications={() => {}}
          unreadNotifications={2}
          micMuted={false}
          soundOff={false}
          onToggleMic={() => {}}
          onToggleSound={() => {}}
          onMicMenu={() => {}}
          onSoundMenu={() => {}}
          latencia={null}
          onLatenciaHover={() => {}}
          onSaveStatus={() => {}}
        />
      </aside>
      <main className="main" />
      <CallDock
        channel="!abc:${CASA}"
        channelLabel="Direcção"
        roomLabel="reunião"
        participants={participantes}
        localStream={null}
        nameFor={(quem) => quem.slice(1, 6)}
        onBack={() => {}}
        onLeave={() => {}}
      />
    </div>
  </ToastContext.Provider>,
)
`,
  "utf8",
)

await build({
  entryPoints: [ENTRADA],
  bundle: true,
  outfile: join(SAIDA, "pagina.js"),
  jsx: "automatic",
  loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts", ".json": "json", ".woff2": "file" },
  external: ["@sapphi-red/*"],
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

async function medir(largura, altura) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(`file://${join(SAIDA, "index.html")}`)
  await page.waitForSelector(".me-faixa")
  await page.waitForSelector(".call-dock")
  await page.mouse.move(2, 2)

  const dados = await page.evaluate(() => {
    const cartao = document.querySelector(".me-faixa").getBoundingClientRect()
    const doca = document.querySelector(".call-dock").getBoundingClientRect()
    const cruzam =
      cartao.left < doca.right && doca.left < cartao.right && cartao.top < doca.bottom && doca.top < cartao.bottom
    /*
      Which comes on top, asked to the engine not deduced from CSS: two
      elements with the same `z-index` resolve by document order, and
      that count done by hand is what we get wrong.
    */
    const meio = { x: (Math.max(cartao.left, doca.left) + Math.min(cartao.right, doca.right)) / 2, y: (Math.max(cartao.top, doca.top) + Math.min(cartao.bottom, doca.bottom)) / 2 }
    const noCruzamento = cruzam ? document.elementFromPoint(meio.x, meio.y) : null
    return {
      cartao: { altura: Math.round(cartao.height), topo: Math.round(cartao.top), fundo: Math.round(cartao.bottom) },
      doca: { largura: Math.round(doca.width), esquerda: Math.round(doca.left), topo: Math.round(doca.top) },
      cruzam,
      docaPorCima: noCruzamento ? noCruzamento.closest(".call-dock") !== null : null,
      // The disconnect button must always fit entirely in the window.
      desligarDentro: (() => {
        const r = document.querySelector(".call-dock .hangup").getBoundingClientRect()
        return r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight
      })(),
    }
  })

  return { ctx, page, erros, dados }
}

// ------------------------------------------------------- 1280px: side by side
{
  const { ctx, page, erros, dados } = await medir(1280, 800)
  check("com a doca no ecrã, nada rebenta", erros.length === 0, erros[0] ?? "")
  check("em ecrã largo a doca não toca no cartão", !dados.cruzam, JSON.stringify(dados))
  check("e o botão de desligar está inteiro na janela", dados.desligarDentro)
  check(
    `o cartão não cresceu (tecto de ${ALTURA_MAXIMA}px)`,
    dados.cartao.altura <= ALTURA_MAXIMA,
    `${dados.cartao.altura}px`,
  )
  await page.screenshot({ path: join(AQUI, "_saida-cartao-com-doca-1280.png") })
  await ctx.close()
}

// -------------------------------- 390px: drawer and dock in the same band
{
  const { ctx, page, erros, dados } = await medir(390, 780)
  check("a 390px também não rebenta", erros.length === 0, erros[0] ?? "")
  console.log(`  --   cruzam-se: ${dados.cruzam ? "sim" : "não"} (doca a ${dados.doca.esquerda}px, ${dados.doca.largura}px de largo)`)
  check(
    "se se cruzarem, é a doca que fica por cima: é ela que tem o desligar",
    !dados.cruzam || dados.docaPorCima === true,
    `porCima=${dados.docaPorCima}`,
  )
  check("e o botão de desligar continua inteiro na janela", dados.desligarDentro)
  check(
    `o cartão não cresceu (tecto de ${ALTURA_MAXIMA}px)`,
    dados.cartao.altura <= ALTURA_MAXIMA,
    `${dados.cartao.altura}px`,
  )
  await page.screenshot({ path: join(AQUI, "_saida-cartao-com-doca-390.png") })
  await ctx.close()
}

await browser.close()
const falhados = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhados}/${resultados.length}`)
process.exit(falhados === 0 ? 0 : 1)
