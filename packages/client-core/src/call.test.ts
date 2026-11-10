import { SALA_DA_PERGUNTA, type Payload, type UserAddress } from "@enclave/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Call, type CallBridge, type MediaKeyMaterial, type Participant } from "./call.js"

/**
 * The call handshake, exercised end to end without a browser.
 *
 * Node has no WebRTC, so `RTCPeerConnection` and `getUserMedia` are stubbed
 * below. That boundary is worth being precise about: these tests prove the part
 * this project actually wrote — who offers, who answers, what is signalled, when
 * media is requested, when the permission gate opens and closes — and prove
 * nothing about whether two real machines can traverse a NAT. That remains
 * untested, and no amount of stubbing would change it.
 */

// -------------------------------------------------------------------- stubs

class FakePeerConnection {
  static instances: FakePeerConnection[] = []

  localDescription: { type: string; sdp: string } | null = null
  remoteDescription: { type: string; sdp: string } | null = null
  connectionState = "new"
  addedTracks: MediaStreamTrack[] = []
  addedCandidates: unknown[] = []
  closed = false
  /**
   * What `getStats()` on this connection returns. `null` is one that does not
   * know.
   *
   * In mesh there is one `RTCPeerConnection` per person, and that is where the
   * `outbound-rtp` comes from with the quality limit, there is no SFU
   * transport to ask. See `Call.medirLimiteDeVideo`.
   */
  estatisticas: Record<string, unknown>[] | null = null

  ontrack: ((event: unknown) => void) | null = null
  onicecandidate: ((event: unknown) => void) | null = null
  onconnectionstatechange: (() => void) | null = null

  constructor(public config: unknown) {
    FakePeerConnection.instances.push(this)
  }

  addTrack(track: MediaStreamTrack): unknown {
    this.addedTracks.push(track)
    // No `createEncodedStreams`: this stands in for a platform without
    // insertable streams, which the call layer must tolerate rather than refuse.
    return {}
  }

  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: "offer", sdp: "v=0\r\no=- fake-offer\r\n" }
  }

  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: "answer", sdp: "v=0\r\no=- fake-answer\r\n" }
  }

  async setLocalDescription(description: { type: string; sdp: string }): Promise<void> {
    this.localDescription = description
  }

  async setRemoteDescription(description: { type: string; sdp: string }): Promise<void> {
    this.remoteDescription = description
  }

  async addIceCandidate(candidate: unknown): Promise<void> {
    this.addedCandidates.push(candidate)
  }

  async getStats(): Promise<RTCStatsReport> {
    const registos = this.estatisticas
    if (!registos) throw new Error("esta ligação não tem estatísticas")
    // The real report is iterable via `forEach`, and that's all the code reads.
    return { forEach: (visitar: (registo: unknown) => void) => registos.forEach(visitar) } as unknown as RTCStatsReport
  }

  close(): void {
    this.closed = true
  }

  /** Drive the events a real implementation would fire. */
  emitCandidate(candidate: string): void {
    this.onicecandidate?.({ candidate: { candidate, sdpMid: "0", sdpMLineIndex: 0 } })
  }

  emitConnected(): void {
    this.connectionState = "connected"
    this.onconnectionstatechange?.()
  }

  /** Drive any state, including the ones a closed connection reports late. */
  emitState(state: string): void {
    this.connectionState = state
    this.onconnectionstatechange?.()
  }

  emitRemoteTrack(stream: MediaStream): void {
    this.ontrack?.({ streams: [stream], receiver: {} })
  }
}

function fakeStream(withVideo: boolean): MediaStream {
  const audio = { kind: "audio", enabled: true, stop: vi.fn() }
  const video = { kind: "video", enabled: true, stop: vi.fn() }
  const tracks = withVideo ? [audio, video] : [audio]
  return {
    getTracks: () => tracks,
    getAudioTracks: () => [audio],
    getVideoTracks: () => (withVideo ? [video] : []),
  } as unknown as MediaStream
}

/**
 * A screen capture, which is video and nothing else.
 *
 * System audio is left out on purpose: only Windows gives it without an
 * installed extension, and a test that assumed it described a machine most
 * people do not have.
 */
function fakeScreen(): MediaStream {
  const video = { kind: "video", enabled: true, stop: vi.fn() }
  return {
    getTracks: () => [video],
    getAudioTracks: () => [],
    getVideoTracks: () => [video],
  } as unknown as MediaStream
}

const ALICE = "@alice:enclave.test" as UserAddress
const BRUNO = "@bruno:enclave.test" as UserAddress
/** A third one, which is the number from which the repair started to fail. */
const CARLA = "@carla:enclave.test" as UserAddress

/**
 * Two calls wired to each other, the way the server would wire them — except
 * that here delivery is synchronous, so a test never races the network.
 */
function loopback(
  selfAddress: UserAddress,
  deliver: (payload: Payload) => Promise<void>,
): CallBridge & { sent: Payload[] } {
  const sent: Payload[] = []
  return {
    selfAddress,
    sent,
    async sendSignal(_channel, payload) {
      sent.push(payload)
      // Awaited, so a test observes the far side's reaction rather than racing
      // it. Over a real network this is fire-and-forget, and the protocol does
      // not depend on the ordering either way.
      await deliver(payload)
    },
    async mediaKey(): Promise<MediaKeyMaterial | null> {
      return { keyId: 1, senderId: 0, material: new Uint8Array(28) }
    },
    async reservarContadorSframe(): Promise<number> {
      return 0
    },
  }
}

let grantMedia = true

beforeEach(() => {
  FakePeerConnection.instances = []
  grantMedia = true

  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  vi.stubGlobal("RTCRtpSender", class {})
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async (constraints: { video?: unknown }) => {
        if (!grantMedia) throw new Error("Permission denied")
        return fakeStream(Boolean(constraints.video))
      },
    },
  })
})

const CHANNEL = "!geral:enclave.test"

