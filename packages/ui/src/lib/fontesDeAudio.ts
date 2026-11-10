/**
 * Audio source options, and what THIS host can supply from each.
 *
 * Phase 9 table from `docs/planos/definicoes-0-9.md`, written as code:
 *
 * | Source | Web | Desktop app |
 * |---|---|---|
 * | Files or list | yes | yes |
 * | Browser tab | Chromium only | yes |
 * | System audio | Windows in Chromium only | Windows and macOS ≥ 14.2 |
 * | Window or app | never | Windows and macOS, with native capture |
 *
 * Two different questions, both answers go into the selector:
 *
 *  - **Can the host supply this?** It is platform physics. When it cannot, the
 *    source appears disabled with the reason for this device-not hidden: a
 *    source that vanishes sends people looking to Settings.
 *  - **Does this version implement it?** All four, since 2/11/2026: files in
 *    the first slice, tab, system, and window in the second (sound comes from
 *    `getDisplayMedia`, see `somDoDj.ts` in the core). The pattern stands: a
 *    new source the platform supplies that the version does not yet implement
 *    says "Not yet in this version", which is true, not a platform phrase.
 *
 * On the desktop app, the tab and window bring sound from the ENTIRE SYSTEM:
 * Electron only gives `loopback`, not a window's sound. The sheet says so
 * (`strings.musica.notaDaFonte`). Where the system does not give `loopback`
 * (Linux, macOS before 14.2), the refusal comes upfront, before the selector
 * (Error 481), like screen audio already does.
 *
 * `porque` values are keys; phrases live in `strings.musica.porqueNao`.
 */

export type FonteDeAudio = "ficheiros" | "separador" | "sistema" | "janela"

/** Selector order. The first is the one active everywhere. */
export const FONTES_DE_AUDIO: readonly FonteDeAudio[] = ["ficheiros", "separador", "sistema", "janela"]

/** Sources this version already implements. See the header. */
const FEITAS: ReadonlySet<FonteDeAudio> = new Set(["ficheiros", "separador", "sistema", "janela"])

export interface Anfitriao {
  /** The desktop app (Electron), not a browser tab. */
  secretaria: boolean
  sistema: "windows" | "macos" | "linux" | "outro"
  motor: "chromium" | "firefox" | "safari" | "outro"
}

export interface FonteOferecida {
  fonte: FonteDeAudio
  /** Can be picked now. */
  activa: boolean
  /** Why not, when unavailable: a key from `strings.musica.porqueNao`. */
  porque: string | null
}

/**
 * Read the host from `userAgent`. Only to pick phrases, never security.
 *
 * Chromium freezes the macOS version in the agent (`10_15_7`), so the version
 * does not read from here: on the desktop app, system audio already says for
 * itself when macOS is old (see `somDoEcraDisponivel` in the core).
 */
export function anfitriaoDoAgente(agente: string, secretaria: boolean): Anfitriao {
  const sistema = /Windows/i.test(agente)
    ? "windows"
    : /Mac OS X|Macintosh/i.test(agente)
      ? "macos"
      : /Linux|X11|CrOS/i.test(agente)
        ? "linux"
        : "outro"
  // Edge, Opera, and Electron say "Chrome/"; Safari does not. Firefox says "Firefox/".
  const motor = /Firefox\//.test(agente)
    ? "firefox"
    : /Chrome\/|Chromium\/|Electron\//.test(agente)
      ? "chromium"
      : /Safari\//.test(agente)
        ? "safari"
        : "outro"
  return { secretaria, sistema, motor }
}

/** What the platform supplies from each source, before knowing what this version does. */
function porqueAPlataformaNaoDa(fonte: FonteDeAudio, anfitriao: Anfitriao): string | null {
  const { secretaria, sistema, motor } = anfitriao
  switch (fonte) {
    case "ficheiros":
      return null
    case "separador":
      if (secretaria) return null
      return motor === "chromium" ? null : "separador-sem-browser"
    case "sistema":
      if (secretaria) return sistema === "linux" ? "sistema-linux" : sistema === "outro" ? "sistema-so-na-app" : null
      if (sistema !== "windows") return "sistema-so-na-app"
      return motor === "chromium" ? null : "sistema-sem-browser"
    case "janela":
      if (!secretaria) return "janela-sem-browser"
      return sistema === "windows" || sistema === "macos" ? null : "janela-linux"
  }
}

/**
 * All four sources, in selector order, with what this host supplies.
 *
 * A source the platform supplies but this version does not yet implement comes
 * with `porque: "ainda-nao"`. See the header.
 */
export function fontesDeAudioDoAnfitriao(anfitriao: Anfitriao): FonteOferecida[] {
  return FONTES_DE_AUDIO.map((fonte) => {
    const plataforma = porqueAPlataformaNaoDa(fonte, anfitriao)
    if (plataforma !== null) return { fonte, activa: false, porque: plataforma }
    if (!FEITAS.has(fonte)) return { fonte, activa: false, porque: "ainda-nao" }
    return { fonte, activa: true, porque: null }
  })
}
