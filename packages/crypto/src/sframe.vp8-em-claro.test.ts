import { describe, expect, it } from "vitest"
import { bytesEmClaroDoVp8, importSframeKey, readHeader, SframeReceiver, SframeSender } from "./sframe.js"

/**
 * The pixelated screen share (owner's report, 2 November 2026).
 *
 * The SFU (mediasoup) and Chrome's RTP unpacker decide if a packet starts a
 * keyframe by reading the FIRST byte of the VP8 frame: bit 0 at zero means keyframe
 * (RFC 6386, section 9.1; `RTC::RTP::Codecs::VP8::Parse` in mediasoup). With
 * the entire frame encrypted, that byte is the high byte of the SFrame `keyId`
 * header. In an epoch below 256 it is zero and ALL frames look like keyframes; between
 * 256 and 511, none do.
 *
 * The fix leaves in the clear the bytes VP8 puts at the front (10 on a keyframe, 3
 * on a differential), authenticates them as additional data, and puts the SFrame
 * header at the END.
 */

const MATERIAL = new Uint8Array(28).map((_, i) => i + 1)

/** A plausible VP8 frame: the 3-byte tag and, if it is a keyframe, the start code and dimensions. */
function vp8(chave: boolean, corpo = 200): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(corpo)
  for (let i = 0; i < corpo; i++) bytes[i] = (i * 13 + 5) & 0xff
  bytes[0] = chave ? 0x10 : 0x31 // bit 0: 0 keyframe, 1 differential
  if (chave) {
    bytes.set([0x9d, 0x01, 0x2a], 3)
    bytes.set([0x80, 0x07, 0x38, 0x04], 6) // 1920 x 1080
  }
  return bytes
}

async function par(keyId = 41, senderId = 3) {
  const chave = await importSframeKey(MATERIAL, keyId, senderId)
  return { sender: new SframeSender(chave), receiver: new SframeReceiver(chave) }
}

describe("o cabeçalho do VP8 em claro", () => {
  it("bytesEmClaroDoVp8: 10 num fotograma-chave, 3 num diferencial, nunca mais do que o fotograma", () => {
    expect(bytesEmClaroDoVp8(vp8(true))).toBe(10)
    expect(bytesEmClaroDoVp8(vp8(false))).toBe(3)
    expect(bytesEmClaroDoVp8(new Uint8Array([0x10, 1, 2, 3]))).toBe(4)
    expect(bytesEmClaroDoVp8(new Uint8Array(0))).toBe(0)
  })

  it("o SFU vê o bit de fotograma-chave VERDADEIRO em qualquer epoch", async () => {
    // The two halves of the bug: keyId 41 (high byte 0, everything looks like a keyframe) and
    // keyId 300 (high byte 1, nothing does).
    for (const keyId of [41, 300]) {
      const { sender } = await par(keyId)
      for (const chave of [true, false]) {
        const claro = vp8(chave)
        const cifrado = await sender.encrypt(claro, bytesEmClaroDoVp8(claro))
        const pareceChave = (cifrado[0]! & 0x01) === 0
        expect(pareceChave).toBe(chave)
        // And Chrome reads the dimensions of a keyframe from bytes 6 through 9.
        expect([...cifrado.subarray(0, bytesEmClaroDoVp8(claro))]).toEqual([...claro.subarray(0, bytesEmClaroDoVp8(claro))])
      }
    }
  })

  it("o formato antigo (fotograma inteiro cifrado) mostra ao SFU o byte do keyId, e não o do VP8", async () => {
    // Reproducing the bug, for the record: this is what 1.0.5 sends.
    const { sender: em41 } = await par(41)
    const { sender: em300 } = await par(300)
    const diferencial = vp8(false)
    const chave = vp8(true)
    expect(((await em41.encrypt(diferencial))[0]! & 0x01) === 0).toBe(true) // differential read as keyframe
    expect(((await em300.encrypt(chave))[0]! & 0x01) === 0).toBe(false) // keyframe read as differential
  })

  it("abre, e devolve o fotograma inteiro tal como era", async () => {
    const { sender, receiver } = await par()
    for (const chave of [true, false, true]) {
      const claro = vp8(chave)
      const aberto = await receiver.decrypt(await sender.encrypt(claro, bytesEmClaroDoVp8(claro)))
      expect(aberto && [...aberto]).toEqual([...claro])
    }
  })

  it("os bytes em claro estão autenticados: mexer-lhes recusa o fotograma", async () => {
    const { sender, receiver } = await par()
    const claro = vp8(true)
    const cifrado = await sender.encrypt(claro, bytesEmClaroDoVp8(claro))
    cifrado[7] = cifrado[7]! ^ 0x01 // different width
    expect(await receiver.decrypt(cifrado)).toBeUndefined()
  })

  it("readHeader lê o cabeçalho dos dois formatos", async () => {
    const { sender } = await par(41, 3)
    const claro = vp8(false)
    const novo = await sender.encrypt(claro, bytesEmClaroDoVp8(claro))
    const antigo = await sender.encrypt(claro)
    expect(readHeader(novo)).toEqual({ keyId: 41, senderId: 3, counter: 0 })
    expect(readHeader(antigo)).toEqual({ keyId: 41, senderId: 3, counter: 1 })
  })

  it("um receptor novo abre os fotogramas de um emissor 1.0.5 (formato antigo)", async () => {
    const { sender, receiver } = await par()
    const claro = vp8(true)
    const aberto = await receiver.decrypt(await sender.encrypt(claro))
    expect(aberto && [...aberto]).toEqual([...claro])
  })

  it("o som (sem bytes em claro) fica exactamente no formato de sempre", async () => {
    const { sender } = await par(41, 3)
    const voz = new Uint8Array([1, 2, 3, 4, 5]) as Uint8Array<ArrayBuffer>
    const cifrado = await sender.encrypt(voz, 0)
    // Header at the front, version 0 at byte 10: a 1.0.5 receiver opens it.
    expect(cifrado[10]).toBe(0)
    expect(readHeader(cifrado)).toEqual({ keyId: 41, senderId: 3, counter: 0 })
  })
})
