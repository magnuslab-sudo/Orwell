import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CartaoDaConta } from "./CartaoDaConta.js"
import { CallDock } from "../call/CallDock.js"
import { ToastContext } from "../../components/Toast.js"
import { strings } from "../../strings.js"

afterEach(cleanup)

/**
 * What the account banner SHOWS, and what it does when asked.
 *
 * The banner is alternative B ("Discord-style banner") that the owner chose on
 * October 27, 2026: one line only, with avatar, name, status and latency, and
 * four identical buttons. The address does not show: it is not selected, not
 * memorized, and anyone looking at their own banner already knows who they are.
 * Copying it lives in Account.
 *
 * What these tests CANNOT measure is in the script
 * `scripts/medir-faixa-da-conta.mjs`: jsdom does not apply stylesheets, so it
 * does not know if the banner is one line, or if a target is 24 pixels.
 */

const ENDERECO = "@garbicis-xapsensis-giprete-birmyris:orwell.pt"

const base = {
  profile: { displayName: "Ana", donations: [] },
  address: ENDERECO,
  onToggleMic: (): void => {},
  onToggleSound: (): void => {},
  onMicMenu: (): void => {},
  onSoundMenu: (): void => {},
  onNotifications: (): void => {},
  onEditProfile: (): void => {},
  onSaveStatus: (): void => {},
}

function montar(extra: Partial<React.ComponentProps<typeof CartaoDaConta>> = {}): void {
  render(
    <ToastContext.Provider value={() => {}}>
      <CartaoDaConta {...base} {...extra} />
    </ToastContext.Provider>,
  )
}

describe("CartaoDaConta — o que se lê", () => {
  it("mostra o nome de exibição", () => {
    montar()
    expect(screen.getByText("Ana")).toBeTruthy()
  })

  it("e não escreve o endereço no bloco da identidade", () => {
    montar()
    const identidade = screen.getByRole("button", { name: new RegExp(strings.activity.title, "i") })
    expect(identidade.textContent ?? "").not.toContain("garbicis")
    expect(identidade.textContent ?? "").not.toContain("orwell.pt")
  })

  it("diz por palavras como apareces, e não só pela cor do ponto", () => {
    montar({ activity: "invisivel" })
    expect(screen.getByText(strings.activity.invisible)).toBeTruthy()

    cleanup()
    montar({ activity: "ocupado" })
    expect(screen.getByText(strings.activity.busy)).toBeTruthy()

    cleanup()
    montar({ activity: "ausente" })
    expect(screen.getByText(strings.activity.away)).toBeTruthy()

    cleanup()
    montar({ activity: "online" })
    expect(screen.getByText(strings.activity.online)).toBeTruthy()
  })

  it("sem nome escolhido, diz o que falta fazer em vez de ficar em branco", () => {
    montar({ profile: { displayName: "", donations: [] } })
    expect(screen.getByText(strings.sidebar.pickName)).toBeTruthy()
  })
})

describe("CartaoDaConta — o endereço não se copia daqui", () => {
  it("não há botão de copiar nem de partilhar: isso é em Conta", () => {
    montar()
    for (const botao of screen.getAllByRole("button")) {
      expect(botao.getAttribute("aria-haspopup")).toBeNull()
      expect(botao.getAttribute("aria-label") ?? "").not.toMatch(/endereço|copiar/i)
    }
  })

  it("quem ouve o ecrã chega ao endereço sem ter de o copiar", () => {
    montar()
    // Hidden from sight, spoken to screen reader users: it is the only way to
    // know which account you are in without clicking anything.
    expect(screen.getByText(ENDERECO)).toBeTruthy()
  })
})

/**
 * The line below the name, and the dot color.
 *
 * The status bar left the column, and the dot now also shows the connection:
 * green connected, amber reconnecting, pink offline. Color alone is not enough:
 * the line says the same thing in words, for people who cannot distinguish colors.
 */
