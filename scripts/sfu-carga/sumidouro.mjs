/**
 * The sink: acts as the receiver.
 *
 * One UDP socket where the receive `PlainTransport`s that apply to it point.
 * The payload arrives encrypted in SRTP (the worker pays for encryption as it
 * would in a `WebRtcTransport`), but the RTP header is in the clear, and
 * everything comes from it: SSRC, sequence number (losses) and timestamp (delay).
 */
import { createSocket } from "node:dgram"

const T0 = BigInt(process.env.CARGA_T0)
const agoraUs = () => Number(process.hrtime.bigint() / 1000n - T0)

let relogioDoPt = new Map()
let porSsrc = new Map()
let pacotes = 0
let bytes = 0
let rtcp = 0
// Histogram of delay in steps of 0.1 ms up to 2 s.
let hist = new Uint32Array(20001)

const socket = createSocket({ type: "udp4", recvBufferSize: 8 * 1024 * 1024 })
socket.on("message", (m) => {
  const pt = m[1] & 0x7f
  if (m[1] >= 200 && m[1] <= 206) {
    rtcp++
    return
  }
  const clock = relogioDoPt.get(pt)
  if (!clock) return
  pacotes++
  bytes += m.length + 28 // Plus IP and UDP headers, to make the wire math work out.
  const ssrc = m.readUInt32BE(8)
  const seq = m.readUInt16BE(2)
  let e = porSsrc.get(ssrc)
  if (!e) {
    e = { primeiro: seq, ultimo: seq, voltas: 0, recebidos: 0 }
    porSsrc.set(ssrc, e)
  } else {
    const d = (seq - (e.ultimo & 0xffff) + 0x10000) & 0xffff
    if (d < 0x8000) {
      if (seq < (e.ultimo & 0xffff)) e.voltas++
      e.ultimo = e.voltas * 0x10000 + seq
    }
  }
  e.recebidos++
  const ts = m.readUInt32BE(4)
  const enviadoUs = (ts * 1e6) / clock
  const atraso = agoraUs() - enviadoUs
  // The timestamp wraps (32 bits); a negative or absurd delay doesn't count.
  if (atraso >= -1000 && atraso < 2e6) hist[Math.max(0, Math.round(atraso / 100))]++
})

function percentil(p) {
  let total = 0
  for (const v of hist) total += v
  if (total === 0) return null
  let alvo = total * p
  for (let i = 0; i < hist.length; i++) {
    alvo -= hist[i]
    if (alvo <= 0) return i / 10
  }
  return hist.length / 10
}

process.on("message", (mensagem) => {
  if (mensagem.tipo === "relogios") {
    relogioDoPt = new Map(mensagem.relogios)
  }
  if (mensagem.tipo === "zerar") {
    porSsrc = new Map()
    pacotes = 0
    bytes = 0
    rtcp = 0
    hist = new Uint32Array(20001)
  }
  if (mensagem.tipo === "ler") {
    let esperados = 0
    let recebidos = 0
    for (const e of porSsrc.values()) {
      esperados += e.ultimo - e.primeiro + 1
      recebidos += e.recebidos
    }
    process.send({
      tipo: "leitura",
      pacotes,
      bytes,
      rtcp,
      fluxos: porSsrc.size,
      perdidos: Math.max(0, esperados - recebidos),
      esperados,
      p50: percentil(0.5),
      p99: percentil(0.99),
      max: percentil(1),
    })
  }
  if (mensagem.tipo === "parar") process.exit(0)
})

socket.bind(0, "127.0.0.1", () => process.send({ tipo: "porta", porta: socket.address().port }))
