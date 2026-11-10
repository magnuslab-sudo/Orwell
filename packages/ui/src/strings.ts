import { en, errosEn } from "./linguas/en.js"
import { errosPt, pt } from "./linguas/pt.js"
import { comChaveDoBrowser } from "@enclave/client-core"
import {
  CHAVES_DO_EMPARELHAMENTO,
  CODIGO_DESCONHECIDO,
  codigoDoErro,
  type DetalheDoErro,
  type FraseDeErro,
} from "./lib/codigosDeErro.js"
import {
  type ArranqueDaLingua,
  detectarLingua,
  LINGUA_BASE,
  type Lingua,
} from "./escolha-da-lingua.js"

/**
 * The interface language: who chooses it, and what happens when text is missing.
 *
 * ## The design, in three lines
 *
 * Portuguese is the BASE language and the only complete catalog
 * (`linguas/pt.ts`). The others are partial OVERLAYS (`linguas/en.ts`). When
 * switching language, one merges with the other, sheet by sheet, and what the
 * overlay does not say stays in Portuguese. A raw key never reaches the screen,
 * because no sheet exists without Portuguese underneath.
 *
 * ## Why `strings` is `let`
 *
 * One hundred thirty-eight files write `strings.chat.alguma.coisa`, two thousand
 * times. Swapping that for a translation function would rewrite the whole
 * interface to change language, and each rewritten line is one where text can
 * be wrong without the compiler noticing.
 *
 * An `export let` reassigned keeps all that intact: ES module links are LIVE,
 * so whoever imported `strings` reads the current object on each access, with
 * no middleman and no cost. What this demands is one rule: **never store a
 * piece of `strings` outside a render**. A `const { chat } = strings` at the
 * top of a module freezes startup language. Today there is none, and a test
 * verifies it.
 *
 * ## Why startup is explicit
 *
 * `arrancarLingua()` is the only place that looks at `navigator`, and it is
 * called by HOSTS, `apps/web/src/main.tsx` and
 * `apps/client/src/renderer/main.tsx`. Never by this module when it loads. (The
 * web has a second reader, earlier and by the same rule: `apps/web/src/lingua-cedo.ts`,
 * which only sets the `<html lang>` for the splash in `index.html`. See
 * `escolha-da-lingua.ts`.)
 *
 * The reason is measurable: without it, detection would also run inside the
 * jsdom test environment, where `navigator.language` is "en-US". Twenty-seven
 * hundred assertions written against Portuguese text would run against English,
 * and the whole suite would go red because of a product decision. Without the
 * call, the language is Portuguese, and that is how tests find it: by default,
 * not by luck.
 *
 * Playwright scripts are the other side of that coin. They run the app for real,
 * where detection RUNS, and search for literal Portuguese text, a browser in
 * English breaks them all at once. So they ask for the language in the address
 * (`?lingua=pt`), from `scripts/ambiente.mjs`, and there is a test that fails
 * if a script opens the app without that request. See `guioes.lingua.test.ts`.
 */

// The choice rule lives in `escolha-da-lingua.ts`, without catalogs: see there why.
export {
  type ArranqueDaLingua,
  CHAVE_DA_LINGUA,
  detectarLingua,
  eLingua,
  ePreferencia,
  escolherLingua,
  type FontesDaLingua,
  guardarPreferencia,
  LINGUA_BASE,
  LINGUAS,
  type Lingua,
  linguaNoEndereco,
  lerPreferencia,
  PARAMETRO_DA_LINGUA,
  type PreferenciaDeLingua,
} from "./escolha-da-lingua.js"

/**
 * A translated sheet.
 *
 * Functions pass through unchanged, the overlay must bring the SAME signature,
 * and the compiler demands it. Text widens from literal to `string`: the
 * Portuguese catalog is `as const`, and without this English would have to say
 * exactly the same Portuguese word to compile.
 */
