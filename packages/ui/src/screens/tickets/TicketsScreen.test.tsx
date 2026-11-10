import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Ticket, TicketLine } from "@enclave/client-core"
import { strings } from "../../strings.js"
import { TicketsScreen } from "./TicketsScreen.js"

afterEach(cleanup)

/**
 * The ticket board, by what the person sees.
 *
 * Both sides of each permission, always: whoever can sees the gesture and uses
 * it; whoever cannot does not see it. Hiding the button is NOT the permission,  * the real refusal lives in the core and has its tests there, but showing a
 * button to someone who will be refused teaches the wrong model, and that is what
 * we prevent here.
 */

const EU = "@ana:orwell.pt"
const OUTRO = "@bento:orwell.pt"

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: "t1",
    subject: "Impressora avariada",
    state: "open",
    opener: OUTRO,
    assignee: "",
    openedAt: 10,
    updatedAt: 10,
    messages: 1,
    ...over,
  }
}

function ecra(over: Partial<React.ComponentProps<typeof TicketsScreen>> = {}): React.JSX.Element {
  return (
    <TicketsScreen
      tickets={[ticket()]}
      linhas={[]}
      me={EU}
      nameFor={(endereco) => (endereco === EU ? "Ana" : endereco === OUTRO ? "Bento" : endereco)}
      mayAttend={false}
      mayDecide={() => false}
      aberto={null}
      onAbrir={() => {}}
      onNovo={async () => {}}
      onResponder={async () => {}}
      onEstado={async () => {}}
      onAtender={async () => {}}
      onLargar={async () => {}}
      {...over}
    />
  )
}

describe("o quadro", () => {
  it("mostra o assunto, quem abriu, quantas mensagens tem e que ninguém o atende", () => {
    render(ecra({ tickets: [ticket({ messages: 3 })] }))
    expect(screen.getByText("Impressora avariada")).toBeTruthy()
    expect(screen.getByText(/Aberto por Bento/)).toBeTruthy()
    expect(screen.getByText(/3 mensagens/)).toBeTruthy()
    expect(screen.getByText(strings.tickets.unattended)).toBeTruthy()
  })

  it("diz quem atende, quando alguém atende", () => {
    render(ecra({ tickets: [ticket({ state: "working", assignee: EU })] }))
    expect(screen.getByText(strings.tickets.attendedBy("Ana"))).toBeTruthy()
    expect(screen.queryByText(strings.tickets.unattended)).toBeNull()
  })

  it("o estado está escrito por palavras, e não só em cor", () => {
    // Color-blind users and screen readers need to know the state.
    render(ecra({ tickets: [ticket({ state: "working" })] }))
    expect(screen.getByText(strings.tickets.stateWorking)).toBeTruthy()
  })

  it("uma sala sem tickets convida a abrir um, em vez de mostrar uma lista vazia", () => {
    render(ecra({ tickets: [] }))
    expect(screen.getByText(strings.tickets.empty)).toBeTruthy()
    expect(screen.getAllByRole("button", { name: strings.tickets.open }).length).toBeGreaterThan(0)
  })

  it("o rodapé diz só que todos os membros lêem os tickets (dono, 28 de Outubro de 2026)", () => {
    // A ticket looks like a private conversation with the agent, and it is not.
    render(ecra())
    expect(screen.getByText(strings.tickets.note)).toBeTruthy()
    expect(screen.queryByText(strings.tickets.partial)).toBeNull()
  })

  it("abrir um ticket pede o assunto e entrega-o", async () => {
    const abertos: string[] = []
    render(ecra({ tickets: [], onNovo: async (assunto) => void abertos.push(assunto) }))

    await userEvent.click(screen.getAllByRole("button", { name: strings.tickets.open })[0] as HTMLElement)
    await userEvent.type(screen.getByPlaceholderText(strings.tickets.subjectPlaceholder), "  Portão não abre  ")
    await userEvent.click(screen.getByRole("button", { name: strings.tickets.create }))

    expect(abertos).toEqual(["Portão não abre"])
  })

  it("o filtro só aparece quando há lista que mereça filtro", () => {
    render(ecra({ tickets: [ticket(), ticket({ id: "t2" })] }))
    expect(screen.queryByRole("button", { name: strings.tickets.filterAll })).toBeNull()
    cleanup()

    render(ecra({ tickets: [ticket(), ticket({ id: "t2" }), ticket({ id: "t3" })] }))
    expect(screen.getByRole("button", { name: strings.tickets.filterAll })).toBeTruthy()
  })

  it("filtrar por fechado esconde os que não estão fechados", async () => {
    render(
      ecra({
        tickets: [
          ticket({ id: "t1", subject: "Por fazer" }),
          ticket({ id: "t2", subject: "A fazer", state: "working" }),
          ticket({ id: "t3", subject: "Feito", state: "closed" }),
        ],
      }),
    )
    await userEvent.click(screen.getByRole("button", { name: strings.tickets.stateClosed }))
    expect(screen.getByText("Feito")).toBeTruthy()
    expect(screen.queryByText("Por fazer")).toBeNull()
    expect(screen.queryByText("A fazer")).toBeNull()
  })
})

