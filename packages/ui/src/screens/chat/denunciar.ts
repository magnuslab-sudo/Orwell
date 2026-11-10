import type { Motivo } from "@enclave/protocol"

/**
 * Rules for the report sheet, decoupled from the screen (`docs/planos/denuncias-design.md`,
 * §4 e §9b). Pure logic for reading and testing without rendering the sheet.
 *
 * ```
 * motivo (com a nota, a boa-fé, o nome e o email) → pré-visualização → aviso → enviada
 * ```
 *
 * Details live in the reason step, below the reason choices (design chosen
 * by the owner at 4/11/2026: single sheet, "Continue" at the bottom). The reason 1 n
 * does not show them: no note is requested, no good faith, no contact (art. 16.º, n.º 2 do DSA).
 * The notice only appears when a copy goes to the founder.
 *
 * The sheet has three visible steps (`passoAVista`): Reason, Review, and Submit.
 */
export type PassoDaDenuncia = "motivo" | "previsualizacao" | "aviso" | "enviada"

/** The three steps of the indicator. The warning and confirmation are both "Send". */
export type PassoAVista = "motivo" | "rever" | "enviar"
export const PASSOS_A_VISTA: readonly PassoAVista[] = ["motivo", "rever", "enviar"]

export function passoAVista(passo: PassoDaDenuncia): PassoAVista {
  if (passo === "motivo") return "motivo"
  if (passo === "previsualizacao") return "rever"
  return "enviar"
}

/** What the person chooses on the sheet. The core receives it in `EscolhaDaDenuncia` (`client-core`). */
export interface EscolhaDaDenuncia {
  motivo: Motivo | null
  nota: string
  boaFe: boolean
  nome: string
  email: string
}

/** The reasons without details. */
const SEM_DETALHES: readonly Motivo[] = [1]
/** The reasons with required note. */
const COM_NOTA_OBRIGATORIA: readonly Motivo[] = [8]

export function pedeDetalhes(motivo: Motivo): boolean {
  return !SEM_DETALHES.includes(motivo)
}

/** The error key (361, 362), or `null` when the choice can proceed. */
export function validarEscolha(
  escolha: EscolhaDaDenuncia,
): "the report needs a note" | "the report needs the good-faith confirmation" | null {
  const { motivo } = escolha
  if (motivo === null || !pedeDetalhes(motivo)) return null
  if (COM_NOTA_OBRIGATORIA.includes(motivo) && escolha.nota.trim() === "") return "the report needs a note"
  if (!escolha.boaFe) return "the report needs the good-faith confirmation"
  return null
}

/**
 * The next step. Stays on the same step when the choice does not allow progress
 * (no reason, or invalid details: note in 8, good faith from 2 to 8). "sent" is the step after sending:
 * the caller sends first, then changes step.
 */
export function passoSeguinte(passo: PassoDaDenuncia, escolha: EscolhaDaDenuncia, temCopia: boolean): PassoDaDenuncia {
  switch (passo) {
    case "motivo":
      if (escolha.motivo === null) return "motivo"
      return validarEscolha(escolha) === null ? "previsualizacao" : "motivo"
    case "previsualizacao":
      return temCopia ? "aviso" : "enviada"
    case "aviso":
    case "enviada":
      return "enviada"
  }
}

/** The step for "Back". Reason is the first, and "sent" does not go back. */
export function passoAnterior(passo: PassoDaDenuncia): PassoDaDenuncia {
  switch (passo) {
    case "motivo":
    case "previsualizacao":
      return "motivo"
    case "aviso":
      return "previsualizacao"
    case "enviada":
      return "enviada"
  }
}
