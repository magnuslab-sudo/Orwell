import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render as baseRender, screen, within } from "@testing-library/react"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { ToastProvider } from "../../components/Toast.js"
import { nomeEmFalta } from "../../lib/format.js"
import { citacaoDe, indiceDasCitacoes, type Citacao } from "../../lib/respostas.js"
import { Timeline } from "./Timeline.js"

/**
 * Reply in the conversation: the button on the bar that appears on hover, the
 * R key, the left swipe, and the quote line above the reply, with three states
 * for an original that is not visible.
 */

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> => baseRender(ui, { wrapper: ToastProvider })

afterEach(cleanup)
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const CANAL = "!lagar:exemplo"
const ANA = "@ana-bela-cara-doce:exemplo"
const BRUNO = "@bruno-alto-pe-leve:exemplo"
const SEM_NOME = "@sem-nome-nem-cara:exemplo"
const noop = (): void => {}

function dita(seq: number, sender: string, body: string, extra: Partial<ChatMessage["payload"]> = {}): ChatMessage {
  return { channel: CANAL, seq, sender, payload: { t: "message", id: `id-${seq}`, sentAt: seq * 600_000, body, ...extra } }
}

const nomes = (endereco: string): string =>
  endereco === ANA ? "Ana" : endereco === BRUNO ? "Bruno" : nomeEmFalta(endereco)

/** The quote of each id, as the shell resolves it: spanning the same messages. */
function resolver(mensagens: ChatMessage[], cruas: ChatMessage[] = mensagens, haMais = false): (id: string) => Citacao {
  const indice = indiceDasCitacoes(cruas, mensagens)
  return (id) => citacaoDe(id, indice, haMais)
}

function timeline(overrides: Partial<React.ComponentProps<typeof Timeline>>): React.JSX.Element {
  return (
    <Timeline
      channel={CANAL}
      messages={[]}
      pending={[]}
      onRetry={noop}
      onDiscard={noop}
      me={ANA}
      nameFor={nomes}
      directory={new Map<string, Profile>()}
      {...overrides}
    />
  )
}

const pergunta = dita(1, BRUNO, "Quem vem amanhã ao lagar?")
const resposta = dita(2, ANA, "Eu vou.", { replyTo: "id-1" })

describe("o gesto de responder", () => {
  it("a barra de acções leva «Responder», e o botão entrega a mensagem", () => {
    const onResponder = vi.fn()
    render(timeline({ messages: [pergunta], onResponder }))
    const linha = document.querySelector<HTMLElement>(".message")!
    fireEvent.click(within(linha).getByRole("button", { name: "Responder" }))
    expect(onResponder).toHaveBeenCalledWith(pergunta)
  })

  it("sem `onResponder` não há botão nenhum", () => {
    render(timeline({ messages: [pergunta] }))
    expect(screen.queryByRole("button", { name: "Responder" })).toBeNull()
  })

  it("um pedido de amizade ou uma linha sem id não oferece responder", () => {
    const semId: ChatMessage = { channel: CANAL, seq: 3, sender: BRUNO, payload: { t: "message", body: "sem id" } }
    render(timeline({ messages: [semId], onResponder: vi.fn() }))
    expect(screen.queryByRole("button", { name: "Responder" })).toBeNull()
  })

  it("R com a mensagem focada responde, como no Discord", () => {
    const onResponder = vi.fn()
    render(timeline({ messages: [pergunta], onResponder }))
    const botao = screen.getByRole("button", { name: "Responder" })
    botao.focus()
    fireEvent.keyDown(botao, { key: "r" })
    expect(onResponder).toHaveBeenCalledWith(pergunta)
  })

  it("R com Ctrl ou Cmd não é responder", () => {
    const onResponder = vi.fn()
    render(timeline({ messages: [pergunta], onResponder }))
    const linha = document.querySelector<HTMLElement>(".message")!
    fireEvent.keyDown(linha, { key: "r", ctrlKey: true })
    fireEvent.keyDown(linha, { key: "r", metaKey: true })
    expect(onResponder).not.toHaveBeenCalled()
  })

  it("deslizar a mensagem para a esquerda, com o dedo, responde", () => {
    const onResponder = vi.fn()
    render(timeline({ messages: [pergunta], onResponder }))
    const linha = document.querySelector<HTMLElement>(".message")!
    fireEvent.touchStart(linha, { touches: [{ clientX: 300, clientY: 100 }] })
    fireEvent.touchMove(linha, { touches: [{ clientX: 260, clientY: 102 }] })
    fireEvent.touchMove(linha, { touches: [{ clientX: 200, clientY: 104 }] })
    fireEvent.touchEnd(linha, { changedTouches: [{ clientX: 200, clientY: 104 }] })
    expect(onResponder).toHaveBeenCalledWith(pergunta)
  })

  it("um deslize curto, ou na vertical, não responde: é ler a conversa", () => {
    const onResponder = vi.fn()
    render(timeline({ messages: [pergunta], onResponder }))
    const linha = document.querySelector<HTMLElement>(".message")!
    fireEvent.touchStart(linha, { touches: [{ clientX: 300, clientY: 100 }] })
    fireEvent.touchMove(linha, { touches: [{ clientX: 280, clientY: 101 }] })
    fireEvent.touchEnd(linha, { changedTouches: [{ clientX: 280, clientY: 101 }] })
    fireEvent.touchStart(linha, { touches: [{ clientX: 300, clientY: 100 }] })
    fireEvent.touchMove(linha, { touches: [{ clientX: 220, clientY: 200 }] })
    fireEvent.touchEnd(linha, { changedTouches: [{ clientX: 220, clientY: 200 }] })
    expect(onResponder).not.toHaveBeenCalled()
  })
})

