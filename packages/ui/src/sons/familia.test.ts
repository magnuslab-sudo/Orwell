import { describe, expect, it } from "vitest"
import {
  ABAFAR_S,
  CAUDA_S,
  CLIQUE,
  ECOS,
  ESCALA,
  PARCIAIS,
  SONS,
  TIPOS_DE_SOM,
  duracaoDasNotas,
  montarSom,
  normalizar,
  renderizar,
  type CriarContextoOffline,
  type TipoDeSom,
} from "./familia.js"

/** The frequencies of a sound, in order. */
const notasDe = (tipo: TipoDeSom): number[] => SONS[tipo].notas.map((nota) => ESCALA[nota.nota])

describe("a família: uma escala, uma duração, uma régua", () => {
  it("todas as notas estão na escala, entre 400 Hz e 1,5 kHz, menos o Ré4 da cotovelada", () => {
    for (const tipo of TIPOS_DE_SOM) {
      for (const [i, hz] of notasDe(tipo).entries()) {
        expect(Object.values(ESCALA)).toContain(hz)
        expect(hz).toBeLessThan(1500)
        if (SONS[tipo].notas[i]?.nota === "D4") continue
        expect(hz, tipo).toBeGreaterThan(400)
      }
    }
  })

  /*
    11/3/2026, owner request: more inspired by MSN. D4, E6, and F#6
    entered the scale with the new figures, and stay in the D pentatonic.
  */
  it("a escala é Ré maior pentatónica: Ré, Mi, Fá#, Lá e Si, e mais nenhuma", () => {
    for (const nota of Object.keys(ESCALA)) expect(["D", "E", "F#", "A", "B"]).toContain(nota.slice(0, -1))
  })

  it("o Ré4 grave nunca soa sozinho: só na cotovelada, debaixo das outras batidas", () => {
    for (const tipo of TIPOS_DE_SOM) {
      const graves = SONS[tipo].notas.filter((nota) => nota.nota === "D4")
      if (tipo !== "cotovelada") expect(graves, tipo).toHaveLength(0)
    }
    const [grave, ...batidas] = SONS.cotovelada.notas
    expect(grave?.nota).toBe("D4")
    for (const batida of batidas) expect(batida.em + batida.dur).toBeLessThanOrEqual((grave?.em ?? 0) + (grave?.dur ?? 0) + 0.2)
  })

  it("cada som dura entre 120 e 400 ms, menos os dois toques e a cotovelada", () => {
    for (const tipo of TIPOS_DE_SOM) {
      const duracao = duracaoDasNotas(SONS[tipo])
      if (tipo === "chamada" || tipo === "a-chamar" || tipo === "cotovelada") continue
      expect(duracao, tipo).toBeGreaterThanOrEqual(0.12)
      expect(duracao, tipo).toBeLessThanOrEqual(0.4)
    }
    // The nudge is ten taps of 45 em 45 ms: does not fit in 400 ms, but it is a shake, not a touch.
    expect(duracaoDasNotas(SONS.cotovelada)).toBeLessThanOrEqual(0.7)
  })

  it("o toque da chamada é mais longo, mais claro, e repete", () => {
    const chamada = SONS.chamada
    expect(duracaoDasNotas(chamada)).toBeGreaterThan(0.4)
    expect(chamada.periodo).toBeGreaterThan(duracaoDasNotas(chamada))
    for (const tipo of TIPOS_DE_SOM) {
      if (tipo !== "chamada") expect(SONS[tipo].presenca, tipo).toBeLessThan(chamada.presenca)
      if (tipo !== "chamada" && tipo !== "a-chamar") expect(SONS[tipo].periodo, tipo).toBeUndefined()
    }
  })

  it("o toque a sair também repete, mais baixo do que o toque a entrar: quem ligou está a olhar", () => {
    const aChamar = SONS["a-chamar"]
    expect(aChamar.periodo).toBeGreaterThan(duracaoDasNotas(aChamar))
    expect(aChamar.presenca).toBeLessThan(SONS.chamada.presenca)
  })

  it("a publicação é o som mais discreto de todos", () => {
    for (const tipo of TIPOS_DE_SOM) {
      if (tipo !== "publicacao") expect(SONS[tipo].presenca, tipo).toBeGreaterThan(SONS.publicacao.presenca)
    }
  })

  it("as entradas e saídas da sala de voz ficam abaixo das mensagens: ouvem-se dezenas de vezes", () => {
    expect(SONS.entrou.presenca).toBeLessThan(SONS.directa.presenca)
    expect(SONS.saiu.presenca).toBeLessThan(SONS.directa.presenca)
  })

  it("não há dois sons iguais: cada um reconhece-se de olhos fechados", () => {
    const assinaturas = TIPOS_DE_SOM.map((tipo) =>
      SONS[tipo].notas.map((nota) => `${nota.nota}@${nota.em.toFixed(2)}`).join(" "),
    )
    expect(new Set(assinaturas).size).toBe(TIPOS_DE_SOM.length)
  })
})

