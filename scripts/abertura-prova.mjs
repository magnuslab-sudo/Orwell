// Web startup, measured in Chrome for real: the first paint, splash swap,
// exit, and banners with the main thread blocked.
//
// Until 3 November 2026 the first paint was just the background (about 1.5 s
// on orwell.pt), the `<Splash />` appeared when the bundle finished loading and
// the gate removed it 8 to 17 ms later: startup flickered one or two frames.
// This script proves the fix with video, not with sources:
//
//   1. serves a `dist` with `vite preview` on 127.0.0.1, opens it in a fresh
//      profile (no account: the app stays on the gate and never contacts a
//      homeserver), in both motion modes, on a local network and on a slow
//      network (4 Mbit/s, 150 ms) mimicking orwell.pt;
//   2. records the screen, extracts frames at 12 per second with ffmpeg and
//      classifies each by ring and distance to the final screen: white (before
//      page load), background (page painted and startup not there), startup,
//      after (gate ready);
//   3. logs, frame by frame within the page, which splash is on screen, the
//      ring's `startTime` (must be the same across all builds), the exit veil
//      opacity and long tasks;
//   4. with the bundle cut (only the HTML splash remains) and the main thread
//      blocked for two seconds, checks if the banners (SVG `<path>` opacity
//      with `drop-shadow`) keep animating, alongside a control that only the
//      main thread paints (an animated width).
//
// Usage:
//   node scripts/abertura-prova.mjs --dist apps/web/dist --saida /path/to/results
//   node scripts/abertura-prova.mjs --dist /other/dist --saida … --rotulo before --sem-encravar
//   node scripts/abertura-prova.mjs --motor firefox --saida …   (or --motor webkit)
//
// `--motor firefox|webkit` (3/11/2026, in 1.2.0 integration): Firefox and
// Playwright's WebKit, headless and NO video. Firefox headless video drops
// and repeats frames, not fit for frame counting. This measures inside the
// page, via `requestAnimationFrame` and `getAnimations()`: whether startup
// appears on the first frame, whether there are frames with no startup and no
// screen between splash and gate, whether all `abertura-*` animations have the
// same `startTime` across all builds, and whether the exit veil passes through
// mid-range opacities. Slow network is emulated by `route` (150 ms plus
// 4 Mbit/s per request, no bandwidth sharing between requests): these engines
// lack Chrome's CDP.
//
// The window opens off-screen (`--window-position=-2400,0`): headless does not
// composite like the real browser, and the compositor is what gets measured here.
import { execFileSync, spawn } from "node:child_process"
import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, firefox, webkit } from "playwright"

const REPO = fileURLToPath(new URL("..", import.meta.url))
const argumento = (nome, omissao) => {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? process.argv[i + 1] : omissao
}
const DIST = resolve(argumento("--dist", join(REPO, "apps/web/dist")))
const SAIDA = resolve(argumento("--saida", join(tmpdir(), "orwell-abertura-prova")))
const ROTULO = argumento("--rotulo", "agora")
const ENCRAVAR = !process.argv.includes("--sem-encravar")
// `--firefox`: only the test of banners with main thread blocked, in Firefox (headless:
// Firefox doesn't support off-screen windows). It's the engine the owner uses on Windows.
const FIREFOX = process.argv.includes("--firefox")
const MOTOR = argumento("--motor", null)
if (MOTOR !== null && MOTOR !== "firefox" && MOTOR !== "webkit") throw new Error(`--motor ${MOTOR}: só firefox ou webkit`)
const lancar = () =>
  MOTOR !== null
    ? { firefox, webkit }[MOTOR].launch({ headless: true })
    : FIREFOX
      ? firefox.launch({ headless: true })
      : chromium.launch({ channel: "chrome", headless: false, args: ["--window-position=-2400,0"] })
const PORTO = 5394
const VISTA = { width: 1280, height: 800 }
const FPS = 12

mkdirSync(SAIDA, { recursive: true })

// ------------------------------------------------------------------ server

