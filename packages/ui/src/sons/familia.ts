/**
 * The sound family for the app.
 *
 * All sounds come from here, with the same timbre and scale. A new sound
 * is a new line in `SONS`, and inherits everything else: the voice, the filter,
 * the room. That's what makes them a family.
 *
 * **The voice.** A marimba (3/11/2026, owner request: more inspired by MSN,
 * without copying any Microsoft sound). Each note is a struck bar: the
 * fundamental, which decays slowly, and two mistuned partials from the bar
 * (3.93× and 9.2×), which decay fast and give the wood tone. A 3 ms noise click
 * is the mallet. A short echo (five delay lines, 31 to 163 ms) gives it the room.
 * Before it was a sine wave with the 2nd and 3rd harmonic, a low-pass filter and
 * a room via convolution.
 *
 * **The scale.** D major pentatonic (D, E, F#, A, B), from A4 to D6, plus
 * three notes that MSN gestures demand: E6 and F#6 from direct message and
 * mention, and low D4 from the elbow bump. No pair of notes in this scale beats
 * against the other: two overlapping sounds stay in tune. Below 400 Hz a laptop
 * speaker barely reproduces the fundamental: D4 exists only under other notes,
 * and you hear it via the 3.93× partial (1.15 kHz).
 *
 * **The duration.** Between 120 and 400 ms. Three exceptions: the incoming call
 * ring must be heard across the room, the outgoing call ring (`a-chamar`) is
 * the wait from when the caller rang, lasting until someone picks up, and the
 * elbow bump is ten taps, which doesn't fit in 400 ms.
 *
 * **The contour says what it is.** Eyes closed, nobody compares timbres:
 * they compare directions and rhythms. Rising is "arrived", falling is "left".
 * Ending on the tonic (D) is "resolved". Ending on A is "waiting for response".
 * Direct message is the exception: a "ding-dong" falling in the highest register,
 * which grabs attention without saying arrived or left.
 *
 * No audio files: CSP won't let us fetch anything from outside, and a sound
 * written in numbers tunes itself in a diff.
 */

export type TipoDeSom =
  | "directa"
  | "mencao"
  | "canal"
  | "pedido"
  | "aceite"
  | "chamada"
  | "entrou"
  | "saiu"
  | "ligado"
  | "cotovelada"
  | "ticket"
  | "publicacao"
  | "actualizacao"
  | "mic-silenciado"
  | "mic-ligado"
  | "tudo-silenciado"
  | "tudo-ligado"
  | "amigo-online"
  | "sala-afk"
  | "enviada"
  | "a-chamar"
  | "voz-perdida"
  | "movido"
  | "transmissao-iniciada"
  | "transmissao-terminada"
  | "espectador-entrou"
  | "espectador-saiu"

/** The order in which sound types appear in Settings and in the WAV script. */
export const TIPOS_DE_SOM: readonly TipoDeSom[] = [
  "directa",
  "mencao",
  "canal",
  "pedido",
  "aceite",
  "chamada",
  "entrou",
  "saiu",
  "ligado",
  "cotovelada",
  "ticket",
  "publicacao",
  "actualizacao",
  "mic-silenciado",
  "mic-ligado",
  "tudo-silenciado",
  "tudo-ligado",
  "amigo-online",
  "sala-afk",
  "enviada",
  "a-chamar",
  "voz-perdida",
  "movido",
  "transmissao-iniciada",
  "transmissao-terminada",
  "espectador-entrou",
  "espectador-saiu",
]

/**
 * The scale, in Hz. Only these notes exist in the family.
 *
 * D4, E6, and F#6 came with the MSN gestures (3/11/2026): they're from
 * the same pentatonic, one octave below and above what was already here.
 */
export const ESCALA = {
  D4: 293.66,
  A4: 440,
  B4: 493.88,
  D5: 587.33,
  E5: 659.25,
  "F#5": 739.99,
  A5: 880,
  B5: 987.77,
  D6: 1174.66,
  E6: 1318.51,
  "F#6": 1479.98,
} as const

export type Nota = keyof typeof ESCALA

export interface NotaDoSom {
  nota: Nota
  /** Seconds from the start of the sound. */
  em: number
  /** Seconds until the note mutes: the bar is damped here and plays no more. */
  dur: number
  /** Weight of this note within the sound, from 0 to 1. */
  ganho: number
}

