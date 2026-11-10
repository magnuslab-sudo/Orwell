/**
 * Requests from the owner of 27 October 2026, at 23h, measured in a real
 * browser (jsdom does not draw, does not play, does not count frames).
 *
 * Mounts the real components with the real stylesheet, 1280 e to 390 px, and
 * measures:
 *
 * - the "connecting" cards: faded, with the ring spinning;
 * - the call side card: only hang up and disconnect, disconnect in red; text
 *   contrast and button contrast `.primary` and `.danger` with brightness;
 * - the FOUR music-playing cards, with the visualizer, against the same four
 *   without it: the fps (must keep 60) and the worst interval (p95);
 * - the footer with the track name, which scrolls when it does not fit;
 * - the "Share audio" sheet playing: the display, the spectrum moving, the
 *   list, no horizontal scrolling.
 *
 * The sound is synthetic: a WAV generated on the page (bass hitting, mids and
 * highs) and, for the cards, oscillators. Saves captures in `scripts/.saida-chamada-23h/`.
 *
 *   node scripts/medir-chamada-23h.mjs
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { medirContraste, medirFps } from "./paineis-medidas.mjs"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-chamada-23h")
const RAIZ = join(AQUI, "..")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))
mkdirSync(SAIDA, { recursive: true })

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { useEffect, useState } from "react"
import { CallChip } from ${UI("screens/call/CallChip.js")}
import { CallDock } from ${UI("screens/call/CallDock.js")}
import { CallPanel } from ${UI("screens/call/CallPanel.js")}
import { PartilharAudio } from ${UI("screens/call/PartilharAudio.js")}
import { useMusicaDaChamada } from ${UI("hooks/useMusicaDaChamada.js")}
import { fontesDeAudioDoAnfitriao, anfitriaoDoAgente } from ${UI("lib/fontesDeAudio.js")}
import { obterContextoDeAudio } from ${UI("lib/contextoDeAudio.js")}
import { ToastContext } from ${UI("components/Toast.js")}
import ${UI("styles.css")}

const p = new URLSearchParams(location.search)
const vista = p.get("vista")
const comVisualizador = p.get("visualizador") !== "0"
const noop = () => {}

/** Música sintética: graves a bater a 2 Hz, um acorde, e chiado nos agudos. */
function wav(segundos, nome) {
  const taxa = 44100
  const n = taxa * segundos
  const dados = new DataView(new ArrayBuffer(44 + n * 4))
  const escrever = (o, t) => [...t].forEach((c, i) => dados.setUint8(o + i, c.charCodeAt(0)))
  escrever(0, "RIFF"); dados.setUint32(4, 36 + n * 4, true); escrever(8, "WAVEfmt ")
  dados.setUint32(16, 16, true); dados.setUint16(20, 1, true); dados.setUint16(22, 2, true)
  dados.setUint32(24, taxa, true); dados.setUint32(28, taxa * 4, true); dados.setUint16(32, 4, true)
  dados.setUint16(34, 16, true); escrever(36, "data"); dados.setUint32(40, n * 4, true)
  for (let i = 0; i < n; i++) {
    const t = i / taxa
    const batida = Math.exp(-((t % 0.5) * 18)) * Math.sin(2 * Math.PI * 60 * t)
    const acorde = 0.2 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 660 * t) * Math.sin(t))
    const chiado = 0.08 * (Math.random() * 2 - 1) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.7 * t))
    const v = Math.max(-1, Math.min(1, 0.7 * batida + acorde + chiado)) * 0x5fff
    dados.setInt16(44 + i * 4, v, true)
    dados.setInt16(46 + i * 4, v, true)
  }
  return Object.assign(new Blob([dados.buffer], { type: "audio/wav" }), { name: nome })
}

