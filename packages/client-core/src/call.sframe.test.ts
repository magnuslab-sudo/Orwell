import { importSframeKey, SframeReceiver, SframeSender } from "@enclave/crypto"
import type { Payload, UserAddress } from "@enclave/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CallBridge, MediaKeyMaterial } from "./call.js"

/**
 * The media key, when the channel changes and when the epoch changes.
 *
 * Separate file from `call.test.ts` for a technical reason: `mediaIsE2EE()`
 * is evaluated once, when `call.ts` is loaded, and reads
 * `RTCRtpSender.prototype`. A `vi.stubGlobal` inside a `beforeEach` arrives
 * too late, the module has already decided that this engine cannot encrypt media, and the
 * entire SFrame path remains untested. So the global is set up before
 * the module exists and the import is dynamic.
 */

vi.stubGlobal(
  "RTCRtpSender",
  class {
    createEncodedStreams(): void {
      throw new Error("cada emissor recebe o seu par de fluxos")
    }
  },
)

/**
 * Count how many SFrame senders are built.
 *
 * "One sender per key, shared by all tracks and all pairs" is a cryptographic invariant,
 * not a matter of housekeeping, and there is no way to observe it from outside: the
 * second sender replaces the first and the counter sequence looks sound again. Only by
 * counting the builds do you see the repetition.
 */
const contagem = vi.hoisted(() => ({ emissores: 0 }))

vi.mock("@enclave/crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("@enclave/crypto")>()
  return {
    ...real,
    SframeSender: class extends real.SframeSender {
      constructor(key: import("@enclave/crypto").SframeKey) {
        super(key)
        contagem.emissores++
      }
    },
  }
})

const emissoresConstruidos = (): number => contagem.emissores

const { Call } = await import("./call.js")

const ALICE = "@alice:enclave.test" as UserAddress
const BRUNO = "@bruno:enclave.test" as UserAddress
const CANAL = "!geral:enclave.test"
const OUTRO = "!outro:enclave.test"

/** ALICE's sender and BRUNO's sender have different leaves in the MLS tree. */
const FOLHA_ALICE = 3
const FOLHA_BRUNO = 5

/** A pair of encoded streams, with both ends in the test's hands. */
function fluxos(): {
  readable: ReadableStream<{ data: ArrayBuffer }>
  writable: WritableStream<{ data: ArrayBuffer }>
  empurrar: (bytes: Uint8Array) => void
  saida: Uint8Array[]
} {
  const saida: Uint8Array[] = []
  let controlador!: ReadableStreamDefaultController<{ data: ArrayBuffer }>
  const readable = new ReadableStream<{ data: ArrayBuffer }>({
    start(controller) {
      controlador = controller
    },
  })
  const writable = new WritableStream<{ data: ArrayBuffer }>({
    write(frame) {
      saida.push(new Uint8Array(frame.data))
    },
  })
  return {
    readable,
    writable,
    saida,
    empurrar: (bytes) => controlador.enqueue({ data: bytes.slice().buffer as ArrayBuffer }),
  }
}

/** Waits for the pipeline to settle, without guessing how many microtasks are needed. */
async function assentar(quantos: () => number, esperado: number): Promise<void> {
  for (let volta = 0; volta < 500 && quantos() < esperado; volta++) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = []

  localDescription: { type: string; sdp: string } | null = null
  remoteDescription: { type: string; sdp: string } | null = null
  connectionState = "new"
  closed = false
  /** The streams of the sender for each track added. */
  emissores: ReturnType<typeof fluxos>[] = []

  ontrack: ((event: unknown) => void) | null = null
  onicecandidate: ((event: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null

  constructor(public config: unknown) {
    FakePeerConnection.instances.push(this)
  }

  addTrack(): unknown {
    const par = fluxos()
    this.emissores.push(par)
    return { createEncodedStreams: () => ({ readable: par.readable, writable: par.writable }) }
  }

  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: "offer", sdp: "v=0\r\no=- oferta\r\n" }
  }

  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: "answer", sdp: "v=0\r\no=- resposta\r\n" }
  }

  async setLocalDescription(description: { type: string; sdp: string }): Promise<void> {
    this.localDescription = description
  }

  async setRemoteDescription(description: { type: string; sdp: string }): Promise<void> {
    this.remoteDescription = description
  }

  async addIceCandidate(): Promise<void> {}

  close(): void {
    this.closed = true
  }

  emitConnected(): void {
    this.connectionState = "connected"
    this.onconnectionstatechange?.()
  }

  /** Delivers a remote track, with the receiver's stream pair in the test's hands. */
  emitRemoteTrack(): ReturnType<typeof fluxos> {
    const par = fluxos()
    this.ontrack?.({
      streams: [{ getVideoTracks: () => [] } as unknown as MediaStream],
      receiver: { createEncodedStreams: () => ({ readable: par.readable, writable: par.writable }) },
    })
    return par
  }
}

