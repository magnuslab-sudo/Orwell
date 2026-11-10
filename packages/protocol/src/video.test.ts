import { ed25519 } from "@noble/curves/ed25519.js"
import { describe, expect, it } from "vitest"
import { assinarAutoria, resumosDosAnexos, verificarAutoria } from "./autoria.js"
import { decodePayload, encodePayload, Payload } from "./payload.js"
import { partesDoVideo, VIDEO_BYTES_POR_PARTE, videoAceite } from "./video.js"

/**
 * The video of a post, in today's schema and in the schemas from 0.5.7, 0.7.2
 * and 0.8.0, copied without changes to `testes/` (only the import of
 * `canonical.js` was updated to point to `src/`, where the file is identical).
 */

const SHA = "A".repeat(43)
const POSTER = `data:image/webp;base64,${"UklGRg".repeat(40)}`

const ANEXO_DE_VIDEO = {
  kind: "video",
  name: "praia.mp4",
  mediaType: "video/mp4",
  byteLength: 3 * 1024 * 1024,
  duration: 12.5,
  poster: POSTER,
  partes: { n: 3, sha256: SHA, bytes: VIDEO_BYTES_POR_PARTE },
}

const POST = {
  t: "post",
  id: "0123456789abcdef",
  postedAt: 1,
  caption: "a praia",
  media: [ANEXO_DE_VIDEO],
  links: [],
  tags: [],
}

const TYPING = { t: "typing", until: 0, video: { sha: SHA, parte: 1, de: 3, dados: "AAAA" } }

type Antigo = { decodePayload: (bytes: Uint8Array) => Record<string, unknown> }
async function esquema(versao: "0.5.7" | "0.7.2" | "0.8.0"): Promise<Antigo> {
  // Version 0.5.7 is in a single file (`autoria.test.ts` also uses it); the others in one folder each.
  const ficheiro = versao === "0.5.7" ? "../testes/payload-0.5.7.ts" : `../testes/v${versao}/payload.ts`
  const caminho = new URL(ficheiro, import.meta.url).href
  return (await import(/* @vite-ignore */ caminho)) as Antigo
}

describe("o vídeo no esquema de hoje", () => {
  it("lê o anexo com a miniatura e as partes", () => {
    const lido = decodePayload(encodePayload(POST as unknown as Payload)) as { media: Record<string, unknown>[] }
    expect(lido.media[0]).toMatchObject({ kind: "video", poster: POSTER, partes: { n: 3, sha256: SHA } })
    expect(lido.media[0]).not.toHaveProperty("inline")
  })

  it("lê a parte no typing expirado", () => {
    const lido = decodePayload(encodePayload(TYPING as unknown as Payload)) as { t: string; video?: unknown }
    expect(lido.video).toEqual(TYPING.video)
  })

  it("uma miniatura ou umas partes ilegíveis caem sozinhas, e a publicação passa", () => {
    const mau = { ...POST, media: [{ ...ANEXO_DE_VIDEO, poster: "javascript:alert(1)", partes: { n: 0, sha256: "x", bytes: 0 } }] }
    const lido = decodePayload(encodePayload(mau as unknown as Payload)) as { media: Record<string, unknown>[] }
    expect(lido.media[0]?.["name"]).toBe("praia.mp4")
    expect(lido.media[0]?.["poster"]).toBeUndefined()
    expect(lido.media[0]?.["partes"]).toBeUndefined()
  })

  it("uma parte fora da ordem cai sozinha, e o typing passa", () => {
    const mau = { ...TYPING, video: { ...TYPING.video, parte: 3 } }
    const lido = decodePayload(encodePayload(mau as unknown as Payload)) as { t: string; video?: unknown }
    expect(lido.t).toBe("typing")
    expect(lido.video).toBeUndefined()
  })

  it("a autoria assina a miniatura e o resumo dos bytes, pelo m", () => {
    const semente = new Uint8Array(32).fill(7)
    const normal = Payload.parse(POST) as Record<string, unknown>
    const autoria = assinarAutoria({
      canal: "!c:orwell.pt",
      autor: "@ana:orwell.pt",
      payload: normal,
      aparelho: ed25519.getPublicKey(semente),
      assinar: (m) => ed25519.sign(m, semente),
    })
    expect(autoria.m).toEqual(resumosDosAnexos(normal))
    expect(verificarAutoria("!c:orwell.pt", "@ana:orwell.pt", { ...normal, autoria }).ok).toBe(true)
    // Another bytes checksum gives another m: the bytes of another video do not pass through these.
    const outro = Payload.parse({ ...POST, media: [{ ...ANEXO_DE_VIDEO, partes: { ...ANEXO_DE_VIDEO.partes, sha256: "B".repeat(43) } }] })
    expect(resumosDosAnexos(outro as Record<string, unknown>)).not.toEqual(autoria.m)
  })

  it("as contas das partes e dos tipos", () => {
    expect(partesDoVideo(1)).toBe(1)
    expect(partesDoVideo(VIDEO_BYTES_POR_PARTE)).toBe(1)
    expect(partesDoVideo(VIDEO_BYTES_POR_PARTE + 1)).toBe(2)
    expect(videoAceite("video/mp4")).toBe(true)
    expect(videoAceite("video/webm")).toBe(true)
    expect(videoAceite("video/quicktime")).toBe(true)
    expect(videoAceite("video/x-matroska")).toBe(false)
  })
})

