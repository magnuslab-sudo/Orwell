/**
 * Paste images from the clipboard.
 *
 * **The clipboard is not a file picker.** A file chosen in `<input type="file">`
 * was pointed to by a user in a system window; what is on the clipboard can have
 * been put there by any page that user visited, with the name and type that page
 * wants. It is the only input to this app where metadata comes from a stranger
 * without anyone clicking anything.
 *
 * Hence the three rules in this file, in order of importance:
 *
 * 1. **The declared type never authorizes anything.** It serves to pick
 *    candidates and nothing more; what decides if it is an image are the first
 *    bytes. An `image/png` that is really an SVG inside comes here and leaves
 *    rejected.
 * 2. **Text always wins.** If text is on the clipboard, this function does not
 *    take over the paste and the browser pastes text as it always has. A paste
 *    that preferred the image would break everyday copy-paste, see the Excel
 *    case below.
 * 3. **Either everything comes in, or nothing does.** Half a paste accepted
 *    silently is the worst outcome: the user sees an image appear and concludes
 *    both made it through.
 */

/** The formats this product knows how to draw, and no others. */
export type TipoDeImagem = "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif"

/**
 * How many bytes from the start are enough to recognize any of the formats.
 *
 * Twelve is the minimum, where the AVIF mark ends, which is the longest, and
 * sixteen is that minimum with room to spare. Reading only this is what lets us
 * decide without loading the whole photo into memory.
 */
export const BYTES_DE_ASSINATURA = 16

/**
 * The name of an image that arrived without one, which is the case for a
 * screen capture on almost all systems.
 *
 * It does not live in `strings.ts` because it is not a phrase from the interface: it is a
 * file name, of the same kind as `"imagem"` that the input box already uses when
 * `File` comes without a name. It appears in the preview alt text and in the
 * label of the button that removes it.
 */
const NOME_SEM_NOME = "imagem colada"

/** The extension that matches each format, so the name says what it is. */
const EXTENSAO: Record<TipoDeImagem, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
}

/** The bytes, one by one, against a known mark. */
function comeca(bytes: Uint8Array, marca: readonly number[], desvio = 0): boolean {
  if (bytes.length < desvio + marca.length) return false
  for (let i = 0; i < marca.length; i++) if (bytes[desvio + i] !== marca[i]) return false
  return true
}

/** An ASCII word in bytes, the way container marks are written. */
function marcaDe(texto: string): number[] {
  return [...texto].map((letra) => letra.charCodeAt(0))
}

/**
 * What these bytes really are, or nothing.
 *
 * **No guesses and no defaults.** What is not recognized is rejected, and that
 * includes things that really are images, HEIC, TIFF, BMP, but that this
 * product's canvas cannot recode. Accepting them would let a file through to the
 * compressor that it cannot decode, and the user would get a worse error, later
 * and more confusing.
 *
 * SVG is out and stays out. It is XML with `<script>` inside: as long as it is
 * an encrypted attachment no one runs it, but the day someone shows it outside
 * an `<img>` is the day a pasted image starts running with this app's origin,
 * with the vault and keys in reach. That is not a risk you take for a format
 * no one pastes.
 */
