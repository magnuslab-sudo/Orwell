import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, PairEvento } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { Emparelhar } from "./Emparelhar.js"

afterEach(cleanup)

/**
 * The mobile gate, from link to words.
 *
 * What holds: a non-pairing link doesn't pass the first page; a good link leads to
 * the password; the vault is only created after; and the six words appear in large
 * letters with BOTH buttons, because without "They're not" the SAS protects nothing.
 * And at the end, the two phrases, once.
 */
const LINK = "https://orwell.pt/app/emparelhar#6gzjKC5Y-jxiXv_ZLoIzYX6ZL4PeZ24HirzSb__z6VY"

function ponte(): { bridge: EnclaveBridge; emitir: (evento: PairEvento) => void; chamadas: string[] } {
  const chamadas: string[] = []
  let ouvinte: ((evento: PairEvento) => void) | null = null
  const bridge = {
    vault: {
      status: vi.fn(async () => ({ exists: false, supportsOsProtection: false })),
      create: vi.fn(async () => {
        chamadas.push("vault.create")
        return { ok: true }
      }),
      destroy: vi.fn(async () => {
        chamadas.push("vault.destroy")
        return { ok: true }
      }),
    },
    identity: { load: vi.fn(async () => ({ address: "@a:orwell.pt", accountId: "a" })) },
    session: { connect: vi.fn(async () => ({ ok: true })) },
    pairing: {
      join: vi.fn(async (link: string) => {
        chamadas.push(`join ${link}`)
        return { ok: true }
      }),
      confirm: vi.fn(async () => {
        chamadas.push("confirm")
        return { ok: true }
      }),
      refuse: vi.fn(async () => {
        chamadas.push("refuse")
        return { ok: true }
      }),
      cancel: vi.fn(async () => ({ ok: true })),
      done: vi.fn(async () => {
        chamadas.push("done")
        return { ok: true }
      }),
      status: vi.fn(),
      host: vi.fn(),
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

function montar(bridge: EnclaveBridge, onDone = vi.fn()): ReturnType<typeof vi.fn> {
  render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <Emparelhar onDone={onDone} onBack={() => {}} />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
  return onDone
}

/** The same, with `onBack` visible and `unmount` returned: what the exit tests need. */
function montarComSaida(bridge: EnclaveBridge, onBack: () => void): { unmount: () => void; onDone: ReturnType<typeof vi.fn> } {
  const onDone = vi.fn()
  const { unmount } = render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <Emparelhar onDone={onDone} onBack={onBack} />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
  return { unmount, onDone }
}

/** From zero to pairing in progress: link, password, and vault created. */
async function ateAoEmparelhamento(chamadas: string[]): Promise<void> {
  fireEvent.change(screen.getByLabelText(strings.pairing.pasteLabel), { target: { value: LINK } })
  fireEvent.click(screen.getByRole("button", { name: strings.pairing.pasteAction }))
  const campos = document.querySelectorAll('input[type="password"]')
  fireEvent.change(campos[0] as Element, { target: { value: "frase-de-teste-8" } })
  fireEvent.change(campos[1] as Element, { target: { value: "frase-de-teste-8" } })
  fireEvent.click(screen.getByRole("button", { name: strings.gate.next }))
  await waitFor(() => expect(chamadas).toContain(`join ${LINK}`))
}

describe("Juntar este aparelho a uma conta", () => {
  it("um link que não é de emparelhamento não passa da primeira página", () => {
    const { bridge, chamadas } = ponte()
    montar(bridge)
    fireEvent.change(screen.getByLabelText(strings.pairing.pasteLabel), { target: { value: "https://orwell.pt/app/convite#x/y" } })
    fireEvent.click(screen.getByRole("button", { name: strings.pairing.pasteAction }))
    expect(screen.getByText(strings.pairing.linkInvalid)).toBeTruthy()
    expect(chamadas).toEqual([])
  })

  it("um link bom pede a chave deste aparelho, e o cofre só se cria depois dela", async () => {
    const { bridge, chamadas } = ponte()
    montar(bridge)
    fireEvent.change(screen.getByLabelText(strings.pairing.pasteLabel), { target: { value: LINK } })
    fireEvent.click(screen.getByRole("button", { name: strings.pairing.pasteAction }))
    expect(screen.getByRole("heading", { name: strings.pairing.keyTitle })).toBeTruthy()
    expect(chamadas).toEqual([])
    const campos = document.querySelectorAll('input[type="password"]')
    fireEvent.change(campos[0] as Element, { target: { value: "frase-de-teste-8" } })
    fireEvent.change(campos[1] as Element, { target: { value: "frase-de-teste-8" } })
    fireEvent.click(screen.getByRole("button", { name: strings.gate.next }))
    await waitFor(() => expect(chamadas).toEqual(["vault.create", `join ${LINK}`]))
  })

  it('as seis palavras aparecem grandes, com "São as mesmas" e "Não são", e o fim diz as duas frases', async () => {
    const { bridge, emitir, chamadas } = ponte()
    const onDone = montar(bridge)
    fireEvent.change(screen.getByLabelText(strings.pairing.pasteLabel), { target: { value: LINK } })
    fireEvent.click(screen.getByRole("button", { name: strings.pairing.pasteAction }))
    const campos = document.querySelectorAll('input[type="password"]')
    fireEvent.change(campos[0] as Element, { target: { value: "frase-de-teste-8" } })
    fireEvent.change(campos[1] as Element, { target: { value: "frase-de-teste-8" } })
    fireEvent.click(screen.getByRole("button", { name: strings.gate.next }))
    await waitFor(() => expect(chamadas).toContain(`join ${LINK}`))

    emitir({ fase: "ligado" })
    emitir({ fase: "sas", palavras: "cilgiro-ransecis-penvesa-zoffonox-sigrinsis-vellesa" })
    await waitFor(() => expect(screen.getByRole("heading", { name: strings.pairing.sasTitle })).toBeTruthy())
    expect(document.querySelectorAll(".sas-palavra")).toHaveLength(6)
    expect(document.querySelector(".sas-palavras")?.getAttribute("data-palavras")).toBe("cilgiro-ransecis-penvesa-zoffonox-sigrinsis-vellesa")
    expect(screen.getByRole("button", { name: strings.pairing.sasDifferent })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: strings.pairing.sasSame }))
    await waitFor(() => expect(chamadas).toContain("confirm"))
    expect(screen.getByText(strings.pairing.sasConfirmedHere)).toBeTruthy()

    emitir({ fase: "certificado", address: "@a:orwell.pt" })
    await waitFor(() => expect(screen.getByRole("heading", { name: strings.pairing.doneTitle })).toBeTruthy())
    expect(chamadas).toContain("done")
    expect(screen.getByText(strings.pairing.doneBody)).toBeTruthy()
    expect(screen.getByText(strings.pairing.doneGuestNote)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: strings.pairing.doneAction }))
    expect(onDone).toHaveBeenCalledWith("@a:orwell.pt")
  })

  it('entre o certificado e a entrada, "a receber o teu estado", com o prazo à vista', async () => {
    const { bridge, emitir, chamadas } = ponte()
    montar(bridge)
    await ateAoEmparelhamento(chamadas)
    emitir({ fase: "estado" })
    expect(await screen.findByText(strings.pairing.receivingState)).toBeTruthy()
    expect(screen.getByRole("timer").textContent).toBe(strings.pairing.stateDeadline(15))
    // It arrived whole: you go in, and the end doesn't talk about missing state.
    emitir({ fase: "certificado", address: "@a:orwell.pt", estado: "inteiro" })
    await waitFor(() => expect(screen.getByRole("heading", { name: strings.pairing.doneTitle })).toBeTruthy())
    expect(screen.queryByText(strings.pairing.stateMissing)).toBeNull()
  })

  it("se o estado não chegar no prazo, entra na mesma e di-lo", async () => {
    const { bridge, emitir, chamadas } = ponte()
    montar(bridge)
    await ateAoEmparelhamento(chamadas)
    emitir({ fase: "estado" })
    await screen.findByText(strings.pairing.receivingState)
    emitir({ fase: "certificado", address: "@a:orwell.pt", estado: "em-falta" })
    await waitFor(() => expect(screen.getByRole("heading", { name: strings.pairing.doneTitle })).toBeTruthy())
    expect(chamadas).toContain("done")
    expect(screen.getByText(strings.pairing.stateMissing)).toBeTruthy()
  })

  it('"Não são" recusa e não escreve nada', async () => {
    const { bridge, emitir, chamadas } = ponte()
    montar(bridge)
    fireEvent.change(screen.getByLabelText(strings.pairing.pasteLabel), { target: { value: LINK } })
    fireEvent.click(screen.getByRole("button", { name: strings.pairing.pasteAction }))
    const campos = document.querySelectorAll('input[type="password"]')
    fireEvent.change(campos[0] as Element, { target: { value: "frase-de-teste-8" } })
    fireEvent.change(campos[1] as Element, { target: { value: "frase-de-teste-8" } })
    fireEvent.click(screen.getByRole("button", { name: strings.gate.next }))
    await waitFor(() => expect(chamadas).toContain(`join ${LINK}`))
    emitir({ fase: "sas", palavras: "a-b-c-d-e-f" })
    await waitFor(() => expect(screen.getByRole("button", { name: strings.pairing.sasDifferent })).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: strings.pairing.sasDifferent }))
    await waitFor(() => expect(chamadas).toContain("refuse"))
    expect(screen.getByRole("heading", { name: strings.pairing.failedTitle })).toBeTruthy()
    expect(chamadas).not.toContain("confirm")
    expect(chamadas).not.toContain("done")
  })
})

