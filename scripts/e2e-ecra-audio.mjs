/**
 * SOUND from screen share, end-to-end, in the product: mesh and SFU.
 *
 * The flaw, reported by the owner in 0.8.0: "screen shares are not transmitting
 * audio". This measures the fix with the usual subject: the product. The
 * `apps/web` in `vite`, the homeserver (with and without media engine), two accounts
 * created on screen, an invite accepted on screen, voice room clicked, the share
 * button pressed and "View" pressed on the other side.
 *
 * ```
 * npx tsc -b && node scripts/e2e-ecra-audio.mjs            # SFU e malha
 * node scripts/e2e-ecra-audio.mjs --so sfu                  # um caminho só
 * node scripts/e2e-ecra-audio.mjs --so malha
 * SABOTAGEM=pedido-mudo node scripts/e2e-ecra-audio.mjs   # MUST exit with 1
 * ```
 *
 * Each path runs in BOTH directions: first whoever made the channel shares, then
 * the invitee. In mesh one is the offerer and the other the answerer, and until
 * 26 October 2026 the answerer had no way to send the screen.
 *
 * The sabotage `pedido-mudo` brings back the flaw's request (`audio: false`) inside the
 * browser, and the rest of the product stays the same: proof that the run sees
 * the difference.
 *
 * **The screen is fake, and so is the sound, on purpose.** A Chromium with no
 * one at the keyboard has no system sound to give. The `getDisplayMedia` is swapped
 * BEFORE the app starts with one that returns an animated slate and, ONLY IF
 * the product asks for sound, a tone at 2500 Hz. A product that asks for `audio: false`
 * (the flaw) gets a mute screen, and the run fails on the first line.
 *
 * **"Plays" means it is heard**, not that there is a track: on the side of
 * whoever sees we read the `<video>` element of the stage (it has the sound track,
 * it is not mute, it is playing) and measure the sound that arrives there with
 * an analyzer: the frequency peak must be at the tone of 2500 Hz, which is not
 * the Chromium's fake microphone. This way sound that reached the person's card,
 * or voice passing by screen, does not pass by screen sound.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { comLingua } from "./ambiente.mjs"
import { criarContaEEntrar } from "./conta.mjs"
import { APP, FRASE, matarTudo, levantarServidor, levantarWeb } from "./sfu-prova-fase2/bancada.mjs"
import { abrirCanal, assentar, criarCanal, entrarNaChamada } from "./sfu-prova-fase2/montagem.mjs"
import { ARGS, partilharEcra, pararEcra } from "./sfu-prova-fase3/montagem.mjs"

const TOM = 2500
const SABOTAGEM = process.env.SABOTAGEM ?? ""
const so = process.argv.includes("--so") ? process.argv[process.argv.indexOf("--so") + 1] : null
const MODOS = so ? [so] : ["sfu", "malha"]

const resultados = []
const verificar = (etiqueta, ok, detalhe = "") => {
  resultados.push({ etiqueta, ok })
  console.log(`${ok ? "PASS" : "FALHA"}  ${etiqueta}${detalhe ? ` -- ${detalhe}` : ""}`)
}
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The fake `getDisplayMedia`, hooked before the application. See the header. */
const ECRA_FALSO = ({ tom, sabotagem }) => {
  window.__pedidosDeEcra = []
  /*
    Autoplay policy, simulated on the stage. Playwright gives a gesture on each
    `evaluate` and each click, so a test bench Chromium never refuses a `play()`
    with audio. Here the stage `<video>` refuses to play with audio until
    `window.__haGesto` is true, and only a REAL `pointerdown` or `keydown`
    (from the test bench mouse or keyboard) makes it so. This is the case the
    owner saw (2/11/2026): the stage silent waiting for a button.
  */
  window.__haGesto = false
  window.__recusasDoPalco = 0
  const marcar = (evento) => {
    if (evento.isTrusted && window.__armarGesto) window.__haGesto = true
  }
  document.addEventListener("pointerdown", marcar, true)
  document.addEventListener("keydown", marcar, true)
  const tocar = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () {
    if (this.closest?.(".call-palco") && !this.muted && !window.__haGesto) {
      window.__recusasDoPalco++
      return Promise.reject(new DOMException("play() sem gesto", "NotAllowedError"))
    }
    return tocar.call(this)
  }
  navigator.mediaDevices.getDisplayMedia = async (pedidoDoProduto) => {
    const pedido = sabotagem === "pedido-mudo" ? { ...pedidoDoProduto, audio: false } : pedidoDoProduto
    window.__pedidosDeEcra.push(JSON.parse(JSON.stringify(pedido ?? {})))
    const tela = document.createElement("canvas")
    tela.width = 1280
    tela.height = 720
    const g = tela.getContext("2d")
    let n = 0
    setInterval(() => {
      g.fillStyle = `hsl(${(n++ * 7) % 360} 60% 35%)`
      g.fillRect(0, 0, 1280, 720)
      g.fillStyle = "#fff"
      g.font = "64px sans-serif"
      g.fillText(`ecrã ${n}`, 60, 120)
    }, 66)
    const faixas = [tela.captureStream(15).getVideoTracks()[0]]
    // `__caixaDesmarcada`: the audio checkbox in the selector that is unchecked, which is what
    // Chrome does by default on full screen. The request has audio; the browser does not.
    if (pedido?.audio && !window.__caixaDesmarcada) {
      const ctx = new AudioContext()
      const oscilador = ctx.createOscillator()
      oscilador.frequency.value = tom
      const ganho = ctx.createGain()
      ganho.gain.value = 0.5
      const destino = ctx.createMediaStreamDestination()
      oscilador.connect(ganho).connect(destino)
      oscilador.start()
      faixas.push(destino.stream.getAudioTracks()[0])
    }
    return new MediaStream(faixas)
  }
}

