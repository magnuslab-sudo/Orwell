import { z } from "zod"

/**
 * The video of a post (26/10/2026).
 *
 * **The problem.** A photograph travels whole inside the `post`, in `inline`.
 * A video does not fit: the seal of a frame has a cap (`MAX_SEALED_BYTES` in
 * the core, 11 MiB of base64), and the server closes the connection above 12 MiB.
 *
 * **The form.** The `post` carries the video attachment WITHOUT the bytes: the
 * name, the type, the duration, the size, the thumbnail (`poster`) and the
 * SHA-256 checksum of the bytes (`partes.sha256`). Authorship signs the entire
 * attachment (the `m`), so it also signs the checksum. The bytes come next, in
 * parts, each one in a `typing` with `until: 0` (the vehicle for telemetry
 * reports and device signal).
 *
 * **The receiver verifies against the checksum.** The parts join in order; the
 * video is saved and shown only if the SHA-256 of the joined bytes matches the
 * attachment checksum. A part can come from any member (the author when posting,
 * or another member when someone requests the video, phase S5): what validates
 * it is the checksum, not who sent it. Each device that sends parts mounts on
 * its own, so garbage from one does not break another's assembly. The checksum
 * is only valid because the authorship `m` binds it: a receiver of the post by
 * telemetry verifies each attachment against the `m` (`relato.ts` in the core).
 *
 * **A client from 0.5.7, 0.7.2 or 0.8.0** drops `poster`, `partes` and the
 * `video` field from `typing`, because the schemas are not `strict()`. It sees
 * an attachment without bytes, with the file name, and an expired `typing` that
 * does not display. No payload is rejected, so none counts toward deafness. Proved
 * in `video.test.ts`, against the schemas copied in `testes/`.
 */

/** Accepted video types. No transcoding: the viewer's browser must play them natively. */
export const VIDEO_TIPOS = ["video/mp4", "video/webm", "video/quicktime"] as const

/**
 * Video size limit for a post, in bytes. See `docs/PENDENTES.md`,
 * "Video nas publicações: as medidas", for the rationale.
 */
export const VIDEO_MAX_BYTES = 25 * 1024 * 1024

/** Duration limit, in seconds. */
export const VIDEO_MAX_SEGUNDOS = 90

/**
 * Video bytes per chunk. One MiB yields 1.87 MB of thumbnail per frame (16/9
 * of the size), well below the 11 MiB limit, and a visible progress step.
 */
export const VIDEO_BYTES_POR_PARTE = 1024 * 1024

/**
 * Schema limit for chunk count. Intentionally loose: the real limit is
 * `VIDEO_MAX_BYTES` / `VIDEO_BYTES_POR_PARTE`, and a future version that
 * accepts larger videos must not reject its posts here.
 */
export const VIDEO_PARTES_MAX = 256

/** Schema limit for chunk data, in base64url characters. */
export const PARTE_MAX_CARACTERES = 4_000_000

/** Thumbnail limit, in data URL characters. A 640 px thumbnail in WebP weighs 20 to 60 KB. */
export const POSTER_MAX_CARACTERES = 200_000

/** An SHA-256 digest (32 bytes) in base64url: 43 characters. */
const Sha256 = z.string().length(43).regex(/^[A-Za-z0-9_-]+$/)

/**
 * Video chunks, sent in the post attachment.
 *
 * - `n`: number of chunks.
 * - `sha256`: hash of all video bytes.
 * - `bytes`: bytes for each chunk except the last, which holds the remainder.
 */
export const PartesDoVideo = z.object({
  n: z.number().int().min(1).max(VIDEO_PARTES_MAX),
  sha256: Sha256,
  bytes: z.number().int().min(1),
})
export type PartesDoVideo = z.infer<typeof PartesDoVideo>

/**
 * One chunk of video bytes, in the `video` field of a `typing` with `until: 0`.
 *
 * - `sha`: hash of the video it belongs to (the `partes.sha256` from the attachment).
 * - `parte`: position, from 0 to `de - 1`.
 * - `de`: total number of chunks.
 * - `dados`: this chunk's bytes, in base64url.
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
 * the door to formats we have no intention of supporting here.
 */
export const PosterDoVideo = z
  .string()
  .max(POSTER_MAX_CARACTERES)
  .regex(/^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/)

/** Whether a file type is one of the accepted video types. */
export function videoAceite(mediaType: string): boolean {
  return (VIDEO_TIPOS as readonly string[]).includes(mediaType)
}

/** Number of chunks for a video with `bytes` bytes. */
export function partesDoVideo(bytes: number, porParte = VIDEO_BYTES_POR_PARTE): number {
  return Math.max(1, Math.ceil(bytes / porParte))
}
