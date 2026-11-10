import { TECTO_DO_SOM_DO_ECRA, type FonteDeMedia } from "./wire.js"

/**
 * The source of MUSIC in a call: files or playlists played by a member.
 *
 * Phase 9 of `docs/planos/definicoes-0-9.md`. The DJ speaks and plays at the
 * same time: music is a track apart from the voice, like screen sound, but with
 * no image in front. So it can't be `ecra` (the server only accepts screen sound
 * behind the image of the same person, and whoever receives puts it behind the
 * "See").
 *
 * **Lives here, not in `FonteDeMedia` of `wire.ts`, for now only.** The wire
 * doesn't know the word `musica` yet: until it does, the gateway refuses an
 * `sfu.produce` with it, the SFU engine says so (`sfu-musica-recusada`) and
 * music stays on the mesh only. When `wire.ts` adds `"musica"` to `FonteDeMedia`,
 * this type becomes the same as it and nothing else changes.
 */
export const FONTE_DA_MUSICA = "musica" as const

/** A stream source, with music. See `FONTE_DA_MUSICA`. */
export type FonteDoFluxo = FonteDeMedia | typeof FONTE_DA_MUSICA

/**
 * The music cap, in bits per second: same as screen audio.
 *
 * Opus stereo at 64 kbps, the rate at which music stops sounding like a phone
 * call. Unlike screen audio, it does NOT count toward the screen cap: there's
 * no image dropping to make room for it. It counts on top, like an extra
 * person's voice speaking continuously (`docs/PLANO_SFU.md`, §7).
 */
export const TECTO_DA_MUSICA = TECTO_DO_SOM_DO_ECRA

/**
 * The cap for the name of what's playing, in characters.
 *
 * It's a file name, told to those on the call ("Now playing: …"). A name
 * longer than this is truncated by the sender, because the schema rejects the
 * full announcement and the call would stop announcing itself.
 */
export const TECTO_DO_NOME_DA_MUSICA = 200
