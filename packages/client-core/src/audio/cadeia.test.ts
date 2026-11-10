/**
 * The voice chain, measured with synthetic audio.
 *
 * The code that runs here is the same code that runs in the worklet
 * (`processador-de-voz.ts`), with the same `gtcrn.wasm`. The math is in
 * `testes/audio-sintetico.ts`. The numbers this file prints are from
 * `README.md`.
 */
import { describe, expect, it } from "vitest"
import * as S from "../../testes/audio-sintetico.js"
import { CONFIGURACAO_DO_PERFIL, ETAPAS_DESLIGADAS } from "./perfis.js"
import {
  ATRASO_DO_GTCRN,
  CadeiaDeVoz,
  MotorGtcrn,
  type ConfiguracaoDaCadeia,
  type NomeDaEtapa,
} from "./processador-de-voz.js"

const NORMAL = CONFIGURACAO_DO_PERFIL.normal

async function correr(
  config: ConfiguracaoDaCadeia,
  x: Float32Array,
  opcoes: { taxa?: number; motor?: boolean; aoBloco?: (cadeia: CadeiaDeVoz, inicio: number) => void } = {},
) {
  const taxa = opcoes.taxa ?? S.TAXA
  const cadeia = new CadeiaDeVoz(taxa, config)
  if (opcoes.motor !== false) cadeia.usarMotor(await MotorGtcrn.criar(S.binarioGtcrn(), taxa))
  const y = new Float32Array(x.length)
  const tempos: number[] = []
  for (let i = 0; i + S.BLOCO <= x.length; i += S.BLOCO) {
    opcoes.aoBloco?.(cadeia, i)
    const t0 = performance.now()
    cadeia.processar(x.subarray(i, i + S.BLOCO), y.subarray(i, i + S.BLOCO))
    tempos.push(performance.now() - t0)
  }
  const atraso = cadeia.atraso
  cadeia.destruir()
  return { y, tempos, atraso }
}

function so(etapa: NomeDaEtapa): ConfiguracaoDaCadeia {
  return { ...NORMAL, forca: 1, etapas: { ...ETAPAS_DESLIGADAS, [etapa]: true } }
}

const DESDE = S.TAXA * 2 // the first two seconds are startup (noise floor, AGC)
const ESTACIONARIOS = ["branco", "rosa", "ventoinha"] as const
const TODOS = [...ESTACIONARIOS, "teclado"] as const

