/**
 * "Share audio", the first source: a file played in a call, end to end.
 *
 * Phase 9 de `docs/planos/definicoes-0-9.md`. The subject is the product: the `apps/web`
 * on `vite`, the homeserver (with and without media engine), two accounts
 * created via the screen, an invite accepted via the screen, the voice room
 * clicked, and the "Share audio" button pressed. The file is chosen in the `<input type="file">`
 * of the sheet, the way a person would choose it.
 *
 * ```
 * npx tsc -b && node scripts/e2e-musica.mjs            # malha e SFU
 * node scripts/e2e-musica.mjs --so malha
 * node scripts/e2e-musica.mjs --so sfu
 * ```
 *
 * Bench ports (`scripts/sfu-prova-fase2/bancada.mjs`): 8462, 5199 e
 * 44320. Never 8452, which belongs to the other scripts.
 *
 * **The file is synthetic, and the tone is the proof.** A stereo WAV of 20 s with a
 * 1500 Hz tone, written here. On the other side the `<audio>` element of the
 * music is read (the `MusicaQueChega`) and the sound is measured with an analyzer: the peak
 * must be in 1500 Hz, which is not the tone from Chromium's fake microphone. And
 * the VOICE of the same person is also measured, which cannot carry the tone:
 * the music goes on a separate track, not through the voice chain.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"
import { comLingua } from "./ambiente.mjs"
import { criarConta } from "./conta.mjs"
import { APP, FRASE, matarTudo, levantarServidor, levantarWeb } from "./sfu-prova-fase2/bancada.mjs"
import { abrirCanal, assentar, criarCanal, entrarNaChamada } from "./sfu-prova-fase2/montagem.mjs"

const TOM = 1500
const NOME = `tom-${TOM}`
const so = process.argv.includes("--so") ? process.argv[process.argv.indexOf("--so") + 1] : null
const MODOS = so ? [so] : ["malha", "sfu"]

const ARGS = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"]

const resultados = []
const verificar = (etiqueta, ok, detalhe = "") => {
  resultados.push({ etiqueta, ok })
  console.log(`${ok ? "PASS" : "FALHA"}  ${etiqueta}${detalhe ? ` -- ${detalhe}` : ""}`)
}
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A 16-bit PCM WAV, stereo, 48 kHz, with a pure tone. */
function wavComTom(hz, segundos) {
  const taxa = 48_000
  const canais = 2
  const amostras = taxa * segundos
  const dados = amostras * canais * 2
  const wav = Buffer.alloc(44 + dados)
  wav.write("RIFF", 0)
  wav.writeUInt32LE(36 + dados, 4)
  wav.write("WAVE", 8)
  wav.write("fmt ", 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(canais, 22)
  wav.writeUInt32LE(taxa, 24)
  wav.writeUInt32LE(taxa * canais * 2, 28)
  wav.writeUInt16LE(canais * 2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write("data", 36)
  wav.writeUInt32LE(dados, 40)
  for (let i = 0; i < amostras; i++) {
    const valor = Math.round(Math.sin((2 * Math.PI * hz * i) / taxa) * 0.5 * 32767)
    wav.writeInt16LE(valor, 44 + i * 4)
    wav.writeInt16LE(valor, 44 + i * 4 + 2)
  }
  return wav
}

/**
 * The frequency peak of an audio track, measured on the page.
 *
 * A clone of the track in an analyzer: on Chromium remote sound only reaches
 * Web Audio if the track is connected to a media element, and it is (it is the
 * one from `MusicaQueChega`, or the voice `VideoTile`). One second of samples.
 */
const PICO = async (seletor) => {
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
  const binDoTom = Math.round((1500 * analisador.fftSize) / ctx.sampleRate)
  for (let volta = 0; volta < 10; volta++) {
    await new Promise((r) => setTimeout(r, 100))
    analisador.getFloatFrequencyData(dados)
    for (let i = 1; i < dados.length; i++) {
      if (dados[i] > melhor.db) melhor = { db: dados[i], hz: (i * ctx.sampleRate) / analisador.fftSize }
    }
    noTom = Math.max(noTom, dados[binDoTom] ?? -Infinity)
  }
  await ctx.close()
  return {
    existe: true,
    pico: Math.round(melhor.hz),
    nivel: Math.round(melhor.db),
    noTom: Math.round(noTom),
    estado: faixa.readyState,
    mudo: faixa.muted,
    volume: elemento.volume,
    calado: elemento.muted,
    aTocar: !elemento.paused,
  }
}

async function abrirConta(indice, perfil) {
  const ctx = await chromium.launchPersistentContext(`${perfil}/${indice}`, {
    headless: true,
    args: ARGS,
    permissions: ["microphone"],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto(comLingua(APP), { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2000)
  await criarConta(page, { nome: `dj ${indice}`, frase: FRASE })
  // Wait for `criarContaEEntrar`, with `exact`: from the account strip there is
  // a second "Open settings" button, and the loose name matches both.
  await page.getByRole("button", { name: "Configurações", exact: true }).waitFor({ timeout: 90_000 })
  return { ctx, page, indice }
}

const somDe = (page) => page.evaluate(PICO, "audio[data-musica='1']")
/** The other person's voice: the first speaker box in the panel that is not ours. */
const vozDe = (page) => page.evaluate(PICO, ".call-video > .tile:nth-child(2) video")

async function tocaEOuve(modo, dj, ouvinte) {
  const r = `[${modo}]`
  const abrir = dj.page.getByRole("button", { name: "Partilhar áudio." }).first()
  const temBotao = await abrir.isVisible({ timeout: 10_000 }).catch(() => false)
  verificar(`${r} "Partilhar áudio" está na barra da chamada`, temBotao)
  if (!temBotao) return
  await abrir.click()
  const folha = dj.page.getByRole("dialog")
  verificar(`${r} a folha abre com "Ficheiros ou lista"`, await folha.getByText("Ficheiros ou lista").isVisible().catch(() => false))

  await dj.page
    .locator('input[type="file"][aria-label="Escolher ficheiros"]')
    .setInputFiles({ name: `${NOME}.wav`, mimeType: "audio/wav", buffer: wavComTom(TOM, 20) })
  verificar(`${r} o ficheiro entra na lista pelo nome`, await folha.getByText(NOME, { exact: true }).isVisible().catch(() => false))
  await folha.getByRole("button", { name: "Tocar", exact: true }).click()
  await dormir(1500)
  await folha.getByRole("button", { name: "Fechar", exact: true }).click()

  const sinal = await dj.page.evaluate(() => document.querySelector(".call-musica")?.textContent ?? null)
  verificar(`${r} o DJ vê "A tocar: …" no painel`, Boolean(sinal?.includes(`A tocar: ${NOME}`)), sinal ?? "sem sinal")

  // On the other side: the music element appears, and the tone arrives.
  await ouvinte.page.waitForSelector("audio[data-musica='1']", { state: "attached", timeout: 25_000 }).catch(() => {})
  await dormir(3000)
  const ouvido = await somDe(ouvinte.page)
  verificar(`${r} quem ouve tem um elemento só para a música`, ouvido.existe)
  verificar(
    `${r} a música chega decifrada e viva`,
    ouvido.estado === "live" && ouvido.mudo === false,
    `${ouvido.estado}, ${ouvido.mudo ? "sem pacotes" : "com pacotes"}`,
  )
  verificar(
    `${r} o que se ouve é o ficheiro: pico em ${TOM} Hz`,
    ouvido.pico !== null && Math.abs(ouvido.pico - TOM) <= 30 && ouvido.nivel > -70,
    `pico ${ouvido.pico} Hz a ${ouvido.nivel} dB`,
  )
  const cartao = await ouvinte.page.evaluate(() => document.querySelector(".call-chip-musica")?.textContent ?? null)
  verificar(`${r} o cartão do DJ diz "A tocar: …" a quem ouve`, Boolean(cartao?.includes(NOME)), cartao ?? "sem linha")

  // The DJ's voice does not carry the tone: music does not go through the voice chain.
  const voz = await vozDe(ouvinte.page)
  verificar(
    `${r} a voz do DJ não traz a música`,
    voz.existe && voz.noTom < ouvido.noTom - 20,
    `voz a ${TOM} Hz: ${voz.noTom} dB; música: ${ouvido.noTom} dB`,
  )

  // Muting the microphone does NOT stop the music.
  await dj.page.getByRole("button", { name: /Desligar microfone\.$/ }).first().click()
  await dormir(2500)
  const calado = await somDe(ouvinte.page)
  verificar(
    `${r} com o microfone calado, a música continua a chegar`,
    calado.pico !== null && Math.abs(calado.pico - TOM) <= 30 && calado.nivel > -70,
    `pico ${calado.pico} Hz a ${calado.nivel} dB`,
  )
  await dj.page.getByRole("button", { name: /Ligar microfone\.$/ }).first().click()

  // The music volume is separate from the voice volume.
  const cursor = ouvinte.page.getByLabel(/^Volume da música de /).first()
  if (await cursor.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cursor.fill("0.2")
    await dormir(300)
    const depois = await somDe(ouvinte.page)
    const daVoz = await ouvinte.page.getByLabel(/^Volume de /).first().inputValue().catch(() => null)
    verificar(`${r} o volume da música muda o elemento dela, e não o da voz`, Math.abs(depois.volume - 0.2) < 0.01 && daVoz === "1", `música ${depois.volume}, voz ${daVoz}`)
  } else {
    verificar(`${r} quem ouve tem o cursor do volume da música`, false)
  }

  // "Stop" removes the music from the call.
  await abrir.click()
  await dj.page.getByRole("button", { name: "Parar de partilhar áudio" }).click()
  const avisos = await dj.page.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent ?? ""))
  if (avisos.length > 0) console.log(`       (avisos no ecrã do DJ: ${JSON.stringify(avisos)})`)
  await dj.page.getByRole("dialog").getByRole("button", { name: "Fechar", exact: true }).click()
  await dormir(4000)
  const fim = await ouvinte.page.evaluate(() => ({
    elemento: Boolean(document.querySelector("audio[data-musica='1']")),
    linha: Boolean(document.querySelector(".call-chip-musica")),
  }))
  verificar(`${r} "Parar" tira a música e o sinal do outro lado`, !fim.elemento && !fim.linha, JSON.stringify(fim))
}

async function correr(modo) {
  console.log(`\n== A música, por ${modo === "sfu" ? "SFU" : "malha"}`)
  const dados = mkdtempSync(join(tmpdir(), `orwell-musica-${modo}-`))
  const perfis = mkdtempSync(join(tmpdir(), `orwell-musica-perfis-${modo}-`))
  const sala = `musica ${modo} ${Date.now().toString(36)}`
  const clientes = []
  try {
    if (!(await levantarServidor(dados, { comSfu: modo === "sfu" }))) throw new Error("o homeserver não subiu")
    if (!(await levantarWeb())) throw new Error("o vite não subiu")
    for (const indice of [0, 1]) clientes.push(await abrirConta(indice, perfis))
    const [a, b] = clientes

    await criarCanal(a.page, sala)
    const entrou = await assentar(a, b, sala)
    verificar(`[${modo}] o convidado aceita e fica no canal`, entrou)
    if (!entrou) return
    for (const cliente of clientes) {
      await abrirCanal(cliente.page, sala)
      await entrarNaChamada(cliente.page)
      await cliente.page.waitForTimeout(1500)
    }
    await dormir(4000)
    await tocaEOuve(modo, a, b)
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
