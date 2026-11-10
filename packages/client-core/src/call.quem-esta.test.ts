import { Payload, SALA_DA_PERGUNTA, type UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Call, ehPerguntaDePresenca, type CallBridge, type MediaKeyMaterial } from "./call.js"

/**
 * "Who is in the room?", and the answer.
 *
 * Report from the owner on October 5, 2026, after a call with other people:
 * **some people do not see who is in the room before they join.** It is not a
 * design flaw, it is what the architecture gives: the list of who is in a
 * voice room is made from the `voice.join` that this device HEARD, and those
 * who left before we connected are not recovered in the catch-up, because voice
 * signaling is only live (on purpose: replaying an announcement in the morning
 * would put the app negotiating with someone who disconnected hours ago).
 *
 * What existed was the server's presence warning: whoever joins is announced,
 * and whoever is in a call responds to that announcement by re-announcing
 * themselves. With a hole that is the report: **whoever joins invisible is not
 * announced to anyone**, and correctly so, invisible is invisible. For those,
 * the list only fills at the next heartbeat, which is 50 seconds away.
 *
 * The missing half is the symmetric one: whoever joins ASKS. One round trip, and
 * it works invisible, because the question is ours, not our announcement.
 *
 * What is pinned here is the design of the question, which is where it can break
 * old clients. See `quemEsta` in `voice.leave`, in the protocol, and
 * `scripts/e2e-cliente-antigo.mjs` for the proof against 0.3.3 running.
 */

// -------------------------------------------------------------------- stubs

class FakePeerConnection {
  static instances: FakePeerConnection[] = []
  localDescription: { type: string; sdp: string } | null = null
  connectionState = "new"
  closed = false
  ontrack: ((event: unknown) => void) | null = null
  onicecandidate: ((event: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  constructor() {
    FakePeerConnection.instances.push(this)
  }
  addTrack(): unknown {
    return {}
  }
  addTransceiver(): unknown {
    return { sender: {} }
  }
  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: "offer", sdp: "v=0\r\n" }
  }
  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: "answer", sdp: "v=0\r\n" }
  }
  async setLocalDescription(d: { type: string; sdp: string }): Promise<void> {
    this.localDescription = d
  }
  async setRemoteDescription(): Promise<void> {}
  async addIceCandidate(): Promise<void> {}
  close(): void {
    this.closed = true
  }
  emitConnected(): void {
    this.connectionState = "connected"
    this.onconnectionstatechange?.()
  }
}

/**
 * Connect ICE on open links.
 *
 * A newly built link does not enter the participant list by itself: `#buildPeer`
 * does not announce, and what announces is the state transition, a card that
 * appeared before there was a link promised a person who might never arrive. The
 * same reason and the same gesture as in `call.test.ts`.
 */
async function ligarTudo(): Promise<void> {
  for (const ligacao of FakePeerConnection.instances) if (!ligacao.closed) ligacao.emitConnected()
  await vi.advanceTimersByTimeAsync(0)
}

function fakeStream(): MediaStream {
  const audio = { kind: "audio", enabled: true, stop: vi.fn() }
  return {
    getTracks: () => [audio],
    getAudioTracks: () => [audio],
    getVideoTracks: () => [],
  } as unknown as MediaStream
}

const ALICE = "@alice-um-dois-tres:s" as UserAddress
const BRUNO = "@bruno-um-dois-tres:s" as UserAddress
const CANAL = "!geral:s"
const OUTRO = "!obras:s"

function ponte(selfAddress: UserAddress): CallBridge & { sent: { channel: string; payload: Payload }[] } {
  const sent: { channel: string; payload: Payload }[] = []
  return {
    selfAddress,
    sent,
    async sendSignal(channel, payload) {
      sent.push({ channel, payload })
    },
    async mediaKey(): Promise<MediaKeyMaterial | null> {
      return { keyId: 1, senderId: 0, material: new Uint8Array(28) }
    },
    async reservarContadorSframe(): Promise<number> {
      return 0
    },
  }
}