describe("cadeia de voz", () => {
  const voz = S.normalizar(S.voz(12), -20)

  it("o atraso declarado é o atraso medido, a 48 kHz e a 16 kHz", async () => {
    const r = await correr(so("supressao"), voz)
    expect(S.atraso(voz, r.y)).toBe(r.atraso)
    expect(r.atraso).toBe(ATRASO_DO_GTCRN[48000]! + 128)

    const voz16 = S.normalizar(S.voz(6, 16000), -20)
    const r16 = await correr(so("supressao"), voz16, { taxa: 16000 })
    expect(S.atraso(voz16, r16.y, 1600)).toBe(r16.atraso)
  })

  it('"Normal" melhora o SNR em 10 dB ou mais no ruído estacionário, sem baixar a voz mais de 1 dB', async () => {
    const tabela: Record<string, Record<string, string>> = {}
    const referenciaPa = (await correr(so("passaAlto"), voz)).y
    for (const tipo of TODOS) {
      const x = S.misturar(voz, S.ruido(tipo, voz.length), 5)
      const entrada = S.snrDaSaida(voz, x, 0, DESDE).snrDb
      const linha: Record<string, string> = { entrada: entrada.toFixed(1) }
      const configs: Record<string, ConfiguracaoDaCadeia> = {
        passaAlto: so("passaAlto"),
        supressao: so("supressao"),
        gate: so("gate"),
        compressor: so("compressor"),
        deEsser: so("deEsser"),
        leve: CONFIGURACAO_DO_PERFIL.leve,
        normal: NORMAL,
        maximo: CONFIGURACAO_DO_PERFIL.maximo,
      }
      for (const [nome, config] of Object.entries(configs)) {
        const r = await correr(config, x)
        // With the high-pass on, the reference voice is the voice passed through
        // the same filter: the phase shift is not noise.
        const ref = config.etapas.passaAlto ? referenciaPa.subarray(r.atraso) : voz
        const saida = S.snrDaSaida(ref, r.y, r.atraso, DESDE)
        const nivel = 10 * Math.log10(saida.potenciaDaVoz / S.potenciaNaJanela(voz, r.y.length, r.atraso, DESDE))
        const melhoria = saida.snrDb - entrada
        linha[nome] = `${melhoria >= 0 ? "+" : ""}${melhoria.toFixed(1)} (${nivel >= 0 ? "+" : ""}${nivel.toFixed(1)})`

        // No single stage makes the SNR worse than 1 dB by itself.
        if (!["leve", "normal", "maximo"].includes(nome)) expect(melhoria, `${nome} em ${tipo}`).toBeGreaterThan(-1)
        if (nome === "normal") {
          if ((ESTACIONARIOS as readonly string[]).includes(tipo)) expect(melhoria, `normal em ${tipo}`).toBeGreaterThanOrEqual(10)
          expect(nivel, `nível da voz, normal em ${tipo}`).toBeGreaterThanOrEqual(-1)
        }
      }
      tabela[tipo] = linha
    }
    console.info("Melhoria do SNR em dB (nível da voz em dB), entrada a 5 dB de SNR:")
    console.table(tabela)
  }, 120_000)

  it("cada bloco processa-se muito abaixo do tempo de um bloco", async () => {
    const x = S.misturar(voz, S.ruido("rosa", voz.length), 5)
    const r = await correr(NORMAL, x)
    const ordenados = [...r.tempos].sort((a, b) => a - b)
    const media = r.tempos.reduce((a, b) => a + b, 0) / r.tempos.length
    const p99 = ordenados[Math.floor(ordenados.length * 0.99)]!
    const maximo = ordenados.at(-1)!
    const orcamento = (S.BLOCO / S.TAXA) * 1000
    console.info(
      `CPU por bloco de 128 amostras (${orcamento.toFixed(2)} ms de áudio): média ${media.toFixed(3)} ms, ` +
        `p99 ${p99.toFixed(3)} ms, máximo ${maximo.toFixed(3)} ms; atraso da cadeia ${((r.atraso / S.TAXA) * 1000).toFixed(1)} ms`,
    )
    expect(media).toBeLessThan(orcamento / 4)
    expect(p99).toBeLessThan(orcamento)
    expect(maximo).toBeLessThan(20)
  }, 60_000)

  it("ligar e desligar etapas a meio não estala", async () => {
    // A 440 Hz sine at -20 dBFS: the maximum jump between samples is known.
    const n = S.TAXA * 4
    const amplitude = 0.1
    const x = new Float32Array(n).map((_, i) => amplitude * Math.sin((2 * Math.PI * 440 * i) / S.TAXA))
    const salto = amplitude * Math.sin((2 * Math.PI * 440) / S.TAXA)
    const etapas: NomeDaEtapa[] = ["passaAlto", "supressao", "gate", "compressor", "deEsser"]
    let quantos = 0
    const r = await correr(NORMAL, x, {
      aoBloco: (cadeia, inicio) => {
        if (inicio > 0 && inicio % (S.BLOCO * 60) === 0) {
          quantos++
          const etapa = etapas[quantos % etapas.length]!
          const ligada = Math.floor(quantos / etapas.length) % 2 === 1
          cadeia.configurar({ ...NORMAL, etapas: { ...NORMAL.etapas, [etapa]: ligada } })
        }
      },
    })
    let pior = 0
    for (let i = r.atraso + S.TAXA; i < n; i++) pior = Math.max(pior, Math.abs(r.y[i]! - r.y[i - 1]!))
    // AGC can boost the sine to roughly 2x; a click would be an order of magnitude higher.
    expect(pior).toBeLessThan(salto * 4)
  }, 60_000)

  it("o de-esser baixa a sibilância e deixa a voz", async () => {
    const n = S.TAXA * 4
    const aleatorio = S.gerador(3)
    // Synthetic "s": noise in the 5 to 10 kHz band, in 150 ms bursts.
    const sib = new Float32Array(n)
    let a1 = 0
    let a2 = 0
    for (let i = 0; i < n; i++) {
      const w = aleatorio() * 2 - 1
      a1 = 0.2 * a1 + w
      a2 = -0.6 * a2 + a1
      sib[i] = (i / S.TAXA) % 0.5 < 0.15 ? a2 : 0
    }
    const x = S.normalizar(sib, -20)
    const ligado = await correr({ ...NORMAL, etapas: { ...ETAPAS_DESLIGADAS, deEsser: true } }, x, { motor: false })
    const desligado = await correr({ ...NORMAL, etapas: ETAPAS_DESLIGADAS }, x, { motor: false })
    const reducao = 10 * Math.log10(S.potencia(desligado.y) / S.potencia(ligado.y))
    expect(reducao).toBeGreaterThan(3)
    expect(reducao).toBeLessThanOrEqual(NORMAL.deEsserMaxDb + 0.5)

    const vozLigado = await correr({ ...NORMAL, etapas: { ...ETAPAS_DESLIGADAS, deEsser: true } }, voz, { motor: false })
    const vozDesligado = await correr({ ...NORMAL, etapas: ETAPAS_DESLIGADAS }, voz, { motor: false })
    expect(Math.abs(10 * Math.log10(S.potencia(vozDesligado.y) / S.potencia(vozLigado.y)))).toBeLessThan(0.5)
  }, 60_000)

  it("sem motor, a cadeia passa o som com o mesmo atraso, e o silêncio sai silêncio", async () => {
    const semMotor = await correr(so("supressao"), voz, { motor: false })
    expect(S.atraso(voz, semMotor.y)).toBe(semMotor.atraso)

    const cadeia = new CadeiaDeVoz(S.TAXA, NORMAL)
    const zero = new Float32Array(S.BLOCO)
    const saida = new Float32Array(S.BLOCO)
    for (let i = 0; i < 400; i++) cadeia.processar(zero, saida)
    expect(saida.every((v) => v === 0)).toBe(true)
    const medidas = cadeia.medidas()
    expect(medidas.entradaDb).toBe(-120)
    expect(medidas.ruidoEstimadoDb).toBe(-120)
    expect(medidas.motorPronto).toBe(false)
  })

  it("o tecto segura os picos a -1 dBFS mesmo com o ganho no máximo", async () => {
    const x = new Float32Array(S.TAXA).map((_, i) => 0.95 * Math.sin((2 * Math.PI * 300 * i) / S.TAXA))
    const r = await correr({ ...NORMAL, ganhoDeEntrada: 2 }, x, { motor: false })
    let pico = 0
    for (const v of r.y) pico = Math.max(pico, Math.abs(v))
    expect(pico).toBeLessThanOrEqual(Math.pow(10, -1 / 20) + 1e-6)
  })

  it("o motor recusa o que não sabe correr, com chaves estáveis", async () => {
    await expect(MotorGtcrn.criar(S.binarioGtcrn(), 44100)).rejects.toThrow("noise-suppressor-sample-rate")
    await expect(MotorGtcrn.criar(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]), 48000)).rejects.toThrow(
      "noise-suppressor-exports-changed",
    )
  })
})
