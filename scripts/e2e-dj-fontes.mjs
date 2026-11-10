/**
 * DJ capture sources, end-to-end: tab, system sound and window.
 *
 * Phase 9 of `docs/planos/definicoes-0-9.md`, the second slice (owner, 2/11/2026).
 * The subject is the product: two accounts created on screen, a channel with
 * invite accepted, voice room clicked, the "Share audio" sheet open, the source
 * chosen in the footer and "Choose and share" pressed.
 *
 * ```
 * npm run build && node scripts/e2e-dj-fontes.mjs                 # tudo
 * node scripts/e2e-dj-fontes.mjs --so browser-sfu                  # o DJ no Chromium, por SFU
 * node scripts/e2e-dj-fontes.mjs --so browser-malha                # o DJ no Chromium, em malha
 * npm run build && node scripts/e2e-dj-fontes.mjs --so secretaria  # o DJ na app de secretária, o ouvinte no Chromium
 * SABOTAGEM=pedido-mudo node scripts/e2e-dj-fontes.mjs --so browser-sfu   # MUST exit with 1
 * ```
 *
 * **The source is synthetic, and the tone is the proof.** A Chromium with no one
 * at the keyboard has no tab or system sound to give. In the browser, the
 * `getDisplayMedia` is swapped BEFORE the app starts with one that returns a small
 * image and, ONLY IF the product asks for sound, an oscillator at a tone that
 * is not the fake microphone's. In the desktop app the `getDisplayMedia`
 * RUNS TRUE first (the main process gets the request, the interface responds,
 * with no selector in "System sound" and only-sound selector in the window); what
 * the system gives is thrown away, and the oscillator enters. The script says
 * what the real capture gave.
 *
 * **"Plays" means it is heard in the MUSIC track**, not the screen track: on
 * the other side we read the `<audio data-musica>` element (the `MusicaQueChega`) and
 * measure the peak with an analyzer. And we confirm there is no screen offered
 * and no stage: the image never leaves.
 *
 * The sabotage `pedido-mudo` makes the fake browser give no sound: proof that
 * the run sees the difference between sound and silence in the music track.
 *
 * Ports: the bench ones (`sfu-prova-fase2/bancada.mjs`) for the browser; 8486,
 * 8487 and 8488 for the desktop. All local and disposable.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { comLingua } from "./ambiente.mjs"
import { criarConta } from "./conta.mjs"
import { APP, FRASE, matarTudo, levantarServidor as levantarBancada, levantarWeb } from "./sfu-prova-fase2/bancada.mjs"
import { abrirCanal, assentar, criarCanal, entrarNaChamada } from "./sfu-prova-fase2/montagem.mjs"

const SABOTAGEM = process.env.SABOTAGEM ?? ""
const so = process.argv.includes("--so") ? process.argv[process.argv.indexOf("--so") + 1] : null
const CORRIDAS = so ? [so] : ["browser-sfu", "browser-malha", "secretaria"]
/** `--fontes janela` (or `sistema,janela`): only these sources, to investigate one. */
const FONTES = process.argv.includes("--fontes") ? process.argv[process.argv.indexOf("--fontes") + 1].split(",") : null
const corre = (fonte) => FONTES === null || FONTES.includes(fonte)

/** One tone per source: a sound left over from one source does not pass to the next. */
const TONS = { separador: 3100, sistema: 2300, janela: 3700 }

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
const ARGS = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"]

const resultados = []
const verificar = (etiqueta, ok, detalhe = "") => {
  resultados.push({ etiqueta, ok })
  console.log(`${ok ? "PASS" : "FALHA"}  ${etiqueta}${detalhe ? ` -- ${detalhe}` : ""}`)
}
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The fake source, hooked before the application. `real`: in the desktop app,
 * the real `getDisplayMedia` runs first (the request goes through the main process
 * and the interface), and what it gave is recorded.
 */
