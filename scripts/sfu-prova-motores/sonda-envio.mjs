/**
 * Zero packets sent: was it the capture, the `produce`, or the cipher?
 *
 *   MOTORES=firefox node scripts/sfu-prova-motores/sonda-envio.mjs
 *
 * `prova.mjs` tells HOW MUCH went through. When the amount is zero, it cannot
 * distinguish three failures with the same number:
 *
 *  1. **Capture returned no track.** `entrar()` receives `null`, the `if (faixa)`
 *     skips the `produce`, and `call-sfu-ligado` exits the same way, a call set
 *     up with nothing to send, and not a word of it in the logs.
 *  2. **`produce` ran and the cipher never attached.** Then there is `outbound-rtp`
 *     and a `sender` with a track, and the logs would show `sfu-emissor-sem-cifra`.
 *  3. **Everything set up and frames do not leave.** `sender.transform` in place,
 *     `outbound-rtp` exists, and `packetsSent` stuck at zero, the signature of a
 *     transform that nobody is draining from the other side of the boundary.
 *
 * All three show `pacotesEnviados: 0`. This probe asks the engine what the count
 * does not tell: is there a track? is there a sender? is there a transform
 * attached? and what does the `outbound-rtp` say about itself. It does not attach
 * anything to the cipher, it only reads what the `RTCPeerConnection` instances
 * that the product created have to report, a question all three engines can answer.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { APP, FRASE, levantarServidor, levantarWeb, matarTudo } from "../sfu-prova-fase2/bancada.mjs"
import { abrirCanal, abrirConta, assentar, criarCanal, entrarNaChamada, registoDe } from "./montagem.mjs"

const MOTORES = (process.env["MOTORES"] ?? "firefox").split(",")

const dados = mkdtempSync(join(tmpdir(), "sonda-envio-dados-"))
const perfis = mkdtempSync(join(tmpdir(), "sonda-envio-perfis-"))

/** What the engine knows about each connection the product brought up. */
const OLHAR = async () => {
  const saida = []
  for (const pc of window.__pcs ?? []) {
   try {
    const emissores = pc.getSenders().map((s) => ({
      faixa: s.track ? { kind: s.track.kind, enabled: s.track.enabled, muted: s.track.muted, estado: s.track.readyState } : null,
      transformacao: Boolean(s.transform),
    }))
    const receptores = pc.getReceivers().map((r) => ({
      faixa: r.track ? { kind: r.track.kind, muted: r.track.muted, estado: r.track.readyState } : null,
      transformacao: Boolean(r.transform),
    }))
    const rtp = []
    const stats = await pc.getStats().catch(() => null)
    if (stats) {
      stats.forEach((registo) => {
        if (registo.type === "outbound-rtp" || registo.type === "inbound-rtp") {
          rtp.push({
            tipo: registo.type,
            kind: registo.kind ?? registo.mediaType,
            pacotes: registo.packetsSent ?? registo.packetsReceived ?? 0,
            bytes: registo.bytesSent ?? registo.bytesReceived ?? 0,
            frames: registo.framesEncoded ?? registo.framesDecoded,
          })
        }
        if (registo.type === "candidate-pair" && registo.state === "succeeded") {
          rtp.push({ tipo: "par-ice", pacotes: registo.packetsSent ?? 0, bytes: registo.bytesSent ?? 0 })
        }
      })
    }
    const candidatos = (sdp) =>
      (sdp ?? "")
        .split("\n")
        .filter((l) => l.includes("a=candidate") || l.startsWith("m=") || l.includes("a=setup"))
        .map((l) => l.trim())
    saida.push({
      estado: pc.connectionState,
      ice: pc.iceConnectionState,
      gathering: pc.iceGatheringState,
      local: candidatos(pc.localDescription?.sdp),
      remoto: candidatos(pc.remoteDescription?.sdp),
      emissores,
      receptores,
      rtp,
    })
   } catch (erro) {
    // Firefox THROWS on `getSenders()` and `localDescription` when the connection
    // is already closed-and two of the four always close, they're the mediasoup-client
    // capability probes. Without this guard the probe breaks halfway through
    // and doesn't reach the two that matter.
    saida.push({ estado: "fechada", ice: String(erro?.name ?? erro), gathering: "", local: [], remoto: [], emissores: [], receptores: [], rtp: [] })
   }
  }
  /*
   * And the capture, which is hypothesis 1. Read from the page's media elements and
   * the tracks the product put on a sender-if there's no track anywhere, there was
   * nothing to produce and the rest of the list is talk.
   */
  const media = [...document.querySelectorAll("audio,video")].map((el) => ({
    tag: el.tagName,
    temFonte: Boolean(el.srcObject),
    faixas: el.srcObject ? el.srcObject.getTracks().map((t) => `${t.kind}:${t.readyState}`) : [],
  }))
  return { ligacoes: saida, media }
}