function faixa(): MediaStreamTrack {
  return { kind: "audio", enabled: true, stop: vi.fn() } as unknown as MediaStreamTrack
}

beforeEach(() => {
  FakePeerConnection.instances = []
  contagem.emissores = 0
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => {
        const faixas = [faixa()]
        return {
          getTracks: () => faixas,
          getAudioTracks: () => faixas,
          getVideoTracks: () => [],
        } as unknown as MediaStream
      },
    },
  })
})

/** 28 bytes of material: 16 of key, 12 of salt. Distinct per label. */
function material(marca: number): Uint8Array {
  return new Uint8Array(28).fill(marca)
}

/** A bridge whose key material the test provides. */
function ponte(
  chave: (channel: string, address: UserAddress) => MediaKeyMaterial | null,
): CallBridge & { sent: Payload[] } {
  const sent: Payload[] = []
  return {
    selfAddress: ALICE,
    sent,
    async sendSignal(_channel, payload) {
      sent.push(payload)
    },
    async mediaKey(channel, address) {
      return chave(channel, address)
    },
    /**
     * The counter reservation, which this bridge did not have.
     *
     * Does what the real one does: returns the start of a new block, always larger than
     * any already delivered for the same key. It is what prevents a recreated sender
     * from repeating the nonces of the previous one.
     *
     * Without this, the call to `reservarContadorSframe` would crash with "not a function"
     * and fall into a `catch` that set the counter to zero, that is, all cipher tests
     * ran through the exception path, and the path the app uses for real was not exercised
     * by any. The `catch` masked an incomplete bridge; when we tightened it, six tests
     * surfaced all at once.
     */
    async reservarContadorSframe(channel, keyId) {
      const chaveDoBloco = `${channel}|${keyId}`
      const proximo = (reservas.get(chaveDoBloco) ?? 0) + 1
      reservas.set(chaveDoBloco, proximo)
      return proximo * 1_000_000
    },
  }
}

/** Blocks already delivered, by channel and key. See `reservarContadorSframe`. */
const reservas = new Map<string, number>()

/** Puts Alice on a call with Bruno and returns the connection already connected. */
async function emChamada(
  call: InstanceType<typeof Call>,
  canal: string,
): Promise<FakePeerConnection> {
  await call.join(canal)
  await call.handleSignal(canal, BRUNO, { t: "voice.join", at: Date.now(), video: false, sframe: true, alone: true })
  const ligacao = FakePeerConnection.instances.at(-1) as FakePeerConnection
  ligacao.emitConnected()
  return ligacao
}