/**
 * The viewer's stage: the element, the tracks, and what plays on it.
 *
 * The analyzer receives a clone of the stage's audio track (in Chromium, remote
 * audio only reaches Web Audio if the track is connected to a media element,
 * and it is: the stage's). One second of samples, and the frequency peak.
 */
const LER_PALCO_E_SOM = async () => {
  const video = document.querySelector(".call-palco video")
  if (!video) return { palco: false }
  const fluxo = video.srcObject
  const som = fluxo?.getAudioTracks?.() ?? []
  const saida = {
    palco: true,
    faixasDeSom: som.length,
    faixasDeImagem: fluxo?.getVideoTracks?.().length ?? 0,
    calado: video.muted,
    aTocar: !video.paused,
    volume: video.volume,
    estadoDoSom: som[0]?.readyState ?? null,
    somMudo: som[0]?.muted ?? null,
    cursor: Boolean(document.querySelector(".call-palco .call-palco-som")),
    pico: null,
    nivel: 0,
  }
  if (som.length === 0) return saida
  const ctx = new AudioContext()
  await ctx.resume().catch(() => {})
  const fonte = ctx.createMediaStreamSource(new MediaStream([som[0].clone()]))
  const analisador = ctx.createAnalyser()
  analisador.fftSize = 4096
  fonte.connect(analisador)
  const dados = new Float32Array(analisador.frequencyBinCount)
  let melhor = { db: -Infinity, hz: 0 }
  for (let volta = 0; volta < 10; volta++) {
    await new Promise((r) => setTimeout(r, 100))
    analisador.getFloatFrequencyData(dados)
    for (let i = 1; i < dados.length; i++) {
      if (dados[i] > melhor.db) melhor = { db: dados[i], hz: (i * ctx.sampleRate) / analisador.fftSize }
    }
  }
  await ctx.close()
  saida.pico = Math.round(melhor.hz)
  saida.nivel = Math.round(melhor.db)
  return saida
}

/** Audio tracks playing on ANY media element in the page. */
const FAIXAS_A_TOCAR = () =>
  [...document.querySelectorAll("video, audio")]
    .filter((e) => !e.muted && !e.paused && e.srcObject)
    .flatMap((e) => e.srcObject.getAudioTracks().map((f) => f.id))

/*
  Chrome desktop autoplay policy, not the one for mobile (`no-user-gesture-required`).
  With mobile policy, a stage that only plays after a gesture would pass here and mute
  in the owner's browser (bug from November 2, 2026). `POLITICA_LIVRE=1` restores
  the mobile policy.
*/
const ARGS_DO_BROWSER = process.env.POLITICA_LIVRE
  ? ARGS
  : [...ARGS.filter((arg) => !arg.startsWith("--autoplay-policy=")), "--autoplay-policy=document-user-activation-required"]

