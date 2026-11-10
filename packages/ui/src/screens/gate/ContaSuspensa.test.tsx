import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { AvisoDeSuspensao } from "@enclave/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ContaSuspensa } from "./ContaSuspensa.js"

afterEach(cleanup)

/**
 * The suspension notice (art. 17.3 of DSA; design §8 and §9b). The order is
 * the law's: measure, duration, scope, facts, origin, no automated means,
 * rule, and remedies.
 */

function aviso(revisao: Partial<AvisoDeSuspensao["revisao"]> = {}, extra: Partial<AvisoDeSuspensao> = {}): AvisoDeSuspensao {
  return {
    v: 1,
    endereco: "@bruno:orwell.pt",
    motivo: 3,
    medida: "suspensao-da-conta",
    desde: "2026-11-03",
    ate: null,
    ambito: "A conta não entra neste servidor.",
    factos: "Insultos repetidos no canal.",
    origem: "denuncia",
    semMeiosAutomaticos: true,
    norma: "Termos de utilização, ponto 4.",
    revisao: { pedida: null, decisao: "pendente", nota: "", ...revisao },
    ...extra,
  }
}

const texto = (): string => document.body.textContent ?? ""

describe("ContaSuspensa", () => {
  it("mostra Erro 218, medida, duração, âmbito, factos, origem, 'sem meios automáticos', norma, tribunais e ANACOM", () => {
    render(<ContaSuspensa aviso={aviso()} onPedirRevisao={async () => {}} onTentarOutraVez={() => {}} />)
    const pela = [
      "Erro 218",
      "A tua conta está suspensa neste servidor. Lê o motivo e pede revisão.",
      "Medida: suspensão da conta.",
      "Desde 2026-11-03, até à revisão.",
      "Âmbito: A conta não entra neste servidor.",
      "Factos: Insultos repetidos no canal.",
      "Veio de uma denúncia.",
      "Não houve meios automáticos: uma pessoa leu e decidiu.",
      "Norma ou cláusula: Termos de utilização, ponto 4.",
      "Pedir revisão",
      "Podes recorrer aos tribunais.",
      "Podes reclamar à ANACOM, o Coordenador dos Serviços Digitais em Portugal.",
    ]
    let desde = -1
    for (const frase of pela) {
      const onde = texto().indexOf(frase)
      expect(onde, `"${frase}" depois da anterior`).toBeGreaterThan(desde)
      desde = onde
    }
    expect(screen.getByRole("button", { name: "Pedir revisão" })).toBeTruthy()
  })

  it("com data de fim diz as duas datas, e diz a origem de uma autoridade ou do operador", () => {
    const { rerender } = render(
      <ContaSuspensa aviso={aviso({}, { ate: "2026-12-03", origem: "autoridade" })} onPedirRevisao={async () => {}} onTentarOutraVez={() => {}} />,
    )
    expect(texto()).toContain("Desde 2026-11-03 até 2026-12-03.")
    expect(texto()).toContain("Veio de uma autoridade.")
    rerender(<ContaSuspensa aviso={aviso({}, { origem: "operador" })} onPedirRevisao={async () => {}} onTentarOutraVez={() => {}} />)
    expect(texto()).toContain("Decisão do operador.")
  })

  it("'Pedir revisão' envia a nota e mostra 'Pedido de revisão enviado.'", async () => {
    const onPedirRevisao = vi.fn(async () => {})
    render(<ContaSuspensa aviso={aviso()} onPedirRevisao={onPedirRevisao} onTentarOutraVez={() => {}} />)
    const botao = screen.getByRole("button", { name: "Pedir revisão" }) as HTMLButtonElement
    // Without notice, there's no request.
    expect(botao.disabled).toBe(true)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Foi um mal-entendido." } })
    fireEvent.click(botao)
    expect(await screen.findByText("Pedido de revisão enviado.")).toBeTruthy()
    expect(onPedirRevisao).toHaveBeenCalledWith("Foi um mal-entendido.")
  })

  it("um pedido recusado mostra o erro com código", async () => {
    const onPedirRevisao = vi.fn(async () => {
      throw new Error("the server did not take the review request")
    })
    render(<ContaSuspensa aviso={aviso()} onPedirRevisao={onPedirRevisao} onTentarOutraVez={() => {}} />)
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Peço revisão." } })
    fireEvent.click(screen.getByRole("button", { name: "Pedir revisão" }))
    expect((await screen.findByRole("alert")).textContent).toContain("Erro 219")
  })

  it("com decisão 'mantida' mostra a decisão", () => {
    render(
      <ContaSuspensa
        aviso={aviso({ pedida: "2026-11-04T10:00:00.000Z", decisao: "mantida", nota: "Os insultos estão nas mensagens." })}
        onPedirRevisao={async () => {}}
        onTentarOutraVez={() => {}}
      />,
    )
    expect(texto()).toContain("Revisão: a suspensão foi mantida.")
    expect(texto()).toContain("Nota da revisão: Os insultos estão nas mensagens.")
    // Once decided, it doesn't ask again; the other paths continue.
    expect(screen.queryByRole("button", { name: "Pedir revisão" })).toBeNull()
    expect(texto()).toContain("Podes recorrer aos tribunais.")
  })

  it("'Tentar outra vez' chama onTentarOutraVez", () => {
    const onTentarOutraVez = vi.fn()
    render(<ContaSuspensa aviso={aviso()} onPedirRevisao={async () => {}} onTentarOutraVez={onTentarOutraVez} />)
    fireEvent.click(screen.getByRole("button", { name: "Tentar outra vez" }))
    expect(onTentarOutraVez).toHaveBeenCalledOnce()
  })
})
