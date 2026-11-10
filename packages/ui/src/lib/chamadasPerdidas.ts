/**
 * The missed call: a private conversation rang and nobody answered (owner
 * request, November 3, 2026, for the "Calls" filter in the bell).
 *
 * The client already knows everything it needs for this, without the server:
 * the ring starts when the first person joins a private call we are not in
 * (`callSoundOf`), and ends in three ways:
 *
 * - **we answer**, on this device or another on the account (our address joins
 *   the call): not missed;
 * - **the caller gave up** (left or disconnected) without us joining: missed;
 * - the call continues: nothing yet.
 */
export interface ChamadaPerdida {
  canal: string
  quem: string
  /** When it started ringing. */
  em: number
}

export interface VigiaDasChamadas {
  /** A private call from `quem` started ringing. */
  tocou(canal: string, quem: string, em: number): void
  /** We answered this call. */
  atendida(canal: string): void
  /** `quem` left `canal`. Returns the missed call if that is what it was. */
  saiu(canal: string, quem: string): ChamadaPerdida | null
  /** `quem` disconnected: their ringing calls become missed. */
  desligou(quem: string): ChamadaPerdida[]
}

export function criarVigiaDasChamadas(): VigiaDasChamadas {
  const aTocar = new Map<string, ChamadaPerdida>()
  return {
    tocou(canal, quem, em) {
      if (!aTocar.has(canal)) aTocar.set(canal, { canal, quem, em })
    },
    atendida(canal) {
      aTocar.delete(canal)
    },
    saiu(canal, quem) {
      const chamada = aTocar.get(canal)
      if (!chamada || chamada.quem !== quem) return null
      aTocar.delete(canal)
      return chamada
    },
    desligou(quem) {
      const perdidas: ChamadaPerdida[] = []
      for (const [canal, chamada] of aTocar) {
        if (chamada.quem !== quem) continue
        aTocar.delete(canal)
        perdidas.push(chamada)
      }
      return perdidas
    },
  }
}