const previa = spawn(
  "npx",
  ["vite", "preview", "--outDir", DIST, "--port", String(PORTO), "--strictPort", "--host", "127.0.0.1"],
  { cwd: join(REPO, "apps/web"), stdio: ["ignore", "pipe", "pipe"] },
)
await new Promise((pronto, falhou) => {
  const t = setTimeout(() => falhou(new Error("vite preview não arrancou")), 20_000)
  previa.stdout.on("data", (d) => {
    if (String(d).includes(String(PORTO))) {
      clearTimeout(t)
      pronto()
    }
  })
  previa.on("exit", (c) => falhou(new Error(`vite preview saiu com ${c}`)))
})
const URL_DA_APP = `http://127.0.0.1:${PORTO}/app/?lingua=pt`
// Without `?lingua`: language comes from the browser (test of `lingua-cedo`).
const URL_SEM_LINGUA = `http://127.0.0.1:${PORTO}/app/`

// ------------------------------------------------------------ within the page

/** Runs each frame (rAF), from the first: what's on screen and which phase. */
function registar() {
  const quadros = []
  const longas = []
  const registo = { quadros, longas, caixas: null }
  window.__abertura = registo
  try {
    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries()) longas.push([Math.round(e.startTime), Math.round(e.duration)])
    }).observe({ type: "longtask", buffered: true })
  } catch {}
  const ids = new WeakMap()
  let n = 0
  const idDe = (el) => {
    if (!ids.has(el)) ids.set(el, ++n)
    return ids.get(el)
  }
  const angulo = (anel) => {
    const m = getComputedStyle(anel, "::after").transform
    if (!m || !m.startsWith("matrix(")) return null
    const [a, b] = m.slice(7, -1).split(",").map(Number)
    return Math.round((Math.atan2(b, a) * 180) / Math.PI)
  }
  const tick = (t) => {
    const veu = document.querySelector(".abertura-veu")
    const noRoot = document.querySelector("#root .abertura")
    const visivel = veu ?? noRoot?.closest(".gate") ?? null
    let linha = {}
    if (visivel) {
      const anel = visivel.querySelector(".abertura-anel")
      const giro = anel?.getAnimations?.({ subtree: true }).find((a) => a.animationName === "abertura-gira-vivo")
      const tarja = visivel.querySelector(".abertura-marca path")
      // All opening animations, including pseudo-element ones: each one's
      // `startTime` must be the same across all builds.
      const todas = (visivel.getAnimations?.({ subtree: true }) ?? []).filter((a) => a.animationName?.startsWith("abertura-"))
      linha = {
        animacoes: todas.length,
        fases: [...new Set(todas.map((a) => (typeof a.startTime === "number" ? Math.round(a.startTime * 10) / 10 : null)))],
        id: idDe(visivel),
        veu: veu ? Number(getComputedStyle(veu).opacity).toFixed(2) : null,
        angulo: anel ? angulo(anel) : null,
        inicio: typeof giro?.startTime === "number" ? Math.round(giro.startTime * 10) / 10 : null,
        tarja: tarja ? Number(getComputedStyle(tarja).opacity).toFixed(2) : null,
        texto: visivel.querySelector(".abertura-texto")?.innerText ?? null,
      }
      if (!registo.caixas) {
        const caixa = (sel) => {
          const r = visivel.querySelector(sel)?.getBoundingClientRect()
          return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null
        }
        registo.caixas = { marca: caixa(".abertura-marca"), sinal: caixa(".abertura-sinal") }
      }
    }
    const raiz = document.getElementById("root")
    quadros.push({
      t: Math.round(t),
      // Main stylesheet arrived: `fundo.css` removes the background from `body`.
      folha: document.body ? getComputedStyle(document.body).backgroundColor === "rgba(0, 0, 0, 0)" : false,
      raiz: raiz ? Number(getComputedStyle(raiz).opacity).toFixed(2) : null,
      // What `#root` contains: the HTML opening, the gate, or nothing.
      noRoot: raiz?.firstElementChild?.className ?? null,
      lang: document.documentElement.lang,
      ...linha,
    })
    if (t < 12_000) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

// ------------------------------------------------------------------ the video

/** Brightness (average Y, or maximum) of a rectangle in each frame, at `FPS`. */
function brilhos(video, { x, y, w, h }, medida = "YAVG") {
  const filtro = `fps=${FPS},crop=${w}:${h}:${x}:${y},signalstats,metadata=print:key=lavfi.signalstats.${medida}:file=-`
  const texto = execFileSync("ffmpeg", ["-v", "error", "-i", video, "-vf", filtro, "-f", "null", "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  return [...texto.matchAll(new RegExp(`${medida}=([\\d.]+)`, "g"))].map((m) => Number(m[1]))
}

/** Average difference of each frame from an image (the last frame: the final screen). */
function diferencas(video, imagem) {
  const filtro =
    `[0:v]fps=${FPS},format=gray[a];[1:v]format=gray[b];` +
    "[a][b]blend=all_mode=difference:shortest=1,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-"
  const texto = execFileSync("ffmpeg", ["-v", "error", "-i", video, "-loop", "1", "-i", imagem, "-lavfi", filtro, "-f", "null", "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  return [...texto.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]))
}

function extrairQuadros(video, pasta) {
  mkdirSync(pasta, { recursive: true })
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", `fps=${FPS}`, join(pasta, "q%03d.png")])
}

/** Run-compressed: "white×3 opening×14 after×30". */
const resumir = (lista) => {
  const saida = []
  for (const x of lista) {
    const ultimo = saida.at(-1)
    if (ultimo && ultimo[0] === x) ultimo[1] += 1
    else saida.push([x, 1])
  }
  return saida.map(([x, n]) => `${x}×${n}`).join(" ")
}

// ------------------------------------------------------------------ a run

async function correr({ movimento, rede }) {
  const nome = `${ROTULO}-${movimento === "reduce" ? "reduzido" : "normal"}-${rede}`
  const pasta = join(SAIDA, nome)
  mkdirSync(pasta, { recursive: true })
  const browser = await lancar()
  const ctx = await browser.newContext({
    viewport: VISTA,
    reducedMotion: movimento,
    recordVideo: { dir: pasta, size: VISTA },
  })
  const page = await ctx.newPage()
  if (rede === "lenta") {
    const cdp = await ctx.newCDPSession(page)
    await cdp.send("Network.enable")
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: 4e6 / 8,
      uploadThroughput: 1e6 / 8,
    })
  }
  await page.addInitScript(registar)
  await page.waitForTimeout(500)
  await page.goto(URL_DA_APP)
  await page.waitForTimeout(rede === "lenta" ? 7000 : 4000)
  const registo = await page.evaluate(() => window.__abertura)
  const pintura = await page.evaluate(() =>
    Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, Math.round(p.startTime)])),
  )
  const video = await page.video().path()
  await ctx.close()
  await browser.close()

  // Within the page.
  const q = registo.quadros
  const desenhados = q.filter((x) => x.folha)
  const primeiroDesenho = desenhados[0]?.t ?? null
  const comAbertura = desenhados.filter((x) => x.id)
  const semAberturaAntes = desenhados.filter((x) => !x.id && x.t < (comAbertura[0]?.t ?? Infinity)).length
  const inicios = [...new Set(comAbertura.map((x) => x.inicio).filter((x) => x !== null))]
  const montagens = [...new Set(comAbertura.map((x) => x.id))]
  const saltos = []
  for (let i = 1; i < comAbertura.length; i++) {
    const [a, b] = [comAbertura[i - 1], comAbertura[i]]
    if (a.id !== b.id && a.angulo !== null && b.angulo !== null) {
      const d = ((((b.angulo - a.angulo) % 360) + 540) % 360) - 180
      saltos.push({ t: b.t, de: a.id, para: b.id, graus: d, ms: b.t - a.t })
    }
  }
  const veu = comAbertura.filter((x) => x.veu !== null).map((x) => x.veu)
  const ultimo = comAbertura.at(-1)
  const textos = [...new Set(comAbertura.map((x) => x.texto))]

  // In the video.
  const pastaDosQuadros = join(pasta, "quadros")
  extrairQuadros(video, pastaDosQuadros)
  const ultimoQuadro = join(pastaDosQuadros, readdirSync(pastaDosQuadros).sort().at(-1))
  /*
    Each frame at 12 per second, measured by two metrics:
    - brightness peak in the signal square (the ring is full cyan; the glow
      alone doesn't exceed ~20);
    - difference from the last frame, which is the gate already ready.
    Hence: white (before the page), background (page drew and opening is
    not there: the empty frame sought), opening (fade included),
    and after. Thresholds measured on this screen at 1280×800.
  */
  const sinal = registo.caixas?.sinal ?? { x: 584, y: 328, w: 112, h: 112 }
  const pico = brilhos(video, sinal, "YMAX")
  const distancia = diferencas(video, ultimoQuadro)
  const classes = pico.map((y, i) => {
    const d = distancia[i] ?? 0
    if (d > 100) return "branco"
    if (d <= 3.5) return "depois"
    return y < 60 ? "fundo" : "abertura"
  })
  const corridas = resumir(classes)
  const quadrosVazios = classes.filter((c) => c === "fundo").length
  const corridasDeAbertura = corridas.split(" ").filter((c) => c.startsWith("abertura×"))
  // The exit: distance to the final screen in frames around the last startup
  // frame. A sharp cut is a step (from ~9 to ~3 in one frame); fade passes through
  // intermediate values.
  const iUltima = classes.lastIndexOf("abertura")
  const saidaNoVideo = iUltima >= 0 ? distancia.slice(Math.max(0, iUltima - 3), iUltima + 3).map((d) => d.toFixed(1)) : []
  const resultado = {
    nome,
    pintura,
    primeiroDesenhoComFolha: primeiroDesenho,
    primeiroQuadroComAbertura: comAbertura[0]?.t ?? null,
    quadrosDesenhadosSemAberturaAntesDela: semAberturaAntes,
    aberturaAte: ultimo?.t ?? null,
    aberturaVisivelMs: comAbertura.length ? ultimo.t - comAbertura[0].t : 0,
    montagens: montagens.length,
    inicioDoAnelPorMontagem: inicios,
    saltosNaTroca: saltos,
    veu: veu.length ? `${veu.length} quadros, ${veu[0]} → ${veu.at(-1)}` : "sem véu",
    textos,
    lang: [...new Set(q.map((x) => x.lang))],
    tarefasLongas: registo.longas,
    video: { quadros: classes.length, corridas, quadrosVazios, corridasDeAbertura, saidaNoVideo },
  }
  writeFileSync(join(pasta, "resultado.json"), JSON.stringify({ ...resultado, pico, distancia, registo }, null, 1))
  return resultado
}

