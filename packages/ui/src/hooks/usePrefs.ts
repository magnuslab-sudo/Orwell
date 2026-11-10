import { useCallback, useEffect, useState } from "react"
import type { Activity } from "../bridge.js"
import { ATALHOS_POR_OMISSAO, lerMapaDeAtalhos, type MapaDeAtalhos } from "../lib/atalhosDeVoz.js"
import { alternarSilencio, lerSilenciados } from "../lib/silenciados.js"
import { temAnfitriaoDeAvisos } from "../lib/notifications.js"

/**
 * Appearance preferences, persisted locally.
 *
 * localStorage rather than the vault on purpose: an accent colour is not a
 * secret, and reading it must work *before* the vault is unlocked so the gate
 * screens are already themed.
 *
 * Colour and density also sync to other devices on the account (phase 5):
 * `localStorage` is this device's copy, and the account pushes when it opens.
 * See `lib/preferenciasDaConta.ts`, which also documents what stays here only.
 */

export const PREFS_KEY = "enclave.prefs"

/**
 * Tells the page that preferences changed in this same tab.
 *
 * The browser's `storage` event only fires in OTHER tabs. Anything mounted
 * here-the call dock, for example-would never notice a change made in Settings,
 * and the output volume would only take effect on the next mount.
 */
export const PREFS_EVENT = "enclave:prefs"

/**
 * Accent colours over the midnight skin (`tokens.css`).
 *
 * The index is what gets saved (here and on the account, `interface.cor`),
 * so each spot inherited the closest shade from the previous palette: Mint
 * became Green, Amber stayed Amber, Coral became Pink, Sky became Indigo,
 * and Lilac, which was the default, became Cyan, which is the skin's default.
 * Anyone who never chose stays on the slate's cyan.
 *
 * On midnight skin the accent is bright and the fill is the accent itself
 * (`deep` equals `accent`), with dark ink `--on-accent` on top. Contrast is
 * measured in `usePrefs.test.ts`: ink over each accent, and each accent as
 * small text over each surface, all at 4.5:1 or better.
 */
export const ACCENTS = [
  { name: "Verde", accent: "#50fa7b", deep: "#50fa7b" },
  { name: "Âmbar", accent: "#ffb86c", deep: "#ffb86c" },
  { name: "Rosa", accent: "#e070a8", deep: "#e070a8" },
  { name: "Índigo", accent: "#8b93e0", deep: "#8b93e0" },
  { name: "Ciano", accent: "#8be9fd", deep: "#8be9fd" },
] as const

export type Density = "confortavel" | "compacta"

