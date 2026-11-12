/**
 * The voice, visualized, measured in a real layout engine.
 *
 * Why this exists instead of another test: tests of this piece run in jsdom,
 * and **jsdom applies no stylesheets and animates nothing.** It says that `--voz`
 * was written to the card, which is half the story; it does not know if the bars
 * move up, if the card ring grows, if anything shifts because of it, or if with
 * `prefers-reduced-motion` the design stays still. Those are calculated pixels,
 * and you need a browser to have them.
 *
 * And there is a second thing only a browser can tell you: **the cost**. This runs
 * on each participant of each call, sixty times per second. The number is in block
 * 3, and comes from Chromium's own counters (style recalculation, layout, script)
 * compared with the same frames at rest.
 *
 *   node scripts/medir-voz-visivel.mjs
 *   ANTIGO=1 node scripts/medir-voz-visivel.mjs
 *
 * The second form restores by CSS the old design, no wave at all, and the call
 * card without a ring, and the measurements that bite must come out RED. If
 * they are the same in both, you are not measuring anything.
 *
 * What it does NOT prove: that the meter measures well (that is
 * `packages/ui/src/hooks/useNivelDeVoz.test.tsx`), or that the right cards
 * get the right streams (`CallPanel.voz.test.tsx`, `CallDock.voz.test.tsx`).
 * Here we measure what you see and what you pay.
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-voz-visivel")
const RAIZ = join(AQUI, "..")

mkdirSync(SAIDA, { recursive: true })

/** How many people in the test call. Eight is a full call for this product. */
const PESSOAS = 8

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { CallPanel } from ${JSON.stringify(join(RAIZ, "packages/ui/src/screens/call/CallPanel.js"))}
import { CallDock, clamp } from ${JSON.stringify(join(RAIZ, "packages/ui/src/screens/call/CallDock.js"))}
import ${JSON.stringify(join(RAIZ, "packages/ui/src/styles.css"))}

const p = new URLSearchParams(location.search)
const PESSOAS = Number(p.get("pessoas") ?? "${PESSOAS}")
const NOMES = ["Ana", "Rui", "Maria", "João", "Inês", "Pedro", "Sofia", "Tiago"]

/** Um motor de chamada a fingir: este guião mede o desenho, não a chamada. */
const motor = {
  setMuted() {},
  setCameraOff() {},
  active: false,
  tectoDePartilha: 6,
  podePartilharEcra: true,
  medirLimiteDeVideo: () => Promise.resolve(null),
  startScreenShare: () => Promise.resolve(false),
  stopScreenShare: () => Promise.resolve(),
}

function Demo() {
  const [vozes, setVozes] = useState(null)

  /*
    O microfone a sério, quando se pede.

    O Chromium arranca com \`--use-fake-device-for-media-stream\`, que entrega
    uma faixa de som verdadeira com um apito periódico. É isso que faz o bloco
    do fim medir o caminho INTEIRO — captura, ganho, clone, analisador, CSS — e
    não uma propriedade escrita à mão.
  */
  useEffect(() => {
    if (p.get("vivo") !== "sim") return
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => setVozes(stream))
      .catch((causa) => {
        document.getElementById("erro").textContent = String(causa)
      })
  }, [])

  const participantes = Array.from({ length: PESSOAS - 1 }, (_, i) => ({
    address: "@" + NOMES[i % NOMES.length].toLowerCase() + ":s",
    connected: true,
    stream: vozes,
    video: false,
    encrypted: true,
    micMuted: false,
    screen: null,
  }))

  return (
    <div className="app">
      <main className="main">
        <CallPanel
          call={motor}
          channel="!lagar:s"
          participants={participantes}
          localStream={vozes}
          selfLabel="Eu"
          selfProfile={{ displayName: "Eu", donations: [] }}
          nameFor={(quem) => NOMES[participantes.findIndex((x) => x.address === quem)] ?? quem}
          directory={new Map()}
          onToggleMic={() => {}}
          onToggleSound={() => {}}
          onLeave={() => {}}
        />

        <p id="erro" style={{ color: "#e5534b", padding: "0 16px" }} />
      </main>

      <CallDock
        channel="!lagar:s"
        channelLabel="Lagar do Zé"
        roomLabel="pátio"
        participants={participantes}
        localStream={vozes}
        nameFor={(quem) => quem}
        onBack={() => {}}
        onLeave={() => {}}
      />
    </div>
  )
}