describe("CartaoDaConta — o estado, a latência e a ligação", () => {
  it('diz o estado e a latência numa linha: "Ocupado · 42 ms"', () => {
    montar({ activity: "ocupado", latencia: { ms: 42, ate: "servidor" } })
    expect(document.querySelector(".me-state")?.textContent).toBe("Ocupado · 42 ms")
  })

  /*
    At 236 px column width the line does not fit, and the latency goes off:
    CSS pushes it to a second line you cannot see. That's why it must be a
    separate piece with the separator, and the full number must be in the dot
    balloon. Whether it fits is measured by `scripts/medir-faixa-da-conta.mjs`.
  */
  it("a latência é um pedaço à parte, e o número inteiro está no balão do ponto", () => {
    montar({ activity: "ocupado", latencia: { ms: 42, ate: "servidor" } })
    expect(document.querySelector(".me-state-palavra")?.textContent).toBe(strings.activity.busy)
    expect(document.querySelector(".me-state-latencia")?.textContent).toBe(strings.activity.latencyTail(42))
    const ponto = document.querySelector(".me-avatar > .dot")
    expect(ponto?.getAttribute("data-tip")).toContain(strings.activity.latencyServer(42))
    expect(ponto?.hasAttribute("title")).toBe(false)
  })

  it("sem medida, diz só o estado, e não inventa um número", () => {
    montar({ activity: "online", latencia: null })
    expect(document.querySelector(".me-state")?.textContent).toBe(strings.activity.online)
  })

  it.each([
    ["online", "online", "dot online"],
    ["online", "ocupado", "dot busy"],
    ["online", "ausente", "dot away"],
    ["online", "invisivel", "dot invisible"],
    ["reconnecting", "online", "dot reconnecting"],
    ["connecting", "ocupado", "dot reconnecting"],
    ["offline", "online", "dot offline"],
  ] as const)('ligação %s, estado %s: o ponto é "%s"', (ligacao, activity, classe) => {
    montar({ ligacao, activity })
    expect(document.querySelector(".me-avatar > .dot")?.className).toBe(classe)
  })

  it("sem ligação, a linha di-lo por palavras, e a latência não aparece", () => {
    montar({ ligacao: "offline", activity: "ocupado", latencia: { ms: 42, ate: "servidor" } })
    expect(document.querySelector(".me-state")?.textContent).toBe(
      strings.activity.stateLine(strings.activity.busy, strings.common.connectionOffline),
    )
  })

  it("a passar o rato pela identidade, a medição liga e desliga", () => {
    const onLatenciaHover = vi.fn()
    montar({ onLatenciaHover })
    const identidade = screen.getByRole("button", { name: new RegExp(strings.activity.title, "i") })
    fireEvent.mouseEnter(identidade)
    fireEvent.mouseLeave(identidade)
    expect(onLatenciaHover.mock.calls).toEqual([[true], [false]])
  })
})

/**
 * The gear and the audio menus without arrows.
 *
 * The arrows are gone: the microphone menu and the speaker menu open on right-click
 * and long press in the button itself, like the channel and conversation rows.
 */