export interface Prefs {
  /** The activity chosen for this device. Read before the first connect, so
   * an invisible account never flashes online on reload. */
  activity: Activity
  accent: number
  density: Density
  /**
   * System alerts. ON by default since November 2, 2026 (owner directive:
   * "notifications on by default at 100 percent"). On the browser they only
   * show with browser permission; on the desktop app they show via the main
   * process.
   */
  notifications: boolean
  /**
   * The desktop app has read `notifications` since the fix on 2/11/2026.
   * Before that, the toggle was locked ("blocked by the browser"), and the
   * stored `false` was never a choice: the first read in the app turns them on
   * once, and from then on the user's preference applies.
   */
  avisosDaAppRevistos: boolean
  /** Whether a notification may carry the sender and text. Off by default:
   * the OS notification centre is outside the app's encryption boundary. */
  notifyPreview: boolean
  /** Short synthesised tones for arrivals. On by default, unlike the OS
   * notifications, this needs no permission and never leaves the page. */
  sounds: boolean
  /** 0-100. At 100 by default since November 2, 2026 (was 50), by owner directive. */
  soundVolume: number
  /**
   * How loud EVERYONE is in a call, from 0 to 2.
   *
   * Sister to per-person volume (`useVolumes`) and intentionally separate:
   * one slider per person fixes "this person is quiet", not "everyone is quiet"-
   * for that you'd drag one slider per person you talk to, in every call.
   * This one multiplies the other.
   *
   * Not `soundVolume`, which is the notification tones for messages.
   */
  outputVolume: number
  /**
   * What the microphone does to sound before it leaves here.
   *
   * All this happens on the speaker's machine, inside the browser, and nothing
   * goes anywhere else to be processed. That is why it can be turned on freely-
   * unlike nearly all other audio enhancement, which usually sends your voice
   * to a server.
   *
   * On by default. Off when they get in the way: noise suppression eats the
   * start of words in quiet voices, and auto gain makes silence breathe in
   * large rooms.
   */
  noiseSuppression: boolean
  echoCancellation: boolean
  autoGainControl: boolean
  /**
   * This room's processing, done after what the browser does.
   *
   * Cuts low noise-fan, air conditioning, desk rattle, breath on the mic-
   * and caps peaks at the output, which stops gain from shredding the sound.
   * Does not replace the browser's suppressor: adds to it, so there are two
   * switches, not one.
   */
  filtroDeMicrofone: boolean
  /** Requested resolution when entering with video. The browser gives what it can. */
  videoQuality: VideoQuality
  /**
   * The microphone is muted.
   *
   * Lives here, not in the call, because the choice comes before it: on the
   * identity card you mute before entering anywhere, and the choice must
   * carry to the next call and tomorrow's. A call lasts minutes; this is a
   * device preference.
   */
  micMuted: boolean
  /**
   * Hear nobody-and as a result, be heard by nobody.
   *
   * Not the same as `sounds`, which are message notification tones. This is
   * call audio: turning it off silences incoming voices and also mutes our
   * microphone, because being in a conversation you cannot hear and answering
   * without knowing is the worst of both. `micMuted` stays intact underneath,
   * so turning sound back on returns the mic to where the person left it.
   */
  soundOff: boolean
  /**
   * Which microphone to open, by the browser's device ID. Empty means "let the
   * system decide", and that is the factory default.
   *
   * Saved even though the ID is not eternal: it changes when permissions are
   * revoked, and a disconnected device stops matching anything. We save it
   * anyway because the common case is the same person on the same computer
   * with the same headset, and then the choice lasts forever. When it does not,
   * capture has a fallback path-see `Call`.
   */
  inputDeviceId: string
  /**
   * How much to amplify the microphone, from 0 to 2. 1 is capture as-is.
   *
   * Not the same as `autoGainControl`: that lets the browser decide moment by
   * moment, and this is a fixed choice by someone who knows their mic is quiet.
   * They can coexist, which is why there are two options.
   */
  inputGain: number
  /**
   * Recently used emojis, newest first.
   *
   * Lives here with everything else: it is a device preference, not vault.
   * It is no secret either-and never leaves here, just as emojis never came
   * from anywhere else.
   */
  emojiRecents: string[]
  /** The keyboard shortcuts for voice commands. See `lib/atalhosDeVoz.ts`. */
  atalhosDeVoz: MapaDeAtalhos
  /**
   * Moment phrases the person has dismissed ("Got it"). See `FraseDoMomento`.
   *
   * Per device, like everything else: each device has its own first channel
   * and first call, and a phrase shown on another device was not read on this one.
   */
  frasesVistas: string[]
  /**
   * The "Broadcast volume" of the DJ, from 0 to 1: how much music GOES OUT
   * to the call (owner, October 27, 2026). Per device: it is this computer's
   * level and these files, and does not travel with the account.
   */
  volumeDaEmissao: number
  /**
   * People whose MUSIC is muted on this device ("Mute music"). Their voice
   * still comes through, and the music slider keeps its value for when you
   * listen again. Per device, like volumes.
   */
  musicasCaladas: string[]
  /**
   * Rooms, channels, and private chats that are silenced: no sound, no system
   * alert, no unread count (a mention still lights up). Keys and rules in
   * `lib/silenciados.ts`. This is the PERSON's choice, not the device: it
   * travels with the account in `lib/preferenciasDaConta.ts`.
   */
  silenciados: string[]
  /**
   * Auto-lock the vault after this much idle time, in minutes. 0 means never.
   *
   * 15 minutes by default, like a phone screen: a laptop left open in a cafe
   * is the case this closes. Per device, not account: home and work computers
   * need different times. `useBloqueioAutomatico` in `App.tsx` does the locking.
   */
  bloqueioAutomatico: BloqueioAutomatico
  /**
   * "Pause" notifications: until this time (milliseconds since 1970), nothing
   * plays and nothing goes to the OS, except calls. 0 means no pause, and a
   * time already past also means no pause. We store the END time, not the
   * duration: the pause ends at the right time even if the app closes in
   * between. Per device, like sounds. See `estaEmPausa`.
   */
  pausaAte: number
  /**
   * "Join calls with microphone muted". On, every entry to a voice room or
   * call starts with the mic silenced (`micMuted`), and the person unmutes
   * when ready to speak. Off by default, for the same reason as `micMuted`:
   * joining and nobody hearing you without you asking is a bug.
   */
  entrarSilenciado: boolean
  /**
   * "Notify when a friend comes online" (Notifications), like MSN: an alert
   * with their picture and name, plus a short sound (item 6, November 2, 2026).
   * On by default: it is what the community asked for, and a click turns it off.
   * See `lib/amigosOnline.ts`.
   */
  avisarAmigosOnline: boolean
  /**
   * Other friend alerts (Notifications › "Friend alerts", owner request
   * November 3, 2026): joined a voice room, sharing screen, joined a community
   * we are in. On by default, like the online alert: only an explicit `false`
   * turns them off. Per device. See `lib/avisosDeAmigos.ts`.
   */
  avisarAmigosNaVoz: boolean
  avisarAmigosNoEcra: boolean
  avisarAmigosNaComunidade: boolean
  /**
   * Which camera to open, by the browser's device ID. Empty means "let the
   * system decide". Same caveats as `inputDeviceId`.
   */
  videoDeviceId: string
  /**
   * See your own picture mirrored, like in a bathroom mirror. Only on your
   * screen: the video going out to others does not change. On by default,
   * because that is what everyone expects from their own face (and from raising
   * your right hand and seeing the hand on the wrong side).
   */
  espelharCamara: boolean
  /**
   * "Who can send me friend requests" (Privacy). Applied on the RECEIVER's
   * side: a request from someone outside the rule does not show in the bell
   * or in Received, and does not play a sound. It is not deleted: changing
   * the rule shows it. Travels with the account (`lib/privacidadeDaConta.ts`):
   * it is the person's choice. See `lib/privacidade.ts`.
   */
  pedidosDeAmizade: QuemPodePedir
  /**
   * "Show when I am online". Off, presence shows as "Invisible" (same path as
   * the card state), no matter what state is chosen. Travels with the account,
   * like the request rule.
   */
  mostrarOnline: boolean
  /**
   * "Show game overlay" (Voice, desktop app only). OFF by default since
   * November 2, 2026 (owner directive: "disable overlay by default for now").
   * Only shows in a call and with the Orwell window behind another app, and
   * the hotkey hides it. Per device: it is a window on this computer.
   *
   * The saved name changed from `overlayDeJogo` to `overlayDeJogoLigada` on
   * purpose: preferences save in full on every change, and anyone with 1.0.7
   * or 1.0.8 got `overlayDeJogo: true` without choosing it. With the new
   * name, that old value no longer counts and the overlay stays off until
   * the person turns it on.
   */
  overlayDeJogoLigada: boolean
  /** The overlay's background opacity, from 0.2 to 1. Per device, like the overlay. */
  opacidadeDaOverlay: number
  /**
   * "Microphone sensitivity" › "Automatic" (owner, November 2, 2026). On by
   * default: the usual gate, which tracks room noise. Off, the mic only
   * transmits above `limiarDoMicrofone`. Per device, like input volume: it is
   * this microphone and this room.
   */
  sensibilidadeAutomatica: boolean
  /**
   * The manual sensitivity line, in dBFS, from -80 to 0 (integers). Only used
   * when `sensibilidadeAutomatica` is off; saved anyway so you can go back to
   * the old line. See `client-core/src/audio/README.md`.
   */
  limiarDoMicrofone: number
}

