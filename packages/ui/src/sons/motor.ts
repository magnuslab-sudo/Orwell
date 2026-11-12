import { readPrefs, type Prefs } from "../hooks/usePrefs.js"
import { hostWindowInFront } from "../lib/notifications.js"
import { renderizar as renderizarDaFamilia, SONS, TIPOS_DE_SOM, type TipoDeSom } from "./familia.js"
import { lerPreferenciasDeSom, type PreferenciasDeSom } from "./preferencias.js"
import { caladoPelaPausa } from "./acontecimentos.js"

/**
 * The sound engine: when a sound plays, and when it does not.
 *
 * The family (`familia.ts`) defines how each sound sounds. This file defines when.
 * Almost all rules are silence, and each has a named reason. The reason goes
 * back to the caller, so tests and diagnostics can read it.
 *
 * The rules, in order:
 *
 * 1. **No gesture, no sound.** The browser will not play before the first
 *    click or key press. The engine does not try: a context created earlier
 *    stays suspended, and the sound would be lost in silence.
 * 2. **The main switch and the type switch.**
 * 3. **Never for own actions.** My message, my join. Exceptions are
 *    responses to a gesture, which do not arrive marked `deMim`: the mute
 *    sounds and the sent message sound (`enviada`, played by `useOutbox`).
 * 4. **"Busy" and "Invisible" silence everything**, except the two ringtones
 *    (incoming call and outgoing call), only if the person allowed it
 *    (`chamadaComOcupado`). "Mute all" silences the outgoing call ringtone (`CALADOS_AO_ENSURDECER`): it is
 *    call sound, and the person asked not to hear it. Notifications pause
 *    also silences, except call sounds (see `caladoPelaPausa`).
 * 5. **Never for what is in front.** A message in the open channel, with
 *    the window in front and focused, is already visible. The sound says
 *    nothing new. The channel sound also looks at the room: it only silences
 *    the room that is open. Mention is the exception: it plays anyway, quieter
 *    (`MENCAO_A_VER`).
 * 6. **In the background, the system notification decides.** When the system
 *    notification already makes its own sound, the app does not play over it.
 * 7. **Zero volume is silence.**
 * 8. **Never in bursts.** One sound per type of 2 em 2 s. Twenty messages
 *    at once are one event, and make one sound. The channel sound has two
 *    limits: 1 s between any two, and 3 s within the same channel
 *    (`RAJADA_POR_CANAL_MS`).
 */

export type Motivo =
  | "tocou"
  | "sem-gesto"
  | "desligado"
  | "tipo-desligado"
  | "proprio"
  | "actividade"
  | "a-ver"
  | "aviso-do-sistema"
  | "volume-zero"
  | "rajada"
  | "sem-audio"
  | "pausa"
  | "ensurdecido"

export interface Acontecimento {
  tipo: TipoDeSom
  /** The event is from the person themselves: their message, their entry. */
  deMim?: boolean
  /** The channel where it happened. No channel means the focus rule doesn't apply. */
  canal?: string | null
  /**
   * The room of the channel where it happened ("" is the default room). With a
   * room, the focus rule also requires it to be the open room.
   */
  sala?: string
  /** The system notification for this event already makes sound. */
  avisoComSom?: boolean
}

/** What preferences say, read at the moment of the event. */
export interface EstadoDoSom {
  /** The master switch (`sounds`). */
  ligado: boolean
  /** 0 a 100 (`soundVolume`). */
  volume: number
  actividade: Prefs["activity"]
  som: PreferenciasDeSom
  /** Notification pause setting (`Prefs.pausaAte`). Absent means no pause. */
  pausaAte?: number
  /** "Mute all" (`Prefs.soundOff`). Absent means listen. */
  ensurdecido?: boolean
}

/** What the engine needs to know about the screen. */
export interface Ambiente {
  /** The open channel on the screen, or `null`. */
  canalAberto(): string | null
  /** The open room in the open channel ("" is the default room). */
  salaAberta(): string
  /** The window is in focus and has keyboard input. */
  janelaAFrente(): boolean
  /** The page is visible (`visibilityState`). */
  visivel(): boolean
  /** The user has made a gesture on this page (click or key). */
  houveGesto(): boolean
}

/** Handles sound and vibration. In tests, a fake that only counts. */
export interface Saida {
  /** Plays a sound at this amplitude. Returns `false` when there is no audio. */
  tocar(tipo: TipoDeSom, amplitude: number): boolean
  /** Stops any sound currently playing (the call ring). */
  calar(tipo: TipoDeSom): void
  vibrar(padrao: readonly number[]): void
  /** Called on first gesture: creates the context and prepares sounds. */
  preparar(): void
}