const FONTE_FALSA = ({ real, sabotagem }) => {
  window.__pedidos = []
  window.__real = []
  window.__imagensParadas = 0
  window.__capturas = []
  window.__semSom = false
  window.__tom = 1000
  const media = navigator.mediaDevices
  const original = media.getDisplayMedia?.bind(media)
  media.getDisplayMedia = async (pedido) => {
    window.__pedidos.push(JSON.parse(JSON.stringify(pedido ?? {})))
    if (real && original) {
      try {
        const fluxo = await original(pedido)
        window.__real.push({ ok: true, som: fluxo.getAudioTracks().length, imagem: fluxo.getVideoTracks().length })
        for (const faixa of fluxo.getTracks()) faixa.stop()
      } catch (erro) {
        window.__real.push({ ok: false, nome: erro?.name ?? String(erro) })
        // Cancel stays cancel.
        if (window.__cancelar) throw erro
      }
    }
    const tela = document.createElement("canvas")
    tela.width = 320
    tela.height = 180
    tela.getContext("2d").fillRect(0, 0, 320, 180)
    const imagem = tela.captureStream(1).getVideoTracks()[0]
    const parar = imagem.stop.bind(imagem)
    imagem.stop = () => {
      window.__imagensParadas++
      parar()
    }
    const faixas = [imagem]
    // `pedido-mudo`: the browser gives no audio, no matter what the product asks.
    if (pedido?.audio && !window.__semSom && sabotagem !== "pedido-mudo") {
      const ctx = new AudioContext()
      const oscilador = ctx.createOscillator()
      oscilador.frequency.value = window.__tom
      const ganho = ctx.createGain()
      ganho.gain.value = 0.5
      const destino = ctx.createMediaStreamDestination()
      oscilador.connect(ganho).connect(destino)
      oscilador.start()
      const som = destino.stream.getAudioTracks()[0]
      window.__capturas.push(som)
      faixas.push(som)
    }
    return new MediaStream(faixas)
  }
  // The browser's "Stop sharing" button: the track ends, with `ended`.
  window.__pararDePartilhar = () => {
    for (const som of window.__capturas) {
      som.stop()
      som.dispatchEvent(new Event("ended"))
    }
    window.__capturas = []
  }
}

/** The frequency peak in a track of an element, measured on the page. See `e2e-musica.mjs`. */
const PICO = async ({ seletor, tom }) => {
  const elemento = document.querySelector(seletor)
  const faixa = elemento?.srcObject?.getAudioTracks?.()[0]
  if (!faixa) return { existe: Boolean(elemento), pico: null, nivel: -Infinity }
  const ctx = new AudioContext()
  await ctx.resume().catch(() => {})
  const fonte = ctx.createMediaStreamSource(new MediaStream([faixa.clone()]))
  const analisador = ctx.createAnalyser()
  analisador.fftSize = 4096
  fonte.connect(analisador)
  const dados = new Float32Array(analisador.frequencyBinCount)
  let melhor = { db: -Infinity, hz: 0 }
  let noTom = -Infinity
  const binDoTom = Math.round((tom * analisador.fftSize) / ctx.sampleRate)
  for (let volta = 0; volta < 10; volta++) {
    await new Promise((r) => setTimeout(r, 100))
    analisador.getFloatFrequencyData(dados)
    for (let i = 1; i < dados.length; i++) {
      if (dados[i] > melhor.db) melhor = { db: dados[i], hz: (i * ctx.sampleRate) / analisador.fftSize }
    }
    noTom = Math.max(noTom, dados[binDoTom] ?? -Infinity)
  }
  await ctx.close()
  return { existe: true, pico: Math.round(melhor.hz), nivel: Math.round(melhor.db), noTom: Math.round(noTom), estado: faixa.readyState, mudo: faixa.muted }
}

