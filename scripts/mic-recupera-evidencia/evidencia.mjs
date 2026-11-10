/**
 * Evidence: what the voice chain does when the microphone dies (4/11/2026).
 *
 *   node scripts/mic-recupera-evidencia/evidencia.mjs
 *
 * A real Chromium instance (the desktop app engine), without SFU: two
 * `RTCPeerConnection` on the same page, with insertable streams on the sender, and the
 * product chain shape (microphone > `AudioContext` > `AudioWorklet` >
 * `MediaStreamDestination` > sender). In each case, measure over a 3 s window:
 *
 *  - the state of the track leaving the chain (the one the sender has): `readyState`, `muted`;
 *  - the frames passing through the sender transform, and the packets sent;
 *  - the audio energy arriving at the far end (`inbound-rtp.totalAudioEnergy`);
 *  - the events someone could have heard (`ended`, `mute`, `statechange`, `processorerror`).
 *
 * The question from the owner: "it stopped picking up my mic", with no error at all.
 */
import { createServer } from "node:http"
import { chromium } from "playwright"

const PAGINA = String.raw`<!doctype html><meta charset="utf-8"><body><script type="module">
const eventos = []
const marca = (t) => eventos.push(t)
const PROCESSADOR = "class P extends AudioWorkletProcessor { constructor(){ super(); this.rebentar=false; this.port.onmessage=(e)=>{ if(e.data==='rebentar') this.rebentar=true } } process(i,o){ if(this.rebentar) throw new Error('worklet rebentou'); const a=i[0]?.[0], b=o[0]?.[0]; if(a&&b) b.set(a); return true } } registerProcessor('p', P)"
let frames = 0
// O pico do sinal numa faixa, lido por um contexto à parte: é o que o codificador recebe.
function pico(faixa) {
  const ctx = new AudioContext()
  const an = ctx.createAnalyser(); an.fftSize = 2048
  ctx.createMediaStreamSource(new MediaStream([faixa])).connect(an)
  const buf = new Float32Array(an.fftSize)
  let maximo = 0
  setInterval(() => { an.getFloatTimeDomainData(buf); for (const v of buf) maximo = Math.max(maximo, Math.abs(v)) }, 20)
  return () => { const m = maximo; maximo = 0; return m }
}
async function montar() {
  const bruto = await navigator.mediaDevices.getUserMedia({ audio: true })
  const crua = bruto.getAudioTracks()[0]
  crua.addEventListener("ended", () => marca("crua:ended"))
  crua.addEventListener("mute", () => marca("crua:mute"))
  const contexto = new AudioContext({ sampleRate: 48000 })
  contexto.addEventListener("statechange", () => marca("contexto:" + contexto.state))
  await contexto.audioWorklet.addModule(URL.createObjectURL(new Blob([PROCESSADOR], { type: "text/javascript" })))
  const fonte = contexto.createMediaStreamSource(bruto)
  const no = new AudioWorkletNode(contexto, "p", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
  no.onprocessorerror = () => marca("worklet:processorerror")
  const destino = contexto.createMediaStreamDestination()
  fonte.connect(no).connect(destino)
  const saida = destino.stream.getAudioTracks()[0]
  saida.addEventListener("ended", () => marca("saida:ended"))
  saida.addEventListener("mute", () => marca("saida:mute"))
  saida.addEventListener("unmute", () => marca("saida:unmute"))
  const a = new RTCPeerConnection({ encodedInsertableStreams: true })
  const b = new RTCPeerConnection({ encodedInsertableStreams: true })
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate)
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate)
  const emissor = a.addTrack(saida, new MediaStream([saida]))
  const { readable, writable } = emissor.createEncodedStreams()
  readable.pipeThrough(new TransformStream({ transform(f, c) { frames++; c.enqueue(f) } })).pipeTo(writable).catch((e) => marca("pipe:" + e))
  b.ontrack = (e) => {
    const { readable, writable } = e.receiver.createEncodedStreams()
    readable.pipeTo(writable).catch(() => {})
    const audio = new Audio(); audio.srcObject = e.streams[0]; audio.muted = true; audio.play().catch(() => {})
    window.__picoDoOutro = pico(e.track)
  }
  window.__picoDaSaida = pico(saida)
  await a.setLocalDescription(); await b.setRemoteDescription(a.localDescription)
  await b.setLocalDescription(); await a.setRemoteDescription(b.localDescription)
  window.__cadeia = { crua, bruto, contexto, no, saida, a, b, emissor }
}
async function medir() {
  const { a, b, saida, crua, contexto } = window.__cadeia
  const ler = async () => {
    let enviados = 0, energia = 0
    ;(await a.getStats()).forEach((l) => { if (l.type === "outbound-rtp" && l.kind === "audio") enviados = l.packetsSent })
    ;(await b.getStats()).forEach((l) => { if (l.type === "inbound-rtp" && l.kind === "audio") energia = l.totalAudioEnergy ?? 0 })
    return { enviados, energia, frames }
  }
  window.__picoDaSaida(); window.__picoDoOutro?.()
  const antes = await ler()
  await new Promise((r) => setTimeout(r, 3000))
  const depois = await ler()
  return {
    crua: crua.readyState + (crua.muted ? "/muted" : ""),
    saida: saida.readyState + (saida.muted ? "/muted" : ""),
    contexto: contexto.state,
    pacotes: depois.enviados - antes.enviados,
    frames: depois.frames - antes.frames,
    picoQueSai: Number(window.__picoDaSaida().toFixed(3)),
    picoQueChega: Number((window.__picoDoOutro?.() ?? -1).toFixed(3)),
    eventos: eventos.splice(0).join(",") || "nenhum",
  }
}
window.__montar = montar
window.__medir = medir
window.__pronto = true
</script>`

const servidor = createServer((_, r) => r.writeHead(200, { "content-type": "text/html" }).end(PAGINA)).listen(0, "127.0.0.1")
await new Promise((r) => servidor.once("listening", r))
const url = `http://127.0.0.1:${servidor.address().port}/`
const browser = await chromium.launch({
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
})

const casos = [
  ["referência: a cadeia de pé", async () => {}],
  ["a faixa crua termina (stop: o aparelho desapareceu)", (p) => p.evaluate(() => window.__cadeia.crua.stop())],
  ["o AudioContext é suspenso", (p) => p.evaluate(() => window.__cadeia.contexto.suspend())],
  ["o worklet rebenta (excepção no process)", (p) => p.evaluate(() => window.__cadeia.no.port.postMessage("rebentar"))],
  ["a thread principal congela 8 s (o cofre)", (p) => p.evaluate(() => { const fim = Date.now() + 8000; while (Date.now() < fim); })],
]

for (const [nome, provocar] of casos) {
  const pagina = await (await browser.newContext({ permissions: ["microphone"] })).newPage()
  await pagina.goto(url)
  await pagina.waitForFunction(() => window.__pronto)
  await pagina.evaluate(() => window.__montar())
  await pagina.waitForTimeout(2000)
  const base = await pagina.evaluate(() => window.__medir())
  await provocar(pagina)
  const efeito = await pagina.evaluate(() => window.__medir())
  await pagina.waitForTimeout(2000)
  const depois = await pagina.evaluate(() => window.__medir())
  console.log(`\n== ${nome}`)
  console.log(`   antes:      ${JSON.stringify(base)}`)
  console.log(`   a seguir:   ${JSON.stringify(efeito)}`)
  console.log(`   +2 s:       ${JSON.stringify(depois)}`)
  await pagina.context().close()
}
await browser.close()
servidor.close()