export interface Relogio {
  agora(): number
  /** Schedules and returns how to cancel. */
  depois(ms: number, fazer: () => void): () => void
}

/**
 * Sounds that follow the focus rule: they relate to a conversation.
 *
 * Mention is not here: with the conversation visible, it plays anyway, quieter.
 */
const COM_FOCO: ReadonlySet<TipoDeSom> = new Set(["directa", "pedido", "aceite", "ticket", "publicacao", "canal"])

/** The two tones: they repeat and override "Busy" when the user leaves. */
type Toque = "chamada" | "a-chamar"
const TOQUES: ReadonlySet<TipoDeSom> = new Set<Toque>(["chamada", "a-chamar"])

/**
 * Sounds that "Mute all" silences at the engine level.
 *
 * Only the outgoing call ring: it is sound from the call I am in, and the user
 * who muted everything asked not to hear it. Other call sounds that silence when
 * muted are decided by the watchers that choose them (`lib/sounds.ts`,
 * `sons/chamada.ts`), because the same type can be my action (my transmission
 * started) and that always plays, like muting sounds.
 */
const CALADOS_AO_ENSURDECER: ReadonlySet<TipoDeSom> = new Set(["a-chamar"])

/**
 * Mention with the conversation visible: plays at half amplitude.
 *
 * Decision by the owner (November 3, 2026), as in Discord: being named is being
 * called, even with the room open. The user who is reading already sees the
 * message; the quieter sound just says "this is for you", without startling.
 */
export const MENCAO_A_VER = 0.5

/**
 * The minimum interval between two sounds of the same type.
 *
 * 2 s for all. Elbow nudge is 4 s: it is the only one another person triggers
 * on purpose, and an altered client on the other side cannot fire it repeatedly.
 */
export const RAJADA_MS: Record<TipoDeSom, number> = {
  directa: 2000,
  mencao: 2000,
  // Between any two channels. Within the same channel use `RAJADA_POR_CANAL_MS`.
  canal: 1000,
  pedido: 2000,
  aceite: 2000,
  chamada: 2000,
  entrou: 2000,
  saiu: 2000,
  ligado: 2000,
  cotovelada: 4000,
  ticket: 2000,
  publicacao: 2000,
  actualizacao: 2000,
  // Mute sounds respond to a gesture: each press must be heard, even two in a row.
  // The 150 ms only stops a key held down repeating.
  "mic-silenciado": 150,
  "mic-ligado": 150,
  "tudo-silenciado": 150,
  "tudo-ligado": 150,
  "amigo-online": 2000,
  "sala-afk": 2000,
  // Each send is a gesture and each one plays. The 150 ms only stops two sends
  // confirming at the same moment.
  enviada: 150,
  // The outgoing ring repeats on its own clock (`periodo`), not from here.
  "a-chamar": 2000,
  "voz-perdida": 2000,
  movido: 2000,
  // Sharing my transmission is a gesture, and stopping and starting again plays.
  // 1 s stops someone toggling many times in a row in a full room.
  "transmissao-iniciada": 1000,
  "transmissao-terminada": 1000,
  // When transmission starts, several people press "View" at the same time: it is
  // an event and makes a sound.
  "espectador-entrou": 2000,
  "espectador-saiu": 2000,
}

/**
 * The minimum interval between two sounds of the same type IN THE SAME CHANNEL.
 *
 * Only the channel sound has this: the common channel has many people, and a
 * lively conversation in it cannot turn into an alarm. At most one sound every
 * 3 s per channel.
 */
export const RAJADA_POR_CANAL_MS: Partial<Record<TipoDeSom, number>> = { canal: 3000 }

/** How long the call ring repeats before giving up on its own. */
export const TOQUE_MAXIMO_MS = 30_000

/**
 * The amplitude cap at volume 100.
 *
 * Deliberately low: call voice reaches 1, and a warning can never override the
 * speaker. With sound presence (at most 0.85), the highest stays below half the
 * voice level.
 */
export const TECTO = 0.5

/** Volume squares: the ear is not linear, so the slider covers the full range. */
export function amplitudeDe(volume: number): number {
  const v = Math.min(100, Math.max(0, volume)) / 100
  return v * v * TECTO
}

