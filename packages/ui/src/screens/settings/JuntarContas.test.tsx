import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, PairEvento } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { JuntarContas } from "./JuntarContas.js"

afterEach(cleanup)

/**
 * "Link to another account" (phase 8.2), on screen: the explanation comes first,
 * "delete" is written before starting, and the order of the three steps. Key point:
 * if pairing fails, the bridge does not hear `juntarAvisar` or `juntarTrocar`.
 * Nothing is warned and nothing is deleted.
 */
const LINK = "https://orwell.pt/app/emparelhar#6gzjKC5Y-jxiXv_ZLoIzYX6ZL4PeZ24HirzSb__z6VY"
const DORA = "@dora:orwell.pt"

function ponte(): { bridge: EnclaveBridge; emitir: (evento: PairEvento) => void; chamadas: string[] } {
  const chamadas: string[] = []
  let ouvinte: ((evento: PairEvento) => void) | null = null
  const bridge = {
    vault: { status: vi.fn(async () => ({ exists: true, supportsOsProtection: false })) },
    pairing: {
      juntar: vi.fn(async (link: string) => {
        chamadas.push(`juntar ${link}`)
        return { ok: true }
      }),
      juntarAvisar: vi.fn(async () => {
        chamadas.push("avisar")
        return { ok: true }
      }),
      juntarTrocar: vi.fn(async (frase: string | null) => {
        chamadas.push(`trocar ${frase}`)
        return { address: DORA }
      }),
      juntarCancelar: vi.fn(async () => {
        chamadas.push("cancelar")
        return { ok: true }
      }),
      confirm: vi.fn(async () => {
        chamadas.push("confirm")
        return { ok: true }
      }),
      refuse: vi.fn(async () => ({ ok: true })),
      cancel: vi.fn(async () => ({ ok: true })),
      status: vi.fn(),
      host: vi.fn(),
      join: vi.fn(),
      done: vi.fn(),
      devices: vi.fn(),
    },
    on: {
      pair: (handler: (evento: PairEvento) => void) => {
        ouvinte = handler
        return () => {
          ouvinte = null
        }
      },
    },
  } as unknown as EnclaveBridge
  return { bridge, emitir: (evento) => ouvinte?.(evento), chamadas }
}

function montar(bridge: EnclaveBridge): { onDone: ReturnType<typeof vi.fn> } {
  const onDone = vi.fn()
  render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <JuntarContas onClose={() => {}} onDone={onDone} />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
  return { onDone }
}

/** From the explanation to the six words, with the "delete" written along the way. */
async function ateAsPalavras(emitir: (evento: PairEvento) => void): Promise<void> {
  expect(screen.getByText(strings.juntar.naoPassa)).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: strings.juntar.comecar }))
  fireEvent.change(screen.getByLabelText(strings.pairing.pasteLabel), { target: { value: LINK } })
  fireEvent.click(screen.getByRole("button", { name: strings.pairing.pasteAction }))
  fireEvent.change(screen.getByLabelText(strings.gate.devicePassphrase), { target: { value: "frase-nova-1" } })
  fireEvent.change(screen.getByLabelText(strings.gate.confirmPassphrase), { target: { value: "frase-nova-1" } })
  fireEvent.click(screen.getByRole("button", { name: strings.gate.next }))
  fireEvent.change(screen.getByLabelText(strings.settings.destroyConfirmLabel), { target: { value: strings.settings.destroyConfirmWord } })
  fireEvent.click(screen.getByRole("button", { name: strings.settings.destroyConfirm }))
  await waitFor(() => expect(screen.getByText(strings.pairing.connecting)).toBeTruthy())
  emitir({ fase: "ligado" })
  emitir({ fase: "sas", palavras: "uma duas três quatro cinco seis" })
  await waitFor(() => expect(screen.getByRole("button", { name: strings.pairing.sasSame })).toBeTruthy())
}

describe("juntar a outra conta", () => {
  it("emparelha, avisa e só no fim apaga, por esta ordem", async () => {
    const { bridge, emitir, chamadas } = ponte()
    const { onDone } = montar(bridge)
    await ateAsPalavras(emitir)
    fireEvent.click(screen.getByRole("button", { name: strings.pairing.sasSame }))
    emitir({ fase: "certificado", address: DORA })
    await waitFor(() => expect(screen.getByText(strings.juntar.feito(DORA))).toBeTruthy())
    expect(chamadas).toEqual([`juntar ${LINK}`, "confirm", "avisar", "trocar frase-nova-1"])
    fireEvent.click(screen.getByRole("button", { name: strings.juntar.continuar }))
    expect(onDone).toHaveBeenCalled()
  })

  it("se o emparelhamento falhar, nada se avisa e nada se apaga", async () => {
    const { bridge, emitir, chamadas } = ponte()
    montar(bridge)
    await ateAsPalavras(emitir)
    emitir({ fase: "falhou", razao: "palavras-diferentes" })
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(chamadas).not.toContain("avisar")
    expect(chamadas.some((chamada) => chamada.startsWith("trocar"))).toBe(false)
  })

  it("se não sair de todos os canais, não apaga, e diz o erro com código", async () => {
    const { bridge, emitir, chamadas } = ponte()
    ;(bridge.pairing!.juntarAvisar as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("could not leave every channel, nothing was deleted", { cause: { canais: 2 } }),
    )
    montar(bridge)
    await ateAsPalavras(emitir)
    fireEvent.click(screen.getByRole("button", { name: strings.pairing.sasSame }))
    emitir({ fase: "certificado", address: DORA })
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("121"))
    expect(chamadas.some((chamada) => chamada.startsWith("trocar"))).toBe(false)
    expect(chamadas).toContain("cancelar")
  })
})
