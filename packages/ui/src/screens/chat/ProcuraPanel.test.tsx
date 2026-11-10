import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Profile } from "../../bridge.js"
import type { Achado } from "../../lib/procura.js"
import type { EstadoDaProcura } from "../../hooks/useProcura.js"
import { strings } from "../../strings.js"
import { ProcuraPanel } from "./ProcuraPanel.js"

afterEach(cleanup)

const noop = (): void => {}

function achado(id: string, body: string, extra: Partial<Achado> = {}): Achado {
  return { id, sender: "@ana:exemplo", at: 1_700_000_000_000, room: "", body, ...extra }
}

function estado(overrides: Partial<EstadoDaProcura> = {}): EstadoDaProcura {
  return {
    termo: "",
    definirTermo: noop,
    resultados: [],
    noTecto: false,
    procuradas: 0,
    aLer: false,
    ...overrides,
  }
}

function painel(overrides: Partial<React.ComponentProps<typeof ProcuraPanel>> = {}): React.JSX.Element {
  return (
    <ProcuraPanel
      estado={estado()}
      directory={new Map<string, Profile>()}
      nameFor={(address) => (address === "@ana:exemplo" ? "Ana Rita" : address)}
      nomeDaSala={(room) => (room === "estaleiro" ? "Estaleiro" : room)}
      salaAberta=""
      onAbrir={noop}
      onClose={noop}
      {...overrides}
    />
  )
}