describe("CartaoDaConta — a roda dentada e os menus por clique direito", () => {
  it("a roda dentada abre as definições", async () => {
    const onAbrirDefinicoes = vi.fn()
    const user = userEvent.setup()
    montar({ onAbrirDefinicoes })
    await user.click(screen.getByRole("button", { name: strings.sidebar.abrirDefinicoes }))
    expect(onAbrirDefinicoes).toHaveBeenCalledTimes(1)
  })

  it("sem quem abra as definições, a roda dentada não se desenha", () => {
    montar()
    expect(screen.queryByRole("button", { name: strings.sidebar.abrirDefinicoes })).toBeNull()
  })

  it("já não há setas: cada botão de áudio é um botão só", () => {
    montar()
    expect(screen.queryByLabelText(strings.call.micOptions)).toBeNull()
    expect(screen.queryByLabelText(strings.call.soundOptions)).toBeNull()
    expect(document.querySelector(".me-audio-seta")).toBeNull()
  })

  it("o clique direito no microfone abre o menu dele, e não silencia", async () => {
    const onMicMenu = vi.fn()
    const onSoundMenu = vi.fn()
    const onToggleMic = vi.fn()
    const user = userEvent.setup()
    montar({ onMicMenu, onSoundMenu, onToggleMic })
    await user.pointer({ keys: "[MouseRight]", target: screen.getByLabelText(strings.call.micAria(false)) })
    expect(onMicMenu).toHaveBeenCalledTimes(1)
    expect(onMicMenu.mock.calls[0]?.[0]).toMatchObject({ x: expect.any(Number), y: expect.any(Number) })
    expect(onSoundMenu).not.toHaveBeenCalled()
    expect(onToggleMic).not.toHaveBeenCalled()
  })

  it("e o do som abre o do som", async () => {
    const onSoundMenu = vi.fn()
    const user = userEvent.setup()
    montar({ onSoundMenu })
    await user.pointer({ keys: "[MouseRight]", target: screen.getByLabelText(strings.call.soundAria(false)) })
    expect(onSoundMenu).toHaveBeenCalledTimes(1)
  })

  it("com o dedo pousado meio segundo, abre o mesmo menu, e o clique que vem a seguir não silencia", () => {
    vi.useFakeTimers()
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes("pointer: coarse"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    })
    try {
      const onMicMenu = vi.fn()
      const onToggleMic = vi.fn()
      montar({ onMicMenu, onToggleMic })
      const mic = screen.getByLabelText(strings.call.micAria(false))
      // jsdom has no `PointerEvent`: a `MouseEvent` with the name and its kind.
      const pousar = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 30, clientY: 40 })
      Object.defineProperty(pousar, "pointerType", { value: "touch" })
      fireEvent(mic, pousar)
      act(() => {
        vi.advanceTimersByTime(600)
      })
      expect(onMicMenu).toHaveBeenCalledWith({ x: 30, y: 40 })
      fireEvent.click(mic)
      expect(onToggleMic).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("sem quem trate do menu, o clique direito fica o do browser", () => {
    montar({ onMicMenu: undefined })
    const evento = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
    fireEvent(screen.getByLabelText(strings.call.micAria(false)), evento)
    expect(evento.defaultPrevented).toBe(false)
  })
})

/**
 * The status text: the personal message.
 *
 * Since P1 (October 28, 2026) it reads below the name, and scrolls when it does
 * not fit, like "Channel · Room". The field still opens only through the
 * "Custom..." of the status menu, which sends `pedidoDeEstado`.
 */