async function abrirConta(app, { nome, indice, perfil }) {
  const ctx = await chromium.launchPersistentContext(`${perfil}/${indice}`, {
    headless: true,
    args: ARGS_DO_BROWSER,
    permissions: ["microphone", "camera"],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.addInitScript(ECRA_FALSO, { tom: TOM, sabotagem: SABOTAGEM })
  await page.goto(comLingua(app), { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2000)
  await criarContaEEntrar(page, { nome, frase: FRASE })
  return { ctx, page, nome, indice }
}

async function partilhaEOuve(modo, a, b, sentido) {
  const rotulo = `[${modo} · ${sentido}]`
  // (a) the request
  const antes = (await a.page.evaluate(() => window.__pedidosDeEcra.length)) ?? 0
  const carregou = await partilharEcra(a.page)
  verificar(`${rotulo} o botão de partilhar carrega-se`, carregou)
  if (!carregou) return
  await dormir(1500)
  const pedidos = await a.page.evaluate(() => window.__pedidosDeEcra)
  const pedido = pedidos[antes]
  verificar(`${rotulo} (a) o produto PEDE o som ao browser`, Boolean(pedido?.audio), JSON.stringify(pedido?.audio ?? null))

  // Our own stage does not play our audio.
  const proprio = await a.page.evaluate(LER_PALCO_E_SOM)
  verificar(
    `${rotulo} quem partilha não ouve o seu próprio som no palco`,
    !proprio.palco || proprio.faixasDeSom === 0,
    proprio.palco ? `${proprio.faixasDeSom} faixas de som no palco próprio` : "sem palco próprio",
  )

  // (e) on the other side: view and listen.
  const ver = b.page.getByRole("button", { name: /^Ver (o ecrã|a transmissão) de/ }).first()
  const temVer = await ver.isVisible({ timeout: 15_000 }).catch(() => false)
  verificar(`${rotulo} quem vê tem o "Ver"`, temVer)
  if (!temVer && process.env.E2E_CAPTURAS) {
    await b.page.screenshot({ path: join(process.env.E2E_CAPTURAS, `${modo}-${sentido.replace(/\s+/g, "-")}-sem-ver.png`) })
    await a.page.screenshot({ path: join(process.env.E2E_CAPTURAS, `${modo}-${sentido.replace(/\s+/g, "-")}-quem-partilha.png`) })
  }
  if (!temVer) return void (await pararEcra(a.page))
  /*
    Two cases, one per direction. With activation (the normal case: the viewer
    already tapped to enter and watch), audio plays immediately, no extra gesture.
    Without activation (simulated), the stage stays silent with no button, and the
    next gesture anywhere unmutes the audio.
  */
  const comActivacao = sentido === "o convidado partilha"
  await b.page.evaluate((activo) => {
    window.__haGesto = activo
    window.__armarGesto = false
    window.__recusasDoPalco = 0
  }, comActivacao)
  // The invite only draws over the card when you hover (1.0): you hover first
  // like a person, then you tap.
  await b.page.locator(".call-chip.ao-vivo-convida").first().hover()
  await ver.click()
  await dormir(5000)

  const logo = await b.page.evaluate(() => ({
    recusas: window.__recusasDoPalco,
    calado: document.querySelector(".call-palco video")?.muted ?? null,
    botoes: [...document.querySelectorAll(".call-palco footer button")].map((botao) => botao.textContent),
  }))
  verificar(`${rotulo} NÃO há botão para ligar o som no palco`, logo.botoes.length === 0, JSON.stringify(logo.botoes))
  if (comActivacao) {
    verificar(
      `${rotulo} com activação, o som toca logo, sem gesto a mais`,
      logo.recusas === 0 && logo.calado === false,
      `${logo.recusas} recusas, muted=${logo.calado}`,
    )
  } else {
    verificar(
      `${rotulo} sem activação, o browser recusa o som e o palco fica calado (simulado)`,
      logo.recusas > 0 && logo.calado === true,
      `${logo.recusas} recusas, muted=${logo.calado}`,
    )
    // Any gesture, away from the stage: the call header.
    await b.page.evaluate(() => {
      window.__armarGesto = true
    })
    await b.page.locator(".call-titulo").first().click()
    await dormir(1500)
  }

  const palco = await b.page.evaluate(LER_PALCO_E_SOM)
  verificar(`${rotulo} o palco abre com a imagem`, palco.palco && palco.faixasDeImagem === 1)
  verificar(
    `${rotulo} (c)(d) o som do ecrã CHEGA ao palco, decifrado e vivo`,
    palco.faixasDeSom === 1 && palco.estadoDoSom === "live" && palco.somMudo === false,
    `${palco.faixasDeSom} faixas de som, ${palco.estadoDoSom}, ${palco.somMudo ? "sem pacotes" : "com pacotes"}`,
  )
  verificar(`${rotulo} (e) e TOCA: o palco não está calado e está a tocar`, palco.calado === false && palco.aTocar, `muted=${palco.calado} a tocar=${palco.aTocar}`)
  verificar(
    `${rotulo} (e) o que se ouve é o som do ecrã: pico em ${TOM} Hz`,
    palco.pico !== null && Math.abs(palco.pico - TOM) <= 30 && palco.nivel > -70,
    `pico ${palco.pico} Hz a ${palco.nivel} dB`,
  )
  verificar(`${rotulo} o palco tem o volume próprio do som`, palco.cursor)

  const somDoPalco = await b.page.evaluate(() => document.querySelector(".call-palco video")?.srcObject?.getAudioTracks()[0]?.id ?? null)

  // "Stop viewing" stops audio with the video.
  const parar = b.page.getByRole("button", { name: /^Parar de ver o ecrã de/ }).first()
  const temParar = await parar.isVisible({ timeout: 5000 }).catch(() => false)
  verificar(`${rotulo} quem vê tem o "Parar de ver"`, temParar)
  if (temParar) {
    await parar.click()
    await dormir(2000)
    const aTocar = await b.page.evaluate(FAIXAS_A_TOCAR)
    const depois = await b.page.evaluate(LER_PALCO_E_SOM)
    verificar(
      `${rotulo} "Parar de ver" tira o palco E o som`,
      !depois.palco && !aTocar.includes(somDoPalco),
      `palco=${depois.palco} som ainda a tocar=${aTocar.includes(somDoPalco)}`,
    )
  }

  await pararEcra(a.page)
}

/**
 * The browser did not give audio (the selector checkbox unchecked): sharing continues,
 * and the sharer reads error 445 with nothing blocked. Bug from 2/11/2026.
 */
async function semSomNoSelector(modo, a) {
  const rotulo = `[${modo} · caixa do som por marcar]`
  await a.page.evaluate(() => {
    window.__caixaDesmarcada = true
  })
  const carregou = await partilharEcra(a.page)
  verificar(`${rotulo} a partilha começa na mesma`, carregou)
  // The code by expression: "Error N" is built (`strings.errors.codigo`), not hardcoded.
  const aviso = a.page.getByText(/Erro 445/).first()
  const viu = await aviso.isVisible({ timeout: 5000 }).catch(() => false)
  const frase = viu ? await a.page.getByText(/O browser não deu o som do ecrã/).first().isVisible().catch(() => false) : false
  verificar(`${rotulo} quem partilha lê "Erro 445" e a frase`, viu && frase)
  const aPartilhar = await a.page
    .getByRole("button", { name: /Parar de partilhar/ })
    .first()
    .isVisible({ timeout: 3000 })
    .catch(() => false)
  verificar(`${rotulo} e continua a partilhar (não bloqueia)`, aPartilhar)
  await pararEcra(a.page)
  await a.page.evaluate(() => {
    window.__caixaDesmarcada = false
  })
}

async function correr(modo) {
  console.log(`\n== O som do ecrã, por ${modo === "sfu" ? "SFU" : "malha"}`)
  const dados = mkdtempSync(join(tmpdir(), `orwell-ecra-som-${modo}-`))
  const perfis = mkdtempSync(join(tmpdir(), `orwell-ecra-som-perfis-${modo}-`))
  const sala = `som ${modo} ${Date.now().toString(36)}`
  const clientes = []
  try {
    if (!(await levantarServidor(dados, { comSfu: modo === "sfu" }))) throw new Error("o homeserver não subiu")
    if (!(await levantarWeb())) throw new Error("o vite não subiu")

    for (const indice of [0, 1]) clientes.push(await abrirConta(APP, { nome: `som ${indice}`, indice, perfil: perfis }))
    const [a, b] = clientes

    await criarCanal(a.page, sala)
    const entrou = await assentar(a, b, sala)
    verificar(`[${modo}] o convidado aceita e fica no canal`, entrou)
    if (!entrou) return

    for (const cliente of [a, b]) {
      await abrirCanal(cliente.page, sala)
      verificar(`[${modo}] ${cliente.nome} entra na sala de voz`, await entrarNaChamada(cliente.page))
      await cliente.page.waitForTimeout(1500)
    }
    await dormir(4000)

    for (const [quem, ve, sentido] of [
      [a, b, "quem criou partilha"],
      [b, a, "o convidado partilha"],
    ]) {
      await partilhaEOuve(modo, quem, ve, sentido)
      await dormir(2000)
    }
    await semSomNoSelector(modo, a)
  } catch (erro) {
    console.error(`\nFALHA  a corrida por ${modo} rebentou: ${erro?.stack ?? erro}`)
    resultados.push({ etiqueta: `[${modo}] a corrida chegou ao fim`, ok: false })
  } finally {
    for (const cliente of clientes) await cliente.ctx.close().catch(() => {})
    matarTudo()
    const limpar = (pasta) => rmSync(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    limpar(dados)
    limpar(perfis)
    await dormir(1000)
  }
}

for (const modo of MODOS) await correr(modo)

const passou = resultados.filter((r) => r.ok).length
console.log(`\n${passou}/${resultados.length} verificações passaram`)
process.exit(passou === resultados.length && resultados.length > 0 ? 0 : 1)
