/**
 * Moving someone to another voice room, measured on a real layout engine.
 *
 * The gesture is two: drag the person over a room, or open their menu and pick
 * the target. Both existed and neither showed, the row was draggable without
 * saying so when still, and the menu targets came after a line, like siblings of
 * "View profile".
 *
 * Why this exists instead of another test: jsdom proves the class enters and
 * `onMovePerson` is called, and that is what `ChannelSidebar.test.tsx` does.
 * What it does not prove there is what a person SEES: whether the handle has
 * enough contrast to notice, whether candidate rooms stand out from the one under
 * the cursor, whether the menu label reads as a header and not as another entry.
 * **jsdom applies no stylesheets**, and none of those questions answer without
 * pixels.
 *
 *   node scripts/medir-mover-para-sala.mjs
 *   ANTIGO=1 node scripts/medir-mover-para-sala.mjs
 *
 * The second form restores the old design by CSS, handle hidden, candidate rooms
 * with no mark, menu label invisible, and measurements that bite must turn RED.
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { alvo } from "./ambiente.mjs"

const AQUI = dirname(fileURLToPath(import.meta.url))
const MARCA = process.env.ANTIGO ? "-antigo" : ""
const SAIDA = join(AQUI, ".saida-mover")
const RAIZ = join(AQUI, "..")

mkdirSync(SAIDA, { recursive: true })

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { ChannelSidebar } from ${JSON.stringify(join(RAIZ, "packages/ui/src/screens/chat/ChannelSidebar.js"))}
import { ToastContext } from ${JSON.stringify(join(RAIZ, "packages/ui/src/components/Toast.js"))}
import { ContextMenu } from ${JSON.stringify(join(RAIZ, "packages/ui/src/screens/overlays/ContextMenu.js"))}
import { itensDaPessoaEmVoz } from ${JSON.stringify(join(RAIZ, "packages/ui/src/screens/chat/menuItems.js"))}
import ${JSON.stringify(join(RAIZ, "packages/ui/src/styles.css"))}

/** Três salas de voz e uma de texto: destinos que cheguem para o mapa se ver. */
const sala = (room, name, kind, position) => ({ room, name, category: "Produção", kind, position })
const GRUPOS = [
  {
    category: "Produção",
    rooms: [
      sala("r1", "avisos", "text", 0),
      sala("v1", "Estúdio", "voice", 1),
      sala("v2", "Régie", "voice", 2),
      sala("v3", "Cabina", "voice", 3),
    ],
  },
]

const SERVIDOR = ${JSON.stringify(alvo())}

const PRESENTES = [
  { address: "@ana:" + SERVIDOR, name: "Ana Rita" },
  { address: "@bru:" + SERVIDOR, name: "Bruno" },
]