describe("o contorno diz o que é", () => {
  it("quem entra sobe, quem sai desce, e a figura é a mesma ao contrário", () => {
    const [a, b] = notasDe("entrou")
    expect(b).toBeGreaterThan(a ?? 0)
    expect(notasDe("saiu")).toEqual([...notasDe("entrou")].reverse())
  })

  it("a ligação de pé são três degraus a subir uma oitava", () => {
    const [a, b, c] = notasDe("ligado")
    expect(b).toBeGreaterThan(a ?? 0)
    expect(c).toBeGreaterThan(b ?? 0)
    expect((c ?? 0) / (a ?? 1)).toBeCloseTo(2, 1)
  })

  it("o pedido acaba no Lá (à espera), o aceite acaba no Ré (resolvido)", () => {
    expect(SONS.pedido.notas.at(-1)?.nota).toBe("A5")
    expect(SONS.aceite.notas.at(-1)?.nota.startsWith("D")).toBe(true)
  })

  /*
    11/3/2026, owner request: the direct message now descends (E6 → B5) and the
    mention rises over three notes up to F#6.
  */
  it("a directa é um «tlim-tlão» a descer no topo da escala: Mi6 → Si5", () => {
    expect(SONS.directa.notas.map((nota) => [nota.nota, nota.em])).toEqual([
      ["E6", 0],
      ["B5", 0.11],
    ])
  })

  it("a menção sobe em três notas até à mais aguda da família: Si5 → Ré6 → Fá#6", () => {
    expect(SONS.mencao.notas.map((nota) => [nota.nota, nota.em])).toEqual([
      ["B5", 0],
      ["D6", 0.08],
      ["F#6", 0.16],
    ])
    expect(Math.max(...notasDe("mencao"))).toBe(Math.max(...Object.values(ESCALA)))
    expect(Math.max(...notasDe("mencao"))).toBeGreaterThan(Math.max(...notasDe("directa")))
  })

  it("a menção não é o aceite: a mesma forma, uma terça acima, e as notas ficam a soar", () => {
    expect(Math.min(...notasDe("mencao"))).toBeGreaterThan(Math.min(...notasDe("aceite")))
    const primeira = (tipo: TipoDeSom) => SONS[tipo].notas[0]?.dur ?? 0
    expect(primeira("mencao")).toBeGreaterThan(primeira("aceite") * 2)
  })

  it("o toque da chamada é Lá5 → Fá#5 → Lá5 → Ré6 de 140 em 140 ms, duas vezes", () => {
    const notas = SONS.chamada.notas
    expect(notas).toHaveLength(8)
    for (const [r, inicio] of [0, 1.1].entries()) {
      const figura = notas.slice(r * 4, r * 4 + 4)
      expect(figura.map((nota) => nota.nota)).toEqual(["A5", "F#5", "A5", "D6"])
      for (const [i, nota] of figura.entries()) expect(nota.em).toBeCloseTo(inicio + i * 0.14, 9)
    }
  })

  /*
    Owner request (2 November 2026, point 3): one sound when muting and
    another when unmuting, like Discord. Two pairs: for the microphone and for
    "mute all", lower pitched, to tell them apart with eyes closed.
  */
  it("silenciar desce, voltar sobe, e cada par é a mesma figura ao contrário", () => {
    for (const [calar, voltar] of [
      ["mic-silenciado", "mic-ligado"],
      ["tudo-silenciado", "tudo-ligado"],
    ] as const) {
      const [a, b] = notasDe(calar)
      expect(b, calar).toBeLessThan(a ?? 0)
      expect(notasDe(voltar)).toEqual([...notasDe(calar)].reverse())
    }
  })

  it('o par de "silenciar tudo" é mais grave do que o do microfone', () => {
    expect(Math.max(...notasDe("tudo-silenciado"))).toBeLessThan(Math.max(...notasDe("mic-silenciado")))
  })

  it("o amigo online sobe o arpejo de Ré uma oitava, e fica abaixo das mensagens: é um aviso, não um pedido", () => {
    expect(SONS["amigo-online"].notas.map((nota) => [nota.nota, nota.em])).toEqual([
      ["D5", 0],
      ["F#5", 0.07],
      ["A5", 0.14],
      ["D6", 0.21],
    ])
    expect(SONS["amigo-online"].presenca).toBeLessThan(SONS.directa.presenca)
  })

  it("a actualização não é o amigo online: outro contorno (quartas e o Lá repetido) e outro ritmo", () => {
    const [a, b, c, d] = SONS.actualizacao.notas
    expect([a, b, c, d].map((nota) => nota?.nota)).toEqual(["B4", "E5", "A5", "A5"])
    expect(SONS.actualizacao.notas.at(-1)?.nota).toBe("A5")
    const passos = (tipo: TipoDeSom) => SONS[tipo].notas.slice(1).map((nota, i) => +(nota.em - (SONS[tipo].notas[i]?.em ?? 0)).toFixed(3))
    expect(passos("actualizacao")).not.toEqual(passos("amigo-online"))
  })

  /*
    Parity of moments with Discord (3 November 2026): seven figures
    from this family, none copied from Discord.
  */
  it("o toque a sair é um acorde parado: duas notas juntas, duas vezes, sem subir nem descer", () => {
    const notas = SONS["a-chamar"].notas
    const instantes = [...new Set(notas.map((nota) => nota.em))]
    expect(instantes).toHaveLength(2)
    for (const em of instantes) {
      expect(notas.filter((nota) => nota.em === em).map((nota) => nota.nota)).toEqual(["D5", "F#5"])
    }
  })

  it("a ligação perdida desce em três degraus até à nota mais grave, e acaba no Lá: pede um gesto", () => {
    const [a, b, c] = notasDe("voz-perdida")
    expect(b).toBeLessThan(a ?? 0)
    expect(c).toBeLessThan(b ?? 0)
    // The lowest of the melodic sounds: D4 exists only under the elbow nudge (11/3/2026).
    expect(c).toBe(Math.min(...Object.entries(ESCALA).filter(([nota]) => nota !== "D4").map(([, hz]) => hz)))
    expect(SONS["voz-perdida"].notas.at(-1)?.nota).toBe("A4")
    // Descends further than "left", which is the exit by gesture.
    expect((a ?? 0) / (c ?? 1)).toBeGreaterThan(notasDe("saiu")[0]! / notasDe("saiu")[1]!)
  })

  it("ser movido é o «saiu» e o «entrou» numa figura: desce e volta a subir", () => {
    const [a, b, c] = notasDe("movido")
    expect([a, b]).toEqual(notasDe("saiu"))
    expect([b, c]).toEqual(notasDe("entrou"))
  })

  it("a transmissão sobe uma oitava a começar e desce a acabar", () => {
    const [a, b] = notasDe("transmissao-iniciada")
    expect((b ?? 0) / (a ?? 1)).toBeCloseTo(2, 5)
    expect(notasDe("transmissao-terminada")).toEqual([...notasDe("transmissao-iniciada")].reverse())
  })

  it("quem vê a minha transmissão sobe, quem deixa de ver desce, mais leve do que quem entra na sala", () => {
    const [a, b] = notasDe("espectador-entrou")
    expect(b).toBeGreaterThan(a ?? 0)
    expect(notasDe("espectador-saiu")).toEqual([...notasDe("espectador-entrou")].reverse())
    expect(SONS["espectador-entrou"].presenca).toBeLessThan(SONS.entrou.presenca)
  })

  it("a cotovelada treme: Ré5 e Lá4 alternados de 45 em 45 ms, dez batidas, sobre um Ré4", () => {
    const [grave, ...batidas] = SONS.cotovelada.notas
    expect(grave).toMatchObject({ nota: "D4", em: 0 })
    expect(batidas).toHaveLength(10)
    for (const [i, batida] of batidas.entries()) {
      expect(batida.nota).toBe(i % 2 === 0 ? "D5" : "A4")
      expect(batida.em).toBeCloseTo(i * 0.045, 9)
    }
  })
})

