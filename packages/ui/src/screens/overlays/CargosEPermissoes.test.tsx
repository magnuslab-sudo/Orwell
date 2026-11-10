import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PODERES_CUMPRIDOS, type Power } from "@enclave/protocol"
import type { SobreposicaoDaSala } from "../../bridge.js"
import { strings } from "../../strings.js"
import { CargosEPermissoes, comEstado, estadoNaSobreposicao, type PropsDeCargosEPermissoes, reordenar } from "./CargosEPermissoes.js"

afterEach(cleanup)

/**
 * The `CargosEPermissoes` component alone (the story in isolation): the
 * draggable order, create, rename, color, switches showing what encryption
 * guarantees and what is app rule, and permissions by room and category.
 */

function montar(extra: Partial<PropsDeCargosEPermissoes> = {}): { props: PropsDeCargosEPermissoes } {
  const props: PropsDeCargosEPermissoes = {
    cargos: [
      { role: "chefe", name: "Chefe", powers: ["gerircargos", "mover"], rank: 3 },
      { role: "guia", name: "Guia", powers: ["mover"], rank: 2, colour: "ambar" },
      { role: "porteiro", name: "Porteiro", powers: ["convidar"], rank: 1 },
    ],
    todos: ["escrever", "ligar"],
    lugares: [
      { lugar: { categoria: "Jogos" }, nome: "Jogos" },
      { lugar: { sala: "estudio" }, nome: "Estúdio" },
    ],
    sobreposicoes: (lugar) => ("sala" in lugar && lugar.sala === "estudio" ? [{ role: "guia", allow: [], deny: ["mover"] }] : []),
    poderesProprios: [...PODERES_CUMPRIDOS],
    podeGerir: () => true,
    podeCriar: true,
    podeOrdenar: true,
    podeSobrepor: () => true,
    onCriar: vi.fn(),
    onMudar: vi.fn(),
    onApagar: vi.fn(),
    onOrdenar: vi.fn(),
    onTodos: vi.fn(),
    onSobrepor: vi.fn(),
    ...extra,
  }
  render(<CargosEPermissoes {...props} />)
  return { props }
}

/** A function, not a constant: the language is read at each test, never at module load. */
const t = (): typeof strings.cargosEPermissoes => strings.cargosEPermissoes

describe("as funções puras", () => {
  it("reordenar move um elemento sem mexer no original", () => {
    const lista = ["a", "b", "c"]
    expect(reordenar(lista, 0, 2)).toEqual(["b", "c", "a"])
    expect(reordenar(lista, 2, 0)).toEqual(["c", "a", "b"])
    expect(lista).toEqual(["a", "b", "c"])
  })

  it("uma sobreposição: herda, dá, tira; uma entrada vazia sai", () => {
    let perms: SobreposicaoDaSala[] = []
    expect(estadoNaSobreposicao(perms, "guia", "mover")).toBe("herda")
    perms = comEstado(perms, "guia", "mover", "tira")
    expect(perms).toEqual([{ role: "guia", allow: [], deny: ["mover"] }])
    perms = comEstado(perms, "guia", "mover", "da")
    expect(estadoNaSobreposicao(perms, "guia", "mover")).toBe("da")
    expect(comEstado(perms, "guia", "mover", "herda")).toEqual([])
  })
})