/** The factory default for manual sensitivity: below a normal voice (-30 to -20 dBFS), above a quiet room. */
export const LIMIAR_POR_OMISSAO = -50
export const LIMIAR_MINIMO = -80
export const LIMIAR_MAXIMO = 0

/** Who can request to be friends. See `Prefs.pedidosDeAmizade`. */
export const REGRAS_DE_PEDIDOS = ["todos", "amigos-de-amigos", "ninguem"] as const
export type QuemPodePedir = (typeof REGRAS_DE_PEDIDOS)[number]

/** The durations that "Lock alone" offers, in minutes. 0 means "Never". */
export const TEMPOS_DE_BLOQUEIO = [0, 15, 60] as const
export type BloqueioAutomatico = (typeof TEMPOS_DE_BLOQUEIO)[number]

/** Three rows of eight. Beyond that, it stops being "recent" and becomes a
 * second catalogue, sorted worse than the real one. */
export const EMOJI_RECENTS_MAX = 24

/** Requested video resolution. "auto" lets the browser choose. */
export type VideoQuality = "auto" | "360p" | "720p" | "1080p"

export const DEFAULT_PREFS: Prefs = {
  activity: "online",
  /** Cyan (was Lilac, in the same place). Stored prefs carry an index, so
   * changing the default never touches anyone who already picked a colour,    * only fresh installs. */
  accent: 4,
  density: "confortavel",
  notifications: true,
  avisosDaAppRevistos: false,
  notifyPreview: false,
  sounds: true,
  soundVolume: 100,
  /** 1 is the sound as it arrives: amplifying by default would decide for
   *  everyone's ears. */
  outputVolume: 1,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  /** On by factory default: what it cuts out is not speech, and the limiter that
   *  comes with it is what stops this device's gain from distorting the sound. */
  filtroDeMicrofone: true,
  /**
   * 720p by default, no longer "auto".
   *
   * "Auto" means asking nothing of the browser, and what Chrome gives when you
   * ask nothing is 640×480. The settings screen offered 720p all along, but
   * anyone who never went there-which is everyone-sent 480p. A 720p camera
   * that only exists for those who find the menu is not a 720p camera.
   *
   * It costs the server no more in the worst case: what it pays is the cap
   * (`TECTO_DA_CAMARA`), and the cap does not change with the requested
   * resolution. It costs more in the typical case, and that is stated in full-a
   * 480p camera used close to half the cap, and from here on uses almost all of
   * it. It also costs encoding on the sender's machine; where it cannot reach,
   * Chrome drops the resolution on its own, which is exactly what it did before
   * due to lack of cap (measured in `scripts/sfu-prova-720p/`).
   */
  videoQuality: "720p",
  /** Off by factory default: entering a call and nobody hearing us is a fault,
   *  not a factory state. */
  micMuted: false,
  soundOff: false,
  /** No choice: the system opens whichever microphone it wants, as it always has. */
  inputDeviceId: "",
  inputGain: 1,
  emojiRecents: [],
  atalhosDeVoz: ATALHOS_POR_OMISSAO,
  frasesVistas: [],
  volumeDaEmissao: 1,
  musicasCaladas: [],
  silenciados: [],
  bloqueioAutomatico: 15,
  pausaAte: 0,
  entrarSilenciado: false,
  avisarAmigosOnline: true,
  avisarAmigosNaVoz: true,
  avisarAmigosNoEcra: true,
  avisarAmigosNaComunidade: true,
  videoDeviceId: "",
  espelharCamara: true,
  pedidosDeAmizade: "todos",
  mostrarOnline: true,
  overlayDeJogoLigada: false,
  opacidadeDaOverlay: 0.45,
  sensibilidadeAutomatica: true,
  limiarDoMicrofone: LIMIAR_POR_OMISSAO,
}

