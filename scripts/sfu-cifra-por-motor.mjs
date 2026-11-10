/**
 * Which browser engines can install media encryption, and what they throw when they can't.
 *
 * Written to answer a question with two possible answers, after
 * `createEncodedStreams is not a function` showed up in production with the SFU
 * connected (August 17, 2026):
 *
 *  1. the engine doesn't have insertable streams at all, or
 *  2. the `additionalSettings.encodedInsertableStreams` doesn't reach the
 *     `RTCPeerConnection` constructor down the production path.
 *
 * The two have DIFFERENT symptoms, and it's that difference this script measures
 * instead of assuming it. Phase 0 already measured half, without the option,
 * Chromium throws `InvalidStateError` (`scripts/sfu-prova/README.md`, question 1),  * and what was missing was the other half, in the engines the app also serves.
 *
 *   node scripts/sfu-cifra-por-motor.mjs
 *
 * Doesn't talk to any server, doesn't open any microphone (the stream comes from
 * a `<canvas>`, which doesn't ask anyone for permissions) and doesn't touch the
 * product. It's one local `RTCPeerConnection` per engine and three questions to
 * each one.
 */
import { chromium, firefox, webkit } from "playwright"

/**
 * What we ask each engine, inside the page.
 *
 * Returns facts, never conclusions: the type of the method on the prototype, and
 * what actually happens when you try to use it with and without the option in
 * the constructor. The error message goes in full, because it's what gets
 * compared with the report.
 */
async function interrogar(page) {
  return page.evaluate(async () => {
    const naProto = (alvo) => (typeof alvo?.prototype?.createEncodedStreams === "function" ? "function" : typeof alvo?.prototype?.createEncodedStreams)

    /** A stream without permissions: a canvas drawing itself. */
    const faixa = () => {
      const canvas = document.createElement("canvas")
      canvas.width = 32
      canvas.height = 32
      canvas.getContext("2d").fillRect(0, 0, 32, 32)
      return canvas.captureStream(1).getVideoTracks()[0]
    }

    /**
     * Tries to install encryption in a sender, with or without the option.
     *
     * **Negotiates first, and it's not decoration.** Measured on August 17, 2026:
     * on Chromium 151, a newly created sender accepts `createEncodedStreams()`
     * even without the option in the constructor, the `InvalidStateError`
     * ("Too late to create encoded streams") only shows up AFTER the local
     * description is set, which is where `mediasoup-client` calls it. Without
     * this negotiation the script would measure a window the product never uses
     * and conclude the option is not needed at all.
     *
     * @returns what happened, without a conclusion.
     */
    const tentar = async (comOpcao) => {
      const pc = new RTCPeerConnection(comOpcao ? { encodedInsertableStreams: true } : {})
      const par = new RTCPeerConnection({})
      try {
        const emissor = pc.addTrack(faixa())
        const oferta = await pc.createOffer()
        await pc.setLocalDescription(oferta)
        await par.setRemoteDescription(oferta)
        const resposta = await par.createAnswer()
        await par.setLocalDescription(resposta)
        await pc.setRemoteDescription(resposta)
        // What the product does, letter for letter: `media-sframe.ts`.
        emissor.createEncodedStreams()
        return { resultado: "instalou" }
      } catch (erro) {
        return { resultado: "atirou", nome: erro?.name ?? "", mensagem: String(erro?.message ?? erro) }
      } finally {
        pc.close()
        par.close()
      }
    }

    return {
      agente: navigator.userAgent,
      emissorNaProto: naProto(window.RTCRtpSender),
      receptorNaProto: naProto(window.RTCRtpReceiver),
      /** The standardized alternative, which is how one day you serve those without the other. */
      scriptTransform: typeof window.RTCRtpScriptTransform,
      comOpcao: await tentar(true),
      semOpcao: await tentar(false),
    }
  })
}

const MOTORES = [
  ["chromium", chromium],
  ["firefox", firefox],
  ["webkit", webkit],
]

let falhou = 0
const linhas = []

