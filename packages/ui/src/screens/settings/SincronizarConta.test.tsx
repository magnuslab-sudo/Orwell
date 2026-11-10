import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { ConnectionState, EnclaveBridge } from "../../bridge.js"
import { strings } from "../../strings.js"
import { ESPERA_DA_REPARACAO_MS, SincronizarConta } from "./SincronizarConta.js"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/**
 * A bridge that records the ORDER of calls.
 *
 * The first read of the channel list is before repair; the following ones are
 * after. `sincronizarAgora: null` brings up a host without the gate.
 */
function montar({
  mortos = [],
  depois = [],
  agora = [],
  connection = "online",
  sincronizarAgora,
}: {
  mortos?: string[]
  depois?: string[]
  agora?: string[]
  connection?: ConnectionState
  sincronizarAgora?: (() => Promise<{ ok: boolean }>) | null
} = {}): { ordem: string[] } {
  const ordem: string[] = []
  let leituras = 0
  const social: Record<string, unknown> = {
    deadWelcomes: async () => mortos,
    resyncWelcomes: vi.fn(async () => {
      ordem.push("canais")
      return { ok: true }
    }),
  }
  if (sincronizarAgora !== null) {
    social.sincronizarAgora =
      sincronizarAgora ??
      (async () => {
        ordem.push("amizades")
        return { ok: true }
      })
  }
  const bridge = {
    social,
    channels: { list: async () => (leituras++ === 0 ? agora : depois) },
  } as unknown as EnclaveBridge
  render(
    <BridgeContext.Provider value={bridge}>
      <SincronizarConta connection={connection} />
    </BridgeContext.Provider>,
  )
  return { ordem }
}

/** Load and let the bridge's promises settle. */
async function carregar(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: strings.settings.sincronizar }))
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

async function esperarAContagem(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ESPERA_DA_REPARACAO_MS)
    for (let i = 0; i < 4; i++) await Promise.resolve()
  })
}

describe("SincronizarConta", () => {
  it("um botão, com o subtítulo que diz que não apaga nada", () => {
    montar()
    expect(screen.getByRole("button", { name: strings.settings.sincronizar })).toBeTruthy()
    expect(screen.getByText(strings.settings.sincronizarNota)).toBeTruthy()
  })

  it("pede os convites dos canais primeiro e verifica as amizades depois, e diz as duas coisas numa linha", async () => {
    vi.useFakeTimers()
    const { ordem } = montar({ mortos: ["!a:s", "!b:s", "!c:s"], depois: ["!a:s", "!b:s"] })
    await carregar()
    expect(ordem).toEqual(["canais", "amizades"])
    // While waiting for invites, just one message.
    expect(screen.getByRole("status").textContent).toBe(strings.settings.aSincronizar)
    await esperarAContagem()
    expect(screen.getByRole("status").textContent).toBe(
      `${strings.settings.repararFeito(3, 1)} ${strings.settings.repararAmizadesFeito}`,
    )
  })

  it("sem canais por abrir, não pede convites, verifica as amizades e não espera", async () => {
    const { ordem } = montar()
    await carregar()
    expect(ordem).toEqual(["amizades"])
    expect(screen.getByRole("status").textContent).toBe(
      `${strings.settings.repararNada} ${strings.settings.repararAmizadesFeito}`,
    )
  })

  it('um Welcome queimado de um canal onde já se está não conta como "por abrir"', async () => {
    const { ordem } = montar({ mortos: ["!ja-ca-estou:s"], agora: ["!ja-ca-estou:s"] })
    await carregar()
    expect(ordem).not.toContain("canais")
    expect(screen.getByRole("status").textContent).toContain(strings.settings.repararNada)
  })

  it("um anfitrião sem a porta das amizades faz só os canais, e a frase não fala delas", async () => {
    montar({ sincronizarAgora: null })
    await carregar()
    expect(screen.getByRole("status").textContent).toBe(strings.settings.repararNada)
  })

  it("uma recusa da ponte chega à frase de estado", async () => {
    montar({ sincronizarAgora: async () => Promise.reject(new Error("not connected")) })
    await carregar()
    expect(screen.getByRole("status").textContent).not.toBe("")
    expect(screen.getByRole("status").textContent).not.toContain(strings.settings.repararAmizadesFeito)
  })

  it("sem ligação, o botão fica apagado e diz porquê", () => {
    montar({ mortos: ["!a:s"], connection: "reconnecting" })
    expect((screen.getByRole("button", { name: strings.settings.sincronizar }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole("status").textContent).toBe(strings.settings.repararSemLigacao)
  })
})
