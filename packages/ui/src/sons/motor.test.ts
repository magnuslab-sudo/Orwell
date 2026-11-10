import { afterEach, describe, expect, it } from "vitest"
import { SONS, type TipoDeSom } from "./familia.js"
import {
  TECTO,
  TOQUE_MAXIMO_MS,
  amplitudeDe,
  criarMotor,
  criarSaidaWebAudio,
  tocarSomDeActualizacao,
  type Ambiente,
  type EstadoDoSom,
  type Relogio,
  type Saida,
} from "./motor.js"
import { PREFERENCIAS_DE_SOM_POR_OMISSAO } from "./preferencias.js"
import { moradaDeTeste } from "../../testes/moradas.js"

/**
 * The engine rules, one by one.
 *
 * Each test proves a rule with both sides: the case where it silences and the
 * neighboring case where the sound plays. Without the rule, the first goes
 * red; with a rule too broad, the second.
 */

/* ------------------------------------------------------------ fakes */

function relogioFalso(): Relogio & { avancar(ms: number): void; t: number } {
  let t = 0
  let fila: { quando: number; fazer: () => void; vivo: boolean }[] = []
  const relogio = {
    get t() {
      return t
    },
    agora: () => t,
    depois(ms: number, fazer: () => void) {
      const entrada = { quando: t + ms, fazer, vivo: true }
      fila.push(entrada)
      return () => {
        entrada.vivo = false
      }
    },
    avancar(ms: number) {
      const fim = t + ms
      for (;;) {
        const proxima = fila
          .filter((e) => e.vivo && e.quando <= fim)
          .sort((a, b) => a.quando - b.quando)[0]
        if (!proxima) break
        t = proxima.quando
        proxima.vivo = false
        fila = fila.filter((e) => e.vivo)
        proxima.fazer()
      }
      t = fim
    },
  }
  return relogio
}

function saidaFalsa(funciona = true) {
  const tocados: { tipo: TipoDeSom; amplitude: number }[] = []
  const vibracoes: number[][] = []
  const calados: TipoDeSom[] = []
  let preparada = 0
  const saida: Saida = {
    tocar: (tipo, amplitude) => {
      if (!funciona) return false
      tocados.push({ tipo, amplitude })
      return true
    },
    calar: (tipo) => void calados.push(tipo),
    vibrar: (padrao) => void vibracoes.push([...padrao]),
    preparar: () => {
      preparada += 1
    },
  }
  return { saida, tocados, vibracoes, calados, preparadas: () => preparada }
}

const ESTADO: EstadoDoSom = {
  ligado: true,
  volume: 50,
  actividade: "online",
  som: PREFERENCIAS_DE_SOM_POR_OMISSAO,
}

function montar(
  sobre: { estado?: Partial<EstadoDoSom>; ambiente?: Partial<Ambiente>; funciona?: boolean } = {},
) {
  const relogio = relogioFalso()
  const falsa = saidaFalsa(sobre.funciona ?? true)
  let estado: EstadoDoSom = { ...ESTADO, ...sobre.estado }
  const motor = criarMotor({
    saida: falsa.saida,
    lerEstado: () => estado,
    relogio,
    ambiente: {
      canalAberto: () => "!aberto:casa.pt",
      janelaAFrente: () => true,
      visivel: () => true,
      houveGesto: () => true,
      ...sobre.ambiente,
    },
  })
  return {
    motor,
    relogio,
    ...falsa,
    mudarEstado: (patch: Partial<EstadoDoSom>) => {
      estado = { ...estado, ...patch }
    },
  }
}

const OUTRO = "!outro:casa.pt"
const ABERTO = "!aberto:casa.pt"
const DM = moradaDeTeste("directa ana eu", "casa.pt")

/* -------------------------------------------------------------- as regras */

