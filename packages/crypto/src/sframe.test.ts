import { describe, expect, it } from "vitest"
import { importSframeKey, readHeader, SframeReceiver, SframeSender } from "./sframe.js"

/**
 * SFrame had no tests at all, and the gap cost a real break: `Call` created one
 * `SframeSender` per media track and per peer connection. The key is derived
 * from the MLS exporter, so it is identical across all of them, and every sender
 * starts its counter at zero with the nonce being salt XOR counter. A plain 1:1
 * video call therefore encrypted audio and video under the same key with the
 * same nonces.
 *
 * Nonce reuse in AES-GCM is not a weakening. It reveals the XOR of the two
 * plaintexts and, through the "forbidden attack", allows recovery of the GHASH
 * authentication subkey — after which an attacker can forge frames that decrypt
 * and authenticate. These tests pin the invariant that fix depends on.
 */

const MATERIAL = new Uint8Array(64).fill(7)

async function key() {
  return importSframeKey(MATERIAL, 3, 1)
}

function countersOf(frames: Uint8Array[]): number[] {
  return frames.map((frame) => {
    const header = readHeader(frame)
    if (!header) throw new Error("frame without a readable header")
    return header.counter
  })
}

describe("SFrame counters", () => {
  it("one sender never repeats a counter, whatever it is asked to encrypt", async () => {
    const sender = new SframeSender(await key())
    const frames = []
    for (let i = 0; i < 50; i++) frames.push(await sender.encrypt(new Uint8Array([i])))

    const counters = countersOf(frames)
    expect(new Set(counters).size).toBe(counters.length)
    expect(counters).toEqual([...counters].sort((a, b) => a - b))
  })

  it("ONE sender shared by several streams keeps every counter distinct", async () => {
    // This is the shape `Call` uses now: audio and video, and every peer in the
    // mesh, all encrypt through the same sender.
    const shared = new SframeSender(await key())
    const audio = []
    const video = []
    for (let i = 0; i < 20; i++) {
      audio.push(await shared.encrypt(new Uint8Array([1, i])))
      video.push(await shared.encrypt(new Uint8Array([2, i])))
    }

    const all = countersOf([...audio, ...video])
    expect(new Set(all).size).toBe(all.length)
  })

  it("TWO senders on one key collide on every counter — the bug this guards against", async () => {
    // Kept as an executable statement of why the sender must be shared: if
    // someone reintroduces a per-track sender, the property above breaks and
    // this is the reason.
    const first = new SframeSender(await key())
    const second = new SframeSender(await key())

    const a = countersOf([await first.encrypt(new Uint8Array([1])), await first.encrypt(new Uint8Array([2]))])
    const b = countersOf([await second.encrypt(new Uint8Array([3])), await second.encrypt(new Uint8Array([4]))])

    expect(b).toEqual(a)
  })

  it("a receiver accepts a shared sender's stream in order and rejects a replay", async () => {
    const sender = new SframeSender(await key())
    const receiver = new SframeReceiver(await key())

    const first = await sender.encrypt(new Uint8Array([1, 2, 3]))
    const second = await sender.encrypt(new Uint8Array([4, 5, 6]))

    expect(await receiver.decrypt(first)).toEqual(new Uint8Array([1, 2, 3]))
    expect(await receiver.decrypt(second)).toEqual(new Uint8Array([4, 5, 6]))
    // Same frame again: refused, and refused without being handed to a decoder.
    expect(await receiver.decrypt(first)).toBeUndefined()
  })

  /**
   * The late keyframe, which is the screen freezing without a single error message.
   *
   * The counter is shared across all tracks of the sender, so the window counts
   * audio, camera and screen frames added together. A keyframe is ten to twenty
   * times larger than a normal frame and travels split across many packets, and
   * it is the first to arrive late on a lossy network. With the window at 128
   * (just over one second of call time), it arrived outside the window and was
   * rejected as a REPLAY of a frame nobody had ever seen. On the viewer's
   * side: the image stopped, and there is no error anywhere to explain it.
   */
  it("aceita um keyframe atrasado duzentos contadores, em vez de o tomar por repetição", async () => {
    const sender = new SframeSender(await key())
    const frames: Uint8Array<ArrayBuffer>[] = []
    for (let i = 0; i < 301; i += 1) frames.push(await sender.encrypt(new Uint8Array([i % 256])))

    const primeiro = frames[0]
    const atrasado = frames[100]
    const recente = frames[300]
    if (!primeiro || !atrasado || !recente) throw new Error("frames em falta")

    const receiver = new SframeReceiver(await key())
    expect(await receiver.decrypt(primeiro)).toBeDefined()
    // A jump: the rest of the batch was lost or is in flight.
    expect(await receiver.decrypt(recente)).toBeDefined()

    // And now what was left behind. A gap of two hundred counters is what a call
    // with three tracks burns through in seconds.
    expect(await receiver.decrypt(atrasado)).toEqual(new Uint8Array([100]))
    // And it is still rejected the second time: the window still protects.
    expect(await receiver.decrypt(atrasado)).toBeUndefined()
  })

  it("a receiver keyed to another epoch decrypts nothing", async () => {
    const sender = new SframeSender(await key())
    const otherEpoch = new SframeReceiver(await importSframeKey(MATERIAL, 4, 1))
    expect(await otherEpoch.decrypt(await sender.encrypt(new Uint8Array([9])))).toBeUndefined()
  })
})