/** Um fluxo de música para cada cartão: osciladores e ruído, cada um diferente. */
function fluxoSintetico(i) {
  const ctx = obterContextoDeAudio()
  const destino = ctx.createMediaStreamDestination()
  const grave = ctx.createOscillator(); grave.frequency.value = 50 + i * 10
  const lfo = ctx.createOscillator(); lfo.frequency.value = 2 + i * 0.3
  const ganhoLfo = ctx.createGain(); ganhoLfo.gain.value = 0.5
  const ganho = ctx.createGain(); ganho.gain.value = 0.5
  lfo.connect(ganhoLfo); ganhoLfo.connect(ganho.gain)
  grave.connect(ganho); ganho.connect(destino)
  const medio = ctx.createOscillator(); medio.type = "sawtooth"; medio.frequency.value = 330 + i * 110
  const gm = ctx.createGain(); gm.gain.value = 0.15; medio.connect(gm); gm.connect(destino)
  grave.start(); lfo.start(); medio.start()
  return destino.stream
}

/** A chamada a fingir, como no teste: leva a música e diz que leva. */
function chamadaFalsa() {
  let estado = null
  const ouvintes = new Set()
  const emitir = (novo) => { estado = novo; ouvintes.forEach((o) => o({ estado })) }
  return {
    get musica() { return estado },
    partilharMusica: async (_faixa, aTocar) => { emitir({ aTocar }); return true },
    mudarATocar: (aTocar) => emitir({ aTocar }),
    pararMusica: async () => emitir(null),
    on: (evento, ouvinte) => { if (evento !== "music") return () => {}; ouvintes.add(ouvinte); return () => ouvintes.delete(ouvinte) },
    setMuted: noop, setCameraOff: noop,
  }
}
const chamada = chamadaFalsa()

function Folha() {
  const musica = useMusicaDaChamada(chamada)
  useEffect(() => {
    musica.acrescentar([
      wav(30, "01 Abertura.wav"),
      wav(8, "02 Fado da Madrugada de Alfama, versão longa ao vivo no Coliseu.wav"),
      wav(12, "03 Planície.wav"),
      wav(6, "04 Montado.wav"),
    ])
    window.__tocar = () => musica.tocar()
  }, [])
  return <PartilharAudio musica={musica} fontes={fontesDeAudioDoAnfitriao(anfitriaoDoAgente(navigator.userAgent, false))} onFechar={noop} />
}

