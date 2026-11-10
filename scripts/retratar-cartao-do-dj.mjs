/**
 * The DJ card (design D1, chosen by the owner on 28 October 2026),
 * in a real layout engine.
 *
 * The card tests run in jsdom, which does not apply stylesheets: they say
 * the mute button and the slider are INSIDE the footer, they do not say if
 * something covers something else. The owner's request came from that: the
 * footer with the track name covered the mute button. This sets up the real
 * `CallChip`, with the real stylesheet, in the room grid (`.call-people`),
 * from the side of the LISTENER (with listener gestures), next to our DJ
 * card (just the track) and a person without music:
 *
 * - at 1280 px, the room; and the track above a chat (cards of 132 px);
 * - at 390 px, the room on a phone.
 *
 * Checks that there are no errors, that the footer is 40 px, that the note,
 * name, button and slider fit inside it side by side, that the person's name
 * and corner badges are above the footer, and that the mute button responds
 * to a real click (nothing on top of it). Captures `capturas/cartao-do-dj-1280.png`
 * (the card of the broadcaster, seen by the listener).
 *
 *   node scripts/retratar-cartao-do-dj.mjs
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, "..")
const SAIDA = join(AQUI, ".saida-cartao-do-dj")
const CAPTURAS = join(RAIZ, "capturas")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

mkdirSync(SAIDA, { recursive: true })
mkdirSync(CAPTURAS, { recursive: true })

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { useState } from "react"
import { CallChip } from ${UI("screens/call/CallChip.js")}
import { MarcaDeChamada } from ${UI("components/MarcaDeChamada.js")}
import { obterContextoDeAudio } from ${UI("lib/contextoDeAudio.js")}
import ${UI("styles.css")}

const faixa = new URLSearchParams(location.search).get("faixa") === "1"
window.__calou = 0

/** Música sintética, para o visualizador ter o que desenhar. */
function fluxoSintetico(i) {
  const ctx = obterContextoDeAudio()
  window.__ctx = ctx
  const destino = ctx.createMediaStreamDestination()
  const grave = ctx.createOscillator(); grave.frequency.value = 55 + i * 10
  const ganho = ctx.createGain(); ganho.gain.value = 0.5
  grave.connect(ganho); ganho.connect(destino)
  const medio = ctx.createOscillator(); medio.type = "sawtooth"; medio.frequency.value = 330 + i * 110
  const gm = ctx.createGain(); gm.gain.value = 0.15; medio.connect(gm); gm.connect(destino)
  grave.start(); medio.start()
  return destino.stream
}