describe("um ticket aberto: quem pode e quem não pode", () => {
  const linhas: TicketLine[] = [
    { id: "m1", sender: OUTRO, at: 10, body: "Abriu um ticket: Impressora avariada" },
    { id: "m2", sender: EU, at: 20, body: "vou já ver" },
  ]

  it("mostra a conversa do ticket, com quem disse o quê", () => {
    render(ecra({ aberto: "t1", linhas }))
    expect(screen.getByText("Abriu um ticket: Impressora avariada")).toBeTruthy()
    expect(screen.getByText("vou já ver")).toBeTruthy()
    expect(screen.getByText("Ana")).toBeTruthy()
    expect(screen.getByText("Bento")).toBeTruthy()
  })

  it("quem NÃO atende e não o abriu não vê atender, nem fechar", () => {
    render(ecra({ aberto: "t1", linhas, mayAttend: false, mayDecide: () => false }))
    expect(screen.queryByRole("button", { name: strings.tickets.take })).toBeNull()
    expect(screen.queryByRole("button", { name: strings.tickets.close })).toBeNull()
  })

  it("quem atende vê atender e fechar, e usa-os", async () => {
    const atendidos: string[] = []
    const estados: [string, string][] = []
    render(
      ecra({
        aberto: "t1",
        linhas,
        mayAttend: true,
        mayDecide: () => true,
        onAtender: async (id) => void atendidos.push(id),
        onEstado: async (id, estado) => void estados.push([id, estado]),
      }),
    )
    await userEvent.click(screen.getByRole("button", { name: strings.tickets.take }))
    await userEvent.click(screen.getByRole("button", { name: strings.tickets.close }))
    expect(atendidos).toEqual(["t1"])
    expect(estados).toEqual([["t1", "closed"]])
  })

  it("quem abriu o ticket fecha-o sem atender ninguém", () => {
    // The asymmetry the core already guarantees, shown on screen: closing what is
    // mine does not require the responsibility of taking it, but taking the ticket does.
    render(ecra({ aberto: "t1", linhas, mayAttend: false, mayDecide: () => true }))
    expect(screen.getByRole("button", { name: strings.tickets.close })).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.tickets.take })).toBeNull()
  })

  it("quem já atende vê largar em vez de atender", () => {
    render(ecra({ aberto: "t1", tickets: [ticket({ state: "working", assignee: EU })], linhas, mayAttend: true }))
    expect(screen.getByRole("button", { name: strings.tickets.release })).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.tickets.take })).toBeNull()
  })

  it("um ticket fechado oferece reabrir, e não fechar outra vez", () => {
    render(ecra({ aberto: "t1", tickets: [ticket({ state: "closed" })], linhas, mayDecide: () => true }))
    expect(screen.getByRole("button", { name: strings.tickets.reopen })).toBeTruthy()
    expect(screen.queryByRole("button", { name: strings.tickets.close })).toBeNull()
  })

  it("um ticket fechado não se toma: não há trabalho para pegar", () => {
    render(ecra({ aberto: "t1", tickets: [ticket({ state: "closed" })], linhas, mayAttend: true }))
    expect(screen.queryByRole("button", { name: strings.tickets.take })).toBeNull()
  })

  it("quem não decide não vê reabrir um ticket fechado", () => {
    // The pair of the test above: with the ticket closed, the offered gesture
    // changes, and the permission must still apply to the new gesture. Without this,
    // closing would get stuck and reopening would be open to everyone.
    render(ecra({ aberto: "t1", tickets: [ticket({ state: "closed" })], linhas, mayDecide: () => false }))
    expect(screen.queryByRole("button", { name: strings.tickets.reopen })).toBeNull()
  })

  it("um ticket que outra pessoa atende oferece tomá-lo, e não largá-lo", () => {
    // Dropping is giving up what you took, and so it only shows to whoever took it.
    // Removing it from someone else happens by taking it, which is a gesture with
    // its own name and which leaves a trace in the conversation.
    render(ecra({ aberto: "t1", tickets: [ticket({ state: "working", assignee: OUTRO })], linhas, mayAttend: true }))
    expect(screen.queryByRole("button", { name: strings.tickets.release })).toBeNull()
    expect(screen.getByRole("button", { name: strings.tickets.take })).toBeTruthy()
  })

  it("responder entrega o texto limpo, e esvazia a caixa", async () => {
    const ditas: [string, string][] = []
    render(ecra({ aberto: "t1", linhas, onResponder: async (id, corpo) => void ditas.push([id, corpo]) }))

    const caixa = screen.getByPlaceholderText(strings.tickets.replyPlaceholder)
    await userEvent.type(caixa, "  já está resolvido  ")
    await userEvent.click(screen.getByRole("button", { name: strings.tickets.send }))

    expect(ditas).toEqual([["t1", "já está resolvido"]])
    expect((caixa as HTMLInputElement).value).toBe("")
  })

  it("uma recusa do núcleo é dita no ecrã, e não engolida", async () => {
    // The real guard lives in the core, and the interface may be out of date about
    // who is in control. When it offers a gesture that gets refused, whoever clicked
    // needs to know why.
    render(
      ecra({
        aberto: "t1",
        linhas,
        mayDecide: () => true,
        onEstado: async () => {
          throw new Error("Só quem atende os tickets deste canal, ou quem abriu este, lhe pode mudar o estado.")
        },
      }),
    )
    await userEvent.click(screen.getByRole("button", { name: strings.tickets.close }))
    expect(await screen.findByText(/Só quem atende os tickets/)).toBeTruthy()
  })

  it("um ticket cuja abertura não chegou diz porquê, em vez de parecer avariado", () => {
    // What end-to-end encryption does to someone who joins mid-way: replies arrive,
    // the opening does not, and without this phrase the screen reads like a bug.
    render(ecra({ aberto: "t1", tickets: [ticket({ subject: "", opener: "" })], linhas }))
    expect(screen.getByText(strings.tickets.noSubjectHint)).toBeTruthy()
  })
})