// ------------------------------------------- Firefox and WebKit: no video

/** Delays each response as if on a 4 Mbit/s network with 150 ms latency (per request). */
async function redeLenta(ctx) {
  await ctx.route("**/*", async (rota) => {
    const t0 = Date.now()
    const resposta = await rota.fetch()
    const corpo = await resposta.body()
    const ms = 150 + (corpo.length / (4e6 / 8)) * 1000
    await new Promise((r) => setTimeout(r, Math.max(0, ms - (Date.now() - t0))))
    await rota.fulfill({ response: resposta, body: corpo })
  })
}

async function correrNoMotor({ movimento, rede, locale = "pt-PT", semLingua = false }) {
  const nome = `${ROTULO}-${MOTOR}-${movimento === "reduce" ? "reduzido" : "normal"}-${rede}${semLingua ? `-${locale}` : ""}`
  const pasta = join(SAIDA, nome)
  mkdirSync(pasta, { recursive: true })
  const browser = await lancar()
  const ctx = await browser.newContext({ viewport: VISTA, reducedMotion: movimento, locale })
  if (rede === "lenta") await redeLenta(ctx)
  const page = await ctx.newPage()
  await page.addInitScript(registar)
  await page.goto(semLingua ? URL_SEM_LINGUA : URL_DA_APP)
  await page.waitForTimeout(rede === "lenta" ? 7000 : 4000)
  const registo = await page.evaluate(() => window.__abertura)
  const fim = await page.evaluate(() => ({
    portao: Boolean(document.querySelector("#root .gate:not(:has(.abertura))") ?? document.querySelector("#root form, #root button")),
    veuNoFim: Boolean(document.querySelector(".abertura-veu")),
    classesDoHtml: document.documentElement.className,
    aberturaNoFim: document.getAnimations().filter((a) => a.animationName?.startsWith("abertura-")).length,
  }))
  await ctx.close()
  await browser.close()

  const q = registo.quadros.filter((x) => x.lang !== undefined)
  const primeiro = q[0] ?? null
  const iPrimeira = q.findIndex((x) => x.id)
  const iUltima = q.findLastIndex((x) => x.id)
  const comAbertura = q.filter((x) => x.id)
  // Drawn without opening before it: the empty frame from before the fix.
  const fundoAntes = q.slice(0, Math.max(0, iPrimeira)).filter((x) => x.folha).length
  // Holes: frames without opening in the middle of the opening (a flash).
  const buracos = q.slice(iPrimeira, iUltima + 1).filter((x) => !x.id).length
  // After the exit, `#root` must be visible and showing the gate.
  const depois = q.slice(iUltima + 1)
  const vaziosDepois = depois.filter((x) => x.raiz !== "1.00" || x.noRoot === null).length
  const fases = [...new Set(comAbertura.flatMap((x) => x.fases ?? []))]
  const saltos = []
  for (let i = 1; i < comAbertura.length; i++) {
    const [a, b] = [comAbertura[i - 1], comAbertura[i]]
    if (a.id !== b.id) {
      const d = a.angulo !== null && b.angulo !== null ? ((((b.angulo - a.angulo) % 360) + 540) % 360) - 180 : null
      saltos.push({ t: b.t, de: a.id, para: b.id, graus: d, ms: b.t - a.t })
    }
  }
  const veu = comAbertura.filter((x) => x.veu !== null).map((x) => Number(x.veu))
  const veuDoMeio = veu.filter((v) => v > 0.05 && v < 0.95)
  const raizNaSaida = q
    .slice(Math.max(0, iUltima - 30), iUltima + 2)
    .filter((x) => x.veu !== null || x === q[iUltima + 1])
    .map((x) => Number(x.raiz))
  const tarjas = [...new Set(comAbertura.map((x) => x.tarja))].length
  const resultado = {
    nome,
    quadrosRaf: q.length,
    primeiroQuadro: primeiro ? { t: primeiro.t, temAbertura: Boolean(primeiro.id), noRoot: primeiro.noRoot } : null,
    quadrosComFolhaSemAberturaAntes: fundoAntes,
    quadrosComAbertura: comAbertura.length,
    aberturaVisivelMs: comAbertura.length ? comAbertura.at(-1).t - comAbertura[0].t : 0,
    buracosNaAbertura: buracos,
    quadrosVaziosDepoisDaSaida: vaziosDepois,
    montagens: new Set(comAbertura.map((x) => x.id)).size,
    animacoesPorQuadro: [...new Set(comAbertura.map((x) => x.animacoes))],
    startTimesDistintos: fases,
    trocas: saltos,
    veu: veu.length ? { quadros: veu.length, doMeio: veuDoMeio.length, de: veu[0], ate: veu.at(-1) } : "sem véu",
    raizNaSaida: raizNaSaida.length ? `${raizNaSaida[0]} → ${raizNaSaida.at(-1)}` : null,
    valoresDeOpacidadeDaTarja: tarjas,
    angulosDistintos: new Set(comAbertura.map((x) => x.angulo)).size,
    textos: [...new Set(comAbertura.map((x) => x.texto))],
    lang: [...new Set(q.map((x) => x.lang))],
    fim,
  }
  writeFileSync(join(pasta, "resultado.json"), JSON.stringify({ ...resultado, registo }, null, 1))
  return resultado
}