async function abrirFolha(page) {
  const dialogo = page.getByRole("dialog").filter({ hasText: "Partilhar áudio" })
  if (await dialogo.isVisible().catch(() => false)) return dialogo
  await page.getByRole("button", { name: /^(Partilhar áudio\.|A partilhar áudio\. Abrir a lista\.)$/ }).first().click()
  await dialogo.waitFor({ timeout: 10_000 })
  return dialogo
}

async function fecharFolha(page) {
  const dialogo = page.getByRole("dialog").filter({ hasText: "Partilhar áudio" })
  if (await dialogo.isVisible().catch(() => false)) await dialogo.getByRole("button", { name: "Fechar", exact: true }).first().click()
}

/**
 * One source, shared by the DJ and heard on the other side.
 *
 * `escolherJanela`: in the app, the "audio only" selector opens, and the first
 * window there is chosen.
 */
async function partilhaEOuve(rotulo, dj, ouvinte, fonte, { escolherJanela = false, origem = null } = {}) {
  const r = `[${rotulo} · ${fonte}]`
  const tom = TONS[fonte]
  await dj.page.evaluate((valor) => {
    window.__tom = valor
    window.__semSom = false
  }, tom)
  const antes = await dj.page.evaluate(() => ({ pedidos: window.__pedidos.length, imagens: window.__imagensParadas, real: window.__real.length }))
  const folha = await abrirFolha(dj.page)
  const radio = folha.locator(`.audio-fonte[data-fonte="${fonte}"] input`)
  verificar(`${r} a fonte está ligada na folha`, await radio.isEnabled().catch(() => false))
  await radio.check()
  verificar(`${r} a folha diz o que vem a seguir, antes do clique`, await folha.locator(".audio-fonte-accao .field-note").first().isVisible().catch(() => false))
  await folha.getByRole("button", { name: "Escolher e partilhar" }).click()

  if (escolherJanela) {
    const selector = dj.page.getByRole("dialog").filter({ hasText: "De onde vem o som" })
    await selector.first().waitFor({ timeout: 15_000 }).catch(() => {})
    const abriu = (await selector.count()) === 1
    verificar(`${r} o selector da app abre em modo "só som"`, abriu)
    if (abriu) {
      const ecras = await selector.getByText("Ecrãs", { exact: true }).count()
      verificar(`${r} o selector "só som" não oferece ecrãs`, ecras === 0)
      const janela = selector.locator(".ecra-fonte").first()
      const temJanela = await janela.isVisible({ timeout: 15_000 }).catch(() => false)
      if (temJanela) {
        verificar(`${r} o selector "só som" lista as janelas do sistema`, true)
        // The name of the window chosen is what the DJ's card has to say.
        origem = (await janela.locator(".ecra-nome").textContent())?.trim() || origem
        await janela.click()
      } else {
        /*
          Without permission to record the screen, macOS does not give the list
          of windows to this binary. The selector has to say so, and cancel has
          to be cancel: nothing goes on air, no error.
        */
        const vazio = await selector.getByText("Não há nada para partilhar neste momento.").isVisible().catch(() => false)
        verificar(`${r} sem janelas (bancada sem permissão), o selector "só som" diz que não há nada`, vazio)
        await dj.page.evaluate(() => {
          window.__cancelar = true
        })
        await selector.getByRole("button", { name: "Cancelar" }).first().click()
        await dormir(2000)
        const noAr = await dj.page.locator(".call-musica").count()
        const alerta = await dj.page.locator(".partilhar-audio [role=alert]").count()
        verificar(`${r} cancelar o selector não deixa nada no ar, e não diz erro`, noAr === 0 && alerta === 0, `no ar=${noAr} alertas=${alerta}`)
        await dj.page.evaluate(() => {
          window.__cancelar = false
        })
        await fecharFolha(dj.page)
        console.log(`       (o resto da janela não corre nesta bancada: o transporte é o do "Som do sistema", já medido)`)
        return { semJanelas: true }
      }
    }
  }

  await dormir(2500)
  const depois = await dj.page.evaluate(() => ({ pedidos: window.__pedidos, imagens: window.__imagensParadas, real: window.__real }))
  const pedido = depois.pedidos[antes.pedidos]
  const superficie = { separador: "browser", sistema: "monitor", janela: "window" }[fonte]
  verificar(
    `${r} o produto pede o som sem tratamento, sem a voz da chamada, à superfície certa`,
    pedido?.audio?.echoCancellation === false && pedido?.audio?.restrictOwnAudio === true && pedido?.video?.displaySurface === superficie,
    JSON.stringify({ audio: pedido?.audio, superficie: pedido?.video?.displaySurface }),
  )
  verificar(`${r} a imagem deita-se fora logo`, depois.imagens > antes.imagens, `${depois.imagens - antes.imagens} faixas de imagem paradas`)
  if (depois.real.length > antes.real) console.log(`       (a captura real da app deu: ${JSON.stringify(depois.real.slice(antes.real))})`)

  const noAr = await dj.page.locator(".audio-fonte-no-ar").first().textContent({ timeout: 5000 }).catch(() => null)
  verificar(`${r} a folha do DJ diz "A partilhar: ${origem}"`, noAr === `A partilhar: ${origem}`, noAr ?? "sem linha")
  const alerta = await dj.page.locator(".partilhar-audio [role=alert]").first().textContent({ timeout: 500 }).catch(() => null)
  if (alerta) console.log(`       (alerta na folha do DJ: ${alerta.replace(/\n/g, " · ")})`)
  await fecharFolha(dj.page)

  // On the other side: the MUSIC track, and its tone.
  await ouvinte.page.waitForSelector("audio[data-musica='1']", { state: "attached", timeout: 25_000 }).catch(() => {})
  await dormir(3000)
  const ouvido = await ouvinte.page.evaluate(PICO, { seletor: "audio[data-musica='1']", tom })
  verificar(`${r} quem ouve tem o elemento da música`, ouvido.existe)
  verificar(`${r} a música chega decifrada e viva`, ouvido.estado === "live" && ouvido.mudo === false, `${ouvido.estado}, ${ouvido.mudo ? "sem pacotes" : "com pacotes"}`)
  verificar(
    `${r} o que se ouve na faixa da MÚSICA é a fonte: pico em ${tom} Hz`,
    ouvido.pico !== null && Math.abs(ouvido.pico - tom) <= 30 && ouvido.nivel > -70,
    `pico ${ouvido.pico} Hz a ${ouvido.nivel} dB`,
  )
  const cartao = await ouvinte.page.locator(".call-chip-musica").first().textContent({ timeout: 5000 }).catch(() => null)
  verificar(`${r} o cartão do DJ diz de onde vem o som: "A tocar: ${origem}"`, Boolean(cartao?.includes(`A tocar: ${origem}`)), cartao ?? "sem linha")
  const ecraOferecido = await ouvinte.page.getByRole("button", { name: /^Ver (o ecrã|a transmissão) de/ }).count()
  const palco = await ouvinte.page.locator(".call-palco").count()
  verificar(`${r} nenhuma imagem sai: sem ecrã oferecido, sem palco`, ecraOferecido === 0 && palco === 0, `ver=${ecraOferecido} palco=${palco}`)

  // The listener keeps their controls: the music volume.
  const cursor = ouvinte.page.getByLabel(/^Volume da música de /).first()
  if (await cursor.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cursor.fill("0.3")
    await dormir(300)
    const volume = await ouvinte.page.evaluate(() => document.querySelector("audio[data-musica='1']")?.volume ?? null)
    verificar(`${r} o volume da música de quem ouve vale`, volume !== null && Math.abs(volume - 0.3) < 0.01, `volume ${volume}`)
    await cursor.fill("1")
  } else verificar(`${r} quem ouve tem o cursor do volume da música`, false)
}

