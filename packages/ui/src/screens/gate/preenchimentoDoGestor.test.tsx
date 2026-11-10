import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { strings } from "../../strings.js"
import { ToastProvider } from "../../components/Toast.js"
import { Emparelhar } from "./Emparelhar.js"
import { Setup } from "./Setup.js"
import { Unlock } from "./Unlock.js"

afterEach(cleanup)

/**
 * When it is the PASSWORD MANAGER writing, not the person.
 *
 * **These tests exist because of a production failure on September 30, 2026.**
 * The Orwell owner could not log in to the account on mobile: the field showed
 * the correct passphrase in plain sight, and the application replied "wrong
 * password".
 *
 * The cause was 0.3.1, and it came from something good. That version turned the
 * three gate screens into forms that Keychain and Android Manager recognize,  * that is what delivered Face ID. But when inviting the manager to write in the
 * field, no one checked that the application READ the field: all three decided
 * by React state, which only tracks who fires the events that React listens to.
 * A manager that fills without firing them (native Autofill on Android in an
 * installed PWA, and some third-party managers) leaves the field full and state
 * empty.
 *
 * **What these tests lock in is the rule, not the patch:** what is in the FIELD
 * is what counts. They fill by force, `value` by native setter, no event at
 * all, which is the worst case and is exactly what `scripts/prova-preenchimento-do-gestor.mjs`
 * reproduces in a real browser, and require that what reaches the vault be that.
 *
 * Going back to any of the three to read state (`attempt(passphrase)`,
 * `create(passphrase)`) turns these tests red. That is the only thing they have
 * to do.
 */

/**
 * Fill a field the way a manager fills it: by native setter, no event.
 *
 * Via `HTMLInputElement.prototype`, not via `campo.value = …`, because React
 * wraps the element's own setter to know when the value changes from outside.
 * Bypassing it is what reproduces the failure.
 */
function encherSemEventos(campo: HTMLInputElement, valor: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
  if (!setter) throw new Error("sem setter nativo: o teste não tem o que medir")
  setter.call(campo, valor)
}

const FRASE = "trás-os-montes é onde a névoa 2026"

function campoPorNome(nome: string): HTMLInputElement {
  const campo = document.querySelector(`input[name="${nome}"]`)
  if (!campo) throw new Error(`não há campo chamado ${nome}`)
  return campo as HTMLInputElement
}

// ---------------------------------------------------------------------------
// 1. Unlock, the owner's failure, as they saw it.
// ---------------------------------------------------------------------------

describe("desbloquear: o que vale é o que está no campo", () => {
  function ponteQuePedeFrase(unlock: (secret: string | null) => Promise<unknown>): EnclaveBridge {
    return {
      vault: { unlock, destroy: async () => ({ ok: true }), status: async () => ({ exists: true, supportsOsProtection: false }) },
      identity: { load: async () => ({ address: "@abc:orwell.pt", accountId: "abc" }) },
      session: { connect: async () => ({ ok: true }) },
    } as unknown as EnclaveBridge
  }

  it("a frase que o gestor pôs no campo é a frase com que se abre o cofre", async () => {
    const tentativas: (string | null)[] = []
    const unlock = async (secret: string | null): Promise<unknown> => {
      tentativas.push(secret)
      // The first is silent, from the system vault: it refuses, and the screen
      // asks for the passphrase.
      if (secret === null) throw new Error("this vault needs a passphrase")
      return { ok: true }
    }
    render(
      <BridgeContext.Provider value={ponteQuePedeFrase(unlock)}>
        <Unlock onDone={vi.fn()} onStartOver={vi.fn()} />
      </BridgeContext.Provider>,
    )
    await waitFor(() => expect(document.querySelector('input[name="password"]')).not.toBeNull())

    // The manager fills the field. The application heard nothing.
    encherSemEventos(campoPorNome("password"), FRASE)
    fireEvent.submit(campoPorNome("password").closest("form") as HTMLFormElement)

    await waitFor(() => expect(tentativas).toContain(FRASE))
    // And never with the empty passphrase that React still had: that is what gave
    // "wrong password" to someone who had the right password.
    expect(tentativas).not.toContain("")
  })
})

