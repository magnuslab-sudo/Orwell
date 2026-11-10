/**
 * Test setup by engine: the same product, opened in Firefox and WebKit.
 *
 * Everything that is the PRODUCT, counts, invite accepted, channel, voice room, comes from
 * the Phase 2 setup without a single change, and on purpose: it's the same path
 * the person takes, and a second copy is a copy you can diverge from. What changes
 * here is just one thing, and that's what matters: WHICH engine.
 *
 * **Each engine opens the camera and microphone its own way**, and none of them asks
 * a human for anything:
 *
 *  - Chromium: `--use-fake-device-for-media-stream`, a continuous tone.
 *  - Firefox: `media.navigator.streams.fake`, the same via preference.
 *  - WebKit: Playwright already delivers fake devices without asking-
 *    measured, `getUserMedia({audio:true})` resolves and gives a track.
 *
 * A tone that never stops is the worst case for bandwidth (Opus DTX never fires)
 * and the best for measurement: sound that doesn't stop is sound you can count.
 */
import { firefox, webkit, chromium } from "playwright"
import { criarContaEEntrar } from "../conta.mjs"

export { abrirCanal, assentar, criarCanal, enderecoDe, entrarNaChamada } from "../sfu-prova-fase2/montagem.mjs"

/**
 * Collect the connections the product creates, without touching it.
 *
 * **It doesn't hook into the cipher, and that's what makes it usable across all three
 * engines.** The instruments from Phases 2 and 3 wrap `createEncodedStreams`,
 * which doesn't exist in Firefox and WebKit-an instrument like that here wouldn't
 * measure anything and would read as "no media passed". This just saves the `RTCPeerConnection`
 * to ask for stats later, a question all three engines answer.
 */
export const RECOLHER = () => {
  const original = window.RTCPeerConnection
  window.__pcs = []
  window.RTCPeerConnection = function (...argumentos) {
    const pc = new original(...argumentos)
    window.__pcs.push(pc)
    return pc
  }
  window.RTCPeerConnection.prototype = original.prototype
  Object.assign(window.RTCPeerConnection, original)
}

const MOTORES = { chromium, firefox, webkit }

/** The switches for each engine, for fake media with nobody at the keyboard. */
const OPCOES = {
  chromium: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  },
  firefox: {
    firefoxUserPrefs: {
      "media.navigator.streams.fake": true,
      "media.navigator.permission.disabled": true,
      "media.autoplay.default": 0,
    },
  },
  webkit: {},
}