// ------------------------------------------- banners with the main thread blocked

async function encravar({ movimento }) {
  const nome = `${ROTULO}${FIREFOX ? "-firefox" : ""}-encravado-${movimento === "reduce" ? "reduzido" : "normal"}`
  const pasta = join(SAIDA, nome)
  mkdirSync(pasta, { recursive: true })
  const browser = await lancar()
  const ctx = await browser.newContext({ viewport: VISTA, reducedMotion: movimento, recordVideo: { dir: pasta, size: VISTA } })
  const page = await ctx.newPage()
  // Without bundle: only the splash from `index.html` remains, forever.
  await page.route(/\/assets\/index-[^/]+\.js$/, (r) => r.abort())
  await page.goto(URL_DA_APP)
  await page.waitForSelector(".abertura-marca path")
  // The corner marker turns white while the main thread is blocked:
  // it's used to find the window in the video.
  const caixas = await page.evaluate(() => {
    const estilo = document.createElement("style")
    estilo.textContent = `
      #marcador { position: fixed; left: 0; top: 0; width: 40px; height: 40px; background: #000; }
      /* O controlo: uma largura a mudar, que só a linha principal desenha (é
         layout, e o compositor não o faz; a cor de fundo já faz, no Chrome).
         Se este não parar, a linha principal não esteve ocupada e a prova não vale. */
      #controlo { position: fixed; left: 860px; top: 372px; width: 4px; height: 56px; background: #fff;
        animation: controlo-cresce 0.8s linear infinite alternate !important; }
      @keyframes controlo-cresce { from { width: 4px; } to { width: 56px; } }`
    document.head.append(estilo)
    const marcador = document.createElement("div")
    marcador.id = "marcador"
    const controlo = document.createElement("div")
    controlo.id = "controlo"
    document.body.append(marcador, controlo)
    const r = document.querySelector(".abertura-marca").getBoundingClientRect()
    return {
      tarjas: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      controlo: { x: 860, y: 372, w: 56, h: 56 },
    }
  })
  await page.waitForTimeout(1500)
  await page.evaluate(
    () =>
      new Promise((r) => {
        document.getElementById("marcador").style.background = "#fff"
        requestAnimationFrame(() => setTimeout(r, 60))
      }),
  )
  await page.evaluate(() => {
    const fim = performance.now() + 2000
    while (performance.now() < fim) {}
  })
  await page.evaluate(() => {
    document.getElementById("marcador").style.background = "#000"
  })
  await page.waitForTimeout(1000)
  const video = await page.video().path()
  await ctx.close()
  await browser.close()

  const marcador = brilhos(video, { x: 0, y: 0, w: 40, h: 40 })
  const tarjas = brilhos(video, caixas.tarjas)
  const controlo = brilhos(video, caixas.controlo)
  // The window is the longest run of frames with the white marker: Firefox
  // records some white frames on startup that are not the window.
  let janela = []
  let corrida = []
  marcador.forEach((y, i) => {
    if (y > 128 && i > 0 && marcador[i - 1] > 128) corrida.push(i)
    else corrida = y > 128 ? [i] : []
    if (corrida.length > janela.length) janela = [...corrida]
  })
  // The first and last frames of the window may catch the marker transition.
  const dentro = janela.slice(1, -1)
  const variacao = (serie) => {
    const v = dentro.map((i) => serie[i])
    const mudancas = v.slice(1).filter((y, i) => Math.abs(y - v[i]) > 0.5).length
    return { min: Math.min(...v).toFixed(1), max: Math.max(...v).toFixed(1), quadrosQueMudam: `${mudancas} de ${v.length - 1}` }
  }
  // With reduced motion the banners stay lit and it's the entire mark that pulses.
  const resultado = {
    nome,
    quadrosOcupados: dentro.length,
    controloDaLinhaPrincipal: variacao(controlo),
    marca: variacao(tarjas),
  }
  writeFileSync(join(pasta, "resultado.json"), JSON.stringify({ ...resultado, marcador, tarjas, controlo }, null, 1))
  return resultado
}

// ------------------------------------------------------------------ tudo

try {
  if (MOTOR !== null) {
    for (const movimento of ["no-preference", "reduce"]) {
      for (const rede of ["local", "lenta"]) console.log(JSON.stringify(await correrNoMotor({ movimento, rede }), null, 1))
    }
    for (const locale of ["en-US", "pt-PT"]) {
      console.log(JSON.stringify(await correrNoMotor({ movimento: "no-preference", rede: "local", locale, semLingua: true }), null, 1))
    }
  } else if (FIREFOX) {
    for (const movimento of ["no-preference", "reduce"]) console.log(JSON.stringify(await encravar({ movimento }), null, 1))
  } else {
    for (const movimento of ["no-preference", "reduce"]) {
      for (const rede of ["local", "lenta"]) console.log(JSON.stringify(await correr({ movimento, rede }), null, 1))
      if (ENCRAVAR) console.log(JSON.stringify(await encravar({ movimento }), null, 1))
    }
  }
} finally {
  previa.kill()
}
