import { beforeEach, describe, expect, it } from "vitest"
import { moradaDeTeste } from "../../testes/moradas.js"
import { lembrarFichasDosCanais } from "../lib/tipoDoCanal.js"
import { somDoCanal, type MensagemParaSom } from "./acontecimentos.js"
import { ESCALA, SONS, type TipoDeSom } from "./familia.js"
import {
  MENCAO_A_VER,
  RAJADA_MS,
  RAJADA_POR_CANAL_MS,
  VIBRACAO,
  amplitudeDe,
  criarMotor,
  type Ambiente,
  type EstadoDoSom,
  type Relogio,
} from "./motor.js"
import { CHAVE_DOS_SONS, PREFERENCIAS_DE_SOM_POR_OMISSAO, lerPreferenciasDeSom } from "./preferencias.js"

/**
 * The sounds of messages in channels, and the mention (owner request, November 3,
 * 2026). Each rule with both sides: the case that mutes and the neighbor case that plays.
 */

const EU = "@eu:casa.pt"
const ANA = "@ana:casa.pt"
const LAGAR = "!lagar:casa.pt"
const ADEGA = "!adega:casa.pt"
const DM = moradaDeTeste("directa ana eu", "casa.pt")
const MURAL = moradaDeTeste("mural ana", "casa.pt")

beforeEach(() =>
  lembrarFichasDosCanais({
    [DM]: { tipo: "directa" },
    [MURAL]: { tipo: "mural", dono: ANA },
  }),
)

const aoVivo = (over: Partial<MensagemParaSom> = {}): MensagemParaSom => ({
  channel: LAGAR,
  sender: ANA,
  aoVivo: true,
  payload: { t: "message", room: "vinha" },
  ...over,
})

/* ------------------------------------------------------------- a regra */

describe("somDoCanal: quando uma mensagem num canal faz som", () => {
  it("toca para uma mensagem nova, ao vivo, de outra pessoa numa sala", () => {
    expect(somDoCanal(aoVivo(), EU)).toBe("canal")
    expect(somDoCanal(aoVivo({ payload: { t: "message" } }), EU)).toBe("canal")
  })

  it("não toca para a minha mensagem", () => {
    expect(somDoCanal(aoVivo({ sender: EU }), EU)).toBeNull()
  })

  it("não toca para o histórico: sem `aoVivo` é a recuperação ou um relato", () => {
    const { aoVivo: _fora, ...semMarca } = aoVivo()
    expect(somDoCanal(semMarca, EU)).toBeNull()
    expect(somDoCanal({ ...aoVivo(), aoVivo: false }, EU)).toBeNull()
  })

  it("não toca para mensagens de sistema: perfil, cargos, sala criada, channel.meta", () => {
    for (const t of ["profile", "roles", "room.create", "channel.meta", "space.meta", "reaction", "edit", "redact", "typing"]) {
      expect(somDoCanal(aoVivo({ payload: { t } }), EU), t).toBeNull()
    }
  })

  it("não toca fora de uma sala de grupo: a directa e o mural têm os seus sons", () => {
    expect(somDoCanal(aoVivo({ channel: DM }), EU)).toBeNull()
    expect(somDoCanal(aoVivo({ channel: MURAL }), EU)).toBeNull()
  })

  it("a menção ganha: uma mensagem que me nomeia não faz o som do canal", () => {
    expect(somDoCanal(aoVivo({ payload: { t: "message", room: "vinha", mentions: [EU] } }), EU)).toBeNull()
    // Naming someone else is not naming myself.
    expect(somDoCanal(aoVivo({ payload: { t: "message", room: "vinha", mentions: [ANA] } }), EU)).toBe("canal")
  })

  it("não toca num ticket: o ticket tem o seu som e as suas regras", () => {
    expect(somDoCanal(aoVivo({ payload: { t: "message", ticket: { id: "t1" } } }), EU)).toBeNull()
  })

  it("não toca num canal silenciado, nem numa sala silenciada; a sala vizinha toca", () => {
    expect(somDoCanal(aoVivo(), EU, [LAGAR])).toBeNull()
    expect(somDoCanal(aoVivo(), EU, [`${LAGAR}/vinha`])).toBeNull()
    expect(somDoCanal(aoVivo({ payload: { t: "message", room: "olival" } }), EU, [`${LAGAR}/vinha`])).toBe("canal")
    // The default room mutes with the key `canal/`.
    expect(somDoCanal(aoVivo({ payload: { t: "message" } }), EU, [`${LAGAR}/`])).toBeNull()
    expect(somDoCanal(aoVivo(), EU, [ADEGA])).toBe("canal")
  })
})