/**
 * Read the list of recents from any registry that was on disk.
 *
 * A glyph can have multiple code points (flags have two, ZWJ sequences have
 * more), so the limit counts characters with slack instead of demanding just
 * one. Anything that is not text, or is text too long to be an emoji, is junk
 * and does not enter-the list is read into `aria-label`s and buttons, and an
 * absurd value there is an absurd button.
 */
function readEmojiRecents(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 16) continue
    seen.add(entry)
    if (seen.size >= EMOJI_RECENTS_MAX) break
  }
  return [...seen]
}

/**
 * The identifiers of closed phrases, read from any registry.
 *
 * They are short names that the code picks ("account", "channel"); anything
 * that is not short text is junk and does not enter. The cap is wide for the
 * phrases that exist, and exists only so a corrupted registry does not grow
 * without end.
 */
function lerFrasesVistas(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  const vistas = new Set<string>()
  for (const id of valor) {
    if (typeof id === "string" && id.length > 0 && id.length <= 32) vistas.add(id)
    if (vistas.size >= 32) break
  }
  return [...vistas]
}

/**
 * The addresses whose sound was muted. Only text starting with `@` (an
 * address), and with a cap: nobody tells this registry that a person stopped
 * existing, and the latest ones are what matter (as in `useVolumes`).
 */
export const MUSICAS_CALADAS_MAX = 200

function lerMusicasCaladas(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  const caladas = new Set<string>()
  for (const morada of valor) {
    if (typeof morada === "string" && morada.startsWith("@") && morada.length <= 256) caladas.add(morada)
  }
  return [...caladas].slice(-MUSICAS_CALADAS_MAX)
}

/**
 * Tolerant read: missing key, broken JSON or junk values all yield defaults.
 *
 * The `chosen` marker is the migration for a past sin: an early version wrote
 * the defaults back to storage on every launch, so everyone has a record that
 * looks like a choice. A record without the marker is one of those automatic
 * writes — its old-default accent (Menta, index 0) is treated as never chosen
 * and receives the current default, while any non-default value in it proves
 * a real choice and is kept.
 */
