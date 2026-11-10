/**
 * Microphone sensitivity in manual mode, measured with synthetic audio.
 *
 * The code is in the worklet (`processador-de-voz.ts`). How it works: above
 * the line, voice passes; below it, digital silence (exact zeros for Opus DTX)
 * emerges. The hysteresis and timings follow the auto gate, the line shifts
 * mid-block without recreating anything, and the level compared is after
 * suppression.
 */
import { describe, expect, it } from "vitest"
import * as S from "../../testes/audio-sintetico.js"
import { CONFIGURACAO_DO_PERFIL, ETAPAS_DESLIGADAS } from "./perfis.js"
import { CadeiaDeVoz, MotorGtcrn, type ConfiguracaoDaCadeia, type MedidasDaCadeia } from "./processador-de-voz.js"

const NORMAL = CONFIGURACAO_DO_PERFIL.normal
const T = S.TAXA

/** A 440 Hz sine with RMS at `db` dBFS. */
function tom(segundos: number, db: number, fase = 0): Float32Array {
  const amplitude = Math.SQRT2 * 10 ** (db / 20)
  return new Float32Array(Math.round(segundos * T)).map((_, i) => amplitude * Math.sin((2 * Math.PI * 440 * (i + fase)) / T))
}

function juntar(...partes: Float32Array[]): Float32Array {
  const total = new Float32Array(partes.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const parte of partes) {
    total.set(parte, i)
    i += parte.length
  }
  return total
}

async function correr(
  config: ConfiguracaoDaCadeia,
  x: Float32Array,
  opcoes: { motor?: boolean; aoBloco?: (cadeia: CadeiaDeVoz, inicio: number) => void } = {},
) {
  const cadeia = new CadeiaDeVoz(T, config)
  if (opcoes.motor) cadeia.usarMotor(await MotorGtcrn.criar(S.binarioGtcrn(), T))
  const y = new Float32Array(x.length)
  /** `vozAtiva` at the end of each block to measure gate timings. */
  const aberto: boolean[] = []
  let medidas: MedidasDaCadeia | null = null
  for (let i = 0; i + S.BLOCO <= x.length; i += S.BLOCO) {
    opcoes.aoBloco?.(cadeia, i)
    cadeia.processar(x.subarray(i, i + S.BLOCO), y.subarray(i, i + S.BLOCO))
    medidas = cadeia.medidas()
    aberto.push(medidas.vozAtiva)
  }
  const atraso = cadeia.atraso
  cadeia.destruir()
  /**
   * The detector sees sound after suppression, which delays it by `atraso - 128`
   * samples. The gain it decides at index `i` applies to the output at the same
   * index (the 128-sample lookahead is that). `aberto` is at that time.
   */
  return { y, aberto, atraso, doDetector: atraso - S.BLOCO, medidas: medidas! }
}

const rmsDb = (x: Float32Array): number => 10 * Math.log10(Math.max(1e-30, S.potencia(x) / Math.max(1, x.length)))
const tudoZero = (x: Float32Array): boolean => x.every((v) => v === 0)
/** The block where `open` changes to `value` starting from `since` (samples). */
function quandoFica(aberto: boolean[], valor: boolean, desde: number): number {
  for (let b = Math.floor(desde / S.BLOCO); b < aberto.length; b++) if (aberto[b] === valor) return b * S.BLOCO
  return Infinity
}