/* -------------------------------------------------------------- o motor */

function relogioFalso(): Relogio & { avancar(ms: number): void } {
  let t = 10_000
  return {
    agora: () => t,
    depois: () => () => {},
    avancar(ms: number) {
      t += ms
    },
  }
}

const ESTADO: EstadoDoSom = { ligado: true, volume: 50, actividade: "online", som: PREFERENCIAS_DE_SOM_POR_OMISSAO }

function montar(sobre: { estado?: Partial<EstadoDoSom>; ambiente?: Partial<Ambiente> } = {}) {
  const relogio = relogioFalso()
  const tocados: { tipo: TipoDeSom; amplitude: number }[] = []
  const vibracoes: number[][] = []
  let estado: EstadoDoSom = { ...ESTADO, ...sobre.estado }
  const motor = criarMotor({
    saida: {
      tocar: (tipo, amplitude) => {
        tocados.push({ tipo, amplitude })
        return true
      },
      calar: () => {},
      vibrar: (padrao) => void vibracoes.push([...padrao]),
      preparar: () => {},
    },
    lerEstado: () => estado,
    relogio,
    ambiente: {
      canalAberto: () => LAGAR,
      salaAberta: () => "vinha",
      janelaAFrente: () => true,
      visivel: () => true,
      houveGesto: () => true,
      ...sobre.ambiente,
    },
  })
  return { motor, relogio, tocados, vibracoes, mudar: (patch: Partial<EstadoDoSom>) => void (estado = { ...estado, ...patch }) }
}

