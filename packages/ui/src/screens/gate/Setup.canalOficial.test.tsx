import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { strings } from "../../strings.js"
import { en } from "../../linguas/en.js"
import { pt } from "../../linguas/pt.js"
import { ToastProvider } from "../../components/Toast.js"
import { ENTRAR_NO_CANAL_OFICIAL_POR_OMISSAO, Setup } from "./Setup.js"

/**
 * "Join the Orwell channel", in the last step of signup (owner request,
 * 3/11/2026). What we verify here is ordering: the choice reaches the core BEFORE the
 * connection, because the account joins itself at the end of the handshake.
 */

afterEach(cleanup)

function montar(): { ordem: string[]; onDone: ReturnType<typeof vi.fn> } {
  const ordem: string[] = []
  const onDone = vi.fn()
  const bridge = {
    vault: {
      status: async () => ({ exists: false, supportsOsProtection: false }),
      create: async () => ({ ok: true }),
    },
    identity: { create: async () => ({ address: "@abc:localhost:8448", accountId: "abc" }) },
    session: {
      connect: async () => {
        ordem.push("connect")
        return { ok: true }
      },
      escolherSalaComum: async (entrar: boolean) => {
        ordem.push(`escolher:${entrar}`)
        return { ok: true }
      },
    },
    profile: { set: async () => ({ ok: true }) },
  } as unknown as EnclaveBridge
  render(
    <ToastProvider>
      <BridgeContext.Provider value={bridge}>
        <Setup onDone={onDone} onUnlockInstead={vi.fn()} />
      </BridgeContext.Provider>
    </ToastProvider>,
  )
  return { ordem, onDone }
}

async function ateAoUltimoPasso(pessoa: ReturnType<typeof userEvent.setup>): Promise<void> {
  await waitFor(() => expect(screen.getByPlaceholderText(strings.gate.namePlaceholder)).toBeTruthy())
  await pessoa.type(screen.getByPlaceholderText(strings.gate.namePlaceholder), "Duarte{Enter}")
  await pessoa.keyboard("{Enter}") // the photo: we skip it
  await pessoa.keyboard("frase-comprida-o-suficiente{Enter}")
  await pessoa.keyboard("frase-comprida-o-suficiente")
}

const caixa = (): HTMLInputElement => screen.getByRole("checkbox", { name: strings.gate.canalOficial }) as HTMLInputElement

describe('Setup: "Entrar no canal Orwell"', () => {
  it("a omissão é marcada (decisão do dono)", () => {
    expect(ENTRAR_NO_CANAL_OFICIAL_POR_OMISSAO).toBe(true)
  })

  it("só aparece no último passo, marcada, com a nota por baixo", async () => {
    const pessoa = userEvent.setup()
    montar()
    await waitFor(() => expect(screen.getByPlaceholderText(strings.gate.namePlaceholder)).toBeTruthy())
    expect(screen.queryByRole("checkbox", { name: strings.gate.canalOficial })).toBeNull()

    await ateAoUltimoPasso(pessoa)
    expect(caixa().checked).toBe(true)
    expect(screen.getByText(strings.gate.canalOficialNota)).toBeTruthy()
  })

  it("marcada, não escreve escolha nenhuma: a conta entra como hoje", async () => {
    const pessoa = userEvent.setup()
    const { ordem, onDone } = montar()
    await ateAoUltimoPasso(pessoa)
    await pessoa.click(screen.getByRole("button", { name: strings.gate.create }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(ordem).toEqual(["connect"])
  })

  it("desmarcada, a escolha vai ao núcleo antes da ligação", async () => {
    const pessoa = userEvent.setup()
    const { ordem, onDone } = montar()
    await ateAoUltimoPasso(pessoa)
    await pessoa.click(caixa())
    expect(caixa().checked).toBe(false)
    await pessoa.click(screen.getByRole("button", { name: strings.gate.create }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(ordem).toEqual(["escolher:false", "connect"])
  })

  it("o texto não tem aspas angulares nem travessões, nas duas línguas", () => {
    for (const lingua of [pt, en]) {
      const frases = [
        lingua.gate?.canalOficial,
        lingua.gate?.canalOficialNota,
        lingua.sidebar?.entrarNoCanalOficial,
        lingua.sidebar?.aEntrarNoCanalOficial,
      ]
      for (const frase of frases) {
        expect(frase).toBeTruthy()
        expect(frase).not.toMatch(/[«»—–]/)
      }
    }
  })
})
