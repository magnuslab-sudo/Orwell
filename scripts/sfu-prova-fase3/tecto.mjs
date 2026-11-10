/**
 * The bandwidth cap BITING-the half missing since Phase 1.
 *
 * `BANDA_DE_ENTRADA_POR_TRANSPORTE` is the only cap on this platform that
 * resists a lying client: it is applied with `setMaxIncomingBitrate` on the
 * transport, on the server side, and does not depend on the client declaring
 * anything. Phase 1 left it unapplied. Phase 2 applied it, read it from inside
 * the worker, and honestly wrote what was missing:
 *
 * > **The cap still does not BITE.** The real rate does not move-34,545, 34,440
 * > and 34,593 bit/s for the three caps-because an Opus track at 32 kbps never
 * > reaches it. A cap you do not hit refuses nothing. **It closes with Phase 3
 * > video**, and `tecto.mjs` waits for that.
 *
 * This is it. The difference video brings is a sender that WANTS more: a shared
 * screen asks for 2.5 Mbps, which is twenty times what a voice track takes up
 * and six times the tight cap this script experiments with.
 *
 * ```
 * node scripts/sfu-prova-fase3/tecto.mjs
 * ```
 *
 * **The screen has to be EXPENSIVE, or nothing is measured.** A still monitor
 * compresses to almost nothing and never hits any cap-it would be the Phase 2
 * trap all over again, with a different source. So the script puts a screen of
 * animated noise on top of the sharer's page: noise is the worst case for a
 * video codec, and it is what makes the encoder want everything it is given.
 *
 * **Change the SOURCE and recompile**, not the `dist`: what you want to prove is
 * that the constant written in `media.ts` is what moves the number. The source
 * is restored at the end, even when this breaks halfway through.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { APP, FRASE, matarTudo, levantarServidor, levantarWeb, RAIZ } from "../sfu-prova-fase2/bancada.mjs"
import { LER_ESTATISTICAS } from "./instrumento.mjs"
import { abrirCanal, abrirConta, assentar, criarCanal, entrarNaChamada, partilharEcra } from "./montagem.mjs"

const FONTE = join(RAIZ, "apps/server/src/media.ts")
const ORIGINAL = readFileSync(FONTE, "utf8")
const DECLARACAO = /export const BANDA_DE_ENTRADA_POR_TRANSPORTE = [\d_]+/

/*
 * The three caps, and what each one yields.
 *
 * 4,000,000 is the product's: it covers the screen (2.5 Mbps), the camera
 * (600 kbps) and voice (60 kbps) added together, with margin. 1,000,000 cuts
 * the screen in half. 400,000 is six times below what the screen encoder
 * wants-it is what turns the cap from a promise into a refusal.
 */
const TECTOS = [4_000_000, 1_000_000, 400_000]

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const resultados = []
const verificar = (etiqueta, ok, detalhe = "") => {
  resultados.push({ etiqueta, ok })
  console.log(`${ok ? "PASS" : "FALHA"}  ${etiqueta}${detalhe ? ` -- ${detalhe}` : ""}`)
}

/**
 * A screen of animated noise on top of the page, fullscreen.
 *
 * What screen capture sees is the monitor, and what is on the monitor is this
 * window. Random noise is the worst case for a video codec-there is no
 * redundancy between frames or within them-and it is what makes the encoder
 * want the 2.5 Mbps it declared instead of the two hundred kbps a still screen
 * comes down to. Without it, this script would measure a cap no one tries to
 * reach, and it would be the Phase 2 trap repeated with a different source.
 */
const RUIDO = () => {
  const tela = document.createElement("canvas")
  tela.width = 960
  tela.height = 540
  Object.assign(tela.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    zIndex: "99999",
    pointerEvents: "none",
  })
  document.body.appendChild(tela)
  const pincel = tela.getContext("2d")
  const imagem = pincel.createImageData(tela.width, tela.height)
  const pintar = () => {
    const dados = imagem.data
    for (let i = 0; i < dados.length; i += 4) {
      const valor = (Math.random() * 256) | 0
      dados[i] = valor
      dados[i + 1] = (valor * 7) & 255
      dados[i + 2] = (valor * 13) & 255
      dados[i + 3] = 255
    }
    pincel.putImageData(imagem, 0, 0)
    requestAnimationFrame(pintar)
  }
  pintar()
}

