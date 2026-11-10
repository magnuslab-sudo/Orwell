import type { Payload, UserAddress } from "@enclave/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Connected and silent.
 *
 * Report from the owner on 13 August 2026, minutes after the first: "it appears
 * connected but I stop hearing and vice versa". Connected and soundless is not
 * signaling, it is misaligned media encryption. One side speaks in clear, the
 * other only knows how to listen encrypted, and what arrives is noise that no
 * one decrypts. The phrase "a connected, perfectly silent call" was already
 * written in `call.ts`, about the same trap elsewhere.
 *
 * Each person's encryption capability is learned from their `voice.join`
 * announcement. In that announcement handler it was written BEFORE the `#drop`
 * that clears the previous life, and `#drop` erases everything known about that
 * person, including this. The next pair arrived with "no encryption" about
 * someone who encrypts everything. On the other side, the microphone state is
 * recorded AFTER `#drop`, with a comment explaining exactly this rule: the
 * `sframe` ended up on the wrong side of it.
 *
 * It only showed up on LEAVING AND REJOINING, because that is when `#drop` runs
 * in the middle of announcement handling.
 *
 * Separate file because the decision to encrypt depends on the engine knowing
 * how to do it, and that is read ONCE when the module loads. The engine must
 * be faking it before the `import`.
 */

// The engine knows how to encrypt, read at module load, so it comes first.
/**
 * A sender that knows how to encrypt, and whose streams can be piped.
 *
 * `createEncodedStreams` returns a pair that the real code connects with
 * `pipeThrough`; returning empty objects would break deep in there, far from
 * here.
 */
class RTCRtpSenderFalso {
  /**
   * How many times encryption was actually hooked on a sender.
   *
   * Counted, not presumed: it is the only way to tell "did not set up any sender"
   * from "set up one with a borrowed counter". Both give the same call standing
   * and the same log warning, and the second repeats nonces, which in AES-GCM is
   * not a weakness, it is a break. Without this count the test passed with the
   * defect inside, and it did: the mutation suite caught it.
   */
  static instalacoes = 0

  createEncodedStreams(): unknown {
    RTCRtpSenderFalso.instalacoes += 1
    return {
      readable: { pipeThrough: () => ({ pipeTo: () => Promise.resolve() }) },
      writable: {},
    }
  }
}
vi.stubGlobal("RTCRtpSender", RTCRtpSenderFalso)

const { Call } = await import("./call.js")
type Call = InstanceType<typeof Call>
type CallBridge = ConstructorParameters<typeof Call>[0]

class FakePeerConnection {
  static instances: FakePeerConnection[] = []

  localDescription: { type: string; sdp: string } | null = null
  remoteDescription: { type: string; sdp: string } | null = null
  connectionState = "new"
  closed = false

  ontrack: ((event: unknown) => void) | null = null
  onicecandidate: ((event: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null

  constructor(public config: { encodedInsertableStreams?: boolean }) {
    FakePeerConnection.instances.push(this)
  }

  addTrack(): unknown {
    return new RTCRtpSenderFalso()
  }

  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: "offer", sdp: "sdp-offer" }
  }

  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: "answer", sdp: "sdp-answer" }
  }

  async setLocalDescription(descricao: { type: string; sdp: string }): Promise<void> {
    this.localDescription = descricao
  }

  async setRemoteDescription(descricao: { type: string; sdp: string }): Promise<void> {
    this.remoteDescription = descricao
  }

  async addIceCandidate(): Promise<void> {}

  getReceivers(): unknown[] {
    return []
  }

  getSenders(): unknown[] {
    return [new RTCRtpSenderFalso()]
  }

  close(): void {
    this.closed = true
    this.connectionState = "closed"
  }

  ligar(): void {
    this.connectionState = "connected"
    this.onconnectionstatechange?.()
  }
}

function fakeStream(): MediaStream {
  const faixa = {
    kind: "audio",
    enabled: true,
    stop(): void {},
    applyConstraints: async (): Promise<void> => {},
    getSettings: () => ({}),
  } as unknown as MediaStreamTrack
  return {
    getTracks: () => [faixa],
    getAudioTracks: () => [faixa],
    getVideoTracks: () => [],
    addTrack(): void {},
    removeTrack(): void {},
  } as unknown as MediaStream
}

beforeEach(() => {
  FakePeerConnection.instances = []
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  vi.stubGlobal("RTCRtpSender", RTCRtpSenderFalso)
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => fakeStream() } })
  vi.stubGlobal(
    "MediaStream",
    class {
      getTracks(): unknown[] {
        return []
      }
      addTrack(): void {}
    },
  )
})

const CANAL = "!geral:s"
const SALA = "voz"
const ANA = "@ana:s" as UserAddress
const BRUNO = "@bruno:s" as UserAddress
const CARLA = "@carla:s" as UserAddress

/** Three clients on a bus with immediate and awaited delivery. */
function sala(enderecos: UserAddress[]): Map<UserAddress, Call> {
  const chamadas = new Map<UserAddress, Call>()
  for (const endereco of enderecos) {
    const bridge = {
      selfAddress: endereco,
      async sendSignal(canal: string, payload: Payload) {
        for (const [outro, chamada] of chamadas) {
          if (outro === endereco) continue
          await chamada.handleSignal(canal, endereco, payload)
        }
      },
      async mediaKey() {
        return { keyId: 1, senderId: 0, material: new Uint8Array(28) }
      },
      async reservarContadorSframe() {
        return 0
      },
    } as unknown as CallBridge
    chamadas.set(endereco, new Call(bridge))
  }
  return chamadas
}