describe("call handshake", () => {
  it("completes offer, answer and ICE between two participants", async () => {
    let bruno: Call
    const aliceBridge = loopback(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(aliceBridge)
    const brunoBridge = loopback(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(brunoBridge)

    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)

    // Bruno's join reached Alice, who has the lower address and therefore
    // offers. Without that rule both sides offer at once and neither connects.
    const offer = aliceBridge.sent.find((payload) => payload.t === "voice.offer")
    expect(offer).toBeDefined()
    expect(offer?.t === "voice.offer" && offer.to).toBe(BRUNO)

    const answer = brunoBridge.sent.find((payload) => payload.t === "voice.answer")
    expect(answer).toBeDefined()
    expect(answer?.t === "voice.answer" && answer.to).toBe(ALICE)

    // Alice applied the answer, so both ends hold a complete description.
    const [alicePeer, brunoPeer] = FakePeerConnection.instances
    expect(alicePeer?.localDescription?.type).toBe("offer")
    expect(alicePeer?.remoteDescription?.type).toBe("answer")
    expect(brunoPeer?.remoteDescription?.type).toBe("offer")
    expect(brunoPeer?.localDescription?.type).toBe("answer")

    // ICE flows both ways.
    alicePeer?.emitCandidate("candidate:1 alice")
    brunoPeer?.emitCandidate("candidate:1 bruno")
    await Promise.resolve()

    expect(brunoPeer?.addedCandidates).toHaveLength(1)
    expect(alicePeer?.addedCandidates).toHaveLength(1)
  })


  /**
   * A closed connection keeps reporting its state after it dies, and the report
   * arrives when there is already another connection to the same person.
   *
   * Measured in production: 128 signaling messages and 19 SDPs in one minute in
   * a room of three. Each drop closed a connection, the person reannounced,
   * a new good connection was born, and the late event from the old closed
   * connection called `#drop` by ADDRESS, killing the successor. The cycle fed
   * itself and the call never settled.
   */
  it("não deixa uma ligação morta derrubar a que a substituiu", async () => {
    let bruno: Call
    const aliceBridge = loopback(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(aliceBridge)
    const brunoBridge = loopback(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(brunoBridge)

    const participantes: number[] = []
    alice.on("participants", (event) => participantes.push(event.participants.length))

    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)

    const primeira = FakePeerConnection.instances[0] as FakePeerConnection
    primeira.emitConnected()
    primeira.emitState("failed")

    // Bruno reannounces and a new connection is born, which links well.
    await alice.handleSignal(CHANNEL, BRUNO, { t: "voice.join", at: Date.now(), video: false, sframe: false, alone: false })
    const segunda = FakePeerConnection.instances.at(-1) as FakePeerConnection
    expect(segunda).not.toBe(primeira)
    segunda.emitConnected()
    expect(participantes.at(-1)).toBe(1)

    // Now the state of the FIRST one arrives, long closed.
    primeira.emitState("closed")

    expect(participantes.at(-1)).toBe(1)
    expect(segunda.closed).toBe(false)
  })

  it("does not have both sides offer at once", async () => {
    let bruno: Call
    const aliceBridge = loopback(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(aliceBridge)
    const brunoBridge = loopback(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(brunoBridge)

    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)

    // Glare would show up as the higher address also offering.
    expect(brunoBridge.sent.filter((payload) => payload.t === "voice.offer")).toHaveLength(0)
    expect(aliceBridge.sent.filter((payload) => payload.t === "voice.offer")).toHaveLength(1)
  })

  it("reports a participant only once ICE actually connects", async () => {
    let bruno: Call
    const aliceBridge = loopback(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(aliceBridge)
    const brunoBridge = loopback(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(brunoBridge)

    const seen: boolean[] = []
    alice.on("participants", (event) => seen.push(event.participants[0]?.connected ?? false))

    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)

    const alicePeer = FakePeerConnection.instances[0]
    alicePeer?.emitRemoteTrack(fakeStream(false))
    expect(seen.at(-1)).toBe(false)

    alicePeer?.emitConnected()
    expect(seen.at(-1)).toBe(true)
  })

  it("opens the media gate before asking for the microphone, and closes it on leave", async () => {
    const order: string[] = []
    const bridge: CallBridge = {
      selfAddress: ALICE,
      async sendSignal() {},
      async mediaKey() {
        return null
      },
      async setMediaActive(active) {
        order.push(active ? "gate-open" : "gate-close")
      },
      async reservarContadorSframe() {
        return 0
      },
    }

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => {
          order.push("getUserMedia")
          return fakeStream(false)
        },
      },
    })

    const call = new Call(bridge)
    await call.join(CHANNEL)
    await call.leave()

    // The gate must open first. Reversed, the permission prompt is refused by
    // the very policy meant to guard it, and no call can ever start.
    expect(order).toEqual(["gate-open", "getUserMedia", "gate-close"])
  })

  it("closes the media gate again when permission is refused", async () => {
    const order: string[] = []
    grantMedia = false

    const call = new Call({
      selfAddress: ALICE,
      async sendSignal() {},
      async mediaKey() {
        return null
      },
      async setMediaActive(active) {
        order.push(active ? "open" : "close")
      },
      async reservarContadorSframe() {
        return 0
      },
    })

    await expect(call.join(CHANNEL)).rejects.toThrow()
    expect(order).toEqual(["open", "close"])
    expect(call.active).toBe(false)
  })

  it("tears down every peer connection and track when the call ends", async () => {
    let bruno: Call
    const aliceBridge = loopback(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(aliceBridge)
    const brunoBridge = loopback(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(brunoBridge)

    await alice.join(CHANNEL, { video: true })
    await bruno.join(CHANNEL)

    const localTracks = alice.localStream?.getTracks() ?? []
    // It came in with `{ video: true }`, so there are two: audio and video.
    // Without this line, the `?? []` would stay quiet and the loop down below
    // would not run even once, `for (const x of [])` does not execute and does
    // not fail. The assertion that guards the camera light would vanish in
    // silence, and the test would stay green.
    expect(localTracks).toHaveLength(2)

    await alice.leave()

    expect(FakePeerConnection.instances[0]?.closed).toBe(true)
    expect(alice.localStream).toBeNull()
    expect(alice.active).toBe(false)
    // Stopping the tracks is what turns the camera light off. Dropping the
    // reference alone leaves the device held open.
    for (const track of localTracks) expect(track.stop).toHaveBeenCalled()
    expect(aliceBridge.sent.some((payload) => payload.t === "voice.leave")).toBe(true)
  })

  it("drops a peer that announces it is leaving", async () => {
    let bruno: Call
    const aliceBridge = loopback(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(aliceBridge)
    const brunoBridge = loopback(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(brunoBridge)

    let participants = 0
    alice.on("participants", (event) => (participants = event.participants.length))

    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)
    await alice.handleSignal(CHANNEL, BRUNO, { t: "voice.leave", at: Date.now() })

    expect(participants).toBe(0)
  })

  it("ignores signalling addressed to somebody else", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL)

    const before = FakePeerConnection.instances.length
    await alice.handleSignal(CHANNEL, BRUNO, { t: "voice.offer", to: "@outra:enclave.test", sdp: "v=0" })

    // Answering an offer meant for a third party would leak our media to them.
    expect(FakePeerConnection.instances.length).toBe(before)
  })

  it("ignores signalling for a channel we are not calling in", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL)

    const before = FakePeerConnection.instances.length
    await alice.handleSignal("!outro:enclave.test", BRUNO, { t: "voice.join", at: Date.now(), video: false, sframe: false, alone: false })

    expect(FakePeerConnection.instances.length).toBe(before)
  })

  it("does not encrypt media to a peer that cannot decrypt it", async () => {
    // Chromium can do insertable streams; Firefox cannot. If the capable side
    // encrypts anyway, every frame arrives, fails its tag check, is discarded,
    // and the call is perfectly silent with no error anywhere.
    vi.stubGlobal(
      "RTCRtpSender",
      class {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        createEncodedStreams(): void {}
      },
    )

    let bruno: Call
    const aliceBridge = loopback(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(aliceBridge)
    const brunoBridge = loopback(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(brunoBridge)

    await alice.join(CHANNEL)
    // Bruno announces himself as unable to do SFrame.
    await alice.handleSignal(CHANNEL, BRUNO, { t: "voice.join", at: Date.now(), video: false, sframe: false, alone: false })

    // The peer connection must not ask for insertable streams at all: doing so
    // and then encrypting is what silences the far end.
    const peer = FakePeerConnection.instances[0]
    expect((peer?.config as { encodedInsertableStreams?: boolean }).encodedInsertableStreams).toBeUndefined()
  })

  it("advertises its own SFrame capability when joining", async () => {
    const bridge = loopback(ALICE, async () => {})
    const call = new Call(bridge)
    await call.join(CHANNEL)

    const join = bridge.sent.find((payload) => payload.t === "voice.join")
    expect(join).toBeDefined()
    // The stub has no `createEncodedStreams`, so this environment must say so
    // rather than claim a capability it lacks.
    expect(join?.t === "voice.join" && join.sframe).toBe(false)
  })

  it("mutes by disabling the track, not by dropping it", async () => {
    const bridge = loopback(ALICE, async () => {})
    const call = new Call(bridge)
    await call.join(CHANNEL, { video: true })

    call.setMuted(true)
    expect(call.localStream?.getAudioTracks()[0]?.enabled).toBe(false)
    call.setCameraOff(true)
    expect(call.localStream?.getVideoTracks()[0]?.enabled).toBe(false)

    // Still there: renegotiating the connection to unmute would take seconds
    // and drop audio for everyone.
    expect(call.localStream?.getTracks()).toHaveLength(2)
  })

  it("silenciar sem chamada de pé vale para a chamada seguinte", async () => {
    const bridge = loopback(ALICE, async () => {})
    const call = new Call(bridge)

    // Not entered yet: there is no track to touch, only the choice.
    call.setMuted(true)
    expect(call.muted).toBe(true)
    expect(call.localStream).toBeNull()

    await call.join(CHANNEL)
    // The track is born active. If the choice were not applied to the capture,
    // this person would be speaking to the room convinced they were muted.
    expect(call.localStream?.getAudioTracks()[0]?.enabled).toBe(false)
  })

  it("o silêncio atravessa a chamada: sai-se calado, entra-se calado", async () => {
    const bridge = loopback(ALICE, async () => {})
    const call = new Call(bridge)

    await call.join(CHANNEL)
    call.setMuted(true)
    await call.leave()
    expect(call.muted).toBe(true)

    await call.join(CHANNEL)
    expect(call.localStream?.getAudioTracks()[0]?.enabled).toBe(false)
  })
})

/**
 * Nobody sees you are muted, and now they do.
 *
 * The state travels in OPTIONAL fields of `voice.join`, `voice.offer` and
 * `voice.answer`, never in a new `t`: an unknown `t` fails the union in
 * `decodePayload` on an old client, counts as an ignored event, and three
 * ignored ones declare the channel deaf. Three frames and not one because an
 * announcement is only heard by those ALREADY in the call: whoever joins midway
 * never heard anyone's, and it is the offer or answer that tells them who was
 * already there muted.
 */
describe("o microfone calado, visto do outro lado", () => {
  /** Let the signaling settle that runs outside the `join` queue. */
  const assentar = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  /**
   * Turn on ICE for all open connections.
   *
   * Needed because a newly built connection does not join the participant list
   * by itself: `#buildPeer` does not announce, and whoever announces is the
   * state transition. This is deliberate, a card that appears before there is
   * a connection promises a person who might never arrive.
   */
  const ligarTudo = async (): Promise<void> => {
    for (const ligacao of FakePeerConnection.instances) if (!ligacao.closed) ligacao.emitConnected()
    await assentar()
  }

  /** The announcement of someone who just joined: no peer, so `alone`. */
  const entradaDe = (muted?: boolean): Payload =>
    ({
      t: "voice.join",
      at: Date.now(),
      video: false,
      sframe: false,
      alone: true,
      ...(muted === undefined ? {} : { muted }),
    }) as Payload

  /**
   * The announcement of someone already linked who toggled the microphone.
   *
   * `alone: false` is what sets it apart, and the distinction matters: `alone`
   * says to drop the connection we have with that person, because it means
   * there is no connection on their side. A reannouncement for a state change
   * has peers, and dropping a good connection on each button click would be a
   * worse fault than the one this solves.
   */
  const reanuncioDe = (muted: boolean): Payload =>
    ({ t: "voice.join", at: Date.now(), video: false, sframe: false, alone: false, muted }) as Payload

  it("o anúncio leva o estado do microfone, calado ou não", async () => {
    const bridge = loopback(ALICE, async () => {})
    const call = new Call(bridge)

    call.setMuted(true)
    await call.join(CHANNEL)

    const join = bridge.sent.find((payload) => payload.t === "voice.join")
    expect(join?.t === "voice.join" && join.muted).toBe(true)
  })

  it("silenciar a meio da chamada volta a anunciar, e só quando o estado muda", async () => {
    const bridge = loopback(ALICE, async () => {})
    const call = new Call(bridge)
    await call.join(CHANNEL)

    const anuncios = (): Payload[] => bridge.sent.filter((payload) => payload.t === "voice.join")
    const antes = anuncios().length

    call.setMuted(true)
    await assentar()
    const depois = anuncios()
    expect(depois.length).toBe(antes + 1)
    const ultimo = depois.at(-1)
    expect(ultimo?.t === "voice.join" && ultimo.muted).toBe(true)

    // Repeating the same choice is not news. Without this guard, each click on
    // a button that changes nothing would put a frame on the wire, and `#join`
    // calls `setMuted` with the value already there, which would give an extra
    // announcement right before the join announcement.
    call.setMuted(true)
    await assentar()
    expect(anuncios().length).toBe(depois.length)

    call.setMuted(false)
    await assentar()
    const derradeiro = anuncios().at(-1)
    expect(derradeiro?.t === "voice.join" && derradeiro.muted).toBe(false)
  })

  it("fora de uma chamada não se anuncia nada a ninguém", async () => {
    const bridge = loopback(ALICE, async () => {})
    const call = new Call(bridge)

    // The choice stands for the next call too. There is no room to tell it to, and a frame going nowhere would be noise with the cost of an error.
    call.setMuted(true)
    await assentar()
    expect(bridge.sent).toHaveLength(0)
    expect(call.muted).toBe(true)
  })

  it("a oferta leva o estado, para quem entrou depois de nós nos calarmos", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL)
    alice.setMuted(true)
    await assentar()

    // Bruno enters now. Alice has the lower address, so she offers. She never announces again: without the field in the offer, Bruno would see her speaking.
    await alice.handleSignal(CHANNEL, BRUNO, entradaDe(false))
    const oferta = bridge.sent.find((payload) => payload.t === "voice.offer")
    expect(oferta?.t === "voice.offer" && oferta.muted).toBe(true)
  })

  it("a resposta leva o estado, para quem já lá estava quando entrámos", async () => {
    const bridge = loopback(BRUNO, async () => {})
    const bruno = new Call(bridge)
    await bruno.join(CHANNEL)
    bruno.setMuted(true)
    await assentar()

    // An offer from someone with the lower address: we respond, and that response is the first thing we say about ourselves to whoever was already there.
    await bruno.handleSignal(CHANNEL, ALICE, {
      t: "voice.offer",
      to: BRUNO,
      sdp: "v=0\r\no=- oferta\r\n",
      sframe: false,
    })
    const resposta = bridge.sent.find((payload) => payload.t === "voice.answer")
    expect(resposta?.t === "voice.answer" && resposta.muted).toBe(true)
  })

  it("quem entra a meio vê o estado de quem já lá estava calado", async () => {
    // The end-to-end proof, and the case the spec tells us to verify live: Alice is in the call and muted BEFORE Bruno exists, so Bruno never heard any announcement from her.
    let bruno: Call | undefined
    const aliceBridge = loopback(ALICE, async (payload) => {
      await bruno?.handleSignal(CHANNEL, ALICE, payload)
    })
    const alice = new Call(aliceBridge)
    await alice.join(CHANNEL)
    alice.setMuted(true)
    await assentar()

    const brunoBridge = loopback(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(brunoBridge)
    const vistos: Participant[][] = []
    bruno.on("participants", (event) => vistos.push(event.participants))
    await bruno.join(CHANNEL)
    await assentar()
    await ligarTudo()

    const ultima = vistos.at(-1) ?? []
    expect(ultima.map((quem) => quem.address)).toContain(ALICE)
    expect(ultima.find((quem) => quem.address === ALICE)?.micMuted).toBe(true)
  }, 20_000)

  it("dessilenciar chega ao outro lado pelo mesmo caminho", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL)

    const estados: (boolean | undefined)[] = []
    alice.on("participants", (event) =>
      estados.push(event.participants.find((quem) => quem.address === BRUNO)?.micMuted),
    )

    await alice.handleSignal(CHANNEL, BRUNO, entradaDe(true))
    await ligarTudo()
    expect(estados.at(-1)).toBe(true)

    // The same frame, with the value reversed: this is what Bruno's button emits.
    await alice.handleSignal(CHANNEL, BRUNO, reanuncioDe(false))
    expect(estados.at(-1)).toBe(false)
  })

  it("um par que nunca disse nada não é dado como calado, nem apaga o que já disse", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL)

    let ultimo: Participant[] = []
    alice.on("participants", (event) => (ultimo = event.participants))

    // An old client that does not know the field. We assert nothing about it: the flag only appears on what was actually said.
    await alice.handleSignal(CHANNEL, BRUNO, entradaDe(undefined))
    await ligarTudo()
    expect(ultimo.find((quem) => quem.address === BRUNO)?.micMuted).toBe(false)

    // Then says he is muted.
    await alice.handleSignal(CHANNEL, BRUNO, reanuncioDe(true))
    expect(ultimo.find((quem) => quem.address === BRUNO)?.micMuted).toBe(true)

    // A muted frame after that is not a retraction. `undefined` means "did not say", and treating it as `false` made the icon flicker each time a mixed client re-announced.
    await alice.handleSignal(CHANNEL, BRUNO, {
      t: "voice.offer",
      to: ALICE,
      sdp: "v=0\r\no=- oferta\r\n",
      sframe: false,
    })
    expect(ultimo.find((quem) => quem.address === BRUNO)?.micMuted).toBe(true)
  })

  it("quem recarrega a página calado não reaparece a falar", async () => {
    /**
     * The order trap, caught while writing this.
     *
     * An announcement with `alone` tells us to drop the connection we have with that person-they reloaded and have no connection on their side. And `#drop` forgets everything we knew about them, including the microphone. Recording what the frame brought BEFORE `#drop` meant seeing it erased one step later: the person comes back muted and appears to everyone as if speaking, which is exactly the lie this code exists to undo.
     */
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL)

    let ultimo: Participant[] = []
    alice.on("participants", (event) => (ultimo = event.participants))

    await alice.handleSignal(CHANNEL, BRUNO, entradaDe(true))
    await ligarTudo()
    expect(ultimo.find((quem) => quem.address === BRUNO)?.micMuted).toBe(true)

    // F5 on his side, still muted. The old connection dies and a new one is born.
    await alice.handleSignal(CHANNEL, BRUNO, entradaDe(true))
    await ligarTudo()
    expect(ultimo.find((quem) => quem.address === BRUNO)?.micMuted).toBe(true)
  })

  it("sair da chamada esquece o que se sabia dos outros", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL)
    await alice.handleSignal(CHANNEL, BRUNO, entradaDe(true))

    await alice.leave()
    await alice.join(CHANNEL)

    let ultimo: Participant[] = []
    alice.on("participants", (event) => (ultimo = event.participants))
    // Bruno enters again without saying anything about the microphone: if the state from the previous call had stuck around, he would enter marked as muted when he is not.
    await alice.handleSignal(CHANNEL, BRUNO, entradaDe(undefined))
    await ligarTudo()
    expect(ultimo.find((quem) => quem.address === BRUNO)?.micMuted).toBe(false)
  })
})