// ---------------------------------------------------------------------------
// 2. Create account, where the same bug costs the entire account.
// ---------------------------------------------------------------------------

describe("criar conta: o cofre nasce com o que está no campo", () => {
  function ponteQueCriaConta(create: (frase: string | null) => Promise<unknown>): EnclaveBridge {
    return {
      vault: { status: async () => ({ exists: false, supportsOsProtection: false }), create },
      identity: { create: async () => ({ address: "@abc:localhost:8448", accountId: "abc" }) },
      session: { connect: async () => ({ ok: true }) },
      profile: { set: async () => ({ ok: true }) },
    } as unknown as EnclaveBridge
  }

  it("a frase que o gestor pôs no campo é a frase com que o cofre é criado", async () => {
    const criados: (string | null)[] = []
    render(
      <ToastProvider>
        <BridgeContext.Provider
          value={ponteQueCriaConta(async (frase) => {
            criados.push(frase)
            return { ok: true }
          })}
        >
          <Setup onDone={vi.fn()} onUnlockInstead={vi.fn()} onJoinInstead={vi.fn()} />
        </BridgeContext.Provider>
      </ToastProvider>,
    )

    // The question from the other device (phase 8.1): it is a new account.
    fireEvent.click(await screen.findByRole("button", { name: strings.gate.outroAparelhoNao }))
    // Name step: typed by hand, the way a person types.
    const nome = await screen.findByPlaceholderText(strings.gate.namePlaceholder)
    fireEvent.change(nome, { target: { value: "Duarte" } })
    fireEvent.click(screen.getByRole("button", { name: strings.gate.next }))
    // Photo step (October 27, 2026): skipped.
    await screen.findByRole("button", { name: strings.gate.skipPhoto })
    fireEvent.click(screen.getByRole("button", { name: strings.gate.skipPhoto }))

    // Passphrase step: this is where the manager writes, and without telling anyone.
    await waitFor(() => expect(document.querySelector('input[name="new-password"]')).not.toBeNull())
    const frase = campoPorNome("new-password")
    encherSemEventos(frase, FRASE)
    fireEvent.submit(frase.closest("form") as HTMLFormElement)

    // Confirmation step: the manager repeats it, and also without telling anyone.
    await waitFor(() => expect(document.querySelector('input[name="confirm-password"]')).not.toBeNull())
    const confirmacao = campoPorNome("confirm-password")
    encherSemEventos(confirmacao, FRASE)
    fireEvent.submit(confirmacao.closest("form") as HTMLFormElement)

    await waitFor(() => expect(criados).toContain(FRASE))
    // A vault created with an empty passphrase (or any other) is a vault that
    // nobody opens again: there is no way to recover it, and nothing announces it.
    expect(criados).not.toContain("")
  })
})

// ---------------------------------------------------------------------------
// 3. Add device, the same screen, on the phone that pairs.
// ---------------------------------------------------------------------------

describe("emparelhar: o cofre do aparelho novo nasce com o que está no campo", () => {
  it("a frase que o gestor pôs no campo é a frase com que o cofre é criado", async () => {
    const criados: (string | null)[] = []
    const ponte = {
      vault: {
        status: async () => ({ exists: false, supportsOsProtection: false }),
        create: async (frase: string | null) => {
          criados.push(frase)
          return { ok: true }
        },
        destroy: async () => ({ ok: true }),
      },
      pairing: { join: async () => ({ ok: true }), cancel: async () => ({ ok: true }) },
      on: { pair: () => () => {} },
    } as unknown as EnclaveBridge

    render(
      <ToastProvider>
        <BridgeContext.Provider value={ponte}>
          <Emparelhar linkInicial="https://orwell.pt/app/par#segredo" onDone={vi.fn()} onBack={vi.fn()} />
        </BridgeContext.Provider>
      </ToastProvider>,
    )

    await waitFor(() => expect(document.querySelector('input[name="new-password"]')).not.toBeNull())
    encherSemEventos(campoPorNome("new-password"), FRASE)
    encherSemEventos(campoPorNome("confirm-password"), FRASE)
    fireEvent.submit(campoPorNome("new-password").closest("form") as HTMLFormElement)

    await waitFor(() => expect(criados).toContain(FRASE))
    expect(criados).not.toContain("")
  })
})
