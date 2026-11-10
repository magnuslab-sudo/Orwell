import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "./bridge.js"
import { App } from "./App.js"
import { diagnosticsSnapshot } from "./lib/diagnostics.js"
import { strings } from "./strings.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_EU = moradaDeTeste("mural eu", "casa.pt")

afterEach(cleanup)

// jsdom has no media pipeline: without this, `play()` returns `undefined` and the
// `.catch` in `VideoTile` brings down the whole tree to `ErrorBoundary`.
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const LAGAR = "!lagar:casa.pt"

/**
 * The diagnostic reached the log and never the screen.
 *
 * `onCallDiagnostic` wrote everything with `recordDiagnostic` and nothing else. For
 * the mechanics that is right, and still is: nobody needs to know how many ICE
 * servers came. For three codes it was wrong, because they describe a call that
 * will not work.
 *
 * The worst of all is documented in `call.ts` itself, next to the `emit`:
 * two people in the same room can be on different media paths, one through the
 * SFU and the other through the mesh, and never hear each other. The offer that
 * comes by the wrong path is ignored on purpose, leaves one line in the log, and
 * the core's comment anticipates the outcome in writing: "the person on the other
 * side will see 'calling' until they give up and someone asks why".
 *
 * This file measures the entire connection: the core emits, the shell decides, and
 * the screen says. It also measures the half that stops the cure from becoming
 * the disease: the mechanics still go only to the log.
 */

let onCallDiagnostic: ((event: { code: string; detail?: string }) => void) | null = null
let onCallParticipants: ((event: { participants: unknown[] }) => void) | null = null
let onCallEnded: (() => void) | null = null

function ponte(): EnclaveBridge {
  onCallDiagnostic = null
  onCallParticipants = null
  onCallEnded = null
  return {
    vault: {
      status: async () => ({ exists: true, supportsOsProtection: true }),
      unlock: async () => ({ ok: true }),
      create: async () => ({ ok: true }),
      lock: async () => ({ ok: true }),
      destroy: async () => ({ ok: true }),
    },
    identity: {
      load: async () => ({ address: EU, accountId: "eu" }),
      create: async () => ({ address: EU, accountId: "eu" }),
    },
    session: {
      connect: async () => ({ ok: true }),
      capabilities: async () => ["mls"],
      setVisible: async () => ({ ok: true }),
    },
    channels: {
      list: async () => [LAGAR],
      create: async () => ({ ok: true }),
      invite: async () => ({ ok: true }),
      channelInvites: async () => [],
      acceptChannelInvite: vi.fn(async () => ({ ok: true })),
      declineChannelInvite: vi.fn(async () => ({ ok: true })),
      send: async () => ({ ok: true }),
      typing: async () => ({ ok: true }),
      buzz: async () => ({ ok: true }),
      members: async () => [EU, ANA],
      history: async () => [],
      forget: async () => ({ ok: true }),
      safetyNumber: async () => null,
      // A voice room, which is how you enter a channel call: without it
      // there is no call panel, and it is the panel that brings the alert banner.
      rooms: () => [{ room: "voz", name: "voz", category: "", kind: "voice", position: 0 }],
    },
    invites: {
      create: async () => "enclave://join/x/y#z",
      redeem: async () => ({ ok: true }),
      list: async () => [],
      revoke: async () => ({ ok: true }),
    },
    social: {
      post: async () => ({ ok: true }),
      acceptFollower: vi.fn().mockResolvedValue({ ok: true }),
      acceptFriend: vi.fn().mockResolvedValue({ ok: true }),
      declineFriend: vi.fn().mockResolvedValue({ ok: true }),
      unfriend: vi.fn().mockResolvedValue({ ok: true }),
      repairInvite: async () => ({ invited: true }),
      deadWelcomes: async () => [],
      feedChannel: async () => MURAL_EU,
    },
    profile: {
      get: async () => ({ displayName: "Vera", donations: [] }),
      set: async () => ({ ok: true }),
      // The directory is what gives Ana her name. Without it the alert would come
      // with the raw address, which is barely an alert.
      directory: async () => ({ [ANA]: { payload: { t: "profile", displayName: "Ana" } } }),
    },
    notifications: { list: async () => [], save: async () => ({ ok: true }) },
    on: {
      message: () => () => {},
      epoch: () => () => {},
      status: () => () => {},
      connection: () => () => {},
      channels: () => () => {},
      presence: () => () => {},
      typing: () => () => {},
      buzz: () => () => {},
      callActivity: () => () => {},
    },
    call: {
      on: (nome: string, handler: (event: never) => void) => {
        if (nome === "diagnostic") onCallDiagnostic = handler as never
        if (nome === "participants") onCallParticipants = handler as never
        if (nome === "ended") onCallEnded = handler as never
        return () => {}
      },
      setMuted: () => {},
      setCameraOff: () => {},
      join: async () => ({ ok: true }),
      leave: async () => ({ ok: true }),
      tectoDePartilha: 6,
      podePartilharEcra: false,
    },
  } as unknown as EnclaveBridge
}