export interface DescricaoDeSom {
  notas: readonly NotaDoSom[]
  /**
   * The peak of the sound, from 0 to 1, after normalization.
   *
   * This is what orders the sounds by presence: publish is the most
   * discreet, incoming call the most clear. The app volume multiplies this.
   */
  presenca: number
  /** Only the two rings repeat: at what interval in seconds. */
  periodo?: number
}

/** Two notes; the second starts before the first ends. */
function duas(a: Nota, b: Nota, durA = 0.09, durB = 0.13, passo = 0.07): NotaDoSom[] {
  return [
    { nota: a, em: 0, dur: durA, ganho: 0.9 },
    { nota: b, em: passo, dur: durB, ganho: 1 },
  ]
}

/** Three notes at equal steps; the last is longer and closes the figure. */
function tres(a: Nota, b: Nota, c: Nota, passo = 0.08, ultima = 0.18): NotaDoSom[] {
  return [
    { nota: a, em: 0, dur: passo + 0.02, ganho: 0.85 },
    { nota: b, em: passo, dur: passo + 0.02, ganho: 0.9 },
    { nota: c, em: passo * 2, dur: ultima, ganho: 1 },
  ]
}

/**
 * A touch figure: A5 → F#5 → A5 → D6, for 140 em 140 ms. Each note
 * rings beneath the ones that follow (450 ms), like a marimba with no dampening
 * (3/11/2026, owner request: inspired by MSN).
 */
function figuraDoToque(inicio: number): NotaDoSom[] {
  return (["A5", "F#5", "A5", "D6"] as const).map((nota, i) => ({
    nota,
    em: inicio + i * 0.14,
    dur: 0.45,
    ganho: 0.9,
  }))
}

/**
 * The nudge: a D4 grave ringing beneath ten taps, D5 e A4
 * alternating for 45 em 45 ms. It is a shake, so the only figure that
 * trembles.
 */
function figuraDaCotovelada(): NotaDoSom[] {
  const batidas = Array.from({ length: 10 }, (_, i) => ({
    nota: (i % 2 === 0 ? "D5" : "A4") as Nota,
    em: i * 0.045,
    dur: 0.25,
    ganho: 0.8,
  }))
  return [{ nota: "D4", em: 0, dur: 0.5, ganho: 1 }, ...batidas]
}