/**
 * Leaving mid-way doesn't leave a useless vault locking the gate.
 *
 * The vault is born before pairing (you need a password to write what comes) and an
 * abandoned pairing leaves it empty: no identity inside. The next startup's gate found
 * it, asked for the password, and `loadIdentity` threw: an account that doesn't exist
 * asking for a key that opens nothing.
 */
describe("sair a meio do emparelhamento", () => {
  it('o "Voltar" da página que falhou cancela, destrói o cofre, e só depois sai', async () => {
    const { bridge, emitir, chamadas } = ponte()
    const onBack = vi.fn()
    montarComSaida(bridge, onBack)
    await ateAoEmparelhamento(chamadas)

    emitir({ fase: "falhou", razao: "tempo-esgotado" })
    await waitFor(() => expect(screen.getByRole("heading", { name: strings.pairing.failedTitle })).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: strings.gate.back }))

    await waitFor(() => expect(chamadas).toContain("vault.destroy"))
    await waitFor(() => expect(onBack).toHaveBeenCalled())
  })

  it("fechar o ecrã sem responder destrói o cofre na mesma", async () => {
    const { bridge, chamadas } = ponte()
    const { unmount } = montarComSaida(bridge, vi.fn())
    await ateAoEmparelhamento(chamadas)

    unmount()
    await waitFor(() => expect(chamadas).toContain("vault.destroy"))
  })

  it("depois de a conta entrar, fechar o ecrã NÃO destrói nada", async () => {
    const { bridge, emitir, chamadas } = ponte()
    const { unmount } = montarComSaida(bridge, vi.fn())
    await ateAoEmparelhamento(chamadas)

    emitir({ fase: "certificado", address: "@a:orwell.pt" })
    await waitFor(() => expect(screen.getByRole("heading", { name: strings.pairing.doneTitle })).toBeTruthy())

    unmount()
    await waitFor(() => expect(chamadas).toContain("done"))
    expect(chamadas).not.toContain("vault.destroy")
  })
})
