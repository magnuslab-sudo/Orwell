import { isDirect } from "../lib/format.js"
import { ROSTER_SETTLE_MS } from "../lib/sounds.js"
import type { TipoDeSom } from "./familia.js"

/**
 * The call moments that Discord marks with sound and Orwell did not mark
 * (owner request, November 3, 2026): the call dropping, the connection failing,
 * being moved, and broadcasting (starting, ending, who sees it).
 *
 * Pure functions and watchers with no clock of their own, like those in `lib/sounds.ts`: the
 * shell (`App.tsx`) feeds them, and the engine (`motor.ts`) applies the rules for
 * all sounds (toggles, "Busy", "Invisible", volume, burst).
 *
 * The sounds for press-to-talk are left out: the function does not exist yet.
 */

/* ------------------------------------------------- a chamada a sair */

/** What we know about a private call at the instant we enter it. */
export interface EntradaNaPrivada {
  canal: string
  eu: string
  /** Everyone in the shell already knows they are in this call (`ringing`), including me. */
  naChamada: Iterable<string>
  /** The call peers, if any exist yet. */
  pares: readonly { address: string }[]
  /** I was moved to a different room by someone else, not by my own action. */
  movido?: boolean
}

/** There is someone else in the call besides me. */
export function haOutraPessoa(entrada: Pick<EntradaNaPrivada, "eu" | "naChamada" | "pares">): boolean {
  for (const quem of entrada.naChamada) if (quem !== entrada.eu) return true
  return entrada.pares.some((par) => par.address !== entrada.eu)
}

/**
 * I joined a private call: does the outgoing ring start (`a-chamar`)?
 *
 * Only when I was the one who called: the call is private and nobody else is
 * there. If the other person is already there, joining means answering, and
 * there is nothing to wait for. Like Discord, but only in private conversations:
 * in a community voice room, nobody rings anyone (`tocaOToque`).
 */
export function comecaAChamar(entrada: EntradaNaPrivada): boolean {
  if (!isDirect(entrada.canal)) return false
  if (entrada.movido === true) return false
  return !haOutraPessoa(entrada)
}

/**
 * Does the outgoing ring stop? When someone answers (another person appears in
 * the call) or when I am no longer in that call (I gave up, or the call
 * dropped). The time limit is handled by the engine (`TOQUE_MAXIMO_MS`).
 *
 * Orwell has no "reject call" action: the receiver lets it ring until the end.
 * When the gesture exists, rejecting stops the ring here, same as answering.
 */
export function paraDeChamar(aChamar: string, chamadaActual: string | null, haOutra: boolean): boolean {
  return chamadaActual !== aChamar || haOutra
}

/* ------------------------------------------- lost voice call */

/**
 * The error with which the core drops a call that failed and did not recover
 * (the `#refazerMedia`, in `client-core/src/call.ts`; code 403). Written here
 * by hand on purpose: if it changes there, the test in this file is where we
 * catch it.
 */
export const ERRO_DA_CHAMADA_QUE_CAIU = "the call dropped and did not come back"

export interface VigiaDaQueda {
  /** The call media path (`call-caminho`): only on SFU does socket loss mean lost voice. */
  caminho(caminho: "sfu" | "malha" | null): void
  /** The server connection state changed. Restore sound if voice dropped. */
  ligacao(online: boolean, emChamada: boolean): TipoDeSom | null
  /** The core dropped the call because it could not recover it. */
  chamadaCaiu(): TipoDeSom | null
  /** A moderator removed me from the call ("Disconnect from call"). */
  desligadoPorOutro(): TipoDeSom | null
  /** Media is back (`call-sfu-ligado`): the next drop is a fresh drop. */
  mediaVoltou(): void
  /** A chamada acabou. */
  chamadaAcabou(): void
}

/**
 * My connection to the call dropped, without me leaving.
 *
 * Three ways to drop, and one sound per drop:
 *
 * - **The socket died during an SFU call.** The server drops the media on this
 *   entire connection when the socket dies (`Call.ligacaoVoltou`): voice
 *   stopped at that instant, even if the call recovers afterwards. Not on a
 *   mesh call: media goes peer-to-peer and keeps going.
 * - **The core could not recover the call** ("The call dropped and did not
 *   come back", 403). If sound already played when the socket dropped, it does
 *   not play again: it is the same drop.
 * - **A moderator removed me from the call.** I did not leave myself.
 *
 * This differs from two exits that already had sound and are not this one:
 * **leaving by gesture** plays `saiu` (`createVoiceRoomWatcher`), and **the
 * call ended for everyone** (the other person in the private call hung up)
 * plays their `saiu` and leaves me alone, still connected.
 *
 * It plays even with "Mute all". Someone who muted all does not hear the voice
 * stop, and that is why the call could end without anyone noticing. This is
 * the same choice as `sala-afk`.
 */
export function criarVigiaDaQueda(): VigiaDaQueda {
  let caminho: "sfu" | "malha" | null = null
  let online = false
  /** Already played for this drop. Clears when media returns or the call ends. */
  let tocou = false

  const soar = (): TipoDeSom | null => {
    if (tocou) return null
    tocou = true
    return "voz-perdida"
  }

  return {
    caminho(novo) {
      caminho = novo
    },
    ligacao(agoraOnline, emChamada) {
      const caiu = online && !agoraOnline
      online = agoraOnline
      if (!caiu || !emChamada || caminho !== "sfu") return null
      return soar()
    },
    chamadaCaiu: soar,
    desligadoPorOutro: soar,
    mediaVoltou() {
      tocou = false
    },
    chamadaAcabou() {
      tocou = false
      caminho = null
    },
  }
}