describe("regra 1: nunca antes do primeiro gesto (autoplay)", () => {
  afterEach(() => {
    // The listeners on `arm` fire only once; nothing to clean up on `window`.
  })

  it("sem gesto, cala; depois de um clique, toca", () => {
    const relogio = relogioFalso()
    const falsa = saidaFalsa()
    const motor = criarMotor({ saida: falsa.saida, lerEstado: () => ESTADO, relogio })
    expect(motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("sem-gesto")
    expect(falsa.tocados).toHaveLength(0)

    const desarmar = motor.armar()
    window.dispatchEvent(new Event("pointerdown"))
    desarmar()

    expect(falsa.preparadas()).toBe(1)
    expect(motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("tocou")
  })

  it("uma tecla também conta como gesto", () => {
    const falsa = saidaFalsa()
    const motor = criarMotor({ saida: falsa.saida, lerEstado: () => ESTADO, relogio: relogioFalso() })
    const desarmar = motor.armar()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))
    desarmar()
    expect(motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("tocou")
  })
})

describe("regra 2: os interruptores", () => {
  it("o interruptor geral desligado cala tudo", () => {
    const { motor } = montar({ estado: { ligado: false } })
    expect(motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("desligado")
    expect(montar().motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("tocou")
  })

  it("o interruptor de um tipo cala esse tipo e só esse", () => {
    const som = { ...PREFERENCIAS_DE_SOM_POR_OMISSAO, porTipo: { ...PREFERENCIAS_DE_SOM_POR_OMISSAO.porTipo, mencao: false } }
    const { motor } = montar({ estado: { som } })
    expect(motor.tocar({ tipo: "mencao", canal: OUTRO })).toBe("tipo-desligado")
    expect(motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("tocou")
  })

  it("a publicação de um amigo vem desligada de fábrica", () => {
    expect(montar().motor.tocar({ tipo: "publicacao", canal: OUTRO })).toBe("tipo-desligado")
  })
})

describe("regra 3: nunca para acções próprias", () => {
  it("o que é meu não toca; o mesmo de outra pessoa toca", () => {
    const { motor } = montar()
    expect(motor.tocar({ tipo: "directa", canal: OUTRO, deMim: true })).toBe("proprio")
    expect(motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("tocou")
  })

  it("nem a chamada que eu próprio comecei", () => {
    expect(montar().motor.tocarChamada(DM, { deMim: true })).toBe("proprio")
  })
})

describe('regra 4: "Ocupado" e "Invisível"', () => {
  it('"Ocupado" cala as mensagens', () => {
    expect(montar({ estado: { actividade: "ocupado" } }).motor.tocar({ tipo: "directa", canal: OUTRO })).toBe(
      "actividade",
    )
  })

  it('"Invisível" também', () => {
    expect(montar({ estado: { actividade: "invisivel" } }).motor.tocar({ tipo: "pedido", canal: OUTRO })).toBe(
      "actividade",
    )
  })

  it('"Ausente" não cala: o som é o que chama a pessoa de volta', () => {
    expect(montar({ estado: { actividade: "ausente" } }).motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("tocou")
  })

  it("a chamada a entrar passa por cima, se a pessoa o deixou", () => {
    expect(montar({ estado: { actividade: "ocupado" } }).motor.tocarChamada(DM)).toBe("tocou")
  })

  it("e não passa, se a pessoa não deixou", () => {
    const som = { ...PREFERENCIAS_DE_SOM_POR_OMISSAO, chamadaComOcupado: false }
    expect(montar({ estado: { actividade: "ocupado", som } }).motor.tocarChamada(DM)).toBe("actividade")
  })
})

describe("regra 5: nunca para o que está à frente", () => {
  it("no canal aberto, com a janela à frente, cala", () => {
    expect(montar().motor.tocar({ tipo: "directa", canal: ABERTO })).toBe("a-ver")
  })

  it("noutro canal, toca", () => {
    expect(montar().motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("tocou")
  })

  it("no canal aberto mas com a janela atrás, toca", () => {
    const { motor } = montar({ ambiente: { janelaAFrente: () => false } })
    expect(motor.tocar({ tipo: "directa", canal: ABERTO })).toBe("tocou")
  })

  it("a chamada toca mesmo na conversa aberta: pede uma acção", () => {
    const { motor } = montar({ ambiente: { canalAberto: () => DM } })
    expect(motor.tocarChamada(DM)).toBe("tocou")
  })
})

describe("regra 6: em segundo plano, o aviso do sistema com som manda", () => {
  it("escondida e com aviso que já toca, a aplicação cala", () => {
    const { motor } = montar({ ambiente: { visivel: () => false } })
    expect(motor.tocar({ tipo: "directa", canal: OUTRO, avisoComSom: true })).toBe("aviso-do-sistema")
  })

  it("escondida e com aviso calado (secretária, Electron), a aplicação toca", () => {
    const { motor } = montar({ ambiente: { visivel: () => false } })
    expect(motor.tocar({ tipo: "directa", canal: OUTRO, avisoComSom: false })).toBe("tocou")
  })

  it("visível, não há aviso do sistema, e a aplicação toca", () => {
    expect(montar().motor.tocar({ tipo: "directa", canal: OUTRO, avisoComSom: true })).toBe("tocou")
  })
})

describe("regra 7: o volume", () => {
  it("volume zero é silêncio", () => {
    expect(montar({ estado: { volume: 0 } }).motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("volume-zero")
  })

  it("sobe ao quadrado, até ao tecto", () => {
    expect(amplitudeDe(100)).toBe(TECTO)
    expect(amplitudeDe(50)).toBeCloseTo(TECTO / 4, 6)
    expect(amplitudeDe(150)).toBe(TECTO)
    expect(amplitudeDe(-5)).toBe(0)
  })

  it("o som mais alto, no máximo, fica abaixo de metade da voz de uma chamada", () => {
    const presencaMaxima = Math.max(...Object.values(SONS).map((som) => som.presenca))
    expect(amplitudeDe(100) * presencaMaxima).toBeLessThan(0.5)
  })

  it("a saída recebe a amplitude do volume escolhido", () => {
    const { motor, tocados } = montar({ estado: { volume: 100 } })
    motor.tocar({ tipo: "directa", canal: OUTRO })
    expect(tocados[0]?.amplitude).toBe(TECTO)
  })
})

describe("regra 8: nunca em rajada", () => {
  it("vinte mensagens de uma vez fazem um som", () => {
    const { motor, tocados } = montar()
    for (let i = 0; i < 20; i += 1) motor.tocar({ tipo: "directa", canal: OUTRO })
    expect(tocados).toHaveLength(1)
  })

  it("passados 2 s, o mesmo tipo volta a tocar", () => {
    const { motor, relogio } = montar()
    expect(motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("tocou")
    relogio.avancar(1999)
    expect(motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("rajada")
    relogio.avancar(1)
    expect(motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("tocou")
  })

  it("tipos diferentes não se calam uns aos outros", () => {
    const { motor } = montar()
    expect(motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("tocou")
    expect(motor.tocar({ tipo: "mencao", canal: OUTRO })).toBe("tocou")
  })

  it("os sons do silenciar respondem a cada carregar: a rajada deles é curta", () => {
    const { motor, relogio, tocados } = montar()
    expect(motor.tocar({ tipo: "mic-silenciado" })).toBe("tocou")
    relogio.avancar(300)
    expect(motor.tocar({ tipo: "mic-ligado" })).toBe("tocou")
    relogio.avancar(300)
    expect(motor.tocar({ tipo: "mic-silenciado" })).toBe("tocou")
    // A held key repeating does not machine-gun.
    expect(motor.tocar({ tipo: "mic-silenciado" })).toBe("rajada")
    expect(tocados.map((som) => som.tipo)).toEqual(["mic-silenciado", "mic-ligado", "mic-silenciado"])
  })

  it("um som que falhou não conta para a rajada", () => {
    const { motor } = montar({ funciona: false })
    expect(motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("sem-audio")
    expect(motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("sem-audio")
  })
})

describe("vibração no telemóvel", () => {
  it("vibra curto junto com o som", () => {
    const { motor, vibracoes } = montar()
    motor.tocar({ tipo: "directa", canal: OUTRO })
    expect(vibracoes).toEqual([[40]])
  })

  it("não vibra com a vibração desligada", () => {
    const som = { ...PREFERENCIAS_DE_SOM_POR_OMISSAO, vibrar: false }
    const { motor, vibracoes, tocados } = montar({ estado: { som } })
    motor.tocar({ tipo: "directa", canal: OUTRO })
    expect(tocados).toHaveLength(1)
    expect(vibracoes).toHaveLength(0)
  })

  it("não vibra quando o som não tocou", () => {
    const { motor, vibracoes } = montar()
    motor.tocar({ tipo: "directa", canal: ABERTO })
    expect(vibracoes).toHaveLength(0)
  })

  it("as entradas e saídas da sala de voz não vibram: ouvem-se dezenas de vezes", () => {
    const { motor, vibracoes, tocados } = montar()
    motor.tocar({ tipo: "entrou" })
    expect(tocados).toHaveLength(1)
    expect(vibracoes).toHaveLength(0)
  })
})

describe("o toque da chamada", () => {
  const periodo = (SONS.chamada.periodo ?? 3) * 1000

  it("numa directa repete até 30 s e pára sozinho", () => {
    const { motor, relogio, tocados, calados } = montar()
    expect(motor.tocarChamada(DM, { repetir: true })).toBe("tocou")
    relogio.avancar(TOQUE_MAXIMO_MS + 10_000)
    // A loop through 0, 3, 6, … 27 s: ten loops, none after 30 s.
    expect(tocados.filter((t) => t.tipo === "chamada")).toHaveLength(Math.ceil(TOQUE_MAXIMO_MS / periodo))
    expect(motor.chamadaATocar()).toBeNull()
    expect(calados).toContain("chamada")
  })

  it("pára quando se atende (ou recusa), e corta o som a meio", () => {
    const { motor, relogio, tocados, calados } = montar()
    motor.tocarChamada(DM, { repetir: true })
    relogio.avancar(periodo + 10)
    expect(tocados).toHaveLength(2)
    motor.pararChamada(DM)
    relogio.avancar(TOQUE_MAXIMO_MS)
    expect(tocados).toHaveLength(2)
    expect(calados).toEqual(["chamada"])
    expect(motor.chamadaATocar()).toBeNull()
  })

  it("parar outro canal não pára este", () => {
    const { motor } = montar()
    motor.tocarChamada(DM, { repetir: true })
    motor.pararChamada(OUTRO)
    expect(motor.chamadaATocar()).toBe(DM)
  })

  it("numa sala de canal toca uma figura só", () => {
    const { motor, relogio, tocados } = montar()
    motor.tocarChamada(OUTRO, { repetir: false })
    relogio.avancar(TOQUE_MAXIMO_MS)
    expect(tocados).toHaveLength(1)
    expect(motor.chamadaATocar()).toBeNull()
  })

  it("a mesma chamada a tocar não começa outra vez", () => {
    const { motor, tocados } = montar()
    motor.tocarChamada(DM, { repetir: true })
    expect(motor.tocarChamada(DM, { repetir: true })).toBe("rajada")
    expect(tocados).toHaveLength(1)
  })

  it('ficar "Ocupado" a meio cala a volta seguinte, se a chamada não passa por cima', () => {
    const som = { ...PREFERENCIAS_DE_SOM_POR_OMISSAO, chamadaComOcupado: false }
    const { motor, relogio, tocados, mudarEstado } = montar({ estado: { som } })
    motor.tocarChamada(DM, { repetir: true })
    mudarEstado({ actividade: "ocupado" })
    relogio.avancar(periodo * 3)
    expect(tocados).toHaveLength(1)
    expect(motor.chamadaATocar()).toBeNull()
  })

  it("vibra mais longo do que uma mensagem", () => {
    const { motor, vibracoes } = montar()
    motor.tocarChamada(DM, { repetir: true })
    const total = (vibracoes[0] ?? []).reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThan(40)
  })
})

describe('"Ouvir", nas Configurações', () => {
  it("salta as regras: é um pedido explícito", () => {
    const { motor, tocados } = montar({ estado: { ligado: false, actividade: "ocupado" } })
    expect(motor.ouvir("mencao", 100)).toBe(true)
    expect(tocados).toEqual([{ tipo: "mencao", amplitude: TECTO }])
  })
})

describe("a saída por Web Audio", () => {
  it("sem AudioContext, não toca e não rebenta", () => {
    const saida = criarSaidaWebAudio({ criarContexto: () => null, renderizar: async () => null })
    expect(saida.tocar("directa", 0.2)).toBe(false)
    expect(() => saida.preparar()).not.toThrow()
    expect(() => saida.calar("chamada")).not.toThrow()
  })

  it("renderiza cada som uma vez, e toca o buffer guardado", async () => {
    const renderizados: TipoDeSom[] = []
    const iniciados: unknown[] = []
    const buffer = {} as AudioBuffer
    const contexto = {
      state: "running",
      destination: {},
      resume: () => {},
      createBufferSource: () => ({
        buffer: null as unknown,
        connect: () => {},
        start() {
          iniciados.push(this.buffer)
        },
        stop: () => {},
        onended: null,
      }),
      createGain: () => ({ gain: { value: 0 }, connect: () => {} }),
    } as unknown as AudioContext
    const saida = criarSaidaWebAudio({
      criarContexto: () => contexto,
      renderizar: async (tipo) => {
        renderizados.push(tipo)
        return buffer
      },
    })
    saida.preparar()
    await new Promise((r) => setTimeout(r, 0))
    expect(new Set(renderizados).size).toBe(renderizados.length)
    expect(saida.tocar("directa", 0.2)).toBe(true)
    saida.tocar("directa", 0.2)
    expect(iniciados).toEqual([buffer, buffer])
    expect(renderizados.filter((t) => t === "directa")).toHaveLength(1)
  })
})

describe("a pausa das Notificações (fase 4)", () => {
  it("cala a directa até à hora de fim, e a chamada toca na mesma", () => {
    const { motor, relogio, tocados } = montar({ estado: { pausaAte: 10_000 } })
    expect(motor.tocar({ tipo: "directa", canal: OUTRO })).toBe("pausa")
    expect(motor.tocarChamada(DM)).toBe("tocou")
    relogio.avancar(10_000)
    expect(motor.tocar({ tipo: "mencao", canal: OUTRO })).toBe("tocou")
    expect(tocados.map((som) => som.tipo)).toEqual(["chamada", "mencao"])
  })
})

describe('"Actualização disponível" (fase 4)', () => {
  it("toca, ligado de fábrica; cala com Ocupado, Invisível, a pausa e o interruptor do tipo", () => {
    expect(PREFERENCIAS_DE_SOM_POR_OMISSAO.porTipo.actualizacao).toBe(true)
    expect(tocarSomDeActualizacao(montar().motor)).toBe("tocou")
    expect(tocarSomDeActualizacao(montar({ estado: { actividade: "ocupado" } }).motor)).toBe("actividade")
    expect(tocarSomDeActualizacao(montar({ estado: { actividade: "invisivel" } }).motor)).toBe("actividade")
    expect(tocarSomDeActualizacao(montar({ estado: { pausaAte: 10_000 } }).motor)).toBe("pausa")
    const desligado = { ...PREFERENCIAS_DE_SOM_POR_OMISSAO, porTipo: { ...PREFERENCIAS_DE_SOM_POR_OMISSAO.porTipo, actualizacao: false } }
    expect(tocarSomDeActualizacao(montar({ estado: { som: desligado } }).motor)).toBe("tipo-desligado")
  })
})

/*
  Parity with Discord moments (November 3, 2026). The rules for when each sound
  plays are in `sons/chamada.ts` and have their own tests. Here we measure what
  the engine does with them.
*/
describe("o toque a sair (a chamada que eu fiz)", () => {
  const periodo = (SONS["a-chamar"].periodo ?? 3) * 1000

  it("repete até 30 s e pára sozinho, como o toque a entrar", () => {
    const { motor, relogio, tocados, calados } = montar()
    expect(motor.chamar(DM)).toBe("tocou")
    expect(motor.aChamar()).toBe(DM)
    relogio.avancar(TOQUE_MAXIMO_MS + 10_000)
    expect(tocados.filter((t) => t.tipo === "a-chamar")).toHaveLength(Math.ceil(TOQUE_MAXIMO_MS / periodo))
    expect(motor.aChamar()).toBeNull()
    expect(calados).toContain("a-chamar")
  })

  it("pára quando alguém atende ou eu desisto, e corta o som a meio", () => {
    const { motor, relogio, tocados, calados } = montar()
    motor.chamar(DM)
    relogio.avancar(periodo + 10)
    expect(tocados).toHaveLength(2)
    motor.pararDeChamar(DM)
    relogio.avancar(TOQUE_MAXIMO_MS)
    expect(tocados).toHaveLength(2)
    expect(calados).toEqual(["a-chamar"])
  })

  it("é independente do toque a entrar: parar um não pára o outro", () => {
    const { motor } = montar()
    motor.chamar(DM)
    motor.tocarChamada(OUTRO, { repetir: true })
    motor.pararChamada()
    expect(motor.aChamar()).toBe(DM)
    motor.pararDeChamar(OUTRO)
    expect(motor.aChamar()).toBe(DM)
  })

  it('"Silenciar tudo" cala-o, e silenciar a meio cala a volta seguinte', () => {
    expect(montar({ estado: { ensurdecido: true } }).motor.chamar(DM)).toBe("ensurdecido")
    const { motor, relogio, tocados, mudarEstado } = montar()
    motor.chamar(DM)
    mudarEstado({ ensurdecido: true })
    relogio.avancar(periodo * 3)
    expect(tocados).toHaveLength(1)
    expect(motor.aChamar()).toBeNull()
  })

  it('"Ocupado" e "Invisível": passa por cima como a chamada a entrar, se a pessoa o deixou', () => {
    expect(montar({ estado: { actividade: "ocupado" } }).motor.chamar(DM)).toBe("tocou")
    const som = { ...PREFERENCIAS_DE_SOM_POR_OMISSAO, chamadaComOcupado: false }
    expect(montar({ estado: { actividade: "invisivel", som } }).motor.chamar(DM)).toBe("actividade")
  })

  it("a pausa das Notificações não o cala: é a chamada que estou a fazer", () => {
    expect(montar({ estado: { pausaAte: 10_000 } }).motor.chamar(DM)).toBe("tocou")
  })

  it("não vibra: quem ligou tem o telemóvel na mão", () => {
    const { motor, vibracoes } = montar()
    motor.chamar(DM)
    expect(vibracoes).toEqual([])
  })
})

describe("os outros sons da chamada", () => {
  const novos = ["voz-perdida", "movido", "transmissao-iniciada", "transmissao-terminada", "espectador-entrou", "espectador-saiu"] as const

  it("vêm ligados de fábrica, e cada um tem o seu interruptor", () => {
    for (const tipo of [...novos, "a-chamar"] as const) {
      expect(PREFERENCIAS_DE_SOM_POR_OMISSAO.porTipo[tipo], tipo).toBe(true)
      const porTipo = { ...PREFERENCIAS_DE_SOM_POR_OMISSAO.porTipo, [tipo]: false }
      expect(montar({ estado: { som: { ...PREFERENCIAS_DE_SOM_POR_OMISSAO, porTipo } } }).motor.tocar({ tipo }), tipo).toBe("tipo-desligado")
    }
  })

  it('"Ocupado" e "Invisível" calam-nos; "Ausente" não', () => {
    for (const tipo of novos) {
      expect(montar({ estado: { actividade: "ocupado" } }).motor.tocar({ tipo }), tipo).toBe("actividade")
      expect(montar({ estado: { actividade: "invisivel" } }).motor.tocar({ tipo }), tipo).toBe("actividade")
      expect(montar({ estado: { actividade: "ausente" } }).motor.tocar({ tipo }), tipo).toBe("tocou")
    }
  })

  it("a pausa das Notificações deixa-os passar, como aos outros sons da chamada", () => {
    for (const tipo of novos) expect(montar({ estado: { pausaAte: 10_000 } }).motor.tocar({ tipo }), tipo).toBe("tocou")
  })

  it('"Silenciar tudo" não os cala no motor: quem decide são os vigias (a minha transmissão ouve-se)', () => {
    for (const tipo of novos) expect(montar({ estado: { ensurdecido: true } }).motor.tocar({ tipo }), tipo).toBe("tocou")
  })

  it("em rajada fazem um som: vários espectadores de uma vez são um acontecimento", () => {
    const { motor, relogio, tocados } = montar()
    motor.tocar({ tipo: "espectador-entrou" })
    motor.tocar({ tipo: "espectador-entrou" })
    motor.tocar({ tipo: "espectador-entrou" })
    expect(tocados).toHaveLength(1)
    relogio.avancar(2000)
    expect(motor.tocar({ tipo: "espectador-entrou" })).toBe("tocou")
  })

  it("só a ligação perdida vibra", () => {
    for (const tipo of novos) {
      const { motor, vibracoes } = montar()
      motor.tocar({ tipo })
      if (tipo === "voz-perdida") expect(vibracoes, tipo).toHaveLength(1)
      else expect(vibracoes, tipo).toEqual([])
    }
  })
})