function Cartoes() {
  const [fluxos] = useState(() => [0, 1, 2, 3].map(fluxoSintetico))
  const nomes = ["Ana", "Beatriz", "Cid", "Diogo"]
  const faixas = ["Fado", "Planície ao fim da tarde, com o montado a perder de vista", "Montado", "Abertura"]
  return (
    <section className="call call-sala">
      <div className="call-corpo">
        <div className="call-people">
          {nomes.map((nome, i) => (
            <span className="call-person" key={nome}>
              <CallChip label={nome} profile={{ displayName: nome, donations: [] }} texto="ligada" presence="active"
                aTocar={comVisualizador ? faixas[i] : null} musica={fluxos[i]}
                volumeDaMusica={0.8} onVolumeDaMusica={noop} onAlternarMusica={noop} musicaCalada={i === 3} />
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

function Lateral() {
  return (
    <div style={{ display: "flex", gap: 24, padding: 24, alignItems: "flex-start" }}>
      <div className="sidebar" style={{ width: 244, position: "relative", display: "flex", flexDirection: "column" }}>
        <CallDock variante="lateral" comAudio={false} channel="!nexo:s" channelLabel="MagnusLab" roomLabel="Sala das reuniões de sexta"
          latencia={{ ms: 42, ate: "servidor" }} participants={[{ address: "@ana:s", connected: true, stream: null }]}
          localStream={null} nameFor={(x) => x} onBack={noop} onLeave={noop} micMuted onToggleMic={noop} />
      </div>
      <div className="card" style={{ padding: 24, display: "flex", gap: 16 }} data-botoes="1">
        <button className="primary">Guardar</button>
        <button className="danger">Sair da chamada</button>
        <button className="primary" disabled>Desligado</button>
      </div>
    </div>
  )
}

function ALigar() {
  return (
    <CallPanel call={chamada} channel="!geral:s" participants={[{ address: "@ana:s", connected: true, stream: null }]}
      localStream={null} selfLabel="Duarte" selfProfile={{ displayName: "Duarte", donations: [] }} nameFor={(x) => x.slice(1, 4)}
      directory={new Map()} onLeave={noop} modo="sala" aLigar={["@ana:s", "@rui:s", "@eva:s"]} />
  )
}

function Demo() {
  return (
    <ToastContext.Provider value={noop}>
      {vista === "folha" ? <Folha /> : vista === "cartoes" ? <Cartoes /> : vista === "lateral" ? <Lateral /> : <ALigar />}
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

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] })
const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? ` — ${detalhe}` : ""}`)
}

async function abrir(vista, largura, extra = "") {
  const ctx = await browser.newContext({ viewport: { width: largura, height: largura < 600 ? 844 : 860 } })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(`file://${join(SAIDA, "index.html")}?vista=${vista}${extra}`)
  await page.waitForTimeout(400)
  return { page, ctx, erros }
}

for (const largura of [1280, 390]) {
  const id = String(largura)

  // 1. The "connecting" cards.
  {
    const { page, ctx, erros } = await abrir("aLigar", largura)
    await page.waitForTimeout(500)
    const medida = await page.evaluate(() =>
      [...document.querySelectorAll(".call-chip.a-ligar")].map((c) => ({
        opacidade: getComputedStyle(c).opacity,
        animacao: getComputedStyle(c.querySelector(".anel-de-voz.repouso")).animationName,
        roda: getComputedStyle(c.querySelector(".anel-de-voz.repouso")).transform,
      })),
    )
    check(`${id}: três cartões "a ligar", e o de quem já ligou fica normal`, medida.length === 2, String(medida.length))
    check(`${id}: "a ligar" esbatido e a girar`, medida.every((m) => m.opacidade === "0.5" && m.animacao === "anel-a-ligar" && m.roda !== "none"), JSON.stringify(medida[0]))
    check(`${id}: "a ligar" sem erros`, erros.length === 0, erros.join(" | "))
    await page.screenshot({ path: join(SAIDA, `${id}-a-ligar.png`) })
    await ctx.close()
  }

  // 2. The side card and buttons with brightness.
  if (largura === 1280) {
    const { page, ctx, erros } = await abrir("lateral", largura)
    const lateral = await page.evaluate(() => {
      const doca = document.querySelector(".call-dock.lateral")
      return {
        botoes: doca.querySelectorAll("button").length,
        desligar: doca.querySelectorAll(".call-btn.hangup").length,
        fundo: getComputedStyle(doca).backgroundColor,
        brilho: getComputedStyle(document.querySelector(".primary")).boxShadow,
        brilhoPerigo: getComputedStyle(document.querySelector(".danger")).boxShadow,
        desligadoSemBrilho: getComputedStyle(document.querySelector(".primary:disabled")).boxShadow,
      }
    })
    // Since panel P1 (28 October 2026) disconnect moved from the side card to the
    // button row of the panel (`CartaoDaConta`), and is measured in
    // `scripts/retratar-painel-de-controlo.mjs`. Here only back remains.
    check("lateral: só voltar, sem desligar (é do painel)", lateral.botoes === 1 && lateral.desligar === 0, JSON.stringify({ botoes: lateral.botoes, desligar: lateral.desligar }))
    // Panel P1 (28 October 2026) put the side card in a green box, very light (6 %),
    // between the account and the button row.
    check("lateral: a caixa verde do painel P1", lateral.fundo === "rgba(80, 250, 123, 0.06)", lateral.fundo)
    check("botões: o primário e o de perigo brilham; o desligado não", lateral.brilho.includes("14px") && lateral.brilhoPerigo.includes("14px") && lateral.desligadoSemBrilho === "none", `${lateral.brilho} · ${lateral.desligadoSemBrilho}`)
    for (const sel of [".call-dock.lateral", "[data-botoes] .primary:not(:disabled)", "[data-botoes] .danger"]) {
      const c = await medirContraste(page, sel)
      check(`contraste ${sel}: ${c.pior ? `${c.pior.valor}:1 (${c.pior.texto})` : "sem texto"}`, c.falhas.length === 0, c.falhas.map((f) => `${f.texto} ${f.valor}`).join(", "))
    }
    check("lateral sem erros", erros.length === 0, erros.join(" | "))
    await page.screenshot({ path: join(SAIDA, `${id}-lateral-e-botoes.png`) })
    await ctx.close()
  }

  // 3. Four cards playing: fps with and without visualizer.
  {
    const medidas = {}
    for (const com of ["1", "0"]) {
      const { page, ctx, erros } = await abrir("cartoes", largura, `&visualizador=${com}`)
      await page.evaluate(() => window.__ctx?.resume?.())
      await page.waitForTimeout(800)
      medidas[com] = await medirFps(page, 3000)
      if (com === "1") {
        const visor = await page.evaluate(() => ({
          canvas: document.querySelectorAll(".visualizador canvas").length,
          rodape: document.querySelectorAll(".call-chip-musica .andante-caixa").length,
          anda: document.querySelectorAll(".call-chip-musica .andante-caixa.andante").length,
          calada: document.querySelectorAll(".call-chip-musica.calada").length,
        }))
        // The footer is the listener's console (design D1, 28 October 2026): 40 px,
        // the mute button and the timeline INSIDE it and in one line, not touching
        // each other or the track name; and the person's name above the footer, not
        // below. Before the footer hid the mute button.
        const consola = await page.evaluate(() =>
          [...document.querySelectorAll(".call-chip.com-rodape")].map((cartao) => {
            const caixa = (el) => el?.getBoundingClientRect() ?? null
            const rodape = caixa(cartao.querySelector(".call-chip-musica"))
            // The label comes out in a narrow footer (`display: none`, empty box): counts what shows.
            const partes = ["svg", ".call-chip-musica-nome", ".chip-musica-calar", ".chip-volume-musica"]
              .map((sel) => caixa(cartao.querySelector(`.call-chip-musica > ${sel}`)))
              .filter((r) => r && r.width > 0)
            const nome = caixa(cartao.querySelector(".call-chip-labels"))
            const dentro = partes.every((r) => r && r.top >= rodape.top - 0.5 && r.bottom <= rodape.bottom + 0.5)
            const emLinha = partes.every((r, i) => !r || i === 0 || r.left >= partes[i - 1].right - 0.5)
            const larguraDoNome = Math.round(caixa(cartao.querySelector(".call-chip-musica-nome")).width)
            return { altura: Math.round(rodape.height), partes: partes.length, dentro, emLinha, larguraDoNome, nomePorCima: nome.bottom <= rodape.top + 0.5 }
          }),
        )
        check(
          `${id}: rodapé de 40 px com calar e régua dentro, numa linha, e o nome por cima`,
          consola.length === 4 && consola.every((c) => c.altura === 40 && c.partes >= 3 && c.dentro && c.emLinha && c.nomePorCima && c.larguraDoNome >= 56),
          JSON.stringify(consola),
        )
        check(`${id}: um cartão calado`, visor.calada === 1, String(visor.calada))
        check(`${id}: quatro visualizadores e quatro rodapés`, visor.canvas === 4 && visor.rodape === 4, JSON.stringify(visor))
        check(`${id}: o nome comprido anda no rodapé`, visor.anda >= 1, String(visor.anda))
        check(`${id}: cartões sem erros`, erros.length === 0, erros.join(" | "))
        await page.screenshot({ path: join(SAIDA, `${id}-quatro-cartoes.png`) })
        // The contrast of the name and footer above the visualizer.
        //
        // Controls hide during the measurement, and only then. The `medirContraste`
        // reads the background from the ENTIRE box of the text, and the box of a
        // moving name is the strip, wider than the footer: `overflow` cuts the
        // drawing, not the box. With the button and timeline beside (design D1), the
        // background read was the bright icon of the button, over which text never
        // passes on screen. Without them we read the footer, which is the real
        // background of the name.
        const semControlos = await page.addStyleTag({
          content: ".call-chip-musica .chip-musica-calar, .call-chip-musica .chip-volume-musica { visibility: hidden !important; }",
        })
        const c = await medirContraste(page, ".call-chip-labels, .call-chip-musica")
        await semControlos.evaluate((no) => no.remove())
        check(`${id}: contraste por cima do visualizador ${c.pior ? `${c.pior.valor}:1 (${c.pior.texto})` : ""}`, c.falhas.length === 0, c.falhas.map((f) => `${f.texto} ${f.valor}`).join(", "))
      }
      await ctx.close()
    }
    console.log(`INFO  ${id}: fps com visualizador ${medidas["1"].fps} (p95 ${medidas["1"].p95} ms), sem ${medidas["0"].fps} (p95 ${medidas["0"].p95} ms)`)
    check(`${id}: quatro cartões a 60 fps com o visualizador`, medidas["1"].fps >= 58, `${medidas["1"].fps} fps`)
  }

  // 4. The "Share audio" sheet, playing.
  {
    const { page, ctx, erros } = await abrir("folha", largura)
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(SAIDA, `${id}-folha-parada.png`) })
    await page.evaluate(() => window.__tocar())
    await page.waitForTimeout(2500)
    const folha = await page.evaluate(() => {
      const canvas = document.querySelector(".audio-espectro")
      const px = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data
      let acesos = 0
      for (let i = 3; i < px.length; i += 4) if (px[i] > 0) acesos++
      const sheet = document.querySelector(".partilhar-audio")
      const r = sheet.getBoundingClientRect()
      return {
        tempo: document.querySelector(".audio-visor-digitos").textContent,
        acesos,
        linhas: document.querySelectorAll(".audio-faixa").length,
        duracoes: [...document.querySelectorAll(".audio-faixa-duracao")].map((d) => d.textContent),
        actual: document.querySelector(".audio-faixa.actual .audio-faixa-titulo")?.textContent,
        lado: document.documentElement.scrollWidth <= innerWidth,
        cabe: r.left >= 0 && r.right <= innerWidth,
        raio: getComputedStyle(sheet).borderTopLeftRadius,
        letreiroAnda: document.querySelector(".audio-visor-letreiro").classList.contains("andante"),
      }
    })
    check(`${id}: folha: o tempo anda`, folha.tempo !== "0:00", folha.tempo)
    check(`${id}: folha: o espectro desenha`, folha.acesos > 0, `${folha.acesos} píxeis`)
    check(`${id}: folha: quatro linhas, com as durações`, folha.linhas === 4 && folha.duracoes.join(" ") === "0:30 0:08 0:12 0:06", folha.duracoes.join(" "))
    check(`${id}: folha: a actual marcada`, folha.actual === "01 Abertura", folha.actual)
    check(`${id}: folha: cabe, sem deslocação de lado, cantos de 18 px`, folha.lado && folha.cabe && folha.raio === "18px", JSON.stringify({ lado: folha.lado, cabe: folha.cabe, raio: folha.raio }))
    const c = await medirContraste(page, ".partilhar-audio")
    check(`${id}: folha: contraste ${c.pior ? `${c.pior.valor}:1 (${c.pior.texto})` : ""}`, c.falhas.length === 0, c.falhas.map((f) => `${f.texto} ${f.valor}`).join(", "))
    check(`${id}: folha sem erros`, erros.length === 0, erros.join(" | "))
    await page.screenshot({ path: join(SAIDA, `${id}-folha-a-tocar.png`), fullPage: true })
    await ctx.close()
  }
}

await browser.close()
const passaram = resultados.filter(Boolean).length
console.log(`\n${passaram}/${resultados.length} PASS`)
process.exit(passaram === resultados.length ? 0 : 1)