createRoot(document.getElementById("raiz")).render(<Demo />)

/**
 * As ferramentas de medição, postas na página e não no guião.
 *
 * Amostrar geometria tem de acontecer QUADRO A QUADRO dentro da página: uma
 * leitura por chamada do Playwright chega a cada 20 ou 30 ms e apanha a
 * animação em pontos ao acaso. O que interessa é o mínimo e o máximo de cada
 * barra ao longo de uma volta inteira.
 */
/**
 * A doca arrastada para o canto, pelo caminho verdadeiro.
 *
 * \`clamp\` é a função que decide até onde a doca pode ir, e é ela que promete
 * que a doca continua alcançável. Usa-se a de verdade e não uma cópia: o número
 * que ela guarda (\`LARGURA_A_SALVO\`) tem de acompanhar a largura da doca, e
 * foi por não ter acompanhado que a onda quase deixou o botão de desligar
 * meio fora do ecrã.
 */
window.__aoCanto = () => {
  const sitio = clamp({ x: 99_999, y: 99_999 })
  const doca = document.querySelector(".call-dock")
  doca.style.left = sitio.x + "px"
  doca.style.top = sitio.y + "px"
  doca.style.right = "auto"
  doca.style.bottom = "auto"
  const r = doca.getBoundingClientRect()
  return {
    largura: Math.round(r.width),
    foraADireita: Math.round(Math.max(0, r.right - window.innerWidth)),
    foraEmBaixo: Math.round(Math.max(0, r.bottom - window.innerHeight)),
  }
}

window.__voz = (valor) => {
  for (const alvo of document.querySelectorAll(".call-chip, .call-dock")) {
    if (valor === null) alvo.style.removeProperty("--voz")
    else alvo.style.setProperty("--voz", String(valor))
  }
}

/*
  Amostra por TEMPO e não por número de quadros, e a diferença já mordeu.

  A primeira versão contava 45 quadros. Este Chromium corre a 120 Hz: 45 quadros
  são 375 ms, e a volta mais lenta de uma barra é de 1,2 s. O que se media eram
  bocados de uma volta, e as barras apanhadas perto de um ponto de retorno (onde
  a curva de aceleração as deixa quase paradas) davam uma amplitude de três
  décimos de píxel. O guião dizia que elas não se mexiam; mexiam-se todas.
*/
window.__amostrar = (selector, ms) =>
  new Promise((resolve) => {
    const elementos = [...document.querySelectorAll(selector)]
    const alturas = elementos.map(() => [])
    const inicio = performance.now()
    const passo = (agora) => {
      elementos.forEach((elemento, i) => alturas[i].push(elemento.getBoundingClientRect().height))
      if (agora - inicio >= ms) {
        resolve(alturas.map((serie) => ({ minimo: Math.min(...serie), maximo: Math.max(...serie) })))
        return
      }
      requestAnimationFrame(passo)
    }
    requestAnimationFrame(passo)
  })

/**
 * Correr N quadros com QUANTOS cartões a receber um valor novo em cada um.
 *
 * "Quantos" é a variável que interessa e a que separa o pior caso da verdade.
 * O medidor só escreve quando o nível muda mais de 0,02, e quem está calado
 * fica nos mesmos 0,00 sem escrever nada — numa chamada de oito pessoas há uma
 * ou duas a falar, não oito. Medem-se os dois: uma pessoa, que é o dia-a-dia, e
 * a chamada inteira em coro, que não acontece e serve de tecto.
 */
