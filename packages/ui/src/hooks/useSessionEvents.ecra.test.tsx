import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import type { EnclaveBridge } from "../bridge.js"
import { strings } from "../strings.js"
import { CallDock } from "../screens/call/CallDock.js"
import { useSessionEvents, type SessionEventHandlers } from "./useSessionEvents.js"

/**
 * The "Sharing screen" line in the dock, connected end-to-end.
 *
 * The dock was born with this line READY and disconnected, waiting for Phase 3: nothing
 * in the product wired up `aPartilharEcra`, and there was a test preventing someone from
 * turning it on by accident. What remains to prove now is the other half, that the
 * `screen` from the call engine reaches the dock for real, and that it toggles the line.
 *
 * No spying here: mount the same hook the `App` mounts, fire the event from the call engine,
 * and read the dock. Without the subscription, without `onCallScreen`, or with the dock
 * wired to the wrong prop, the line does not change and this turns red.
 */

afterEach(cleanup)

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

/** The call engine, reduced to what it emits. */
function motorDeChamada(): {
  bridge: EnclaveBridge
  emitir: (evento: string, carga: unknown) => void
  ouvintes: Map<string, ((carga: unknown) => void)[]>
} {
  const ouvintes = new Map<string, ((carga: unknown) => void)[]>()
  const bridge = {
    call: {
      on: (evento: string, ouvinte: (carga: unknown) => void) => {
        ouvintes.set(evento, [...(ouvintes.get(evento) ?? []), ouvinte])
        return () => {}
      },
    },
    on: new Proxy({}, { get: () => () => () => {} }),
  } as unknown as EnclaveBridge

  return {
    bridge,
    ouvintes,
    emitir: (evento, carga) => {
      for (const ouvinte of ouvintes.get(evento) ?? []) ouvinte(carga)
    },
  }
}

function fluxoDeEcra(): MediaStream {
  const faixa = { kind: "video", enabled: true, stop: () => {} }
  return {
    id: "ecra-nosso",
    getTracks: () => [faixa],
    getVideoTracks: () => [faixa],
    getAudioTracks: () => [],
  } as unknown as MediaStream
}

/**
 * The `App`, reduced to the path that matters: the hook, the state, and the dock.
 *
 * Nothing here is a stub of the dock, it is the dock for real, with the prop coming from
 * where it comes from in the product.
 */
function Casca({ bridge }: { bridge: EnclaveBridge }): React.JSX.Element {
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)

  useSessionEvents(bridge, {
    onCallScreen: setScreenStream,
    // The rest of the contract, which this test does not exercise.
    onMessage: () => {},
    onStatus: () => {},
    onEpoch: () => {},
    onConnection: () => {},
    onChannels: () => {},
    onCallParticipants: () => {},
    onCallLocalStream: () => {},
    onCallEnded: () => {},
    onCallDiagnostic: () => {},
    onCallError: () => {},
    onPresence: () => {},
    onCallActivity: () => {},
    onCallMoved: () => {},
  } satisfies SessionEventHandlers)

  return (
    <CallDock
      channel="!lagar:s"
      channelLabel="Lagar do Zé"
      roomLabel="pátio"
      aPartilharEcra={screenStream !== null}
      participants={[]}
      localStream={null}
      nameFor={(quem) => quem}
      onBack={() => {}}
      onLeave={() => {}}
    />
  )
}

describe("a doca diz que se está a partilhar o ecrã, e deixa de o dizer", () => {
  it("o `screen` do motor troca a linha, e o `null` repõe-na", () => {
    const { bridge, emitir } = motorDeChamada()
    render(<Casca bridge={bridge} />)

    // Before sharing starts, the dock says what it always said.
    expect(screen.getByText(strings.callDock.emChamada)).toBeTruthy()
    expect(screen.queryByText(strings.callDock.aPartilharEcra)).toBeNull()

    act(() => emitir("screen", { stream: fluxoDeEcra() }))

    expect(screen.getByText(strings.callDock.aPartilharEcra)).toBeTruthy()
    expect(screen.queryByText(strings.callDock.emChamada)).toBeNull()

    /*
      And the path that gets forgotten: whoever stops sharing via the browser bar does not
      go through any line of our interface. The engine emits `screen` with `null` anyway,
      and the dock must go back, otherwise it keeps saying "Sharing screen" for the rest of
      the call, about nothing.
    */
    act(() => emitir("screen", { stream: null }))

    expect(screen.getByText(strings.callDock.emChamada)).toBeTruthy()
    expect(screen.queryByText(strings.callDock.aPartilharEcra)).toBeNull()
  })

  it("e a subscrição é feita mesmo: o motor tem quem o ouça no `screen`", () => {
    // The half that the test above cannot tell from a coincidence: without this, a shell
    // wiring the dock to anything else could pass through.
    const { bridge, ouvintes } = motorDeChamada()
    render(<Casca bridge={bridge} />)
    expect(ouvintes.get("screen") ?? []).toHaveLength(1)
  })
})