export const SONS: Record<TipoDeSom, DescricaoDeSom> = {
  /**
   * Direct message: E6 → B5, a "ding-dong" falling in the top of the scale.
   * The sound you hear most. E6 keeps playing under B5 (3/11/2026,
   * owner request: more inspired by MSN). Before it was F#5 → A5, rising.
   */
  directa: {
    notas: [
      { nota: "E6", em: 0, dur: 0.34, ganho: 1 },
      { nota: "B5", em: 0.11, dur: 0.29, ganho: 0.9 },
    ],
    presenca: 0.7,
  },

  /**
   * Someone mentioned me: B5 → D6 → F#6, the B minor arpeggio rising to the
   * highest note in the family. The three notes stay playing and end in a chord.
   * Direct message has two notes and falls; mention has three and rises higher,
   * so they don't mix eyes closed. From `accept` (F#5 → A5 → D6, short notes)
   * it differs in register, a third higher, and notes that don't mute
   * (3/11/2026, owner request: more inspired by MSN). Before it was
   * A5 → D6 → D6.
   */
  mencao: {
    notas: [
      { nota: "B5", em: 0, dur: 0.3, ganho: 0.9 },
      { nota: "D6", em: 0.08, dur: 0.26, ganho: 0.9 },
      { nota: "F#6", em: 0.16, dur: 0.24, ganho: 1 },
    ],
    presenca: 0.75,
  },

  /**
   * A new message in a channel room (owner request, 3 November
   * 2026): D5 → E5, a small step rising, low and short. The most discreet
   * of message sounds: it says "the conversation moved", not "this is for you".
   * It stays below direct message and mention, and far from the high register of
   * `sent` (B5 → D6). Rising is "arrived".
   */
  canal: { notas: duas("D5", "E5", 0.06, 0.12, 0.05), presenca: 0.4 },

  /** Friend request: D5 → F#5 → A5. Ends on A: waiting for response. */
  pedido: { notas: tres("D5", "F#5", "A5"), presenca: 0.7 },

  /** Request accepted: F#5 → A5 → D6. Ends on the tonic: resolved. */
  aceite: { notas: tres("F#5", "A5", "D6", 0.08, 0.2), presenca: 0.7 },

  /**
   * Incoming call: A5 → F#5 → A5 → D6, two figures with 1,1 s between
   * them, for 3 em 3 s (3/11/2026, owner request: inspired by MSN).
   * Used to be A5 e F#5 alternados.
   *
   * The only sound longer than 400 ms, and the clearest. Must be heard with the
   * phone in a pocket, and the only one that prompts an action.
   */
  chamada: { notas: [...figuraDoToque(0), ...figuraDoToque(1.1)], presenca: 0.85, periodo: 3 },

  /** Someone joined the voice room: D5 → A5, rising, low. You hear it dozens of times. */
  entrou: { notas: duas("D5", "A5", 0.07, 0.11, 0.06), presenca: 0.45 },

  /** Someone left the voice room: A5 → D5. The same figure backwards. */
  saiu: { notas: duas("A5", "D5", 0.07, 0.11, 0.06), presenca: 0.45 },

  /** The call is on hold: B4 → F#5 → B5, one octave in three steps. */
  ligado: { notas: tres("B4", "F#5", "B5", 0.075, 0.16), presenca: 0.55 },

  /**
   * Nudge: a D4 grave and, on top, D5 e A4 alternados for 45 em 45 ms,
   * ten taps (3/11/2026, owner request: inspired by MSN). 655 ms: the
   * third exception to duration. Used to be three descending taps,
   * B5 → A5 → F#5.
   *
   * Presence 0,62 (was 0,75): ten taps and a bass underneath have more weight
   * than three, and at the same peak they sounded above the request and accept.
   */
  cotovelada: { notas: figuraDaCotovelada(), presenca: 0.62 },

  /**
   * New ticket or reply: E5 twice, like knocking on a door.
   *
   * Presence 0.47 (was 0.6, 3/11/2026): on the marimba, two equal and
   * full notes sound fuller than the other figures at the same peak. This way
   * it stays where it was, at the level of mute sounds.
   */
  ticket: {
    notas: [
      { nota: "E5", em: 0, dur: 0.1, ganho: 1 },
      { nota: "E5", em: 0.12, dur: 0.12, ganho: 0.9 },
    ],
    presenca: 0.47,
  },

  /** A friend's post: just one B5, short and low. The most discreet of all. */
  publicacao: { notas: [{ nota: "B5", em: 0, dur: 0.12, ganho: 1 }], presenca: 0.35 },

  /**
   * Update available (owner request, 27 October 2026): B4 → E5
   * → A5 em fourths, and the A again, longer. Ends on A: awaits an
   * action (refresh, download). Plays once per notification, so can be
   * clearer than the publish sound without fatigue.
   *
   * Used to be the D arpeggio rising (A4 → D5 → F#5 → A5, for 70 em 70 ms). The
   * new `amigo-online` (3/11/2026, owner request: inspired by MSN) is
   * the same arpeggio a fourth higher, at the same tempo, and both passed by
   * each other. The fourths and repeated A give it a different contour and rhythm.
   */
  actualizacao: {
    notas: [
      { nota: "B4", em: 0, dur: 0.09, ganho: 0.8 },
      { nota: "E5", em: 0.08, dur: 0.09, ganho: 0.85 },
      { nota: "A5", em: 0.16, dur: 0.09, ganho: 0.9 },
      { nota: "A5", em: 0.29, dur: 0.11, ganho: 1 },
    ],
    presenca: 0.6,
  },

  /*
    The mute sounds (owner and community request, 2 November
    2026, point 3). Two pairs, like in Discord: mute falls ("left"), unmute
    rises ("arrived"), and each pair is the same figure backwards. The microphone
    pair sits in the middle of the scale; the "mute all" one a fifth below,
    lower, because it mutes more. They're responses to a gesture, so short and
    below messages: whoever taps already knows what they did, the sound just
    confirms it.
    */

  /** Mute the microphone: A5 → E5, falling. */
  "mic-silenciado": { notas: duas("A5", "E5", 0.07, 0.1, 0.06), presenca: 0.5 },

  /** Unmute the microphone: E5 → A5, the same figure rising. */
  "mic-ligado": { notas: duas("E5", "A5", 0.07, 0.1, 0.06), presenca: 0.5 },

  /** Mute all (microphone and sound): D5 → A4, lower. */
  "tudo-silenciado": { notas: duas("D5", "A4", 0.07, 0.12, 0.07), presenca: 0.5 },

  /** Unmute: A4 → D5, the same figure rising. */
  "tudo-ligado": { notas: duas("A4", "D5", 0.07, 0.12, 0.07), presenca: 0.5 },

  /**
   * A friend came online (checkpoint 6, 2 November 2026): D5 → F#5 → A5 →
   * D6, the D arpeggio rising an octave, for 70 em 70 ms, and each note keeps
   * ringing (3/11/2026, owner request: inspired by MSN). Rising means
   * "arrived", and ends on D: no action needed. Low, at the level of someone entering the
   * voice room. Used to be E5 → B5.
   */
  "amigo-online": {
    notas: [
      { nota: "D5", em: 0, dur: 0.28, ganho: 0.8 },
      { nota: "F#5", em: 0.07, dur: 0.25, ganho: 0.85 },
      { nota: "A5", em: 0.14, dur: 0.22, ganho: 0.9 },
      { nota: "D6", em: 0.21, dur: 0.19, ganho: 1 },
    ],
    presenca: 0.45,
  },

  /**
   * You moved to the AFK room (2/11/2026): B5 → E5, falling slowly. Falling is
   * "left", and you left the conversation. Slower and lower than everything else:
   * whoever hears it might be away from the keyboard, and there's nothing
   * to do in a hurry.
   */
  "sala-afk": { notas: duas("B5", "E5", 0.12, 0.2, 0.1), presenca: 0.4 },

  /**
   * My message sent (owner request, 3 November 2026): B5 → D6,
   * a light touch rising, 150 ms. Rising is "gone", and ends on D: it's done.
   * Answers a gesture, like the mute ones, but plays many more times:
   * that's why it's the shortest in the family and sits just above post.
   */
  enviada: { notas: duas("B5", "D6", 0.05, 0.11, 0.04), presenca: 0.38 },

  /*
    Parity of moments with Discord (owner request, 3 November 2026).
    Seven moments that Discord marks with sound and Orwell didn't. The
    parity is in MOMENTS: the figures are from this family, with the voice and
    scale as always, and none copy or imitate Discord sounds.
  */

  /**
   * Outgoing call: I called someone and wait for them to pick up. D5 e E#5 juntos,
   * twice, at 3 em 3 s.
   *
   * The only chord in the family: both notes sound at the same time, flat,
   * because nothing came in or went out; waiting. Lower than the incoming call
   * (0,85): whoever hears it has the app in focus and they made the call. Repeats
   * like the ringtone, and stops when someone picks up, when I give up, or after
   * `TOQUE_MAXIMO_MS` (`motor.ts`).
   */
  "a-chamar": {
    notas: [
      { nota: "D5", em: 0, dur: 0.32, ganho: 1 },
      { nota: "F#5", em: 0, dur: 0.32, ganho: 0.8 },
      { nota: "D5", em: 0.44, dur: 0.32, ganho: 1 },
      { nota: "F#5", em: 0.44, dur: 0.32, ganho: 0.8 },
    ],
    presenca: 0.5,
    periodo: 3,
  },

  /**
   * My connection to the call dropped without me leaving: F#5 → D5 → A4, three
   * steps down to the lowest note in the family (excluding D4, which since
   * 3/11/2026 only sounds below the elbow). It descends further than `left`
   * (A5 → D5), which is the sound of a gesture, and lands on A: it waits for
   * a gesture (to come back). Louder than the room sounds, because it's news
   * that calls for action.
   */
  "voz-perdida": { notas: tres("F#5", "D5", "A4", 0.08, 0.18), presenca: 0.6 },

  /**
   * The moderator moved me to another voice room: A5 → D5 → A5. It is `left`
   * and `entered` stuck together as one shape: I left one room and entered
   * another, and I didn't do it.
   */
  movido: { notas: tres("A5", "D5", "A5", 0.08, 0.16), presenca: 0.5 },

  /**
   * A broadcast started in the room I'm in (mine or someone else's): A4 → A5,
   * an octave up. A new window opens in the room.
   */
  "transmissao-iniciada": { notas: duas("A4", "A5", 0.08, 0.16, 0.07), presenca: 0.5 },

  /** The broadcast ended: A5 → A4, the same shape going down. */
  "transmissao-terminada": { notas: duas("A5", "A4", 0.08, 0.16, 0.07), presenca: 0.5 },

  /**
   * Someone started watching my broadcast: F#5 → B5, a fourth up, short.
   * Lighter than `entered` (D5 → A5): the person was already in the room,
   * they just started looking.
   */
  "espectador-entrou": { notas: duas("F#5", "B5", 0.06, 0.1, 0.05), presenca: 0.42 },

  /** Someone stopped watching my broadcast: B5 → F#5, the same shape going down. */
  "espectador-saiu": { notas: duas("B5", "F#5", 0.06, 0.1, 0.05), presenca: 0.42 },
}

