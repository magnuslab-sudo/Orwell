/**
 * Attached files: the name, the size, and the download.
 *
 * Everything here rests on the same principle, and it's worth writing before the
 * first `export`: **the name and type of an attachment are text the sender wrote**.
 * They travel encrypted, which means no server touched them, and says nothing
 * about whether whoever wrote them is trustworthy. A channel with thirty people
 * has thirty senders, and one is enough.
 *
 * So, without exception: the name is never a path, never decides how we draw
 * what's around it, and the type never decides what the browser does with the bytes.
 */

/**
 * Characters that control TEXT DIRECTION, and that a filename has no reason
 * to carry.
 *
 * The trick has a name and it's old: a `relatorio<U+202E>fdp.exe` reads on
 * screen as `relatorioexe.pdf`, because U+202E says reverse everything after it.
 * Whoever downloads thinks they're getting a PDF. Isolate marks (U+2066-U+2069)
 * do the same more quietly, and directional marks (U+200E/U+200F) can reorder a
 * short name.
 *
 * Written as escapes not literals, so this file stays readable, with the
 * characters inside, `grep` calls it binary and refuses it.
 *
 * Here they're deleted not replaced: what's left is the real name, in the real
 * order, exactly what we want to show.
 */
const MARCAS_DE_DIRECCAO = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g

/**
 * C0 and C1 controls, plus line and paragraph separators.
 *
 * A `\n` in a name splits the screen line in two and pushes the rest of the
 * conversation down; a `\r` hides what comes before it in anything that goes
 * to a terminal. No filesystem accepts them, so losing them loses nothing real.
 */
const CONTROLOS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g

/** Step 2 of `nomeSeguro`, alone: for text that isn't a filename. */
export function semMarcasNemControlos(texto: string): string {
  return texto.replace(MARCAS_DE_DIRECCAO, "").replace(CONTROLOS, "").trim()
}

/** When nothing readable is left, an honest name instead of an empty one. */
const SEM_NOME = "ficheiro"

/**
 * The name, safe to show AND to save.
 *
 * The order of operations is the defense, and each step has a reason:
 *
 * 1. **Cut at `/` and `\`.** Only the last segment stays, and with it dies the
 *    whole `../../.ssh/authorized_keys`, not because this code writes files
 *    (it doesn't; the download is the browser deciding where), but because the
 *    name also goes in the `download` attribute, and the only way to never depend
 *    on someone else's sanity is to never hand them a path.
 * 2. **Delete directional marks and controls.** See above.
 * 3. **Refuse `.` and `..`**, which survive step 1 and aren't names.
 * 4. **Trim to 120 characters**, from the START, the end of a name is where
 *    the extension lives, and a two-hundred-character name trimmed from the end
 *    stopped saying what it is.
 */
export function nomeSeguro(bruto: string | undefined): string {
  const ultimoSegmento = (bruto ?? "").split(/[/\\]/).pop() ?? ""
  const limpo = semMarcasNemControlos(ultimoSegmento)
  if (limpo === "" || limpo === "." || limpo === "..") return SEM_NOME
  if (limpo.length <= 120) return limpo
  // A tilde saying it was trimmed, and the last hundred letters, where the
  // extension is. Without the mark, a trimmed name looked like a full one.
  return `~${limpo.slice(limpo.length - 100)}`
}

/**
 * The extension, in capitals, to say what it is in one word.
 *
 * It comes from the NAME, not the `mediaType`, on purpose: the extension decides
 * what happens to the file after it's saved, so the extension is what the user
 * must see before saving it. An `application/pdf` stuck to a `.exe` is exactly
 * the lie this unmasks.
 */
export function extensaoDe(nome: string): string {
  const ponto = nome.lastIndexOf(".")
  if (ponto <= 0 || ponto === nome.length - 1) return ""
  const extensao = nome.slice(ponto + 1)
  // An extension is short and is one word. If it's not, it's not an extension, it's
  // the rest of the name after a dot, and showing it just fills the line.
  return /^[A-Za-z0-9]{1,8}$/.test(extensao) ? extensao.toUpperCase() : ""
}

/**
 * Bytes into words, the Portuguese way: decimal comma and thousands separated.
 *
 * Thousand not 1024, because that is what Finder and file explorers show, a
 * person who sees "2,9 MB" here and "3 MB" in the system should not have to
 * know which of the two methods this product chose.
 */
export function formatarBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const unidades = ["kB", "MB", "GB"] as const
  let valor = bytes / 1000
  let unidade = 0
  while (valor >= 1000 && unidade < unidades.length - 1) {
    valor /= 1000
    unidade += 1
  }
  // One decimal place below ten, none above: "9,4 MB" says something, "94,3 MB"
  // is just one more digit than what you read.
  const casas = valor < 10 ? 1 : 0
  return `${valor.toFixed(casas).replace(".", ",")} ${unidades[unidade]}`
}