describe("a ordem dos cargos", () => {
  it("lista os cargos de cima para baixo e muda a ordem pelas setas", async () => {
    const { props } = montar()
    const itens = document.querySelectorAll(".cep-ordem > li")
    expect([...itens].map((li) => li.querySelector(".cep-cargo-nome")?.textContent)).toEqual(["Chefe", "Guia", "Porteiro"])
    await userEvent.click(screen.getByRole("button", { name: t().descer("Chefe") }))
    expect(props.onOrdenar).toHaveBeenCalledWith(["guia", "chefe", "porteiro"])
    await userEvent.click(screen.getByRole("button", { name: t().subir("Porteiro") }))
    expect(props.onOrdenar).toHaveBeenLastCalledWith(["chefe", "porteiro", "guia"])
    expect((screen.getByRole("button", { name: t().subir("Chefe") }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("muda a ordem por arrasto", () => {
    const { props } = montar()
    const linhas = document.querySelectorAll(".cep-ordem > li")
    fireEvent.dragStart(linhas[2]!, { dataTransfer: { setData: () => {}, effectAllowed: "" } })
    fireEvent.dragOver(linhas[0]!)
    fireEvent.drop(linhas[0]!)
    expect(props.onOrdenar).toHaveBeenCalledWith(["porteiro", "chefe", "guia"])
  })

  it("sem poder ordenar, não há setas nem arrasto", () => {
    montar({ podeOrdenar: false })
    expect(screen.queryByRole("button", { name: t().subir("Guia") })).toBeNull()
    expect(document.querySelector(".cep-ordem > li")?.getAttribute("draggable")).toBe("false")
  })

  it("cria um cargo com o Enter, sem submeter o que estiver à volta", async () => {
    const submeter = vi.fn((e: Event) => e.preventDefault())
    const props = montar().props
    document.body.addEventListener("submit", submeter)
    await userEvent.type(screen.getByLabelText(t().novoNome), "Moderação{Enter}")
    expect(props.onCriar).toHaveBeenCalledWith("Moderação")
    expect(submeter).not.toHaveBeenCalled()
    document.body.removeEventListener("submit", submeter)
  })
})

describe("um cargo aberto", () => {
  it("renomeia ao sair do campo e muda a cor", async () => {
    const { props } = montar()
    await userEvent.click(screen.getByRole("button", { name: "Guia" }))
    const nome = screen.getByLabelText(t().nome("Guia"))
    await userEvent.clear(nome)
    await userEvent.type(nome, "Guias{Enter}")
    expect(props.onMudar).toHaveBeenCalledWith("guia", { name: "Guias" })
    await userEvent.selectOptions(screen.getByLabelText(t().cor("Guia")), "lima")
    expect(props.onMudar).toHaveBeenLastCalledWith("guia", { colour: "lima" })
  })

  it("liga uma permissão por interruptor; cada uma diz o que a cifra garante ou que é regra da app", async () => {
    const { props } = montar()
    await userEvent.click(screen.getByRole("button", { name: "Porteiro" }))
    const lista = screen.getByRole("list", { name: t().permissoesDe("Porteiro") })
    // Only those this version supports.
    expect(within(lista).getAllByRole("switch")).toHaveLength(PODERES_CUMPRIDOS.length)
    expect(lista.textContent).toContain(t().natureza.cifra)
    expect(lista.textContent).toContain(t().natureza.semVolta)
    expect(lista.textContent).toContain(t().natureza.combinado)
    await userEvent.click(within(lista).getByRole("switch", { name: strings.roles.powers["mover"] ?? "" }))
    expect(props.onMudar).toHaveBeenCalledWith("porteiro", { powers: ["convidar", "mover"] })
  })

  it("a migração à vista: quem tem mover tem desligar, ligado e trancado, com a razão", async () => {
    montar()
    await userEvent.click(screen.getByRole("button", { name: "Guia" }))
    const lista = screen.getByRole("list", { name: t().permissoesDe("Guia") })
    const desligar = within(lista).getByRole("switch", { name: strings.roles.powers["desligar"] ?? "" })
    expect(desligar.getAttribute("aria-checked")).toBe("true")
    expect((desligar as HTMLButtonElement).disabled).toBe(true)
    expect(lista.textContent).toContain(t().implicada(strings.roles.powers["mover"]!))
  })

  it("escalada: o que quem usa não tem não se pode dar", async () => {
    montar({ poderesProprios: ["mover", "gerircargos"] as Power[] })
    await userEvent.click(screen.getByRole("button", { name: "Porteiro" }))
    const lista = screen.getByRole("list", { name: t().permissoesDe("Porteiro") })
    expect((within(lista).getByRole("switch", { name: strings.roles.powers["expulsar"] ?? "" }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(lista).getByRole("switch", { name: strings.roles.powers["mover"] ?? "" }) as HTMLButtonElement).disabled).toBe(false)
    expect(lista.textContent).toContain(t().semPoder)
  })

  it("um cargo acima de quem usa abre só para ler", async () => {
    montar({ podeGerir: (role) => role !== "chefe" })
    await userEvent.click(screen.getByRole("button", { name: "Chefe" }))
    expect(screen.getByText(t().bloqueado)).toBeTruthy()
    expect((screen.getByLabelText(t().nome("Chefe")) as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole("button", { name: t().apagar("Chefe") })).toBeNull()
  })
})

describe("toda a gente", () => {
  it("muda as permissões de base e mantém as que esta versão ainda não oferece", async () => {
    const { props } = montar()
    // Closed on open: no switch in sight until someone opens it.
    expect(screen.queryByRole("list", { name: t().todosTitulo })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: t().todosTitulo }))
    const lista = screen.getByRole("list", { name: t().todosTitulo })
    await userEvent.click(within(lista).getByRole("switch", { name: strings.roles.powers["mover"] ?? "" }))
    expect(props.onTodos).toHaveBeenCalledWith(["mover", "escrever", "ligar"])
  })
})

describe("permissões por sala e categoria", () => {
  it("mostra a sobreposição guardada e muda-a para um cargo", async () => {
    const { props } = montar()
    await userEvent.selectOptions(screen.getByLabelText(t().lugar), "s:estudio")
    const lugar = t().sala("Estúdio")
    const mover = strings.roles.powers["mover"]!
    const celula = screen.getByLabelText(t().estadoDe(mover, "Guia", lugar)) as HTMLSelectElement
    expect(celula.value).toBe("tira")
    await userEvent.selectOptions(screen.getByLabelText(t().estadoDe(mover, t().todos, lugar)), "tira")
    expect(props.onSobrepor).toHaveBeenCalledWith({ sala: "estudio" }, [
      { role: "guia", allow: [], deny: ["mover"] },
      { role: "@todos", allow: [], deny: ["mover"] },
    ])
  })

  it("diz que é regra da app, e sem poder no lugar fica só para ler", async () => {
    montar({ podeSobrepor: () => false })
    expect(screen.getByText(t().sobreposicoesNota)).toBeTruthy()
    expect(screen.getByText(t().semPermissaoNoLugar)).toBeTruthy()
    const celula = screen.getByLabelText(t().estadoDe(strings.roles.powers["mover"]!, "Guia", t().categoria("Jogos"))) as HTMLSelectElement
    expect(celula.disabled).toBe(true)
  })

  it("sem salas, di-lo", () => {
    montar({ lugares: [] })
    expect(screen.getByText(t().semLugares)).toBeTruthy()
  })
})