/**
 * Open the app, join a call, and put someone in it.
 *
 * The panel only draws with a call active in the open channel, and it is the
 * panel that brings the banner: the whole sheet of the path has to be mounted
 * for the alert to have a place to appear.
 */
async function comChamadaAberta(): Promise<void> {
  render(<App bridge={ponte()} />)
  await screen.findByRole("button", { name: strings.rail.chat })

  const linha = [...document.querySelectorAll(".channel-row")].find((row) => /lagar/.test(row.textContent ?? ""))
  await act(async () => {
    ;(linha?.querySelector("button") as HTMLElement).click()
    await Promise.resolve()
  })
  // Joining the voice room is the normal gesture, and it is what opens the panel.
  const entrar = [...document.querySelectorAll<HTMLElement>(".room-row")].find((row) =>
    /voz/i.test(row.textContent ?? ""),
  )
  await act(async () => {
    ;(entrar?.querySelector("button") ?? entrar)?.click()
    await Promise.resolve()
  })
  await act(async () => {
    onCallParticipants?.({ participants: [{ address: ANA, connected: false, stream: null }] })
    await Promise.resolve()
  })
}

async function diagnostico(code: string, detail?: string): Promise<void> {
  await act(async () => {
    onCallDiagnostic?.(detail === undefined ? { code } : { code, detail })
    await Promise.resolve()
  })
}

describe("o diagnóstico do núcleo chega ao ecrã, e não só ao registo", () => {
  it("uma oferta de malha numa chamada por SFU é dita, com o nome de quem", async () => {
    await comChamadaAberta()
    await diagnostico("call-caminho", "sfu")
    await diagnostico("call-sfu-oferta-de-malha", ANA)

    // The fault that `call.ts` documents: neither of them hears the other, and
    // until now neither had a way to know why.
    expect(await screen.findByText(strings.call.avisoCaminhosDiferentesDe("Ana"))).toBeTruthy()
  })

  it("e continua a ir para o registo, que é de onde um relato se copia", async () => {
    await comChamadaAberta()
    await diagnostico("call-sfu-oferta-de-malha", ANA)
    expect(diagnosticsSnapshot().some((linha) => linha.code === "call-sfu-oferta-de-malha")).toBe(true)
  })

  it("o caminho manda nas palavras: com SFU, quem não se ouve está na chamada", async () => {
    await comChamadaAberta()
    await diagnostico("call-caminho", "sfu")
    // Two on purpose: the person's card and their video box. The two halves
    // of the screen cannot say different things about the same person.
    expect((await screen.findAllByText(strings.call.naChamadaSemSom)).length).toBeGreaterThan(0)
  })

  it("sem o núcleo dizer o caminho, o ecrã fala como a malha sempre falou", async () => {
    await comChamadaAberta()
    expect((await screen.findAllByText(strings.call.connecting)).length).toBeGreaterThan(0)
  })

  it("a mecânica que corre bem continua muda, que é como tem de ser", async () => {
    await comChamadaAberta()
    await diagnostico("call-sfu-ligado", "sala")
    await diagnostico("call-caminho", "sfu")
    // No banner or toast. One alert per pipeline line is the column of popups
    // that `statusPolicy` exists to avoid repeating.
    expect(document.querySelector(".call-aviso")).toBeNull()
  })

  it("quem ainda não tem chave tem aviso com código, e o aviso sai quando a chave chega", async () => {
    await comChamadaAberta()
    await diagnostico("sfu-receptor-sem-chave", ANA)
    expect(document.querySelector(".call-aviso")?.textContent).toContain(strings.errors.codigo(447))

    await diagnostico("sfu-receptor-protegido-depois", ANA)
    expect(document.querySelector(".call-aviso")).toBeNull()
  })

  it("a nossa voz à espera da cifra tem aviso com o 449, e o aviso sai quando a voz sai (4/11/2026)", async () => {
    await comChamadaAberta()
    await diagnostico("sfu-emissor-cifra-a-repetir", "microfone · 2/7 · 500 ms")
    expect(document.querySelector(".call-aviso")?.textContent).toContain(strings.errors.codigo(449))

    await diagnostico("sfu-emissor-cifra-recuperada", "microfone · 3/7")
    expect(document.querySelector(".call-aviso")).toBeNull()
  })

  it("o som de alguém em falta tem aviso com o 453, e o aviso sai quando o som abre (4/11/2026)", async () => {
    await comChamadaAberta()
    await diagnostico("sfu-consumo-em-falta", `${ANA} · microfone · p-1`)
    expect(document.querySelector(".call-aviso")?.textContent).toContain(strings.errors.codigo(453))

    await diagnostico("sfu-consumo-recuperado", `p-1 · ${ANA} · tentativa 2`)
    expect(document.querySelector(".call-aviso")).toBeNull()
  })

  it("o aviso morre com a chamada, e não vai ao colo da seguinte", async () => {
    await comChamadaAberta()
    await diagnostico("call-sfu-oferta-de-malha", ANA)
    expect(document.querySelector(".call-aviso")).toBeTruthy()

    await act(async () => {
      onCallEnded?.()
      await Promise.resolve()
    })
    expect(document.querySelector(".call-aviso")).toBeNull()
  })
})