describe("o motor e o som do canal", () => {
  it("a sala aberta com a janela à frente não toca: basta ver a mensagem", () => {
    const { motor, tocados } = montar()
    expect(motor.tocar({ tipo: "canal", canal: LAGAR, sala: "vinha" })).toBe("a-ver")
    expect(tocados).toEqual([])
  })

  it("outra sala do canal aberto toca; outro canal toca", () => {
    const { motor, relogio, tocados } = montar()
    expect(motor.tocar({ tipo: "canal", canal: LAGAR, sala: "olival" })).toBe("tocou")
    relogio.avancar(1_000)
    expect(motor.tocar({ tipo: "canal", canal: ADEGA, sala: "vinha" })).toBe("tocou")
    expect(tocados.map((som) => som.tipo)).toEqual(["canal", "canal"])
  })

  it("a sala aberta com a janela atrás toca", () => {
    const { motor } = montar({ ambiente: { janelaAFrente: () => false } })
    expect(motor.tocar({ tipo: "canal", canal: LAGAR, sala: "vinha" })).toBe("tocou")
  })

  it("no mesmo canal, no máximo um som a cada 3 s", () => {
    expect(RAJADA_POR_CANAL_MS.canal).toBe(3000)
    const { motor, relogio, tocados } = montar({ ambiente: { canalAberto: () => null } })
    expect(motor.tocar({ tipo: "canal", canal: LAGAR, sala: "vinha" })).toBe("tocou")
    relogio.avancar(1_500)
    expect(motor.tocar({ tipo: "canal", canal: LAGAR, sala: "olival" })).toBe("rajada")
    relogio.avancar(1_499)
    expect(motor.tocar({ tipo: "canal", canal: LAGAR, sala: "vinha" })).toBe("rajada")
    relogio.avancar(1)
    expect(motor.tocar({ tipo: "canal", canal: LAGAR, sala: "vinha" })).toBe("tocou")
    expect(tocados).toHaveLength(2)
  })

  it("entre todos os canais, no máximo um som por segundo", () => {
    expect(RAJADA_MS.canal).toBe(1000)
    const { motor, relogio, tocados } = montar({ ambiente: { canalAberto: () => null } })
    expect(motor.tocar({ tipo: "canal", canal: LAGAR })).toBe("tocou")
    relogio.avancar(999)
    expect(motor.tocar({ tipo: "canal", canal: ADEGA })).toBe("rajada")
    relogio.avancar(1)
    expect(motor.tocar({ tipo: "canal", canal: ADEGA })).toBe("tocou")
    expect(tocados).toHaveLength(2)
  })

  it("um som calado pela rajada não conta para o limite do canal", () => {
    const { motor, relogio } = montar({ ambiente: { canalAberto: () => null } })
    motor.tocar({ tipo: "canal", canal: LAGAR })
    relogio.avancar(500)
    expect(motor.tocar({ tipo: "canal", canal: ADEGA })).toBe("rajada")
    relogio.avancar(600)
    // The gate did not play for 600 ms: only 1.1 s passed since the last sound, and it plays.
    expect(motor.tocar({ tipo: "canal", canal: ADEGA })).toBe("tocou")
  })

  it('"Ocupado", "Invisível", a pausa, o interruptor geral e o do tipo calam', () => {
    const casos: [Partial<EstadoDoSom>, string][] = [
      [{ actividade: "ocupado" }, "actividade"],
      [{ actividade: "invisivel" }, "actividade"],
      [{ pausaAte: 20_000 }, "pausa"],
      [{ ligado: false }, "desligado"],
      [{ som: { ...PREFERENCIAS_DE_SOM_POR_OMISSAO, porTipo: { ...PREFERENCIAS_DE_SOM_POR_OMISSAO.porTipo, canal: false } } }, "tipo-desligado"],
    ]
    for (const [estado, motivo] of casos) {
      const { motor, tocados } = montar({ estado, ambiente: { canalAberto: () => null } })
      expect(motor.tocar({ tipo: "canal", canal: LAGAR }), motivo).toBe(motivo)
      expect(tocados, motivo).toEqual([])
    }
    // "Away" does not mute, and a pause that already ended does not either.
    for (const estado of [{ actividade: "ausente" as const }, { pausaAte: 5_000 }]) {
      const { motor } = montar({ estado, ambiente: { canalAberto: () => null } })
      expect(motor.tocar({ tipo: "canal", canal: LAGAR })).toBe("tocou")
    }
  })

  it("o som do canal não vibra", () => {
    const { motor, vibracoes } = montar({ ambiente: { canalAberto: () => null } })
    motor.tocar({ tipo: "canal", canal: LAGAR })
    expect(VIBRACAO.canal).toEqual([])
    expect(vibracoes).toEqual([])
  })
})

