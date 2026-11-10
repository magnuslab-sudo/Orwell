/**
 * Keyboard shortcuts for voice commands, configurable by the user.
 *
 * Until October 19, 2026 there was only one, fixed (Ctrl or Cmd + Shift + M
 * for the microphone). The owner asked that voice commands could have the key
 * each person wants, like in Discord, and that it would live in Settings.
 *
 * The combination is stored as text, in one form only, so the preferences vault
 * and the screen read the same thing: the modifiers in a fixed order ("Mod",
 * "Alt", "Shift") and then the key. "Mod" is Ctrl or Cmd, because on macOS Cmd
 * is what the hand does without thinking and requiring one of them would make
 * the shortcut something only half the computers got right the first time.
 */

export const ACCOES_DE_VOZ = ["microfone", "som", "camara", "ecra", "sair", "falar", "overlay"] as const

export type AccaoDeVoz = (typeof ACCOES_DE_VOZ)[number]

export type MapaDeAtalhos = Record<AccaoDeVoz, string | null>

/** What comes from the factory. The "speak" (press to speak) has no key until the user picks one. */
export const ATALHOS_POR_OMISSAO: MapaDeAtalhos = {
  microfone: "Mod+Shift+M",
  som: "Mod+Shift+D",
  camara: "Mod+Shift+V",
  ecra: "Mod+Shift+E",
  sair: "Mod+Shift+L",
  falar: null,
  /**
   * Show or hide the game overlay. Without Ctrl on purpose: gamers have their
   * left hand on the keyboard and Ctrl in the middle of the game keys. Alt and
   * Shift with a letter is global (see `aceleradorDe` in the main).
   */
  overlay: "Alt+Shift+O",
}

/**
 * The commands that only exist in the desktop app. On the web they do not show
 * in Settings: there is no game overlay there.
 */
export const SO_NA_SECRETARIA: readonly AccaoDeVoz[] = ["overlay"]

const SO_MODIFICADORES = new Set(["Control", "Meta", "Alt", "Shift", "AltGraph", "CapsLock", "Fn", "OS"])

/** Keys with an owner: taking them from the browser or modals breaks more than it fixes. */
const PROIBIDAS = new Set(["Escape", "Tab", "Enter", "Backspace", "Delete", "Dead", "Unidentified"])

function nomeDaTecla(key: string): string | null {
  if (SO_MODIFICADORES.has(key) || PROIBIDAS.has(key)) return null
  if (key === " ") return "Space"
  if (key.length === 1) return key.toUpperCase()
  return key
}

/**
 * The combination from a keyboard event, or `null` when there is no key yet
 * (only a modifier coming down) or when the key cannot be a shortcut.
 */
export function combinacaoDeEvento(event: {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}): string | null {
  const tecla = nomeDaTecla(event.key)
  if (!tecla) return null
  const partes: string[] = []
  if (event.ctrlKey === true || event.metaKey === true) partes.push("Mod")
  if (event.altKey === true) partes.push("Alt")
  if (event.shiftKey === true) partes.push("Shift")
  partes.push(tecla)
  return partes.join("+")
}

/**
 * The side mouse buttons, as the user counts them: "button 4" (the back one)
 * and "button 5" (the forward one). In the DOM they are `button` 3 and 4
 * (counted from zero). The first three (left, right, and wheel) are left out:
 * they have an owner, and taking them from the click breaks the whole app.
 */
const BOTOES_DO_RATO: Record<number, string> = { 3: "Mouse4", 4: "Mouse5" }

/**
 * The combination from a mouse button, or `null` when the button cannot be a
 * shortcut. Modifiers count as on the keyboard.
 */
export function combinacaoDeRato(event: {
  button: number
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}): string | null {
  const botao = BOTOES_DO_RATO[event.button]
  if (!botao) return null
  const partes: string[] = []
  if (event.ctrlKey === true || event.metaKey === true) partes.push("Mod")
  if (event.altKey === true) partes.push("Alt")
  if (event.shiftKey === true) partes.push("Shift")
  partes.push(botao)
  return partes.join("+")
}

/** The mouse button of this combination (4 or 5), or `null` if it is a key. */
export function botaoDoRato(combinacao: string): 4 | 5 | null {
  const tecla = combinacao.split("+").pop()
  return tecla === "Mouse4" ? 4 : tecla === "Mouse5" ? 5 : null
}

function partir(combinacao: string): { mods: string[]; tecla: string } {
  const partes = combinacao.split("+")
  return { mods: partes.slice(0, -1), tecla: partes[partes.length - 1] ?? "" }
}

/**
 * Accepts any single key, and mouse buttons 4 and 5.
 *
 * Up to 1.0.5 a lone key was not accepted: only Mod, Alt, F1 to F12, or Shift
 * with a key that does not type. The owner and the community asked for the
 * opposite (point 8 of `docs/planos/depois-da-1-0.md`): people who play games
 * use F13, `` ` `` or a mouse button, and do not want Ctrl. The risk of a key
 * that types is still there, and it is handled elsewhere: the recorder warns
 * (`avisoDaCombinacao`), the text box keeps what it types
 * (`pertenceACaixaDeTexto`), and the desktop app never registers it as global.
 */
export function combinacaoValida(combinacao: string): boolean {
  const { mods, tecla } = partir(combinacao)
  if (tecla.length === 0) return false
  if (mods.some((parte) => parte !== "Mod" && parte !== "Alt" && parte !== "Shift")) return false
  if (new Set(mods).size !== mods.length) return false
  if (SO_MODIFICADORES.has(tecla) || PROIBIDAS.has(tecla)) return false
  if (tecla.startsWith("Mouse")) return tecla === "Mouse4" || tecla === "Mouse5"
  return true
}