function Demo() {
  const [menu, setMenu] = useState(null)
  return (
    <ToastContext.Provider value={() => {}}>
    <div className="app">
      <div className="rail" />
      <ChannelSidebar
        view="chat"
        rooms={["!direccao:" + SERVIDOR]}
        labelFor={() => "Direcção"}
        active={"!direccao:" + SERVIDOR}
        callChannel={null}
        ringing={new Map()}
        unreads={new Map()}
        profile={{ displayName: "Eu", donations: [] }}
        address={"@eu:" + SERVIDOR}
        connection="online"
        open={false}
        onClose={() => {}}
        onSelectChannel={() => {}}
        onChannelMenu={() => {}}
        onCompose={() => {}}
        onEditProfile={() => {}}
        onPrompt={() => {}}
        onSaveStatus={() => {}}
        roomGroups={GRUPOS}
        activeRoom=""
        onSelectRoom={() => {}}
        voicePresence={(room) => (room === "v1" ? PRESENTES : [])}
        mayMove
        onMovePerson={() => {}}
        onVoiceMemberMenu={(room, address, at) => setMenu({ room, address, at })}
      />
      <main className="main" />
      {menu && (
        <ContextMenu
          at={menu.at}
          onClose={() => setMenu(null)}
          items={itensDaPessoaEmVoz({
            pessoa: {
              nome: "Ana Rita",
              ehEuProprio: false,
              accoes: { perfil: () => {}, copiar: () => {}, mensagem: () => {} },
            },
            podeMover: true,
            salaActual: menu.room,
            salasDeVoz: GRUPOS[0].rooms.filter((s) => s.kind === "voice"),
            mover: () => {},
          })}
        />
      )}
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
 * The OLD design, restored by CSS.
 *
 * Handle hidden, candidate rooms with no mark until the cursor hovers, and the
 * target block label indistinguishable from a menu entry.
 */
const ANTIGO = `
  .voice-member-pega { display: none !important; }
  .room-row.pode-receber { outline: none !important; }
  .menu-section {
    font-size: var(--font-base) !important;
    text-transform: none !important;
    letter-spacing: 0 !important;
    color: var(--text) !important;
    font-weight: 400 !important;
    padding: var(--space-3) var(--space-4) !important;
  }
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

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
const erros = []
page.on("pageerror", (e) => erros.push(String(e)))
await page.goto(`file://${join(SAIDA, "index.html")}`)
await page.waitForSelector(".room-voice-members li", { timeout: 10_000 })
check("a barra lateral desenha sem erros de página", erros.length === 0, erros[0] ?? "")

/*
  Open the voice room that has people in it. Faces only show with the tree open,
  and this script works on one of them.
*/
const linhaDaAna = page.locator(".room-voice-members li").filter({ hasText: "Ana Rita" }).first()
await linhaDaAna.waitFor()

// ------------------------------------------------- handle: visible without touch
{
  const pega = await page.evaluate(() => {
    const linha = [...document.querySelectorAll(".room-voice-members li")].find((li) =>
      li.textContent?.includes("Ana Rita"),
    )
    const el = linha?.querySelector(".voice-member-pega")
    if (!el) return null
    const r = el.getBoundingClientRect()
    const e = getComputedStyle(el)
    return {
      largura: Math.round(r.width),
      altura: Math.round(r.height),
      opacidade: Number(e.opacity),
      visivel: e.display !== "none" && e.visibility !== "hidden",
    }
  })
  check("a linha de quem se pode mover tem pega, e ela desenha-se", pega !== null && pega.visivel && pega.largura > 0, JSON.stringify(pega))
  /*
    Both opacity and area, never opacity alone: an element with `display: none`
    keeps the opacity the sheet gave it, and a measurement looking only at that
    would say "visible" looking at nothing. Caught with `ANTIGO=1`, which is what
    it is for.
  */
  check(
    "a pega vê-se parada, sem ser preciso pousar o rato",
    pega !== null && pega.visivel && pega.largura > 0 && pega.opacidade > 0.2,
    pega ? `opacidade ${pega.opacidade}, ${pega.largura}×${pega.altura}` : "sem pega",
  )
}

/*
  The map of targets the moment someone is lifted.
  
  Synthetic `dragStart` not a mouse drag: Playwright cannot drive real HTML5
  drag-and-drop on a `file://`, and what is measured here is what the screen
  DRAWS in response to the state, the part jsdom does not see. That the state
  enters from the real gesture is what tree tests prove.
  */
async function levantarAAna() {
  await page.evaluate(() => {
    const linha = [...document.querySelectorAll(".room-voice-members li")].find((li) =>
      li.textContent?.includes("Ana Rita"),
    )
    const evento = new Event("dragstart", { bubbles: true })
    // React reads `dataTransfer`; without it the handle breaks before saving the
    // state, and measures a list that never knew about the drag.
    Object.defineProperty(evento, "dataTransfer", { value: { setData: () => {} } })
    linha.dispatchEvent(evento)
  })
  await page.waitForTimeout(60)
}

const marcadas = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".room-row")].map((linha) => {
      const e = getComputedStyle(linha)
      return {
        nome: linha.querySelector(".room-name")?.textContent ?? "",
        candidata: linha.classList.contains("pode-receber"),
        contorno: e.outlineStyle === "none" ? "nenhum" : `${e.outlineStyle} ${e.outlineWidth}`,
        fundo: e.backgroundColor,
      }
    }),
  )

// ------------------------------------------------- still, nothing is marked
{
  const antes = await marcadas()
  check(
    "em repouso nenhuma sala está marcada: isto responde a um gesto, não decora",
    antes.every((sala) => sala.contorno === "nenhum"),
    antes.map((s) => `${s.nome}:${s.contorno}`).join(", "),
  )
}