export function tipoDeImagemPelosBytes(bytes: Uint8Array): TipoDeImagem | null {
  if (comeca(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png"
  // `FF D8 FF` and not just `FF D8`: the first two bytes alone appear in files
  // that are not JPEG at all, and the third byte starts the marker.
  if (comeca(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (comeca(bytes, marcaDe("GIF87a")) || comeca(bytes, marcaDe("GIF89a"))) return "image/gif"
  // RIFF container, with the size in the middle: the four bytes that say WebP are
  // at the eighth position. Without checking the second section, any WAV would pass
  // as an image.
  if (comeca(bytes, marcaDe("RIFF")) && comeca(bytes, marcaDe("WEBP"), 8)) return "image/webp"
  // ISO-BMFF: four bytes of size, `ftyp`, and the format tag. `avis` is the
  // animated sequence, which engines render the same way.
  if (comeca(bytes, marcaDe("ftyp"), 4)) {
    if (comeca(bytes, marcaDe("avif"), 8) || comeca(bytes, marcaDe("avis"), 8)) return "image/avif"
  }
  return null
}

/**
 * What in a paste can become an image.
 *
 * Returns files that CLAIM to be images, and that is all the declared type does
 * here: narrow down. Nothing that comes out of this function is accepted, bytes
 * accept things in `colarImagens`.
 */
export function candidatasDaColagem(dados: DataTransfer | null | undefined): File[] {
  if (!dados) return []
  if (temTexto(dados)) return []

  const candidatas: File[] = []
  const itens = dados.items
  // `DataTransferItemList` is array-like and not an array: index and `length`, which
  // is the form that works in all engines and in both test runs.
  for (let i = 0; i < (itens?.length ?? 0); i++) {
    const item = itens?.[i]
    if (!item || item.kind !== "file") continue
    if (!item.type.startsWith("image/")) continue
    const file = item.getAsFile()
    if (file) candidatas.push(file)
  }
  return candidatas
}

/**
 * Is there text to paste?
 *
 * The case this guards has a name: Excel and Word put in the clipboard both the
 * text of cells AND a picture of them. When someone copies a table and pastes it
 * in a conversation, they want the table as text, that is what they copied. Without
 * this guard, the new feature would break a longtime gesture, which is worse than
 * not having the feature.
 *
 * Check the content and not just the type list: some engines announce `text/plain`
 * with an empty string inside when what was copied was an image, and an empty string
 * is not text anyone wants to paste.
 */
function temTexto(dados: DataTransfer): boolean {
  const tipos = Array.from(dados.types ?? [])
  if (!tipos.includes("text/plain")) return false
  return dados.getData("text/plain").length > 0
}

export interface DestinoDaColagem {
  /** Images confirmed by their bytes, now with the correct type and a name. */
  aceitar: (imagens: File[]) => void
  /** Something came claiming to be an image but is not. Nothing was accepted. */
  recusar: () => void
}

/**
 * Handle a `paste`.
 *
 * Returns `true` when it took ownership of the paste, and the caller uses that
 * `true` to call `preventDefault`. **Order matters:** the decision to take ownership
 * is synchronous (it is the only time you can block the browser), and byte
 * confirmation is asynchronous because reading a file is asynchronous. Someone
 * pasting text exits here with `false` before any read happens.
 *
 * Blocking file pastes costs no one: pasting files into a text box does nothing
 * by default. The `preventDefault` exists for `text/html` that sometimes comes
 * with an image copied from a web page.
 */
export function colarImagens(dados: DataTransfer | null | undefined, destino: DestinoDaColagem): boolean {
  const candidatas = candidatasDaColagem(dados)
  if (candidatas.length === 0) return false

  void Promise.all(candidatas.map(confirmar))
    .then((confirmadas) => {
      const imagens = confirmadas.filter((f): f is File => f !== null)
      // Either everything enters or nothing does: see the header.
      if (imagens.length !== candidatas.length) destino.recusar()
      else destino.aceitar(imagens)
    })
    // A file that refuses to be read is a refusal like any other. What cannot happen
    // is the paste dying here with nothing showing on screen.
    .catch(() => destino.recusar())

  return true
}

/**
 * The first bytes, and the verdict.
 *
 * The returned file is NEW and carries the type the bytes said, not what came
 * declared. This is what makes the entire downstream path (the compressor, the
 * data URL, the `mediaType` that travels in the message) work on the truth without
 * repeating this check.
 */
async function confirmar(file: File): Promise<File | null> {
  const tipo = tipoDeImagemPelosBytes(await primeirosBytes(file))
  if (!tipo) return null
  return new File([file], nomeDe(file, tipo), { type: tipo })
}

/**
 * The first bytes of a file, and only those.
 *
 * `slice` before reading: a 4K screenshot is twenty megabytes, and loading them all
 * to find out if the first eight say PNG would cost the whole photo for an eight-byte
 * question.
 *
 * `FileReader` and not `blob.arrayBuffer()` for the same reason as in
 * `lib/ficheiros.ts`: it is what exists everywhere, including in jsdom where this
 * is tested, which does not bring `Blob.prototype.arrayBuffer`.
 */
function primeirosBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onerror = () => reject(new Error("não foi possível ler o que foi colado"))
    leitor.onload = () => {
      const resultado = leitor.result
      if (resultado instanceof ArrayBuffer) resolve(new Uint8Array(resultado))
      else reject(new Error("os bytes colados não vieram como bytes"))
    }
    leitor.readAsArrayBuffer(file.slice(0, BYTES_DE_ASSINATURA))
  })
}

/** The name that came, or an honest one with the extension of what the bytes say it is. */
function nomeDe(file: File, tipo: TipoDeImagem): string {
  return file.name || `${NOME_SEM_NOME}.${EXTENSAO[tipo]}`
}