describe("entrada quase simultânea", () => {
  it("dois participantes que entram ao mesmo tempo acabam ligados, não à espera um do outro", async () => {
    // The real race: each person's announcement arrives before the other has entered. Before, both were discarded and nobody would announce again-both stayed in the call, alone, seeing "waiting for someone to enter".
    let bruno: Call
    const aliceBridge = loopback(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(aliceBridge)
    const brunoBridge = loopback(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(brunoBridge)

    // Alice's announcement reaches Bruno BEFORE Bruno enters.
    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)

    // Someone had to have offered: without that there is no connection.
    const ofertas = [
      ...aliceBridge.sent.filter((p) => p.t === "voice.offer"),
      ...brunoBridge.sent.filter((p) => p.t === "voice.offer"),
    ]
    expect(ofertas.length).toBeGreaterThan(0)
    expect(FakePeerConnection.instances.length).toBeGreaterThan(0)
  }, 20_000)
})

/**
 * Lose ONE connection, and keep another.
 *
 * The fix existed and worked only for two-person calls: whoever fell to zero connections would announce again. With three, whoever loses one connection and keeps the other has one pair-does not re-announce, and never tries again. The other side, for the exact same reason, does not either. Both give up in silence while they keep hearing the third person.
 *
 * This is the owner's report from August 12th, word for word: in a three-person call, only two hear each other and the third stays "calling" forever. And it does not fix itself, because nobody is trying.
 *
 * The test bites: without `#perdidos`, the retransmitter stops at the first tick (there is a live pair) and no announcement goes out after the drop.
 */
describe("perder um par numa chamada de três", () => {
  it("volta a anunciar-se mesmo tendo outro par vivo", async () => {
    vi.useFakeTimers()
    try {
      const bridge = loopback(ALICE, async () => {})
      const call = new Call(bridge)
      await call.join(CHANNEL)

      // Two connections, both linked: the call is in the normal state of three.
      await call.handleSignal(CHANNEL, BRUNO, { t: "voice.join", at: Date.now(), video: false, alone: false, sframe: false })
      await call.handleSignal(CHANNEL, CARLA, { t: "voice.join", at: Date.now(), video: false, alone: false, sframe: false })
      for (const pc of FakePeerConnection.instances) pc.emitConnected()

      const antes = bridge.sent.filter((p) => p.t === "voice.join").length

      // The connection with Carla drops. Bruno's stays up.
      const daCarla = FakePeerConnection.instances.at(-1)
      daCarla?.emitState("failed")

      // The retransmitter runs every five seconds. One tick arrives.
      await vi.advanceTimersByTimeAsync(6000)

      const depois = bridge.sent.filter((p) => p.t === "voice.join").length
      expect(depois).toBeGreaterThan(antes)
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it("uma saída limpa não faz anunciar coisa nenhuma", async () => {
    // The contrast that keeps this from becoming noise: whoever says they are leaving leaves no debt, and the call stays quiet with those who stayed.
    vi.useFakeTimers()
    try {
      const bridge = loopback(ALICE, async () => {})
      const call = new Call(bridge)
      await call.join(CHANNEL)

      await call.handleSignal(CHANNEL, BRUNO, { t: "voice.join", at: Date.now(), video: false, alone: false, sframe: false })
      await call.handleSignal(CHANNEL, CARLA, { t: "voice.join", at: Date.now(), video: false, alone: false, sframe: false })
      for (const pc of FakePeerConnection.instances) pc.emitConnected()

      const antes = bridge.sent.filter((p) => p.t === "voice.join").length
      await call.handleSignal(CHANNEL, CARLA, { t: "voice.leave", at: Date.now() })
      await vi.advanceTimersByTimeAsync(6000)

      expect(bridge.sent.filter((p) => p.t === "voice.join").length).toBe(antes)
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)
})

describe("sair e voltar a entrar depressa", () => {
  /**
   * When someone reloads the page, they never get to say they left.
   *
   * `voice.leave` is only sent by the disconnect button. A closed tab, an F5, a laptop going to sleep-none of that sends it, and on our side the connection keeps saying it is connected for the thirty-odd seconds it takes ICE to admit it died. When the person enters again in that window, their announcement fell into an `#offer` that gave up at the head: the flag in `#offering` was never set after a successful offer, and the old connection still had `localDescription`. Result: the person enters, sees "waiting for someone to enter", and whoever stayed still shows a card for someone who is no longer there.
   */
  it("volta a ligar a quem se reanuncia depois de recarregar a página", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL)

    await alice.handleSignal(CHANNEL, BRUNO, { t: "voice.join", at: Date.now(), video: false, sframe: false, alone: true })
    const primeira = FakePeerConnection.instances.at(-1) as FakePeerConnection
    primeira.emitConnected()

    // Bruno reloaded: his ICE agent is different, the connection we have for him is dead, and he has no pair-which is what `alone` says.
    await alice.handleSignal(CHANNEL, BRUNO, { t: "voice.join", at: Date.now(), video: false, sframe: false, alone: true })

    const segunda = FakePeerConnection.instances.at(-1) as FakePeerConnection
    expect(segunda).not.toBe(primeira)
    expect(primeira.closed).toBe(true)
    expect(bridge.sent.filter((payload) => payload.t === "voice.offer")).toHaveLength(2)
  })

  /**
   * The opposite: an announcement from someone who is ALREADY connected to someone does not drop anything.
   *
   * In a room of three, whoever has the higher address responds to each entry with their own `voice.join`, so the lower one offers. That announcement is broadcast to everyone, including whoever is already connected to them. If that counted as "I reloaded the page", each new person would break and remake all the connections that were already good.
   */
  it("não derruba uma ligação boa por causa do anúncio que a entrada de outra pessoa provoca", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL)

    await alice.handleSignal(CHANNEL, BRUNO, { t: "voice.join", at: Date.now(), video: false, sframe: false, alone: true })
    const ligacao = FakePeerConnection.instances.at(-1) as FakePeerConnection
    ligacao.emitConnected()

    await alice.handleSignal(CHANNEL, BRUNO, { t: "voice.join", at: Date.now(), video: false, sframe: false, alone: false })

    expect(FakePeerConnection.instances.at(-1)).toBe(ligacao)
    expect(ligacao.closed).toBe(false)
  })

  /** And an announcement from someone still negotiating with us does not either. */
  it("não parte a negociação a meio por causa do anúncio repetido de quem ainda não ligou", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL)

    await alice.handleSignal(CHANNEL, BRUNO, { t: "voice.join", at: Date.now(), video: false, sframe: false, alone: true })
    const ligacao = FakePeerConnection.instances.at(-1) as FakePeerConnection

    // Bruno's announcement timer fires again while his response is still on the way. The connection in progress is the good one: remaking it now leaves the response arriving for a connection that no longer exists.
    await alice.handleSignal(CHANNEL, BRUNO, { t: "voice.join", at: Date.now(), video: false, sframe: false, alone: true })

    expect(FakePeerConnection.instances.at(-1)).toBe(ligacao)
    expect(ligacao.closed).toBe(false)
  })
})