/**
 * Bytes from a data URL without hitting the network.
 *
 * `fetch()` on a data URL would do this in two lines and force the render
 * process to make a request-the very thing this product forbids its renderer.
 * `atob` is synchronous, local, and knows nothing about the network.
 */
export function bytesDeDataUrl(dataUrl: string): Uint8Array {
  const virgula = dataUrl.indexOf(",")
  if (virgula < 0) throw new Error("data URL sem corpo")
  const base64 = dataUrl.slice(virgula + 1)
  const binario = atob(base64)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return bytes
}

/**
 * Display as image or as file line?
 *
 * **Decide by `mediaType`, never by `kind`.** When the vault dumps an
 * attachment's bytes, the marker that remains stores `name` and `mediaType`
 * and DROPS `kind`-proved in `vault.anexos.test.ts`. A decision made by `kind`
 * would send all dumped images to the file list the day they aged: the grid
 * would empty and old photos would appear as documents.
 *
 * **With no `mediaType` it is not an image**, not the other way around. For
 * this product's entire life until file attachments existed, `attachments` and
 * `media` carried only images-so an item with no declared type is from that
 * era, and what it is is a photograph. The schema requires the field, so this
 * only happens with old or corrupted data.
 *
 * The `mediaType` is from the sender, and here that hurts no one: it only
 * picks between drawing a thumbnail and drawing a line. It never decides what
 * the browser does with the bytes-see `descarregar`.
 */
export function eImagem(item: { mediaType?: string | undefined }): boolean {
  const tipo = item.mediaType
  return tipo === undefined || tipo === "" || tipo.startsWith("image/")
}

/**
 * How many bytes a data URL is actually carrying.
 *
 * **Measured, not assumed.** An attachment brings a `byteLength` that the
 * sender wrote, just as it brings the name-and the number that matters to
 * whoever saves the file is the bytes that are here, not the claim that came
 * with them.
 *
 * The `=` at the end counts: base64 rounds to groups of four characters and
 * pads what is left with one or two equals signs. Without accounting for them,
 * a 16-byte file would announce itself as 18-small, and still wrong, and wrong
 * in a way no one would investigate.
 */
export function pesoDeDataUrl(dataUrl: string): number {
  const virgula = dataUrl.indexOf(",")
  if (virgula < 0) return 0
  const base64 = dataUrl.slice(virgula + 1)
  const enchimento = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - enchimento)
}

/**
 * Read a chosen file into a data URL, which is how it travels.
 *
 * `FileReader`, not `file.arrayBuffer()` plus a manual `btoa`: the first does
 * base64 in native code, the second builds a megabyte string character by
 * character on the main thread and freezes the screen while doing it.
 *
 * The caller must have measured `file.size` first: this loads the entire file
 * into memory, and a file that will be rejected should never reach here.
 */
export function lerComoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onerror = () => reject(new Error("não foi possível ler o ficheiro"))
    leitor.onload = () => {
      const resultado = leitor.result
      if (typeof resultado === "string") resolve(resultado)
      else reject(new Error("o ficheiro não veio como data URL"))
    }
    leitor.readAsDataURL(file)
  })
}

/**
 * Save the file, nothing else.
 *
 * **The blob's MIME type is `application/octet-stream`, never what the sender
 * declared.** This is the most important line in this file. An attachment with
 * `text/html` turned into an object URL of its own type is a page that runs
 * WITH THIS APPLICATION'S ORIGIN if someone navigates to it-the vault, the
 * keys, the entire conversation within reach of a `<script>` that came inside
 * a message. With a neutral type there is nothing to interpret: the browser
 * saves the bytes and done. An `image/svg+xml` does the same by another route,
 * and an `application/pdf` opens a reader that already had its share of holes.
 *
 * Bytes reach disk intact-the blob's type decides what the browser does with
 * them, not what they are. The name carries the extension, and it is the
 * extension that the operating system uses when the user opens the file later,
 * outside here, by choice.
 *
 * Nothing in this function opens, previews, or runs anything. The download
 * happens because someone clicked a button.
 */
export function descarregar(dataUrl: string, nome: string): void {
  const blob = new Blob([bytesDeDataUrl(dataUrl) as BlobPart], { type: "application/octet-stream" })
  const endereco = URL.createObjectURL(blob)
  const ligacao = document.createElement("a")
  ligacao.href = endereco
  ligacao.download = nomeSeguro(nome)
  // `rel` and `target` do not matter to a `download`, but one day someone
  // removes `download` to experiment and it is good the safety net is ready.
  ligacao.rel = "noopener"
  ligacao.click()
  // Release on the next cycle: revoking right after `click()` can cut the
  // download before it takes, and the symptom is a zero-byte file that shows up
  // once in twenty and does not reproduce on demand.
  setTimeout(() => URL.revokeObjectURL(endereco), 0)
}