type Vertida<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends string
    ? string
    : T extends readonly (infer U)[]
      ? readonly Vertida<U>[]
      : { [K in keyof T]: Vertida<T[K]> }

/** A translated sheet, or none: that is what makes a partial language legitimate. */
type Parcial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends string
    ? string
    : T extends readonly (infer U)[]
      ? readonly Vertida<U>[]
      : { [K in keyof T]?: Parcial<T[K]> }

/** The catalog as the interface reads it: Portuguese form, with full text strings. */
export type Catalogo = { [K in keyof typeof pt]: Vertida<(typeof pt)[K]> }

/**
 * A language that is not the base: can say everything, can say one line.
 *
 * What it does not say falls back to Portuguese, and that is what makes
 * translation work that can be done in pieces without leaving the interface
 * half-built.
 */
export type Traducao = { [K in keyof typeof pt]?: Parcial<(typeof pt)[K]> }

/**
 * An overlay on the base, leaf by leaf.
 *
 * Only simple objects descend: a function and an array are LEAVES and replace
 * entirely. An array half-translated-three options in English and two in
 * Portuguese-was exactly the result we do not want.
 */
function juntar(base: unknown, por_cima: unknown): unknown {
  if (por_cima === undefined) return base
  if (typeof por_cima === "function" || Array.isArray(por_cima)) return por_cima
  if (typeof base !== "object" || base === null || Array.isArray(base)) return por_cima
  if (typeof por_cima !== "object" || por_cima === null) return por_cima

  const saida: Record<string, unknown> = {}
  for (const [chave, valor] of Object.entries(base as Record<string, unknown>)) {
    saida[chave] = juntar(valor, (por_cima as Record<string, unknown>)[chave])
  }
  return saida
}

/**
 * The built catalogs, one per language, built once.
 *
 * The merge traverses eight hundred or so leaves. Doing it on each language
 * change would be cheap; doing it on each read would be absurd, and that is
 * why this is not a `Proxy`.
 */
const MONTADOS = new Map<Lingua, Catalogo>([["pt", pt as Catalogo]])

function catalogo(lingua: Lingua): Catalogo {
  const guardado = MONTADOS.get(lingua)
  if (guardado) return guardado
  const feito = juntar(pt, TRADUCOES[lingua]) as Catalogo
  MONTADOS.set(lingua, feito)
  return feito
}

const TRADUCOES: Record<Lingua, Traducao> = { pt: {}, en }

const ERROS: Record<Lingua, Record<string, FraseDeErro>> = { pt: errosPt, en: errosEn }

let actual: Lingua = LINGUA_BASE

/**
 * All visible text, in the active language.
 *
 * `let` and not `const`: see the note at the top. The caller always reads what
 * is now, never what was when the module loaded.
 */
export let strings: Catalogo = pt as Catalogo

/** The language being shown right now. */
export function linguaActual(): Lingua {
  return actual
}

const OUVINTES = new Set<() => void>()

/**
 * Get notified when the language changes.
 *
 * Exists so React re-renders: `strings` changed underneath it, and without a
 * signal the tree kept the old text until something else moved. See
 * `hooks/useLingua.ts`.
 */
export function aoMudarLingua(ouvinte: () => void): () => void {
  OUVINTES.add(ouvinte)
  return () => {
    OUVINTES.delete(ouvinte)
  }
}

/**
 * Switch to another language. Returns `true` if anything changed.
 *
 * Does not save: saving is a choice for the caller, and the requester may be
 * just obeying an address or the system. See `guardarPreferencia`.
 */
export function definirLingua(lingua: Lingua): boolean {
  if (lingua === actual) return false
  actual = lingua
  strings = catalogo(lingua)
  for (const ouvinte of [...OUVINTES]) ouvinte()
  return true
}