/** The vibration for each sound. Short, and only where `navigator.vibrate` exists. */
export const VIBRACAO: Record<TipoDeSom, readonly number[]> = {
  directa: [40],
  mencao: [40, 60, 40],
  // An active group conversation is no reason for the phone to vibrate in the pocket.
  canal: [],
  pedido: [40],
  aceite: [40],
  chamada: [300, 150, 300],
  entrou: [],
  saiu: [],
  ligado: [],
  cotovelada: [60, 40, 60, 40, 60],
  ticket: [40],
  publicacao: [],
  actualizacao: [40],
  // A gesture from the user themselves, phone in hand: the sound plays.
  "mic-silenciado": [],
  "mic-ligado": [],
  "tudo-silenciado": [],
  "tudo-ligado": [],
  // No one needs to feel in their pocket that a friend turned on their computer.
  "amigo-online": [],
  // A subtle warning: the moved person is not at the keyboard, and the pocket is not the place for it.
  "sala-afk": [],
  // The sender has the phone in hand and the screen in front: the sound plays.
  enviada: [],
  // The caller has the phone in hand, waiting.
  "a-chamar": [],
  // The call dropped and the person might not be looking: this is the only one that vibrates.
  "voz-perdida": [40, 60, 40],
  movido: [],
  "transmissao-iniciada": [],
  "transmissao-terminada": [],
  "espectador-entrou": [],
  "espectador-saiu": [],
}

/**
 * States that silence sounds: Busy and Invisible.
 *
 * Away does not silence. Someone saying they are not at the keyboard wants the
 * sound to call them back, and silencing Away too would make it a second Busy.
 */
function calaOsSons(actividade: EstadoDoSom["actividade"]): boolean {
  return actividade === "ocupado" || actividade === "invisivel"
}

/**
 * The decision as a pure function: the reason, or `"tocou"` when sound should play.
 *
 * `ultimo` is the timestamp of the last sound of this type, or `undefined`.
 * `ultimoNoCanal` is the timestamp of the last sound of this type on the same channel.
 */
export function decidir(
  acontecimento: Acontecimento,
  estado: EstadoDoSom,
  ambiente: Ambiente,
  ultimo: number | undefined,
  agora: number,
  ultimoNoCanal?: number,
): Motivo {
  const { tipo } = acontecimento
  if (!ambiente.houveGesto()) return "sem-gesto"
  if (!estado.ligado) return "desligado"
  if (!estado.som.porTipo[tipo]) return "tipo-desligado"
  if (acontecimento.deMim) return "proprio"
  if (CALADOS_AO_ENSURDECER.has(tipo) && estado.ensurdecido === true) return "ensurdecido"
  if (calaOsSons(estado.actividade) && !(TOQUES.has(tipo) && estado.som.chamadaComOcupado)) return "actividade"
  if (caladoPelaPausa(tipo, estado.pausaAte, agora)) return "pausa"
  if (COM_FOCO.has(tipo) && estaAVer(acontecimento, ambiente)) return "a-ver"
  if (acontecimento.avisoComSom && !ambiente.visivel()) return "aviso-do-sistema"
  if (amplitudeDe(estado.volume) <= 0) return "volume-zero"
  if (ultimo !== undefined && agora - ultimo < RAJADA_MS[tipo]) return "rajada"
  const porCanal = RAJADA_POR_CANAL_MS[tipo]
  if (porCanal !== undefined && ultimoNoCanal !== undefined && agora - ultimoNoCanal < porCanal) return "rajada"
  return "tocou"
}

/**
 * The event is visible: its channel open, its room open (when it has a room),
 * and the window in focus.
 */
export function estaAVer(acontecimento: Acontecimento, ambiente: Ambiente): boolean {
  if (!acontecimento.canal || acontecimento.canal !== ambiente.canalAberto()) return false
  if (acontecimento.sala !== undefined && acontecimento.sala !== ambiente.salaAberta()) return false
  return ambiente.janelaAFrente()
}

