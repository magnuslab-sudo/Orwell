import { describe, expect, it, vi } from "vitest"
import {
  BYTES_DE_ASSINATURA,
  candidatasDaColagem,
  colarImagens,
  tipoDeImagemPelosBytes,
} from "./colar.js"

/**
 * What these tests store is DISTRUST.
 *
 * The clipboard is the only input to this app that does not go through a file
 * picker: what is there can have been put by any page the user visited. What we
 * prove here is that the declared type never decides anything on its own, that
 * pasting text stays pasting text, and that nothing gets in silently.
 */

/** The first bytes of each format, written by hand as they are. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])
const GIF = new Uint8Array([...new TextEncoder().encode("GIF89a"), 1, 0, 1, 0, 0, 0])
const WEBP = new Uint8Array([...new TextEncoder().encode("RIFF"), 26, 0, 0, 0, ...new TextEncoder().encode("WEBP")])
const AVIF = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypavif"), 0, 0, 0, 0])
/** An SVG is a document with `<script>` inside it, not a byte image. */
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
const PDF = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n")
/** A WAV is RIFF like WebP, and only the second chunk tells them apart. */
const WAV = new Uint8Array([...new TextEncoder().encode("RIFF"), 36, 0, 0, 0, ...new TextEncoder().encode("WAVE")])

function ficheiro(bytes: Uint8Array, nome: string, tipoDeclarado: string): File {
  return new File([bytes as BlobPart], nome, { type: tipoDeclarado })
}

/**
 * A fake clipboard, in the shape the browser delivers.
 *
 * jsdom does not build a true `DataTransfer`, and does not need to: what the
 * code reads are three things, `types`, `getData` and `items`, and all are
 * data. Real pasting, with a flesh-and-blood `Cmd+V`, is measured in
 * `scripts/medir-colar-e-comprimir.mjs`.
 */
function areaDeTransferencia({
  texto = "",
  ficheiros = [],
}: {
  texto?: string
  ficheiros?: File[]
}): DataTransfer {
  const items = ficheiros.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file }))
  if (texto) items.unshift({ kind: "string", type: "text/plain", getAsFile: () => null } as never)
  return {
    types: [...(texto ? ["text/plain"] : []), ...ficheiros.map((f) => f.type)],
    getData: (tipo: string) => (tipo === "text/plain" ? texto : ""),
    items,
    files: ficheiros,
  } as unknown as DataTransfer
}

describe("tipoDeImagemPelosBytes", () => {
  it("reconhece os cinco formatos que este produto desenha", () => {
    expect(tipoDeImagemPelosBytes(PNG)).toBe("image/png")
    expect(tipoDeImagemPelosBytes(JPEG)).toBe("image/jpeg")
    expect(tipoDeImagemPelosBytes(GIF)).toBe("image/gif")
    expect(tipoDeImagemPelosBytes(WEBP)).toBe("image/webp")
    expect(tipoDeImagemPelosBytes(AVIF)).toBe("image/avif")
  })

  it("um SVG não passa, por mais que se anuncie como imagem", () => {
    // An SVG is XML with script inside. As an encrypted attachment no one runs it,
    // but the day someone decides to show it outside an `<img>` it will run with
    // this app's origin, the vault, the keys, everything.
    expect(tipoDeImagemPelosBytes(SVG)).toBe(null)
  })

  it("bytes que não são imagem nenhuma valem nulo e não uma adivinha", () => {
    expect(tipoDeImagemPelosBytes(PDF)).toBe(null)
    // WAV shows up here on purpose: it shares the first four bytes with WebP, and a
    // format check that stopped at `RIFF` would send an audio file to the image
    // compressor.
    expect(tipoDeImagemPelosBytes(WAV)).toBe(null)
    expect(tipoDeImagemPelosBytes(new Uint8Array(0))).toBe(null)
    // A PNG truncated mid-signature is not a PNG.
    expect(tipoDeImagemPelosBytes(PNG.slice(0, 4))).toBe(null)
  })

  it("bastam os primeiros bytes para decidir, e é por isso que existe o corte", () => {
    // If the cut were too short, AVIF, identified at the twelfth byte, would stop
    // being recognized and get rejected instead.
    expect(BYTES_DE_ASSINATURA).toBeGreaterThanOrEqual(12)
    expect(tipoDeImagemPelosBytes(AVIF.slice(0, BYTES_DE_ASSINATURA))).toBe("image/avif")
  })
})

