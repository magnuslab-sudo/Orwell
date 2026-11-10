import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { strings } from "../../strings.js"
import { ScreenPermission } from "./ScreenPermission.js"

/**
 * The macOS sheet when the system stops asking.
 *
 * Without it, a first share on a machine where permission was denied is
 * indistinguishable from a failure: the button loads, nothing happens, and there
 * is not a word anywhere. `ecra:permissao` and `ecra:abrirDefinicoes` existed and
 * were tracked since August 16, 2026; what did not exist was someone to read them.
 *
 * What is tracked: the sheet says what is happening, has a way to give permission,
 * and **warns that macOS requires restarting the application**. That last part is
 * why the sheet exists instead of a short warning, without it the person grants
 * permission, comes back, clicks again, and it still does not work.
 */

afterEach(cleanup)

/** The harness: what the host did stays written on screen. */
function Arnes(): React.JSX.Element {
  const [definicoes, setDefinicoes] = useState(0)
  const [fechada, setFechada] = useState(false)

  return (
    <>
      <p>painel aberto {definicoes} vez(es)</p>
      {fechada ? <p>folha fechada</p> : (
        <ScreenPermission onAbrirDefinicoes={() => setDefinicoes((n) => n + 1)} onClose={() => setFechada(true)} />
      )}
    </>
  )
}

describe("a folha da permissão de ecrã do macOS", () => {
  it("diz o que o sistema está a fazer, em vez de deixar o botão parecer avariado", () => {
    render(<Arnes />)

    expect(screen.getByText(strings.ecra.permissaoTitulo)).toBeTruthy()
    expect(screen.getByText(strings.ecra.permissaoCorpo)).toBeTruthy()
  })

  /**
   * Whose permission it is, told by MEANING not by the constant.
   *
   * Whoever does not read this will look for the switch in Orwell Settings,
   * where it never was and cannot be: what macOS keeps is the right of a process
   * to record the screen, and no application grants it to itself. A sheet that
   * only said "sharing is not possible" would send the person to look inside the
   * product, and the product has nothing there to find.
   */
  it("manda às Definições do macOS, e não a uma opção escondida nas Configurações do Orwell", () => {
    render(<Arnes />)

    const dito = document.body.textContent ?? ""
    expect(dito).toMatch(/Definições do macOS|Definições do sistema/i)
    expect(dito).not.toMatch(/Configurações do Orwell/i)
    // And where inside: without the panel name, "go to Settings" is a map without
    // a destination in a place with twenty sections.
    expect(dito).toMatch(/Privacidade e Segurança/i)
  })

  /**
   * The line that cannot be silenced, asserted by MEANING not by the constant.
   *
   * An assertion against `strings.ecra.permissaoReiniciar` would follow any rewrite
   *, including one that deleted the warning and left the key saying something else.
   * What this test demands is that the sheet talks about closing and reopening the
   * application, which is the macOS fact that nobody can work around.
   */
  it("avisa que é preciso fechar e voltar a abrir a aplicação depois de dar a permissão", () => {
    render(<Arnes />)

    const dito = document.body.textContent ?? ""
    expect(dito).toMatch(/fecha o Orwell e abre-o outra vez|reiniciar/i)
    expect(dito).toMatch(/Depois, fecha o Orwell/i)
  })

  it("o botão leva ao painel das Definições onde a permissão se dá", () => {
    render(<Arnes />)
    expect(screen.getByText("painel aberto 0 vez(es)")).toBeTruthy()

    fireEvent.click(screen.getByText(strings.ecra.permissaoAbrir))

    expect(screen.getByText("painel aberto 1 vez(es)")).toBeTruthy()
  })

  /**
   * And the sheet STAYS. It is on purpose and it is the whole point.
   *
   * The Settings panel opens on top, the person grants permission, and comes back.
   * If the sheet had closed by itself, the restart warning would disappear exactly
   * when it needs to be read.
   */
  it("abrir as Definições não fecha a folha: o aviso do reinício tem de continuar lá", () => {
    render(<Arnes />)

    fireEvent.click(screen.getByText(strings.ecra.permissaoAbrir))

    expect(screen.queryByText("folha fechada")).toBeNull()
    expect(document.body.textContent ?? "").toMatch(/Depois, fecha o Orwell/i)
  })

  it("e fecha-se quando é a pessoa a fechá-la", () => {
    render(<Arnes />)

    fireEvent.click(screen.getByText(strings.common.close))

    expect(screen.getByText("folha fechada")).toBeTruthy()
  })
})