/** The browser's "Stop sharing": the audio leaves the call, clean, both sides. */
async function pararPeloBrowser(rotulo, dj, ouvinte) {
  const r = `[${rotulo}]`
  await dj.page.evaluate(() => window.__pararDePartilhar())
  await dormir(4000)
  const fim = await ouvinte.page.evaluate(() => ({
    elemento: Boolean(document.querySelector("audio[data-musica='1']")),
    linha: Boolean(document.querySelector(".call-chip-musica")),
  }))
  verificar(`${r} o "Parar de partilhar" do browser tira a música do outro lado`, !fim.elemento && !fim.linha, JSON.stringify(fim))
  const sinal = await dj.page.locator(".call-musica").count()
  verificar(`${r} e o DJ deixa de ver o sinal da música`, sinal === 0)
}

/** The unchecked audio box: Error 480, and nothing goes out. */
async function semSom(rotulo, dj) {
  const r = `[${rotulo} · sistema sem a caixa do áudio]`
  await dj.page.evaluate(() => {
    window.__semSom = true
  })
  const folha = await abrirFolha(dj.page)
  await folha.locator('.audio-fonte[data-fonte="sistema"] input').check()
  await folha.getByRole("button", { name: "Escolher e partilhar" }).click()
  const viu = await folha.getByText(/Erro 480/).first().isVisible({ timeout: 5000 }).catch(() => false)
  const frase = viu ? await folha.getByText(/A fonte não deu som\./).first().isVisible().catch(() => false) : false
  verificar(`${r} o DJ lê "Erro 480" e a frase`, viu && frase)
  verificar(`${r} e nada fica no ar`, (await dj.page.locator(".call-musica").count()) === 0)
  await dj.page.evaluate(() => {
    window.__semSom = false
  })
  await fecharFolha(dj.page)
}

