import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { FonteDeEcra } from "../../bridge.js"
import { strings } from "../../strings.js"
import { ScreenPicker } from "./ScreenPicker.js"

/**
 * The window selector, seen from where the person is.
 *
 * In the installed application there is no system selector anywhere: where
 * Electron's `useSystemPicker` does not exist, the request falls to the main
 * process and waits for someone to choose. This is that someone, and until
 * August 17, 2026 it did not exist, `ecra:fontes` and `ecra:escolher` were
 * written, tested, and with no single caller.
 *
 * What is measured here is what is SEEN and what comes from the click: the names
 * in the list, the thumbnails the system gave, the split between full screen and
 * window, and the source that comes out chosen. No `toHaveBeenCalled`, the
 * harness stores the choice in state and draws it, so a button linked to the
 * wrong source fails here.
 */

afterEach(cleanup)

function fonte(id: string, nome: string, miniatura = "data:image/png;base64,MINIATURA"): FonteDeEcra {
  return { id, nome, miniatura, ecraInteiro: id.startsWith("screen:") }
}

const FONTES = [
  fonte("screen:0:0", "Ecrã 1"),
  fonte("window:12:0", "Editor"),
  fonte("window:13:0", "Contas 2026"),
]

/** The list buttons, in draw order. */
function linhas(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".ecra-fonte")]
}

/**
 * The harness: stores what the selector gave back and writes it on screen.
 *
 * This is what makes the assertion a measurement and not a spy. What is asserted
 * is the sentence that appears after the click, built with the source that came
 * out of there.
 */
function Arnes({ fontes = FONTES, aCarregar = false }: { fontes?: FonteDeEcra[]; aCarregar?: boolean }): React.JSX.Element {
  const [saida, setSaida] = useState<string | null>(null)
  if (saida !== null) return <p>saiu: {saida}</p>
  return (
    <ScreenPicker
      fontes={fontes}
      aCarregar={aCarregar}
      onEscolher={(escolhida) => setSaida(`${escolhida.nome} (${escolhida.id})`)}
      onCancelar={() => setSaida("nada")}
    />
  )
}

describe("ScreenPicker — a lista do que há para partilhar", () => {
  it("mostra uma linha por fonte, com o nome que o sistema lhe deu", () => {
    render(<Arnes />)

    expect(linhas()).toHaveLength(3)
    expect(screen.getByText("Ecrã 1")).toBeTruthy()
    expect(screen.getByText("Editor")).toBeTruthy()
    expect(screen.getByText("Contas 2026")).toBeTruthy()
  })

  it("os ecrãs inteiros vêm primeiro, e debaixo de cabeçalhos diferentes das janelas", () => {
    render(<Arnes />)

    // The two groups exist, not one flowing list with a title on top.
    const grupos = [...document.querySelectorAll<HTMLElement>(".ecra-grupo h3")].map((h) => h.textContent)
    expect(grupos).toEqual([strings.ecra.ecras, strings.ecra.janelas])

    // And the order is what matters: whoever looks for the full screen finds it
    // on top, not after forty windows.
    expect(linhas().map((linha) => linha.textContent)).toEqual(["Ecrã 1", "Editor", "Contas 2026"])
  })

  it("a miniatura que o sistema deu é a que se vê", () => {
    render(<Arnes fontes={[fonte("window:12:0", "Editor", "data:image/png;base64,EDITOR")]} />)

    const imagem = document.querySelector<HTMLImageElement>(".ecra-fonte img")
    expect(imagem?.getAttribute("src")).toBe("data:image/png;base64,EDITOR")
    // Empty on purpose: the name is beside it, in text, and an `alt` repeating it
    // would make screen readers say the name twice per line.
    expect(imagem?.getAttribute("alt")).toBe("")
  })

  /**
   * A source with NO NAME at all, which is the case one layout engine showed.
   *
   * The main process already swaps the empty name for the label, see
   * `reduzirFontes`, so this should not happen. But when it did, in a real
   * browser measurement, what you saw was a grey rectangle with no image and no
   * word: something impossible to choose because you do not know what it is.
   * An `alt=""` and an empty name add up to nothing.
   *
   * The label repeats here on purpose. It is not distrust of the other side of
   * IPC: it is that the cost of repeating it is one line, and the cost of not
   * repeating it is a mute box in the middle of the grid, in a place where the
   * person has to choose.
   */
  it("uma fonte sem nome nenhum ganha a etiqueta, em vez de ficar uma caixa muda", () => {
    render(<Arnes fontes={[fonte("window:12:0", "", "")]} />)

    expect(screen.getByText(strings.ecra.semNome)).toBeTruthy()
    expect(linhas()[0]?.getAttribute("aria-label")).toBe(strings.ecra.escolherAria(strings.ecra.semNome))
  })

  it("um nome que é só espaços conta como nome nenhum", () => {
    render(<Arnes fontes={[fonte("window:12:0", "   ", "")]} />)
    expect(screen.getByText(strings.ecra.semNome)).toBeTruthy()
  })

  it("uma fonte sem miniatura continua a ser escolhível, e não deixa uma imagem partida", () => {
    render(<Arnes fontes={[fonte("window:12:0", "Editor", "")]} />)

    expect(document.querySelector(".ecra-fonte img")).toBeNull()
    expect(screen.getByText("Editor")).toBeTruthy()
    expect(linhas()).toHaveLength(1)
  })

  it("o nome acessível de cada linha diz o que o clique faz", () => {
    render(<Arnes />)
    expect(linhas()[1]?.getAttribute("aria-label")).toBe(strings.ecra.escolherAria("Editor"))
  })

  it("sem nada para partilhar, diz-se — e não se desenha uma lista vazia", () => {
    render(<Arnes fontes={[]} />)

    expect(linhas()).toHaveLength(0)
    expect(screen.getByText(strings.ecra.vazio)).toBeTruthy()
    expect(document.querySelector(".ecra-grupo")).toBeNull()
  })

  it("enquanto o sistema procura, diz que está a procurar — e não que não há nada", () => {
    render(<Arnes fontes={[]} aCarregar />)

    expect(screen.getByText(strings.ecra.aCarregar)).toBeTruthy()
    expect(screen.queryByText(strings.ecra.vazio)).toBeNull()
  })
})