console.log("A levantar o homeserver com motor de media…")
if (!(await levantarServidor(dados, { comSfu: true, anunciarEm: process.env["ANUNCIAR"] ?? "" }))) {
  console.error("o homeserver não subiu")
  process.exit(1)
}
console.log("A levantar o vite…")
if (!(await levantarWeb())) {
  console.error("o vite não subiu")
  process.exit(1)
}

for (const motor of MOTORES) {
  console.log("")
  console.log(`==================== ${motor}`)
  let anfitriao
  let convidado
  try {
    anfitriao = await abrirConta(motor, APP, { nome: `Ana-${motor}`, frase: FRASE, indice: 1, perfil: perfis })
    convidado = await abrirConta(motor, APP, { nome: `Bento-${motor}`, frase: FRASE, indice: 2, perfil: perfis })

    // What the engine threw on the console, where an unhandled rejected promise
    // lands-and where a worker that didn't load complains. Without this, a silent
    // failure reads as no failure at all.
    for (const [quem, alvo] of [
      ["ana", anfitriao],
      ["bento", convidado],
    ]) {
      alvo.page.on("console", (msg) => {
        if (msg.type() === "error" || msg.type() === "warning") console.log(`   [consola ${quem}] ${msg.text().slice(0, 200)}`)
      })
      alvo.page.on("pageerror", (erro) => console.log(`   [erro ${quem}] ${String(erro.message).slice(0, 200)}`))
    }

    const SALA = `sonda-envio-${motor}`
    await criarCanal(anfitriao.page, SALA)
    if (!(await assentar(anfitriao, convidado, SALA))) {
      console.log("as duas contas não ficaram no canal")
      continue
    }
    await abrirCanal(convidado.page, SALA)
    await entrarNaChamada(anfitriao.page)
    await entrarNaChamada(convidado.page)
    await anfitriao.page.waitForTimeout(12000)

    for (const [quem, alvo] of [
      ["ana", anfitriao],
      ["bento", convidado],
    ]) {
      const olhada = await alvo.page.evaluate(OLHAR)
      console.log(`   ${quem}: media=${JSON.stringify(olhada.media)}`)
      olhada.ligacoes.forEach((lig, i) => {
        console.log(
          `   ${quem} pc${i}: estado=${lig.estado} ice=${lig.ice}/${lig.gathering} rtp=${JSON.stringify(lig.rtp)}\n      local:  ${JSON.stringify(lig.local)}\n      remoto: ${JSON.stringify(lig.remoto)}`,
        )
      })
      const registo = await registoDe(alvo.page)
      const linhas = registo
        .split("\n")
        .filter((linha) => /call-|sfu-|sframe-|voice|cifra|micro/i.test(linha))
      console.log(`   registo ${quem}: ${linhas.join(" | ")}`)
    }
  } catch (erro) {
    console.log(`rebentou — ${String(erro?.message ?? erro).split("\n")[0]}`)
  } finally {
    await anfitriao?.ctx.close().catch(() => {})
    await convidado?.ctx.close().catch(() => {})
  }
}

matarTudo()
rmSync(dados, { recursive: true, force: true })
rmSync(perfis, { recursive: true, force: true })