window.__correr = (quadros, quantos) =>
  new Promise((resolve) => {
    const cartoes = [...document.querySelectorAll(".call-chip")].slice(0, quantos)
    let feitos = 0
    const passo = () => {
      const valor = (Math.sin(feitos / 7) * 0.5 + 0.5).toFixed(2)
      for (const cartao of cartoes) cartao.style.setProperty("--voz", valor)
      if (++feitos >= quadros) {
        resolve(feitos)
        return
      }
      requestAnimationFrame(passo)
    }
    requestAnimationFrame(passo)
  })
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

/**
 * The OLD design, restored by CSS, so the measurement proves itself.
 *
 * It is not a rebuild from the old commit: it is what it takes to bring back the
 * flaw that these measurements say went away. Before this the only output from
 * the meter was a three-pixel ring around a hidden video box with zero height,  * in Settings and the dock there was nothing, and on the call card there was
 * nothing either.
 */
const ANTIGO = `
  .onda { display: none !important; }
  .call-chip { box-shadow: none !important; }
`

writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="pagina.css">` +
    (process.env.ANTIGO ? `<style>${ANTIGO}</style>` : "") +
    `<body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

/**
 * The microphone faking from Chromium itself.
 *
 * `--use-fake-device-for-media-stream` delivers a real audio track with a
 * periodic beep, and `--use-fake-ui-for-media-stream` grants permission
 * without a dialog. It lets the final block measure the whole path instead of
 * writing the property by hand.
 */
const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
})

const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push({ etiqueta, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? ` — ${detalhe}` : ""}`)
}
const nota = (texto) => console.log(`      ${texto}`)

async function abrir(opcoes = {}, procura = "") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opcoes })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(`file://${join(SAIDA, "index.html")}${procura}`)
  await page.waitForSelector(".call-chip", { timeout: 10_000 })
  return { ctx, page, erros }
}