describe("ProcuraPanel", () => {
  it("um resultado diz o que foi escrito, quem o escreveu e quando", () => {
    render(painel({ estado: estado({ termo: "orçamento", resultados: [achado("id-1", "o orçamento do lagar")] }) }))

    const linha = screen.getByRole("button", { name: new RegExp(strings.chat.searchJump) })
    expect(linha.textContent).toContain("o orçamento do lagar")
    expect(screen.getByText("Ana Rita")).toBeTruthy()
    expect(document.querySelector(".procura-linha time")).toBeTruthy()
  })

  /**
   * The term appears highlighted, and the highlight is NODES.
   *
   * What we test here is the cut: "budget" comes out inside a mark and the rest
   * of the sentence stays outside it. An implementation that returned markup in
   * a string would pass this test just as well as this one, the next test is
   * what catches it.
   */
  it("realça o termo encontrado dentro do texto", () => {
    render(painel({ estado: estado({ termo: "orçamento", resultados: [achado("id-1", "o orçamento do lagar")] }) }))

    const marcas = [...document.querySelectorAll(".procura-linha mark")]
    expect(marcas.map((marca) => marca.textContent)).toEqual(["orçamento"])
  })

  /**
   * A message is data, and stays data inside a result.
   *
   * A sentence written by someone else goes through search, highlight and list
   * without ever being interpreted. With `dangerouslySetInnerHTML`, which is
   * the three-line way to do highlighting, this message would turn bold on the
   * screen of whoever searched, and the next one someone writes would turn into
   * something else.
   */
  it("não interpreta marcação que venha dentro de uma mensagem", () => {
    const veneno = "olha o <b>negrito</b> e o <img src=x onerror=alert(1)>"
    render(painel({ estado: estado({ termo: "negrito", resultados: [achado("id-1", veneno)] }) }))

    const linha = screen.getByRole("button", { name: new RegExp(strings.chat.searchJump) })
    expect(linha.querySelector("b")).toBeNull()
    expect(linha.querySelector("img")).toBeNull()
    expect(linha.textContent).toContain("<b>negrito</b>")
  })

  it("carregar num resultado leva à mensagem", async () => {
    const user = userEvent.setup()
    const onAbrir = vi.fn()
    const alvo = achado("id-1", "o orçamento do lagar")
    render(painel({ estado: estado({ termo: "orçamento", resultados: [alvo] }), onAbrir }))

    await user.click(screen.getByRole("button", { name: new RegExp(strings.chat.searchJump) }))

    expect(onAbrir).toHaveBeenCalledWith(alvo)
  })

  it("um resultado de outra sala diz de onde veio", () => {
    render(
      painel({
        estado: estado({ termo: "obra", resultados: [achado("id-1", "a obra parou", { room: "estaleiro" })] }),
        salaAberta: "",
      }),
    )

    expect(screen.getByText(strings.chat.searchInRoom("Estaleiro"))).toBeTruthy()
  })

  it("um resultado da sala aberta não repete onde está", () => {
    render(
      painel({
        estado: estado({ termo: "obra", resultados: [achado("id-1", "a obra parou", { room: "estaleiro" })] }),
        salaAberta: "estaleiro",
      }),
    )

    expect(screen.queryByText(strings.chat.searchInRoom("Estaleiro"))).toBeNull()
  })

  /**
   * The vault cap stated in words, and stated ALWAYS when one exists.
   *
   * Not just when search fails: finding three out of five was originally five
   * misleads just the same way, with more confidence.
   */
  it("avisa que o mais antigo já saiu deste aparelho, mesmo com resultados", () => {
    render(
      painel({
        estado: estado({ termo: "obra", noTecto: true, procuradas: 400, resultados: [achado("id-1", "a obra")] }),
      }),
    )

    expect(screen.getByText(strings.chat.searchCeiling)).toBeTruthy()
  })

  it("com folga no cofre não inventa o aviso", () => {
    render(painel({ estado: estado({ termo: "obra", noTecto: false, procuradas: 12, resultados: [] }) }))

    expect(screen.queryByText(strings.chat.searchCeiling)).toBeNull()
  })

  it("sem achados diz que não encontrou, e diz onde procurou", () => {
    render(painel({ estado: estado({ termo: "agulha", procuradas: 37, resultados: [] }) }))

    expect(screen.getByText(strings.chat.searchEmpty("agulha"))).toBeTruthy()
    expect(screen.getByText(strings.chat.searchScanned(37))).toBeTruthy()
  })

  it("sem termo escrito não diz que não encontrou nada", () => {
    render(painel({ estado: estado({ termo: "", procuradas: 37 }) }))

    expect(screen.getByText(strings.chat.searchHint)).toBeTruthy()
    expect(screen.queryByText(strings.chat.searchEmpty(""))).toBeNull()
  })

  it("acima do tecto da lista mostra só as mais recentes, e diz quantas são ao todo", () => {
    const muitos = Array.from({ length: 120 }, (_, i) => achado(`id-${i}`, `a obra número ${i}`))
    render(painel({ estado: estado({ termo: "obra", resultados: muitos }) }))

    const linhas = screen.getAllByRole("button", { name: new RegExp(strings.chat.searchJump) })
    expect(linhas).toHaveLength(50)
    expect(screen.getByText(strings.chat.searchMore(50, 120))).toBeTruthy()
  })

  it("Escape fecha a folha", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(painel({ onClose }))

    await user.keyboard("{Escape}")

    expect(onClose).toHaveBeenCalled()
  })

  it("a caixa fica pronta a escrever assim que a folha abre", () => {
    render(painel())

    expect(document.activeElement).toBe(screen.getByPlaceholderText(strings.chat.searchPlaceholder))
  })

  it("escrever na caixa chega ao estado", async () => {
    const user = userEvent.setup()
    const definirTermo = vi.fn()
    render(painel({ estado: estado({ definirTermo }) }))

    await user.type(screen.getByPlaceholderText(strings.chat.searchPlaceholder), "obra")

    expect(definirTermo).toHaveBeenCalledTimes(4)
  })

  it("o botão de limpar só aparece com texto escrito, e esvazia a caixa", async () => {
    const user = userEvent.setup()
    const definirTermo = vi.fn()
    const { rerender } = render(painel({ estado: estado({ termo: "" }) }))
    expect(screen.queryByLabelText(strings.chat.searchClear)).toBeNull()

    rerender(painel({ estado: estado({ termo: "obra", definirTermo }) }))
    await user.click(screen.getByLabelText(strings.chat.searchClear))

    expect(definirTermo).toHaveBeenCalledWith("")
  })

  it("uma mensagem longa mostra-se cortada à volta do que se procurou", () => {
    const longa = `${"a".repeat(300)} agulha ${"b".repeat(300)}`
    render(painel({ estado: estado({ termo: "agulha", resultados: [achado("id-1", longa)] }) }))

    const linha = screen.getByRole("button", { name: new RegExp(strings.chat.searchJump) })
    const texto = within(linha).getByText(/agulha/).parentElement?.textContent ?? ""
    expect(texto).toContain("agulha")
    expect(texto.length).toBeLessThan(longa.length)
    expect(texto).toContain("…")
  })
})

describe("ProcuraPanel — o anel de quem escreveu", () => {
  const comResultado = { estado: estado({ termo: "lagar", resultados: [achado("id-1", "o lagar")] }) }

  it("sem `presenceFor`, sem anel", () => {
    const { container } = render(painel(comResultado))
    expect(container.querySelector(".procura-linha [data-anel]")).toBeNull()
  })

  it("com `presenceFor`, a cor do estado", () => {
    const { container } = render(painel({ ...comResultado, presenceFor: () => "active", emChamada: () => false }))
    const anel = container.querySelector<HTMLElement>(".procura-linha [data-anel]")!
    expect(anel.dataset["anel"]).toBe("online")
    expect(anel.hasAttribute("data-em-chamada")).toBe(false)
  })
})
