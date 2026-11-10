import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { strings } from "../../strings.js"
import { CallPanel } from "./CallPanel.js"

/** The call panel in the AFK room (2/11/2026): no voice, and the warning with "Return". */

afterEach(cleanup)
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

const perfil = { displayName: "Eu", donations: [] } as unknown as Profile

function painel(extra: Partial<React.ComponentProps<typeof CallPanel>> = {}): React.JSX.Element {
  return (
    <CallPanel
      call={{ setMuted: () => {}, setCameraOff: () => {}, podePartilharEcra: true, tectoDePartilha: 16 } as unknown as EnclaveBridge["call"]}
      channel="!geral:s"
      participants={[]}
      localStream={null}
      selfLabel="Eu"
      selfProfile={perfil}
      nameFor={(sender) => sender}
      directory={new Map()}
      onLeave={() => {}}
      onToggleMic={() => {}}
      onToggleSound={() => {}}
      onShareScreen={() => {}}
      onConversa={() => {}}
      {...extra}
    />
  )
}

describe("CallPanel na sala AFK", () => {
  it("fora da sala AFK, a barra tem microfone, som e ecrã", () => {
    const { container } = render(painel())
    expect(screen.getByRole("button", { name: strings.call.micAria(false) })).toBeTruthy()
    expect(container.querySelector("[data-ecra]")).not.toBeNull()
  })

  it("na sala AFK, só fica desligar, e uma linha diz porquê", () => {
    const { container } = render(painel({ semVoz: true }))
    expect(screen.queryByRole("button", { name: strings.call.micAria(false) })).toBeNull()
    expect(screen.queryByRole("button", { name: strings.call.soundAria(false) })).toBeNull()
    expect(container.querySelector("[data-ecra]")).toBeNull()
    expect(container.querySelector("[data-musica]")).toBeNull()
    expect(screen.getByRole("button", { name: strings.call.leave })).toBeTruthy()
    expect(screen.getByText(strings.salaAfk.semVozNemTexto)).toBeTruthy()
  })

  it('o aviso de quem foi movido tem "Voltar", e fecha-se', async () => {
    const onVoltar = vi.fn()
    const onFechar = vi.fn()
    render(
      painel({
        semVoz: true,
        avisoAfk: { texto: strings.salaAfk.movido(15), voltar: strings.salaAfk.voltarPara("Geral"), onVoltar, onFechar },
      }),
    )
    expect(screen.getByText("Estiveste silenciado 15 minutos. Passaste para a sala AFK.")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Voltar para Geral" }))
    expect(onVoltar).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole("button", { name: strings.salaAfk.fechar }))
    expect(onFechar).toHaveBeenCalledTimes(1)
  })
})