describe("chave de media entre canais", () => {
  /**
   * The SFrame sender was keyed by `keyId` and `senderId`, nothing else.
   *
   * `keyId` is the MLS group epoch truncated to 16 bits, and each channel owns
   * its group: two channels at epoch 7 share the same `keyId`, and the same
   * person can occupy the same leaf in both. Leaving one call and joining
   * another under these conditions reused the sender from the previous channel,
   * with the previous channel's key. Everyone in the new channel received frames
   * that decrypt to garbage: they arrive, fail the tag check, get dropped, and
   * the call goes silent with no error anywhere.
   *
   * What identifies a key is not the epoch number: it is the key material.
   */
  it("não cifra a chamada de um canal com a chave de outro", async () => {
    // Same epoch, same leaf, different channels: different key material.
    const bridge = ponte((channel, address) => ({
      keyId: 7,
      senderId: address === ALICE ? FOLHA_ALICE : FOLHA_BRUNO,
      material: material(channel === CANAL ? 0xa1 : 0xb2),
    }))
    const alice = new Call(bridge)

    const primeira = await emChamada(alice, CANAL)
    const emissorA = primeira.emissores[0] as ReturnType<typeof fluxos>
    emissorA.empurrar(new Uint8Array([1, 2, 3, 4]))
    await assentar(() => emissorA.saida.length, 1)

    const receptorA = new SframeReceiver(await importSframeKey(material(0xa1), 7, FOLHA_ALICE))
    expect(await receptorA.decrypt(emissorA.saida[0] as Uint8Array<ArrayBuffer>)).toBeDefined()

    await alice.leave()
    const segunda = await emChamada(alice, OUTRO)
    const emissorB = segunda.emissores[0] as ReturnType<typeof fluxos>
    emissorB.empurrar(new Uint8Array([5, 6, 7, 8]))
    await assentar(() => emissorB.saida.length, 1)

    // The new channel must be encrypted with the new channel's key.
    const receptorB = new SframeReceiver(await importSframeKey(material(0xb2), 7, FOLHA_ALICE))
    expect(await receptorB.decrypt(emissorB.saida[0] as Uint8Array<ArrayBuffer>)).toBeDefined()
  })

  /**
   * And the opposite still holds, which is what prevents a real disaster.
   *
   * Two calls in the SAME channel and at the SAME epoch use the same key. A
   * new sender resets its counter to zero and repeats every nonce from the
   * previous call. In GCM that is not a weakness, it is a break. The sender
   * must stay the same as long as the key material stays the same.
   */
  it("mantém o mesmo contador quando a chave não mudou", async () => {
    const bridge = ponte((_channel, address) => ({
      keyId: 7,
      senderId: address === ALICE ? FOLHA_ALICE : FOLHA_BRUNO,
      material: material(0xa1),
    }))
    const alice = new Call(bridge)

    const primeira = await emChamada(alice, CANAL)
    const emissorA = primeira.emissores[0] as ReturnType<typeof fluxos>
    emissorA.empurrar(new Uint8Array([1, 2, 3, 4]))
    await assentar(() => emissorA.saida.length, 1)

    await alice.leave()
    const segunda = await emChamada(alice, CANAL)
    const emissorB = segunda.emissores[0] as ReturnType<typeof fluxos>
    emissorB.empurrar(new Uint8Array([5, 6, 7, 8]))
    await assentar(() => emissorB.saida.length, 1)

    // The counter lives in bytes 4..10 of the header. Repeating zero would be
    // the same nonce again, with the same key.
    const contador = (frame: Uint8Array): number => new DataView(frame.buffer, frame.byteOffset).getUint16(8, false)
    expect(contador(emissorA.saida[0] as Uint8Array)).toBe(0)
    expect(contador(emissorB.saida[0] as Uint8Array)).toBe(1)
  })
})

