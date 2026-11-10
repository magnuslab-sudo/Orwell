import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import type { EnclaveBridge } from "../bridge.js"
import type { SessionStatus } from "../lib/statusPolicy.js"
import { useSessionEvents, type SessionEventHandlers } from "./useSessionEvents.js"

/**
 * A report decision reaches the bridge to `App`.
 *
 * Found in testing for 1.3.0 (4/11/2026, `scripts/e2e-denuncias.mjs`): the session
 * emitted `denuncia-decidida` with the `decisao`, but the hook copied the state field
 * by field and left `decisao` behind. `App` only puts the decision in the bell with it,
 * and the person who reported never saw it.
 */

afterEach(cleanup)

function ponte(): { bridge: EnclaveBridge; emitir: (carga: unknown) => void } {
  let ouvinte: ((carga: unknown) => void) | null = null
  const bridge = {
    call: { on: () => () => {} },
    on: new Proxy(
      {},
      {
        get: (_alvo, nome) =>
          nome === "status"
            ? (fn: (carga: unknown) => void) => {
                ouvinte = fn
                return () => {}
              }
            : () => () => {},
      },
    ),
  } as unknown as EnclaveBridge
  return { bridge, emitir: (carga) => ouvinte?.(carga) }
}

function Casca({ bridge, recebidos }: { bridge: EnclaveBridge; recebidos: SessionStatus[] }): null {
  useSessionEvents(bridge, {
    onStatus: (status) => recebidos.push(status),
    onMessage: () => {},
    onEpoch: () => {},
    onConnection: () => {},
    onChannels: () => {},
    onCallParticipants: () => {},
    onCallLocalStream: () => {},
    onCallScreen: () => {},
    onCallEnded: () => {},
    onCallDiagnostic: () => {},
    onCallError: () => {},
    onPresence: () => {},
    onCallActivity: () => {},
    onCallMoved: () => {},
  } satisfies SessionEventHandlers)
  return null
}

describe("useSessionEvents e a decisão de uma denúncia", () => {
  it("passa a decisão do `denuncia-decidida`, e só as duas que existem", () => {
    const { bridge, emitir } = ponte()
    const recebidos: SessionStatus[] = []
    render(<Casca bridge={bridge} recebidos={recebidos} />)
    act(() => {
      emitir({ detail: "", code: "denuncia-decidida", decisao: "suspensa" })
      emitir({ detail: "", code: "denuncia-decidida", decisao: "sem-accao" })
      emitir({ detail: "", code: "denuncia-decidida", decisao: "outra" })
      emitir({ detail: "", code: "outro-codigo", decisao: "suspensa" })
    })
    expect(recebidos.map((s) => s.decisao)).toEqual(["suspensa", "sem-accao", undefined, undefined])
  })
})