export interface Motor {
  /** An event. Returns the reason for silence, or `"tocou"`. */
  tocar(acontecimento: Acontecimento): Motivo
  /**
   * An incoming call.
   *
   * With `repetir`, the ring repeats every `SONS.chamada.periodo` until
   * `TOQUE_MAXIMO_MS`, or until `pararChamada`. Without `repetir`, plays once.
   */
  tocarChamada(canal: string, opcoes?: { repetir?: boolean; deMim?: boolean }): Motivo
  /** Stops the ring. With a channel, only if it is that channel ringing. */
  pararChamada(canal?: string): void
  /** The channel whose call is ringing, or `null`. */
  chamadaATocar(): string | null
  /**
   * I called someone in a private conversation: the outgoing ring (`a-chamar`),
   * which repeats like the incoming ring until `pararDeChamar` or `TOQUE_MAXIMO_MS`.
   */
  chamar(canal: string): Motivo
  /** Stop the outgoing ring. If a channel is given, only if that channel is the caller. */
  pararDeChamar(canal?: string): void
  /** The channel of the call I made that is still ringing, or `null`. */
  aChamar(): string | null
  /** The Listen button: an explicit request that overrides all rules. */
  ouvir(tipo: TipoDeSom, volume?: number): boolean
  /** Wait for the user's first gesture. Return a way to stop waiting. */
  armar(): () => void
  /** The screen tells the engine which channel is open. */
  ligarAmbiente(parcial: Partial<Ambiente>): void
}

export interface OpcoesDoMotor {
  saida: Saida
  lerEstado: () => EstadoDoSom
  ambiente?: Partial<Ambiente>
  relogio?: Relogio
}

const relogioReal: Relogio = {
  agora: () => Date.now(),
  depois: (ms, fazer) => {
    const id = setTimeout(fazer, ms)
    return () => clearTimeout(id)
  },
}

/** The window is truly in front: tab is visible and the window has keyboard focus. */
export function janelaComFoco(): boolean {
  if (typeof document === "undefined") return false
  if (document.hidden) return false
  return typeof document.hasFocus === "function" ? document.hasFocus() : true
}

function gestoDoBrowser(): boolean {
  if (typeof navigator === "undefined") return false
  const activacao = (navigator as { userActivation?: { hasBeenActive?: boolean } }).userActivation
  return activacao?.hasBeenActive === true
}