describe("o motor e a menção", () => {
  it("com a conversa à vista e a janela à frente, a menção toca na mesma, a metade", () => {
    const { motor, tocados } = montar()
    expect(motor.tocar({ tipo: "mencao", canal: LAGAR })).toBe("tocou")
    expect(tocados[0]?.amplitude).toBeCloseTo(amplitudeDe(50) * MENCAO_A_VER, 6)
  })

  it("noutra sala do canal aberto, a menção toca inteira; na sala aberta, a metade", () => {
    const { motor, relogio, tocados } = montar()
    motor.tocar({ tipo: "mencao", canal: LAGAR, sala: "olival" })
    relogio.avancar(2_000)
    motor.tocar({ tipo: "mencao", canal: LAGAR, sala: "vinha" })
    expect(tocados.map((som) => som.amplitude)).toEqual([amplitudeDe(50), amplitudeDe(50) * MENCAO_A_VER])
  })

  it("fora da vista, a menção toca inteira", () => {
    const { motor, tocados } = montar({ ambiente: { canalAberto: () => ADEGA } })
    expect(motor.tocar({ tipo: "mencao", canal: LAGAR })).toBe("tocou")
    expect(tocados[0]?.amplitude).toBeCloseTo(amplitudeDe(50), 6)
  })

  it("com a janela atrás, a menção toca inteira", () => {
    const { motor, tocados } = montar({ ambiente: { janelaAFrente: () => false } })
    motor.tocar({ tipo: "mencao", canal: LAGAR })
    expect(tocados[0]?.amplitude).toBeCloseTo(amplitudeDe(50), 6)
  })

  it('a menção cala com "Ocupado", "Invisível" e a pausa, como as outras mensagens', () => {
    for (const estado of [{ actividade: "ocupado" as const }, { actividade: "invisivel" as const }, { pausaAte: 20_000 }]) {
      const { motor, tocados } = montar({ estado })
      expect(motor.tocar({ tipo: "mencao", canal: LAGAR })).not.toBe("tocou")
      expect(tocados).toEqual([])
    }
  })

  it("a menção e o som do canal não se travam um ao outro: limites separados", () => {
    const { motor } = montar({ ambiente: { canalAberto: () => null } })
    expect(motor.tocar({ tipo: "canal", canal: LAGAR })).toBe("tocou")
    expect(motor.tocar({ tipo: "mencao", canal: LAGAR })).toBe("tocou")
  })
})

/* ------------------------------------------------------------ the family */

const notasDe = (tipo: TipoDeSom): number[] => SONS[tipo].notas.map((nota) => ESCALA[nota.nota])

describe("os sons: o do canal e o da menção", () => {
  it("o do canal é mais discreto do que a directa e a menção, e mais do que a publicação", () => {
    expect(SONS.canal.presenca).toBeLessThan(SONS.directa.presenca)
    expect(SONS.canal.presenca).toBeLessThan(SONS.mencao.presenca)
    expect(SONS.canal.presenca).toBeGreaterThan(SONS.publicacao.presenca)
  })

  it("o do canal não se confunde com o da directa nem com o de enviar: mais grave do que os dois", () => {
    expect(Math.max(...notasDe("canal"))).toBeLessThan(Math.min(...notasDe("directa")))
    expect(Math.max(...notasDe("canal"))).toBeLessThan(Math.min(...notasDe("enviada")))
    expect(notasDe("canal")).not.toEqual(notasDe("directa"))
    expect(notasDe("canal")).not.toEqual(notasDe("enviada"))
  })

  it("a menção tem três notas e a directa duas: ritmos diferentes", () => {
    expect(SONS.mencao.notas).toHaveLength(3)
    expect(SONS.directa.notas).toHaveLength(2)
    // Since 3/11/2026 (owner request: more inspired by MSN) the mention goes up
    // in three notes and the private message goes down in two: different directions too.
    const [a, b, c] = notasDe("mencao")
    expect(b).toBeGreaterThan(a ?? 0)
    expect(c).toBeGreaterThan(b ?? 0)
    const [d1, d2] = notasDe("directa")
    expect(d2).toBeLessThan(d1 ?? 0)
  })
})

/* ------------------------------------------------------ o interruptor */

describe('o interruptor "Som das mensagens nos canais"', () => {
  it("ligado de fábrica", () => {
    expect(PREFERENCIAS_DE_SOM_POR_OMISSAO.porTipo.canal).toBe(true)
  })

  it("quem já tem escolhas guardadas, sem esta chave, recebe-o ligado e fica com as dele", () => {
    const guardado = JSON.stringify({ porTipo: { directa: false, mencao: true }, vibrar: false })
    const lidas = lerPreferenciasDeSom({ getItem: (chave) => (chave === CHAVE_DOS_SONS ? guardado : null) })
    expect(lidas.porTipo.canal).toBe(true)
    expect(lidas.porTipo.directa).toBe(false)
    expect(lidas.vibrar).toBe(false)
  })

  it("desligado fica desligado", () => {
    const guardado = JSON.stringify({ porTipo: { canal: false } })
    const lidas = lerPreferenciasDeSom({ getItem: () => guardado })
    expect(lidas.porTipo.canal).toBe(false)
  })
})