/* -------------------------------------------------------------- the timbre */

/*
  The marimba (3/11/2026, owner's request: more inspired by MSN). The numbers are
  from the rehearsal the owner heard and chose, and the engine plays them exactly.
*/

/**
 * The partials of a marimba bar: the fundamental and two out of tune (a bar
 * doesn't have integer harmonics). Each with its own attack and exponential
 * decay (tau, the time constant): the higher ones die first.
 */
export const PARCIAIS: readonly { multiplo: number; ganho: number; ataque: number; tau: number }[] = [
  { multiplo: 1, ganho: 1, ataque: 0.002, tau: 0.32 },
  { multiplo: 3.93, ganho: 0.35, ataque: 0.001, tau: 0.06 },
  { multiplo: 9.2, ganho: 0.12, ataque: 0.0005, tau: 0.02 },
]
/** The mallet: a noise click at the start of each note, silenced in 3 ms. */
export const CLIQUE = { ganho: 0.08, tau: 0.003 } as const
/** Length of the click: ten time constants, already below -80 dB. */
const CLIQUE_S = CLIQUE.tau * 10
/** The room: five short echoes of the full sound, each one fainter. */
export const ECOS: readonly { atraso: number; ganho: number }[] = [
  { atraso: 0.031, ganho: 0.32 },
  { atraso: 0.047, ganho: 0.26 },
  { atraso: 0.071, ganho: 0.2 },
  { atraso: 0.113, ganho: 0.14 },
  { atraso: 0.163, ganho: 0.09 },
]
/** How long the bar takes to dampen when muted, at the end of `dur`. */
export const ABAFAR_S = 0.03
/** Slack at the end of the sound, to let the last echo fade out. */
export const CAUDA_S = 0.18
export const TAXA = 48_000

