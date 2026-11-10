/**
 * The vault file header in plain text (1.0 "Arca", slice 2).
 *
 * Up to 0.9.x the vault file was the seal and nothing else: a JSON with the nonce,
 * the salt and the ciphertext. The version of the format in it (`version`) is plain text,
 * but only reads AFTER accepting the file is this format, and 1.0
 * won't accept that from a beta vault. The owner's order is that 1.0 never
 * reads a beta vault (plan `moradas-opacas-e-corte.md`, section 2): doesn't ask for a
 * password and doesn't derive any key.
 *
 * So the version goes OUTSIDE the cipher and before everything: six ASCII bytes,
 * `orwv2` and a line break, then the usual JSON. A file without
 * them is from beta. Decide by the first bytes, without decrypting and without reading the
 * JSON.
 *
 * The same header goes at the head of the exported account file (`exportVault`)
 * and reads in `importVault`: a file exported by 0.9.x has no header,
 * and won't load.
 *
 * The line break is there to keep the file readable in a text editor
 * (that's how the owner and people testing look at it), and because no JSON starts
 * with `o`: a beta file always starts with `{`.
 */
export const CABECALHO_DO_COFRE = "orwv2\n"

/** The format version, read from the header: 1.0 always writes `orwv2`. */
export type VersaoDoFicheiroDoCofre = "orwv2" | "beta"

const BYTES_DO_CABECALHO = new TextEncoder().encode(CABECALHO_DO_COFRE)

/** The version of a vault (or account) file, just by the first bytes. Never decrypts. */
export function versaoDoFicheiro(bytes: Uint8Array): VersaoDoFicheiroDoCofre {
  if (bytes.length < BYTES_DO_CABECALHO.length) return "beta"
  for (let i = 0; i < BYTES_DO_CABECALHO.length; i++) {
    if (bytes[i] !== BYTES_DO_CABECALHO[i]) return "beta"
  }
  return "orwv2"
}

/** The same, as text: the account file arrives at the interface as text (`FileReader.readAsText`). */
export function versaoDoTexto(texto: string): VersaoDoFicheiroDoCofre {
  return texto.startsWith(CABECALHO_DO_COFRE) ? "orwv2" : "beta"
}

/** The file bytes: the header and then the JSON. */
export function comCabecalho(json: string): Uint8Array {
  const corpo = new TextEncoder().encode(json)
  const saida = new Uint8Array(BYTES_DO_CABECALHO.length + corpo.length)
  saida.set(BYTES_DO_CABECALHO, 0)
  saida.set(corpo, BYTES_DO_CABECALHO.length)
  return saida
}

/**
 * The JSON of a file with header, or `null` if the file is from beta.
 * The caller decides the refusal message: the vault and the account file
 * phrase it differently.
 */
export function semCabecalho(bytes: Uint8Array): string | null {
  if (versaoDoFicheiro(bytes) !== "orwv2") return null
  return new TextDecoder().decode(bytes.subarray(BYTES_DO_CABECALHO.length))
}