describe("um só emissor por chave", () => {
  /**
   * Two pairs born at the same time created two senders for the same key.
   *
   * This happens normally when someone joins a call that already has two people:
   * they hear both announcements nearly at once and build both connections in
   * parallel. `#sharedSender` checks if a sender already exists AFTER waiting
   * for `mediaKey`, and during that wait both constructions fit in: both find the
   * field empty and both create a sender. The key is the same, from the same MLS
   * exporter, and each sender starts its counter at zero.
   *
   * The SFrame nonce is salt XOR counter. Two senders with the same key and the
   * same counter encrypt different plaintexts with the same nonce, and in AES-GCM
   * that is not a weakness: it leaks the XOR of the two frames and gives the GHASH
   * subkey, with which one forges authenticated frames. This is the bug that the
   * comment in `#sframeSender` says in capitals cannot exist.
   *
   * None of this shows from outside. Connections establish, sound plays, and a
   * load race with eight people scores 56/56.
   */
  it("não cria dois emissores quando duas ligações nascem ao mesmo tempo", async () => {
    const CARLA = "@carla:enclave.test" as UserAddress
    const bridge = ponte((_channel, address) => ({
      keyId: 7,
      senderId: address === ALICE ? FOLHA_ALICE : FOLHA_BRUNO,
      material: material(0xa1),
    }))
    // Both derivations finish at the same moment. This happens in the browser,
    // where `mediaKey` is a chain of HKDF over the MLS exporter: two derivations
    // launched together interleave on each await and exit together. Without this
    // the test is not deterministic: the first reaches the end within the same
    // microtask drain and the second already finds the sender made.
    const original = bridge.mediaKey.bind(bridge)
    let abrir!: () => void
    const porta = new Promise<void>((resolve) => (abrir = resolve))
    bridge.mediaKey = async (channel, address) => {
      await porta
      return original(channel, address)
    }

    const alice = new Call(bridge)
    await alice.join(CANAL)

    // The two announcements arrive together, and both connections are born in parallel.
    const ambas = Promise.all([
      alice.handleSignal(CANAL, BRUNO, { t: "voice.join", at: Date.now(), video: false, sframe: true, alone: true }),
      alice.handleSignal(CANAL, CARLA, { t: "voice.join", at: Date.now(), video: false, sframe: true, alone: true }),
    ])
    await new Promise((resolve) => setTimeout(resolve, 20))
    abrir()
    await ambas

    // Count the senders built, not the frame counters: the second sender replaces
    // the first in the shared field, and after that frames look like a healthy
    // sequence again. What stays broken is the handful of frames that left while
    // the first sender was alive, encrypted with counter zero just like the ones
    // the second sender encrypted next. One repetition is enough.
    expect(emissoresConstruidos()).toBe(1)
  })
})

describe("o que o par sabe fazer", () => {
  /**
   * Media encryption capability is stated at each join and is not inherited.
   *
   * `#peerSframe` survived the call. The same person who appeared from a
   * Chromium that morning could come back in the afternoon from Firefox, or
   * from a different channel, and we kept encrypting their media based on what
   * they said last time. Each frame arrives, fails the tag check, gets dropped:
   * call connected, face on screen, absolute silence. Being wrong on the side
   * of "does not know" costs a call protected only by transport, which is bad.
   * Being wrong on this side costs a call that does not exist.
   */
  it("não herda da chamada anterior a capacidade de um par", async () => {
    const bridge = ponte((_channel, address) => ({
      keyId: 7,
      senderId: address === ALICE ? FOLHA_ALICE : FOLHA_BRUNO,
      material: material(0xa1),
    }))
    const alice = new Call(bridge)

    // On the first call Bruno announces he can encrypt.
    await emChamada(alice, CANAL)
    await alice.leave()

    // On the second he sends from a client that does not state what it can do,
    // because the field is optional in the protocol, precisely because old clients lack it.
    await alice.join(OUTRO)
    await alice.handleSignal(OUTRO, BRUNO, { t: "voice.offer", to: ALICE, sdp: "v=0" })

    const ligacao = FakePeerConnection.instances.at(-1) as FakePeerConnection
    expect((ligacao.config as { encodedInsertableStreams?: boolean }).encodedInsertableStreams).toBeUndefined()
  })
})