export function criarMotor(opcoes: OpcoesDoMotor): Motor {
  const { saida, lerEstado } = opcoes
  const relogio = opcoes.relogio ?? relogioReal
  let gesto = false
  const ambiente: Ambiente = {
    canalAberto: () => null,
    salaAberta: () => "",
    // The Electron host knows better than the document: a hidden window still
    // reports itself as visible and focused.
    janelaAFrente: () => hostWindowInFront() ?? janelaComFoco(),
    visivel: () => typeof document === "undefined" || document.visibilityState === "visible",
    houveGesto: () => gesto || gestoDoBrowser(),
    ...opcoes.ambiente,
  }
  const ultimos = new Map<TipoDeSom, number>()
  /** The last sound of each type with per-channel rate limit, keyed by channel: `tipo|canal`. */
  const ultimosPorCanal = new Map<string, number>()

  /**
   * Rings in progress, one per type: the channel, and how to cancel the next
   * repeat. Incoming and outgoing calls are independent.
   */
  const toques = new Map<Toque, { canal: string; inicio: number; cancelar: () => void }>()

  function emitir(tipo: TipoDeSom, estado: EstadoDoSom, factor = 1, canal?: string | null): boolean {
    const tocou = saida.tocar(tipo, amplitudeDe(estado.volume) * factor)
    if (!tocou) return false
    ultimos.set(tipo, relogio.agora())
    if (canal && RAJADA_POR_CANAL_MS[tipo] !== undefined) ultimosPorCanal.set(`${tipo}|${canal}`, relogio.agora())
    const padrao = VIBRACAO[tipo]
    if (estado.som.vibrar && padrao.length > 0) saida.vibrar(padrao)
    return true
  }

  function avaliar(acontecimento: Acontecimento): { motivo: Motivo; estado: EstadoDoSom } {
    const estado = lerEstado()
    const noCanal = acontecimento.canal ? ultimosPorCanal.get(`${acontecimento.tipo}|${acontecimento.canal}`) : undefined
    const motivo = decidir(acontecimento, estado, ambiente, ultimos.get(acontecimento.tipo), relogio.agora(), noCanal)
    return { motivo, estado }
  }

  function parar(tipo: Toque, canal?: string): void {
    const toque = toques.get(tipo)
    if (!toque) return
    if (canal !== undefined && toque.canal !== canal) return
    toque.cancelar()
    toques.delete(tipo)
    saida.calar(tipo)
  }

  /** One repeat of the ring. Preferences are re-read on each loop. */
  function repetir(tipo: Toque, canal: string): void {
    const toque = toques.get(tipo)
    if (!toque || toque.canal !== canal) return
    const periodo = (SONS[tipo].periodo ?? 3) * 1000
    const resta = toque.inicio + TOQUE_MAXIMO_MS - relogio.agora()
    if (periodo >= resta) {
      // The last loop already played: the ring stops at 30 seconds, no sooner or later.
      toque.cancelar = relogio.depois(Math.max(0, resta), () => parar(tipo, canal))
      return
    }
    toque.cancelar = relogio.depois(periodo, () => {
      if (toques.get(tipo)?.canal !== canal) return
      const estado = lerEstado()
      // If the user changes their mind mid-ring (mutes sounds, goes Busy,
      // silences everything), they won't hear the next repeat. Burst and focus don't
      // apply here: it's the same ring continuing.
      const desligado =
        !estado.ligado ||
        !estado.som.porTipo[tipo] ||
        (CALADOS_AO_ENSURDECER.has(tipo) && estado.ensurdecido === true) ||
        (calaOsSons(estado.actividade) && !estado.som.chamadaComOcupado)
      if (desligado) {
        parar(tipo, canal)
        return
      }
      emitir(tipo, estado)
      repetir(tipo, canal)
    })
  }

  /** Start a ring that repeats. A new ring of the same type silences the previous one. */
  function comecar(tipo: Toque, canal: string, deMim: boolean, repete: boolean): Motivo {
    // The same channel already ringing: it's the same call, not a new one.
    if (toques.get(tipo)?.canal === canal) return "rajada"
    const { motivo, estado } = avaliar({ tipo, deMim, canal })
    if (motivo !== "tocou") return motivo
    if (!emitir(tipo, estado)) return "sem-audio"
    if (repete) {
      // A new call silenced the previous one: only one ring per type.
      toques.get(tipo)?.cancelar()
      toques.set(tipo, { canal, inicio: relogio.agora(), cancelar: () => {} })
      repetir(tipo, canal)
    }
    return "tocou"
  }

  return {
    tocar(acontecimento) {
      const { motivo, estado } = avaliar(acontecimento)
      if (motivo !== "tocou") return motivo
      const factor = acontecimento.tipo === "mencao" && estaAVer(acontecimento, ambiente) ? MENCAO_A_VER : 1
      return emitir(acontecimento.tipo, estado, factor, acontecimento.canal) ? "tocou" : "sem-audio"
    },
    tocarChamada(canal, opcoesDaChamada = {}) {
      return comecar("chamada", canal, opcoesDaChamada.deMim === true, opcoesDaChamada.repetir === true)
    },
    pararChamada: (canal) => parar("chamada", canal),
    chamadaATocar: () => toques.get("chamada")?.canal ?? null,
    // The outgoing ring is the response to my gesture to call: `deMim` never arrives.
    chamar: (canal) => comecar("a-chamar", canal, false, true),
    pararDeChamar: (canal) => parar("a-chamar", canal),
    aChamar: () => toques.get("a-chamar")?.canal ?? null,
    ouvir(tipo, volume) {
      gesto = true
      const estado = lerEstado()
      return saida.tocar(tipo, amplitudeDe(volume ?? estado.volume))
    },
    armar() {
      if (typeof window === "undefined") return () => {}
      const acordar = (): void => {
        gesto = true
        saida.preparar()
      }
      const eventos = ["pointerdown", "keydown", "touchstart"] as const
      for (const evento of eventos) window.addEventListener(evento, acordar, { once: true, capture: true })
      return () => {
        for (const evento of eventos) window.removeEventListener(evento, acordar, { capture: true })
      }
    },
    ligarAmbiente(parcial) {
      Object.assign(ambiente, parcial)
    },
  }
}

/* -------------------------------------------------------- actual playback */

export interface OpcoesDaSaida {
  criarContexto?: () => AudioContext | null
  renderizar?: (tipo: TipoDeSom) => Promise<AudioBuffer | null>
  agora?: () => number
}

/** How long a sound can wait for rendering before it stops making sense. */
const ESPERA_MAXIMA_MS = 400

function contextoDoBrowser(): AudioContext | null {
  try {
    const anfitriao = globalThis as {
      AudioContext?: typeof AudioContext
      webkitAudioContext?: typeof AudioContext
    }
    const Construtor = anfitriao.AudioContext ?? anfitriao.webkitAudioContext
    return Construtor ? new Construtor() : null
  } catch {
    return null
  }
}

