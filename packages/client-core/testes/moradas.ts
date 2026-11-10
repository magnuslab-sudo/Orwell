import { MORADA_BYTES, base32Encode, eMoradaOpaca, moradaDeSala, parseServerName, type ServerName } from "@enclave/protocol"
import { registarFicha, type CofreComFichas, type FichaDoCanal } from "../src/tipoDoCanal.js"

/**
 * TEST ONLY. Channels built by hand with opaque addresses (1.0 "Arca", slice 6).
 *
 * The opaque address doesn't say what the channel is; the vault's record does.
 * A test that builds a channel provides both: a new address (`moradaNova`) and
 * the record the channel would have (`darFicha`), BEFORE the channel exists,
 * because the first record sticks. Without a record, a channel is a room.
 */

/** The server for core tests. */
export const SERVIDOR_DE_TESTE: ServerName = parseServerName("localhost:8448")

/** A new opaque address (`!<40 base32>:<servidor>`), with nothing behind it. */
export function moradaNova(servidor: ServerName = SERVIDOR_DE_TESTE): string {
  return moradaDeSala(servidor)
}

/** Give the vault the record of a channel. The first record sticks, as in production. */
export function darFicha(cofre: CofreComFichas, canal: string, ficha: FichaDoCanal): void {
  registarFicha(cofre, canal, ficha)
}

/** A new address with the record already in the vault. */
export function canalComFicha(cofre: CofreComFichas, ficha: FichaDoCanal, servidor?: ServerName): string {
  const canal = moradaNova(servidor)
  darFicha(cofre, canal, ficha)
  return canal
}

/**
 * A FIXED opaque address, built from a readable label (1.0 "Arca", slice 6c),
 * for tests that need the same address on every run (a file constant, an order
 * to compare). Same rule as the UI helper (`packages/ui/testes/moradas.ts`): the
 * bytes are the label in UTF-8, padded with zeros to `MORADA_BYTES`. It doesn't
 * say what the channel is.
 */
export function moradaDeTeste(rotulo: string, servidor: string = SERVIDOR_DE_TESTE): string {
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
