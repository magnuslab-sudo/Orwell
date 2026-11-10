import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render as baseRender, screen } from "@testing-library/react"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { ToastProvider } from "../../components/Toast.js"
import { Timeline } from "./Timeline.js"

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
  baseRender(ui, { wrapper: ToastProvider })

afterEach(cleanup)

const noop = (): void => {}

function dita(seq: number, body: string): ChatMessage {
  return {
    channel: "!lagar:exemplo",
    seq,
    sender: "@ana:exemplo",
    payload: { t: "message", id: `id-${seq}`, sentAt: seq * 60_000, body },
  }
}

function timeline(overrides: Partial<React.ComponentProps<typeof Timeline>>): React.JSX.Element {
  return (
    <Timeline
      channel="!lagar:exemplo"
      messages={[]}
      pending={[]}
      onRetry={noop}
      onDiscard={noop}
      me={null}
      nameFor={(sender) => sender}
      directory={new Map<string, Profile>()}
      {...overrides}
    />
  )
}

/**
 * Where the view ended up.
 *
 * `scrollIntoView` does not exist in the test DOM, and what depends on it is not
 * "was it called": it is WHICH row was brought into view. In a four-hundred-line
 * conversation with identical rows, jumping to the wrong one and jumping to none
 * are the same fault to the person watching.
 */
let trazidaAVista: Element[] = []

beforeEach(() => {
  trazidaAVista = []
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    trazidaAVista.push(this)
  })
})

describe("Timeline — saltar para uma mensagem", () => {
  const conversa = [dita(1, "primeira"), dita(2, "a do meio"), dita(3, "última")]

  it("acende a linha a que se saltou, e só essa", () => {
    render(timeline({ messages: conversa, destacada: "id-2" }))

    const acesas = [...document.querySelectorAll(".message.destacada")]
    expect(acesas).toHaveLength(1)
    expect(acesas[0]?.textContent).toContain("a do meio")
  })

  it("traz à vista a linha da mensagem, e não outra qualquer", () => {
    render(timeline({ messages: conversa, destacada: "id-2" }))

    expect(trazidaAVista).toHaveLength(1)
    expect(trazidaAVista[0]?.textContent).toContain("a do meio")
  })

  it("sem destaque nenhum não mexe a conversa de sítio", () => {
    render(timeline({ messages: conversa }))

    expect(trazidaAVista).toEqual([])
    expect(document.querySelector(".message.destacada")).toBeNull()
  })

  /**
   * The message may not be in memory when the jump starts.
   *
   * The shell loads the two-hundred most recent messages from each channel into
   * memory, and an older result forces it to fetch the rest from the vault,    * which takes time. Without this wait, the jump happened on a conversation
   * that did not yet have the row, found nothing, and died silently: the sheet
   * closed and the person stayed where they were.
   */
  it("espera pela mensagem quando ela ainda está a ser carregada do cofre", () => {
    const { rerender } = render(timeline({ messages: [dita(3, "última")], destacada: "id-1" }))
    expect(trazidaAVista).toEqual([])

    rerender(timeline({ messages: conversa, destacada: "id-1" }))

    expect(trazidaAVista).toHaveLength(1)
    expect(trazidaAVista[0]?.textContent).toContain("primeira")
  })

  it("saltar de uma mensagem para outra apaga a marca da primeira", () => {
    const { rerender } = render(timeline({ messages: conversa, destacada: "id-1" }))

    rerender(timeline({ messages: conversa, destacada: "id-3" }))

    const acesas = [...document.querySelectorAll(".message.destacada")]
    expect(acesas).toHaveLength(1)
    expect(acesas[0]?.textContent).toContain("última")
  })

  it("uma mensagem que não está nesta sala não acende nada nem move a vista", () => {
    render(timeline({ messages: conversa, destacada: "id-99" }))

    expect(document.querySelector(".message.destacada")).toBeNull()
    expect(trazidaAVista).toEqual([])
  })

  it("a marca da conversa continua a ler-se com o destaque em cima", () => {
    render(timeline({ messages: conversa, destacada: "id-2" }))

    // The highlight is a class on top of the row, not a different row: the
    // text, author, and time all stay there.
    expect(screen.getByText("a do meio")).toBeTruthy()
  })
})
