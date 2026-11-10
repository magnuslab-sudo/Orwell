/**
 * The app's global shortcuts, in the main process.
 *
 * Owner request on 2 November 2026 (points 5 e 8 de
 * `docs/planos/depois-da-1-0.md`): "the mute shortcut doesn't work when the app is minimized". The UI listens to `document`, and a document only hears keyboard input when the window is in focus. What works with the window hidden is the `globalShortcut` from Electron, which asks the system for the key.
 *
 * Nothing here matters `electron`, for the reason of `ecra.ts`: the decision measures against a double of `globalShortcut`, and `index.ts` connects the port to the real one.
 *
 * **What stays global, and what doesn't.**
 *
 *  - Global: "mute microphone", "unmute" and "show or hide the game overlay". These are the ones used when another app is in front (a game, a document). The overlay one came with it (see `overlay-janela.ts`).
 *  - Never global, by choice: a common key (letter, digit, space, arrows) without Ctrl/Cmd or Alt. A global shortcut steals the key from the entire system; an "M" that stops typing in email during a call is worse than a shortcut that only works with the app in focus.
 *  - Never global, by Electron's limit: "speak while holding down" and mouse buttons. `globalShortcut` only signals when the key goes DOWN (no signal on release), and it doesn't know about the mouse. For both you'd need a native keyboard and mouse hook (for example `uiohook-napi`), which is a new native dependency, compiled per platform, and on macOS it asks for Accessibility permission for everything. This is for the owner to decide, and the report (`docs/planos/atalhos-relatorio.md`) explains why.
 *
 * **When they're registered: only during a call.** It's the rule of least surprise. Outside a call the two commands do nothing (see `alternarMicrofone` in the UI), and a global shortcut that does nothing just steals the key from other apps. Someone who chooses `` ` `` para silenciar não quer
 * perder o `` ` `` in the code editor all day, only while speaking. The UI calls `definir` when entering the call and `definir(null)` when leaving; `index.ts` frees everything too if the renderer crashes or reloads, and on exit.
 */

export const ACCOES_GLOBAIS = ["microfone", "som", "overlay"] as const
export type AccaoGlobal = (typeof ACCOES_GLOBAIS)[number]

/** The names of IPC channels, in one place so `preload` and main match. */
export const CANAIS_DE_ATALHOS = {
  definir: "atalhos:definir",
  suspender: "atalhos:suspender",
  abrirAcessibilidade: "atalhos:abrir-acessibilidade",
  /** From main to renderer: a global shortcut was triggered. */
  accionado: "event:atalho-global",
} as const

/** The Accessibility panel on macOS. Constant, like the one for screen recording. */
export const DEFINICOES_DE_ACESSIBILIDADE =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"

export interface EstadoDosAtalhosGlobais {
  globais: AccaoGlobal[]
  soComAJanela: AccaoGlobal[]
  ocupados: AccaoGlobal[]
  faltaAcessibilidade: AccaoGlobal[]
}

/** Electron's `globalShortcut`, reduced to what's used. */
export interface PortaDeAtalhos {
  register: (acelerador: string, aoCarregar: () => void) => boolean
  unregister: (acelerador: string) => void
  setSuspended: (sim: boolean) => void
}

/*
  Keys that `KeyboardEvent.key` gives, with the name Electron's accelerator
  expects. Only the ones that differ; the rest pass through as-is (F1 to F24,
  Home, End, PageUp, PageDown, Insert, PrintScreen, MediaPlayPause, MediaStop).
*/
const NOMES_NO_ACELERADOR: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  MediaTrackNext: "MediaNextTrack",
  MediaTrackPrevious: "MediaPreviousTrack",
  AudioVolumeUp: "VolumeUp",
  AudioVolumeDown: "VolumeDown",
  AudioVolumeMute: "VolumeMute",
  NumLock: "Numlock",
  ScrollLock: "Scrolllock",
}

const TECLAS_COM_NOME = new Set([
  "Space",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "PrintScreen",
  "MediaPlayPause",
  "MediaStop",
  ...Object.values(NOMES_NO_ACELERADOR),
])

/**
 * Media keys that macOS only delivers to an app with Accessibility permission
 * (documentation for `globalShortcut.register`, Electron 43). Volume keys are
 * not on the list and don't ask for anything.
 */
const PEDEM_ACESSIBILIDADE = new Set(["MediaPlayPause", "MediaNextTrack", "MediaPreviousTrack", "MediaStop"])

const TECLAS_DE_CURSOR = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"])

/**
 * The combination saved by the interface ("Mod+Shift+M", "F13", "`"), as an
 * Electron accelerator, or `null` when it cannot be global.
 *
 * This rule repeats the one in `teclaComum` in `packages/ui/src/lib/atalhosDeVoz.ts`
 * and does not import it: this process does not load the interface (see the
 * header of `index.ts`). Tests with the same cases keep the two in step.
 */