beforeEach(() => {
  FakePeerConnection.instances = []
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  vi.stubGlobal("RTCRtpSender", class {})
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => fakeStream() } })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("a forma da pergunta no fio", () => {
  it("é um campo num frame que já existia, e nunca um `t` novo", () => {
    /*
      The house rule, written five times in the protocol and with a concrete
      cost: a `t` that an old client does not know fails the ENTIRE union, the
      payload is discarded silently, counts as an ignored event, and consecutive
      ignored events declare the channel deaf and trigger repair, which is a
      remove followed by an add, meaning the channel's history disappears by
      persistent secrecy.
      
      A `voice.who` cost that. What is pinned here is what replaces it.
      */
    const pergunta = Payload.safeParse({ t: "voice.leave", at: Date.now(), quemEsta: true })
    expect(pergunta.success).toBe(true)
    expect(Payload.safeParse({ t: "voice.who", at: Date.now() }).success).toBe(false)
  })

  it("e um cliente que não conheça o campo lê-a como um `voice.leave` comum", () => {
    /*
      An old client's schema is this without the `quemEsta` line, and Zod throws
      away keys it does not know. We simulate by having today's schema read the
      frame without the field: what remains must be a valid `voice.leave`, the
      goodbye of someone who was never in the call, which is a non-event in all
      paths that touch it.
    */
    const lido = Payload.parse({ t: "voice.leave", at: 1, room: "", quemEsta: true })
    expect(lido.t).toBe("voice.leave")
    // And the premise that makes it harmless: whoever asks asserts they are NOT in
    // the call, which is exactly what a `voice.leave` always said.
    expect(ehPerguntaDePresenca(lido)).toBe(true)
  })

  it("uma despedida a sério não se confunde com uma pergunta", () => {
    expect(ehPerguntaDePresenca({ t: "voice.leave", at: 1 })).toBe(false)
    expect(ehPerguntaDePresenca({ t: "voice.leave", at: 1, quemEsta: false })).toBe(false)
    expect(ehPerguntaDePresenca({ t: "voice.join", at: 1, video: false, alone: true, sframe: false })).toBe(false)
  })
})

