/**
 * A number that is not a number cannot silence voice forever (4/11/2026).
 *
 * The voice chain has state everywhere: filters, envelopes, AGC,
 * suppression model state. Measured before this fix: one `NaN` at the engine
 * output poisoned all 128 samples of each block to `NaN` forever (4000 blocks
 * later, ~10 s, still all of them), and gtcrn fed with `Infinity` kept
 * outputting `NaN` even after returning to normal voice. From the listener's
 * side it is a dead microphone, no error shown, that only returns by leaving and rejoining.
 */
import { describe, expect, it } from "vitest"
import * as S from "../../testes/audio-sintetico.js"
import { CONFIGURACAO_DO_PERFIL } from "./perfis.js"
import { ATRASO_DO_GTCRN, CadeiaDeVoz, MotorGtcrn } from "./processador-de-voz.js"

const T = S.TAXA
const bloco = (k: number): Float32Array =>
  new Float32Array(128).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * (k * 128 + i)) / T))

function nivel(saida: Float32Array): { pico: number; naoFinitos: number } {
  let pico = 0
  let naoFinitos = 0
  for (const v of saida) {
    if (!Number.isFinite(v)) naoFinitos++
    else pico = Math.max(pico, Math.abs(v))
  }
  return { pico, naoFinitos }
}

describe("a cadeia de voz e os números que não são números", () => {
  it("um NaN do motor estraga um bloco, e não a chamada", () => {
    const cadeia = new CadeiaDeVoz(T, CONFIGURACAO_DO_PERFIL.normal)
    let envenenar = false
    cadeia.usarMotor({
      quadro: 768,
      atraso: ATRASO_DO_GTCRN[T]!,
      processar: (entrada: Float32Array, saida: Float32Array) => {
        saida.set(entrada)
        if (envenenar) {
          saida[0] = Number.NaN
          envenenar = false
        }
      },
      reiniciar() {},
      destruir() {},
    } as unknown as MotorGtcrn)
    const saida = new Float32Array(128)
    for (let k = 0; k < 2000; k++) cadeia.processar(bloco(k), saida)
    const antes = nivel(saida)
    expect(antes.pico).toBeGreaterThan(0)

    envenenar = true
    let naoFinitos = 0
    for (let k = 2000; k < 6000; k++) {
      cadeia.processar(bloco(k), saida)
      naoFinitos += nivel(saida).naoFinitos
    }

    // Never output a non-number, and voice comes back.
    expect(naoFinitos).toBe(0)
    expect(nivel(saida).pico).toBeGreaterThan(0)
    expect(cadeia.medidas().naoFinitos).toBe(1)
  })

  it("um não-número a meio da cadeia (o envelope, os filtros) também se repõe", () => {
    const cadeia = new CadeiaDeVoz(T, CONFIGURACAO_DO_PERFIL.normal)
    const saida = new Float32Array(128)
    for (let k = 0; k < 500; k++) cadeia.processar(bloco(k), saida)
    const envenenado = bloco(500)
    envenenado[7] = Number.POSITIVE_INFINITY
    cadeia.processar(envenenado, saida)
    let naoFinitos = nivel(saida).naoFinitos
    for (let k = 501; k < 4000; k++) {
      cadeia.processar(bloco(k), saida)
      naoFinitos += nivel(saida).naoFinitos
    }
    expect(naoFinitos).toBe(0)
    expect(nivel(saida).pico).toBeGreaterThan(0)
    expect(cadeia.medidas().naoFinitos).toBeGreaterThanOrEqual(1)
  })

  it("o gtcrn envenenado por um Infinity volta a dar voz depois de reiniciado", async () => {
    const motor = await MotorGtcrn.criar(S.binarioGtcrn(), T)
    const entrada = new Float32Array(768)
    const saida = new Float32Array(768)
    entrada.fill(Number.POSITIVE_INFINITY)
    motor.processar(entrada, saida)
    const voz = (k: number) => entrada.map((_, i) => 0.1 * Math.sin((2 * Math.PI * 300 * (k * 768 + i)) / T))
    entrada.set(voz(1))
    motor.processar(entrada, saida)
    // Measured: without restarting, the model state becomes poisoned.
    expect(nivel(saida).naoFinitos).toBeGreaterThan(0)

    motor.reiniciar()
    let naoFinitos = 0
    for (let k = 2; k < 200; k++) {
      entrada.set(voz(k))
      motor.processar(entrada, saida)
      naoFinitos += nivel(saida).naoFinitos
    }
    expect(naoFinitos).toBe(0)
    expect(nivel(saida).pico).toBeGreaterThan(0)
    motor.destruir()
  })
})