describe("eliminar um ticket fechado (fase 3)", () => {
  it("quem modera vê o botão num ticket fechado, confirma, e o quadro volta", async () => {
    const { ConfirmarProvider } = await import("../../hooks/useConfirmar.js")
    const user = userEvent.setup()
    const eliminados: string[] = []
    const voltas: (string | null)[] = []
    render(
      <ConfirmarProvider>
        {ecra({
          tickets: [ticket({ state: "closed" })],
          aberto: "t1",
          mayModerate: true,
          onEliminar: async (id) => {
            eliminados.push(id)
          },
          onAbrir: (id) => voltas.push(id),
        })}
      </ConfirmarProvider>,
    )
    await user.click(screen.getByRole("button", { name: strings.tickets.delete }))
    const aviso = await screen.findByRole("alertdialog", { name: strings.tickets.deleteTitle("Impressora avariada") })
    await user.click(within(aviso).getByRole("button", { name: strings.tickets.delete }))
    expect(eliminados).toEqual(["t1"])
    expect(voltas).toEqual([null])
  })

  it("num ticket aberto, ou sem o poder, o botão não aparece", () => {
    const { unmount } = render(ecra({ tickets: [ticket({ state: "open" })], aberto: "t1", mayModerate: true, onEliminar: async () => {} }))
    expect(screen.queryByRole("button", { name: strings.tickets.delete })).toBeNull()
    unmount()
    render(ecra({ tickets: [ticket({ state: "closed" })], aberto: "t1", mayModerate: false, onEliminar: async () => {} }))
    expect(screen.queryByRole("button", { name: strings.tickets.delete })).toBeNull()
  })
})