describe("quem chega pergunta", () => {
  it("uma pergunta por canal, em todos os canais subscritos", () => {
    const bridge = ponte(ALICE)
    const call = new Call(bridge)

    call.perguntarQuemEsta([CANAL, OUTRO])

    expect(bridge.sent.map((saiu) => saiu.channel)).toEqual([CANAL, OUTRO])
    for (const saiu of bridge.sent) expect(ehPerguntaDePresenca(saiu.payload)).toBe(true)
  })

  it("e vai com uma sala que não pode ser sala nenhuma", () => {
    /*
      The sentinel, and it is what protects clients that do not know the
      question. A room identifier that this software manages is `forum-word-word`
      or `contio-word-word` (see `roomIdFromBytes`), and the empty one is the
      default room. None of them is this, so an old client's room filter
      discards the question before it touches the roster.
    */
    const bridge = ponte(ALICE)
    const call = new Call(bridge)

    call.perguntarQuemEsta([CANAL])

    const pergunta = bridge.sent[0]?.payload
    expect(pergunta?.t === "voice.leave" && pergunta.room).toBe(SALA_DA_PERGUNTA)
    expect(SALA_DA_PERGUNTA).not.toBe("")
    expect(SALA_DA_PERGUNTA.startsWith("forum-")).toBe(false)
    expect(SALA_DA_PERGUNTA.startsWith("contio-")).toBe(false)
    // And it passes the schema: a sentinel that `Payload.parse` would refuse meant
    // the question never left. See `room` in `voice.leave`.
    expect(() => Payload.parse(pergunta)).not.toThrow()
  })

  /**
   * What a 0.3.3 client does with the question, measured here.
   *
   * The 0.3.3 order is what this reader copies, and it is the whole issue: the
   * room filter runs BEFORE the `voice.leave` reaches the roster. (In this
   * client the question is handled before the filter, like `voice.move`, and
   * that is why it responds, see the block above.)
   *
   * **And rosters are indexed by ACCOUNT address, not device**, which is what
   * makes this achievable: the laptop that wakes up and asks has the same
   * address as the phone that is in the call.
   */
  it("um leitor com a ordem do 0.3.3 descarta a pergunta antes do roster", () => {
    /** The 0.3.3: room filter first, goodbye second. */
    const leitor0_3_3 = (salaDaChamada: string, payload: Payload): "ignorado" | "despedida" => {
      const salaDoSinal = (payload as { room?: string }).room ?? ""
      if (salaDoSinal !== salaDaChamada) return "ignorado"
      return payload.t === "voice.leave" ? "despedida" : "ignorado"
    }

    const bridge = ponte(ALICE)
    const call = new Call(bridge)
    call.perguntarQuemEsta([CANAL])
    const pergunta = bridge.sent[0]?.payload as Payload

    /*
      The two rooms where the question without a sentinel killed someone: the
      channel call and the direct conversation are both the room `""`, which is
      exactly what an absent `room` is worth on the reader's side.
    */
    expect(leitor0_3_3("", pergunta)).toBe("ignorado")
    expect(leitor0_3_3("contio-obras", pergunta)).toBe("ignorado")

    // And the contrast, without which this passed as the reader never saying
    // anything: the question AS IT WAS, without a room, is read as the goodbye of
    // someone in that call, and it is that `#drop` which erased our other device.
    const comoEra: Payload = { t: "voice.leave", at: Date.now(), quemEsta: true }
    expect(leitor0_3_3("", comoEra)).toBe("despedida")
  })

  it("no máximo uma pergunta por canal dentro de um batimento", async () => {
    /*
      The trigger is the CONNECTION return, and a socket wobbles back many times:
      with twenty channels, each return cost twenty MLS messages, encrypted,
      logged in `events` and routed to all members, most of them for channels
      where there is no call at all.
    */
    vi.useFakeTimers()
    const bridge = ponte(ALICE)
    const call = new Call(bridge)

    call.perguntarQuemEsta([CANAL, OUTRO])
    expect(bridge.sent).toHaveLength(2)

    // The connection wobbles back three times in a row. Nothing goes out.
    for (let volta = 0; volta < 3; volta++) {
      await vi.advanceTimersByTimeAsync(1000)
      call.perguntarQuemEsta([CANAL, OUTRO])
    }
    expect(bridge.sent).toHaveLength(2)

    // After the heartbeat, we ask again: what the question avoids is waiting for
    // it, and never asking again.
    await vi.advanceTimersByTimeAsync(Call.PERGUNTA_MINIMO_MS + 10)
    call.perguntarQuemEsta([CANAL, OUTRO])
    expect(bridge.sent).toHaveLength(4)
  })

  it("e um canal novo não herda a espera de outro", async () => {
    // Per channel and not one clock alone: joining a channel now is the first time
    // we ask it, and waiting because of another would be waiting for the heartbeat
    // exactly in the case this is fixing.
    vi.useFakeTimers()
    const bridge = ponte(ALICE)
    const call = new Call(bridge)

    call.perguntarQuemEsta([CANAL])
    await vi.advanceTimersByTimeAsync(1000)
    call.perguntarQuemEsta([CANAL, OUTRO])

    expect(bridge.sent.map((saiu) => saiu.channel)).toEqual([CANAL, OUTRO])
  })

  it("menos no canal onde já estamos em chamada", async () => {
    /*
      The guard that is not economical. The question travels as a `voice.leave`,
      and in the presence map of whoever reads it a `voice.leave` erases the
      person from the ENTIRE channel, not just the room. Asking from inside a
      call would erase us from other people's screens until our next heartbeat,
      which is 50 seconds later. And it is unnecessary: we already know who is
      there.
      */
    const bridge = ponte(ALICE)
    const call = new Call(bridge)
    await call.join(CANAL)
    bridge.sent.length = 0

    call.perguntarQuemEsta([CANAL, OUTRO])

    expect(bridge.sent.map((saiu) => saiu.channel)).toEqual([OUTRO])
  })
})

