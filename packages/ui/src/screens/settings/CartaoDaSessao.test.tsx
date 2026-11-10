import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { CartaoDaSessao } from "./CartaoDaSessao.js"

afterEach(cleanup)

type Estado = Awaited<ReturnType<EnclaveBridge["vault"]["status"]>>

function montar(estado: Estado, vault: Partial<EnclaveBridge["vault"]> = {}): { onLock: ReturnType<typeof vi.fn>; onSessaoMudou: ReturnType<typeof vi.fn> } {
  const onLock = vi.fn()
  const onSessaoMudou = vi.fn()
  const atual = { ...estado }
  const bridge = {
    vault: {
      status: async () => ({ ...atual }),
      lock: async () => ({ ok: true }),
      memorizar: async (ligar: boolean) => {
        atual.sessaoMemorizada = ligar
        return { ok: true }
      },
      ...vault,
    },
  } as unknown as EnclaveBridge
  render(
    <ToastProvider>
      <BridgeContext.Provider value={bridge}>
        <CartaoDaSessao onLock={onLock} bloqueioAutomatico={15} onBloqueioAutomatico={vi.fn()} onSessaoMudou={onSessaoMudou} />
      </BridgeContext.Provider>
    </ToastProvider>,
  )
  return { onLock, onSessaoMudou }
}

const BASE: Estado = { exists: true, supportsOsProtection: false, versao: "orwv2", protection: "passphrase", memoriaDisponivel: true, sessaoMemorizada: false }

function interruptor(): HTMLElement {
  return screen.getByRole("switch", { name: strings.settings.memorizarSessao })
}

describe("Conta › Sessão, com a memória da sessão", () => {
  it('sem memória: "Terminar sessão", o interruptor desligado e "Expirar sessão"', async () => {
    montar(BASE)
    await waitFor(() => expect(interruptor().getAttribute("aria-checked")).toBe("false"))
    expect(screen.getByRole("button", { name: strings.settings.lockNow })).toBeTruthy()
    expect(screen.getByText(strings.definicoesNovas.bloquearSozinho)).toBeTruthy()
  })

  it('ligar memoriza, e "Expirar sessão" desaparece com a linha a dizer porquê (decisão 3)', async () => {
    const { onSessaoMudou } = montar(BASE)
    await waitFor(() => expect(interruptor()).toBeTruthy())
    fireEvent.click(interruptor())
    await waitFor(() => expect(interruptor().getAttribute("aria-checked")).toBe("true"))
    expect(onSessaoMudou).toHaveBeenCalled()
    expect(screen.getByText(strings.settings.sessaoNaoExpira)).toBeTruthy()
    expect(screen.getByText(strings.settings.memorizarSessaoNota)).toBeTruthy()
    expect(screen.queryByText(strings.definicoesNovas.bloquearSozinho)).toBeNull()
    // E desligar esquece.
    fireEvent.click(interruptor())
    await waitFor(() => expect(interruptor().getAttribute("aria-checked")).toBe("false"))
    expect(screen.getByText(strings.definicoesNovas.bloquearSozinho)).toBeTruthy()
  })

  it('"Terminar sessão" chama o `lock` da ponte (que esquece antes de trancar) e volta ao portão', async () => {
    const lock = vi.fn(async () => ({ ok: true }))
    const { onLock } = montar({ ...BASE, sessaoMemorizada: true }, { lock })
    fireEvent.click(await screen.findByRole("button", { name: strings.settings.lockNow }))
    await waitFor(() => expect(onLock).toHaveBeenCalled())
    expect(lock).toHaveBeenCalledTimes(1)
  })

  it('um cofre `os`: sem "Terminar sessão" nem "Expirar sessão", e a linha diz porquê', async () => {
    montar({ ...BASE, protection: "os" })
    expect(await screen.findByText(strings.settings.semPalavraPasse)).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.settings.lockNow })).toBeNull()
    expect(screen.queryByText(strings.definicoesNovas.bloquearSozinho)).toBeNull()
  })

  it("sem sítio seguro na plataforma: a linha, e nenhum interruptor", async () => {
    montar({ ...BASE, memoriaDisponivel: false })
    expect(await screen.findByText(strings.settings.memorizarSessaoIndisponivel)).toBeTruthy()
    expect(screen.queryByRole("switch", { name: strings.settings.memorizarSessao })).toBeNull()
  })

  it('F3: "Definir palavra-passe" num cofre `os` lê os campos, converte, memoriza, e o cartão passa a ter "Terminar sessão"', async () => {
    const chamadas: string[] = []
    const atual: Estado = { ...BASE, protection: "os" }
    const bridge = {
      vault: {
        status: async () => ({ ...atual }),
        lock: async () => ({ ok: true }),
        memorizar: async (ligar: boolean) => {
          chamadas.push(`memorizar ${ligar}`)
          atual.sessaoMemorizada = ligar
          return { ok: true }
        },
        definirPalavraPasse: async (frase: string) => {
          chamadas.push(`definir ${frase}`)
          atual.protection = "passphrase"
          return { ok: true }
        },
      },
    } as unknown as EnclaveBridge
    render(
      <ToastProvider>
        <BridgeContext.Provider value={bridge}>
          <CartaoDaSessao onLock={vi.fn()} bloqueioAutomatico={15} onBloqueioAutomatico={vi.fn()} />
        </BridgeContext.Provider>
      </ToastProvider>,
    )
    fireEvent.click(await screen.findByRole("button", { name: strings.settings.definirPalavraPasse }))
    const nova = document.querySelector('input[name="new-password"]') as HTMLInputElement
    const confirmar = document.querySelector('input[name="confirm-password"]') as HTMLInputElement
    expect(nova.getAttribute("autocomplete")).toBe("new-password")
    // The manager's identity field, with the same name as the gate.
    expect(document.querySelector('input[autocomplete="username"]')).not.toBeNull()

    // Different: reject, without calling the bridge.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
    setter?.call(nova, "uma frase comprida")
    setter?.call(confirmar, "outra frase comprida")
    fireEvent.submit(nova.closest("form") as HTMLFormElement)
    expect(await screen.findByText(strings.gate.passphraseMismatch)).toBeTruthy()
    expect(chamadas).toEqual([])

    // The same, written without an event (like a manager): what is in the field takes precedence.
    setter?.call(confirmar, "uma frase comprida")
    fireEvent.submit(nova.closest("form") as HTMLFormElement)
    await waitFor(() => expect(chamadas).toEqual(["definir uma frase comprida", "memorizar true"]))
    expect(await screen.findByRole("button", { name: strings.settings.lockNow })).toBeTruthy()
    expect(screen.queryByText(strings.settings.semPalavraPasse)).toBeNull()
  })

  it("uma ponte que não sabe memorizar fica como era", async () => {
    montar(BASE, { memorizar: undefined } as unknown as Partial<EnclaveBridge["vault"]>)
    await screen.findByRole("button", { name: strings.settings.lockNow })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.queryByRole("switch")).toBeNull()
    expect(screen.queryByText(strings.settings.memorizarSessaoIndisponivel)).toBeNull()
  })
})