describe("CartaoDaConta — o estado escrito", () => {
  it("em repouso lê-se por baixo do nome, num letreiro, e não há campo", () => {
    montar({ profile: { displayName: "Ana", donations: [], statusText: "no metro" } })
    expect(document.querySelector(".status-line, .status-input")).toBeNull()
    const mensagem = document.querySelector(".me-labels .me-mensagem")
    expect(mensagem?.textContent).toBe("no metro")
    expect(mensagem?.classList.contains("andante-caixa")).toBe(true)
    // The message takes the place of status; status stays in the ring and the dot.
    expect(document.querySelector(".me-state")).toBeNull()
    expect(document.querySelector(".me-avatar > .dot")?.getAttribute("data-tip")).toContain(
      strings.activity.current("online"),
    )
  })

  it('sem ligação, a linha do estado ganha à mensagem: diz "sem ligação" por palavras', () => {
    montar({ ligacao: "offline", profile: { displayName: "Ana", donations: [], statusText: "no metro" } })
    expect(document.querySelector(".me-mensagem")).toBeNull()
    expect(document.querySelector(".me-state")?.textContent).toContain(strings.common.connectionOffline)
  })

  it("uma mensagem só de espaços não conta: fica o estado", () => {
    montar({ profile: { displayName: "Ana", donations: [], statusText: "   " } })
    expect(document.querySelector(".me-mensagem")).toBeNull()
    expect(document.querySelector(".me-state")).toBeTruthy()
  })

  it('o "Personalizado…" abre o campo, o Enter guarda uma vez e fecha-o', () => {
    const onSaveStatus = vi.fn()
    const { rerender } = render(
      <ToastContext.Provider value={() => {}}>
        <CartaoDaConta {...base} onSaveStatus={onSaveStatus} pedidoDeEstado={0} />
      </ToastContext.Provider>,
    )
    expect(screen.queryByRole("textbox")).toBeNull()
    rerender(
      <ToastContext.Provider value={() => {}}>
        <CartaoDaConta {...base} onSaveStatus={onSaveStatus} pedidoDeEstado={1} />
      </ToastContext.Provider>,
    )
    const campo = screen.getByRole("textbox", { name: strings.sidebar.statusPrompt })
    fireEvent.change(campo, { target: { value: "a pensar" } })
    fireEvent.keyDown(campo, { key: "Enter" })
    expect(onSaveStatus).toHaveBeenCalledExactlyOnceWith("a pensar")
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("o Esc desfaz sem guardar", () => {
    const onSaveStatus = vi.fn()
    const { rerender } = render(
      <ToastContext.Provider value={() => {}}>
        <CartaoDaConta {...base} onSaveStatus={onSaveStatus} />
      </ToastContext.Provider>,
    )
    rerender(
      <ToastContext.Provider value={() => {}}>
        <CartaoDaConta {...base} onSaveStatus={onSaveStatus} pedidoDeEstado={1} />
      </ToastContext.Provider>,
    )
    const campo = screen.getByRole("textbox")
    fireEvent.change(campo, { target: { value: "nada" } })
    fireEvent.keyDown(campo, { key: "Escape" })
    expect(onSaveStatus).not.toHaveBeenCalled()
    expect(screen.queryByRole("textbox")).toBeNull()
  })
})

/**
 * Named sections.
 *
 * A `role="group"` with a name is not code decoration: it is what makes a screen
 * reader announce "Sound and microphone, group" before the two toggles, instead of
 * dumping four buttons in a row without saying what they are.
 */
describe("CartaoDaConta — os botões vivem em secções com nome", () => {
  it("o microfone e o som estão na secção do áudio, e são só dois botões", () => {
    montar()
    const seccao = screen.getByRole("group", { name: strings.sidebar.audioGroup })
    expect(within(seccao).getByLabelText(strings.call.micAria(false))).toBeTruthy()
    expect(within(seccao).getByLabelText(strings.call.soundAria(false))).toBeTruthy()
    expect(within(seccao).getAllByRole("button")).toHaveLength(2)
  })

  it("o sino e a roda dentada estão na secção da conta", () => {
    montar({ unreadNotifications: 3, onAbrirDefinicoes: () => {} })
    const seccao = screen.getByRole("group", { name: strings.sidebar.accountGroup })
    expect(within(seccao).getByLabelText(strings.notifCenter.bellWithCount(3))).toBeTruthy()
    expect(within(seccao).getByLabelText(strings.sidebar.abrirDefinicoes)).toBeTruthy()
  })

  it("a identidade fica FORA das secções de botões: é a faixa, não um botão da fila", () => {
    montar()
    const conta = screen.getByRole("group", { name: strings.sidebar.accountGroup })
    const identidade = screen.getByRole("button", { name: new RegExp(strings.activity.title, "i") })
    expect(conta.contains(identidade)).toBe(false)
  })

  it("sem quem responda ao microfone, a secção do áudio não se desenha", () => {
    // House rule: what you cannot do does not appear gray, it does not appear.
    render(
      <ToastContext.Provider value={() => {}}>
        <CartaoDaConta
          {...base}
          onToggleMic={undefined as unknown as () => void}
          onToggleSound={undefined as unknown as () => void}
        />
      </ToastContext.Provider>,
    )
    expect(screen.queryByRole("group", { name: strings.sidebar.audioGroup })).toBeNull()
  })
})

/**
 * The math that opens the menus, and that got it wrong in all four buttons at
 * once. It lives in `CartaoDaConta.coordenadas.test.tsx`; here we lock down
 * only that the banner did not change the identity button logic, which is the
 * one that opens the "how you appear" menu and the only one that also serves
 * as the gateway to your profile.
 */
describe("CartaoDaConta — a identidade continua a abrir o que abria", () => {
  it("com menu de estado, abre o menu", async () => {
    const onActivityMenu = vi.fn()
    const onEditProfile = vi.fn()
    const user = userEvent.setup()
    montar({ onActivityMenu, onEditProfile })

    await user.click(screen.getByRole("button", { name: new RegExp(strings.activity.title, "i") }))
    expect(onActivityMenu).toHaveBeenCalledTimes(1)
    expect(onEditProfile).not.toHaveBeenCalled()
  })

  it("sem menu de estado, abre o perfil: um botão que não leva a lado nenhum não se desenha", async () => {
    const onEditProfile = vi.fn()
    const user = userEvent.setup()
    montar({ onActivityMenu: undefined, onEditProfile })

    await user.click(screen.getByRole("button", { name: new RegExp(strings.activity.title, "i") }))
    expect(onEditProfile).toHaveBeenCalledTimes(1)
  })
})

/**
 * The ring of your own face (owner request, October 27, 2026): the same ring
 * as other faces, by the dot rule. The color is shown in
 * `scripts/medir-aneis-de-presenca.mjs`; here we measure what CSS reads.
 */
describe("CartaoDaConta — o anel da própria cara", () => {
  const anel = (): HTMLElement => document.querySelector(".me-avatar") as HTMLElement

  it.each([
    [{ activity: "online" as const }, "online"],
    [{ activity: "ocupado" as const }, "ocupado"],
    [{ activity: "ausente" as const }, "ausente"],
    [{ activity: "invisivel" as const }, "offline"],
    [{ activity: "online" as const, ligacao: "reconnecting" as const }, "offline"],
  ])("%o pinta o anel %s", (extra, estado) => {
    montar(extra)

    expect(anel().dataset["anel"]).toBe(estado)
  })

  it("só pulsa em chamada", () => {
    montar()
    expect(anel().hasAttribute("data-em-chamada")).toBe(false)
    cleanup()

    montar({ emChamada: true })
    expect(anel().hasAttribute("data-em-chamada")).toBe(true)
  })

  it("o ponto continua: diz a ligação, que o anel não diz", () => {
    montar({ ligacao: "reconnecting" })

    expect(anel().querySelector(".dot.reconnecting")).not.toBeNull()
  })
})

/**
 * The P1 control panel (owner, October 28, 2026): the "Connected" banner and
 * the account banner in one piece, in three tiers. You on top; the call in the
 * middle, in a box that goes back to the call; a row of identical buttons at
 * the bottom.
 *
 * The middle box is the dock in side form (`CallDock`), mounted by the shell.
 * Here we mount the real one, to lock down the whole path: clicking the box goes
 * back, and "Channel · Room" is an `Andante`. The geometry (proportion, nothing
 * stacked) is shown in `scripts/retratar-painel-de-controlo.mjs`.
 */
describe("CartaoDaConta, o painel de controlo (P1)", () => {
  const completo = {
    onAbrirDefinicoes: (): void => {},
    onNotifications: (): void => {},
  }

  function emChamada(
    extra: { onBack?: () => void; onSair?: () => void; aPartilharEcra?: boolean } = {},
  ): void {
    const caixa = (
      <CallDock
        variante="lateral"
        comAudio={false}
        channel="!nexo:s"
        channelLabel="nexo"
        roomLabel="Sala das reuniões"
        latencia={{ ms: 12, ate: "servidor" }}
        aPartilharEcra={extra.aPartilharEcra ?? false}
        participants={[]}
        localStream={null}
        nameFor={(quem) => quem}
        onBack={extra.onBack ?? (() => {})}
        onLeave={() => {}}
      />
    )
    montar({ ...completo, latencia: { ms: 12, ate: "servidor" }, chamada: { caixa, onSair: extra.onSair ?? (() => {}) } })
  }

  const painel = (): HTMLElement => document.querySelector(".me-faixa.painel") as HTMLElement
  /** The tiers you see: the address lives off-screen and is not a tier. */
  const andares = (): string[] =>
    [...painel().children].filter((filho) => !filho.classList.contains("me-address")).map((filho) => filho.className)
  const fila = (): HTMLButtonElement[] => [...painel().querySelectorAll<HTMLButtonElement>(".me-accoes button")]

  it("é um painel com nome, para quem ouve o ecrã", () => {
    montar(completo)
    expect(screen.getByRole("group", { name: strings.sidebar.painelDeControlo })).toBe(painel())
  })

  it("fora de chamada tem dois andares e quatro botões, e não tem sair", () => {
    montar(completo)
    expect(andares()).toEqual(["me-identity", "me-accoes"])
    expect(fila()).toHaveLength(4)
    expect(screen.queryByRole("button", { name: strings.call.leave })).toBeNull()
    expect(painel().classList.contains("em-chamada")).toBe(false)
    expect(painel().querySelector<HTMLElement>(".me-accoes")?.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))")
  })

  it("em chamada tem três andares, com a caixa da chamada no meio", () => {
    emChamada()
    expect(andares()).toEqual(["me-identity", "call-dock lateral", "me-accoes"])
    expect(painel().classList.contains("em-chamada")).toBe(true)
  })

  it("em chamada a fila tem cinco botões iguais, e o último é sair", () => {
    const onSair = vi.fn()
    emChamada({ onSair })
    expect(fila().map((botao) => botao.getAttribute("aria-label"))).toEqual([
      strings.call.micAria(false),
      strings.call.soundAria(false),
      strings.notifCenter.bellWithCount(0),
      strings.sidebar.abrirDefinicoes,
      strings.call.leave,
    ])
    expect(painel().querySelector<HTMLElement>(".me-accoes")?.style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))")
    // Hang up stays outside the account and audio sections: it belongs to the call.
    const sair = screen.getByRole("button", { name: strings.call.leave })
    expect(sair.closest("[role=group]")).toBe(painel())
    fireEvent.click(sair)
    expect(onSair).toHaveBeenCalledOnce()
  })

  it("o balão de canto passa para o sair: é ele o botão encostado à borda", () => {
    montar(completo)
    expect(screen.getByRole("button", { name: strings.sidebar.abrirDefinicoes }).getAttribute("data-tip-side")).toBe("end")
    cleanup()
    emChamada()
    expect(screen.getByRole("button", { name: strings.sidebar.abrirDefinicoes }).hasAttribute("data-tip-side")).toBe(false)
    expect(screen.getByRole("button", { name: strings.call.leave }).getAttribute("data-tip-side")).toBe("end")
  })

  it("clicar na caixa volta à chamada", async () => {
    const onBack = vi.fn()
    emChamada({ onBack })
    await userEvent.click(screen.getByRole("button", { name: strings.callDock.back }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('a caixa diz o ping e a contagem, e o "Canal · Sala" é um letreiro que anda', () => {
    emChamada()
    const caixa = painel().querySelector(".call-dock.lateral")!
    expect(caixa.querySelector(".call-dock-texto")?.textContent).toBe(strings.callDock.ping(12))
    expect(caixa.querySelector(".call-dock-count")?.textContent).toBe(strings.call.people(1))
    const onde = caixa.querySelector(".call-dock-where")
    expect(onde?.classList.contains("andante-caixa")).toBe(true)
    expect(onde?.querySelector(".andante-fita")?.textContent).toBe("nexo · Sala das reuniões")
  })

  it("a partilhar o ecrã, a caixa di-lo a seguir à sala", () => {
    emChamada({ aPartilharEcra: true })
    expect(painel().querySelector(".call-dock-where")?.getAttribute("title")).toBe(
      `nexo · Sala das reuniões · ${strings.callDock.aPartilharEcra}`,
    )
  })

  it("em chamada o ping não se repete por baixo do nome", () => {
    emChamada()
    expect(document.querySelector(".me-state")?.textContent).toBe(strings.activity.online)
    expect(document.querySelector(".me-state-latencia")).toBeNull()
  })

  it("o campo do estado escrito abre por baixo de ti, antes da caixa da chamada", () => {
    const caixa = <aside className="call-dock lateral" />
    const { rerender } = render(
      <ToastContext.Provider value={() => {}}>
        <CartaoDaConta {...base} {...completo} chamada={{ caixa, onSair: () => {} }} pedidoDeEstado={0} />
      </ToastContext.Provider>,
    )
    rerender(
      <ToastContext.Provider value={() => {}}>
        <CartaoDaConta {...base} {...completo} chamada={{ caixa, onSair: () => {} }} pedidoDeEstado={1} />
      </ToastContext.Provider>,
    )
    expect(andares()).toEqual(["me-identity", "me-estado-escrito", "call-dock lateral", "me-accoes"])
  })
})
