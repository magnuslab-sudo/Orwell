import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, PairEvento } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { AcrescentarAparelho } from "./AcrescentarAparelho.js"

afterEach(cleanup)

/**
 * One "Close" per phase.
 *
 * Duarte opened this on his phone and saw two identical buttons on the same
 * screen. The cause was simple: the header had a "Close" in all phases, and the
 * final phases added another in the body, which is where the eye goes after
 * reading what happened. Two exits with the same name read like two different
 * things.
 *
 * This test walks through the six phases and counts. While pairing is happening
 * there is one exit (the header one); when it finishes there is one exit (the
 * body one). Never two.
 */
function ponte(): { bridge: EnclaveBridge; emitir: (evento: PairEvento) => void } {
  let ouvinte: ((evento: PairEvento) => void) | null = null
  const bridge = {
    pairing: {
      status: vi.fn(),
      devices: vi.fn(),
      host: vi.fn(async () => {}),
      join: vi.fn(),
      confirm: vi.fn(async () => {}),
      refuse: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      done: vi.fn(),
    },
    on: {
      pair: (fn: (evento: PairEvento) => void) => {
        ouvinte = fn
        return () => {
          ouvinte = null
        }
      },
    },
  } as unknown as EnclaveBridge
  return {
    bridge,
    emitir: (evento: PairEvento): void => {
      act(() => {
        ouvinte?.(evento)
      })
    },
  }
}

/** The buttons whose label is "Close", which is what the user sees repeated. */
function saidas(): HTMLElement[] {
  return screen.queryAllByRole("button", { name: strings.common.close })
}

describe("acrescentar aparelho: as saídas da folha", () => {
  it('nenhuma das seis fases desenha dois botões "Fechar"', () => {
    const fechar = vi.fn()
    const { bridge, emitir } = ponte()
    render(
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <AcrescentarAparelho onClose={fechar} />
        </ToastProvider>
      </BridgeContext.Provider>,
    )

    // a-abrir: no event has arrived yet.
    expect(saidas()).toHaveLength(1)

    emitir({ fase: "aguarda", link: "https://exemplo.pt/emparelhar#abc" } as PairEvento)
    expect(saidas()).toHaveLength(1)

    emitir({ fase: "ligado" } as PairEvento)
    expect(saidas()).toHaveLength(1)

    emitir({ fase: "sas", palavras: "uma-duas-tres-quatro-cinco-seis" } as PairEvento)
    expect(saidas()).toHaveLength(1)

    emitir({ fase: "concluido" } as PairEvento)
    expect(saidas()).toHaveLength(1)
  })

  it("na fase que falhou também há uma só saída, e é a do corpo", () => {
    const fechar = vi.fn()
    const { bridge, emitir } = ponte()
    render(
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <AcrescentarAparelho onClose={fechar} />
        </ToastProvider>
      </BridgeContext.Provider>,
    )
    emitir({ fase: "falhou", razao: "palavras-diferentes" } as PairEvento)
    const botoes = saidas()
    expect(botoes).toHaveLength(1)
    // The one in the body, not the header one: it is inside the action area.
    expect(botoes[0]?.closest(".sheet-actions")).not.toBeNull()
    expect(botoes[0]?.closest(".sheet-header")).toBeNull()
  })

  it("enquanto o emparelhamento decorre a saída é a do cabeçalho", () => {
    const fechar = vi.fn()
    const { bridge, emitir } = ponte()
    render(
      <BridgeContext.Provider value={bridge}>
        <ToastProvider>
          <AcrescentarAparelho onClose={fechar} />
        </ToastProvider>
      </BridgeContext.Provider>,
    )
    emitir({ fase: "sas", palavras: "uma-duas-tres-quatro-cinco-seis" } as PairEvento)
    const botoes = saidas()
    expect(botoes).toHaveLength(1)
    expect(botoes[0]?.closest(".sheet-header")).not.toBeNull()
  })
})