describe("a linha de citação", () => {
  it("mostra quem escreveu o original e o início do texto, num botão com rótulo", () => {
    const conversa = [pergunta, resposta]
    render(timeline({ messages: conversa, citacaoDe: resolver(conversa), onIrParaOriginal: vi.fn() }))
    const botao = screen.getByRole("button", { name: "Ir para a mensagem de Bruno" })
    expect(botao.textContent).toContain("Bruno")
    expect(botao.textContent).toContain("Quem vem amanhã ao lagar?")
    // Above the reply body, inside the same row.
    const linha = botao.closest(".message")!
    expect(linha.textContent).toContain("Eu vou.")
  })

  it("carregar na citação leva ao original", () => {
    const onIrParaOriginal = vi.fn()
    const conversa = [pergunta, resposta]
    render(timeline({ messages: conversa, citacaoDe: resolver(conversa), onIrParaOriginal }))
    fireEvent.click(screen.getByRole("button", { name: "Ir para a mensagem de Bruno" }))
    expect(onIrParaOriginal).toHaveBeenCalledWith("id-1")
  })

  it("o nome tirado do endereço sai como tal (NomeDePessoa)", () => {
    const original = dita(1, SEM_NOME, "olá")
    const conversa = [original, dita(2, ANA, "olá!", { replyTo: "id-1" })]
    render(timeline({ messages: conversa, citacaoDe: resolver(conversa), onIrParaOriginal: vi.fn() }))
    const botao = screen.getByRole("button", { name: `Ir para a mensagem de ${nomeEmFalta(SEM_NOME)}` })
    expect(botao.querySelector(".nome-do-endereco")?.textContent).toBe(nomeEmFalta(SEM_NOME))
  })

  it("um original só com imagem diz «Imagem»", () => {
    const original = dita(1, BRUNO, "", { attachments: [{ mediaType: "image/png", name: "f.png" } as never] })
    const conversa = [original, dita(2, ANA, "linda", { replyTo: "id-1" })]
    render(timeline({ messages: conversa, citacaoDe: resolver(conversa), onIrParaOriginal: vi.fn() }))
    expect(screen.getByRole("button", { name: "Ir para a mensagem de Bruno" }).textContent).toContain("Imagem")
  })

  it("um original só com ficheiro mostra o nome do ficheiro", () => {
    const original = dita(1, BRUNO, "", { attachments: [{ mediaType: "application/pdf", name: "acta.pdf" } as never] })
    const conversa = [original, dita(2, ANA, "lido", { replyTo: "id-1" })]
    render(timeline({ messages: conversa, citacaoDe: resolver(conversa), onIrParaOriginal: vi.fn() }))
    expect(screen.getByRole("button", { name: "Ir para a mensagem de Bruno" }).textContent).toContain("acta.pdf")
  })

  it("responder a uma resposta mostra só o original imediato", () => {
    const terceira = dita(3, BRUNO, "Óptimo.", { replyTo: "id-2" })
    const conversa = [pergunta, resposta, terceira]
    render(timeline({ messages: conversa, citacaoDe: resolver(conversa), onIrParaOriginal: vi.fn() }))
    const linhas = document.querySelectorAll(".message")
    const citacoes = linhas[2]!.querySelectorAll(".message-citacao")
    expect(citacoes).toHaveLength(1)
    expect(citacoes[0]!.textContent).toContain("Eu vou.")
    expect(citacoes[0]!.textContent).not.toContain("Quem vem amanhã")
  })

  it("um original apagado diz que foi apagado, e não é um botão", () => {
    const lapide: ChatMessage = { channel: CANAL, seq: 9, sender: BRUNO, payload: { t: "redact", target: "id-1" } }
    render(
      timeline({
        messages: [resposta],
        citacaoDe: resolver([resposta], [pergunta, resposta, lapide]),
        onIrParaOriginal: vi.fn(),
      }),
    )
    const linha = document.querySelector(".message")!
    expect(linha.querySelector(".message-citacao")?.textContent).toBe("A mensagem original foi apagada.")
    expect(within(linha as HTMLElement).queryByRole("button", { name: /Ir para/ })).toBeNull()
  })

  it("um original que não está neste aparelho diz isso", () => {
    render(timeline({ messages: [resposta], citacaoDe: resolver([resposta]), onIrParaOriginal: vi.fn() }))
    expect(document.querySelector(".message-citacao")?.textContent).toBe("A mensagem original não está neste aparelho.")
  })

  it("com histórico por carregar, a citação é um botão que o vai buscar", () => {
    const onIrParaOriginal = vi.fn()
    render(timeline({ messages: [resposta], citacaoDe: resolver([resposta], [resposta], true), onIrParaOriginal }))
    fireEvent.click(screen.getByRole("button", { name: "Carregar a mensagem original" }))
    expect(onIrParaOriginal).toHaveBeenCalledWith("id-1")
  })

  it("sem resolvedor, uma resposta desenha-se como mensagem normal", () => {
    render(timeline({ messages: [resposta] }))
    expect(document.querySelector(".message-citacao")).toBeNull()
    expect(screen.getByText("Eu vou.")).toBeTruthy()
  })
})

describe("a mensagem a que se saltou", () => {
  it("recebe o foco, para o leitor de ecrã e a tecla R chegarem lá", () => {
    const conversa = [pergunta, resposta]
    render(timeline({ messages: conversa, destacada: "id-1", onResponder: vi.fn() }))
    const alvo = document.querySelector<HTMLElement>('.message[data-mensagem="id-1"]')!
    expect(document.activeElement).toBe(alvo)
  })
})