export function readPrefs(storage: Pick<Storage, "getItem"> = localStorage): Prefs {
  try {
    const raw = storage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as (Partial<Prefs> & { chosen?: boolean }) | null
    const chosen = parsed?.chosen === true
    let accent =
      typeof parsed?.accent === "number" && Number.isInteger(parsed.accent) && parsed.accent >= 0 && parsed.accent < ACCENTS.length
        ? parsed.accent
        : DEFAULT_PREFS.accent
    if (!chosen && accent === 0) accent = DEFAULT_PREFS.accent
    const density: Density = parsed?.density === "compacta" ? "compacta" : "confortavel"
    const activity: Prefs["activity"] =
      parsed?.activity === "ocupado" || parsed?.activity === "ausente" || parsed?.activity === "invisivel"
        ? parsed.activity
        : "online"
    // A volume outside 0–100, or not a number at all, is junk: take the default
    // rather than a value that would either deafen or silence by accident.
    const soundVolume =
      typeof parsed?.soundVolume === "number" &&
      Number.isFinite(parsed.soundVolume) &&
      parsed.soundVolume >= 0 &&
      parsed.soundVolume <= 100
        ? Math.round(parsed.soundVolume)
        : DEFAULT_PREFS.soundVolume
    // Anything that is not exactly `true` means off: the safe reading of junk.
    return {
      activity,
      accent,
      density,
      // On by factory default; on the desktop app, on once after review
      // (see `avisosDaAppRevistos`). After that, only an explicit `false` turns them off.
      notifications:
        temAnfitriaoDeAvisos() && parsed?.avisosDaAppRevistos !== true ? true : parsed?.notifications !== false,
      avisosDaAppRevistos: temAnfitriaoDeAvisos() || parsed?.avisosDaAppRevistos === true,
      notifyPreview: parsed?.notifyPreview === true,
      // Default-on, so the safe reading flips: only an explicit `false` mutes.
      sounds: parsed?.sounds !== false,
      soundVolume,
      // Outside 0-2, or not a number, defaults to 1: the sound as it arrives. A
      // value read from junk is the difference between hearing and getting an earful.
      outputVolume:
        typeof parsed?.outputVolume === "number" &&
        Number.isFinite(parsed.outputVolume) &&
        parsed.outputVolume >= 0 &&
        parsed.outputVolume <= 2
          ? parsed.outputVolume
          : 1,
      // Same: on by factory default, only an explicit `false` turns them off.
      noiseSuppression: parsed?.noiseSuppression !== false,
      echoCancellation: parsed?.echoCancellation !== false,
      autoGainControl: parsed?.autoGainControl !== false,
      filtroDeMicrofone: parsed?.filtroDeMicrofone !== false,
      // Whoever chose, chose-including whoever chose "auto". What changes is
      // only what is read from storage with nothing written: 720p, as above.
      videoQuality:
        parsed?.videoQuality === "auto" ||
        parsed?.videoQuality === "360p" ||
        parsed?.videoQuality === "720p" ||
        parsed?.videoQuality === "1080p"
          ? parsed.videoQuality
          : DEFAULT_PREFS.videoQuality,
      // Only an explicit `true` mutes. Junk reads as "not muted", which is the
      // safe state for these two: reading wrong means a person is heard when they
      // did not expect it-bad-but the reverse is a person speaking to empty air
      // and losing the conversation with nothing to explain it.
      micMuted: parsed?.micMuted === true,
      soundOff: parsed?.soundOff === true,
      inputDeviceId: typeof parsed?.inputDeviceId === "string" ? parsed.inputDeviceId : "",
      // Outside the range, or not a number, defaults to 1: capture as the system
      // gives it. A gain read from junk is the difference between a normal voice
      // and a distorted voice, and the safe value is to touch nothing.
      inputGain:
        typeof parsed?.inputGain === "number" && parsed.inputGain >= 0 && parsed.inputGain <= 2
          ? parsed.inputGain
          : 1,
      emojiRecents: readEmojiRecents(parsed?.emojiRecents),
      atalhosDeVoz: lerMapaDeAtalhos(parsed?.atalhosDeVoz),
      frasesVistas: lerFrasesVistas(parsed?.frasesVistas),
      // Outside 0-1 defaults to 1: the music comes out as played. A value read from
      // junk cannot mute the broadcast without the DJ knowing why.
      volumeDaEmissao:
        typeof parsed?.volumeDaEmissao === "number" &&
        Number.isFinite(parsed.volumeDaEmissao) &&
        parsed.volumeDaEmissao >= 0 &&
        parsed.volumeDaEmissao <= 1
          ? parsed.volumeDaEmissao
          : 1,
      musicasCaladas: lerMusicasCaladas(parsed?.musicasCaladas),
      silenciados: lerSilenciados(parsed?.silenciados),
      // Only one of the offered durations. Junk defaults to the factory 15 minutes,
      // not "Never": reading wrong cannot leave a vault open for ever.
      bloqueioAutomatico: (TEMPOS_DE_BLOQUEIO as readonly unknown[]).includes(parsed?.bloqueioAutomatico)
        ? (parsed?.bloqueioAutomatico as BloqueioAutomatico)
        : DEFAULT_PREFS.bloqueioAutomatico,
      // Junk reads as "no pause": reading wrong cannot mute alerts without the
      // person knowing.
      pausaAte:
        typeof parsed?.pausaAte === "number" && Number.isFinite(parsed.pausaAte) && parsed.pausaAte > 0
          ? parsed.pausaAte
          : 0,
      entrarSilenciado: parsed?.entrarSilenciado === true,
      // On by factory default: only an explicit `false` turns it off.
      avisarAmigosOnline: parsed?.avisarAmigosOnline !== false,
      // The same ones, read separately: turning off the online one in an old value
      // does not turn these off, and an old value without these keys gets them on.
      avisarAmigosNaVoz: parsed?.avisarAmigosNaVoz !== false,
      avisarAmigosNoEcra: parsed?.avisarAmigosNoEcra !== false,
      avisarAmigosNaComunidade: parsed?.avisarAmigosNaComunidade !== false,
      videoDeviceId: typeof parsed?.videoDeviceId === "string" ? parsed.videoDeviceId : "",
      espelharCamara: parsed?.espelharCamara !== false,
      // Junk defaults to "Everyone", which is the behaviour before this option:
      // reading wrong cannot hide requests without the person knowing why.
      pedidosDeAmizade: (REGRAS_DE_PEDIDOS as readonly unknown[]).includes(parsed?.pedidosDeAmizade)
        ? (parsed?.pedidosDeAmizade as QuemPodePedir)
        : "todos",
      mostrarOnline: parsed?.mostrarOnline !== false,
      // On by factory default: only an explicit `false` turns it off.
      overlayDeJogoLigada: parsed?.overlayDeJogoLigada === true,
      // Outside 0.2-1 defaults to 0.45 (was 0.6 until 2/11/2026: "raises the transparency a bit"): an invisible pill read from junk would not be found.
      opacidadeDaOverlay:
        typeof parsed?.opacidadeDaOverlay === "number" &&
        Number.isFinite(parsed.opacidadeDaOverlay) &&
        parsed.opacidadeDaOverlay >= 0.2 &&
        parsed.opacidadeDaOverlay <= 1
          ? parsed.opacidadeDaOverlay
          : DEFAULT_PREFS.opacidadeDaOverlay,
      // Only an explicit `false` switches to manual: reading wrong cannot mute
      // anyone's microphone over a line they never set.
      sensibilidadeAutomatica: parsed?.sensibilidadeAutomatica !== false,
      // Outside -80 to 0, or not a number, defaults to the factory line.
      limiarDoMicrofone:
        typeof parsed?.limiarDoMicrofone === "number" &&
        Number.isFinite(parsed.limiarDoMicrofone) &&
        parsed.limiarDoMicrofone >= LIMIAR_MINIMO &&
        parsed.limiarDoMicrofone <= LIMIAR_MAXIMO
          ? Math.round(parsed.limiarDoMicrofone)
          : LIMIAR_POR_OMISSAO,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

/** Are notifications paused right now? See `Prefs.pausaAte`. */
export function estaEmPausa(prefs: Pick<Prefs, "pausaAte">, agora = Date.now()): boolean {
  return prefs.pausaAte > agora
}

/**
 * The end time of each pause that Notifications offer.
 *
 * "Until tomorrow" is at 8 AM the next day, in this device's time, not 24
 * hours from now. Before 5 AM, "tomorrow" is the morning after sleep, meaning
 * 8 AM today: someone who pauses at 1 AM does not want the whole day silenced.
 */
export type DuracaoDaPausa = "1h" | "8h" | "amanha"
export const DURACOES_DA_PAUSA: readonly DuracaoDaPausa[] = ["1h", "8h", "amanha"]
export function fimDaPausa(duracao: DuracaoDaPausa, agora = new Date()): number {
  if (duracao === "1h") return agora.getTime() + 3_600_000
  if (duracao === "8h") return agora.getTime() + 8 * 3_600_000
  const amanha = new Date(agora)
  if (agora.getHours() >= 5) amanha.setDate(amanha.getDate() + 1)
  amanha.setHours(8, 0, 0, 0)
  return amanha.getTime()
}

/** Persist an explicit choice. Only setters call this — never a mount. */
export function writePrefs(prefs: Prefs, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify({ ...prefs, chosen: true }))
  } catch {
    // Storage full or blocked. The choice still applies for this session.
  }
  // Outside the `try`: the choice applies to this session even when the disk
  // refuses, and whoever is showing it has to see it anyway. See `PREFS_EVENT`.
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PREFS_EVENT))
}

