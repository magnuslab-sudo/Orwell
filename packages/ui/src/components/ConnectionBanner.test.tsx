import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ConnectionState } from "../bridge.js"
import { strings } from "../strings.js"
import { ConnectionBanner, LigacaoContext, tempoSemLigacao } from "./ConnectionBanner.js"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("ConnectionBanner", () => {
  it("aparece quando a ligação cai, com o detalhe", () => {
    render(<ConnectionBanner state="reconnecting" detail="a ligação caiu" />)
    const banner = screen.getByRole("status")
    expect(banner.textContent).toContain("Sem ligação. A tentar reconectar…")
    expect(banner.textContent).toContain("a ligação caiu")
  })

  it("um detalhe que é chave de erro mostra o código e a frase", () => {
    render(<ConnectionBanner state="reconnecting" detail="the connection dropped" />)
    const banner = screen.getByRole("status")
    expect(banner.textContent).toContain("Erro 206")
    expect(banner.textContent).toContain("A ligação caiu a meio.")
    expect(banner.textContent).not.toContain("the connection dropped")
  })

  it("aparece mesmo sem detalhe", () => {
    render(<ConnectionBanner state="offline" detail={null} />)
    expect(screen.getByRole("status").textContent).toContain("Sem ligação. A tentar reconectar…")
  })

  it("não existe quando está online", () => {
    const { container } = render(<ConnectionBanner state="online" detail={null} />)
    expect(screen.queryByRole("status")).toBeNull()
    expect(container.firstChild).toBeNull()
  })
})

describe("ConnectionBanner: a faixa com acção", () => {
  function comConcha(state: ConnectionState, caiuEm: number | null, ligarAgora = vi.fn()) {
    render(
      <LigacaoContext.Provider value={{ ligarAgora, caiuEm }}>
        <ConnectionBanner state={state} detail={null} />
      </LigacaoContext.Provider>,
    )
    return ligarAgora
  }

  it('"Ligar agora" chama a reconexão da concha', async () => {
    const user = userEvent.setup()
    const ligarAgora = comConcha("reconnecting", Date.now())
    const botao = screen.getByRole("button", { name: strings.connection.ligarAgora })
    expect(botao.getAttribute("title")).toBe(strings.connection.tentaSozinha)
    await user.click(botao)
    expect(ligarAgora).toHaveBeenCalledOnce()
  })

  it('a meio de ligar, o botão diz "A ligar…" e não se carrega', () => {
    comConcha("connecting", Date.now())
    const botao = screen.getByRole("button", { name: strings.connection.aLigar })
    expect((botao as HTMLButtonElement).disabled).toBe(true)
  })

  it("diz há quanto tempo caiu, e o relógio anda sozinho", () => {
    vi.useFakeTimers()
    const agora = new Date("2026-10-20T10:00:00Z").getTime()
    vi.setSystemTime(agora)
    comConcha("reconnecting", agora - 2 * 60_000)
    expect(screen.getByRole("status").textContent).toContain("Sem ligação há 2 min.")
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByRole("status").textContent).toContain("Sem ligação há 3 min.")
  })

  it("sem hora de queda (o arranque), diz a frase de sempre", () => {
    comConcha("connecting", null)
    expect(screen.getByRole("status").textContent).toContain(strings.connection.banner)
  })

  it("sem concha, não há botão: um ecrã sozinho não sabe ligar", () => {
    render(<ConnectionBanner state="offline" detail={null} />)
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("o tempo lê-se em minutos e depois em horas", () => {
    expect(tempoSemLigacao(0, 30_000)).toBe("menos de 1 min")
    expect(tempoSemLigacao(0, 59 * 60_000)).toBe("59 min")
    expect(tempoSemLigacao(0, 61 * 60_000)).toBe("1 hora")
    expect(tempoSemLigacao(0, 3 * 3_600_000)).toBe("3 horas")
  })
})