/**
 * Close the app and come back: the same problem in different clothes.
 *
 * The shared sender solves the various streams of a call. It does not solve the
 * next startup: the key derives from the channel epoch and the leaf index in
 * the tree, and neither changes because a window closes. A new `SframeSender`
 * starting at zero would repeat, with the SAME key, all the nonces from the
 * previous call.
 *
 * And there was a second harm, the visible one: the receiver on the other side
 * rejects any counter it has already seen, and audio runs at fifty frames per
 * second, so the first thousands of counters in a call are all spent within a
 * minute. Anyone who reloaded midway went silent to those who stayed, with the
 * connection up and their tile on screen. Three people, and only two hear each other.
 */
describe("SFrame entre arranques da aplicação", () => {
  it("um emissor reconstruído a zero repete os nonces do anterior", async () => {
    const antes = new SframeSender(await key())
    for (let i = 0; i < 300; i += 1) await antes.encrypt(new Uint8Array([i % 256]))

    // The app closes and restarts. Same epoch, same leaf, same key.
    const depois = new SframeSender(await key())
    const repetido = countersOf([await depois.encrypt(new Uint8Array([1]))])

    expect(repetido[0]).toBe(0)
    expect(antes.counter).toBeGreaterThan(0)
  })

  it("e o outro lado deixa de o ouvir, que é o sintoma relatado", async () => {
    const antes = new SframeSender(await key())
    const receiver = new SframeReceiver(await key())
    for (let i = 0; i < 300; i += 1) {
      expect(await receiver.decrypt(await antes.encrypt(new Uint8Array([i % 256])))).toBeDefined()
    }

    // Rebuilt from zero: counter zero is among the 300 that the receiver already
    // accepted, and an already-accepted counter is, by definition, a replay.
    const azero = new SframeSender(await key())
    expect(await receiver.decrypt(await azero.encrypt(new Uint8Array([42])))).toBeUndefined()

    // And with the reservation, which is the fix: it starts above what was already
    // used, and is heard again right away.
    const reservado = new SframeSender(await key(), 1_000_000)
    expect(await receiver.decrypt(await reservado.encrypt(new Uint8Array([42])))).toEqual(new Uint8Array([42]))
  })

  it("dois arranques com blocos reservados nunca partilham um contador", async () => {
    const primeiro = new SframeSender(await key(), 0)
    const segundo = new SframeSender(await key(), 1_000_000)

    const a = countersOf([await primeiro.encrypt(new Uint8Array([1])), await primeiro.encrypt(new Uint8Array([2]))])
    const b = countersOf([await segundo.encrypt(new Uint8Array([3])), await segundo.encrypt(new Uint8Array([4]))])

    expect(a.some((contador) => b.includes(contador))).toBe(false)
  })
})

/**
 * The replay window has to fit a call with three streams.
 *
 * The counter belongs to the SENDER, not the track: a single sender encrypts
 * the microphone, the camera and, from screen sharing onwards, what is on the
 * monitor. Added up, that is about one hundred ten frames per second, so a
 * window of 128 covers just over one second of stream.
 *
 * One second is less than it takes the network to deliver a late keyframe, and
 * a keyframe is exactly the frame that gets delayed: it is ten to twenty times
 * larger than others and travels split across many packets. Arriving outside the
 * window, it is rejected as if it were a replay, with no error, no log,
 * nothing. On the viewer's side, the shared screen freezes at the last good
 * image and stays there until the next keyframe, which by the same path can also
 * be lost.
 *
 * Widening the window does not loosen anything: each counter is still accepted
 * once only. What changes is how much reordering the network can cause before
 * an honest frame starts being treated as an attack.
 */
describe("a janela de repetição e o keyframe atrasado", () => {
  it("aceita um frame legítimo entregue 500 contadores atrasado, e recusa-o à segunda", async () => {
    const sender = new SframeSender(await key())
    const receiver = new SframeReceiver(await key())

    // Encrypted first, delivered last: it is the keyframe that the encoder
    // produced and the network set aside while everything else went through.
    const atrasado = await sender.encrypt(new Uint8Array([0xff]))

    for (let i = 0; i < 500; i++) {
      expect(await receiver.decrypt(await sender.encrypt(new Uint8Array([i % 256])))).toBeDefined()
    }

    expect(await receiver.decrypt(atrasado)).toEqual(new Uint8Array([0xff]))
    // And what the window exists to prevent stays prevented: the SAME frame
    // again is a replay, wherever it falls within the window.
    expect(await receiver.decrypt(atrasado)).toBeUndefined()
  })

  it("mas um frame verdadeiramente antigo continua a ser recusado", async () => {
    // The window is a window, not an amnesty. With no limit, a hostile SFU could
    // reinject in the middle of the night what it recorded in the afternoon.
    const sender = new SframeSender(await key())
    const receiver = new SframeReceiver(await key())

    const antiquissimo = await sender.encrypt(new Uint8Array([0xfe]))
    for (let i = 0; i < SframeReceiver.WINDOW + 100; i++) {
      await receiver.decrypt(await sender.encrypt(new Uint8Array([i % 256])))
    }

    expect(await receiver.decrypt(antiquissimo)).toBeUndefined()
  })
})

