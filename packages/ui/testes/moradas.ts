import { MORADA_BYTES, base32Encode, eMoradaOpaca } from "@enclave/protocol"

/**
 * FOR TESTING ONLY. A fixed opaque address, fabricated from a readable label
 * (1.0 "Arca", slice 6b).
 *
 * The address bytes are the label in UTF-8, padded with zeros to
 * `MORADA_BYTES`. The address is always the same for the same label, and two
 * different labels give different addresses. Like any opaque address, it does
 * not say what the channel is: the test provides the token separately
 * (`lembrarFichasDosCanais`, or the test bridge tokens).
 */
export function moradaDeTeste(rotulo: string, servidor: string): string {
  const texto = new TextEncoder().encode(rotulo)
  if (texto.length === 0 || texto.length > MORADA_BYTES) {
    throw new Error(`o rótulo tem de ter de 1 a ${MORADA_BYTES} bytes: ${rotulo}`)
  }
  const bytes = new Uint8Array(MORADA_BYTES)
  bytes.set(texto)
  const morada = `!${base32Encode(bytes)}:${servidor}`
  if (!eMoradaOpaca(morada)) throw new Error(`morada de teste fora da forma opaca: ${morada}`)
  return morada
}