/** A key that writes a character, without Mod or Alt (Shift only changes the letter). */
export function escreveTexto(combinacao: string): boolean {
  const { mods, tecla } = partir(combinacao)
  if (mods.includes("Mod") || mods.includes("Alt")) return false
  return tecla === "Space" || [...tecla].length === 1
}

/** Navigation keys in text. Alone in a text box, they move the cursor. */
const TECLAS_DE_CURSOR = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"])

/**
 * A common key: letter, number, space, or cursor key, without Mod or Alt.
 * Everyone uses these in every app all the time. They work as shortcuts when
 * the app is in focus, never as global shortcuts: a global shortcut takes the
 * key from the whole system, and an "M" that stops writing in your email during
 * a call is exactly the kind of shock that makes people uninstall.
 */
export function teclaComum(combinacao: string): boolean {
  const { mods, tecla } = partir(combinacao)
  if (mods.includes("Mod") || mods.includes("Alt")) return false
  return tecla === "Space" || TECLAS_DE_CURSOR.has(tecla) || /^[\p{L}\p{N}]$/u.test(tecla)
}

/**
 * In a text box, what writes or moves the cursor belongs to the box. A function
 * or media key (F13, `MediaPlayPause`) passes through: it writes nothing, and
 * muting in the middle of a sentence is exactly when you need it.
 */
export function pertenceACaixaDeTexto(combinacao: string): boolean {
  return escreveTexto(combinacao) || teclaComum(combinacao)
}

/**
 * The warning shown when recording. `comum`: the key writes everywhere, so it
 * only works with the app in focus and outside text boxes. `escreve`: a symbol
 * like `` ` ``; on the desktop app it becomes global during a call, and in that
 * time it stops writing in other apps.
 */
export function avisoDaCombinacao(combinacao: string): "comum" | "escreve" | null {
  if (botaoDoRato(combinacao) !== null) return null
  if (teclaComum(combinacao)) return "comum"
  if (escreveTexto(combinacao)) return "escreve"
  return null
}

/**
 * Media keys that macOS only delivers to an app with Accessibility permission,
 * when the shortcut is global. See `pedeAcessibilidade` in
 * `apps/client/src/main/atalhos.ts`, which decides from the main process.
 */
export function pedeAcessibilidadeNoMac(combinacao: string): boolean {
  const tecla = combinacao.split("+").pop() ?? ""
  return tecla === "MediaPlayPause" || tecla === "MediaTrackNext" || tecla === "MediaTrackPrevious" || tecla === "MediaStop"
}

/** The commands that the desktop app registers as global during a call. */
export const ACCOES_GLOBAIS = ["microfone", "som", "overlay"] as const satisfies readonly AccaoDeVoz[]

export type AccaoGlobal = (typeof ACCOES_GLOBAIS)[number]

/** The combination as the user reads it on screen: "⌘⇧M" on Mac, "Ctrl+Shift+M" elsewhere. */
export function formatarCombinacao(
  combinacao: string,
  plataforma: "mac" | "outra",
  rotuloDoRato: (botao: 4 | 5) => string = (botao) => `Mouse ${botao}`,
): string {
  const partes = combinacao.split("+")
  const botao = botaoDoRato(combinacao)
  const tecla = botao !== null ? rotuloDoRato(botao) : (partes[partes.length - 1] ?? "")
  const mods = partes.slice(0, -1)
  // On Mac the symbols stick to the key; before a full name ("Mouse 4") there is a space.
  if (plataforma === "mac" && botao !== null && mods.length > 0) {
    const simbolo = { Mod: "⌘", Alt: "⌥", Shift: "⇧" } as const
    return `${mods.map((m) => simbolo[m as keyof typeof simbolo] ?? m).join("")} ${tecla}`
  }
  if (plataforma === "mac") {
    const simbolo = { Mod: "⌘", Alt: "⌥", Shift: "⇧" } as const
    return mods.map((m) => simbolo[m as keyof typeof simbolo] ?? m).join("") + tecla
  }
  return [...mods.map((m) => (m === "Mod" ? "Ctrl" : m)), tecla].join("+")
}

export function plataformaDoTeclado(agente: string = typeof navigator === "undefined" ? "" : navigator.userAgent): "mac" | "outra" {
  return /Mac|iPhone|iPad/.test(agente) ? "mac" : "outra"
}

/** Which voice command, if any, is linked to this combination. */
export function accaoDaCombinacao(combinacao: string, mapa: MapaDeAtalhos): AccaoDeVoz | null {
  for (const accao of ACCOES_DE_VOZ) if (mapa[accao] === combinacao) return accao
  return null
}

/**
 * The map from disk, sanitized: anything that is not a valid combination falls
 * back to the default for that action. An explicit `null` value means "no
 * shortcut", and we respect it, because the user cleared it.
 */
export function lerMapaDeAtalhos(valor: unknown): MapaDeAtalhos {
  const mapa: MapaDeAtalhos = { ...ATALHOS_POR_OMISSAO }
  if (!valor || typeof valor !== "object") return mapa
  const guardado = valor as Record<string, unknown>
  for (const accao of ACCOES_DE_VOZ) {
    const v = guardado[accao]
    if (v === null) mapa[accao] = null
    else if (typeof v === "string" && combinacaoValida(v)) mapa[accao] = v
  }
  return mapa
}
