/**
 * The generator: sends media for N people to the worker.
 *
 * Separate process from the worker and sink, so the cost of making packets
 * doesn't count against the worker. Receives the stream list over the IPC
 * channel and sends unencrypted RTP to each person's send `PlainTransport` (with
 * `comedia`, the worker learns the source from the first packet, so each person
 * has its own socket).
 *
 * The RTP timestamp is the system monotonic clock at the codec rate, counted
 * from `T0`. The sink reads the same clock and computes each packet's delay from
 * it, without opening the payload (which comes encrypted in SRTP).
 */
import { createSocket } from "node:dgram"

const T0 = BigInt(process.env.CARGA_T0)
const agoraUs = () => Number(process.hrtime.bigint() / 1000n - T0)

const fluxos = []

process.on("message", (mensagem) => {
  if (mensagem.tipo === "fluxos") {
    for (const f of mensagem.fluxos) {
      let socket = sockets.get(f.porta)
      if (!socket) {
        socket = createSocket("udp4")
        socket.on("message", () => {}) // RTCP from the worker (PLI, RR): ignored.
        socket.bind(0, "127.0.0.1")
        sockets.set(f.porta, socket)
      }
      fluxos.push({ ...f, socket, seq: Math.floor(Math.random() * 30000), proximo: agoraUs() + Math.random() * 20000, imagem: 0, picId: 1 })
    }
    process.send({ tipo: "pronto", fluxos: fluxos.length })
  }
  if (mensagem.tipo === "parar") process.exit(0)
})
const sockets = new Map()

const MTU = 1150

function pacote(f, payload, ts, marcador) {
  const cab = Buffer.alloc(12)
  cab[0] = 0x80
  cab[1] = (marcador ? 0x80 : 0) | f.pt
  cab.writeUInt16BE(f.seq & 0xffff, 2)
  cab.writeUInt32BE(ts >>> 0, 4)
  cab.writeUInt32BE(f.ssrc >>> 0, 8)
  f.seq++
  return Buffer.concat([cab, payload])
}

function enviarVoz(f, t) {
  // Opus at 32 kbit/s in 20 ms = 80 B, and SFrame adds ~16 B on top.
  // In DTX, Opus sends a comfort packet of 400 em 400 ms, with 3 B.
  const tamanho = f.fala ? 96 : 3
  const ts = Math.round((t * 48) / 1000)
  f.socket.send(pacote(f, Buffer.alloc(tamanho, 0x55), ts, false), f.porta, "127.0.0.1")
  f.proximo += f.fala ? 20000 : 400000
}

function enviarImagem(f, t) {
  // A VP8 image split into packets of ≤1150 B, with the descriptor Chrome
  // writes (X=1, I=1, M=1: picture ID of 15 bits). Keyframe of
  // 2 em 2 segundos; it is the first bit of the payload after the descriptor that
  // marks it (P=0), and the worker uses it to let consumers start.
  const bytes = Math.round(f.bitrate / 8 / f.fps)
  const chave = f.imagem % (2 * f.fps) === 0
  const ts = Math.round((t * 90) / 1000)
  const n = Math.max(1, Math.ceil(bytes / MTU))
  const porPacote = Math.ceil(bytes / n)
  for (let i = 0; i < n; i++) {
    const p = Buffer.alloc(4 + porPacote, 0xaa)
    p[0] = 0x80 | (i === 0 ? 0x10 : 0) // X, and S only on the first.
    p[1] = 0x80 // I
    p[2] = 0x80 | ((f.picId >> 8) & 0x7f)
    p[3] = f.picId & 0xff
    if (i === 0) p[4] = chave ? 0x00 : 0x01
    f.socket.send(pacote(f, p, ts, i === n - 1), f.porta, "127.0.0.1")
  }
  f.picId = (f.picId + 1) & 0x7fff
  f.imagem++
  f.proximo += 1e6 / f.fps
}

setInterval(() => {
  const t = agoraUs()
  for (const f of fluxos) {
    // Catches up on timer delays, but without bursts: at most 3 at a time.
    for (let k = 0; k < 3 && f.proximo <= t; k++) {
      if (f.tipo === "voz") enviarVoz(f, t)
      else enviarImagem(f, t)
    }
    if (f.proximo <= t) f.proximo = t
  }
}, 2)