describe("o epoch muda a meio da chamada", () => {
  /**
   * The media key never rotated with the epoch, contrary to what the comment said.
   *
   * `mediaKey` derives from the current epoch's MLS exporter, and the comment in
   * `Session.mediaKey` promises that "someone removed from the channel mid-call
   * cannot decrypt what comes next". This was not true: the SFrame sender is
   * chosen once, when the track is added to the connection, and the
   * `TransformStream` that encrypts each frame stayed locked to it forever. A
   * removal mid-call advanced the epoch and changed not a single byte of what
   * went on the wire. Whoever had been removed kept hearing everything, with the
   * key they already had.
   */
  it("passa a cifrar com a chave nova, e a antiga deixa de servir", async () => {
    let epoch = 7
    const bridge = ponte((_channel, address) => ({
      keyId: epoch,
      senderId: address === ALICE ? FOLHA_ALICE : FOLHA_BRUNO,
      material: material(epoch),
    }))
    const alice = new Call(bridge)

    const ligacao = await emChamada(alice, CANAL)
    const emissor = ligacao.emissores[0] as ReturnType<typeof fluxos>

    emissor.empurrar(new Uint8Array([1, 1, 1, 1]))
    await assentar(() => emissor.saida.length, 1)

    // Someone is removed from the channel: the group advances epochs.
    epoch = 8
    await alice.rekey(CANAL)

    emissor.empurrar(new Uint8Array([2, 2, 2, 2]))
    await assentar(() => emissor.saida.length, 2)

    const depois = emissor.saida[1] as Uint8Array<ArrayBuffer>
    const antigo = new SframeReceiver(await importSframeKey(material(7), 7, FOLHA_ALICE))
    const novo = new SframeReceiver(await importSframeKey(material(8), 8, FOLHA_ALICE))

    // Whoever kept the old key cannot decrypt what comes next.
    expect(await antigo.decrypt(depois)).toBeUndefined()
    expect(await novo.decrypt(depois)).toBeDefined()
  })

  /**
   * On the receiving side, rotation cannot cut the sound.
   *
   * The receiver was created when the remote track arrived and locked to the
   * epoch at that moment. As soon as the other side rotated, all frames started
   * failing the `keyId` check and got dropped silently: the call stayed
   * "connected", with both faces on screen, and no sound until someone hung up.
   */
  it("continua a decifrar quem já rodou, e o que ainda vinha a caminho da chave anterior", async () => {
    let epoch = 7
    const bridge = ponte((_channel, address) => ({
      keyId: epoch,
      senderId: address === ALICE ? FOLHA_ALICE : FOLHA_BRUNO,
      material: material(epoch),
    }))
    const alice = new Call(bridge)

    const ligacao = await emChamada(alice, CANAL)
    const receptor = ligacao.emitRemoteTrack()
    await assentar(() => 1, 1)

    const brunoAntes = new SframeSender(await importSframeKey(material(7), 7, FOLHA_BRUNO))
    const emVoo = await brunoAntes.encrypt(new Uint8Array([9, 9, 9, 9]) as Uint8Array<ArrayBuffer>)

    epoch = 8
    await alice.rekey(CANAL)

    const brunoDepois = new SframeSender(await importSframeKey(material(8), 8, FOLHA_BRUNO))
    receptor.empurrar(await brunoDepois.encrypt(new Uint8Array([1, 2, 3, 4]) as Uint8Array<ArrayBuffer>))
    await assentar(() => receptor.saida.length, 1)
    expect(Array.from(receptor.saida[0] ?? [])).toEqual([1, 2, 3, 4])

    // The frame already on the wire when the key changed is still good.
    receptor.empurrar(emVoo)
    await assentar(() => receptor.saida.length, 2)
    expect(Array.from(receptor.saida[1] ?? [])).toEqual([9, 9, 9, 9])
  })

  /**
   * And whoever was removed from the channel leaves the call.
   *
   * Rotating the key stops them from hearing what comes next, but the connection
   * itself stayed up: their tile stayed on everyone's screen and their microphone
   * still arrived here. `mediaKey` returns `null` for someone no longer on the
   * channel tree, which is exactly the question "are you still a member?"
   * The answer must hold for the call too.
   */
  it("deita fora o par que deixou de ser membro do canal", async () => {
    let membro = true
    const bridge = ponte((_channel, address) => {
      if (address === BRUNO && !membro) return null
      return { keyId: membro ? 7 : 8, senderId: address === ALICE ? FOLHA_ALICE : FOLHA_BRUNO, material: material(7) }
    })
    const alice = new Call(bridge)

    const ligacao = await emChamada(alice, CANAL)
    let participantes = 1
    alice.on("participants", (evento) => (participantes = evento.participants.length))

    membro = false
    await alice.rekey(CANAL)

    expect(participantes).toBe(0)
    expect(ligacao.closed).toBe(true)
  })
})

