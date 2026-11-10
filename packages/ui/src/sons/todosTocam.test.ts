import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { renderizar, TIPOS_DE_SOM, type CriarContextoOffline, type TipoDeSom } from "./familia.js"
import { criarMotor, criarSaidaWebAudio, estadoDoAparelho, type Motivo } from "./motor.js"

/**
 * All 27 sounds play for real, through the app's path (4/11/2026).
 *
 * Owner report in 1.3.0: "Sounds are not turning on. All of them. I hear
 * nothing. Only private messages." This test walks through each type with the
 * real engine (`criarMotor`, with rules), real output (`criarSaidaWebAudio`),
 * and real synthesis (`renderizar` and `montarSom`), reading preferences from
 * disk as 1.1.1 left them (`estadoDoAparelho`). Only the two audio contexts are
 * fake, and spied on:
 *
 * - the offline one stores each value set on a parameter (frequency, gain,
 *   ramp) and fails if any is not finite, or if an exponential ramp goes to
 *   zero or below (Web Audio throws, and sound is lost);
 * - the real-time one counts nodes created and each buffer's `start`.
 *
 * Any type that does not reach `start`, with a buffer and gain greater than
 * zero, fails here with the name and reason.
 */

/** The preferences web 1.1.1 left saved: without the channel and without the seven parity ones. */
const SONS_DA_111 = {
  porTipo: {
    directa: true,
    mencao: true,
    pedido: true,
    aceite: true,
    chamada: true,
    entrou: true,
    saiu: true,
    ligado: true,
    cotovelada: true,
    ticket: true,
    publicacao: true,
    actualizacao: true,
    "mic-silenciado": true,
    "mic-ligado": true,
    "tudo-silenciado": true,
    "tudo-ligado": true,
    "amigo-online": true,
    "sala-afk": true,
    enviada: true,
  },
  vibrar: true,
  chamadaComOcupado: true,
}
const PREFS_DA_111 = { chosen: true, activity: "online", sounds: true, soundVolume: 80, soundOff: false, silenciados: [] }

interface Valor {
  qual: string
  valor: number
}

/** An `OfflineAudioContext` that records the graph and returns a buffer with signal. */
function offlineEspiado(valores: Valor[]): CriarContextoOffline {
  return (canais, comprimento, taxa) => {
    const parametro = (nome: string) => ({
      set value(v: number) {
        valores.push({ qual: `${nome}.value`, valor: v })
      },
      setValueAtTime: (v: number, t: number) => void valores.push({ qual: `${nome}.set`, valor: v }, { qual: "tempo", valor: t }),
      linearRampToValueAtTime: (v: number, t: number) =>
        void valores.push({ qual: `${nome}.linear`, valor: v }, { qual: "tempo", valor: t }),
      exponentialRampToValueAtTime: (v: number, t: number) =>
        void valores.push({ qual: `${nome}.exp`, valor: v }, { qual: "tempo", valor: t }),
    })
    const no = () => ({ connect: (destino: unknown) => destino })
    const buffer = (n: number, len: number) => {
      const dados = Array.from({ length: n }, () => new Float32Array(len))
      return { numberOfChannels: n, length: len, sampleRate: taxa, getChannelData: (c: number) => dados[c]! }
    }
    let osciladores = 0
    const contexto = {
      sampleRate: taxa,
      destination: {},
      createGain: () => ({ ...no(), gain: parametro("ganho") }),
      createDelay: () => ({ ...no(), delayTime: parametro("atraso") }),
      createBuffer: (n: number, len: number) => buffer(n, len),
      createBufferSource: () => ({ ...no(), buffer: null, start: (t: number) => void valores.push({ qual: "tempo", valor: t }) }),
      createOscillator: () => {
        osciladores += 1
        return {
          ...no(),
          type: "",
          frequency: parametro("frequencia"),
          start: (t: number) => void valores.push({ qual: "tempo", valor: t }),
          stop: (t: number) => void valores.push({ qual: "tempo", valor: t }),
        }
      },
      // One signal per oscillator, so normalization has a peak to reach.
      startRendering: async () => {
        const feito = buffer(canais, comprimento)
        for (let i = 0; i < Math.min(osciladores, comprimento); i += 1) feito.getChannelData(0)[i] = 0.1
        return feito as unknown as AudioBuffer
      },
    }
    return contexto as unknown as OfflineAudioContext
  }
}

