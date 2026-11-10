import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { useState } from "react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { SettingsScreen } from "./SettingsScreen.js"
import { seccoes, type Seccao } from "./seccoes.js"

/**
 * The settings sections on the phone (1.3.6).
 *
 * Below 841 px the section menu lived only in the sidebar drawer, which opens
 * from the rail's hamburger. Someone who tapped Settings saw Account and did
 * not know there were five more sections. On the phone, the screen itself
 * opens with the list; tapping a section opens it, and a button goes back to
 * the list.
 *
 * On a wide screen nothing changes: the menu stays in the sidebar, and the
 * screen shows the chosen section. The fake `matchMedia` decides which side
 * we are on.
 */

const bridge = {} as unknown as EnclaveBridge

function simularEcra(estreito: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((consulta: string) => ({
      matches: estreito && consulta.includes("max-width"),
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  )
}

function Ecra(): React.JSX.Element {
  const [seccao, setSeccao] = useState<Seccao>("conta")
  return (
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <SettingsScreen
          address="@me:casa.pt"
          connection="online"
          connectionDetail={null}
          onLock={() => {}}
          micMuted={false}
          soundOff={false}
          onToggleMic={() => {}}
          onToggleSound={() => {}}
          seccao={seccao}
          onSeccao={setSeccao}
        />
      </ToastProvider>
    </BridgeContext.Provider>
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => localStorage.clear())

describe("as secções das configurações no telemóvel", () => {
  it("o ecrã abre com a lista das seis secções, sem precisar da gaveta", () => {
    simularEcra(true)
    render(<Ecra />)
    const lista = screen.getByRole("navigation", { name: strings.settings.seccoesDoEcra })
    const botoes = within(lista).getAllByRole("button")
    expect(botoes.map((botao) => botao.textContent)).toEqual(seccoes().map((entrada) => entrada.label))
    // The list replaces the panel: no section is open yet.
    expect(screen.queryByRole("heading", { level: 2, name: strings.settings.account })).toBeNull()
  })

  it("tocar numa secção abre-a, e o botão de voltar devolve a lista", () => {
    simularEcra(true)
    render(<Ecra />)
    const lista = screen.getByRole("navigation", { name: strings.settings.seccoesDoEcra })
    fireEvent.click(within(lista).getByRole("button", { name: strings.settings.notifications }))
    expect(screen.queryByRole("navigation", { name: strings.settings.seccoesDoEcra })).toBeNull()
    expect(screen.getByRole("heading", { level: 2, name: strings.settings.notifications })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: strings.settings.voltarAsSeccoes }))
    expect(screen.getByRole("navigation", { name: strings.settings.seccoesDoEcra })).toBeTruthy()
  })

  it("em ecrã largo nada muda: a secção à vista, sem lista nem botão de voltar", () => {
    simularEcra(false)
    render(<Ecra />)
    expect(screen.queryByRole("navigation", { name: strings.settings.seccoesDoEcra })).toBeNull()
    expect(screen.queryByRole("button", { name: strings.settings.voltarAsSeccoes })).toBeNull()
    expect(screen.getByRole("heading", { level: 2, name: strings.settings.account })).toBeTruthy()
  })
})