/**
 * The system languages the host gave on startup, if it gave any.
 *
 * Going back to "automatic" in settings must decide from the same list as
 * startup. In the installed app that list comes from the main process, and the
 * renderer's `navigator` often says something else (see `ArranqueDaLingua`).
 */
let linguasDoAnfitriao: readonly string[] | undefined

/** The host's list, if it gave one on startup. Otherwise nothing: read `navigator`. */
export function linguasDoSistemaDoArranque(): readonly string[] | undefined {
  return linguasDoAnfitriao
}

/**
 * Detect and apply the language. Called ONCE, by the host, on startup.
 *
 * Returns the chosen language-the caller may want to mark it in `<html lang>`,
 * and should.
 */
export function arrancarLingua(opcoes: ArranqueDaLingua = {}): Lingua {
  linguasDoAnfitriao = opcoes.doSistema
  const escolhida = detectarLingua(opcoes)
  definirLingua(escolhida)
  return escolhida
}

/**
 * Raw English that escapes from client-core, spoken in the app's voice.
 *
 * In English the map also exists, and it is not redundancy: what the core
 * throws are fragments ("vault is locked"), and what lands on screen must be
 * a sentence said to a person.
 *
 * A message the table does not know is "Error 900", in three lines: the code,
 * the phrase "An error occurred that the app does not recognize.", and the raw
 * message, which `TextoDeErro` draws smaller. The raw message does not
 * translate or hide: a wrong translation hides what really happened, and it is
 * what the person pastes in a report.
 *
 * The second argument is the error `cause`, where the core puts data that does
 * not fit in the key (the channel, the number of channels, the maximum for
 * fixed lines). It is optional on purpose: some paths bring only the message
 * (an event, a session state), and the phrase must come out whole without it.
 */
export function translateError(message: string, cause?: unknown): string {
  // `String(...)`: anything thrown that is not `Error` arrives here as `undefined`,
  // and `hasOwn`: the key "constructor" cannot fetch `Object` from the prototype.
  const chave = String(message ?? "")
  const codigo = codigoDoErro(chave)
  if (codigo === CODIGO_DESCONHECIDO) {
    const cru = chave.trim()
    return `${strings.errors.codigo(codigo)}\n${strings.errors.desconhecido}${cru === "" ? "" : `\n${cru}`}`
  }
  const catalogo = ERROS[actual]
  const entrada = Object.hasOwn(catalogo, chave) ? catalogo[chave] : undefined
  const frase = typeof entrada === "function" ? entrada(detalheDe(cause)) : (entrada ?? chave)
  return `${strings.errors.codigo(codigo)}\n${frase}`
}

/**
 * An error caught in a `catch`, stated like the others.
 *
 * It is `translateError` for the whole error, not just the message: a browser
 * error (`NotAllowedError`, `QuotaExceededError`) carries in its `name` what
 * it is, and in its `message` a phrase from each engine that never is any key.
 * Here the `name` gets its key (see `erros-do-browser.ts` in the core) before
 * the code is looked up. Everything else passes as in `translateError`.
 */
export function traduzirErro(erro: unknown): string {
  const comChave = comChaveDoBrowser(erro)
  if (comChave instanceof Error) return translateError(comChave.message, comChave.cause)
  return translateError(String(comChave ?? ""))
}

/**
 * The failure of a pairing, stated like the other errors.
 *
 * Takes both things that arrive by that path: the code `PairFalha` from the
 * core ("refused:full"), which gets swapped for the table key, and a key that
 * already is a key (the `Session` refuses before pairing begins).
 */
export function translatePairingError(razao: string, cause?: unknown): string {
  return translateError(CHAVES_DO_EMPARELHAMENTO[razao] ?? razao, cause)
}

/** The `cause` read as detail. Only a plain object counts; the rest is empty. */
function detalheDe(cause: unknown): DetalheDoErro {
  if (typeof cause !== "object" || cause === null || cause instanceof Error || Array.isArray(cause)) return {}
  return cause as DetalheDoErro
}
