import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { contaParaAfk, RelogioAfk, type MudancaAfk, type SituacaoAfk } from "./relogioAfk.js"

const MIN = 60_000

const base: SituacaoAfk = {
  canal: "!casa:s",
  sala: "contio-geral",
  privada: false,
  salaAfk: { room: "contio-afk", minutos: 15 },
  silenciadoPorGesto: true,
  aPartilharEcra: false,
  aEmitirMusica: false,
}

let movidas: MudancaAfk[]
let relogio: RelogioAfk

beforeEach(() => {
  vi.useFakeTimers()
  movidas = []
  relogio = new RelogioAfk((mudanca) => movidas.push(mudanca))
})

afterEach(() => {
  relogio.parar()
  vi.useRealTimers()
})

describe("a regra", () => {
  it("conta numa sala de voz, silenciado por gesto, com sala AFK no canal", () => {
    expect(contaParaAfk(base)).toBe(true)
  })

  it.each([
    ["fora de chamada", { canal: null }],
    ["numa conversa privada", { privada: true }],
    ["sem sala AFK no canal", { salaAfk: null }],
    ["já na sala AFK", { sala: "contio-afk" }],
    ["com o microfone ligado (ou só carregar para falar)", { silenciadoPorGesto: false }],
    ["a partilhar o ecrã", { aPartilharEcra: true }],
    ["a pôr música como DJ", { aEmitirMusica: true }],
  ] as const)("não conta %s", (_nome, mudanca) => {
    expect(contaParaAfk({ ...base, ...mudanca })).toBe(false)
  })
})

describe("o relógio", () => {
  it("move ao fim de 15 minutos seguidos silenciado", () => {
    relogio.actualizar(base)
    vi.advanceTimersByTime(15 * MIN - 1)
    expect(movidas).toEqual([])
    vi.advanceTimersByTime(1)
    expect(movidas).toEqual([{ canal: "!casa:s", de: "contio-geral", para: "contio-afk", minutos: 15 }])
  })

  it("respeita o tempo do canal (5 minutos)", () => {
    relogio.actualizar({ ...base, salaAfk: { room: "contio-afk", minutos: 5 } })
    vi.advanceTimersByTime(5 * MIN)
    expect(movidas).toHaveLength(1)
  })

  it("ligar o microfone recomeça a contagem", () => {
    relogio.actualizar(base)
    vi.advanceTimersByTime(14 * MIN)
    relogio.actualizar({ ...base, silenciadoPorGesto: false })
    relogio.actualizar(base)
    vi.advanceTimersByTime(14 * MIN)
    expect(movidas).toEqual([])
    vi.advanceTimersByTime(1 * MIN)
    expect(movidas).toHaveLength(1)
  })

  it("carregar para falar recomeça a contagem", () => {
    relogio.actualizar(base)
    vi.advanceTimersByTime(14 * MIN)
    relogio.actualizar(base)
    relogio.actividade()
    vi.advanceTimersByTime(14 * MIN)
    expect(movidas).toEqual([])
    vi.advanceTimersByTime(1 * MIN)
    expect(movidas).toHaveLength(1)
  })

  it("carregar para falar sem estar a contar não faz nada", () => {
    relogio.actividade()
    vi.advanceTimersByTime(60 * MIN)
    expect(movidas).toEqual([])
  })

  it("mudar de sala recomeça a contagem", () => {
    relogio.actualizar(base)
    vi.advanceTimersByTime(10 * MIN)
    relogio.actualizar({ ...base, sala: "contio-outra" })
    vi.advanceTimersByTime(10 * MIN)
    expect(movidas).toEqual([])
    vi.advanceTimersByTime(5 * MIN)
    expect(movidas).toEqual([expect.objectContaining({ de: "contio-outra" })])
  })

  it("repetir a mesma situação não recomeça nada", () => {
    relogio.actualizar(base)
    for (let minuto = 0; minuto < 15; minuto++) {
      vi.advanceTimersByTime(MIN)
      relogio.actualizar({ ...base })
    }
    expect(movidas).toHaveLength(1)
  })

  it("começar a partilhar o ecrã pára o relógio, e parar de partilhar recomeça do zero", () => {
    relogio.actualizar(base)
    vi.advanceTimersByTime(14 * MIN)
    relogio.actualizar({ ...base, aPartilharEcra: true })
    vi.advanceTimersByTime(30 * MIN)
    expect(movidas).toEqual([])
    relogio.actualizar(base)
    vi.advanceTimersByTime(15 * MIN)
    expect(movidas).toHaveLength(1)
  })

  it("mudar o tempo a meio conta do mesmo início", () => {
    relogio.actualizar(base)
    vi.advanceTimersByTime(10 * MIN)
    relogio.actualizar({ ...base, salaAfk: { room: "contio-afk", minutos: 5 } })
    vi.advanceTimersByTime(0)
    expect(movidas).toHaveLength(1)
  })

  it("dispara uma vez só", () => {
    relogio.actualizar(base)
    vi.advanceTimersByTime(60 * MIN)
    expect(movidas).toHaveLength(1)
  })

  it("sair da chamada pára o relógio", () => {
    relogio.actualizar(base)
    vi.advanceTimersByTime(10 * MIN)
    relogio.actualizar({ ...base, canal: null })
    vi.advanceTimersByTime(60 * MIN)
    expect(movidas).toEqual([])
    expect(relogio.falta).toBeNull()
  })

  it("diz quanto falta", () => {
    relogio.actualizar(base)
    vi.advanceTimersByTime(5 * MIN)
    expect(relogio.falta).toBe(10 * MIN)
  })
})
