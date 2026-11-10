import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render as baseRender, screen } from "@testing-library/react"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { strings } from "../../strings.js"
import { ToastProvider } from "../../components/Toast.js"
import { Timeline } from "./Timeline.js"

/**
 * The marker of the place (S5, §2.5): "You joined here. What was said before
 * does not reach this device.", at the point where this device entered the channel.
 */

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> => baseRender(ui, { wrapper: ToastProvider })

afterEach(cleanup)

const noop = (): void => {}

function mensagem(seq: number, body: string): ChatMessage {
  return { channel: "!sala:s", seq, sender: "@abc:s", payload: { t: "message", id: `id-${seq}`, sentAt: seq, body } }
}

function timeline(overrides: Partial<React.ComponentProps<typeof Timeline>>): React.JSX.Element {
  return (
    <Timeline
      channel="!sala:s"
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

/** What comes before and after the marker, in screen order. */
function vizinhos(): { antes: string | null; depois: string | null } {
  const marca = screen.getByRole("note")
  const linhas = [...document.querySelectorAll("article.message, .timeline-lugar")]
  const i = linhas.indexOf(marca)
  const corpo = (el: Element | undefined): string | null => (el ? (el.querySelector(".message-body, p")?.textContent ?? el.textContent) : null)
  return { antes: corpo(linhas[i - 1]), depois: corpo(linhas[i + 1]) }
}

const EM = Date.UTC(2026, 9, 3, 12)

describe("o marcador do lugar", () => {
  it("diz a frase e a data, num sítio da conversa e não num aviso", () => {
    render(timeline({ messages: [mensagem(10, "primeira")], lugar: { seq: 5, em: EM } }))
    const marca = screen.getByRole("note")
    expect(marca.textContent).toContain(strings.sincronia.lugar)
    expect(marca.querySelector("time")?.getAttribute("dateTime")).toBe(new Date(EM).toISOString())
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("fica antes da primeira mensagem dita no lugar ou depois dele", () => {
    // A rejoin: the old place has conversation in the vault, and the marker sits between them.
    render(timeline({ messages: [mensagem(3, "velha"), mensagem(4, "velha 2"), mensagem(8, "nova")], lugar: { seq: 6, em: EM } }))
    const { antes, depois } = vizinhos()
    expect(antes).toContain("velha 2")
    expect(depois).toContain("nova")
  })

  it("no topo, quando tudo o que há foi dito depois do lugar", () => {
    render(timeline({ messages: [mensagem(10, "a"), mensagem(11, "b")], lugar: { seq: 9, em: EM } }))
    expect(vizinhos()).toEqual({ antes: null, depois: expect.stringContaining("a") })
  })

  it("uma mensagem sem `seq` (relatada sem ele) no meio da conversa velha não puxa o marcador para cima", () => {
    render(timeline({ messages: [mensagem(3, "velha"), mensagem(-1, "sem número"), mensagem(4, "velha 2"), mensagem(8, "nova")], lugar: { seq: 6, em: EM } }))
    const { antes, depois } = vizinhos()
    expect(antes).toContain("velha 2")
    expect(depois).toContain("nova")
  })

  it("com a conversa vazia, aparece na mesma", () => {
    render(timeline({ messages: [], lugar: { seq: 9, em: EM } }))
    expect(screen.getByRole("note").textContent).toContain(strings.sincronia.lugar)
  })

  it("não aparece no topo quando ainda há mensagens antigas por carregar", () => {
    render(timeline({ messages: [mensagem(10, "a")], lugar: { seq: 9, em: EM }, canLoadOlder: true, onLoadOlder: noop }))
    expect(screen.queryByRole("note")).toBeNull()
  })

  it("sem lugar (quem fundou o canal, ou um canal antigo), não há marcador", () => {
    render(timeline({ messages: [mensagem(10, "a")], lugar: null }))
    expect(screen.queryByRole("note")).toBeNull()
  })

  it("num canal novo com lugar, o vazio diz uma vez a frase do lugar (fase 6)", () => {
    localStorage.clear()
    render(timeline({ messages: [], lugar: { seq: 9, em: EM }, fraseDoLugar: true }))
    expect(screen.getByText(strings.frasesDoMomento.canal)).toBeTruthy()
  })

  it("e não a diz numa directa, nem a quem fundou o canal", () => {
    localStorage.clear()
    render(timeline({ messages: [], lugar: { seq: 9, em: EM }, fraseDoLugar: false }))
    expect(screen.queryByText(strings.frasesDoMomento.canal)).toBeNull()
    cleanup()
    render(timeline({ messages: [], lugar: null, fraseDoLugar: true }))
    expect(screen.queryByText(strings.frasesDoMomento.canal)).toBeNull()
  })

  it("a frase não usa jargão", () => {
    for (const frase of [strings.sincronia.lugar, strings.sincronia.lugarData("3 de outubro de 2026")]) {
      expect(frase).not.toMatch(/época|MLS|resumo|epoch|seq/i)
    }
  })
})