/** Open a browser for the requested engine, with the account created. */
export async function abrirConta(motor, app, { nome, frase, indice, perfil }) {
  const ctx = await MOTORES[motor].launchPersistentContext(`${perfil}/${motor}-${indice}`, {
    headless: true,
    /*
     * Playwright's Firefox doesn't know the "microphone" permission and THROWS asking
     * for it-"Unknown permission: microphone", and the engine doesn't even open.
     * Not needed: the `media.navigator.permission.disabled` preference already
     * turns off the request, which is what the permission here would do anyway.
     */
    ...(motor === "firefox" ? {} : { permissions: ["microphone"] }),
    ...OPCOES[motor],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.addInitScript(RECOLHER)
  await page.addInitScript(APANHAR_COPIA)
  await page.goto(app, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2000)
  await criarContaEEntrar(page, { nome, frase })
  return { ctx, page, nome, indice }
}

/**
 * Capture what the product puts on the clipboard.
 *
 * **It's what gives eyes to this bench, and the reason is that the log is NEVER on
 * screen.** The "Diagnostics" section in Settings draws two things-how many
 * events there are, and a button to copy them. The lines themselves are never
 * rendered anywhere: `formatDiagnostics` is only called inside the button's
 * `onClick`, and the text goes straight to the clipboard. Reading
 * `document.body.innerText`-which is what this bench did until now-returns
 * the header and count, never a `call-path` line, no matter how right the selectors are.
 * The "(no line)" across all three engines was this, not a button with a different name.
 *
 * So we don't read the screen: we click the button the person would click and
 * catch what it copied. The text is the SAME as in a report-same formatting,
 * same header, same lines-and along the way it proves the copy button works
 * on all three engines.
 *
 * The copy is from the clipboard, not from what's being measured: it doesn't deliver
 * anything sooner than the product would, it keeps no state between reloads, and it has
 * no opinion on calls. It's a bucket under the tap.
 */
export const APANHAR_COPIA = () => {
  window.__copiado = null
  const balde = {
    writeText: (texto) => {
      window.__copiado = String(texto)
      return Promise.resolve()
    },
    readText: () => Promise.resolve(window.__copiado ?? ""),
  }
  /*
   * `navigator.clipboard` is a getter with no setter on the prototype, and on all three
   * engines it only works by overriding the property on the INSTANCE. And we have to
   * override it even where it exists: `writeText` needs a user gesture or permission
   * depending on the engine, and a `catch` in the product turned the failure into
   * a red warning instead of a log.
   */
  Object.defineProperty(navigator, "clipboard", { configurable: true, get: () => balde })
}

/**
 * The product's diagnostics log, pulled the way the person pulls it.
 *
 * **It's the product saying where it went, not us guessing.** The `call-path`
 * line is written the instant the gate decides, and says "sfu" or "mesh: …". Without it,
 * two people on a working call could be on different paths and nothing on screen would
 * tell them apart-which is exactly why that line was written.
 *
 * Each step that fails says what was there instead of returning empty: a blank log
 * reads as "the product didn't write the path", a conclusion about the product
 * drawn from a bench failure. That's how "(no line)" passed diagnostics for an entire day.
 */
export async function registoDe(page) {
  const carregar = async (nome, segundos) => {
    const alvo = page.getByRole("button", { name: nome }).first()
    if (!(await alvo.isVisible({ timeout: segundos * 1000 }).catch(() => false))) return false
    await alvo.click()
    await page.waitForTimeout(600)
    return true
  }
  const botoesVisiveis = async () =>
    JSON.stringify(
      await page.evaluate(() =>
        [...document.querySelectorAll("button")]
          .map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim())
          .filter(Boolean)
          .slice(0, 25),
      ),
    )

  // "Settings", which is the `strings.rail.settings`, not "Definitions", which
  // was what an earlier version of this searched for and never found.
  if (!(await carregar("Configurações", 5))) {
    return `(bancada: não encontrei "Configurações". botões visíveis: ${await botoesVisiveis()})`
  }
  if (!(await carregar("Ajuda e diagnóstico", 3))) {
    return `(bancada: não encontrei a secção "Ajuda e diagnóstico". botões visíveis: ${await botoesVisiveis()})`
  }
  if (!(await carregar("Copiar registo", 3))) {
    return `(bancada: não encontrei "Copiar registo". botões visíveis: ${await botoesVisiveis()})`
  }
  const texto = await page.evaluate(() => window.__copiado ?? null)
  if (typeof texto !== "string" || texto === "") {
    return '(bancada: carreguei em "Copiar registo" e nada foi copiado — o balde da área de transferência não apanhou nada)'
  }
  return texto
}

/**
 * What the connections on this page actually received, by the ENGINE's count.
 *
 * `packetsReceived` proves transport. `concealedSamples` is what the
 * decoder had to INVENT because it didn't receive audio it could open-
 * and that's the difference between "packets arrived" and "sound came out": a failed
 * decipher leaves packets arriving and sound being invented.
 */
export async function estatisticas(page) {
  return await page.evaluate(async () => {
    const total = {
      pacotesRecebidos: 0,
      pacotesEnviados: 0,
      amostrasRecebidas: 0,
      amostrasInventadas: 0,
      ligacoes: (window.__pcs ?? []).length,
    }
    for (const pc of window.__pcs ?? []) {
      const stats = await pc.getStats().catch(() => null)
      if (!stats) continue
      stats.forEach((registo) => {
        /*
         * `kind` is the standard's name and `mediaType` the old one, and the engines
         * don't agree on which they serve. Filtering by `kind` alone gave zero across
         * the board on the first run-not because there was no audio, but because
         * the field had a different name. Both are accepted, and the absence of both
         * doesn't exclude: in a voice-only call what's there is voice.
         */
        const tipo = registo.kind ?? registo.mediaType
        const audio = tipo === "audio" || tipo === undefined
        if (registo.type === "inbound-rtp" && audio) {
          total.pacotesRecebidos += registo.packetsReceived ?? 0
          total.amostrasRecebidas += registo.totalSamplesReceived ?? 0
          total.amostrasInventadas += registo.concealedSamples ?? 0
        }
        if (registo.type === "outbound-rtp" && audio) {
          total.pacotesEnviados += registo.packetsSent ?? 0
        }
      })
    }
    return total
  })
}