/**
 * Push the choice onto the document root, where the CSS tokens live.
 *
 * The colour and density are ALWAYS the originals (the cyan skin and
 * "Comfortable"), no matter what is stored. The choice left settings at 0.9:
 * five accents and two densities were ten combinations to measure on each
 * screen, and almost no one changed them. What was already stored (here or
 * from the account) stays on disk and is not erased; it just stops driving the
 * screen. The argument stays the whole object so the caller does not change.
 */
export function applyPrefs(prefs: Prefs): void {
  const origem = ACCENTS[DEFAULT_PREFS.accent] ?? ACCENTS[0]
  document.documentElement.style.setProperty("--acento", origem.accent)
  document.documentElement.style.setProperty("--accent", origem.accent)
  document.documentElement.style.setProperty("--accent-deep", origem.deep)
  document.documentElement.dataset.density = DEFAULT_PREFS.density
  // The mirror of the camera itself is CSS (`[data-espelho]` in `screens.css`):
  // only the screen of the person viewing themselves changes, and the video that
  // goes out stays as the camera gives it.
  document.documentElement.dataset.espelho = prefs.espelharCamara === false ? "nao" : "sim"
}

/** The keys that `setPreferencia` changes. Each stage 4 checkpoint adds its own. */
export type PreferenciaDaFase4 =
  | "bloqueioAutomatico"
  | "pausaAte"
  | "entrarSilenciado"
  | "avisarAmigosOnline"
  | "avisarAmigosNaVoz"
  | "avisarAmigosNoEcra"
  | "avisarAmigosNaComunidade"
  | "espelharCamara"
  | "pedidosDeAmizade"
  | "mostrarOnline"
  | "overlayDeJogoLigada"
  | "opacidadeDaOverlay"

export function usePrefs(): {
  prefs: Prefs
  setNotifications: (notifications: boolean) => void
  setNotifyPreview: (notifyPreview: boolean) => void
  setSounds: (sounds: boolean) => void
  setSoundVolume: (soundVolume: number) => void
  /** How loud everyone is in a call, from 0 to 2. */
  setOutputVolume: (outputVolume: number) => void
  /** Microphone and camera. One patch at a time, like everything else. */
  setMediaPref: (
    patch: Partial<
      Pick<
        Prefs,
        | "noiseSuppression"
        | "echoCancellation"
        | "autoGainControl"
        | "filtroDeMicrofone"
        | "videoQuality"
        | "inputDeviceId"
        | "inputGain"
        | "videoDeviceId"
        | "sensibilidadeAutomatica"
        | "limiarDoMicrofone"
      >
    >,
  ) => void
  setAtalhosDeVoz: (atalhosDeVoz: MapaDeAtalhos) => void
  /** A moment phrase was closed: do not show it again on this device. */
  marcarFraseVista: (id: string) => void
  /** Mute or unmute a room, a channel, or a conversation. See `lib/silenciados.ts`. */
  alternarSilencio: (chave: string) => void
  /**
   * The new choices from 0.9 (stage 4) that do not go to the core. One patch at
   * a time, onto disk, like everything else.
   */
  setPreferencia: (patch: Partial<Pick<Prefs, PreferenciaDaFase4>>) => void
} {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs)

  // Apply on every change, including mount — but never write on mount:
  // an automatic write is indistinguishable from a choice, and that lie is
  // exactly what the `chosen` migration above exists to clean up.
  useEffect(() => {
    applyPrefs(prefs)
  }, [prefs])

  /** An explicit change: the only path that persists. Idempotent under
   * StrictMode's double-invoked updaters. */
  const choose = useCallback((patch: Partial<Prefs>) => {
    setPrefs(() => {
      // Merged over what is ON DISK, never over this hook's snapshot. The
      // activity menu in the sidebar writes prefs directly while this screen
      // is mounted, so a stale snapshot here would put "online" back over a
      // choice of "invisível" the next time somebody changed the accent, a
      // privacy setting silently undone by an unrelated click.
      const next = { ...readPrefs(), ...patch }
      writePrefs(next)
      return next
    })
  }, [])

  /*
    Account preferences from another device arrive via `PREFS_EVENT` (see
    `lib/preferenciasDaConta.ts`). They are re-read after the event, not within it:
    `choose` also fires it from inside its own `setPrefs`.
  */
  useEffect(() => {
    if (typeof window === "undefined") return
    const reler = (): void =>
      queueMicrotask(() =>
        setPrefs((antes) => {
          const agora = readPrefs()
          return JSON.stringify(agora) === JSON.stringify(antes) ? antes : agora
        }),
      )
    window.addEventListener(PREFS_EVENT, reler)
    return () => window.removeEventListener(PREFS_EVENT, reler)
  }, [])

  // Color and density no longer have toggles (see `applyPrefs`): there is no
  // `setAccent` or `setDensity`, and no gesture here sends them to the account.
  const setNotifications = useCallback((notifications: boolean) => choose({ notifications }), [choose])
  const setNotifyPreview = useCallback((notifyPreview: boolean) => choose({ notifyPreview }), [choose])
  const setSounds = useCallback((sounds: boolean) => choose({ sounds }), [choose])
  const setSoundVolume = useCallback((soundVolume: number) => choose({ soundVolume }), [choose])
  const setOutputVolume = useCallback((outputVolume: number) => choose({ outputVolume }), [choose])

  return {
    prefs,
    setNotifications,
    setNotifyPreview,
    setSounds,
    setSoundVolume,
    setOutputVolume,
    setMediaPref: choose,
    setAtalhosDeVoz: (atalhosDeVoz: MapaDeAtalhos) => choose({ atalhosDeVoz }),
    // Read from disk when tapped, like `choose`: two messages on different
    // screens do not erase each other.
    marcarFraseVista: (id: string) => {
      const vistas = readPrefs().frasesVistas
      if (!vistas.includes(id)) choose({ frasesVistas: [...vistas, id] })
    },
    // From disk when tapped, for the same reason: muting in two consecutive menus
    // cannot lose the first one.
    alternarSilencio: (chave: string) => choose({ silenciados: alternarSilencio(readPrefs().silenciados, chave) }),
    setPreferencia: choose,
  }
}