/**
 * Re-enter a call and disappear for ONE person only.
 *
 * Reported like this: "I entered the first time and everything was fine, I entered the second and stopped seeing a member who was also on the call. the third user saw both of us". The asymmetry is the clue-it is not the network, which would fail on both sides, it is stale state on one side only.
 *
 * The hole had two walls that cancelled each other out. Cleaning the old pair required `connected`, and the offer gave up at the head if there was a pair with local description. A pair that was not `connected`-negotiating, or in `disconnected`, which is where ICE sits for half a minute when someone closes the tab-passed between the two: it survived the cleanup and blocked the offer forever. Whoever had the connection already in `failed` cleaned it and connected again without noticing, and that is the third person who saw the other two.
 *
 * The signal that was missing is that LIFE is the announcement. `alone` says "I have no pair" and that confuses two things: someone who just entered and someone still negotiating. `joinId` changes with each entry and nothing else changes, so it tells them apart without guessing.
 */
describe("reentrar na chamada", () => {
  const entrada = (joinId?: string, alone = true): Payload =>
    ({
      t: "voice.join",
      at: Date.now(),
      video: false,
      sframe: true,
      alone,
      ...(joinId === undefined ? {} : { joinId }),
    }) as Payload

  const ofertas = (bridge: { sent: Payload[] }): Payload[] =>
    bridge.sent.filter((payload) => payload.t === "voice.offer")

  it("volta a oferecer a quem reentra, mesmo com a ligação velha só meio-morta", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL)

    await alice.handleSignal(CHANNEL, BRUNO, entrada("vida-1"))
    const velha = FakePeerConnection.instances.at(-1) as FakePeerConnection
    velha.emitConnected()

    /**
     * Bruno closes the tab.
     *
     * ICE does NOT say "failed"-it says "disconnected", and stays like that for more than half a minute before admitting anything. That is exactly the window when the person presses "enter" again, and that is why the fault seems random: it depends on how long it took them to come back.
     */
    velha.emitState("disconnected")

    // New life for Bruno. The old pair must die, no matter what state it is in: there is nothing on the other side that corresponds to it anymore.
    await alice.handleSignal(CHANNEL, BRUNO, entrada("vida-2"))

    expect(velha.closed).toBe(true)
    expect(ofertas(bridge)).toHaveLength(2)
    expect(FakePeerConnection.instances.at(-1)).not.toBe(velha)
  })

  it("também quando a ligação velha nunca chegou a ligar", async () => {
    // The other half of the same window: the pair stayed in "new"/"connecting" and the 25-second timer has not fired yet. `connected` is false, so the old cleanup did not touch it-and the offer already had local description.
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL)

    await alice.handleSignal(CHANNEL, BRUNO, entrada("vida-1"))
    const velha = FakePeerConnection.instances.at(-1) as FakePeerConnection
    expect(velha.localDescription).toBeTruthy()

    await alice.handleSignal(CHANNEL, BRUNO, entrada("vida-2"))

    expect(velha.closed).toBe(true)
    expect(ofertas(bridge)).toHaveLength(2)
  })

  it("o anúncio repetido da MESMA vida não parte a negociação em curso", async () => {
    /**
     * The guard that existed still applies, and that is why this is an identifier and not a "always drop". Bruno's announcement timer fires every five seconds while he is alone, and his response may be on the way: remaking the connection here leaves it arriving for a connection that no longer exists, and the negotiation never settles.
     */
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL)

    await alice.handleSignal(CHANNEL, BRUNO, entrada("vida-1"))
    const ligacao = FakePeerConnection.instances.at(-1) as FakePeerConnection

    await alice.handleSignal(CHANNEL, BRUNO, entrada("vida-1"))
    await alice.handleSignal(CHANNEL, BRUNO, entrada("vida-1", false))

    expect(FakePeerConnection.instances.at(-1)).toBe(ligacao)
    expect(ligacao.closed).toBe(false)
    expect(ofertas(bridge)).toHaveLength(1)
  })

  it("uma oferta de vida nova não é respondida com a ligação velha", async () => {
    /**
     * The other direction, and it is not redundant: in a room of three, whoever has the higher address responds to each entry with an announcement so the lower one offers. Whoever re-enters with the LOWER address offers right away, and their announcement may never have reached this side. If new life did not travel in the offer too, `#answer` would reuse the old pair and put a remote description on a connection whose ICE agent on the other side no longer exists: it connects to nothing.
     */
    const bridge = loopback(BRUNO, async () => {})
    const bruno = new Call(bridge)
    await bruno.join(CHANNEL)

    await bruno.handleSignal(CHANNEL, ALICE, {
      t: "voice.offer",
      to: BRUNO,
      sdp: "v=0\r\no=- vida-1\r\n",
      sframe: true,
      joinId: "vida-1",
    })
    const velha = FakePeerConnection.instances.at(-1) as FakePeerConnection
    velha.emitConnected()
    velha.emitState("disconnected")

    await bruno.handleSignal(CHANNEL, ALICE, {
      t: "voice.offer",
      to: BRUNO,
      sdp: "v=0\r\no=- vida-2\r\n",
      sframe: true,
      joinId: "vida-2",
    })

    expect(velha.closed).toBe(true)
    const nova = FakePeerConnection.instances.at(-1) as FakePeerConnection
    expect(nova).not.toBe(velha)
    expect(nova.remoteDescription?.sdp).toContain("vida-2")
  })

  it("um cliente que não sabe dizer de que vida é continua a ser servido como hoje", async () => {
    /**
     * The rule that cannot be broken: a missing field can never make worse a call that works today. Without `joinId` we have exactly the old heuristic-`alone` plus `connected`-with its limits and nothing new.
     */
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL)

    await alice.handleSignal(CHANNEL, BRUNO, entrada(undefined))
    const primeira = FakePeerConnection.instances.at(-1) as FakePeerConnection
    primeira.emitConnected()

    // Connected and announcing alone: this is the case the old heuristic catches.
    await alice.handleSignal(CHANNEL, BRUNO, entrada(undefined))
    expect(primeira.closed).toBe(true)
    expect(ofertas(bridge)).toHaveLength(2)

    // And what it does not catch stays uncaught, without breaking anything: that is the price of talking to a version that cannot say which life it is.
    const segunda = FakePeerConnection.instances.at(-1) as FakePeerConnection
    await alice.handleSignal(CHANNEL, BRUNO, entrada(undefined))
    expect(segunda.closed).toBe(false)
  })

  it("cada entrada nossa leva um identificador novo, e o mesmo em todos os frames dessa vida", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)

    await alice.join(CHANNEL)
    await alice.handleSignal(CHANNEL, BRUNO, entrada("dele-1"))
    const primeiraVida = bridge.sent
      .filter((p) => p.t === "voice.join" || p.t === "voice.offer")
      .map((p) => (p as { joinId?: string }).joinId)
    expect(primeiraVida.every((id) => typeof id === "string" && id.length > 0)).toBe(true)
    expect(new Set(primeiraVida).size).toBe(1)

    await alice.leave()
    const antes = bridge.sent.length
    await alice.join(CHANNEL)
    const segunda = bridge.sent
      .slice(antes)
      .filter((p) => p.t === "voice.join")
      .map((p) => (p as { joinId?: string }).joinId)
    expect(segunda[0]).toBeDefined()
    expect(segunda[0]).not.toBe(primeiraVida[0])
  })

  it("uma vida nova não faz esquecer o que ela acabou de dizer sobre si", async () => {
    /**
     * The order trap, again. `#drop` forgets everything we knew about the pair, and the frame that triggers it is the same one that brings the new information about it. Recording it before the cleanup meant seeing it erased one step later.
     *
     * Measured here by the microphone because that is what you observe from outside. It applies to everything that `#drop` clears: the same line of code decides.
     */
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL)

    let ultimo: Participant[] = []
    alice.on("participants", (event) => (ultimo = event.participants))

    await alice.handleSignal(CHANNEL, BRUNO, entrada("vida-1"))
    const velha = FakePeerConnection.instances.at(-1) as FakePeerConnection
    velha.emitConnected()

    // Comes back muted, and new life.
    await alice.handleSignal(CHANNEL, BRUNO, {
      t: "voice.join",
      at: Date.now(),
      video: false,
      sframe: true,
      alone: true,
      joinId: "vida-2",
      muted: true,
    })
    const nova = FakePeerConnection.instances.at(-1) as FakePeerConnection
    expect(nova).not.toBe(velha)
    nova.emitConnected()

    expect(ultimo.find((quem) => quem.address === BRUNO)?.micMuted).toBe(true)
  })
})