/**
 * Playback via Web Audio.
 *
 * Sounds render once on first gesture and stay in memory as `AudioBuffer`.
 * Playing is just starting a buffer: cheap and with no delay. Never breaks:
 * without Web Audio, everything returns `false` silently.
 */
export function criarSaidaWebAudio(opcoes: OpcoesDaSaida = {}): Saida {
  const criarContexto = opcoes.criarContexto ?? contextoDoBrowser
  const renderizar = opcoes.renderizar ?? ((tipo: TipoDeSom) => renderizarDaFamilia(tipo))
  const agora = opcoes.agora ?? (() => Date.now())

  let contexto: AudioContext | null = null
  const prontos = new Map<TipoDeSom, AudioBuffer>()
  const aCaminho = new Map<TipoDeSom, Promise<AudioBuffer | null>>()
  const aTocar = new Map<TipoDeSom, Set<AudioBufferSourceNode>>()

  function garantir(): AudioContext | null {
    if (!contexto) contexto = criarContexto()
    if (!contexto) return null
    if (contexto.state === "suspended") {
      try {
        void Promise.resolve(contexto.resume()).catch(() => {})
      } catch {
        // Rejected. The next sound tries again.
      }
    }
    return contexto
  }

  function buffer(tipo: TipoDeSom): Promise<AudioBuffer | null> {
    const pronto = prontos.get(tipo)
    if (pronto) return Promise.resolve(pronto)
    let promessa = aCaminho.get(tipo)
    if (!promessa) {
      promessa = renderizar(tipo)
        .then((feito) => {
          if (feito) prontos.set(tipo, feito)
          return feito
        })
        .catch(() => null)
      aCaminho.set(tipo, promessa)
    }
    return promessa
  }

  function porAAndar(audio: AudioContext, tipo: TipoDeSom, feito: AudioBuffer, amplitude: number): void {
    try {
      const fonte = audio.createBufferSource()
      fonte.buffer = feito
      const ganho = audio.createGain()
      ganho.gain.value = amplitude
      fonte.connect(ganho)
      ganho.connect(audio.destination)
      const deste = aTocar.get(tipo) ?? new Set<AudioBufferSourceNode>()
      aTocar.set(tipo, deste)
      deste.add(fonte)
      fonte.onended = () => deste.delete(fonte)
      fonte.start()
    } catch {
      // A context that died under us (device powered off).
      contexto = null
    }
  }

  return {
    tocar(tipo, amplitude) {
      const audio = garantir()
      if (!audio) return false
      const pronto = prontos.get(tipo)
      if (pronto) {
        porAAndar(audio, tipo, pronto, amplitude)
        return true
      }
      const pedido = agora()
      void buffer(tipo).then((feito) => {
        // A sound that arrives too late no longer refers to the event.
        if (feito && agora() - pedido <= ESPERA_MAXIMA_MS) porAAndar(audio, tipo, feito, amplitude)
      })
      return true
    },
    calar(tipo) {
      for (const fonte of aTocar.get(tipo) ?? []) {
        try {
          fonte.stop()
        } catch {
          // Already stopped.
        }
      }
      aTocar.get(tipo)?.clear()
    },
    vibrar(padrao) {
      try {
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate([...padrao])
      } catch {
        // No vibration. The sound plays.
      }
    },
    preparar() {
      if (!garantir()) return
      for (const tipo of TIPOS_DE_SOM) void buffer(tipo)
    },
  }
}

/* ---------------------------------------------------- application engine */

/** Current preferences, read from disk at the moment of the event. */
export function estadoDoAparelho(): EstadoDoSom {
  const prefs = readPrefs()
  return {
    ligado: prefs.sounds,
    volume: prefs.soundVolume,
    actividade: prefs.activity,
    som: lerPreferenciasDeSom(),
    pausaAte: prefs.pausaAte,
    ensurdecido: prefs.soundOff,
  }
}

/** The application engine. Tests build their own with `criarMotor`. */
export const motor: Motor = criarMotor({ saida: criarSaidaWebAudio(), lerEstado: estadoDoAparelho })

/**
 * "Update available" (phase 4): the sound when the app notifies of a new version.
 * Goes through all rules: type toggle, Busy, Invisible, pause. Called by:
 * `useAvisoDeVersao` (desktop app when the manifest shows a new version) and
 * `apps/web/src/main.tsx` (the web Reload banner).
 */
export function tocarSomDeActualizacao(motorDoSom: Pick<Motor, "tocar"> = motor): Motivo {
  return motorDoSom.tocar({ tipo: "actualizacao" })
}