describe("candidatasDaColagem", () => {
  it("havendo texto, não há imagens: colar texto continua a colar texto", () => {
    // The case this protects is Excel and Word, which put text AND a picture of the
    // cells on the clipboard. A paste that preferred the image would turn everyday
    // copy-paste into a surprise.
    const dados = areaDeTransferencia({ texto: "olá", ficheiros: [ficheiro(PNG, "tabela.png", "image/png")] })
    expect(candidatasDaColagem(dados)).toEqual([])
  })

  it("sem texto, apanha o que se declara imagem", () => {
    const png = ficheiro(PNG, "captura.png", "image/png")
    expect(candidatasDaColagem(areaDeTransferencia({ ficheiros: [png] }))).toEqual([png])
  })

  it("o que não se declara imagem fica de fora: isto não é o clipe", () => {
    const pdf = ficheiro(PDF, "relatório.pdf", "application/pdf")
    expect(candidatasDaColagem(areaDeTransferencia({ ficheiros: [pdf] }))).toEqual([])
  })

  it("uma área de transferência vazia não é um erro", () => {
    expect(candidatasDaColagem(null)).toEqual([])
    expect(candidatasDaColagem(areaDeTransferencia({}))).toEqual([])
  })
})

describe("colarImagens", () => {
  it("não toma conta de uma colagem de texto — e é isso que a deixa em paz", async () => {
    // The `false` is what stops the `preventDefault` above. A paste that was taken
    // but then did nothing would swallow the user's text.
    const aceites: File[][] = []
    let recusas = 0
    const tomou = colarImagens(areaDeTransferencia({ texto: "uma frase" }), {
      aceitar: (imagens) => aceites.push(imagens),
      recusar: () => (recusas += 1),
    })
    expect(tomou).toBe(false)
    await Promise.resolve()
    expect(aceites).toEqual([])
    expect(recusas).toBe(0)
  })

  it("entrega a imagem com o tipo dos BYTES, e não com o que ela dizia ser", async () => {
    // A PNG pretending to be a GIF is harmless; the same path trusting the declared
    // type is what lets an `image/svg+xml` in disguise through.
    const mentiroso = ficheiro(PNG, "captura.gif", "image/gif")
    const aceites: File[] = []
    const tomou = colarImagens(areaDeTransferencia({ ficheiros: [mentiroso] }), {
      aceitar: (imagens) => aceites.push(...imagens),
      recusar: () => undefined,
    })
    expect(tomou).toBe(true)
    await vi.waitFor(() => expect(aceites).toHaveLength(1))
    expect(aceites[0]?.type).toBe("image/png")
  })

  it("guarda o nome que veio, quando veio um", async () => {
    const aceites: File[] = []
    colarImagens(areaDeTransferencia({ ficheiros: [ficheiro(JPEG, "férias.jpg", "image/jpeg")] }), {
      aceitar: (imagens) => aceites.push(...imagens),
      recusar: () => undefined,
    })
    await vi.waitFor(() => expect(aceites).toHaveLength(1))
    expect(aceites[0]?.name).toBe("férias.jpg")
  })

  it("sem nome nenhum, inventa um com a extensão do que os bytes dizem ser", async () => {
    // A screenshot arrives without a name. The name goes to the label of the take
    // image button and the alt text, empty there is a silent line.
    const aceites: File[] = []
    colarImagens(areaDeTransferencia({ ficheiros: [ficheiro(WEBP, "", "image/webp")] }), {
      aceitar: (imagens) => aceites.push(...imagens),
      recusar: () => undefined,
    })
    await vi.waitFor(() => expect(aceites).toHaveLength(1))
    expect(aceites[0]?.name).toMatch(/\.webp$/)
    expect(aceites[0]?.name.length).toBeGreaterThan(".webp".length)
  })

  it("o que não é imagem é recusado em voz alta, e leva a colagem inteira atrás", async () => {
    // Half a paste accepted was the worst outcome: the user sees an image appear
    // and concludes both came through.
    const aceites: File[][] = []
    let recusas = 0
    const tomou = colarImagens(
      areaDeTransferencia({
        ficheiros: [ficheiro(PNG, "boa.png", "image/png"), ficheiro(SVG, "má.svg", "image/png")],
      }),
      { aceitar: (imagens) => aceites.push(imagens), recusar: () => (recusas += 1) },
    )
    expect(tomou).toBe(true)
    await vi.waitFor(() => expect(recusas).toBe(1))
    expect(aceites).toEqual([])
  })
})