describe("estado que não pode sobreviver à chamada", () => {
  /**
   * A connection that was being born when the call ended was still born.
   *
   * `#buildPeer` waits for ICE servers-a request to the homeserver, with the network in between-and only then subscribes to `#peers`. A `leave()` in that window clears a map that does not have this connection yet: it enters after, already without a call, and stays there. Its timer fires 25 seconds later with "no answer" over a call the user disconnected from, and the next `#leave` exits at the head in `if (!channel) return`, so the ghost moves into the next call-where `#peers.size > 0` mutes the re-announcement and nobody connects to anybody.
   */
  it("não deixa nascer uma ligação depois de a chamada ter acabado", async () => {
    vi.useFakeTimers()
    try {
      let libertar!: () => void
      const bloqueio = new Promise<void>((resolve) => (libertar = resolve))
      const bridge: CallBridge & { sent: Payload[] } = {
        ...loopback(ALICE, async () => {}),
        // With retransmission, so the only error this test can have is the ghost connection's timer.
        async iceServers() {
          await bloqueio
          return [{ urls: "turn:exemplo.test", username: "u", credential: "c" }]
        },
      }

      const alice = new Call(bridge)
      const erros: string[] = []
      alice.on("error", (event) => erros.push(event.detail))

      await alice.join(CHANNEL)
      const negociacao = alice.handleSignal(CHANNEL, BRUNO, { t: "voice.offer", to: ALICE, sdp: "v=0", sframe: false })
      await alice.leave()

      libertar()
      await negociacao

      // Nothing is born for a call that no longer exists.
      expect(FakePeerConnection.instances).toHaveLength(0)

      // And nothing from it speaks again: 25 seconds after disconnect, the user cannot receive an error about a participant of a call that ended.
      await vi.advanceTimersByTimeAsync(30_000)
      expect(erros).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * An echo that cannot negotiate cannot drop the entry.
   *
   * `#join` answers, in the end, the announcements it heard before we entered. That is an extra-it solves near-simultaneous entry-but it ran inside the promise of `join`, and anything that broke in negotiation made `join()` reject. The interface treats a rejected entry by closing the call panel, and the call CONTINUES: `#channel` is set, the capture stays open, and the disconnect button no longer exists. The microphone light stays on with nothing on screen to turn it off-which is exactly what this module cannot let happen.
   *
   * An `RTCPeerConnection` constructor breaks with a malformed ICE server URL, and that URL comes from the homeserver.
   */
  it("entra na chamada mesmo quando um anúncio guardado rebenta a negociar", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    const erros: string[] = []
    // The key and the mechanism: the raw message goes in `cause`.
    alice.on("error", (event) => erros.push(`${event.detail} ${JSON.stringify(event.cause ?? {})}`))

    // Bruno's announcement arrives before Alice enters, and it stays stored.
    await alice.handleSignal(CHANNEL, BRUNO, { t: "voice.join", at: Date.now(), video: false, sframe: false, alone: true })

    vi.stubGlobal(
      "RTCPeerConnection",
      class {
        constructor() {
          throw new Error("servidor ICE mal formado")
        }
      },
    )

    await expect(alice.join(CHANNEL)).resolves.toBeUndefined()
    expect(alice.active).toBe(true)
    // And the failure is this: swallowing it in silence is the other half of the break.
    expect(erros.some((detalhe) => detalhe.includes("mal formado"))).toBe(true)
  })

  /**
   * The retransmission failure warning is per call, not per session.
   *
   * It would be marked as said forever. The second call that afternoon, with
   * the same TURN down, said nothing to anyone: it connected those on the same
   * network, failed for everyone else, and the only explanation that existed
   * had been given hours before.
   */
  it("volta a avisar que não há retransmissão na chamada seguinte", async () => {
    const bridge: CallBridge & { sent: Payload[] } = {
      ...loopback(ALICE, async () => {}),
      async iceServers() {
        return []
      },
    }
    const alice = new Call(bridge)
    const erros: string[] = []
    alice.on("error", (event) => erros.push(event.detail))

    const anuncio: Payload = { t: "voice.join", at: Date.now(), video: false, sframe: false, alone: true }

    await alice.join(CHANNEL)
    await alice.handleSignal(CHANNEL, BRUNO, anuncio)
    await alice.leave()

    await alice.join(CHANNEL)
    await alice.handleSignal(CHANNEL, BRUNO, anuncio)

    expect(erros.filter((detalhe) => detalhe === "no relay server for the call")).toHaveLength(2)
  })

  /**
   * Losing peers mid-call cannot end the call.
   *
   * A network drop puts both connections in `failed`, each side drops its own,
   * and neither announces itself again, the entry timer was stopped when the
   * first peer was born and nothing restarts it. Both stay in the same call,
   * alone, forever. It is the same break as near-simultaneous entry, a minute
   * later.
   */
  it("volta a anunciar-se quando fica sem pares a meio da chamada", async () => {
    vi.useFakeTimers()
    try {
      const bridge = loopback(ALICE, async () => {})
      const alice = new Call(bridge)
      await alice.join(CHANNEL)

      await alice.handleSignal(CHANNEL, BRUNO, { t: "voice.join", at: Date.now(), video: false, sframe: false, alone: true })
      const ligacao = FakePeerConnection.instances.at(-1) as FakePeerConnection
      ligacao.emitConnected()

      const antes = bridge.sent.filter((payload) => payload.t === "voice.join").length
      ligacao.emitState("failed")

      await vi.advanceTimersByTimeAsync(6000)
      expect(bridge.sent.filter((payload) => payload.t === "voice.join").length).toBeGreaterThan(antes)
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * Two voice rooms on the same channel are two calls.
 *
 * Without separation, whoever enters one is announced to those in the other,
 * both offer, and everyone ends up in the same conversation even though the
 * screen shows two rooms. Signaling travels on the channel, it is the `room`
 * field that separates it, and absent from both sides is the channel call,
 * which is what all the signaling before this appears to be.
 */
describe("salas de voz", () => {
  it("ignora quem está noutra sala de voz do mesmo canal", async () => {
    let bruno: Call
    const aliceBridge = loopback(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(aliceBridge)
    const brunoBridge = loopback(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(brunoBridge)

    await alice.join(CHANNEL, { room: "sala-a" })
    await bruno.join(CHANNEL, { room: "sala-b" })

    // No one offered to anyone: these are different calls.
    expect(aliceBridge.sent.filter((payload) => payload.t === "voice.offer")).toHaveLength(0)
    expect(brunoBridge.sent.filter((payload) => payload.t === "voice.offer")).toHaveLength(0)
    expect(FakePeerConnection.instances).toHaveLength(0)
  })

  it("liga quem está na mesma sala de voz", async () => {
    let bruno: Call
    const aliceBridge = loopback(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(aliceBridge)
    const brunoBridge = loopback(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(brunoBridge)

    await alice.join(CHANNEL, { room: "mesma" })
    await bruno.join(CHANNEL, { room: "mesma" })

    // Alice has the lower address, so she is the one who offers.
    const offer = aliceBridge.sent.find((payload) => payload.t === "voice.offer")
    expect(offer).toBeDefined()
    expect(offer?.t === "voice.offer" && offer.room).toBe("mesma")
  })

  it("trocar de sala não anuncia o fim da chamada", async () => {
    // Entering another room releases the same resources as leaving, but it is not leaving.
    // Without this distinction, the `ended` from the first half arrived on screen after
    // the interface of the new room was already up and erased it: the call
    // appeared and disappeared in an instant.
    const alice = new Call(loopback(ALICE, async () => {}))
    const fins: string[] = []
    alice.on("ended", (evento) => fins.push(evento.channel))

    await alice.join(CHANNEL, { room: "sala-a" })
    await alice.join(CHANNEL, { room: "sala-b" })
    expect(fins).toEqual([])

    // Leaving for real still announces itself, otherwise the screen would be stuck with a call
    // that no longer exists.
    await alice.leave()
    expect(fins).toEqual([CHANNEL])
  })

  it("a chamada do canal continua a funcionar sem sala nenhuma", async () => {
    // It is what the signaling of an earlier version appears to be, and it cannot go
    // deaf because of it.
    let bruno: Call
    const aliceBridge = loopback(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(aliceBridge)
    const brunoBridge = loopback(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(brunoBridge)

    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)

    expect(aliceBridge.sent.filter((payload) => payload.t === "voice.offer")).toHaveLength(1)
  })
})

/**
 * Being moved from a voice room.
 *
 * What these tests establish is the scope: whoever obeys does so because this
 * client decided to obey, and the request only applies to those it names, within the
 * call it is already in. None of this is cryptography, a client that deleted
 * this block would still be an Orwell client and would stay where it was.
 */
describe("mover alguém de sala de voz", () => {
  it("quem é nomeado sai da sala onde está e entra na outra", async () => {
    const bridge = loopback(BRUNO, async () => {})
    const bruno = new Call(bridge)
    await bruno.join(CHANNEL, { room: "balcao" })

    const mudancas: { room: string; by: string }[] = []
    bruno.on("moved", (event) => mudancas.push({ room: event.room, by: event.by }))

    await bruno.handleSignal(CHANNEL, ALICE, { t: "voice.move", subject: BRUNO, room: "estudio", at: 1 })

    // Left one and entered the other: the `voice.leave` from the first and the
    // `voice.join` from the second prove there was no transfer.
    expect(bridge.sent.some((payload) => payload.t === "voice.leave")).toBe(true)
    const entradas = bridge.sent.filter((payload) => payload.t === "voice.join")
    expect(entradas.at(-1)).toMatchObject({ room: "estudio" })
    expect(mudancas).toEqual([{ room: "estudio", by: ALICE }])
  })

  it("um pedido para outra pessoa não mexe nesta", async () => {
    const bridge = loopback(BRUNO, async () => {})
    const bruno = new Call(bridge)
    await bruno.join(CHANNEL, { room: "balcao" })
    const antes = bridge.sent.length

    await bruno.handleSignal(CHANNEL, ALICE, { t: "voice.move", subject: "@outra:teste", room: "estudio", at: 1 })

    expect(bridge.sent).toHaveLength(antes)
  })

  it("fora da chamada não se é arrastado para dentro de uma", async () => {
    // Move means changing rooms for someone already speaking. Someone not in a call
    // cannot be put in one by request from someone else.
    const bridge = loopback(BRUNO, async () => {})
    const bruno = new Call(bridge)

    await bruno.handleSignal(CHANNEL, ALICE, { t: "voice.move", subject: BRUNO, room: "estudio", at: 1 })

    expect(bruno.active).toBe(false)
    expect(bridge.sent).toHaveLength(0)
  })

  it("mover para a sala onde já se está não faz nada", async () => {
    const bridge = loopback(BRUNO, async () => {})
    const bruno = new Call(bridge)
    await bruno.join(CHANNEL, { room: "balcao" })
    const antes = bridge.sent.length

    await bruno.handleSignal(CHANNEL, ALICE, { t: "voice.move", subject: BRUNO, room: "balcao", at: 1 })

    expect(bridge.sent).toHaveLength(antes)
  })

  /**
   * And never to THE QUESTION ROOM, which is a reserved identifier.
   *
   * This branch obeys the `room` it receives without checking that the room exists, and
   * it is one of two remote paths through which an arbitrary identifier enters (the
   * other is `upsertRoom`, in the session). In 0.4.0 nothing would be lost by obeying,    * the sentinel is just an empty room, but whoever went there would start announcing
   * themselves with `room: "?quem"`, and in a victim on 0.3.3 in the same room those
   * announcements read as the goodbye that the original break was: the other device
   * of the same account deleted from the screen of those in there.
   */
  it("e nunca para a sala da pergunta, que é reservada", async () => {
    const bridge = loopback(BRUNO, async () => {})
    const bruno = new Call(bridge)
    await bruno.join(CHANNEL, { room: "balcao" })
    const mudancas: string[] = []
    bruno.on("moved", (event) => mudancas.push(event.room))
    const antes = bridge.sent.length

    await bruno.handleSignal(CHANNEL, ALICE, { t: "voice.move", subject: BRUNO, room: SALA_DA_PERGUNTA, at: 1 })

    // Did not leave the room where they were, there is no `voice.leave`, nor
    // announced in the sentinel, which is what would cost the old victim.
    expect(bridge.sent).toHaveLength(antes)
    expect(mudancas).toEqual([])
  })

  it("quem estava com vídeo continua com vídeo do outro lado", async () => {
    const bridge = loopback(BRUNO, async () => {})
    const bruno = new Call(bridge)
    await bruno.join(CHANNEL, { room: "balcao", video: true })

    await bruno.handleSignal(CHANNEL, ALICE, { t: "voice.move", subject: BRUNO, room: "estudio", at: 1 })

    const entrada = bridge.sent.filter((payload) => payload.t === "voice.join").at(-1)
    expect(entrada).toMatchObject({ room: "estudio", video: true })
  })

  /**
   * Being moved does not request the microphone again (2/11/2026, "a moderator cannot
   * move without user permission").
   *
   * Moving was leaving and entering from scratch: it stopped capture and opened another with a
   * new `getUserMedia`, without any gesture from the moved person. In a browser that did not
   * remember the microphone license (Firefox by default, Safari), that is the
   * browser dialog asking for permission again. Whoever was moved had to
   * click "Allow" for the change to happen.
   */
  it("ser movido não volta a pedir o microfone, e a mesma captura segue para a sala nova", async () => {
    const pedidos: MediaStream[] = []
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async (constraints: { video?: unknown }) => {
          const fluxo = fakeStream(Boolean(constraints.video))
          pedidos.push(fluxo)
          return fluxo
        },
      },
    })
    const bridge = loopback(BRUNO, async () => {})
    const bruno = new Call(bridge)
    await bruno.join(CHANNEL, { room: "balcao" })
    expect(pedidos).toHaveLength(1)

    await bruno.handleSignal(CHANNEL, ALICE, { t: "voice.move", subject: BRUNO, room: "estudio", at: 1 })

    expect(pedidos).toHaveLength(1)
    expect(pedidos[0]!.getAudioTracks()[0]!.stop).not.toHaveBeenCalled()
    expect(bridge.sent.filter((payload) => payload.t === "voice.join").at(-1)).toMatchObject({ room: "estudio" })

    // And leaving after releases capture for real: the microphone does not stay on.
    await bruno.leave()
    expect(pedidos[0]!.getAudioTracks()[0]!.stop).toHaveBeenCalled()
  })

  it("um clique noutra sala continua a abrir uma captura nova: só o mover a guarda", async () => {
    let pedidos = 0
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async (constraints: { video?: unknown }) => {
          pedidos++
          return fakeStream(Boolean(constraints.video))
        },
      },
    })
    const bruno = new Call(loopback(BRUNO, async () => {}))
    await bruno.join(CHANNEL, { room: "balcao" })
    await bruno.join(CHANNEL, { room: "estudio" })
    expect(pedidos).toBe(2)
  })

  it('"Desligar da chamada": sai da chamada, diz que saiu, e conta quem o desligou', async () => {
    const bridge = loopback(BRUNO, async () => {})
    const bruno = new Call(bridge)
    await bruno.join(CHANNEL, { room: "balcao" })
    const desligado: { channel: string; by: string }[] = []
    const fins: string[] = []
    bruno.on("desligado", (evento) => desligado.push(evento))
    bruno.on("ended", (evento) => fins.push(evento.channel))

    await bruno.handleSignal(CHANNEL, ALICE, {
      t: "voice.move",
      subject: BRUNO,
      room: SALA_DA_PERGUNTA,
      desligar: true,
      at: 1,
    })

    expect(bruno.active).toBe(false)
    expect(bridge.sent.at(-1)).toMatchObject({ t: "voice.leave", room: "balcao" })
    expect(fins).toEqual([CHANNEL])
    expect(desligado).toEqual([{ channel: CHANNEL, by: ALICE }])
  })

  it("desligar outra pessoa, ou fora da chamada, não mexe em nada", async () => {
    const bridge = loopback(BRUNO, async () => {})
    const bruno = new Call(bridge)
    const desligar = { t: "voice.move", room: SALA_DA_PERGUNTA, desligar: true, at: 1 } as const
    await bruno.handleSignal(CHANNEL, ALICE, { ...desligar, subject: BRUNO })
    expect(bridge.sent).toHaveLength(0)

    await bruno.join(CHANNEL, { room: "balcao" })
    const antes = bridge.sent.length
    await bruno.handleSignal(CHANNEL, ALICE, { ...desligar, subject: CARLA })
    await bruno.handleSignal("!outro:enclave.test", ALICE, { ...desligar, subject: BRUNO })
    expect(bridge.sent).toHaveLength(antes)
    expect(bruno.active).toBe(true)
  })
})

/**
 * Presence in a voice room, for those outside looking in.
 *
 * Report from the owner, August 18, 2026: "when they enter, they don't see me
 * in a call either" and "no call appears, users enter as if everything were
 * empty".
 *
 * The cause is the difference between two clocks that looked alike. `#comecarAnuncio`
 * exists to NEGOTIATE and stops at the first peer, after that there is nothing to
 * negotiate, and in the SFU path it never even starts, because with a server routing
 * there are no connections to set up. Except the sidebar of everyone is built from
 * those same `voice.join`, and timestamped: `presencasVivas` throws out anything not
 * reaffirmed within the window. With the announcement stopping, the list emptied itself
 * with people still speaking, and whoever arrived later had nothing to fill it again.
 *
 * So there are two things to prove, and neither implies the other: that presence
 * continues to be affirmed while the call lasts, and that an arrival is
 * answered without waiting for the next beat.
 */
describe("a presença numa sala de voz não caduca com a chamada de pé", () => {
  it("continua a reafirmar-se muito depois de a negociação ter acabado", async () => {
    vi.useFakeTimers()
    try {
      const bridge = loopback(ALICE, async () => {})
      const call = new Call(bridge)
      await call.join(CHANNEL, { room: "tasca" })

      // The call settles: one peer, connected, and nothing missing. It is exactly the
      // state in which the negotiation repeater goes quiet.
      await call.handleSignal(CHANNEL, BRUNO, { t: "voice.join", at: Date.now(), video: false, alone: false, sframe: false })
      for (const pc of FakePeerConnection.instances) pc.emitConnected()

      // After the minute the negotiation repeater gives up, and more.
      await vi.advanceTimersByTimeAsync(90_000)
      const antes = bridge.sent.filter((payload) => payload.t === "voice.join").length

      // Two minutes of conversation, with nothing happening in the call.
      await vi.advanceTimersByTimeAsync(120_000)

      const depois = bridge.sent.filter((payload) => payload.t === "voice.join")
      expect(depois.length).toBeGreaterThan(antes)
      // And it says which room it is: a reaffirmation without a room put the person in the default room,
      // which is another line in the sidebar.
      expect(depois.at(-1)).toMatchObject({ room: "tasca" })
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it("sair cala o batimento", async () => {
    // The contrast, and it is not decoration: a beat that survived leaving
    // put the person in a voice room they had already left, every thirty
    // seconds, forever.
    vi.useFakeTimers()
    try {
      const bridge = loopback(ALICE, async () => {})
      const call = new Call(bridge)
      await call.join(CHANNEL, { room: "tasca" })
      await call.leave()

      const antes = bridge.sent.filter((payload) => payload.t === "voice.join").length
      await vi.advanceTimersByTimeAsync(300_000)

      expect(bridge.sent.filter((payload) => payload.t === "voice.join").length).toBe(antes)
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it("alguém que chega é respondido sem esperar pelo batimento", async () => {
    vi.useFakeTimers()
    try {
      const bridge = loopback(ALICE, async () => {})
      const call = new Call(bridge)
      await call.join(CHANNEL, { room: "tasca" })
      await call.handleSignal(CHANNEL, BRUNO, { t: "voice.join", at: Date.now(), video: false, alone: false, sframe: false })
      for (const pc of FakePeerConnection.instances) pc.emitConnected()
      await vi.advanceTimersByTimeAsync(90_000)

      const antes = bridge.sent.filter((payload) => payload.t === "voice.join").length

      // Carla opened the app. The server tells us she arrived.
      call.reafirmarPresenca()
      await vi.advanceTimersByTimeAsync(1000)

      const depois = bridge.sent.filter((payload) => payload.t === "voice.join")
      expect(depois.length).toBe(antes + 1)
      expect(depois.at(-1)).toMatchObject({ room: "tasca" })
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it("um servidor a voltar com vinte pessoas custa um anúncio, e não vinte", async () => {
    // The storm that the delay exists to prevent. Without it, each person in
    // a call replied to each arrival, and a server restarting brings everyone
    // at the same time.
    vi.useFakeTimers()
    try {
      const bridge = loopback(ALICE, async () => {})
      const call = new Call(bridge)
      await call.join(CHANNEL, { room: "tasca" })
      const antes = bridge.sent.filter((payload) => payload.t === "voice.join").length

      for (let i = 0; i < 20; i += 1) call.reafirmarPresenca()
      await vi.advanceTimersByTimeAsync(1000)

      expect(bridge.sent.filter((payload) => payload.t === "voice.join").length).toBe(antes + 1)
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it("fora de uma chamada não se reafirma coisa nenhuma", async () => {
    vi.useFakeTimers()
    try {
      const bridge = loopback(ALICE, async () => {})
      const call = new Call(bridge)

      call.reafirmarPresenca()
      await vi.advanceTimersByTimeAsync(1000)

      expect(bridge.sent).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  /**
   * And the epoch, which is the cheap trigger.
   *
   * Whoever enters the channel makes the epoch move, and the epoch change already
   * reaches the `Call` through both bridges, it is through it that the media key rotates. Using it
   * costs one line and covers the case where the presence warning was lost.
   */
  it("uma epoch nova faz reafirmar a presença", async () => {
    vi.useFakeTimers()
    try {
      const bridge = loopback(ALICE, async () => {})
      const call = new Call(bridge)
      await call.join(CHANNEL, { room: "tasca" })
      const antes = bridge.sent.filter((payload) => payload.t === "voice.join").length

      await call.rekey(CHANNEL)
      await vi.advanceTimersByTimeAsync(1000)

      expect(bridge.sent.filter((payload) => payload.t === "voice.join").length).toBe(antes + 1)
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it("uma epoch de OUTRO canal não faz reafirmar nada", async () => {
    vi.useFakeTimers()
    try {
      const bridge = loopback(ALICE, async () => {})
      const call = new Call(bridge)
      await call.join(CHANNEL, { room: "tasca" })
      const antes = bridge.sent.filter((payload) => payload.t === "voice.join").length

      await call.rekey("!outro:enclave.test")
      await vi.advanceTimersByTimeAsync(1000)

      expect(bridge.sent.filter((payload) => payload.t === "voice.join").length).toBe(antes)
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)
})

/**
 * The resolution stepping down, on the path where it steps down FIRST.
 *
 * The SFU measurement is in `call-sfu.test.ts`. This block is the mesh, and it is
 * not the least important case: it is the tightest. Someone sharing on a mesh sends
 * one copy per person, and a home uplink with three peers hits the cap
 * long before a server does. Reading only the SFU path would leave silent exactly the
 * situation where the image is lowest.
 */
describe("a imagem que sai cortada, na malha", () => {
  beforeEach(() => {
    FakePeerConnection.instances = []
  })

  async function comDoisPares(): Promise<{ alice: Call; ligacao: FakePeerConnection }> {
    let bruno: Call
    const aliceBridge = loopback(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(aliceBridge)
    const brunoBridge = loopback(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(brunoBridge)

    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)

    const ligacao = FakePeerConnection.instances[0] as FakePeerConnection
    ligacao.emitConnected()
    return { alice, ligacao }
  }

  it("lê o `outbound-rtp` da ligação ao par", async () => {
    const { alice, ligacao } = await comDoisPares()
    ligacao.estatisticas = [
      { type: "outbound-rtp", kind: "video", qualityLimitationReason: "bandwidth", frameHeight: 540 },
    ]

    expect(await alice.medirLimiteDeVideo()).toEqual({ razao: "bandwidth", altura: 540 })
  })

  it("uma ligação que ainda não ligou não conta", async () => {
    let bruno: Call
    const aliceBridge = loopback(ALICE, (payload) => bruno.handleSignal(CHANNEL, ALICE, payload))
    const alice = new Call(aliceBridge)
    const brunoBridge = loopback(BRUNO, (payload) => alice.handleSignal(CHANNEL, BRUNO, payload))
    bruno = new Call(brunoBridge)

    await alice.join(CHANNEL)
    await bruno.join(CHANNEL)

    // Without `emitConnected()`: the connection exists and the encoder has not yet
    // put a frame on the wire. Asking it is asking for an image that is not
    // going out, and the answer would be a warning about nothing.
    const ligacao = FakePeerConnection.instances[0] as FakePeerConnection
    ligacao.estatisticas = [
      { type: "outbound-rtp", kind: "video", qualityLimitationReason: "bandwidth", frameHeight: 180 },
    ]

    expect(await alice.medirLimiteDeVideo()).toBeNull()
  })

  it("um `getStats()` que falha não derruba a leitura", async () => {
    const { alice, ligacao } = await comDoisPares()
    // `estatisticas` to `null` causes the double throw, like a connection closing
    // under the question. It is the same class of case as a sender on debut on the
    // SFU path, and the answer has to be the same: silence, not an
    // exception bubbling up to a poll that runs every four seconds.
    expect(ligacao.estatisticas).toBeNull()

    expect(await alice.medirLimiteDeVideo()).toBeNull()
  })
})

/**
 * The click that asked for nothing, and yet brought down the call.
 *
 * Owner report on September 10, 2026: in a voice room, clicking on it again
 * "reconnects to the room". Nothing should happen, and what happened was the entire entry:
 * `#leave(true)` first, which sends a `voice.leave`, kills the producers in the router
 * and stops capture, and only then entry from scratch. Seen from the other side,
 * the person disappeared and reappeared because of a finger.
 *
 * The guard lives in the core and not on the screen on purpose: whoever calls `join` is
 * not just the sidebar, and a request exactly equal to the state already in
 * has nothing to redo, no matter where it comes from.
 */
describe("entrar na sala onde já se está", () => {
  it("não manda nada para o fio: nem saída, nem entrada nova", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL, { room: "voz" })

    const depoisDeEntrar = bridge.sent.length
    // Entry announces itself; if this were zero, the next test would prove nothing.
    expect(depoisDeEntrar).toBeGreaterThan(0)

    await alice.join(CHANNEL, { room: "voz" })

    expect(bridge.sent.length).toBe(depoisDeEntrar)
    expect(bridge.sent.filter((payload) => payload.t === "voice.leave")).toHaveLength(0)
  })

  it("a captura não é refeita, que é o que corta o som a quem já falava", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL, { room: "voz" })
    const faixas = alice.localStream?.getTracks() ?? []
    expect(faixas.length).toBeGreaterThan(0)

    await alice.join(CHANNEL, { room: "voz" })

    // The SAME streams, and live: a re-entry stops them and requests others.
    expect(alice.localStream?.getTracks()).toEqual(faixas)
    for (const faixa of faixas) expect(faixa.readyState).not.toBe("ended")
  })

  it("mudar de sala continua a trocar de chamada", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL, { room: "voz" })
    bridge.sent.length = 0

    await alice.join(CHANNEL, { room: "outra-voz" })

    // The guard cannot silence the switch: two rooms are two calls.
    expect(bridge.sent.some((payload) => payload.t === "voice.leave")).toBe(true)
    expect(bridge.sent.some((payload) => payload.t === "voice.join")).toBe(true)
  })

  it("pedir vídeo na sala onde se está de voz não é o mesmo pedido", async () => {
    const bridge = loopback(ALICE, async () => {})
    const alice = new Call(bridge)
    await alice.join(CHANNEL, { room: "voz" })
    bridge.sent.length = 0

    await alice.join(CHANNEL, { room: "voz", video: true })

    expect(bridge.sent.some((payload) => payload.t === "voice.join")).toBe(true)
  })
})
