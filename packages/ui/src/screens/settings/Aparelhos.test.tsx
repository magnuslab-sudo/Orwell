import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { ConfirmarProvider } from "../../hooks/useConfirmar.js"
import { strings } from "../../strings.js"
import { Aparelhos } from "./Aparelhos.js"

afterEach(cleanup)

/**
 * The Devices section, and what drives the button.
 *
 * "Add device" only shows to those who HAVE the account key AND are on a server
 * that knows how to pair. To a paired device we say where that is done, instead
 * of a button that would fail. And the list is the manifest: this device shows
 * marked, and without a manifest we say the server does not tell.
 */
function ponte(
  estado: { temChaveDeConta: boolean; servidorSuporta: boolean; servidorRevoga?: boolean },
  aparelhos: unknown[] | null,
  revoke: (deviceKey: string) => Promise<{ ok: boolean }> = vi.fn(async () => ({ ok: true })),
): EnclaveBridge {
  return {
    pairing: {
      status: vi.fn(async () => estado),
      devices: vi.fn(async () => aparelhos),
      revoke,
      host: vi.fn(),
      join: vi.fn(),
      confirm: vi.fn(),
      refuse: vi.fn(),
      cancel: vi.fn(),
      done: vi.fn(),
    },
    on: { pair: () => () => {} },
  } as unknown as EnclaveBridge
}

function montar(bridge: EnclaveBridge): void {
  render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <ConfirmarProvider>
          <Aparelhos />
        </ConfirmarProvider>
      </ToastProvider>
    </BridgeContext.Provider>,
  )
}

const ESTE = { deviceKey: "dVWtbPLSETyzAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", addedAt: 1_758_500_000, esteAparelho: true }
const OUTRO = { deviceKey: "outroApar3lhoDeTeste_AAAAAAAAAAAAAAAAAAAAAA", addedAt: 1_758_600_000, esteAparelho: false }

