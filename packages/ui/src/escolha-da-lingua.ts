/**
 * Which language to show: the whole rule, without catalogs.
 *
 * It lived inside `strings.ts` until November 3, 2026. It moved here so the
 * web can run BEFORE the first draw: the splash in `apps/web/index.html` says
 * "Opening..." in the language of who opens it, and who sets it in `<html lang>`
 * is a small classic script (`apps/web/src/lingua-cedo.ts`). That script is
 * synchronous and blocks the first draw; with the catalogs and the `client-core`
 * that `strings.ts` pulls in, it would stop being small.
 *
 * This module imports nothing, and it has to stay that way. `strings.ts`
 * reexports everything, and that is how the rest of the interface uses it.
 */

/** The languages that really exist, not the ones that could be asked for from a machine. */
export type Lingua = "pt" | "en"

/**
 * The base language. It is the only one required to be complete, and it is
 * where everything falls back.
 *
 * It is also the default value anywhere detection does not run: tests, environments
 * without `window`, and a `navigator.languages` that names only languages that
 * do not exist here. A German speaker gets Portuguese and changes it in settings,  * what they do NOT get is an automatic translation no one read, which in a privacy
 * product is the worst of the three choices.
 */
export const LINGUA_BASE: Lingua = "pt"

/**
 * What can be chosen: a language, or follow the system.
 *
 * "auto" must be a saveable value and not the absence of one: without it, someone
 * who chose Portuguese on a Portuguese system would stay locked to Portuguese
 * forever, and changing the system would have no effect with no one knowing why.
 */
export type PreferenciaDeLingua = Lingua | "auto"

/** Where the choice lives. `enclave.` like the rest: see the note in `linguas/pt.ts`. */
export const CHAVE_DA_LINGUA = "enclave.lingua"

/** The URL parameter that forces the language. Scripts ask through here. */
export const PARAMETRO_DA_LINGUA = "lingua"

/**
 * The languages, with the name written in the language itself.
 *
 * In its own language on purpose: someone who opens the app in Portuguese by
 * mistake needs to be able to find "English" without reading Portuguese, and
 * "Inglês" does not do that.
 */
export const LINGUAS: readonly { readonly codigo: Lingua; readonly nome: string }[] = [
  { codigo: "pt", nome: "Português" },
  { codigo: "en", nome: "English" },
]

/** Is it a language that exists? Narrows the string, and is used at all boundaries. */
export function eLingua(valor: unknown): valor is Lingua {
  return valor === "pt" || valor === "en"
}

/** Is it a saveable choice? A language, or follow the system. */
export function ePreferencia(valor: unknown): valor is PreferenciaDeLingua {
  return valor === "auto" || eLingua(valor)
}

/**
 * The choice saved on this device. Nothing written means "auto".
 *
 * Lenient reading like the rest of what lives in `localStorage`: garbage reads
 * as absence. A broken key cannot be the reason the app does not open, much less
 * to open in a language no one asked for.
 */
export function lerPreferencia(armazem: Pick<Storage, "getItem"> | undefined = armazemPadrao()): PreferenciaDeLingua {
  try {
    const cru = armazem?.getItem(CHAVE_DA_LINGUA)
    return ePreferencia(cru) ? cru : "auto"
  } catch {
    return "auto"
  }
}

/** Save a choice. Only those who choose call this, never on startup. */
export function guardarPreferencia(
  preferencia: PreferenciaDeLingua,
  armazem: Pick<Storage, "setItem"> | undefined = armazemPadrao(),
): void {
  try {
    armazem?.setItem(CHAVE_DA_LINGUA, preferencia)
  } catch {
    // Storage full or blocked. The choice still works for this session.
  }
}

function armazemPadrao(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage
  } catch {
    // A browser with blocked storage throws only when you touch the object.
    return undefined
  }
}

