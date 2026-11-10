/**
 * Unread messages in rooms, muted indicators and active speaker indicators,
 * measured in a real browser (owner requests from October 27, 2026, 23:30
 * and 23:55).
 *
 * The tree tests (`ChannelSidebar.test.tsx`, `App.crachas.test.tsx`) prove
 * what is counted and what is drawn. JSDOM has no layout, so it does not prove
 * what this script measures: that a room badge does not push the name off the
 * line, that the muted bell fits, that a dimmed name is actually dimmed, and
 * that none of this makes the page scroll on a phone.
 *
 * Mounts the real `ChannelSidebar`, with the real stylesheet and fixed data
 * (no server, so no port): an open channel with unread rooms, a muted room, a
 * collapsed category with a count, an adjacent muted channel and another with
 * unread, and a voice room where someone is sharing their screen and playing
 * music. At 1280px and 390px widths (at that width the sidebar becomes a
 * drawer, open).
 *
 * Saves a screenshot of each width to `scripts/.saida-por-ler/`.
 *
 *   node scripts/medir-por-ler.mjs
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { alvo } from "./ambiente.mjs"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-por-ler")
const RAIZ = join(AQUI, "..")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

mkdirSync(SAIDA, { recursive: true })

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { ChannelSidebar } from ${UI("screens/chat/ChannelSidebar.js")}
import { ToastContext } from ${UI("components/Toast.js")}
import ${UI("styles.css")}

const S = ${JSON.stringify(alvo())}
const LAGAR = "!lagar:" + S
const ADEGA = "!adega:" + S
const MOINHO = "!moinho:" + S

const sala = (room, name, category, kind, position) => ({ room, name, category, kind, position })
const GRUPOS = [
  { category: "", rooms: [sala("", "geral", "", "text", -1)] },
  {
    category: "Vindima",
    rooms: [
      sala("vinha", "vinha-e-adega-com-um-nome-comprido-a-cortar", "Vindima", "text", 0),
      sala("lagar", "lagar", "Vindima", "text", 1),
      sala("voz", "Estúdio", "Vindima", "voice", 2),
    ],
  },
  { category: "Arquivo", rooms: [sala("velha", "velha", "Arquivo", "text", 0), sala("antiga", "antiga", "Arquivo", "text", 1)] },
]
const POR_LER = { vinha: 12, lagar: 3, velha: 4, antiga: 120 }
const SILENCIADOS = new Set([LAGAR + "/lagar", ADEGA])

// A categoria "Arquivo" dobrada, para se ver a soma no cabeçalho.
localStorage.setItem("enclave.collapsed", JSON.stringify(["c:" + LAGAR + "/Arquivo"]))

const PRESENTES = [
  { address: "@eu:" + S, name: "Eu" },
  { address: "@ana:" + S, name: "Ana Rita Albuquerque", transmite: "ecra" },
  { address: "@bru:" + S, name: "Bruno", transmite: "ecra+musica" },
  { address: "@cid:" + S, name: "Cidália", transmite: "musica" },
]

function Demo() {
  const largo = window.innerWidth > 840
  return (
    <ToastContext.Provider value={() => {}}>
      <div className="app">
        <div className="rail" />
        <ChannelSidebar
          view="chat"
          rooms={[LAGAR, ADEGA, MOINHO]}
          labelFor={(c) => c.slice(1).split(":")[0]}
          active={LAGAR}
          callChannel={null}
          ringing={new Map()}
          // A adega está silenciada: os 2 são as menções, que o silêncio deixa passar.
          unreads={new Map([[ADEGA, 2], [MOINHO, 7]])}
          porLerNaSala={(room) => (SILENCIADOS.has(LAGAR + "/" + room) ? 0 : (POR_LER[room] ?? 0))}
          silenciado={(chave) => SILENCIADOS.has(chave)}
          profile={{ displayName: "Eu", donations: [] }}
          address={"@eu:" + S}
          connection="online"
          open={!largo}
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
          voicePresence={(room) => (room === "voz" ? PRESENTES : [])}
        />
        <main className="main" />
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
  loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts", ".json": "json", ".woff2": "file" },
  external: ["@sapphi-red/*"],
  format: "iife",
  logLevel: "error",
})

writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="pagina.css"><body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

const browser = await chromium.launch()
const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? ` — ${detalhe}` : ""}`)
}

for (const [largura, altura] of [
  [1280, 860],
  [390, 844],
]) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(`file://${join(SAIDA, "index.html")}`)
  await page.waitForSelector(".room-row", { timeout: 10_000 })
  await page.waitForTimeout(300)
  const m = await page.evaluate(() => {
    const caixa = (el) => {
      const r = el.getBoundingClientRect()
      return { esq: r.left, dir: r.right, cima: r.top, baixo: r.bottom, larg: r.width }
    }
    const barra = caixa(document.querySelector(".sidebar"))
    const linhaDaSala = (nome) =>
      [...document.querySelectorAll(".room-row")].find((l) => l.querySelector(".room-name")?.textContent.startsWith(nome))
    const linhaDoCanal = (nome) => [...document.querySelectorAll(".channel-row")].find((l) => l.textContent.includes(nome))
    const dentro = (filho, pai) => filho.esq >= pai.esq - 0.5 && filho.dir <= pai.dir + 0.5
    const vinha = linhaDaSala("vinha")
    const lagar = linhaDaSala("lagar")
    const adega = linhaDoCanal("adega")
    const arquivo = [...document.querySelectorAll(".category-toggle")].find((b) => b.textContent.includes("Arquivo"))
    const crachaVinha = vinha?.querySelector(".room-unread")
    const nomeVinha = vinha?.querySelector(".room-name")
    const marcas = [...document.querySelectorAll(".marca-transmissao")]
    return {
      documento: document.documentElement.scrollWidth,
      janela: window.innerWidth,
      crachaVinha: crachaVinha?.textContent ?? null,
      crachaVinhaDentro: crachaVinha ? dentro(caixa(crachaVinha), caixa(vinha)) : false,
      nomeVinhaLargura: nomeVinha ? caixa(nomeVinha).larg : 0,
      nomeVinhaCortado: nomeVinha ? nomeVinha.scrollWidth > nomeVinha.clientWidth + 1 : false,
      crachaVinhaAltura: crachaVinha ? caixa(crachaVinha).baixo - caixa(crachaVinha).cima : 0,
      linhaVinhaAltura: vinha ? caixa(vinha).baixo - caixa(vinha).cima : 0,
      lagarSemNumero: lagar ? lagar.querySelector(".room-unread") === null : false,
      lagarOpacidade: lagar ? Number(getComputedStyle(lagar.querySelector(".room-name")).opacity) : 1,
      lagarSino: lagar ? lagar.querySelector(".marca-silencio") !== null : false,
      lagarSinoAoPeDoNome: lagar?.querySelector(".marca-silencio")
        ? caixa(lagar.querySelector(".marca-silencio")).esq - caixa(lagar.querySelector(".room-name")).dir
        : -1,
      lagarSinoDentro: lagar?.querySelector(".marca-silencio")
        ? dentro(caixa(lagar.querySelector(".marca-silencio")), caixa(lagar))
        : false,
      adegaSino: adega ? adega.querySelector(".marca-silencio") !== null : false,
      adegaOpacidade: adega ? Number(getComputedStyle(adega.querySelector(".channel-name")).opacity) : 1,
      somaArquivo: arquivo?.querySelector(".room-unread")?.textContent ?? null,
      moinho: linhaDoCanal("moinho")?.querySelector(".badge")?.textContent ?? null,
      marcas: marcas.length,
      marcasTitulos: marcas.map((el) => el.getAttribute("title")),
      marcasDentro: marcas.every((el) => dentro(caixa(el), barra)),
    }
  })
  const n = `${largura}px`
  check(`${n}: sem erros na página`, erros.length === 0, erros.join(" | "))
  check(`${n}: não rola na horizontal`, m.documento <= m.janela, `${m.documento} em ${m.janela}`)
  check(`${n}: a sala por ler mostra o número`, m.crachaVinha === "12", String(m.crachaVinha))
  check(`${n}: o crachá da sala fica dentro da linha`, m.crachaVinhaDentro)
  check(`${n}: o crachá não engole o nome (o nome corta com reticências e tem largura)`, m.nomeVinhaLargura > 40, `${Math.round(m.nomeVinhaLargura)}px, cortado=${m.nomeVinhaCortado}`)
  check(`${n}: o crachá não estica a linha`, m.crachaVinhaAltura < m.linhaVinhaAltura, `${m.crachaVinhaAltura} em ${m.linhaVinhaAltura}`)
  check(`${n}: a sala silenciada não mostra número`, m.lagarSemNumero)
  check(`${n}: a sala silenciada está esbatida`, m.lagarOpacidade < 0.8, String(m.lagarOpacidade))
  check(`${n}: a sala silenciada leva o sino, dentro da linha`, m.lagarSino && m.lagarSinoDentro)
  check(`${n}: o sino da sala fica agarrado ao nome`, m.lagarSinoAoPeDoNome >= 0 && m.lagarSinoAoPeDoNome < 12, `${Math.round(m.lagarSinoAoPeDoNome)}px`)
  check(`${n}: o canal silenciado leva o sino e esbate`, m.adegaSino && m.adegaOpacidade < 0.8, String(m.adegaOpacidade))
  check(`${n}: a categoria dobrada mostra a soma (4 + 120)`, m.somaArquivo === "99+", String(m.somaArquivo))
  check(`${n}: o canal ao lado mostra o número`, m.moinho === "7", String(m.moinho))
  check(`${n}: três sinais de transmissão na sala de voz`, m.marcas === 3, m.marcasTitulos.join(" · "))
  check(`${n}: os sinais de transmissão cabem na barra`, m.marcasDentro)
  await page.screenshot({ path: join(SAIDA, `barra-${largura}.png`), fullPage: true })
  await ctx.close()
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)