/* ------------------------------------------------- what is collapsed */

/**
 * What the user collapsed in the sidebar: channels, categories, and voice
 * room member lists.
 *
 * Separate key from appearance preferences, on purpose. This is not an aesthetic
 * choice made once. It is a list that grows with channels joined and rewrites
 * at each click on a triangle. Putting it inside `Prefs` would rewrite the entire
 * preferences record (accent, sound, microphone) whenever someone collapsed a
 * category, and would move navigation data alongside appearance data.
 *
 * Stored locally like everything else: what is open in the sidebar on one
 * device is nobody else's business, much less the server's.
 */
export const COLLAPSED_KEY = "enclave.collapsed"

/**
 * Cap on what is stored.
 *
 * A collapsed key for a channel that no longer exists is never deleted by
 * anything. Nobody tells the sidebar that a channel was forgotten. Without a cap,
 * the record would grow forever. The latest entries are what matter: they were
 * collapsed most recently.
 */
const COLLAPSED_MAX = 300

/** Tolerant read, like `readPrefs`: missing key, broken JSON, or garbage all
 *  return the same thing. Nothing collapsed, which is the safe state. */
export function readCollapsed(storage: Pick<Storage, "getItem"> = localStorage): Set<string> {
  try {
    const raw = storage.getItem(COLLAPSED_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter((key): key is string => typeof key === "string" && key.length > 0).slice(-COLLAPSED_MAX),
    )
  } catch {
    return new Set()
  }
}

export function writeCollapsed(keys: Set<string>, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(COLLAPSED_KEY, JSON.stringify([...keys].slice(-COLLAPSED_MAX)))
  } catch {
    // Storage full or locked. Applies to this session only.
  }
}

export function useCollapsed(): {
  /** Is it collapsed? The key is compound, built by whoever renders the list. */
  isCollapsed: (key: string) => boolean
  toggleCollapsed: (key: string) => void
  /**
   * Open without closing anything: idempotent, unlike toggle.
   *
   * Exists for navigation, not for collapsing. A channel row with an active call
   * goes to its room, and if the tree is collapsed the room is not on screen.
   * A `toggleCollapsed` there would close the tree for someone who had it open,
   * which is the opposite of what the gesture asks. See `onSelectChannel` in
   * `ChannelSidebar`.
   */
  mostrar: (key: string) => void
} {
  const [keys, setKeys] = useState<Set<string>>(readCollapsed)

  const toggleCollapsed = useCallback((key: string) => {
    // Reads disk instead of this instance's state, for the same reason `choose`
    // above does: another screen may have written in the meantime. And calculated
    // OUTSIDE `setKeys` because toggling is not idempotent. An updater called
    // twice (StrictMode) would undo the click itself.
    const next = readCollapsed()
    if (!next.delete(key)) next.add(key)
    writeCollapsed(next)
    setKeys(next)
  }, [])

  const mostrar = useCallback((key: string) => {
    // Read from disk for the same reason as `toggleCollapsed`, and does not write
    // when already open: a `setKeys` with a new `Set` at each click would redraw
    // the entire list for nothing.
    const next = readCollapsed()
    if (!next.delete(key)) return
    writeCollapsed(next)
    setKeys(next)
  }, [])

  const isCollapsed = useCallback((key: string) => keys.has(key), [keys])

  return { isCollapsed, toggleCollapsed, mostrar }
}

/* ------------------------------------------------- seen onboarding cards */

