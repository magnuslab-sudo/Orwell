import { Payload, type UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Call, ehPerguntaDePresenca, type CallBridge, type MediaKeyMaterial } from "./call.js"

/**
 * The AFK room in the call (2/11/2026): presence, and nothing else.
 *
 * "The room is like any other but receives no text, and there is no voice"
 * (the owner). The server does not know which room it is (the tag travels
 * encrypted), so each refusal lives here in the core, and each one has its own
 * test: no microphone, no SFU, no negotiation, no screen, no music, and silent
 * in the announcement no matter what.
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

const SALA_AFK = "contio-afk"
const SALA_VOZ = "contio-geral"

type Ponte = CallBridge & {
  sent: { channel: string; payload: Payload }[]
  portao: boolean[]
  suportaSfu: ReturnType<typeof vi.fn>
}

function ponte(selfAddress: UserAddress, comAfk = true): Ponte {
  const sent: { channel: string; payload: Payload }[] = []
  const portao: boolean[] = []
  const suportaSfu = vi.fn(() => false)
  return {
    selfAddress,
    sent,
    portao,
    suportaSfu,
    async sendSignal(channel, payload) {
      sent.push({ channel, payload })
    },
    async mediaKey(): Promise<MediaKeyMaterial | null> {
      return { keyId: 1, senderId: 0, material: new Uint8Array(28) }
    },
    async reservarContadorSframe(): Promise<number> {
      return 0
    },
    async setMediaActive(activo: boolean) {
      portao.push(activo)
    },
    sfu: { suportaSfu } as unknown as CallBridge["sfu"],
    ...(comAfk ? { salaAfk: async (_canal: string, sala: string) => sala === SALA_AFK } : {}),
  }
}

const joins = (p: Ponte): Extract<Payload, { t: "voice.join" }>[] =>
  p.sent.map((cada) => cada.payload).filter((payload): payload is Extract<Payload, { t: "voice.join" }> => payload.t === "voice.join")

let getUserMedia: ReturnType<typeof vi.fn>
let getDisplayMedia: ReturnType<typeof vi.fn>

beforeEach(() => {
  FakePeerConnection.instances = []
  getUserMedia = vi.fn(async () => fakeStream())
  getDisplayMedia = vi.fn(async () => fakeStream())
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  vi.stubGlobal("RTCRtpSender", class {})
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, getDisplayMedia } })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const joinDe = (room: string, joinId = "aaaaaaaaaaaaaaaaaaaaaaaa"): Payload =>
  ({ t: "voice.join", at: Date.now(), video: false, sframe: false, alone: false, muted: false, room, joinId }) as Payload

describe("entrar na sala AFK", () => {
  it("não abre o microfone nem o portão de media do anfitrião", async () => {
    const p = ponte(ALICE)
    const call = new Call(p)
    await call.join(CANAL, { room: SALA_AFK })
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(p.portao).toEqual([])
    expect(call.emSalaAfk).toBe(true)
    expect(call.localStream).toBeNull()
  })

  it("não pergunta pelo SFU nem lhe manda nada", async () => {
    const p = ponte(ALICE)
    const call = new Call(p)
    await call.join(CANAL, { room: SALA_AFK })
    expect(p.suportaSfu).not.toHaveBeenCalled()
  })

  it("anuncia-se na sala, calado, para os outros a verem na lista", async () => {
    const p = ponte(ALICE)
    const call = new Call(p)
    await call.join(CANAL, { room: SALA_AFK })
    expect(joins(p).at(-1)).toMatchObject({ room: SALA_AFK, muted: true, video: false })
  })

  it("ligar o microfone lá dentro não liga nada: o anúncio continua calado", async () => {
    vi.useFakeTimers()
    const p = ponte(ALICE)
    const call = new Call(p)
    await call.join(CANAL, { room: SALA_AFK, video: true })
    call.setMuted(true)
    call.setMuted(false)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(joins(p).every((join) => join.muted === true && join.video === false)).toBe(true)
  })

  it("quem lá está entra na lista, sem ligação nenhuma montada", async () => {
    const p = ponte(ALICE)
    const call = new Call(p)
    const listas: string[][] = []
    call.on("participants", ({ participants }) => listas.push(participants.map((quem) => quem.address)))
    await call.join(CANAL, { room: SALA_AFK })
    await call.handleSignal(CANAL, BRUNO, joinDe(SALA_AFK))
    expect(listas.at(-1)).toEqual([BRUNO])
    expect(FakePeerConnection.instances).toHaveLength(0)
    // And replied with its announcement so it can see us too.
    expect(joins(p).length).toBeGreaterThanOrEqual(2)
  })

  it("quem sai sai da lista", async () => {
    const p = ponte(ALICE)
    const call = new Call(p)
    const listas: string[][] = []
    call.on("participants", ({ participants }) => listas.push(participants.map((quem) => quem.address)))
    await call.join(CANAL, { room: SALA_AFK })
    await call.handleSignal(CANAL, BRUNO, joinDe(SALA_AFK))
    await call.handleSignal(CANAL, BRUNO, { t: "voice.leave", at: Date.now(), room: SALA_AFK } as Payload)
    expect(listas.at(-1)).toEqual([])
  })

  it("uma oferta de um cliente antigo ignora-se: não há resposta nem ligação", async () => {
    const p = ponte(ALICE)
    const call = new Call(p)
    const diagnosticos: string[] = []
    call.on("diagnostic", ({ code }) => diagnosticos.push(code))
    await call.join(CANAL, { room: SALA_AFK })
    const antes = p.sent.length
    await call.handleSignal(CANAL, BRUNO, {
      t: "voice.offer",
      to: ALICE,
      sdp: "v=0\r\n",
      room: SALA_AFK,
    } as unknown as Payload)
    expect(FakePeerConnection.instances).toHaveLength(0)
    expect(p.sent.slice(antes).some((cada) => cada.payload.t === "voice.answer")).toBe(false)
    expect(diagnosticos).toContain("call-afk-oferta-ignorada")
  })

  it("partilhar o ecrã é recusado antes do selector do sistema", async () => {
    const p = ponte(ALICE)
    const call = new Call(p)
    const erros: string[] = []
    call.on("error", ({ detail }) => erros.push(detail))
    await call.join(CANAL, { room: SALA_AFK })
    expect(call.podePartilharEcra).toBe(false)
    expect(await call.startScreenShare()).toBe(false)
    expect(getDisplayMedia).not.toHaveBeenCalled()
    expect(erros).toContain("the afk room has no voice and no text")
  })

  it("pôr música (DJ) é recusado", async () => {
    const p = ponte(ALICE)
    const call = new Call(p)
    const erros: string[] = []
    call.on("error", ({ detail }) => erros.push(detail))
    await call.join(CANAL, { room: SALA_AFK })
    const faixa = { kind: "audio", stop: vi.fn() } as unknown as MediaStreamTrack
    expect(await call.partilharMusica(faixa, "Fado")).toBe(false)
    expect(erros).toContain("the afk room has no voice and no text")
  })
})

describe("sair da sala AFK", () => {
  it("voltar a uma sala de voz normal abre o microfone outra vez", async () => {
    const p = ponte(ALICE)
    const call = new Call(p)
    await call.join(CANAL, { room: SALA_AFK })
    await call.join(CANAL, { room: SALA_VOZ })
    expect(call.emSalaAfk).toBe(false)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(p.portao).toContain(true)
  })

  it("ser movido para a sala AFK por quem modera também é presença só", async () => {
    const p = ponte(ALICE)
    const call = new Call(p)
    await call.join(CANAL, { room: SALA_VOZ })
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    await call.handleSignal(CANAL, BRUNO, { t: "voice.move", subject: ALICE, room: SALA_AFK, at: Date.now() } as unknown as Payload)
    expect(call.emSalaAfk).toBe(true)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it("um anfitrião sem `salaAfk` (antigo) entra como sempre", async () => {
    const p = ponte(ALICE, false)
    const call = new Call(p)
    await call.join(CANAL, { room: SALA_AFK })
    expect(call.emSalaAfk).toBe(false)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })
})