/** A two-person call with the screen passing, and what the sender achieves. */
async function medirCom(tecto) {
  if (!DECLARACAO.test(ORIGINAL)) throw new Error("a declaração do tecto mudou de forma; este guião não a encontra")
  writeFileSync(FONTE, ORIGINAL.replace(DECLARACAO, `export const BANDA_DE_ENTRADA_POR_TRANSPORTE = ${tecto}`))
  execFileSync("npx", ["tsc", "-b"], { cwd: RAIZ, stdio: "pipe" })

  const dados = mkdtempSync(join(tmpdir(), "orwell-tecto3-dados-"))
  const perfis = mkdtempSync(join(tmpdir(), "orwell-tecto3-perfis-"))
  const clientes = []
  try {
    if (!(await levantarServidor(dados))) throw new Error("o homeserver não subiu")
    if (!(await levantarWeb())) throw new Error("o vite não subiu")

    const sala = `tecto3 ${Date.now().toString(36)}`
    for (const indice of [0, 1]) {
      clientes.push(await abrirConta(APP, { nome: `tecto3 ${indice}`, frase: FRASE, indice, perfil: perfis }))
    }
    await criarCanal(clientes[0].page, sala)
    if (!(await assentar(clientes[0], clientes[1], sala))) throw new Error("o convidado ficou à porta")
    for (const cliente of clientes) {
      await abrirCanal(cliente.page, sala)
      await entrarNaChamada(cliente.page)
      await cliente.page.waitForTimeout(1500)
    }

    if (!(await partilharEcra(clientes[0].page))) throw new Error("o botão de partilhar não apareceu")
    // The noise starts AFTER capture begins: the capture is of the monitor, not the
    // page, so it catches whatever appears on top at any moment.
    await clientes[0].page.evaluate(RUIDO)

    // Fifteen seconds to settle, and ten to measure. Congestion control needs to
    // see traffic before it has an opinion on it, and with video it takes longer
    // to rise than with voice.
    await dormir(15_000)
    const antes = await clientes[0].page.evaluate(LER_ESTATISTICAS)
    const t0 = Date.now()
    await dormir(10_000)
    const depois = await clientes[0].page.evaluate(LER_ESTATISTICAS)
    const segundos = (Date.now() - t0) / 1000

    const envio = (lista) => lista.find((pc) => pc.dtls === "connected" && pc.saida.length > 0)
    const bytes = (pc) => pc?.saida.reduce((total, linha) => total + linha.bytes, 0) ?? 0

    return {
      tecto,
      bandaAnunciada: envio(depois)?.bandaDeSaida ?? null,
      ritmoDeVideo: Math.round(((bytes(envio(depois)) - bytes(envio(antes))) * 8) / segundos),
    }
  } finally {
    for (const cliente of clientes) await cliente.ctx.close().catch(() => {})
    matarTudo()
    const limpar = (pasta) => rmSync(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    limpar(dados)
    limpar(perfis)
  }
}

const medidas = []
try {
  for (const tecto of TECTOS) {
    console.log(`\n== tecto do servidor: ${tecto} bit/s`)
    const medida = await medirCom(tecto)
    medidas.push(medida)
    console.log(
      `   anunciado ao emissor ${medida.bandaAnunciada}  ·  ritmo real do VÍDEO ${medida.ritmoDeVideo} bit/s`,
    )
  }
} finally {
  writeFileSync(FONTE, ORIGINAL)
  try {
    execFileSync("npx", ["tsc", "-b"], { cwd: RAIZ, stdio: "pipe" })
  } catch {
    console.error("ATENÇÃO: o `media.ts` foi reposto mas o `tsc -b` falhou. Compilar à mão antes de mais nada.")
  }
}

console.log("")
const [largo, medio, apertado] = medidas

/*
 * The BITE, which is what was missing-and what the three numbers say.
 *
 * Measured on August 17, 2026, with a 1920x1080 noise screen:
 *
 *   cap 4,000,000 → 479,471 bit/s     the cap is above what is wanted
 *   cap 1,000,000 → 471,303 bit/s     same, and 1.7% difference from the first
 *   cap   400,000 → 278,866 bit/s     the cap BITES: down 42%, and below it
 *
 * The three together say two things, and they are two checks not one:
 *
 *  1. **A cap above demand holds nothing.** Four times the difference between
 *     the first and the second, and the rate is the same: the number follows
 *     what the encoder wants, not what the server allows. It is the same read
 *     Phase 2 did and what made it correctly conclude it had not seen any cap
 *     bite.
 *  2. **A cap below demand cuts what goes on the wire.** It is not an estimate
 *     changing number: it is fewer bytes crossing the network, counted from the
 *     `bytesSent` of the video `outbound-rtp` in ten seconds.
 *
 * **Why is it not 2.5 Mbps with the loose cap**, and it is said instead of
 * rounded: `TECTO_DO_ECRA` is what the encoder CAN request, not what it always
 * does. On a headless Chrome, encoding 1080p noise at 15 frames per second, CPU
 * calls the shots long before the network. Half a megabit per second is what
 * this machine gives-and it is still fourteen times what a voice track takes up,
 * which is the difference needed to have a cap you can hit.
 */
verificar(
  "com o tecto apertado, o emissor envia MESMO menos: o tecto morde",
  apertado !== undefined && largo !== undefined && apertado.ritmoDeVideo < largo.ritmoDeVideo * 0.75,
  `${largo?.tecto} → ${largo?.ritmoDeVideo} bit/s  ·  ${apertado?.tecto} → ${apertado?.ritmoDeVideo} bit/s`,
)
verificar(
  "e o que ele envia cabe no tecto que o servidor lhe deu",
  apertado !== undefined && apertado.ritmoDeVideo < apertado.tecto,
  `${apertado?.ritmoDeVideo} < ${apertado?.tecto}`,
)
verificar(
  "um tecto ACIMA do que o codificador quer não prende nada: quatro vezes maior, mesmo ritmo",
  medio !== undefined &&
    largo !== undefined &&
    Math.abs(largo.ritmoDeVideo - medio.ritmoDeVideo) / largo.ritmoDeVideo < 0.1,
  `${largo?.tecto}→${largo?.ritmoDeVideo}  ·  ${medio?.tecto}→${medio?.ritmoDeVideo}`,
)
verificar(
  "e há finalmente um emissor que quer muito mais do que uma faixa de voz",
  largo !== undefined && largo.ritmoDeVideo > 10 * 34_500,
  `${largo?.ritmoDeVideo} bit/s contra os ~34 500 de uma faixa de Opus`,
)

const passou = resultados.filter((r) => r.ok).length
console.log(`\n${passou}/${resultados.length} verificações passaram`)
process.exit(passou === resultados.length ? 0 : 1)