/**
 * Encrypt the same sender twice.
 *
 * `createEncodedStreams()` delivers the encoded streams of one sender ONCE.
 * On the second call Chromium throws `InvalidStateError`. Today this does not
 * happen by design luck: `#buildPeer` walks the tracks once and each track
 * brings its own sender. The luck ends at screen share: the design reserves a
 * video transceiver upfront and swaps its track with `replaceTrack`, which
 * keeps the SAME sender and brings it back to `#protectSender`. Without a guard,
 * the second pass throws, `#buildPeer` rejects, and what you see is a person
 * who simply does not join the call.
 *
 * The connection below returns the same sender for all tracks, which is how
 * that reuse looks from inside `#protectSender`: a sender that already gave its
 * streams and shows up again.
 */
describe("um emissor que já foi cifrado", () => {
  class ConexaoDeEmissorReutilizado extends FakePeerConnection {
    static pedidos = 0
    static par: ReturnType<typeof fluxos> | null = null

    /** One sender for all tracks. See the header of this block. */
    #emissor = {
      createEncodedStreams: (): { readable: unknown; writable: unknown } => {
        ConexaoDeEmissorReutilizado.pedidos++
        if (ConexaoDeEmissorReutilizado.pedidos > 1) {
          // Word for word what Chromium throws.
          throw new Error("InvalidStateError: encoded streams already created")
        }
        const par = fluxos()
        ConexaoDeEmissorReutilizado.par = par
        return { readable: par.readable, writable: par.writable }
      },
    }

    override addTrack(): unknown {
      return this.#emissor
    }
  }

  it("não lhe volta a pedir os fluxos codificados, e continua a cifrar", async () => {
    ConexaoDeEmissorReutilizado.pedidos = 0
    ConexaoDeEmissorReutilizado.par = null
    vi.stubGlobal("RTCPeerConnection", ConexaoDeEmissorReutilizado)
    // Two tracks, microphone and camera, for the same sender to appear twice on
    // the loop through `#buildPeer`.
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => {
          const audio = faixa()
          const video = { kind: "video", enabled: true, stop: vi.fn() } as unknown as MediaStreamTrack
          return {
            getTracks: () => [audio, video],
            getAudioTracks: () => [audio],
            getVideoTracks: () => [video],
          } as unknown as MediaStream
        },
      },
    })

    const bridge = ponte((_channel, address) => ({
      keyId: 7,
      senderId: address === ALICE ? FOLHA_ALICE : FOLHA_BRUNO,
      material: material(0xc3),
    }))
    const alice = new Call(bridge)

    await alice.join(CANAL, { video: true })
    // Without a guard, this rejects: the second track asks the sender that already
    // gave them for the streams again.
    await expect(
      alice.handleSignal(CANAL, BRUNO, { t: "voice.join", at: Date.now(), video: true, sframe: true, alone: true }),
    ).resolves.toBeUndefined()

    expect(ConexaoDeEmissorReutilizado.pedidos).toBe(1)

    // And it is not a dropped cipher in silence, which would be the cheap way to
    // pass this test: what leaves the sender stays sealed.
    // TypeScript narrowed `par` to `null` by the assignment at the test start; the call changed it.
    const par = ConexaoDeEmissorReutilizado.par as ReturnType<typeof fluxos> | null
    if (!par) throw new Error("o emissor não chegou a dar os fluxos")
    par.empurrar(new Uint8Array([1, 2, 3, 4]))
    await assentar(() => par.saida.length, 1)
    const receptor = new SframeReceiver(await importSframeKey(material(0xc3), 7, FOLHA_ALICE))
    expect(await receptor.decrypt(par.saida[0] as Uint8Array<ArrayBuffer>)).toEqual(new Uint8Array([1, 2, 3, 4]))

    await alice.leave()
  })
})