export function aceleradorDe(combinacao: string): string | null {
  if (typeof combinacao !== "string" || combinacao.length === 0 || combinacao.length > 64) return null
  const partes = combinacao.split("+")
  const tecla = partes[partes.length - 1] ?? ""
  const mods = partes.slice(0, -1)
  if (mods.some((m) => m !== "Mod" && m !== "Alt" && m !== "Shift")) return null
  if (new Set(mods).size !== mods.length) return null
  const comModificadorForte = mods.includes("Mod") || mods.includes("Alt")

  // Mouse buttons don't exist in `globalShortcut`.
  if (tecla.startsWith("Mouse")) return null

  let nome: string
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(tecla)) nome = tecla
  else if (tecla === "Space" || TECLAS_DE_CURSOR.has(tecla) || /^[\p{L}\p{N}]$/u.test(tecla)) {
    // A common key on its own is never global (see header).
    if (!comModificadorForte) return null
    if (/^[\p{L}\p{N}]$/u.test(tecla) && !/^[A-Z0-9]$/.test(tecla)) return null
    nome = NOMES_NO_ACELERADOR[tecla] ?? tecla
  } else if (TECLAS_COM_NOME.has(NOMES_NO_ACELERADOR[tecla] ?? tecla)) nome = NOMES_NO_ACELERADOR[tecla] ?? tecla
  // An ASCII symbol (`` ` ``, "§" doesn't). The "+" doesn't get here: the interface
  // doesn't record it because it's the combination separator.
  else if (/^[!-~]$/.test(tecla)) nome = tecla
  else return null

  const prefixo = mods.map((m) => (m === "Mod" ? "CommandOrControl" : m))
  return [...prefixo, nome].join("+")
}

/** Does this key, global, need Accessibility permission on this system? */
export function pedeAcessibilidade(acelerador: string, plataforma: string): boolean {
  if (plataforma !== "darwin") return false
  return PEDEM_ACESSIBILIDADE.has(acelerador.split("+").pop() ?? "")
}

/**
 * The request from the renderer, sanitized. The renderer displays what other
 * people wrote, so what it sends is treated as untrusted: only `microfone`,
 * `som`, and `overlay`, each one short text or `null`.
 */
export function lerPedido(pedido: unknown): Record<AccaoGlobal, string | null> | null {
  if (pedido === null || typeof pedido !== "object") return null
  const cru = pedido as Record<string, unknown>
  const saida: Record<AccaoGlobal, string | null> = { microfone: null, som: null, overlay: null }
  for (const accao of ACCOES_GLOBAIS) {
    const valor = cru[accao]
    saida[accao] = typeof valor === "string" && valor.length > 0 && valor.length <= 64 ? valor : null
  }
  return saida
}

const VAZIO = (): EstadoDosAtalhosGlobais => ({ globais: [], soComAJanela: [], ocupados: [], faltaAcessibilidade: [] })

/**
 * The registry of globals. Keeps track of what it registered so it only frees
 * its own: `unregisterAll` would also take shortcuts that another part of main
 * might register.
 */
export function criarAtalhosGlobais(opcoes: {
  porta: PortaDeAtalhos
  plataforma: string
  /** `systemPreferences.isTrustedAccessibilityClient(false)`, lido no momento. */
  temAcessibilidade: () => boolean
  aoAccionar: (accao: AccaoGlobal) => void
}): {
  definir: (pedido: unknown) => EstadoDosAtalhosGlobais
  suspender: (sim: boolean) => void
  libertar: () => void
} {
  const registados = new Map<string, AccaoGlobal>()

  const libertar = (): void => {
    for (const acelerador of registados.keys()) {
      try {
        opcoes.porta.unregister(acelerador)
      } catch {
        // It wasn't registered anymore. What we want is for it to stay that way, and it does.
      }
    }
    registados.clear()
  }

  const definir = (pedido: unknown): EstadoDosAtalhosGlobais => {
    // Always from scratch: a shortcut changed mid-call can't leave the old one stuck
    // to the key.
    libertar()
    const estado = VAZIO()
    const lido = lerPedido(pedido)
    if (!lido) return estado
    for (const accao of ACCOES_GLOBAIS) {
      const combinacao = lido[accao]
      if (combinacao === null) continue
      const acelerador = aceleradorDe(combinacao)
      if (acelerador === null) {
        estado.soComAJanela.push(accao)
        continue
      }
      // The same key for both can only go to the first.
      if (registados.has(acelerador)) {
        estado.ocupados.push(accao)
        continue
      }
      if (pedeAcessibilidade(acelerador, opcoes.plataforma) && !opcoes.temAcessibilidade()) {
        estado.faltaAcessibilidade.push(accao)
        continue
      }
      let feito = false
      try {
        feito = opcoes.porta.register(acelerador, () => opcoes.aoAccionar(accao))
      } catch {
        // An accelerator that Electron doesn't recognize throws instead of returning
        // `false`. For users it's the same: only works with the window in front.
        estado.soComAJanela.push(accao)
        continue
      }
      if (feito) {
        registados.set(acelerador, accao)
        estado.globais.push(accao)
      } else {
        // The system silently refuses when another app already has the key.
        estado.ocupados.push(accao)
      }
    }
    return estado
  }

  return {
    definir,
    suspender: (sim) => opcoes.porta.setSuspended(sim === true),
    libertar,
  }
}
