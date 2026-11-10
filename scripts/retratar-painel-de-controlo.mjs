/**
 * The control panel at the foot of the column (P1, October 28, 2026), in a call, in a real layout engine.
 *
 * The panel tests run in jsdom, which does not apply stylesheets: they say there are three floors and five buttons, they don't say if they fit in the column or if something overlaps. This builds the true `CartaoDaConta` and sidebar in a true `aside.sidebar`, with the true stylesheet, as the shell builds them (`App.tsx`, `docaLateral`):
 *
 * - at 1280 px, the 236-wide column with the panel in a call: three floors, five equal 38 px buttons, the green box in the middle, exit last;
 * - at 390 px, the drawer open: on narrow screen the shell does not put the call in the panel (the dock floats), and the panel has two floors and four buttons.
 *
 * Verifies no errors, nothing overflows the column, floors don't overlap, and buttons are equal. Saves screenshots to `capturas/painel-de-controlo-1280.png` and `-390.png`.
 *
 *   node scripts/retratar-painel-de-controlo.mjs
 *
 * Replaces `medir-faixa-da-conta.mjs`, which measured the strip of one row only.
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { alvo } from "./ambiente.mjs"

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, "..")
const SAIDA = join(AQUI, ".saida-painel-de-controlo")
const CAPTURAS = join(RAIZ, "capturas")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

mkdirSync(SAIDA, { recursive: true })
mkdirSync(CAPTURAS, { recursive: true })

const ENDERECO = `@garbicis-xapsensis-giprete-birmyris:${alvo()}`

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { CartaoDaConta } from ${UI("screens/profile/CartaoDaConta.js")}
import { CallDock } from ${UI("screens/call/CallDock.js")}
import ${UI("styles.css")}

const largo = window.matchMedia("(min-width: 841px)").matches
window.__voltou = 0
window.__saiu = 0

const pessoas = [
  { address: "@ana:s", connected: true, stream: null },
  { address: "@rui:s", connected: true, stream: null },
]

function Demo() {
  const caixa = (
    <CallDock
      variante="lateral"
      comAudio={false}
      channel="!nexo:s"
      channelLabel="nexo"
      roomLabel="Sala das reuniões de sexta"
      latencia={{ ms: 12, ate: "servidor" }}
      participants={pessoas}
      localStream={null}
      nameFor={(quem) => quem}
      onBack={() => { window.__voltou += 1 }}
      onLeave={() => {}}
    />
  )
  return (
    <div className="app">
      <nav className="rail" />
      <aside className="sidebar open">
        <div className="sidebar-header">Comunidades</div>
        <div className="sidebar-body" />
        <CartaoDaConta
          profile={{ displayName: "Vesna", statusText: "Em reunião até às 18h, depois no estúdio", donations: [] }}
          address={${JSON.stringify(ENDERECO)}}
          activity="online"
          ligacao="online"
          onActivityMenu={() => {}}
          onEditProfile={() => {}}
          onNotifications={() => {}}
          unreadNotifications={3}
          micMuted={false}
          soundOff={false}
          onToggleMic={() => {}}
          onToggleSound={() => {}}
          onMicMenu={() => {}}
          onSoundMenu={() => {}}
          onAbrirDefinicoes={() => {}}
          latencia={{ ms: 12, ate: "servidor" }}
          onLatenciaHover={() => {}}
          onSaveStatus={() => {}}
          emChamada
          chamada={largo ? { caixa, onSair: () => { window.__saiu += 1 } } : null}
        />
      </aside>
      <main className="main" />
    </div>
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? `: ${detalhe}` : ""}`)
}

for (const [largura, altura] of [
  [1280, 860],
  [390, 844],
]) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(`file://${join(SAIDA, "index.html")}`)
  await page.waitForSelector(".me-faixa.painel", { timeout: 10_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)

  const m = await page.evaluate(() => {
    const caixa = (el) => el.getBoundingClientRect()
    const painel = document.querySelector(".me-faixa.painel")
    const coluna = caixa(document.querySelector(".sidebar"))
    const andares = [...painel.children]
      .filter((filho) => !filho.classList.contains("me-address"))
      .map((filho) => ({ classe: filho.className, ...JSON.parse(JSON.stringify(caixa(filho))) }))
    const botoes = [...painel.querySelectorAll(".me-accoes button")].map((b) => ({
      nome: b.getAttribute("aria-label"),
      ...JSON.parse(JSON.stringify(caixa(b))),
    }))
    const avatar = caixa(painel.querySelector(".me-avatar > .avatar"))
    const nome = getComputedStyle(painel.querySelector(".me-name")).fontSize
    const mensagem = painel.querySelector(".me-mensagem")
    return {
      coluna: { left: coluna.left, right: coluna.right },
      painel: JSON.parse(JSON.stringify(caixa(painel))),
      andares,
      botoes,
      avatar: { w: avatar.width, h: avatar.height },
      nome,
      mensagemAnda: mensagem?.classList.contains("andante") ?? false,
      ondeAnda: painel.querySelector(".call-dock-where")?.classList.contains("andante") ?? null,
      /* Against the column header, not against its `clientWidth`: the skin gives the column a border that the header and body also pass through by 1 px, and that's not from the panel. */
      scroll: caixa(painel).right - caixa(document.querySelector(".sidebar-header")).right,
      pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })

  const id = String(largura)
  const emChamada = largura > 840
  check(`${id}: sem erros na página`, erros.length === 0, erros.join(" | "))
  check(`${id}: o painel não é mais largo do que a coluna, e a página não rola de lado`, m.scroll <= 0.5 && m.pagina <= 0, `painel ${m.scroll} px além do cabeçalho, página ${m.pagina}`)
  check(
    `${id}: ${emChamada ? "três andares" : "dois andares"}`,
    m.andares.length === (emChamada ? 3 : 2),
    m.andares.map((a) => a.classe).join(" / "),
  )
  const sobrepostos = m.andares.slice(1).filter((a, i) => a.top < m.andares[i].bottom - 0.5)
  check(`${id}: os andares não se sobrepõem`, sobrepostos.length === 0, sobrepostos.map((a) => a.classe).join(", "))
  const dentro = [...m.andares, ...m.botoes].every((r) => r.left >= m.coluna.left - 0.5 && r.right <= m.coluna.right + 0.5)
  check(`${id}: tudo dentro da coluna`, dentro, `coluna ${m.coluna.left.toFixed(0)}–${m.coluna.right.toFixed(0)}`)
  check(`${id}: ${emChamada ? "cinco" : "quatro"} botões`, m.botoes.length === (emChamada ? 5 : 4), m.botoes.map((b) => b.nome).join(" | "))
  const iguais = m.botoes.every((b) => Math.abs(b.width - m.botoes[0].width) < 0.5 && b.height === 38)
  check(`${id}: botões iguais, de 38 px de altura`, iguais, m.botoes.map((b) => `${b.width.toFixed(1)}×${b.height}`).join(" "))
  const lado = m.botoes.slice(1).every((b, i) => b.left >= m.botoes[i].right - 0.5)
  check(`${id}: os botões não se sobrepõem`, lado)
  check(`${id}: a cara tem 46 px e o nome 16`, m.avatar.w === 46 && m.avatar.h === 46 && m.nome === "16px", `${m.avatar.w}×${m.avatar.h}, ${m.nome}`)
  if (emChamada) {
    check(`${id}: o último botão é sair`, m.botoes.at(-1)?.nome === "Sair da chamada", m.botoes.at(-1)?.nome ?? "")
    console.log(`NOTA  ${id}: a mensagem ${m.mensagemAnda ? "anda" : "cabe"}; o "Canal · Sala" ${m.ondeAnda ? "anda" : "cabe"}`)
    await page.click(".call-dock.lateral .call-dock-back")
    await page.click(".me-sair")
    const gestos = await page.evaluate(() => ({ voltou: window.__voltou, saiu: window.__saiu }))
    check(`${id}: a caixa volta à chamada, e o sair sai`, gestos.voltou === 1 && gestos.saiu === 1, JSON.stringify(gestos))
    await page.mouse.move(0, 0)
    await page.waitForTimeout(300)
  }

  await page.locator(largura > 840 ? ".sidebar" : ".app").screenshot({ path: join(CAPTURAS, `painel-de-controlo-${id}.png`) })
  await ctx.close()
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)
