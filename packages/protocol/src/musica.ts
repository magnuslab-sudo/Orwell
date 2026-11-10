import { TECTO_DO_SOM_DO_ECRA, type FonteDeMedia } from "./wire.js"

/**
 * The source of MUSIC in a call: files or playlists played by a member.
 *
 * Phase 9 of `docs/planos/definicoes-0-9.md`. The DJ speaks and plays at the
 * same time: music is a track separate from the voice, like screen audio, but with
 * no video attached. So it can't be `ecra` (the server only accepts screen audio
 * behind the same person's video, and the receiver puts it behind the
 * "Ver" button).
 *
 * **It lives here, not in the `FonteDeMedia` of `wire.ts`, for now only.** The wire
 * doesn't know the word `musica` yet: until it does, the gateway rejects an
 * `sfu.produce` with it, the SFU engine reports it (`sfu-musica-recusada`) and
 * the music stays on the mesh only. When `wire.ts` adds `"musica"` to `FonteDeMedia`,
 * this type becomes identical to it and nothing else changes.
 */
export const FONTE_DA_MUSICA = "musica" as const

/** A stream source, with music. See `FONTE_DA_MUSICA`. */
export type FonteDoFluxo = FonteDeMedia | typeof FONTE_DA_MUSICA

/**
 * The music cap, in bits per second: the same as screen audio.
 *
 * Opus stereo at 64 kbps, the bitrate at which music stops sounding like a phone
 * call. Unlike screen audio, it does NOT count toward the screen cap: there's
 * no video stepping down to make room for it. It counts on top, like an extra
 * person's voice speaking continuously (`docs/PLANO_SFU.md`, §7).
 */
export const TECTO_DA_MUSICA = TECTO_DO_SOM_DO_ECRA

/**
 * The cap for the name of what's playing, in characters.
 *
 * It's a file name, shown to those on the call ("A tocar: …"). The sender
 * truncates a longer name, because the schema would reject the whole
 * announcement and the call would stop announcing what plays.
 */
export const TECTO_DO_NOME_DA_MUSICA = 200