/**
 * The window with THREE streams at once, which Phase 3 brought.
 *
 * The counter belongs to the SENDER, not the track: one `SframeSender` per
 * key, and the microphone, the camera and the screen all go through it. And on
 * the receiver side it is the same: one `SframeReceiver` per (person, key), with
 * frames from all three tracks coming through the same window, interleaved and
 * out of order, because they arrive over different RTP flows with different
 * jitter.
 *
 * The comment on `WINDOW` says 1024 "gives about nine seconds across the three
 * streams together". This measures it instead of asserting it, with the real
 * rates of this platform: microphone at 50 frames per second (Opus with `ptime`
 * of 20 ms), camera at 30, screen at 30 (`frameRate: { ideal: 30 }` in
 * `getDisplayMedia`, since 2 November 2026; it was 15).
 */
describe("a janela com o microfone, a câmara e o ecrã a passar pela mesma chave", () => {
  /** How many counters per second the three streams burn through together. */
  const POR_SEGUNDO = 50 + 30 + 30

  it("cobre mais de nove segundos dos três fluxos juntos", () => {
    // The arithmetic in the `WINDOW` comment, written as executable code: the day
    // someone lowers the window back to 128, where it was, this line says it now
    // covers just over one second, which is not enough for a late keyframe.
    expect(SframeReceiver.WINDOW / POR_SEGUNDO).toBeGreaterThan(9)
  })

  it("aceita um keyframe do ECRÃ atrasado dois segundos, com as três faixas a contar", async () => {
    /*
     * The case the window exists to handle, now with the traffic Phase 3 put on
     * the wire. A keyframe is ten to twenty times larger than a normal frame,
     * travels split across many packets and is the first to be delayed when bandwidth
     * tightens, and while it waits, the microphone and camera keep using up
     * counters from the SAME sequence. Outside the window, it is rejected as a
     * replay, silently: no error, no log, and the image frozen on the
     * viewer's screen.
     */
    const sender = new SframeSender(await key())
    const receiver = new SframeReceiver(await key())

    const keyframe = await sender.encrypt(new Uint8Array([0xaa]))

    // Two seconds of normal conversation going through ahead of it.
    const entretanto = POR_SEGUNDO * 2
    for (let i = 0; i < entretanto; i++) {
      expect(await receiver.decrypt(await sender.encrypt(new Uint8Array([i % 256])))).toBeDefined()
    }

    expect(await receiver.decrypt(keyframe)).toEqual(new Uint8Array([0xaa]))
  })

  it("e continua a recusar o mesmo keyframe reinjectado a seguir", async () => {
    // The window is a window, not an amnesty: a hostile SFU that kept the keyframe and
    // replayed it would put the same image on everyone's screen again. Accepting
    // late is not accepting twice.
    const sender = new SframeSender(await key())
    const receiver = new SframeReceiver(await key())

    const keyframe = await sender.encrypt(new Uint8Array([0xbb]))
    for (let i = 0; i < POR_SEGUNDO; i++) await receiver.decrypt(await sender.encrypt(new Uint8Array([i % 256])))

    expect(await receiver.decrypt(keyframe)).toBeDefined()
    expect(await receiver.decrypt(keyframe)).toBeUndefined()
  })

  it("aguenta as três faixas entrelaçadas e fora de ordem, sem perder um frame", async () => {
    /*
     * Three separate RTP streams arrive with different jitter, and what shows
     * in the window is the sender's sequence scrambled in blocks. This scrambles
     * a full second at a time, far more reordering than a real network
     * produces, and demands that EVERYTHING opens: a single lost frame here is
     * a click in the sound or a block of frozen image, and neither leaves a
     * trace.
     */
    const sender = new SframeSender(await key())
    const receiver = new SframeReceiver(await key())

    const cifrados: Uint8Array<ArrayBuffer>[] = []
    for (let i = 0; i < POR_SEGUNDO * 3; i++) cifrados.push(await sender.encrypt(new Uint8Array([i % 256])))

    let abertos = 0
    for (let bloco = 0; bloco < cifrados.length; bloco += POR_SEGUNDO) {
      // Reversed within each second: the worst possible reordering without
      // swapping order between seconds, which the network does not do either.
      const pedaco = cifrados.slice(bloco, bloco + POR_SEGUNDO).reverse()
      for (const frame of pedaco) if (await receiver.decrypt(frame)) abertos++
    }

    expect(abertos).toBe(cifrados.length)
  })
})