async function abrirContaNaBancada(indice, perfil, { dj }) {
  const ctx = await chromium.launchPersistentContext(`${perfil}/${indice}`, {
    headless: true,
    args: ARGS,
    permissions: ["microphone"],
    // The DJ says it is Chrome on Windows: that is where the browser gives system audio.
    ...(dj ? { userAgent: CHROME_WINDOWS } : {}),
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  if (dj) await page.addInitScript(FONTE_FALSA, { real: false, sabotagem: SABOTAGEM })
  await page.goto(comLingua(APP), { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2000)
  await criarConta(page, { nome: dj ? "dj" : "ouvinte", frase: FRASE })
  await page.getByRole("button", { name: "Configurações", exact: true }).waitFor({ timeout: 90_000 })
  return { ctx, page, indice }
}

async function correrNoBrowser(modo) {
  const rotulo = `browser ${modo}`
  console.log(`\n== O DJ no Chromium, por ${modo === "sfu" ? "SFU" : "malha"}`)
  const dados = mkdtempSync(join(tmpdir(), `orwell-dj-${modo}-`))
  const perfis = mkdtempSync(join(tmpdir(), `orwell-dj-perfis-${modo}-`))
  const sala = `dj ${modo} ${Date.now().toString(36)}`
  const clientes = []
  try {
    if (!(await levantarBancada(dados, { comSfu: modo === "sfu" }))) throw new Error("o homeserver não subiu")
    if (!(await levantarWeb())) throw new Error("o vite não subiu")
    clientes.push(await abrirContaNaBancada(0, perfis, { dj: true }))
    clientes.push(await abrirContaNaBancada(1, perfis, { dj: false }))
    const [dj, ouvinte] = clientes
    await criarCanal(dj.page, sala)
    const entrou = await assentar(dj, ouvinte, sala)
    verificar(`[${rotulo}] o convidado aceita e fica no canal`, entrou)
    if (!entrou) return
    for (const cliente of clientes) {
      await abrirCanal(cliente.page, sala)
      await entrarNaChamada(cliente.page)
      await cliente.page.waitForTimeout(1500)
    }
    await dormir(4000)

    const folha = await abrirFolha(dj.page)
    const janela = folha.locator('.audio-fonte[data-fonte="janela"]')
    verificar(
      `[${rotulo}] "Uma janela" fica desligada no browser, com o porquê`,
      (await janela.locator("input").isDisabled()) && (await janela.textContent())?.includes("Nenhum browser dá o áudio de uma só janela."),
    )
    await fecharFolha(dj.page)

    // The fake screen has no name (the label is a code): the notice says the source.
    await partilhaEOuve(rotulo, dj, ouvinte, "separador", { origem: "Um separador do browser" })
    await pararPeloBrowser(`${rotulo} · separador`, dj, ouvinte)
    await partilhaEOuve(rotulo, dj, ouvinte, "sistema", { origem: "Som do sistema" })
    await pararPeloBrowser(`${rotulo} · sistema`, dj, ouvinte)
    await semSom(rotulo, dj)
  } catch (erro) {
    console.error(`\nFALHA  a corrida ${rotulo} rebentou: ${erro?.stack ?? erro}`)
    resultados.push({ etiqueta: `[${rotulo}] a corrida chegou ao fim`, ok: false })
  } finally {
    for (const cliente of clientes) await cliente.ctx.close().catch(() => {})
    matarTudo()
    const limpar = (pasta) => rmSync(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    limpar(dados)
    limpar(perfis)
    await dormir(1000)
  }
}

/**
 * The DJ in the desktop app for real (`apps/client/out`), and the listener in
 * Chromium. The real `getDisplayMedia` goes through the main process; the audio
 * the system gives is swapped for the oscillator. Needs `npm run build`.
 */
async function correrNaSecretaria() {
  const rotulo = "secretaria"
  console.log("\n== O DJ na app de secretária, o ouvinte no Chromium (malha)")
  const { abrirSecretaria } = await import("./secretaria.mjs")
  const { levantarServidor } = await import("./servidor-descartavel.mjs")
  const fase7 = await import("./fase7-comum.mjs")
  const { aceitarConvite, convidar } = await import("./convite.mjs")
  const srv = await levantarServidor({ frente: 8486, servidor: 8487, sfu: 0, etiqueta: "dj-fontes" })
  let sec
  let browser
  try {
    // The real selector: without it, Chromium would pick a screen on its own and the main process handler would never run.
    sec = await abrirSecretaria({ rotulo: "dj", selectorReal: true })
    const ana = sec.page
    await fase7.portaoPronto(ana)
    await ana.addInitScript(FONTE_FALSA, { real: true, sabotagem: SABOTAGEM })
    await ana.reload()
    await criarConta(ana, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
    await fase7.dentro(ana)

    browser = await chromium.launch({ headless: true, args: ARGS })
    const ctx = await browser.newContext({ locale: "pt-PT", permissions: ["microphone"] })
    const bruno = await ctx.newPage()
    await bruno.goto(srv.APP, { waitUntil: "domcontentloaded" })
    await criarConta(bruno, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
    await fase7.dentro(bruno)
    const [, enderecoBruno] = fase7.contasDoServidor(srv.base)

    await fase7.criarCanal(ana, "pista")
    const convidou = await convidar(ana, "pista", enderecoBruno)
    const entrou = convidou && (await aceitarConvite(bruno, "pista", { espera: 60_000 }))
    verificar(`[${rotulo}] o ouvinte aceita o convite do DJ`, Boolean(entrou))
    if (!entrou) return
    await fase7.abrirCanal(ana, "pista")
    await fase7.abrirCanal(bruno, "pista")
    verificar(`[${rotulo}] o DJ entra na sala de voz`, await fase7.entrarNaVoz(ana))
    await dormir(1000)
    verificar(`[${rotulo}] o ouvinte entra na sala de voz`, await fase7.entrarNaVoz(bruno))
    await dormir(6000)

    const dj = { page: ana }
    const ouvinte = { page: bruno }
    const folha = await abrirFolha(ana)
    const nota = folha.locator(".audio-fonte[data-fonte=separador]")
    verificar(`[${rotulo}] as quatro fontes; o separador ligado na app`, await nota.locator("input").isEnabled())
    await fecharFolha(ana)

    /*
      Screen recording permission on macOS. The test bench Electron does not have it
      (no one gave it to this binary), and so the product has to say Error 484
      BEFORE opening the capture. This is proved with real permission; next the
      main process question starts to answer "granted", only on this bench, for
      the rest of the path to run.
    */
    const permissao = await sec.app.evaluate(({ systemPreferences }) =>
      process.platform === "darwin" ? systemPreferences.getMediaAccessStatus("screen") : "granted",
    )
    console.log(`       (a permissão de gravar o ecrã desta bancada: ${permissao})`)
    if (permissao === "denied" || permissao === "restricted") {
      const folha484 = await abrirFolha(ana)
      await folha484.locator('.audio-fonte[data-fonte="sistema"] input').check()
      const pedidosAntes = await ana.evaluate(() => window.__pedidos.length)
      await folha484.getByRole("button", { name: "Escolher e partilhar" }).click()
      const viu = await folha484.getByText(/Erro 484/).first().isVisible({ timeout: 5000 }).catch(() => false)
      const pedidosDepois = await ana.evaluate(() => window.__pedidos.length)
      verificar(`[${rotulo}] com a gravação recusada pelo macOS: Erro 484, e a captura nem abre`, viu && pedidosDepois === pedidosAntes)
      await fecharFolha(ana)
      await sec.app.evaluate(({ systemPreferences }) => {
        systemPreferences.getMediaAccessStatus = () => "granted"
      })
    }

    if (corre("sistema")) {
      await partilhaEOuve(rotulo, dj, ouvinte, "sistema", { origem: "Som do sistema" })
      const semSelector = await ana.getByRole("dialog").filter({ hasText: /De onde vem o som|Escolher o que partilhar/ }).count()
      verificar(`[${rotulo} · sistema] sem selector nenhum: a interface responde sozinha`, semSelector === 0)
      await pararPeloBrowser(`${rotulo} · sistema`, dj, ouvinte)
    }
    if (corre("janela")) {
      const janela = await partilhaEOuve(rotulo, dj, ouvinte, "janela", { escolherJanela: true, origem: "Uma janela" })
      if (!janela?.semJanelas) await pararPeloBrowser(`${rotulo} · janela`, dj, ouvinte)
    }

    const erros = sec.registo.filter((l) => l.includes("PAGEERROR"))
    verificar(`[${rotulo}] nenhum erro de página na app`, erros.length === 0, erros[0]?.slice(0, 160) ?? "")
  } catch (erro) {
    console.error(`\nFALHA  a corrida ${rotulo} rebentou: ${erro?.stack ?? erro}`)
    resultados.push({ etiqueta: `[${rotulo}] a corrida chegou ao fim`, ok: false })
    console.log("--- registo da app (fim) ---\n" + (sec?.registo ?? []).slice(-30).join("\n"))
  } finally {
    await sec?.fechar().catch(() => {})
    await browser?.close().catch(() => {})
    srv.fechar()
  }
}

for (const corrida of CORRIDAS) {
  if (corrida === "browser-sfu") await correrNoBrowser("sfu")
  else if (corrida === "browser-malha") await correrNoBrowser("malha")
  else if (corrida === "secretaria") await correrNaSecretaria()
  else throw new Error(`corrida desconhecida: ${corrida}`)
}

const passou = resultados.filter((r) => r.ok).length
console.log(`\n${passou}/${resultados.length} verificações passaram`)
process.exit(passou === resultados.length && resultados.length > 0 ? 0 : 1)