describe.each(["0.5.7", "0.7.2", "0.8.0"] as const)("um cliente %s", (versao) => {
  it("lê a publicação com vídeo: fica o nome, sem bytes, sem reprovar", async () => {
    const { decodePayload: antigo } = await esquema(versao)
    const lido = antigo(encodePayload(POST as unknown as Payload)) as { t: string; media: Record<string, unknown>[] }
    expect(lido.t).toBe("post")
    expect(lido.media).toHaveLength(1)
    expect(lido.media[0]).toMatchObject({ name: "praia.mp4", mediaType: "video/mp4", kind: "video" })
    expect(lido.media[0]).not.toHaveProperty("poster")
    expect(lido.media[0]).not.toHaveProperty("partes")
    expect(lido.media[0]?.["inline"]).toBeUndefined()
  })

  it("lê a parte como um typing expirado, sem a parte", async () => {
    const { decodePayload: antigo } = await esquema(versao)
    expect(antigo(encodePayload(TYPING as unknown as Payload))).toEqual({ t: "typing", until: 0 })
  })
})

describe("a autoria convive com a 0.8.0 (a forma assinada não mudou)", () => {
  /**
   * `autoria.forma.test.ts` ties the form of each schema with authorship to
   * `Autoria.v`. The two new fields on `Attachment` changed the fingerprints of
   * `message`, `post` and `space.meta`, and the version did NOT bump. The reason,
   * proved here:
   *
   * 1. They are optional and have no default value: a payload without them
   *    normalizes to the SAME canonical bytes in both schemas.
   * 2. On attachments in `attachments` and `media`, the signed form stores only
   *    `name` and `mediaType`. A post with video has the same signed form
   *    normalized by 0.8.0 (which drops `poster` and `partes`) and by this one.
   *    Therefore 0.8.0 verifies the authorship of a report with video.
   *
   * The `m` still covers the entire attachment. A 0.8.0 client never checks it
   * on a video, because a video attachment has no bytes in `inline`.
   */
  type Esquema = { Payload: { parse: (valor: unknown) => Record<string, unknown> } }
  type AutoriaAntiga = {
    formaAssinada: (p: Record<string, unknown>) => Record<string, unknown>
    verificarAutoria: (c: string, a: string, p: Record<string, unknown>) => { ok: boolean }
    canonicoTolerante: (v: unknown) => string
  }
  const importar = async <T,>(ficheiro: string): Promise<T> =>
    (await import(/* @vite-ignore */ new URL(`../testes/v0.8.0/${ficheiro}`, import.meta.url).href)) as T

  const IMAGEM = { name: "foto.png", mediaType: "image/png", byteLength: 4, inline: "data:image/png;base64,AAAA" }
  const SEM_CAMPOS_NOVOS: Record<string, unknown>[] = [
    { t: "message", id: "0123456789abcdef", sentAt: 1, body: "olá", attachments: [IMAGEM] },
    { t: "post", id: "0123456789abcdef", postedAt: 1, caption: "mural", media: [IMAGEM] },
    { t: "space.meta", name: "Lagar", updatedAt: 1, icon: IMAGEM },
  ]

  it("sem os campos novos, a normalização dá os mesmos bytes nos dois esquemas", async () => {
    const { Payload: Antigo } = await importar<Esquema>("payload.ts")
    const { canonicoTolerante } = await importar<AutoriaAntiga>("autoria.ts")
    for (const payload of SEM_CAMPOS_NOVOS) {
      expect(canonicoTolerante(Payload.parse(payload))).toBe(canonicoTolerante(Antigo.parse(payload)))
    }
  })

  it("uma publicação com vídeo tem a mesma forma assinada, e a 0.8.0 verifica a autoria", async () => {
    const { Payload: Antigo } = await importar<Esquema>("payload.ts")
    const { formaAssinada, verificarAutoria, canonicoTolerante } = await importar<AutoriaAntiga>("autoria.ts")
    const novo = Payload.parse(POST) as Record<string, unknown>
    expect(canonicoTolerante(formaAssinada(Antigo.parse(novo)))).toBe(canonicoTolerante(formaAssinada(novo)))
    const semente = new Uint8Array(32).fill(9)
    const autoria = assinarAutoria({
      canal: "!c:orwell.pt",
      autor: "@ana:orwell.pt",
      payload: novo,
      aparelho: ed25519.getPublicKey(semente),
      assinar: (m) => ed25519.sign(m, semente),
    })
    const comoA080ALe = Antigo.parse({ ...novo, autoria })
    expect(verificarAutoria("!c:orwell.pt", "@ana:orwell.pt", comoA080ALe).ok).toBe(true)
  })
})
