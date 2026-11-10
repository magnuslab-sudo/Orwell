/**
 * The microphone watchdog, with a clock on hand (4/11/2026).
 *
 * Each case is one of the ways the microphone dies silently that Chromium
 * showed in `scripts/mic-recupera-evidencia/`: the track ending, the track
 * `muted` for X seconds, the `AudioContext` suspended, the worklet with an error and the
 * worklet stopped. And the case that is NOT death: the main thread frozen.
 */
import { describe, expect, it } from "vitest"
import { VigiaDoMicrofone, type MorteDoMicrofone, type RelogioDaVigia, type SaudeDoMicrofone } from "./vigia-do-microfone.js"

class Relogio implements RelogioDaVigia {
  t = 0
  #tarefas: { fazer: () => void; ms: number; proxima: number }[] = []
  agora(): number {
    return this.t
  }
  repetir(fazer: () => void, ms: number): unknown {
    const tarefa = { fazer, ms, proxima: this.t + ms }
    this.#tarefas.push(tarefa)
    return tarefa
  }
  parar(marca: unknown): void {
    this.#tarefas = this.#tarefas.filter((tarefa) => tarefa !== marca)
  }
  /** Time running, with intervals firing when they come due. */
  andar(ms: number): void {
    const fim = this.t + ms
    for (;;) {
      const tarefa = [...this.#tarefas].sort((a, b) => a.proxima - b.proxima)[0]
      if (!tarefa || tarefa.proxima > fim) break
      this.t = tarefa.proxima
      tarefa.proxima += tarefa.ms
      tarefa.fazer()
    }
    this.t = fim
  }
  /** The frozen thread: time passes and no interval completes. */
  congelar(ms: number): void {
    this.t += ms
    for (const tarefa of this.#tarefas) tarefa.proxima = this.t
  }
}

function montar(saude: { faixa: { readyState: string; muted: boolean }; contexto?: { state: string }; cadeia?: { ultimoBatimento: number; rebentou: boolean } }) {
  const relogio = new Relogio()
  const mortes: { morte: MorteDoMicrofone; detalhe: string }[] = []
  const vigia = new VigiaDoMicrofone(
    () => saude as SaudeDoMicrofone,
    (morte, detalhe) => mortes.push({ morte, detalhe }),
    relogio,
  )
  vigia.ligar()
  return { relogio, mortes, vigia, saude }
}

describe("a vigia do microfone", () => {
  it("um microfone de pé não morre", () => {
    const cadeia = { ultimoBatimento: 0, rebentou: false }
    const { relogio, mortes } = montar({ faixa: { readyState: "live", muted: false }, contexto: { state: "running" }, cadeia })
    for (let i = 0; i < 100; i++) {
      cadeia.ultimoBatimento = relogio.t
      relogio.andar(100)
    }
    expect(mortes).toEqual([])
  })

  it("a faixa crua a terminar é «terminou», no segundo seguinte", () => {
    const { relogio, mortes, saude, vigia } = montar({ faixa: { readyState: "live", muted: false } })
    relogio.andar(1_500)
    saude.faixa.readyState = "ended"
    relogio.andar(1_000)
    expect(mortes).toEqual([{ morte: "terminou", detalhe: "" }])
    // One death at a time: the watchdog stays off until the caller rearms it.
    expect(vigia.ligada).toBe(false)
  })

  it("a faixa muted durante 3 s é «calado»; um mute curto não é nada", () => {
    const { relogio, mortes, saude } = montar({ faixa: { readyState: "live", muted: false } })
    saude.faixa.muted = true
    relogio.andar(2_000)
    saude.faixa.muted = false
    relogio.andar(5_000)
    expect(mortes).toEqual([])

    saude.faixa.muted = true
    relogio.andar(5_000)
    expect(mortes.map((cada) => cada.morte)).toEqual(["calado"])
  })

  it("o AudioContext suspenso mais de 2 s é «contexto-parado»", () => {
    const { relogio, mortes, saude } = montar({ faixa: { readyState: "live", muted: false }, contexto: { state: "running" } })
    saude.contexto!.state = "suspended"
    relogio.andar(1_000)
    expect(mortes).toEqual([])
    relogio.andar(3_000)
    expect(mortes.map((cada) => cada.morte)).toEqual(["contexto-parado"])
    expect(mortes[0]!.detalhe).toContain("suspended")
  })

  it("o worklet com erro é «cadeia-rebentou»", () => {
    const { relogio, mortes, saude } = montar({
      faixa: { readyState: "live", muted: false },
      contexto: { state: "running" },
      cadeia: { ultimoBatimento: 0, rebentou: false },
    })
    saude.cadeia!.rebentou = true
    relogio.andar(1_000)
    expect(mortes.map((cada) => cada.morte)).toEqual(["cadeia-rebentou"])
  })

  it("o worklet que deixa de bater, com o contexto a dizer running, é «cadeia-parada»", () => {
    const { relogio, mortes } = montar({
      faixa: { readyState: "live", muted: false },
      contexto: { state: "running" },
      cadeia: { ultimoBatimento: 0, rebentou: false },
    })
    relogio.andar(2_500)
    expect(mortes).toEqual([])
    relogio.andar(2_000)
    expect(mortes.map((cada) => cada.morte)).toEqual(["cadeia-parada"])
  })

  it("um congelamento de 10 s da thread principal não é uma morte", () => {
    const cadeia = { ultimoBatimento: 0, rebentou: false }
    const { relogio, mortes } = montar({ faixa: { readyState: "live", muted: false }, contexto: { state: "running" }, cadeia })
    cadeia.ultimoBatimento = relogio.t
    relogio.andar(900)
    // The vault: ten seconds without the thread. Worklet messages queue up.
    relogio.congelar(10_000)
    relogio.andar(1)
    expect(mortes).toEqual([])
    // The queued messages arrive, and the worklet keeps beating.
    for (let i = 0; i < 50; i++) {
      cadeia.ultimoBatimento = relogio.t
      relogio.andar(100)
    }
    expect(mortes).toEqual([])
  })

  it("rearmada com uma captura nova, recomeça as contagens", () => {
    const { relogio, mortes, saude, vigia } = montar({ faixa: { readyState: "live", muted: false } })
    saude.faixa.readyState = "ended"
    relogio.andar(1_000)
    expect(mortes).toHaveLength(1)

    saude.faixa = { readyState: "live", muted: false }
    vigia.ligar()
    relogio.andar(10_000)
    expect(mortes).toHaveLength(1)
  })
})