/* -------------------------------------------------- a fake offline context */

interface Parametro {
  value: number
  chamadas: [string, number, number][]
  setValueAtTime(v: number, t: number): void
  linearRampToValueAtTime(v: number, t: number): void
  exponentialRampToValueAtTime(v: number, t: number): void
}

function parametro(): Parametro {
  const p: Parametro = {
    value: 0,
    chamadas: [],
    setValueAtTime: (v, t) => void p.chamadas.push(["set", v, t]),
    linearRampToValueAtTime: (v, t) => void p.chamadas.push(["linear", v, t]),
    exponentialRampToValueAtTime: (v, t) => void p.chamadas.push(["exp", v, t]),
  }
  return p
}

function contextoFalso() {
  const osciladores: { type: string; frequency: Parametro; start: number }[] = []
  const atrasos: Parametro[] = []
  const baquetas: { buffer: unknown; start: number }[] = []
  const envelopes: Parametro[] = []
  const no = () => ({ connect: (destino: unknown) => destino })
  const contexto = {
    sampleRate: 8000,
    destination: {},
    createGain: () => {
      const gain = parametro()
      envelopes.push(gain)
      return { ...no(), gain }
    },
    createDelay: () => {
      const delayTime = parametro()
      atrasos.push(delayTime)
      return { ...no(), delayTime }
    },
    createBufferSource: () => {
      const baqueta = { buffer: null as unknown, start: -1 }
      baquetas.push(baqueta)
      return {
        ...no(),
        set buffer(valor: unknown) {
          baqueta.buffer = valor
        },
        start: (t: number) => {
          baqueta.start = t
        },
      }
    },
    createBuffer: (canais: number, comprimento: number) => {
      const dados = Array.from({ length: canais }, () => new Float32Array(comprimento))
      return { numberOfChannels: canais, getChannelData: (c: number) => dados[c] }
    },
    createOscillator: () => {
      const oscilador = { ...no(), type: "", frequency: parametro(), start: -1 }
      osciladores.push(oscilador)
      return {
        ...oscilador,
        set type(valor: string) {
          oscilador.type = valor
        },
        frequency: oscilador.frequency,
        start: (t: number) => {
          oscilador.start = t
        },
        stop: () => {},
      }
    },
  }
  return { contexto: contexto as unknown as BaseAudioContext, osciladores, atrasos, baquetas, envelopes }
}