/** Where the language can come from, in order of authority. */
export interface FontesDaLingua {
  /**
   * What the URL asks for: `?lingua=en`. Beats everything.
   *
   * It is the gate for scripts, and it is also a URL you can send to someone with
   * the language already chosen. It does not save on purpose: a link is not a
   * decision about the device of whoever opens it.
   */
  doEndereco?: string | null | undefined
  /** What this person chose, on this device. "auto" means follow the system. */
  guardada?: PreferenciaDeLingua | undefined
  /**
   * What the system says, in order of preference.
   *
   * `navigator.languages` in the browser; in Electron, what the main process
   * answers, see `arrancarLingua`.
   */
  doSistema?: readonly string[] | undefined
}

/**
 * Which language to show, decided without touching anything.
 *
 * Pure function, and that is what makes it the place where the rule is tested:
 * the whole order fits in assertions, no browser and no storage.
 *
 * The order: the URL, then the saved choice, then the system, then the base.
 * And the system reads IN ORDER, a `["fr-FR", "en-GB", "pt"]` gives English
 * not Portuguese, because the second preference of whoever wrote it really is
 * English, and serving them Portuguese because Portuguese is the base was ignoring
 * what they said.
 */
export function escolherLingua(fontes: FontesDaLingua = {}): Lingua {
  const pedida = normalizar(fontes.doEndereco ?? undefined)
  if (pedida) return pedida

  if (fontes.guardada && fontes.guardada !== "auto") return fontes.guardada

  for (const etiqueta of fontes.doSistema ?? []) {
    const encontrada = normalizar(etiqueta)
    if (encontrada) return encontrada
  }

  return LINGUA_BASE
}

/**
 * A BCP 47 tag narrowed to a language that exists here, or nothing.
 *
 * Only the primary subtag counts: "pt-BR" and "pt-PT" both give "pt". The
 * Brazilian speaker gets European Portuguese, which is not their language but is
 * their language much more than English; and "en-GB", "en-US" and "en" all give "en".
 */
function normalizar(etiqueta: string | undefined): Lingua | undefined {
  if (typeof etiqueta !== "string") return undefined
  const base = etiqueta.trim().toLowerCase().split(/[-_]/)[0]
  return eLingua(base) ? base : undefined
}

/** What the host can tell at startup, when it knows more than the browser. */
export interface ArranqueDaLingua {
  /**
   * The system languages, reported by the host.
   *
   * Electron has a better path: `app.getPreferredSystemLanguages()` in the main
   * process returns the list from the OPERATING SYSTEM, while `navigator.languages`
   * in the renderer returns the locale the application started with, on macOS that
   * is often just "en-US" even with the system set to Portuguese. See
   * `apps/client/src/renderer/main.tsx`.
   *
   * Absent is the normal case, which is the browser: it reads from `navigator`.
   */
  doSistema?: readonly string[] | undefined
  /** The address, for those who have it on hand. Defaults to the window's address. */
  endereco?: string | undefined
}

/** The `?lingua=` from an address, if present. */
export function linguaNoEndereco(endereco?: string): string | undefined {
  const cru = endereco ?? (typeof window === "undefined" ? undefined : window.location.href)
  if (!cru) return undefined
  try {
    return new URL(cru, "http://local").searchParams.get(PARAMETRO_DA_LINGUA) ?? undefined
  } catch {
    return undefined
  }
}

function linguasDoNavegador(): readonly string[] {
  if (typeof navigator === "undefined") return []
  // `languages` is the full list in order; `language` is just the first, and is
  // what remains in older environments.
  const lista = navigator.languages
  if (Array.isArray(lista) && lista.length > 0) return lista
  return typeof navigator.language === "string" ? [navigator.language] : []
}

/**
 * The language chosen at startup, without applying it.
 *
 * This is what `arrancarLingua` applies, and what `lingua-cedo.ts` marks in the
 * `<html lang>` before the first render: both decide by the same rule.
 */
export function detectarLingua(opcoes: ArranqueDaLingua = {}): Lingua {
  return escolherLingua({
    doEndereco: linguaNoEndereco(opcoes.endereco),
    guardada: lerPreferencia(),
    doSistema: opcoes.doSistema ?? linguasDoNavegador(),
  })
}
