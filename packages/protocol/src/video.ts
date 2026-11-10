import { z } from "zod"

/**
 * The video of a post (26/10/2026).
 *
 * **The problem.** A photograph travels whole inside the `post`, in `inline`.
 * A video does not fit: a frame's seal has a cap (`MAX_SEALED_BYTES` in
 * the core, 11 MiB of base64), and the server closes the connection above 12 MiB.
 *
 * **The form.** The `post` carries the video attachment WITHOUT the bytes: the
 * name, the type, the duration, the size, the thumbnail (`poster`) and the
 * SHA-256 digest of the bytes (`partes.sha256`). Authorship signs the whole
 * attachment (the `m`), so it also signs the digest. The bytes follow, in
 * parts, each one in a `typing` with `until: 0` (the vehicle for relays
 * and the device signal).
 *
 * **The receiver checks against the digest.** The parts are joined in order; the
 * video is only stored and shown if the SHA-256 of the joined bytes matches the
 * attachment's digest. A part can come from any member (the author when posting,
 * or another member when someone requests the video, phase S5): what validates
 * it is the digest, not who sent it. Parts from each sending device are assembled
 * separately, so garbage from one does not break another's assembly. The digest
 * only counts because the authorship `m` binds it: whoever receives the post by
 * relay checks each attachment against the `m` (`relato.ts` in the core).
 *
 * **A client from 0.5.7, 0.7.2 or 0.8.0** drops `poster`, `partes` and the
 * `video` field from `typing`, because the schemas are not `strict()`. It sees
 * an attachment without bytes, with the file name, and an expired `typing` that
 * it does not show. No payload is rejected, so none counts toward deafness. Proved
 * in `video.test.ts`, against the schemas copied in `testes/`.
 */

/** The accepted video types. No transcoding: the viewer's browser must play them. */
export const VIDEO_TIPOS = ["video/mp4", "video/webm", "video/quicktime"] as const

/**
 * The size cap for a post's video, in bytes. See `docs/PENDENTES.md`,
 * "Vídeo nas publicações: as medidas", for the reasoning behind the number.
 */
export const VIDEO_MAX_BYTES = 25 * 1024 * 1024

/** The duration cap, in seconds. */
export const VIDEO_MAX_SEGUNDOS = 90

/**
 * Video bytes per part. One MiB yields 1.87 MB of seal per frame (16/9
 * of the size), well below the 11 MiB cap, and a visible progress step.
 */
export const VIDEO_BYTES_POR_PARTE = 1024 * 1024

/**
 * The schema cap on the number of parts. Loose on purpose: the real cap is
 * `VIDEO_MAX_BYTES` / `VIDEO_BYTES_POR_PARTE`, and a future version that
 * accepts larger videos must not have its posts rejected here.
 */
export const VIDEO_PARTES_MAX = 256

/** The schema cap on one part's data, in base64url characters. */
export const PARTE_MAX_CARACTERES = 4_000_000

/** The thumbnail cap, in data URL characters. A 640 px thumbnail in WebP weighs 20 to 60 KB. */
export const POSTER_MAX_CARACTERES = 200_000

/** An SHA-256 digest (32 bytes) in base64url: 43 characters. */
const Sha256 = z.string().length(43).regex(/^[A-Za-z0-9_-]+$/)

/**
 * A video's parts, declared in the `post` attachment.
 *
 * - `n`: number of parts.
 * - `sha256`: digest of the whole video's bytes.
 * - `bytes`: bytes of each part except the last, which holds the remainder.
 */
export const PartesDoVideo = z.object({
  n: z.number().int().min(1).max(VIDEO_PARTES_MAX),
  sha256: Sha256,
  bytes: z.number().int().min(1),
})
export type PartesDoVideo = z.infer<typeof PartesDoVideo>

/**
 * One part of a video's bytes, in the `video` field of a `typing` with `until: 0`.
 *
 * - `sha`: digest of the video it belongs to (the attachment's `partes.sha256`).
 * - `parte`: position, from 0 to `de - 1`.
 * - `de`: total number of parts.
 * - `dados`: this part's bytes, in base64url.
 * - `q`: the attachment request (S5) this answers, when it does.
 */
export const ParteDeVideo = z
  .object({
    sha: Sha256,
    parte: z.number().int().min(0),
    de: z.number().int().min(1).max(VIDEO_PARTES_MAX),
    dados: z.string().min(1).max(PARTE_MAX_CARACTERES).regex(/^[A-Za-z0-9_-]+$/),
    q: z.string().max(64).optional(),
  })
  .refine((parte) => parte.parte < parte.de)
export type ParteDeVideo = z.infer<typeof ParteDeVideo>

/**
 * A video thumbnail: an image data URL. WebP, JPEG or PNG only: that is what
 * the image compressor produces, and an `<img>` with another type would open
 * the door to formats nobody here intends to render.
 */
export const PosterDoVideo = z
  .string()
  .max(POSTER_MAX_CARACTERES)
  .regex(/^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/)

/** Whether a file type is one of the accepted video types. */
export function videoAceite(mediaType: string): boolean {
  return (VIDEO_TIPOS as readonly string[]).includes(mediaType)
}

/** The number of parts for a video of `bytes` bytes. */
export function partesDoVideo(bytes: number, porParte = VIDEO_BYTES_POR_PARTE): number {
  return Math.max(1, Math.ceil(bytes / porParte))
}
