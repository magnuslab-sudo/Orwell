import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { Emparelhar } from "./Emparelhar.js"
import { Setup } from "./Setup.js"

afterEach(cleanup)

/**
 * F3: a new account always starts with a password, even on a host with a
 * keychain (the desktop). And the "Remember session" checkbox comes enabled,
 * and remembers after the vault is born.
 */

const FRASE = "uma frase comprida de teste"

function ponte(chamadas: string[]): EnclaveBridge {
  return {
    vault: {
      status: async () => ({ exists: false, supportsOsProtection: true, memoriaDisponivel: true }),
      create: async (frase: string | null) => {
        chamadas.push(`create ${frase === null ? "SEM FRASE" : frase}`)
        return { ok: true }
      },
      memorizar: async (ligar: boolean) => {
        chamadas.push(`memorizar ${ligar}`)
        return { ok: true }
      },
      destroy: async () => ({ ok: true }),
    },
    identity: { create: async () => ({ address: "@ana:localhost", accountId: "ana" }) },
    session: { connect: async () => ({ ok: true }) },
    profile: { set: async () => ({ ok: true }) },
    pairing: { join: async () => ({ ok: true }), cancel: async () => ({ ok: true }) },
    on: { pair: () => () => {} },
  } as unknown as EnclaveBridge
}

describe("F3: contas novas sem cofre sem frase", () => {
  it("o registo na secretária pede a palavra-passe, sem a caixa do porta-chaves, e memoriza", async () => {
    const chamadas: string[] = []
    render(
      <ToastProvider>
        <BridgeContext.Provider value={ponte(chamadas)}>
          <Setup onDone={vi.fn()} onUnlockInstead={vi.fn()} />
        </BridgeContext.Provider>
      </ToastProvider>,
    )
    fireEvent.change(await screen.findByPlaceholderText(strings.gate.namePlaceholder), { target: { value: "Ana" } })
    fireEvent.click(screen.getByRole("button", { name: strings.gate.next }))
    fireEvent.click(await screen.findByRole("button", { name: strings.gate.skipPhoto }))
    await waitFor(() => expect(document.querySelector('input[name="new-password"]')).not.toBeNull())
    expect(screen.queryByText(strings.gate.osKeychain)).toBeNull()
    const caixa = document.querySelector('input[name="memorizar"]') as HTMLInputElement
    expect(caixa.checked).toBe(true)

    const campo = document.querySelector('input[name="new-password"]') as HTMLInputElement
    fireEvent.change(campo, { target: { value: FRASE } })
    fireEvent.submit(campo.closest("form") as HTMLFormElement)
    await waitFor(() => expect(document.querySelector('input[name="confirm-password"]')).not.toBeNull())
    const confirmar = document.querySelector('input[name="confirm-password"]') as HTMLInputElement
    fireEvent.change(confirmar, { target: { value: FRASE } })
    fireEvent.submit(confirmar.closest("form") as HTMLFormElement)

    await waitFor(() => expect(chamadas).toEqual([`create ${FRASE}`, "memorizar true"]))
  })

  it("emparelhar na secretária também pede a palavra-passe, sem a caixa do porta-chaves", async () => {
    const chamadas: string[] = []
    render(
      <ToastProvider>
        <BridgeContext.Provider value={ponte(chamadas)}>
          <Emparelhar linkInicial="https://orwell.pt/app/par#segredo" onDone={vi.fn()} onBack={vi.fn()} />
        </BridgeContext.Provider>
      </ToastProvider>,
    )
    await waitFor(() => expect(document.querySelector('input[name="new-password"]')).not.toBeNull())
    await waitFor(() => expect(document.querySelector('input[name="memorizar"]')).not.toBeNull())
    expect(screen.queryByText(strings.gate.osKeychain)).toBeNull()
    fireEvent.change(document.querySelector('input[name="new-password"]') as HTMLInputElement, { target: { value: FRASE } })
    fireEvent.change(document.querySelector('input[name="confirm-password"]') as HTMLInputElement, { target: { value: FRASE } })
    fireEvent.submit((document.querySelector('input[name="new-password"]') as HTMLInputElement).closest("form") as HTMLFormElement)
    await waitFor(() => expect(chamadas).toContain(`create ${FRASE}`))
    expect(chamadas).not.toContain("create SEM FRASE")
  })
})