describe("sensibilidade manual do microfone", () => {
  it("um tom acima da linha passa, e o medidor mostra o nível que o gate compara", async () => {
    const r = await correr({ ...NORMAL, limiarDb: -45 }, tom(2, -30))
    expect(r.medidas.vozAtiva).toBe(true)
    expect(r.medidas.portaoDb).toBeGreaterThan(-31)
    expect(r.medidas.portaoDb).toBeLessThan(-29)
    // AGC takes voice close to -21 dBFS: it passed, and in full.
    expect(rmsDb(r.y.subarray(T))).toBeGreaterThan(-30)

    // The measured level already includes input volume: double is +6 dB on the bar.
    const comGanho = await correr({ ...NORMAL, limiarDb: -45, ganhoDeEntrada: 2 }, tom(1, -30))
    expect(comGanho.medidas.portaoDb).toBeGreaterThan(-25)
    expect(comGanho.medidas.portaoDb).toBeLessThan(-23)
  })

  it("ruído abaixo da linha sai em silêncio digital; no automático continua a -30 dB", async () => {
    const ruido = S.normalizar(S.ruido("branco", T * 3), -55)
    const manual = await correr({ ...NORMAL, limiarDb: -45 }, ruido)
    expect(manual.medidas.vozAtiva).toBe(false)
    expect(tudoZero(manual.y.subarray(T))).toBe(true)

    // Automatic does not change: floor at -30 dB, never zeros.
    const automatico = await correr(NORMAL, ruido)
    const resto = automatico.y.subarray(T)
    expect(tudoZero(resto)).toBe(false)
    expect(rmsDb(resto)).toBeGreaterThan(-100)
  })

  it('a linha liga o gate mesmo com a etapa "gate" desligada (e com o perfil "Desligado")', async () => {
    const ruido = S.normalizar(S.ruido("branco", T * 2), -60)
    const r = await correr({ ...NORMAL, etapas: ETAPAS_DESLIGADAS, limiarDb: -40 }, ruido)
    expect(tudoZero(r.y.subarray(T))).toBe(true)
    const semLinha = await correr({ ...NORMAL, etapas: ETAPAS_DESLIGADAS }, ruido)
    expect(tudoZero(semLinha.y.subarray(T))).toBe(false)
  })

  it("histerese de 3 dB, segura 200 ms, e fecha suave até ao zero", async () => {
    // -30 (open), -46.5 (between line and line minus 3: stays open), -50 (closes).
    const x = juntar(tom(1, -30), tom(1, -46.5, T), tom(1.5, -50, 2 * T))
    const r = await correr({ ...NORMAL, limiarDb: -45 }, x)
    // In the hysteresis zone it does not close.
    const aDescer = 2 * T + r.doDetector
    expect(r.aberto.slice((1.1 * T + r.doDetector) / S.BLOCO, aDescer / S.BLOCO).every(Boolean)).toBe(true)
    expect(tudoZero(r.y.subarray(1.1 * T + r.atraso, 2 * T + r.atraso))).toBe(false)

    // Below hysteresis, closes after holding for 200 ms.
    const fecho = quandoFica(r.aberto, false, aDescer)
    const seguraMs = ((fecho - aDescer) / T) * 1000
    console.info(`gate manual: fecha ${seguraMs.toFixed(1)} ms depois de o nível descer`)
    expect(seguraMs).toBeGreaterThanOrEqual(195)
    expect(seguraMs).toBeLessThan(230)

    // Soft close: sound persists for 100 ms after closure, exact zeros before 0.8 s.
    const saidaDoFecho = fecho
    expect(tudoZero(r.y.subarray(saidaDoFecho + 0.1 * T, saidaDoFecho + 0.11 * T))).toBe(false)
    expect(tudoZero(r.y.subarray(saidaDoFecho + 0.8 * T))).toBe(true)
  })

  it("abre depressa: o início da palavra passa inteiro", async () => {
    // One second of silence (gate reaches zero), tone at -30.
    const x = juntar(new Float32Array(T), tom(1, -30))
    const r = await correr({ ...NORMAL, limiarDb: -45 }, x)
    expect(tudoZero(r.y.subarray(0.9 * T, T + r.atraso - 1))).toBe(true)
    const inicio = T + r.atraso
    const primeiros = rmsDb(r.y.subarray(inicio, inicio + 0.01 * T))
    const depois = rmsDb(r.y.subarray(inicio + 0.05 * T, inicio + 0.1 * T))
    console.info(`gate manual: primeiros 10 ms a ${(primeiros - depois).toFixed(2)} dB do nível seguinte`)
    expect(primeiros - depois).toBeGreaterThan(-3)
  })

  it("mudar a linha a meio aplica-se logo, na mesma cadeia", async () => {
    const x = tom(4, -30)
    const r = await correr({ ...NORMAL, limiarDb: -45 }, x, {
      aoBloco: (cadeia, inicio) => {
        if (inicio === Math.round(T / S.BLOCO) * S.BLOCO) cadeia.configurar({ ...NORMAL, limiarDb: -20 })
        if (inicio === Math.round((2.5 * T) / S.BLOCO) * S.BLOCO) cadeia.configurar({ ...NORMAL, limiarDb: -45 })
      },
    })
    expect(tudoZero(r.y.subarray(r.atraso + 0.5 * T, r.atraso + T))).toBe(false)
    expect(tudoZero(r.y.subarray(2 * T, 2.45 * T))).toBe(true)
    expect(r.medidas.vozAtiva).toBe(true)
    expect(rmsDb(r.y.subarray(3 * T))).toBeGreaterThan(-30)
  })

  it("mede depois da supressão: ruído que o modelo tira não abre o gate", async () => {
    // White noise at -40 dBFS, line at -50. Opens without suppression; closed with it.
    const ruido = S.normalizar(S.ruido("branco", T * 3), -40)
    const linha = -50
    const sem = await correr({ ...NORMAL, etapas: { ...NORMAL.etapas, supressao: false }, limiarDb: linha }, ruido, { motor: true })
    expect(sem.medidas.vozAtiva).toBe(true)
    const com = await correr({ ...NORMAL, limiarDb: linha }, ruido, { motor: true })
    console.info(`gate manual: ruído branco a -40 dBFS visto a ${com.medidas.portaoDb.toFixed(1)} dB depois da supressão`)
    expect(com.medidas.vozAtiva).toBe(false)
    expect(tudoZero(com.y.subarray(2 * T))).toBe(true)
  }, 60_000)
})