/* ------------------------------------------------------ screen share */

/**
 * How long to wait before saying MY screen share ended.
 *
 * Leaving the call also ends the screen share: the core drops the screen
 * (`#largarEcra`) before dropping the call, and the UI receives both messages
 * separately (on the desktop app, as two IPC messages). Without this wait,
 * leaving while sharing would play "screen share ended" on top of the exit
 * sound. The shell waits for this and only plays if still in the same call:
 * one event, one sound.
 */
export const FIM_DA_TRANSMISSAO_MS = 400

/** What the watcher reads from a call peer. */
export interface ParDaTransmissao {
  address: string
  /** They are sharing their screen, whether we asked to see it or not. */
  ecraOferecido: boolean
  /** Says they are viewing my screen. */
  aVerONossoEcra: boolean
}

export interface EstadoDaTransmissao {
  eu: string
  /** I am sharing my screen. */
  euPartilho: boolean
  pares: readonly ParDaTransmissao[]
  /** «Silenciar tudo». */
  ensurdecido: boolean
  /** In the AFK room nobody hears anybody. */
  naSalaAfk: boolean
}

/** A sound the watcher requests. `minha`: my screen share ended, and it waits (`FIM_DA_TRANSMISSAO_MS`). */
export interface SomDaTransmissao {
  tipo: TipoDeSom
  minha?: boolean
}

export interface VigiaDasTransmissoes {
  /** I joined a voice room, or was moved. `null` means I left. Everything restarts. */
  enter(sala: string | null, agora: number): void
  /** The call state changed. Return sounds, in order, at most one of each type. */
  observar(estado: EstadoDaTransmissao, agora: number): SomDaTransmissao[]
}

/**
 * Who starts and ends a screen share in the room I am in, and who views mine.
 *
 * Like Discord: one sound when a screen share starts and when it ends (mine or
 * someone else's), and, for the person sharing, one sound when someone starts
 * or stops viewing. Most rules are silent:
 *
 * - **The roster does not play sound.** If someone was already sharing when I
 *   joined, or within `ROSTER_SETTLE_MS` after (the list filling up), they did
 *   not start now. If someone appears in the call already sharing, they joined:
 *   the `entrou` sound plays, not this one.
 * - **Leaving is not ending.** If someone leaves while sharing, they take the
 *   share with them: their `saiu` plays, not this. Same for someone leaving
 *   while viewing mine. And mine, when I leave the call, also (`FIM_DA_TRANSMISSAO_MS`).
 * - **Viewers only count while I am sharing.** When my screen share ends,
 *   viewers stop seeing it silently.
 * - **"Mute all" silences others, never mine.** My screen share starting or
 *   ending responds to my gesture, like mute sounds; the rest is call audio.
 * - **In the AFK room, nothing.** Nobody there hears anybody.
 * - **The list always updates**, whether sound played or not: this is what we
 *   know, not what we hear. Hearing it again does not replay everything that
 *   changed meanwhile.
 */
export function criarVigiaDasTransmissoes(): VigiaDasTransmissoes {
  let sala: string | null = null
  let desde = 0
  let euPartilhava = false
  /** What each peer was doing on last check: `undefined` means not seen yet. */
  const vistos = new Map<string, { ecra: boolean; aVer: boolean }>()

  return {
    enter(novaSala, agora) {
      sala = novaSala
      desde = agora
      // Changing rooms (moved) does not stop my screen share, and it does not start
      // again in the new room. Only leaving the call forgets it.
      if (novaSala === null) euPartilhava = false
      vistos.clear()
    },
    observar(estado, agora) {
      if (sala === null) return []
      const sons: SomDaTransmissao[] = []
      const pedir = (som: SomDaTransmissao): void => {
        if (!sons.some((ja) => ja.tipo === som.tipo)) sons.push(som)
      }
      const aAssentar = agora - desde < ROSTER_SETTLE_MS
      const calarOsOutros = estado.ensurdecido || estado.naSalaAfk || aAssentar

      // Mine: a gesture, heard even when muted all.
      if (estado.euPartilho !== euPartilhava) {
        if (!estado.naSalaAfk) {
          pedir(estado.euPartilho ? { tipo: "transmissao-iniciada" } : { tipo: "transmissao-terminada", minha: true })
        }
        euPartilhava = estado.euPartilho
      }

      const presentes = new Set<string>()
      for (const par of estado.pares) {
        if (par.address === estado.eu) continue
        presentes.add(par.address)
        const antes = vistos.get(par.address)
        // My screen is only seen while I share it.
        const aVer = estado.euPartilho && par.aVerONossoEcra
        vistos.set(par.address, { ecra: par.ecraOferecido, aVer })
        if (!antes || calarOsOutros) continue
        if (par.ecraOferecido !== antes.ecra) pedir({ tipo: par.ecraOferecido ? "transmissao-iniciada" : "transmissao-terminada" })
        // When mine ends, everyone stops seeing it silently.
        if (estado.euPartilho && aVer !== antes.aVer) pedir({ tipo: aVer ? "espectador-entrou" : "espectador-saiu" })
      }
      // Anyone who left the call takes everything with them, soundless.
      for (const quem of [...vistos.keys()]) if (!presentes.has(quem)) vistos.delete(quem)
      return sons
    },
  }
}