function Demo() {
  const [fluxos] = useState(() => [fluxoSintetico(0), fluxoSintetico(1)])
  const [calada, setCalada] = useState(false)
  const [volume, setVolume] = useState(0.62)
  const perfil = (nome) => ({ displayName: nome, donations: [] })
  return (
    <section className={faixa ? "call call-faixa" : "call call-sala"} style={{ height: faixa ? "auto" : "100vh", padding: 16 }}>
      <div className="call-corpo">
        <div className="call-people">
          <span className="call-person" data-quem="ouve">
            <CallChip label="Kaori" profile={perfil("Kaori")} texto="ligada" presence="active"
              aTocar="Madredeus · Haja o que houver" musica={fluxos[0]}
              volumeDaMusica={volume} onVolumeDaMusica={setVolume}
              musicaCalada={calada} onAlternarMusica={() => { window.__calou += 1; setCalada((c) => !c) }}
              onVolume={() => {}} volume={1} onMenu={() => {}} />
            <span className="call-person-marcas">
              <MarcaDeChamada tipo="calado" nome="Kaori" className="mic-off-badge" />
            </span>
          </span>
          <span className="call-person" data-quem="dj">
            <CallChip label="Duarte" profile={perfil("Duarte")} texto="tu" presence="active"
              aTocar="Planície ao fim da tarde, com o montado a perder de vista" musica={fluxos[1]} proprio />
            <span className="call-person-marcas" />
          </span>
          <span className="call-person" data-quem="voz">
            <CallChip label="Rui" profile={perfil("Rui")} texto="ligada" presence="active" onVolume={() => {}} volume={1} />
            <span className="call-person-marcas" />
          </span>
        </div>
      </div>
    </section>
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

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] })
const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? `: ${detalhe}` : ""}`)
}

for (const [id, largura, altura, faixa] of [
  ["1280", 1280, 720, false],
  ["1280-faixa", 1280, 720, true],
  ["390", 390, 844, false],
]) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(`file://${join(SAIDA, "index.html")}${faixa ? "?faixa=1" : ""}`)
  await page.waitForSelector(".call-chip-musica", { timeout: 10_000 })
  await page.evaluate(() => Promise.all([document.fonts.ready, window.__ctx?.resume?.()]))
  await page.waitForTimeout(800)

  const m = await page.evaluate(() => {
    const caixa = (el) => (el ? JSON.parse(JSON.stringify(el.getBoundingClientRect())) : null)
    const pessoa = (quem) => {
      const raiz = document.querySelector(`[data-quem="${quem}"]`)
      const rodape = raiz.querySelector(".call-chip-musica")
      return {
        rodape: caixa(rodape),
        partes: rodape
          ? [...rodape.children].map((filho) => ({ classe: filho.getAttribute("class") ?? filho.tagName, ...caixa(filho) })).filter((r) => r.width > 0)
          : [],
        nome: caixa(raiz.querySelector(".call-chip-labels")),
        marcas: caixa(raiz.querySelector(".call-person-marcas > [data-marca]")),
        cara: caixa(raiz.querySelector(".call-chip-rosto")),
        controlos: rodape ? rodape.querySelectorAll("button, input").length : 0,
      }
    }
    return {
      ouve: pessoa("ouve"),
      dj: pessoa("dj"),
      voz: pessoa("voz"),
      pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })

  check(`${id}: sem erros na página`, erros.length === 0, erros.join(" | "))
  check(`${id}: a página não rola de lado`, m.pagina <= 0, String(m.pagina))
  const { ouve, dj, voz } = m
  check(`${id}: o rodapé tem 40 px`, Math.round(ouve.rodape.height) === 40 && Math.round(dj.rodape.height) === 40, `${ouve.rodape.height} · ${dj.rodape.height}`)
  const dentro = (pessoa) => pessoa.partes.every((r) => r.top >= pessoa.rodape.top - 0.5 && r.bottom <= pessoa.rodape.bottom + 0.5 && r.left >= pessoa.rodape.left - 0.5 && r.right <= pessoa.rodape.right + 0.5)
  const emLinha = (pessoa) => pessoa.partes.slice(1).every((r, i) => r.left >= pessoa.partes[i].right - 0.5)
  check(`${id}: quem ouve: ${ouve.partes.map((p) => p.classe).join(" | ")}`, ouve.controlos === 2 && dentro(ouve) && emLinha(ouve))
  const nomeDaFaixa = ouve.partes.find((p) => p.classe.includes("call-chip-musica-nome"))
  check(`${id}: o nome da faixa tem lugar`, (nomeDaFaixa?.width ?? 0) >= 56, `${nomeDaFaixa?.width} px`)
  check(`${id}: o DJ vê só a faixa`, dj.controlos === 0 && dentro(dj), `${dj.controlos} controlos`)
  check(`${id}: o nome da pessoa fica por cima do rodapé`, ouve.nome.bottom <= ouve.rodape.top + 0.5 && dj.nome.bottom <= dj.rodape.top + 0.5, `${ouve.nome.bottom} ≤ ${ouve.rodape.top}`)
  check(`${id}: a marca do canto fica por cima do rodapé`, ouve.marcas.bottom <= ouve.rodape.top + 0.5, `${ouve.marcas.bottom} ≤ ${ouve.rodape.top}`)
  check(`${id}: sem música não há rodapé`, voz.rodape === null)
  console.log(`NOTA  ${id}: cartão ${Math.round(ouve.rodape.width)} px; a cara acaba a ${Math.round(ouve.rodape.top - ouve.cara.bottom)} px do rodapé`)

  // The real click: if something were on top of the button, Playwright would
  // refuse it ("element intercepts pointer events") and the gesture would not
  // reach it.
  await page.click('[data-quem="ouve"] .chip-musica-calar', { timeout: 2000 })
  const depois = await page.evaluate(() => ({
    calou: window.__calou,
    premido: document.querySelector('[data-quem="ouve"] .chip-musica-calar').getAttribute("aria-pressed"),
  }))
  check(`${id}: o botão de calar recebe o clique`, depois.calou === 1 && depois.premido === "true", JSON.stringify(depois))
  await page.click('[data-quem="ouve"] .chip-musica-calar')
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300)

  if (id === "1280") {
    await page.locator('[data-quem="ouve"]').screenshot({ path: join(CAPTURAS, "cartao-do-dj-1280.png") })
  }
  await page.screenshot({ path: join(SAIDA, `${id}.png`) })
  await ctx.close()
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)