describe("a secção Aparelhos", () => {
  it("com a chave de conta e um servidor que emparelha, lista o manifesto com este aparelho marcado e mostra o botão", async () => {
    montar(ponte({ temChaveDeConta: true, servidorSuporta: true }, [OUTRO, ESTE]))
    await waitFor(() => expect(screen.getByRole("button", { name: strings.settings.addDevice })).toBeTruthy())
    const linhas = document.querySelectorAll(".aparelhos-lista li")
    expect(linhas).toHaveLength(2)
    // Ordered by the date they entered, and this is the first.
    expect(linhas[0]?.classList.contains("este")).toBe(true)
    expect(linhas[0]?.textContent).toContain(strings.settings.thisDevice)
    expect(linhas[1]?.textContent).toContain("outroApar3lh")
    // A server that does not announce `device-revocation`: no "Revoke", and we say why.
    expect(screen.queryByRole("button", { name: /^Revogar/ })).toBeNull()
    expect(screen.getByText(strings.settings.revokeServerUnsupported)).toBeTruthy()
  })

  it("num aparelho emparelhado não há botão: diz-se onde se acrescentam aparelhos", async () => {
    montar(ponte({ temChaveDeConta: false, servidorSuporta: true }, [OUTRO, { ...ESTE, esteAparelho: true }]))
    await waitFor(() => expect(screen.getByText(strings.pairing.noAccountKey)).toBeTruthy())
    expect(screen.queryByRole("button", { name: strings.settings.addDevice })).toBeNull()
  })

  it("contra um servidor sem emparelhamento não há botão, e diz-se porquê", async () => {
    montar(ponte({ temChaveDeConta: true, servidorSuporta: false }, [ESTE]))
    await waitFor(() => expect(screen.getByText(strings.pairing.serverUnsupported)).toBeTruthy())
    expect(screen.queryByRole("button", { name: strings.settings.addDevice })).toBeNull()
  })

  it("sem manifesto diz que o servidor não diz, em vez de inventar uma lista", async () => {
    montar(ponte({ temChaveDeConta: true, servidorSuporta: true }, null))
    await waitFor(() => expect(screen.getByText(strings.settings.devicesUnknown)).toBeTruthy())
    expect(document.querySelectorAll(".aparelhos-lista li")).toHaveLength(0)
  })

  it('com a chave de conta e um servidor que revoga, cada OUTRO aparelho tem "Revogar"; este não', async () => {
    montar(ponte({ temChaveDeConta: true, servidorSuporta: true, servidorRevoga: true }, [OUTRO, ESTE]))
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Revogar/ })).toHaveLength(1))
    const linhas = document.querySelectorAll(".aparelhos-lista li")
    expect(linhas[0]?.querySelector("button")).toBeNull()
    expect(linhas[0]?.textContent).toContain(strings.settings.revokeSelf)
    expect(linhas[1]?.querySelector("button")?.textContent).toBe(strings.settings.revoke)
    // The honest phrase is in view before anyone clicks.
    expect(screen.getByText(strings.settings.revokeHonest)).toBeTruthy()
  })

  it('revogar pergunta antes, com a frase honesta; sem "sim" não revoga', async () => {
    const revoke = vi.fn(async () => ({ ok: true }))
    montar(ponte({ temChaveDeConta: true, servidorSuporta: true, servidorRevoga: true }, [OUTRO, ESTE], revoke))
    fireEvent.click(await screen.findByRole("button", { name: /^Revogar/ }))
    const dialogo = await screen.findByRole("alertdialog")
    expect(dialogo.textContent).toContain(strings.settings.revokeBody)
    expect(dialogo.textContent).toContain("O que o aparelho já tinha, continua a ter.")
    fireEvent.click(screen.getByRole("button", { name: strings.common.cancel }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(revoke).not.toHaveBeenCalled()
  })

  it('com "sim" revoga aquele aparelho, mostra o progresso, avisa no fim e relê a lista', async () => {
    let acabar: () => void = () => {}
    const revoke = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => (acabar = () => resolve({ ok: true }))))
    const bridge = ponte({ temChaveDeConta: true, servidorSuporta: true, servidorRevoga: true }, [OUTRO, ESTE], revoke)
    montar(bridge)
    fireEvent.click(await screen.findByRole("button", { name: /^Revogar/ }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: strings.settings.revoke }))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(OUTRO.deviceKey))
    expect(await screen.findByText(strings.settings.revoking)).toBeTruthy()
    // While it runs, do not ask for another.
    expect((screen.getByRole("button", { name: /^Revogar/ }) as HTMLButtonElement).disabled).toBe(true)
    acabar()
    expect(await screen.findByText(strings.settings.revoked)).toBeTruthy()
    expect(vi.mocked(bridge.pairing!.devices).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it("um erro fica na linha do aparelho, com o código", async () => {
    const revoke = vi.fn(async () => {
      throw new Error("device-revoke-manifest-refused", { cause: { reason: "stale-version", version: 3 } })
    })
    montar(ponte({ temChaveDeConta: true, servidorSuporta: true, servidorRevoga: true }, [OUTRO, ESTE], revoke))
    fireEvent.click(await screen.findByRole("button", { name: /^Revogar/ }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: strings.settings.revoke }))
    const alerta = await screen.findByRole("alert")
    expect(alerta.textContent).toContain("746")
    expect(alerta.closest("li")?.textContent).toContain("outroApar3lh")
  })

  it('sem resposta do servidor ao manifesto, o aparelho fica "a revogar", com o botão, e a frase manda repetir', async () => {
    const revoke = vi
      .fn<(deviceKey: string) => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(new Error("device-revoke-manifest-refused", { cause: { reason: "no-answer", version: 3 } }))
      .mockResolvedValueOnce({ ok: true })
    // The manifest no longer brings it when reread: the line continues, by the mark.
    const bridge = ponte({ temChaveDeConta: true, servidorSuporta: true, servidorRevoga: true }, [OUTRO, ESTE], revoke)
    montar(bridge)
    fireEvent.click(await screen.findByRole("button", { name: /^Revogar/ }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: strings.settings.revoke }))
    const alerta = await screen.findByRole("alert")
    expect(alerta.textContent).toContain("Repete para acabar a revogação.")
    vi.mocked(bridge.pairing!.devices).mockResolvedValue([ESTE])
    await waitFor(() => expect(alerta.closest("li")?.textContent).toContain(strings.settings.revokePending))
    // Repetir acaba: a marca sai.
    fireEvent.click(screen.getByRole("button", { name: /^Revogar/ }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: strings.settings.revoke }))
    expect(await screen.findByText(strings.settings.revoked)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText(new RegExp(strings.settings.revokePending))).toBeNull())
    expect(revoke).toHaveBeenCalledTimes(2)
  })

  it('num aparelho sem chave de conta não há "Revogar"', async () => {
    montar(ponte({ temChaveDeConta: false, servidorSuporta: true, servidorRevoga: true }, [OUTRO, ESTE]))
    await waitFor(() => expect(screen.getByText(strings.pairing.noAccountKey)).toBeTruthy())
    expect(screen.queryByRole("button", { name: /^Revogar/ })).toBeNull()
  })

  it("o aviso da importação nomeia os dois botões pelo nome que eles têm", () => {
    // "Add device" is the main device button (Settings, Devices); "Yes, pair this
    // device" is the one on the gate in the new device, as long as Setup opens with
    // the question from the other device (phase 8.1).
    expect(strings.settings.importReplacesDevice).toContain(`"${strings.settings.addDevice}"`)
    expect(strings.settings.importReplacesDevice).toContain(`"${strings.gate.outroAparelhoSim}"`)
    expect(strings.pairing.hostLead).toContain(`"${strings.gate.outroAparelhoSim}"`)
  })

  it("abre a dizer que uma conta chega para todos os aparelhos (fase 8.1)", async () => {
    montar(ponte({ temChaveDeConta: true, servidorSuporta: true }, [ESTE]))
    expect(await screen.findByText(strings.comoFunciona.umaContaChega)).toBeTruthy()
    expect(strings.comoFunciona.umaContaChega).toBe("Uma conta chega para todos os teus aparelhos.")
  })

  it("as frases de contrato existem nas duas línguas e sem travessões", () => {
    for (const frase of [
      strings.pairing.doneBody,
      strings.pairing.doneGuestNote,
      strings.settings.importReplacesDevice,
      strings.settings.revokeBody,
      strings.settings.revokeHonest,
    ]) {
      expect(frase).not.toMatch(/[—–]/)
    }
    expect(strings.pairing.doneBody).toBe("Este aparelho já recebe as mensagens novas. As conversas antigas chegam do outro aparelho enquanto os dois estiverem ligados.")
    expect(strings.pairing.doneGuestNote).toBe("Acrescenta ou tira aparelhos no aparelho principal da conta.")
  })
})