// ------------------------------------------------- levantada, o mapa aparece
{
  await levantarAAna()
  const durante = await marcadas()
  const candidatas = durante.filter((sala) => sala.candidata).map((sala) => sala.nome)

  check(
    "levantar alguém marca as outras salas de voz, e só essas",
    JSON.stringify(candidatas) === JSON.stringify(["Régie", "Cabina"]),
    `marcadas: ${JSON.stringify(candidatas)}`,
  )
  check(
    "e a marca é visível: as candidatas ganham contorno onde antes não havia nenhum",
    durante.filter((s) => s.candidata).every((s) => s.contorno !== "nenhum"),
    durante.map((s) => `${s.nome}:${s.contorno}`).join(", "),
  )
  check(
    "a sala onde a pessoa já está não se marca, porque não é destino",
    durante.find((s) => s.nome === "Estúdio")?.contorno === "nenhum",
    `Estúdio: ${durante.find((s) => s.nome === "Estúdio")?.contorno}`,
  )
  check(
    "e uma sala de texto também não",
    durante.find((s) => s.nome === "avisos")?.contorno === "nenhum",
    `avisos: ${durante.find((s) => s.nome === "avisos")?.contorno}`,
  )

  await page.screenshot({
    path: join(AQUI, `_saida-mover-arrasto${MARCA}.png`),
    clip: { x: 60, y: 0, width: 300, height: 400 },
  })
}

// -------------------------------- the target pointed at stands out from the others
{
  await page.evaluate(() => {
    const regie = [...document.querySelectorAll(".room-row")].find((linha) =>
      linha.textContent?.includes("Régie"),
    )
    regie.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }))
  })
  await page.waitForTimeout(60)

  const depois = await marcadas()
  const apontada = depois.find((s) => s.nome === "Régie")
  const candidata = depois.find((s) => s.nome === "Cabina")
  check(
    "a sala debaixo do cursor lê-se diferente das que só podem receber",
    apontada.fundo !== candidata.fundo || apontada.contorno !== candidata.contorno,
    `apontada: ${apontada.contorno} / ${apontada.fundo} — candidata: ${candidata.contorno} / ${candidata.fundo}`,
  )
}

// ------------------------------------------------- the menu and its label
{
  await page.reload()
  await page.waitForSelector(".room-voice-members li")
  await page.locator(".voice-member").filter({ hasText: "Ana Rita" }).first().click()
  await page.waitForSelector(".context-menu")

  const menu = await page.evaluate(() => {
    const numero = (v) => Math.round(parseFloat(v) * 10) / 10
    const letreiro = document.querySelector(".menu-section")
    const entradas = [...document.querySelectorAll('.context-menu [role="menuitem"]')]
    const destino = entradas.find((b) => b.textContent?.startsWith("Mover para "))
    return {
      letreiro: letreiro?.textContent ?? null,
      quantosLetreiros: document.querySelectorAll(".menu-section").length,
      tamanhoDoLetreiro: letreiro ? numero(getComputedStyle(letreiro).fontSize) : 0,
      corDoLetreiro: letreiro ? getComputedStyle(letreiro).color : "",
      tamanhoDaEntrada: destino ? numero(getComputedStyle(destino).fontSize) : 0,
      corDaEntrada: destino ? getComputedStyle(destino).color : "",
      destinos: entradas.filter((b) => b.textContent?.startsWith("Mover para ")).map((b) => b.textContent),
      // The label cannot be selectable: a menu item that does nothing is a broken
      // promise, and for someone who hears the screen it is worse than absence.
      letreiroEhItem: letreiro?.getAttribute("role") === "menuitem",
    }
  })

  check("o bloco dos destinos tem letreiro", menu.letreiro === "Mover para outra sala", String(menu.letreiro))
  check("e há um só, senão deixa de agrupar", menu.quantosLetreiros === 1, String(menu.quantosLetreiros))
  check(
    "os dois destinos estão lá, e nunca a sala onde a pessoa já está",
    JSON.stringify(menu.destinos) === JSON.stringify(["Mover para Régie", "Mover para Cabina"]),
    JSON.stringify(menu.destinos),
  )
  check(
    "o letreiro lê-se como cabeçalho e não como mais uma entrada",
    menu.tamanhoDoLetreiro < menu.tamanhoDaEntrada && menu.corDoLetreiro !== menu.corDaEntrada,
    `letreiro ${menu.tamanhoDoLetreiro}px ${menu.corDoLetreiro} — entrada ${menu.tamanhoDaEntrada}px ${menu.corDaEntrada}`,
  )
  check("e não se pode escolher, porque não faz nada", !menu.letreiroEhItem)

  await page.locator(".context-menu").screenshot({ path: join(AQUI, `_saida-mover-menu${MARCA}.png`) })
}

await ctx.close()
await browser.close()

const falhas = resultados.filter((r) => !r.ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} passaram`)
if (process.env.ANTIGO) {
  console.log("Com ANTIGO=1, a pega, o mapa e o letreiro TÊM de falhar. Se passaram, não estão a medir nada.")
}
process.exit(falhas > 0 && !process.env.ANTIGO ? 1 : 0)