/*
  The timbre is a marimba (3/11/2026, owner request: more inspired by MSN).
  The fixed numbers here are from the test the owner heard and chose.
*/
describe("o timbre: a mesma marimba em todos os sons", () => {
  it("os parciais da lâmina: a fundamental, 3,93× e 9,2×, cada um a calar-se mais depressa", () => {
    expect(PARCIAIS).toEqual([
      { multiplo: 1, ganho: 1, ataque: 0.002, tau: 0.32 },
      { multiplo: 3.93, ganho: 0.35, ataque: 0.001, tau: 0.06 },
      { multiplo: 9.2, ganho: 0.12, ataque: 0.0005, tau: 0.02 },
    ])
    expect(CLIQUE).toEqual({ ganho: 0.08, tau: 0.003 })
  })

  it("cada nota é um feixe de sinusoides, um por parcial, com a fundamental primeiro, e uma baqueta", () => {
    for (const tipo of TIPOS_DE_SOM) {
      const { contexto, osciladores, baquetas } = contextoFalso()
      montarSom(contexto, SONS[tipo])
      // The e2e scripts (`e2e-sons-*.mjs`) recognize the sound by the fundamental of each three oscillators.
      expect(osciladores).toHaveLength(SONS[tipo].notas.length * PARCIAIS.length)
      for (const oscilador of osciladores) expect(oscilador.type).toBe("sine")
      const fundamentais = osciladores.filter((_, i) => i % PARCIAIS.length === 0).map((o) => o.frequency.value)
      expect(fundamentais, tipo).toEqual(notasDe(tipo))
      expect(baquetas.map((b) => b.start), tipo).toEqual(SONS[tipo].notas.map((nota) => nota.em))
      expect(new Set(baquetas.map((b) => b.buffer)).size).toBe(1)
    }
  })

  it("a sala são cinco ecos curtos, de 31 a 163 ms, e cabem na cauda", () => {
    const { contexto, atrasos } = contextoFalso()
    montarSom(contexto, SONS.directa)
    expect(atrasos.map((a) => a.value)).toEqual([0.031, 0.047, 0.071, 0.113, 0.163])
    expect(ECOS.map((eco) => eco.ganho)).toEqual([0.32, 0.26, 0.2, 0.14, 0.09])
    expect(CAUDA_S).toBeGreaterThanOrEqual(Math.max(...ECOS.map((eco) => eco.atraso)))
  })

  it("cada parcial: ataque rápido, queda exponencial com o seu tau, abafado no fim da nota", () => {
    const { contexto, envelopes } = contextoFalso()
    montarSom(contexto, SONS.directa)
    const comEnvelope = envelopes.filter((p) => p.chamadas.length > 0)
    expect(comEnvelope).toHaveLength(SONS.directa.notas.length * PARCIAIS.length)
    for (const [i, envelope] of comEnvelope.entries()) {
      const nota = SONS.directa.notas[Math.floor(i / PARCIAIS.length)]!
      const parcial = PARCIAIS[i % PARCIAIS.length]!
      const fim = nota.em + nota.dur
      const [inicio, subida, queda, abafar] = envelope.chamadas
      expect(inicio).toEqual(["set", 0, nota.em])
      expect(subida?.[0]).toBe("linear")
      expect(subida?.[1]).toBeCloseTo(nota.ganho * parcial.ganho, 9)
      expect((subida?.[2] ?? 0) - nota.em).toBeCloseTo(parcial.ataque, 9)
      // The exponential ramp from one value to another is exactly exp(-t/tau).
      expect(queda?.[0]).toBe("exp")
      const tau = ((queda?.[2] ?? 0) - (subida?.[2] ?? 0)) / Math.log((subida?.[1] ?? 1) / (queda?.[1] ?? 1))
      if ((queda?.[1] ?? 0) > 1e-7) expect(tau).toBeCloseTo(parcial.tau, 6)
      expect(queda?.[2]).toBeCloseTo(fim - ABAFAR_S, 9)
      // Muted: reaches zero at the end of the note, and nothing plays after `dur`.
      expect(abafar).toEqual(["linear", 0, fim])
    }
  })

  it("renderizado, o pico de cada som é a sua presença", async () => {
    const criar: CriarContextoOffline = (canais, comprimento) => {
      const { contexto } = contextoFalso()
      const buffer = (contexto as unknown as { createBuffer: (c: number, n: number) => AudioBuffer }).createBuffer(
        canais,
        comprimento,
      )
      buffer.getChannelData(0)[10] = 0.31
      buffer.getChannelData(1)[20] = -0.62
      return Object.assign(contexto, { startRendering: async () => buffer }) as unknown as OfflineAudioContext
    }
    const buffer = await renderizar("pedido", criar)
    expect(buffer).not.toBeNull()
    const pico = Math.max(...[0, 1].flatMap((c) => [...(buffer?.getChannelData(c) ?? [])].map(Math.abs)))
    expect(pico).toBeCloseTo(SONS.pedido.presenca, 5)
  })

  it("sem Web Audio, renderizar devolve null e não rebenta", async () => {
    await expect(renderizar("directa", null)).resolves.toBeNull()
  })

  it("normalizar um silêncio deixa-o em silêncio", () => {
    const dados = new Float32Array(4)
    const buffer = { numberOfChannels: 1, getChannelData: () => dados } as unknown as AudioBuffer
    normalizar(buffer, 0.7)
    expect([...dados]).toEqual([0, 0, 0, 0])
  })
})
