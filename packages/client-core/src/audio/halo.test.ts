/**
 * The speaker halo, measured from the other side, with the real voice chain.
 *
 * Owner request on October 26, 2026: "sound coming in with no animation". The
 * halo scale changed that day (`packages/ui/src/lib/medidorDeDb.ts`), and our
 * card started measuring before the gate. OTHERS keep being measured on the
 * received track, which already passed through the speaker's gate. With manual
 * sensitivity (1.0.9) the doubt arose: do others' halos depend on the
 * speaker's gate?
 *
 * They do, and they must. What this file pins down, with synthetic voice
 * running through the worklet code:
 *
 * - Everything you HEAR from the other side lights the halo: the chain output,
 *   at any voice level the gate lets through, stays above the scale start
 *   (−50 dBFS), with room to spare.
 * - What the gate closes you do not hear: in manual it outputs exactly zero,
 *   and the halo stays dark. Measuring before the speaker's gate would light a
 *   halo with no sound, and that only happens by sending the raw level over
 *   the network, which is exactly what the manual line exists not to send.
 *
 * Opus is not here. It holds voice level to less than 1 dB, and DTX, with the
 * gate closed, sends silence: neither touches the math.
 */
import { describe, expect, it } from "vitest"
import * as S from "../../testes/audio-sintetico.js"
import { ChaoDeRuido, dbDeRms, inicioDaEscala, nivelDaVoz } from "../../../ui/src/lib/medidorDeDb.js"
import { CONFIGURACAO_DO_PERFIL } from "./perfis.js"
import { CadeiaDeVoz, type ConfiguracaoDaCadeia } from "./processador-de-voz.js"

const NORMAL = CONFIGURACAO_DO_PERFIL.normal
const T = S.TAXA

/** Voice with room noise underneath, at `vozDb` and `salaDb` dBFS RMS. */
function vozNaSala(segundos: number, vozDb: number, salaDb: number): Float32Array {
  const v = S.normalizar(S.voz(segundos), vozDb)
  const r = S.normalizar(S.ruido("rosa", v.length), salaDb)
  return v.map((x, i) => x + r[i]!)
}

/** The whole chain over `x`, block by block, as in the worklet. */
function cadeia(config: ConfiguracaoDaCadeia, x: Float32Array): Float32Array {
  const c = new CadeiaDeVoz(T, config)
  const y = new Float32Array(x.length)
  for (let i = 0; i + S.BLOCO <= x.length; i += S.BLOCO) c.processar(x.subarray(i, i + S.BLOCO), y.subarray(i, i + S.BLOCO))
  c.destruir()
  return y
}

/**
 * What `useNivelDeVoz` writes to `--voz`, frame by frame, over the received
 * track. Same math as the hook: RMS of 512 samples per frame (60 per second),
 * rise of 0.5 and fall of 0.08, noise floor from the first 2 s, and the scale.
 * If the hook changes these numbers, this mirror changes with it.
 */
function haloDoOutroLado(y: Float32Array): number[] {
  const porFrame = Math.round(T / 60)
  const chao = new ChaoDeRuido(0)
  const vozes: number[] = []
  let suavizado = 0
  for (let i = 0; i + 512 <= y.length; i += porFrame) {
    let soma = 0
    for (let k = i; k < i + 512; k++) soma += y[k]! * y[k]!
    const nivel = Math.sqrt(soma / 512)
    suavizado += (nivel - suavizado) * (nivel > suavizado ? 0.5 : 0.08)
    const db = dbDeRms(suavizado)
    const ms = (i / T) * 1000
    chao.observar(db, ms)
    vozes.push(nivelDaVoz(db, inicioDaEscala(chao.valor(ms))))
  }
  return vozes
}

/** The halo at the middle of each speech chunk (frames after 2.5 s). */
const depoisDoChao = (halo: number[]): number[] => halo.slice(Math.round(2.5 * 60))
const maximo = (xs: number[]): number => xs.reduce((m, x) => Math.max(m, x), 0)

describe("o halo dos outros, medido depois do gate de quem fala", () => {
  it("modo automático: fala baixa, normal e alta chega acima do começo da escala e acende", () => {
    for (const vozDb of [-45, -38, -30, -20]) {
      const y = cadeia(NORMAL, vozNaSala(6, vozDb, -62))
      const halo = depoisDoChao(haloDoOutroLado(y))
      // AGC lifts quiet voice by 9 dB: at −45 it comes out −38 and the halo moves halfway.
      expect(maximo(halo), `voz a ${vozDb} dBFS`).toBeGreaterThan(0.4)
    }
  })

  it("modo automático: só a sala, sem voz, não acende", () => {
    const y = cadeia(NORMAL, S.normalizar(S.ruido("rosa", 6 * T), -55))
    expect(maximo(depoisDoChao(haloDoOutroLado(y)))).toBeLessThan(0.1)
  })

  it("modo manual: acima da linha acende, abaixo sai silêncio e o halo fica apagado", () => {
    const linha = { ...NORMAL, limiarDb: -40 }
    const acima = depoisDoChao(haloDoOutroLado(cadeia(linha, vozNaSala(6, -30, -62))))
    expect(maximo(acima)).toBeGreaterThan(0.5)

    // Below the line the chain sends zeros: no sound, so no halo. It is the gate
    // doing what you asked it to, and the halo tells the truth about that.
    const abaixo = cadeia(linha, vozNaSala(6, -55, -70))
    expect(abaixo.subarray(T).every((v) => v === 0)).toBe(true)
    expect(maximo(depoisDoChao(haloDoOutroLado(abaixo)))).toBe(0)
  })
})
