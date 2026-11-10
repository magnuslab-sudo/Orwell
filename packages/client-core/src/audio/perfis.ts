import { CONFIGURACAO_NORMAL, type ConfiguracaoDaCadeia, type EtapasDaCadeia, type NomeDaEtapa } from "./processador-de-voz.js"

export type { EtapasDaCadeia, NomeDaEtapa } from "./processador-de-voz.js"

export type PerfilDeAudio = "desligado" | "leve" | "normal" | "maximo"

export const PERFIS_DE_AUDIO: readonly PerfilDeAudio[] = ["desligado", "leve", "normal", "maximo"]

export const ETAPAS_DE_AUDIO: readonly NomeDaEtapa[] = ["passaAlto", "supressao", "gate", "compressor", "deEsser"]

export const PERFIL_DE_AUDIO_POR_OMISSAO: PerfilDeAudio = "normal"

/**
 * What each profile connects, and at what strength.
 *
 * "Off" has no chain configuration: it means no chain at all, and
 * capture stays as the browser provides it (with native suppression, if the user
 * has it enabled). The numbers for each profile are measured in `cadeia.test.ts` and
 * written in the `README.md`.
 */
export const CONFIGURACAO_DO_PERFIL: Readonly<Record<Exclude<PerfilDeAudio, "desligado">, ConfiguracaoDaCadeia>> = {
  leve: {
    etapas: { passaAlto: true, supressao: true, gate: true, compressor: true, deEsser: false },
    forca: 0.6,
    ganhoDeEntrada: 1,
    gateFundoDb: -12,
    agcMaxDb: 6,
    deEsserMaxDb: 4,
    limiarDb: null,
  },
  normal: CONFIGURACAO_NORMAL,
  maximo: {
    etapas: { passaAlto: true, supressao: true, gate: true, compressor: true, deEsser: true },
    forca: 1,
    ganhoDeEntrada: 1,
    gateFundoDb: -40,
    agcMaxDb: 12,
    deEsserMaxDb: 8,
    limiarDb: null,
  },
}

export const ETAPAS_DESLIGADAS: EtapasDaCadeia = {
  passaAlto: false,
  supressao: false,
  gate: false,
  compressor: false,
  deEsser: false,
}

export function ehPerfil(valor: unknown): valor is PerfilDeAudio {
  return typeof valor === "string" && (PERFIS_DE_AUDIO as readonly string[]).includes(valor)
}

export function ehEtapa(valor: unknown): valor is NomeDaEtapa {
  return typeof valor === "string" && (ETAPAS_DE_AUDIO as readonly string[]).includes(valor)
}

export function etapasDoPerfil(perfil: PerfilDeAudio): EtapasDaCadeia {
  return perfil === "desligado" ? ETAPAS_DESLIGADAS : CONFIGURACAO_DO_PERFIL[perfil].etapas
}

export function forcaDoPerfil(perfil: PerfilDeAudio): number {
  return perfil === "desligado" ? 0 : CONFIGURACAO_DO_PERFIL[perfil].forca
}

/**
 * The configuration sent to the worklet: the profile base, with its stages, strength
 * and manual microphone threshold that the user adjusted on top. With "off" and a chain already running
 * (changed mid-call), everything is disabled: sound passes dry.
 */
export function configuracaoPara(
  perfil: PerfilDeAudio,
  etapas: EtapasDaCadeia,
  forca: number,
  ganhoDeEntrada: number,
  limiarDb: number | null = null,
): ConfiguracaoDaCadeia {
  const base = CONFIGURACAO_DO_PERFIL[perfil === "desligado" ? "normal" : perfil]
  return {
    ...base,
    etapas: perfil === "desligado" ? ETAPAS_DESLIGADAS : etapas,
    forca: Math.max(0, Math.min(1, forca)),
    ganhoDeEntrada: Math.max(0, Math.min(2, ganhoDeEntrada)),
    limiarDb,
  }
}