for (const [nome, motor] of MOTORES) {
  let browser
  try {
    browser = await motor.launch({ headless: true })
  } catch (erro) {
    console.log(`SALTA ${nome}: não está instalado (${String(erro?.message ?? erro).split("\n")[0]})`)
    continue
  }
  const page = await browser.newPage()
  // Any origin works, as long as it's not `about:blank`: some engines refuse
  // `RTCPeerConnection` outside a secure context.
  await page.goto("https://example.com", { waitUntil: "domcontentloaded" }).catch(() => page.goto("about:blank"))

  const resposta = await interrogar(page)
  await browser.close()

  const versao = resposta.agente.match(/(Chrome|Firefox|Version)\/[\d.]+/)?.[0] ?? ""
  console.log("")
  console.log(`== ${nome}  ${versao}`)
  console.log(`   RTCRtpSender.prototype.createEncodedStreams:   ${resposta.emissorNaProto}`)
  console.log(`   RTCRtpReceiver.prototype.createEncodedStreams: ${resposta.receptorNaProto}`)
  console.log(`   RTCRtpScriptTransform:                         ${resposta.scriptTransform}`)
  console.log(`   com encodedInsertableStreams:  ${descrever(resposta.comOpcao)}`)
  console.log(`   sem encodedInsertableStreams:  ${descrever(resposta.semOpcao)}`)

  linhas.push({ nome, ...resposta })
}

function descrever(tentativa) {
  return tentativa.resultado === "instalou" ? "instalou" : `${tentativa.nome || "erro"} — ${tentativa.mensagem}`
}

// ---------------------------------------------------------------- the conclusions
//
// Each one is an assertion, not a sentence: a script that only prints proves
// nothing the day the behavior changes underneath.

console.log("")
const chromiumOk = linhas.find((cada) => cada.nome === "chromium")
if (chromiumOk) {
  /*
   * The two halves separate the two causes, and it's the second that answers the
   * question that brought this script here: in Chromium the method is ALWAYS there,
   * so a lost option on its way to the constructor could never give "is not a
   * function", it gives `InvalidStateError`, with a different message and name.
   */
  verificar(
    "no Chromium a cifra instala-se com a opção, e sem ela dá InvalidStateError",
    chromiumOk.comOpcao.resultado === "instalou" &&
      chromiumOk.semOpcao.resultado === "atirou" &&
      chromiumOk.semOpcao.nome === "InvalidStateError",
    `com=${descrever(chromiumOk.comOpcao)} · sem=${descrever(chromiumOk.semOpcao)}`,
  )
  verificar(
    "e o método existe nas DUAS prototypes do Chromium, haja opção ou não",
    chromiumOk.emissorNaProto === "function" &&
      chromiumOk.receptorNaProto === "function" &&
      !/is not a function/.test(chromiumOk.semOpcao.mensagem),
    `emissor=${chromiumOk.emissorNaProto} receptor=${chromiumOk.receptorNaProto} · sem=${descrever(chromiumOk.semOpcao)}`,
  )
}

for (const motor of linhas.filter((cada) => cada.nome !== "chromium")) {
  verificar(
    `o ${motor.nome} NÃO tem o método, e dá exactamente "is not a function"`,
    motor.emissorNaProto !== "function" &&
      motor.comOpcao.resultado === "atirou" &&
      /createEncodedStreams is not a function/.test(motor.comOpcao.mensagem),
    `${motor.emissorNaProto} · com=${descrever(motor.comOpcao)}`,
  )
  verificar(
    `e no ${motor.nome} a opção no construtor não muda nada: falha igual com e sem ela`,
    motor.comOpcao.resultado === "atirou" && motor.semOpcao.resultado === "atirou",
    `com=${descrever(motor.comOpcao)} · sem=${descrever(motor.semOpcao)}`,
  )
}

function verificar(rotulo, condicao, detalhe) {
  if (condicao) {
    console.log(`PASS  ${rotulo}`)
  } else {
    falhou += 1
    console.log(`FAIL  ${rotulo} — ${detalhe}`)
  }
}

console.log("")
console.log(
  falhou === 0
    ? "A causa está medida: o método não existe fora do Chromium, e a opção no construtor não o traz."
    : `${falhou} verificações falharam.`,
)
process.exit(falhou === 0 ? 0 : 1)