/**
 * Channels whose onboarding card was already read on this device.
 *
 * Local like everything here: that someone saw an onboarding card is no server's
 * business, and sending it to the vault would require waiting for unlock to know
 * whether to render it. The card would flicker at every startup.
 *
 * A set of IDs, not a boolean: a user can have accounts on different servers
 * in the same browser, and each common channel onboards once. The ID never
 * reaches the screen from here. It is just the key.
 */
export const APRESENTADOS_KEY = "enclave.apresentados"

/** Cap, for the same reason as `COLLAPSED_MAX`: nothing deletes old entries. */
const APRESENTADOS_MAX = 50

/** Tolerant read like all here: garbage reads as "nothing seen", the safe
 *  state. Show the card once more, never less. */
export function readApresentados(storage: Pick<Storage, "getItem"> = localStorage): Set<string> {
  try {
    const raw = storage.getItem(APRESENTADOS_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter((key): key is string => typeof key === "string" && key.length > 0).slice(-APRESENTADOS_MAX),
    )
  } catch {
    return new Set()
  }
}

export function marcarApresentado(
  channel: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): Set<string> {
  // Read from disk not a snapshot: another tab may have written, and the cost
  // of losing this write is the card reappearing.
  const next = readApresentados(storage)
  next.add(channel)
  try {
    storage.setItem(APRESENTADOS_KEY, JSON.stringify([...next].slice(-APRESENTADOS_MAX)))
  } catch {
    // Storage full or locked. Applies to this session only.
  }
  return next
}

/**
 * Channels whose accepted invite we no longer wait for, with the TIME we
 * stopped waiting: the channel arrived (and may have been left afterward) or
 * the user clicked "Cancel".
 *
 * On disk because the invite folder shows "accepted" for fourteen days, and
 * without this the "waiting" row would return at each reload, even for a channel
 * the user left. The time is what lets a NEW invite for the same channel through:
 * only an invite older than the mark is hidden. Same pattern as `APRESENTADOS_KEY`:
 * cap, tolerant read, and the worst case of losing a write is the row coming back.
 */
export const ESPERAS_FEITAS_KEY = "enclave.esperasFeitas"
const ESPERAS_FEITAS_MAX = 200

export function readEsperasFeitas(storage: Pick<Storage, "getItem"> = localStorage): Map<string, number> {
  try {
    const raw = storage.getItem(ESPERAS_FEITAS_KEY)
    if (!raw) return new Map()
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map()
    const entradas = Object.entries(parsed as Record<string, unknown>).filter(
      (entrada): entrada is [string, number] =>
        entrada[0].length > 0 && typeof entrada[1] === "number" && Number.isFinite(entrada[1]),
    )
    return new Map(entradas.sort((a, b) => a[1] - b[1]).slice(-ESPERAS_FEITAS_MAX))
  } catch {
    return new Map()
  }
}

export function marcarEsperasFeitas(
  canais: readonly string[],
  agora = Date.now(),
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): Map<string, number> {
  const next = readEsperasFeitas(storage)
  for (const canal of canais) next.set(canal, Math.max(agora, next.get(canal) ?? 0))
  // The cap cuts the oldest marks.
  const cortado = new Map([...next].sort((a, b) => a[1] - b[1]).slice(-ESPERAS_FEITAS_MAX))
  try {
    storage.setItem(ESPERAS_FEITAS_KEY, JSON.stringify(Object.fromEntries(cortado)))
  } catch {
    // Storage locked: applies to this session only.
  }
  return cortado
}

/**
 * A channel's onboarding display: whether it still shows, and how to dismiss it.
 *
 * `elegivel` decides if this channel even has onboarding. Today only common.
 * The decision stays out of this hook because it depends on what the server
 * announced, and this only knows about storage.
 */
export function useApresentacao(
  channel: string | null,
  elegivel: boolean,
): { visivel: boolean; dispensar: () => void } {
  const [vistos, setVistos] = useState<Set<string>>(readApresentados)

  const dispensar = useCallback(() => {
    if (!channel) return
    setVistos(marcarApresentado(channel))
  }, [channel])

  return { visivel: elegivel && channel !== null && !vistos.has(channel), dispensar }
}

/**
 * Recently used emojis, for the picker.
 *
 * Has its own hook instead of going into `usePrefs` because the message box at
 * the bottom of the chat screen needs this, and threading the preference down
 * hand by hand would mean crossing components that have nothing to do with emojis.
 *
 * Write merges over what is ON DISK, never over this hook's snapshot. Same reason
 * as `choose` above: settings are open somewhere else at the same time, and
 * writing the old snapshot over would erase a choice someone just made.
 *
 * Write happens OUTSIDE the updater, unlike `choose`. Picking an emoji closes the
 * picker in the same batch of updates, and an updater from a component that
 * unmounts may never run. With write inside, the just-picked emoji would not show
 * in recents next time. Here disk is written now; `setRecents` only affects what
 * stays on screen.
 */
export function useEmojiRecents(): { recents: string[]; remember: (char: string) => void } {
  const [recents, setRecents] = useState<string[]>(() => readPrefs().emojiRecents)

  const remember = useCallback((char: string) => {
    const disk = readPrefs()
    // Reusing an emoji promotes it instead of duplicating it.
    const next = [char, ...disk.emojiRecents.filter((entry) => entry !== char)].slice(0, EMOJI_RECENTS_MAX)
    writePrefs({ ...disk, emojiRecents: next })
    setRecents(next)
  }, [])

  return { recents, remember }
}