// ---------------------------------------------- 1. the design, and what it costs the layout
{
  const { ctx, page, erros } = await abrir()
  check("a página desenha sem erros", erros.length === 0, erros[0] ?? "")

  const presentes = await page.evaluate(() => ({
    cartao: document.querySelectorAll(".call-chip-onda .onda-barra").length,
    doca: document.querySelectorAll(".call-dock-onda .onda-barra").length,
    ponto: document.querySelectorAll(".call-dock .call-dot").length,
    area: [...document.querySelectorAll(".onda-barra")].every((barra) => {
      const r = barra.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }),
  }))
  check(
    "as duas superfícies desenham onda, e todas as barras ocupam área",
    presentes.cartao > 0 && presentes.doca === 5 && presentes.area,
    `cartão ${presentes.cartao}, doca ${presentes.doca}`,
  )
  check("a doca já não tem o ponto que pulsava a relógio", presentes.ponto === 0, `${presentes.ponto} pontos`)

  /*
    What really matters: the bars MOVE UP with the voice.

    Sampled frame by frame over a full animation cycle. At rest the bar is 14%
    of the box and does not move much; at maximum voice it must clearly go
    higher. A test that checked the name of a class would follow any rename and
    always say yes.
  */
  /*
    There is no animation to measure: the height of each bar is a function of the
    level. So we measure what really matters, which is the function, the same
    wave at four levels, bar by bar.
  */
  const escala = await page.evaluate(() => {
    const barras = () =>
      [...document.querySelectorAll(".call-dock-onda .onda-barra")].map(
        (b) => +b.getBoundingClientRect().height.toFixed(2),
      )
    const caixa = document.querySelector(".call-dock-onda")
    const lido = {}
    for (const nivel of [0, 0.3, 0.7, 1]) {
      window.__voz(nivel)
      lido[nivel] = barras()
    }
    return { ...lido, altura: caixa.offsetHeight }
  })

  const pico = (nivel) => Math.max(...escala[nivel])
  check(
    "em silêncio as barras ficam baixas: uma linha, e não nada",
    pico(0) > 0.5 && pico(0) < escala.altura * 0.3,
    `pico ${pico(0).toFixed(1)}px de ${escala.altura}px`,
  )
  check(
    "com voz sobem, e sobem muito",
    pico(1) > escala.altura * 0.95 && pico(1) > pico(0) * 2.5,
    `${pico(0).toFixed(1)}px → ${pico(1).toFixed(1)}px de ${escala.altura}px`,
  )
  check(
    "e sobem por degraus: a onda cresce do centro para fora",
    escala[0.3][2] > escala[0][2] * 1.5 && escala[0.3][0] === escala[0][0] && escala[0.7][0] > escala[0][0],
    `a 30%: centro ${escala[0.3][2]}px, ponta ${escala[0.3][0]}px; a 70% a ponta vai em ${escala[0.7][0]}px`,
  )
  check(
    "e nenhuma barra desce quando a voz sobe",
    [0.3, 0.7, 1].every((nivel, i) => escala[nivel].every((altura, b) => altura >= escala[[0, 0.3, 0.7][i]][b])),
    JSON.stringify(escala[0.7]),
  )

  /*
    The card ring, and the promise it has to keep: grow without pushing.

    It is drawn with `box-shadow` and not `border` for exactly this reason. A
    border is part of the box, and changing it pushed the whole card row on each
    syllable from each person.
  */
  const anel = await page.evaluate(() => {
    const cartao = document.querySelector(".call-chip")
    const posicao = () =>
      [...document.querySelectorAll(".call-chip")].map((c) => {
        const r = c.getBoundingClientRect()
        return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`
      })
    window.__voz(0)
    const calado = { sombra: getComputedStyle(cartao).boxShadow, caixas: posicao() }
    window.__voz(1)
    const aFalar = { sombra: getComputedStyle(cartao).boxShadow, caixas: posicao() }
    return { calado, aFalar }
  })
  check(
    "o cartão de quem fala acende um anel",
    anel.calado.sombra !== anel.aFalar.sombra && /px/.test(anel.aFalar.sombra),
    `${anel.calado.sombra} → ${anel.aFalar.sombra}`,
  )
  check(
    "e nada se desloca por causa disso: os cartões ficam todos onde estavam",
    JSON.stringify(anel.calado.caixas) === JSON.stringify(anel.aFalar.caixas),
    anel.calado.caixas
      .map((antes, i) => (antes === anel.aFalar.caixas[i] ? null : `${antes} → ${anel.aFalar.caixas[i]}`))
      .filter(Boolean)
      .join(" | "),
  )

  /*
    The dock is draggable and anchored to the viewport by a declared width
    (`LARGURA_A_SALVO`). If it grew with the level, the place where you could
    drop it changed depending on who was talking.
  */
  const medidas = await page.evaluate(() => {
    const caixa = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect()
      return `${Math.round(r.width)}×${Math.round(r.height)}`
    }
    window.__voz(0)
    const calado = { doca: caixa(".call-dock") }
    window.__voz(1)
    return { calado, aFalar: { doca: caixa(".call-dock") } }
  })
  check(
    "a doca tem o mesmo tamanho com voz e sem ela",
    medidas.calado.doca === medidas.aFalar.doca,
    `doca ${medidas.calado.doca} → ${medidas.aFalar.doca}`,
  )

  /*
    And the dock stays reachable after it gets fatter.

    The wave added 26 pixels to it. `LARGURA_A_SALVO` is the promise that the
    dock does not leave the screen, and a hand-written promise that does not
    track the real width leaves out the far corner, the hang-up button, which is
    what you look for first. Drag it to the corner for real and measure what got
    left out.
  */
  const canto = await page.evaluate(() => window.__aoCanto())
  check(
    "arrastada ao canto, a doca continua inteira dentro do ecrã",
    canto.foraADireita === 0 && canto.foraEmBaixo === 0,
    `${canto.largura}px de largura; ${canto.foraADireita}px fora à direita, ${canto.foraEmBaixo}px em baixo`,
  )

  await page.evaluate(() => window.__voz(0.85))
  await page.screenshot({ path: join(AQUI, "_saida-voz-1280.png"), fullPage: false })
  await ctx.close()
}

// ---------------------------------------------------------- 1b. 390px: mobile
{
  /*
    The wave landed on a card that was already narrow, and in a row that was
    already wrapping. What we measure here is what a 390px column will not
    forgive: the page gaining a horizontal bar, and the dock running off the
    right.
    */
  const { ctx, page, erros } = await abrir({ viewport: { width: 390, height: 780 } })
  check("a página desenha sem erros a 390px", erros.length === 0, erros[0] ?? "")

  await page.evaluate(() => window.__voz(1))
  const estreito = await page.evaluate(() => ({
    transbordo: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cartoes: [...document.querySelectorAll(".call-chip")].filter(
      (c) => c.getBoundingClientRect().right > window.innerWidth,
    ).length,
    ondas: [...document.querySelectorAll(".call-chip-onda")].filter(
      (o) => o.getBoundingClientRect().width > 0,
    ).length,
  }))
  check(
    "num telemóvel a página não ganha barra horizontal, e nenhum cartão sai pela direita",
    estreito.transbordo <= 0 && estreito.cartoes === 0,
    `${estreito.transbordo}px de transbordo, ${estreito.cartoes} cartões fora`,
  )
  check("e as ondas dos cartões continuam todas desenhadas", estreito.ondas === PESSOAS, `${estreito.ondas} ondas`)

  const cantoEstreito = await page.evaluate(() => window.__aoCanto())
  check(
    "e a doca cabe no ecrã de um telemóvel",
    cantoEstreito.foraADireita === 0 && cantoEstreito.foraEmBaixo === 0,
    `${cantoEstreito.largura}px; ${cantoEstreito.foraADireita}px fora à direita`,
  )

  await page.screenshot({ path: join(AQUI, "_saida-voz-390.png") })
  await ctx.close()
}

// --------------------------------------------------- 2. movimento reduzido
{
  const { ctx, page } = await abrir({ reducedMotion: "reduce" })

  /*
    With this setting on, changing the level cannot change a single pixel of
    geometry. We measure with the voice varying end to end: if any bar changed
    size, it would show here.
  */
  const quieto = await page.evaluate(() => {
    const barras = () =>
      [...document.querySelectorAll(".call-dock-onda .onda-barra")].map(
        (b) => +b.getBoundingClientRect().height.toFixed(2),
      )
    window.__voz(0)
    const calado = barras()
    window.__voz(0.5)
    const meio = barras()
    window.__voz(1)
    return { calado, meio, alto: barras(), altura: document.querySelector(".call-dock-onda").offsetHeight }
  })
  check(
    "com movimento reduzido, mudar o nível não mexe um único píxel",
    JSON.stringify(quieto.calado) === JSON.stringify(quieto.alto) &&
      JSON.stringify(quieto.calado) === JSON.stringify(quieto.meio),
    `${JSON.stringify(quieto.calado)} → ${JSON.stringify(quieto.alto)}`,
  )
  check(
    "e as barras ficam à altura toda, em vez de desaparecerem",
    quieto.alto.every((altura) => altura >= quieto.altura - 0.5),
    `${JSON.stringify(quieto.alto)} de ${quieto.altura}px`,
  )

  /*
    The level is still there, and that is the difference between respecting the
    preference and erasing information from someone who asked only for quiet.
    The bars light up in the same order as always, from center outward, like a
    segment meter.
    */
  const cores = await page.evaluate(() => {
    const barras = () =>
      [...document.querySelectorAll(".call-dock-onda .onda-barra")].map((b) => getComputedStyle(b).backgroundColor)
    window.__voz(0)
    const calado = barras()
    window.__voz(0.3)
    const baixinho = barras()
    window.__voz(1)
    return { calado, baixinho, alto: barras() }
  })
  check(
    "mas o nível continua a ver-se: as barras mudam de cor com a voz",
    cores.calado[2] !== cores.alto[2],
    `${cores.calado[2]} → ${cores.alto[2]}`,
  )
  check(
    "e acendem-se do centro para fora, na mesma ordem em que subiriam",
    cores.baixinho[2] !== cores.calado[2] && cores.baixinho[0] === cores.calado[0],
    `a 30%: centro ${cores.baixinho[2]}, ponta ${cores.baixinho[0]}`,
  )

  const cartao = await page.evaluate(() => {
    const chip = document.querySelector(".call-chip")
    window.__voz(0)
    const calado = { sombra: getComputedStyle(chip).boxShadow, moldura: getComputedStyle(chip).borderTopColor }
    window.__voz(1)
    return { calado, aFalar: { sombra: getComputedStyle(chip).boxShadow, moldura: getComputedStyle(chip).borderTopColor } }
  })
  check(
    "o anel do cartão não cresce, e a moldura muda de cor no lugar dele",
    cartao.aFalar.sombra === "none" && cartao.calado.moldura !== cartao.aFalar.moldura,
    `sombra ${cartao.aFalar.sombra}; moldura ${cartao.calado.moldura} → ${cartao.aFalar.moldura}`,
  )

  await ctx.close()
}

// ---------------------------------------------------- 3. the cost per frame
{
  const { ctx, page } = await abrir()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send("Performance.enable")

  const ler = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics")
    const de = (nome) => metrics.find((m) => m.name === nome)?.value ?? 0
    return {
      estilo: de("RecalcStyleDuration"),
      layout: de("LayoutDuration"),
      script: de("ScriptDuration"),
      layouts: de("LayoutCount"),
      estilos: de("RecalcStyleCount"),
    }
  }

  const QUADROS = 400
  const us = (segundos) => (segundos * 1e6) / QUADROS

  /**
   * A scenario: warm up in the SAME form you will measure, only then count.
   *
   * Warmup has to be in the measured form and no other. With a "speaking"
   * warmup followed by a measurement at rest, the first frames of rest still pay
   * the cost of the old form, and rest came out six times more expensive than it
   * is, that is what happened first, and the near-conclusion was that silent
   * animation costs half a millisecond. It costs almost nothing next to that.
   */
  const medir = async (quantos) => {
    await page.evaluate(([n, q]) => window.__correr(n, q), [90, quantos])
    const antes = await ler()
    await page.evaluate(([n, q]) => window.__correr(n, q), [QUADROS, quantos])
    const depois = await ler()
    return {
      total: us(depois.estilo - antes.estilo + (depois.layout - antes.layout) + (depois.script - antes.script)),
      estilo: us(depois.estilo - antes.estilo),
      layout: us(depois.layout - antes.layout),
      script: us(depois.script - antes.script),
      layouts: (depois.layouts - antes.layouts) / QUADROS,
    }
  }

  const repouso = await medir(0)
  const umaPessoa = await medir(1)
  const emCoro = await medir(PESSOAS)

  const custoDeUma = umaPessoa.total - repouso.total
  const custoDeTodas = emCoro.total - repouso.total
  const layoutsPorQuadro = emCoro.layouts - repouso.layouts

  nota(`${PESSOAS} cartões no ecrã, ${QUADROS} quadros medidos por cenário. Tudo por quadro:`)
  nota(
    `  chamada calada, com as ondas todas desenhadas: ${repouso.total.toFixed(0)} µs ` +
      `(o preço de a onda existir; sem animação nenhuma, é só a página)`,
  )
  nota(`  uma pessoa a falar: +${custoDeUma.toFixed(0)} µs   (o dia-a-dia)`)
  nota(
    `  as ${PESSOAS} em coro, valor novo em todos os quadros: +${custoDeTodas.toFixed(0)} µs ` +
      `(${(custoDeTodas / PESSOAS).toFixed(0)} µs por pessoa; tecto que não acontece)`,
  )
  nota(
    `  repartido: estilo ${emCoro.estilo.toFixed(0)} µs, layout ${emCoro.layout.toFixed(0)} µs, ` +
      `script ${emCoro.script.toFixed(0)} µs`,
  )

  /*
    The cap that matters: LAYOUTS.

    A frame is 16.7 ms. A few extra microseconds of styling do not feel like much;
    one extra layout per frame on a full page feels like a lot, and that is what
    would happen if some bar animated `height` instead of `transform`. That is
    why this is the number with a limit and not a note.
  */
  check(
    "desenhar a voz não obriga a refazer o layout da página",
    layoutsPorQuadro < 0.05,
    `${layoutsPorQuadro.toFixed(3)} layouts extra por quadro`,
  )
  check(
    "uma chamada calada não paga quase nada por ter ondas",
    repouso.total < 400,
    `${repouso.total.toFixed(0)} µs por quadro com ${PESSOAS} cartões`,
  )
  check(
    "e uma pessoa a falar fica numa fracção do orçamento de 16,7 ms",
    custoDeUma < 400,
    `${custoDeUma.toFixed(0)} µs por quadro`,
  )

  await ctx.close()
}

// ------------------------------------- 4. the whole path, with a real microphone
{
  const { ctx, page, erros } = await abrir({ permissions: ["microphone"] }, "?vivo=sim")

  /*
    The beep from Chromium's fake device is periodic: there are seconds of
    silence between them. We wait for the first one, and what we expect is
    `--voz` written on the dock by the real meter: capture, analyzer, and from
    there to CSS. Up to 0.9 this measured the `MedidorDeEntrada` from settings,
    which is gone: the microphone test became the voice chain test, which does
    not draw a wave.
    */
  let maximo = 0
  const limite = Date.now() + 12_000
  while (Date.now() < limite && maximo < 0.1) {
    maximo = await page.evaluate(() => {
      const caixa = document.querySelector(".call-dock")
      return Number(caixa?.style.getPropertyValue("--voz") ?? "0")
    })
    if (maximo < 0.1) await page.waitForTimeout(120)
  }

  check("um microfone a sério faz a doca mexer-se", maximo >= 0.1, `nível máximo lido: ${maximo}`)

  const barras = await page.evaluate(() => window.__amostrar(".call-dock-onda .onda-barra", 1600))
  const alturaDaOnda = await page.evaluate(
    () => document.querySelector(".call-dock-onda").getBoundingClientRect().height,
  )
  check(
    "e as barras da doca sobem com ele",
    Math.max(...barras.map((b) => b.maximo)) > alturaDaOnda * 0.3,
    `pico ${Math.max(...barras.map((b) => b.maximo)).toFixed(1)}px de ${alturaDaOnda.toFixed(0)}px`,
  )

  check("sem erros de página com o microfone aberto", erros.length === 0, erros[0] ?? "")
  await page.screenshot({ path: join(AQUI, "_saida-voz-vivo.png") })
  await ctx.close()
}

await browser.close()

const falhados = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length - falhados.length}/${resultados.length}`)
if (process.env.ANTIGO) {
  console.log(
    falhados.length > 0
      ? `\nCom o desenho antigo falharam ${falhados.length}: a medição morde.`
      : "\nCom o desenho antigo não falhou NADA. A medição não está a medir o que diz.",
  )
  process.exit(falhados.length > 0 ? 0 : 1)
}
process.exit(falhados.length === 0 ? 0 : 1)
