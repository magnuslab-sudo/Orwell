import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { StrictMode, useState } from "react"
import { Composer } from "./Composer.js"
import type { EnclaveBridge } from "../../bridge.js"
import { BridgeContext } from "../../App.js"
import type { RespostaNaCaixa } from "../../lib/respostas.js"
import { strings } from "../../strings.js"

/**
 * The reply bar above the input box: "Replying to {name}", the
 * "@ Mention" toggle and the X. Esc cancels, focus goes to the box, and
 * send carries the `replyTo` and, with mention on, the author in `mentions`.
 */

beforeEach(() => localStorage.clear())
afterEach(cleanup)

const ANA = "@ana-bela-cara-doce:exemplo"
const BRUNO = "@bruno-alto-pe-leve:exemplo"
const bridge = { social: { linkPreview: vi.fn().mockRejectedValue(new Error("não")) } } as unknown as EnclaveBridge

function Harness({
  resposta,
  onSend = vi.fn(),
  onAlternarMencao = vi.fn(),
  onCancelarResposta = vi.fn(),
}: {
  resposta: RespostaNaCaixa | null
  onSend?: (body: string, extras?: unknown) => void
  onAlternarMencao?: () => void
  onCancelarResposta?: () => void
}): React.JSX.Element {
  const [value, setValue] = useState("")
  return (
    <StrictMode>
      <BridgeContext.Provider value={bridge}>
        <Composer
          connection="online"
          value={value}
          onChange={setValue}
          onSend={onSend}
          eu={ANA}
          resposta={resposta}
          onAlternarMencao={onAlternarMencao}
          onCancelarResposta={onCancelarResposta}
        />
      </BridgeContext.Provider>
    </StrictMode>
  )
}

const aoBruno: RespostaNaCaixa = { id: "original-1", autor: BRUNO, nome: "Bruno", mencionar: true }

function caixa(): HTMLInputElement {
  return screen.getByPlaceholderText(strings.chat.composerPlaceholder) as HTMLInputElement
}

describe("a barra de resposta", () => {
  it("diz a quem se responde, e é anunciada", () => {
    render(<Harness resposta={aoBruno} />)
    const barra = document.querySelector(".composer-resposta")!
    expect(barra.textContent).toContain("A responder a")
    expect(barra.textContent).toContain("Bruno")
    const anuncio = document.querySelector('.composer-resposta-anuncio[aria-live="polite"]')
    expect(anuncio?.textContent).toBe("A responder a Bruno. Esc cancela.")
  })

  it("sem resposta, não há barra", () => {
    render(<Harness resposta={null} />)
    expect(document.querySelector(".composer-resposta")).toBeNull()
  })

  it("o interruptor «@ Mencionar» diz o estado, e carregar alterna", () => {
    const onAlternarMencao = vi.fn()
    const { rerender } = render(<Harness resposta={aoBruno} onAlternarMencao={onAlternarMencao} />)
    const interruptor = screen.getByRole("button", { name: /@ Mencionar/ })
    expect(interruptor.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(interruptor)
    expect(onAlternarMencao).toHaveBeenCalledTimes(1)
    rerender(<Harness resposta={{ ...aoBruno, mencionar: false }} onAlternarMencao={onAlternarMencao} />)
    expect(screen.getByRole("button", { name: /@ Mencionar/ }).getAttribute("aria-pressed")).toBe("false")
  })

  it("a responder a mim próprio, não há interruptor: não há a quem avisar", () => {
    render(<Harness resposta={{ ...aoBruno, autor: ANA, nome: "Ana" }} />)
    expect(screen.queryByRole("button", { name: /@ Mencionar/ })).toBeNull()
  })

  it("o X cancela, e o foco volta à caixa", () => {
    const onCancelarResposta = vi.fn()
    render(<Harness resposta={aoBruno} onCancelarResposta={onCancelarResposta} />)
    fireEvent.click(screen.getByRole("button", { name: "Cancelar a resposta" }))
    expect(onCancelarResposta).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(caixa())
  })

  it("Esc na caixa cancela a resposta", () => {
    const onCancelarResposta = vi.fn()
    render(<Harness resposta={aoBruno} onCancelarResposta={onCancelarResposta} />)
    fireEvent.keyDown(caixa(), { key: "Escape" })
    expect(onCancelarResposta).toHaveBeenCalledTimes(1)
  })

  it("começar uma resposta põe o foco na caixa", () => {
    const { rerender } = render(<Harness resposta={null} />)
    ;(document.body as HTMLElement).focus()
    rerender(<Harness resposta={aoBruno} />)
    expect(document.activeElement).toBe(caixa())
  })
})

describe("enviar uma resposta", () => {
  it("com «@ Mencionar» ligado: leva o `replyTo` e menciona o autor", () => {
    const onSend = vi.fn()
    render(<Harness resposta={aoBruno} onSend={onSend} />)
    fireEvent.change(caixa(), { target: { value: "Eu vou." } })
    fireEvent.submit(caixa().closest("form")!)
    expect(onSend).toHaveBeenCalledWith("Eu vou.", { replyTo: "original-1", mentions: [BRUNO] })
  })

  it("com «@ Mencionar» desligado: leva o `replyTo` e não menciona ninguém", () => {
    const onSend = vi.fn()
    render(<Harness resposta={{ ...aoBruno, mencionar: false }} onSend={onSend} />)
    fireEvent.change(caixa(), { target: { value: "Eu vou." } })
    fireEvent.submit(caixa().closest("form")!)
    expect(onSend).toHaveBeenCalledWith("Eu vou.", { replyTo: "original-1" })
  })

  it("sem resposta, a mensagem sai como sempre, com um argumento só", () => {
    const onSend = vi.fn()
    render(<Harness resposta={null} onSend={onSend} />)
    fireEvent.change(caixa(), { target: { value: "olá" } })
    fireEvent.submit(caixa().closest("form")!)
    expect(onSend).toHaveBeenCalledWith("olá")
  })
})
