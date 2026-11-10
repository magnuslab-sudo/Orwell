import { useCallback, useSyncExternalStore } from "react"
import {
  aoMudarLingua,
  definirLingua,
  escolherLingua,
  guardarPreferencia,
  lerPreferencia,
  linguaActual,
  LINGUA_BASE,
  linguasDoSistemaDoArranque,
  type Lingua,
  type PreferenciaDeLingua,
} from "../strings.js"

/**
 * The active language, and how to change it.
 *
 * `strings` is an object that replaces itself when the language changes
 * (see `strings.ts`). That's enough for the next text to be right, but not
 * enough for React to redraw what's already on the screen: nothing in its
 * dependencies changed, because `strings` is not state. This hook is the
 * missing link, and that's why it's `useSyncExternalStore` not `useState`, the
 * source of truth lives outside React and must keep living, or text outside
 * components (a system notification, a window title) would read another language.
 *
 * Called once, at the top of `App`. A language change redraws the entire tree,
 * which is exactly what a language change is.
 */
export function useLingua(): Lingua {
  return useSyncExternalStore(aoMudarLingua, linguaActual, aBase)
}

/** Outside a browser there is no detected language: there is the base. */
function aBase(): Lingua {
  return LINGUA_BASE
}

/*
  The listeners for the CHOICE, not the listeners for the language.
  
  Separated on purpose: `aoMudarLingua` fires when what shows changes, and
  there is one action that doesn't change it, going back to automatic on a
  system already showing the same language. `strings` stays the same, and
  that's fine; what changed was what's marked in settings, and without its own
  alert the button wouldn't light up.
  */
const ouvintesDaEscolha = new Set<() => void>()

function aoMudarEscolha(ouvinte: () => void): () => void {
  const largarLingua = aoMudarLingua(ouvinte)
  ouvintesDaEscolha.add(ouvinte)
  return () => {
    ouvintesDaEscolha.delete(ouvinte)
    largarLingua()
  }
}

/**
 * This person's choice, and the action to change it.
 *
 * Returns the PREFERENCE not just the language: they are different things, and
 * the difference shows on the screen. Someone who picked "automatic" on an
 * English system sees the interface in English, but what's marked in settings
 * is "automatic", because that's what's picked, and because changing the
 * system language has to keep changing the app.
 */
export function usePreferenciaDeLingua(): {
  preferencia: PreferenciaDeLingua
  lingua: Lingua
  escolher: (preferencia: PreferenciaDeLingua) => void
} {
  const lingua = useLingua()
  const preferencia = useSyncExternalStore(aoMudarEscolha, lerPreferencia, oAutomatico)

  const escolher = useCallback((proxima: PreferenciaDeLingua) => {
    aplicarEscolhaDeLingua(proxima)
    for (const ouvinte of [...ouvintesDoGesto]) ouvinte(proxima)
  }, [])

  return { preferencia, lingua, escolher }
}

/**
 * Save and show a language choice, from whoever made it.
 *
 * The settings action passes through here, and so does the choice arriving
 * from a sibling device through the account (`lib/preferenciasDaConta.ts`).
 * Only the action alerts `aoEscolherLingua`: the choice from outside is
 * already in the account.
 */
export function aplicarEscolhaDeLingua(proxima: PreferenciaDeLingua): void {
  guardarPreferencia(proxima)
  definirLingua(proxima === "auto" ? escolherLingua({ doSistema: linguasDoSistemaDoArranque() ?? doNavegador() }) : proxima)
  for (const ouvinte of [...ouvintesDaEscolha]) ouvinte()
}

const ouvintesDoGesto = new Set<(preferencia: PreferenciaDeLingua) => void>()

/** Someone picked a language in settings ON THIS DEVICE. */
export function aoEscolherLingua(ouvinte: (preferencia: PreferenciaDeLingua) => void): () => void {
  ouvintesDoGesto.add(ouvinte)
  return () => {
    ouvintesDoGesto.delete(ouvinte)
  }
}

function doNavegador(): readonly string[] {
  if (typeof navigator === "undefined") return []
  const lista = navigator.languages
  return Array.isArray(lista) && lista.length > 0 ? lista : [navigator.language]
}

function oAutomatico(): PreferenciaDeLingua {
  return "auto"
}