describe("ScreenPicker — a escolha", () => {
  /*
    The SECOND window, not the first.

    Tracked by mutation: with the click on the first, an `onEscolher` tied to
    the first element of the list instead of the clicked element would pass green
    in both cases, the first screen is the first of the screens group, and the
    first window is the first of the windows group. You need to click on a line
    that is not the head of any group for the difference to show.
  */
  it("carregar numa janela devolve AQUELA janela, com o identificador dela", () => {
    render(<Arnes />)

    fireEvent.click(linhas()[2]!)

    expect(screen.getByText("saiu: Contas 2026 (window:13:0)")).toBeTruthy()
  })

  it("e a janela do meio não se confunde com a de baixo", () => {
    render(<Arnes />)

    fireEvent.click(linhas()[1]!)

    expect(screen.getByText("saiu: Editor (window:12:0)")).toBeTruthy()
  })

  it("carregar no ecrã inteiro devolve o ecrã, e não a primeira janela", () => {
    render(<Arnes />)

    fireEvent.click(linhas()[0]!)

    expect(screen.getByText("saiu: Ecrã 1 (screen:0:0)")).toBeTruthy()
  })

  it("cancelar desiste, que é o caminho normal e não um erro", () => {
    render(<Arnes />)

    fireEvent.click(screen.getByText(strings.common.cancel))

    expect(screen.getByText("saiu: nada")).toBeTruthy()
  })

  it("a tecla de fuga desiste também: um selector aberto tem de ter saída sem rato", () => {
    render(<Arnes />)

    fireEvent.keyDown(document, { key: "Escape" })

    expect(screen.getByText("saiu: nada")).toBeTruthy()
  })
})

describe("ScreenPicker — o som do sistema vai sempre", () => {
  /* Owner request from 2/11/2026: sound is not an option, it goes by default. */
  function ArnesComSom({ somDisponivel }: { somDisponivel: boolean }): React.JSX.Element {
    const [saida, setSaida] = useState<string | null>(null)
    if (saida !== null) return <p>saiu: {saida}</p>
    return (
      <ScreenPicker
        fontes={FONTES}
        aCarregar={false}
        somDisponivel={somDisponivel}
        onEscolher={(escolhida) => setSaida(escolhida.id)}
        onCancelar={() => setSaida("nada")}
      />
    )
  }

  it("não há caixa do som, e uma linha diz que o som vai com o ecrã", () => {
    render(<ArnesComSom somDisponivel />)
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.getByText(strings.ecra.somDoSistemaNota)).toBeTruthy()

    fireEvent.click(linhas()[1]!)
    expect(screen.getByText("saiu: window:12:0")).toBeTruthy()
  })

  it("onde o sistema não dá o som, não há caixa nem linha", () => {
    render(<ArnesComSom somDisponivel={false} />)
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.queryByText(strings.ecra.somDoSistemaNota)).toBeNull()
  })
})