/** How long the notes of the sound last, without the room tail. */
export function duracaoDasNotas(som: DescricaoDeSom): number {
  return Math.max(...som.notas.map((nota) => nota.em + nota.dur))
}

/** How long the sound lasts, with the room tail. */
export function duracaoDe(som: DescricaoDeSom): number {
  return duracaoDasNotas(som) + CAUDA_S
}

/* ---------------------------------------------------------- rendering */

/**
 * A seeded pseudo-random number generator. The click is noise, and the same
 * noise every time makes the script's WAV files always come out the same.
 */
function sorteio(semente: number): () => number {
  let estado = semente >>> 0
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0
    let t = estado
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The mallet click: Gaussian noise with exponential decay, written here.
 * The same across all notes, as in the rehearsal.
 */
export function respostaDoClique(contexto: BaseAudioContext): AudioBuffer {
  const comprimento = Math.max(1, Math.round(contexto.sampleRate * CLIQUE_S))
  const clique = contexto.createBuffer(1, comprimento, contexto.sampleRate)
  const dados = clique.getChannelData(0)
  const proximo = sorteio(0x0e11)
  for (let i = 0; i < comprimento; i += 1) {
    // Box-Muller: two uniforms give one normal. The `1 -` avoids log of zero.
    const normal = Math.sqrt(-2 * Math.log(1 - proximo())) * Math.cos(2 * Math.PI * proximo())
    dados[i] = normal * Math.exp(-i / contexto.sampleRate / CLIQUE.tau) * CLIQUE.ganho
  }
  return clique
}

/**
 * Sets up the sound in a context: the browser's offline context, or a fake one
 * in tests.
 *
 * Each note is a bundle of oscillators (one per partial, fundamental first),
 * each with its own envelope, and a click. Everything feeds into the same
 * voice, and the voice feeds the dry sound and the echoes.
 */
export function montarSom(contexto: BaseAudioContext, som: DescricaoDeSom): void {
  const voz = contexto.createGain()
  voz.gain.value = 1
  voz.connect(contexto.destination)
  for (const eco of ECOS) {
    const atraso = contexto.createDelay(1)
    atraso.delayTime.value = eco.atraso
    const peso = contexto.createGain()
    peso.gain.value = eco.ganho
    voz.connect(atraso)
    atraso.connect(peso)
    peso.connect(contexto.destination)
  }

  const clique = respostaDoClique(contexto)
  for (const nota of som.notas) {
    const hz = ESCALA[nota.nota]
    const inicio = nota.em
    const fim = inicio + nota.dur
    for (const parcial of PARCIAIS) {
      const oscilador = contexto.createOscillator()
      oscilador.type = "sine"
      oscilador.frequency.value = hz * parcial.multiplo
      const envelope = contexto.createGain()
      const pico = nota.ganho * parcial.ganho
      const fimDoAtaque = inicio + parcial.ataque
      // Damps at the end: until then, decay follows the bar; after, 30 ms to zero.
      const abafa = Math.max(fimDoAtaque, fim - ABAFAR_S)
      // The exponential ramp from one value to another is exact exp(-t/tau) decay.
      const aoAbafar = Math.max(pico * Math.exp(-(abafa - fimDoAtaque) / parcial.tau), 1e-7)
      envelope.gain.setValueAtTime(0, inicio)
      envelope.gain.linearRampToValueAtTime(pico, fimDoAtaque)
      envelope.gain.exponentialRampToValueAtTime(aoAbafar, abafa)
      envelope.gain.linearRampToValueAtTime(0, fim)
      oscilador.connect(envelope)
      envelope.connect(voz)
      oscilador.start(inicio)
      oscilador.stop(fim + 0.01)
    }
    const baqueta = contexto.createBufferSource()
    baqueta.buffer = clique
    const peso = contexto.createGain()
    peso.gain.value = nota.ganho
    baqueta.connect(peso)
    peso.connect(voz)
    baqueta.start(inicio)
  }
}

/** Brings the peak of the sound to `presence`. All sounds stay on the same scale. */
export function normalizar(buffer: AudioBuffer, presenca: number): void {
  let pico = 0
  for (let canal = 0; canal < buffer.numberOfChannels; canal += 1) {
    for (const amostra of buffer.getChannelData(canal)) pico = Math.max(pico, Math.abs(amostra))
  }
  if (pico === 0) return
  const factor = presenca / pico
  for (let canal = 0; canal < buffer.numberOfChannels; canal += 1) {
    const dados = buffer.getChannelData(canal)
    for (let i = 0; i < dados.length; i += 1) dados[i] = (dados[i] ?? 0) * factor
  }
}

export type CriarContextoOffline = (canais: number, comprimento: number, taxa: number) => OfflineAudioContext

function contextoOfflineDoBrowser(): CriarContextoOffline | null {
  const anfitriao = globalThis as {
    OfflineAudioContext?: typeof OfflineAudioContext
    webkitOfflineAudioContext?: typeof OfflineAudioContext
  }
  const Construtor = anfitriao.OfflineAudioContext ?? anfitriao.webkitOfflineAudioContext
  if (!Construtor) return null
  return (canais, comprimento, taxa) => new Construtor(canais, comprimento, taxa)
}

/**
 * Renders a sound to an `AudioBuffer`, once.
 *
 * Done by `OfflineAudioContext`, which runs faster than real time and needs
 * no speaker. Returns `null` where Web Audio is not available.
 */
export async function renderizar(
  tipo: TipoDeSom,
  criar: CriarContextoOffline | null = contextoOfflineDoBrowser(),
): Promise<AudioBuffer | null> {
  if (!criar) return null
  const som = SONS[tipo]
  const contexto = criar(2, Math.ceil(duracaoDe(som) * TAXA), TAXA)
  montarSom(contexto, som)
  const buffer = await contexto.startRendering()
  normalizar(buffer, som.presenca)
  return buffer
}
