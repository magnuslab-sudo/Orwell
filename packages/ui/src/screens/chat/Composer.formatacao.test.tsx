import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { StrictMode, useState } from "react"
import { Composer } from "./Composer.js"
import type { EnclaveBridge } from "../../bridge.js"
import { BridgeContext } from "../../App.js"

afterEach(cleanup)

/**
 * The keyboard shortcuts tied to the conversation input bar.
 *
 * **Its own file, and the reason is coexistence.** `Composer.test.tsx` is being
 * edited by another hand at the same time; a new file sits beside it without
 * fighting over a single line. When both changes land, merge them, or do not, it does
 * not matter if it stays here.
 *
 * The shortcut mechanics are tested in `hooks/useAtalhosDeFormatacao.test.tsx`
 * and the math in `lib/atalhosDeFormatacao.test.ts`. What ties HERE is the
 * connection: that the conversation input bar has them. Without this file,
 * deleting the line that ties them would fail no test.
 */

const bridge = { social: { linkPreview: vi.fn().mockRejectedValue(new Error("não")) } } as unknown as EnclaveBridge

function Harness({ initial = "" }: { initial?: string }): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <StrictMode>
      <BridgeContext.Provider value={bridge}>
        <Composer connection="online" value={value} onChange={setValue} onSend={vi.fn()} />
      </BridgeContext.Provider>
    </StrictMode>
  )
}

function caixa(): HTMLInputElement {
  return screen.getByPlaceholderText("Escreve uma mensagem") as HTMLInputElement
}

describe("Composer — a formatação escreve-se com o teclado", () => {
  it("Cmd+B põe os asteriscos à volta do que está marcado", () => {
    render(<Harness initial="isto é urgente" />)
    const campo = caixa()
    campo.focus()
    campo.setSelectionRange(7, 14)
    fireEvent.keyDown(campo, { key: "b", metaKey: true })
    expect(campo.value).toBe("isto é **urgente**")
  })

  it("os quatro atalhos chegam todos à barra de escrita", () => {
    const casos: [Record<string, unknown>, string][] = [
      [{ key: "b", ctrlKey: true }, "**urgente**"],
      [{ key: "i", ctrlKey: true }, "*urgente*"],
      [{ key: "X", ctrlKey: true, shiftKey: true }, "~~urgente~~"],
      [{ key: "E", ctrlKey: true, shiftKey: true }, "||urgente||"],
    ]
    for (const [tecla, esperado] of casos) {
      cleanup()
      render(<Harness initial="urgente" />)
      const campo = caixa()
      campo.focus()
      campo.setSelectionRange(0, 7)
      fireEvent.keyDown(campo, tecla)
      expect(campo.value, JSON.stringify(tecla)).toBe(esperado)
    }
  })

  it("o que sai continua a ser texto, com os marcadores lá dentro", () => {
    // The guarantee that drives the whole design: formatting travels INSIDE the body,
    // not in new fields. An old client shows asterisks instead of
    // throwing the message away.
    const enviadas: [string, unknown][] = []
    function Envio(): React.JSX.Element {
      const [value, setValue] = useState("urgente")
      return (
        <BridgeContext.Provider value={bridge}>
          <Composer
            connection="online"
            value={value}
            onChange={setValue}
            onSend={(corpo, extras) => enviadas.push([corpo, extras])}
          />
        </BridgeContext.Provider>
      )
    }
    render(<Envio />)
    const campo = caixa()
    campo.focus()
    campo.setSelectionRange(0, 7)
    fireEvent.keyDown(campo, { key: "b", metaKey: true })
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }))
    expect(enviadas).toEqual([["**urgente**", undefined]])
  })

  it("uma tecla sem comando continua a ser texto de quem escreve", () => {
    render(<Harness initial="" />)
    const campo = caixa()
    fireEvent.change(campo, { target: { value: "bi" } })
    expect(campo.value).toBe("bi")
  })
})