/**
 * The connections built to talk IN CLEAR.
 *
 * The decision to encrypt appears in the `encodedInsertableStreams` of the
 * config, that is what we want to measure, not the participant's `encrypted`,
 * which only becomes true when the transformations are actually installed.
 */
function emClaro(): FakePeerConnection[] {
  return FakePeerConnection.instances.filter((ligacao) => !ligacao.config.encodedInsertableStreams)
}

describe("a cifra de media sobrevive à limpeza da vida anterior", () => {
  it("na primeira entrada, os três constroem tudo cifrado", async () => {
    const chamadas = sala([ANA, BRUNO, CARLA])
    for (const chamada of chamadas.values()) await chamada.join(CANAL, { room: SALA })

    expect(emClaro()).toHaveLength(0)
  })

  it("e depois de alguém sair e voltar, continuam", async () => {
    const chamadas = sala([ANA, BRUNO, CARLA])
    for (const chamada of chamadas.values()) await chamada.join(CANAL, { room: SALA })
    for (const ligacao of FakePeerConnection.instances) if (!ligacao.closed) ligacao.ligar()

    // From here on, any new connection must be born encrypted like the others. One
    // that is born in clear is the connected and silent call.
    FakePeerConnection.instances = []

    const bruno = chamadas.get(BRUNO)!
    await bruno.leave()
    await bruno.join(CANAL, { room: SALA })

    expect(FakePeerConnection.instances.length, "não se construiu ligação nenhuma").toBeGreaterThan(0)
    expect(emClaro(), `${emClaro().length} ligações nasceram em claro`).toHaveLength(0)
  })
})

/**
 * A counter reservation that fails cannot borrow from another key.
 *
 * The block that chooses the starting counter exists to prevent nonce
 * repetition: the key derives from the epoch and the leaf index, which survive
 * closing the app, so starting at zero would repeat all nonces from the
 * previous call. In AES-GCM that reveals the XOR of the texts and lets forging
 * authenticated frames. The patch for a failed reservation was to inherit the
 * counter from the sender that was set up. But that sender only reaches that
 * point when the material is DIFFERENT, when it is the same it is returned
 * intact much earlier. That is: the borrowed counter always belonged to another
 * key. Channel A is at five thousand, we pass through channel B at three
 * hundred, we go back to A in the same epoch, the reservation fails, and we
 * restart at three hundred with A's key.
 *
 * Without a safe counter we do not set up a sender: the call stays without
 * media encryption, protected by transport, and the interface says what it is.
 * A confidentiality break that no one sees is worse, and cannot be undone.
 */
describe("a reserva do contador SFrame", () => {
  it("falhando, não monta emissor nenhum em vez de emprestar um contador", async () => {
    let reservar = async (): Promise<number> => 0
    /*
      The material CHANGES between the two phases, and it must change.

      `#sharedSender` returns the set up sender untouched when the material is
      the same, it is that comparison that prevents reusing a channel's key in
      another. With constant material, the reservation never got called and the
      test measured nothing.
    */
    let chave = 7
    const chamadas = new Map<UserAddress, Call>()
    const bridge = {
      selfAddress: ANA,
      async sendSignal() {},
      async mediaKey() {
        return { keyId: 1, senderId: 0, material: new Uint8Array(28).fill(chave) }
      },
      reservarContadorSframe: () => reservar(),
    } as unknown as CallBridge
    const ana = new Call(bridge)
    chamadas.set(ANA, ana)

    const avisos: string[] = []
    ana.on("diagnostic", (evento) => avisos.push(evento.code))

    // With a good reservation, the connection is born encrypted.
    await ana.join(CANAL, { room: SALA })
    await ana.handleSignal(CANAL, BRUNO, {
      t: "voice.join",
      at: 1,
      video: false,
      sframe: true,
      alone: true,
      room: SALA,
    } as never)
    expect(emClaro(), "com reserva boa, tudo cifrado").toHaveLength(0)

    // Now the reservation stops working. No borrowed counters.
    await ana.leave()
    FakePeerConnection.instances = []
    const instalacoesAntes = RTCRtpSenderFalso.instalacoes
    chave = 9
    reservar = async () => {
      throw new Error("cofre trancado")
    }
    await ana.join(CANAL, { room: SALA })
    await ana.handleSignal(CANAL, CARLA, {
      t: "voice.join",
      at: 2,
      video: false,
      sframe: true,
      alone: true,
      room: SALA,
    } as never)

    expect(avisos, "e diz porquê, em vez de se calar").toContain("sframe-reserva-falhou")

    /*
      And it did not hook any encryption, which is the half that was missing.

      The warning alone does not tell the two possible outcomes apart: not set up
      a sender (what we want) and set up one with the counter from the previous
      sender, which by construction belongs to a DIFFERENT key. Both give the
      same call standing and the same log warning. The second repeats nonces, and
      in AES-GCM that reveals the XOR of the texts and lets forging authenticated
frames.
      
      This test passed with the defect inside. The mutation `contador-emprestado`
      from the Phase 2 suite caught it, and that is why the suite exists.
    */
    expect(RTCRtpSenderFalso.instalacoes, "sem contador seguro não se monta emissor").toBe(instalacoesAntes)
  })
})