describe("quem está responde", () => {
  it("quem está em chamada no canal reanuncia-se, e o anúncio diz a sala", async () => {
    vi.useFakeTimers()
    const bridge = ponte(BRUNO)
    const call = new Call(bridge)
    await call.join(CANAL, { room: "contio-obras" })
    bridge.sent.length = 0

    await call.handleSignal(CANAL, ALICE, { t: "voice.leave", at: Date.now(), quemEsta: true })

    // Nothing instantly: the response is delayed on purpose. The question reaches
    // ALL members of the channel, and without the delay those in the call would all
    // respond in the same tick.
    expect(bridge.sent).toEqual([])

    await vi.advanceTimersByTimeAsync(Call.REAFIRMACAO_ADIADA_MS + 10)

    const anuncio = bridge.sent.find((saiu) => saiu.payload.t === "voice.join")
    expect(anuncio).toBeDefined()
    // It's the usual announcement, and it's the one that says which ROOM the conversation is in.
    expect(anuncio?.payload.t === "voice.join" && anuncio.payload.room).toBe("contio-obras")
  })

  it("e responde mesmo quando a pergunta vem com outra sala, ou nenhuma", async () => {
    /*
      The reason this is handled BEFORE the room filter, like `voice.move`.
      Whoever asks is not in any room: the question's `room` is not its origin.
      Filtering it like the other frames would discard precisely the question,       and whoever asked would wait the 50 seconds, which is the bug this is
      fixing.
      
      `SALA_DA_PERGUNTA` is in the list, and it is the case that matters most:
      it is the room this version PUTS in the question, on purpose, so an old
      0.3.3 client's room filter discards it before it touches the roster. A
      0.4.0 client must continue to answer it, or the guard that protects the
      old client silences the feature entirely between new clients.
      */
    vi.useFakeTimers()
    const bridge = ponte(BRUNO)
    const call = new Call(bridge)
    await call.join(CANAL, { room: "contio-obras" })

    for (const room of [undefined, "", "contio-outra", SALA_DA_PERGUNTA]) {
      bridge.sent.length = 0
      await call.handleSignal(CANAL, ALICE, {
        t: "voice.leave",
        at: Date.now(),
        quemEsta: true,
        ...(room === undefined ? {} : { room }),
      })
      await vi.advanceTimersByTimeAsync(Call.REAFIRMACAO_ADIADA_MS + 10)
      expect(bridge.sent.some((saiu) => saiu.payload.t === "voice.join")).toBe(true)
    }
  })

  it("quem não está em chamada nenhuma cala-se", async () => {
    vi.useFakeTimers()
    const bridge = ponte(BRUNO)
    const call = new Call(bridge)

    await call.handleSignal(CANAL, ALICE, { t: "voice.leave", at: Date.now(), quemEsta: true })
    await vi.advanceTimersByTimeAsync(Call.REAFIRMACAO_ADIADA_MS + 10)

    // It is what keeps this from being an oracle: only those actually in a call
    // respond, and the question only reaches channel members, because it travels
    // encrypted inside it.
    expect(bridge.sent).toEqual([])
  })

  it("quem está em chamada NOUTRO canal não responde por este", async () => {
    vi.useFakeTimers()
    const bridge = ponte(BRUNO)
    const call = new Call(bridge)
    await call.join(OUTRO)
    bridge.sent.length = 0

    await call.handleSignal(CANAL, ALICE, { t: "voice.leave", at: Date.now(), quemEsta: true })
    await vi.advanceTimersByTimeAsync(Call.REAFIRMACAO_ADIADA_MS + 10)

    expect(bridge.sent).toEqual([])
  })

  it("uma pergunta não tira ninguém da chamada", async () => {
    /*
      What sets the question apart from the goodbye whose form it has. Alice is
      in the call with Bruno; a question from Alice cannot erase her from
      Bruno's screen, or the fix would produce the bug it is fixing.
    */
    vi.useFakeTimers()
    // Alice on this side, and on purpose: in the mesh it is the LOWER address that
    // offers on hearing an announcement, and with no connection there is no pair in
    // the list for this test to assert that it does not get lost.
    const bridge = ponte(ALICE)
    const call = new Call(bridge)
    // The list has no reader: it is the event itself. That's how the interface receives it.
    let naChamada: string[] = []
    call.on("participants", ({ participants }) => {
      naChamada = participants.map((quem) => quem.address)
    })

    await call.join(CANAL)
    await call.handleSignal(CANAL, BRUNO, {
      t: "voice.join",
      at: Date.now(),
      video: false,
      sframe: false,
      alone: true,
    })
    await ligarTudo()
    expect(naChamada).toContain(BRUNO)

    await call.handleSignal(CANAL, BRUNO, { t: "voice.leave", at: Date.now(), quemEsta: true })
    await vi.advanceTimersByTimeAsync(Call.REAFIRMACAO_ADIADA_MS + 10)
    expect(naChamada).toContain(BRUNO)

    // And the contrast, without which the test above would pass because the list never changes:
    // a proper disconnect removes it.
    await call.handleSignal(CANAL, BRUNO, { t: "voice.leave", at: Date.now() })
    expect(naChamada).not.toContain(BRUNO)
  })
})
