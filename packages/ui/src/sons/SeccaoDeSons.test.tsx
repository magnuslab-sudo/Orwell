import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { strings } from "../strings.js"
import { motor } from "./motor.js"
import { lerPreferenciasDeSom } from "./preferencias.js"
import { SeccaoDeSons } from "./SeccaoDeSons.js"

vi.mock("./motor.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./motor.js")>()
  return { ...real, motor: { ...real.motor, ouvir: vi.fn(() => true) } }
})

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  vi.mocked(motor.ouvir).mockClear()
})

function montar(ligado = true): void {
  render(<SeccaoDeSons ligado={ligado} volume={60} onLigado={() => {}} onVolume={() => {}} />)
}

describe("Configurações › Notificações › Sons", () => {
  it('mostra um interruptor e um "Ouvir" por acontecimento', () => {
    montar()
    for (const nome of Object.values(strings.settings.somTipos)) {
      expect(screen.getByLabelText(nome)).toBeTruthy()
      expect(screen.getByRole("button", { name: strings.settings.somOuvirTipo(nome) })).toBeTruthy()
    }
  })

  it("a publicação vem desligada; o resto vem ligado", () => {
    montar()
    expect((screen.getByLabelText(strings.settings.somTipos.publicacao) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText(strings.settings.somTipos.directa) as HTMLInputElement).checked).toBe(true)
  })

  it("desligar um tipo guarda a escolha no aparelho", async () => {
    const user = userEvent.setup()
    montar()
    await user.click(screen.getByLabelText(strings.settings.somTipos.mencao))
    expect(lerPreferenciasDeSom().porTipo.mencao).toBe(false)
    expect(lerPreferenciasDeSom().porTipo.directa).toBe(true)
  })

  it('"Ouvir" toca esse som, com o volume escolhido', async () => {
    const user = userEvent.setup()
    montar()
    await user.click(screen.getByRole("button", { name: strings.settings.somOuvirTipo(strings.settings.somTipos.chamada) }))
    expect(motor.ouvir).toHaveBeenCalledWith("chamada", 60)
  })

  it("ligar um tipo toca esse som, como ligar os sons toca a directa; desligar fica calado", async () => {
    // Owner report (4/11/2026): "Sounds are not turning on. All of them. I hear
    // nothing. Only private messages." Turning on sounds played right away; turning
    // on one type played nothing, and it looked like it hadn't turned on.
    const user = userEvent.setup()
    montar()
    for (const tipo of ["canal", "sala-afk", "espectador-saiu"] as const) {
      const caixa = screen.getByLabelText(strings.settings.somTipos[tipo])
      await user.click(caixa)
      expect(motor.ouvir).not.toHaveBeenCalled()
      await user.click(caixa)
      expect(motor.ouvir).toHaveBeenCalledWith(tipo, 60)
      vi.mocked(motor.ouvir).mockClear()
    }
  })

  it('"Vibrar no telemóvel" e a chamada com "Ocupado" guardam-se', async () => {
    const user = userEvent.setup()
    montar()
    await user.click(screen.getByLabelText(strings.settings.somVibrar))
    await user.click(screen.getByLabelText(strings.settings.somChamadaComOcupado))
    expect(lerPreferenciasDeSom().vibrar).toBe(false)
    expect(lerPreferenciasDeSom().chamadaComOcupado).toBe(false)
  })

  it('"Som ao enviar mensagens" vem ligado, e desliga-se como os outros', async () => {
    const user = userEvent.setup()
    montar()
    const caixa = screen.getByLabelText("Som ao enviar mensagens") as HTMLInputElement
    expect(caixa.checked).toBe(true)
    await user.click(caixa)
    expect(lerPreferenciasDeSom().porTipo.enviada).toBe(false)
  })

  it("quem já tinha escolhas guardadas, de antes deste som, recebe-o ligado", () => {
    const antigas = { ...lerPreferenciasDeSom().porTipo, mencao: false } as Record<string, boolean>
    delete antigas.enviada
    localStorage.setItem("enclave.sons", JSON.stringify({ porTipo: antigas, vibrar: false }))
    const lidas = lerPreferenciasDeSom()
    expect(lidas.porTipo.enviada).toBe(true)
    expect(lidas.porTipo.mencao).toBe(false)
    expect(lidas.vibrar).toBe(false)
  })

  it('"Som das mensagens nos canais" vem ligado, desliga-se, e a menção tem o seu interruptor', async () => {
    const user = userEvent.setup()
    montar()
    const caixa = screen.getByLabelText("Som das mensagens nos canais") as HTMLInputElement
    expect(caixa.checked).toBe(true)
    expect((screen.getByLabelText("Quando alguém te menciona") as HTMLInputElement).checked).toBe(true)
    await user.click(caixa)
    expect(lerPreferenciasDeSom().porTipo.canal).toBe(false)
    expect(lerPreferenciasDeSom().porTipo.mencao).toBe(true)
  })

  it("com os sons desligados, a lista arruma-se", () => {
    montar(false)
    expect(screen.queryByLabelText(strings.settings.somTipos.directa)).toBeNull()
  })
})