/** The real-time `AudioContext`, spied on: each `start` records the buffer and gain. */
function contextoEspiado() {
  const inicios: { buffer: AudioBuffer | null; ganho: number }[] = []
  const contexto = {
    state: "running",
    destination: {},
    resume: async () => {},
    createGain: () => ({ gain: { value: 1 }, connect: () => {} }),
    createBufferSource() {
      const fonte = {
        buffer: null as AudioBuffer | null,
        onended: null,
        ganho: null as { gain: { value: number } } | null,
        connect(destino: { gain: { value: number } }) {
          fonte.ganho = destino
        },
        start() {
          inicios.push({ buffer: fonte.buffer, ganho: fonte.ganho?.gain.value ?? Number.NaN })
        },
        stop: () => {},
      }
      return fonte
    },
  }
  return { contexto: contexto as unknown as AudioContext, inicios }
}

/** Each type through the path the app plays it. */
function tocarPeloCaminhoDaApp(motor: ReturnType<typeof criarMotor>, tipo: TipoDeSom): Motivo {
  if (tipo === "chamada") return motor.tocarChamada("!directa:casa.pt")
  if (tipo === "a-chamar") {
    const motivo = motor.chamar("!directa:casa.pt")
    motor.pararDeChamar()
    return motivo
  }
  return motor.tocar({ tipo, canal: tipo === "canal" || tipo === "mencao" || tipo === "directa" ? "!outro:casa.pt" : null })
}

const esperar = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem("enclave.sons", JSON.stringify(SONS_DA_111))
  localStorage.setItem("enclave.prefs", JSON.stringify(PREFS_DA_111))
})
afterEach(() => localStorage.clear())

describe("os 27 sons tocam pelo motor real, com as preferências de uma 1.1.1", () => {
  it("são 27", () => {
    expect(TIPOS_DE_SOM).toHaveLength(27)
  })

  for (const tipo of TIPOS_DE_SOM) {
    it(`${tipo}: as regras deixam, a síntese é válida, e chega ao altifalante`, async () => {
      const valores: Valor[] = []
      const { contexto, inicios } = contextoEspiado()
      const saida = criarSaidaWebAudio({
        criarContexto: () => contexto,
        renderizar: (t) => renderizar(t, offlineEspiado(valores)),
      })
      const motor = criarMotor({
        saida,
        lerEstado: estadoDoAparelho,
        ambiente: { canalAberto: () => null, janelaAFrente: () => false, visivel: () => true, houveGesto: () => true },
      })

      const motivo = tocarPeloCaminhoDaApp(motor, tipo)
      await esperar()
      await esperar()

      // Publishing comes off by default; here 1.1.1 left it on.
      expect(motivo, `${tipo}: o motor calou-o`).toBe("tocou")
      const invalidos = valores.filter((v) => !Number.isFinite(v.valor) || v.valor < 0)
      expect(invalidos, `${tipo}: valores inválidos na síntese`).toEqual([])
      const rampasAZero = valores.filter((v) => v.qual.endsWith(".exp") && v.valor <= 0)
      expect(rampasAZero, `${tipo}: rampa exponencial para zero`).toEqual([])
      expect(valores.some((v) => v.qual === "frequencia.value" && v.valor > 0), `${tipo}: sem osciladores`).toBe(true)
      expect(inicios, `${tipo}: nenhum nó chegou ao altifalante`).toHaveLength(1)
      expect(inicios[0]!.buffer, `${tipo}: sem buffer`).not.toBeNull()
      expect(inicios[0]!.ganho, `${tipo}: ganho`).toBeGreaterThan(0)
    })
  }
})
