import { aoEscolherLingua, aplicarEscolhaDeLingua } from "../hooks/useLingua.js"
import { ACCENTS, applyPrefs, DEFAULT_PREFS, PREFS_EVENT, readPrefs, writePrefs, type Density, type Prefs } from "../hooks/usePrefs.js"
import { CHAVE_DA_LINGUA, ePreferencia, lerPreferencia } from "../strings.js"
import { PREFERENCIA_MAX_CARACTERES } from "@enclave/protocol"
import { lerSilenciados } from "./silenciados.js"

/**
 * The interface preferences that travel between the account's devices.
 *
 * **Which ones, and why these.** The ones that belong to the PERSON, not the
 * device:
 *  - language (`interface.lingua`: "pt", "en", or "auto");
 *  - accent color (`interface.cor`: the index in `ACCENTS`);
 *  - density (`interface.densidade`: "confortavel" or "compacta");
 *  - what is muted (`interface.silenciados`: the list of keys from
 *    `lib/silenciados.ts`, in JSON). Muting a channel on the phone silences
 *    it on the computer. A list over `PREFERENCIA_MAX_CARACTERES` goes in
 *    parts (phase 1i): see `silenciadosEmPartes`.
 *
 * Stay on the device, by design: the microphone, camera, gain, volumes,
 * sounds, system notifications (they ask each device for permission), activity
 * (chosen per device, see `Prefs.activity`), keyboard shortcuts (keyboard is
 * per device), recent emojis, what is minimized on the sidebar, the position
 * of the call dock, and ownership of the separator.
 *
 * **`localStorage` is still read first.** The gate is drawn before the vault
 * opens, in the right language and color, and only `localStorage` exists at
 * that moment. The account sends next: when the account opens, what is there
 * goes into `localStorage` and onto the screen; what is missing from the
 * account and was chosen here goes up to it.
 */
export const PREFERENCIAS_QUE_VIAJAM = {
  lingua: "interface.lingua",
  cor: "interface.cor",
  densidade: "interface.densidade",
  silenciados: "interface.silenciados",
} as const

/**
 * The muted list in parts, to fit in preferences (phase 1i).
 *
 * A preference holds up to `PREFERENCIA_MAX_CARACTERES`, which gave 25 to 30
 * keys; over that the list stayed only on this device. Now it goes in parts:
 *  - `interface.silenciados`: the FIRST part, a JSON list as always. A sibling
 *    from an earlier version reads this and gets part of the list muted,
 *    instead of none;
 *  - `interface.silenciados.mais`: `"<n>:<marca>"`, how many parts come after
 *    the first and from what write;
 *  - `interface.silenciados.2`, `.3`, …: `{"v": marca, "l": [...]}`.
 *
 * Why not a new payload on the account channel: an earlier sibling would reject
 * it, and five rejections in a row made it deaf to the account channel (same
 * reason as phase 1e). Everyone knows preferences. The mark exists because
 * each part merges at its own time: a part from an old write does not mix with
 * ones from a new write. With parts missing, the account list has not arrived
 * yet.
 */
export const SILENCIADOS_MAIS = `${PREFERENCIAS_QUE_VIAJAM.silenciados}.mais`
const parteDosSilenciados = (indice: number): string => `${PREFERENCIAS_QUE_VIAJAM.silenciados}.${indice}`

export function silenciadosEmPartes(lista: readonly string[], marca = Date.now()): Record<string, string> {
  const partes: string[][] = [[]]
  // Space for the wrapper `{"v":…,"l":…}` of the parts that follow.
  const tecto = PREFERENCIA_MAX_CARACTERES - 40
  for (const chave of lista) {
    const actual = partes[partes.length - 1]!
    if (JSON.stringify([...actual, chave]).length > tecto && actual.length > 0) partes.push([chave])
    else actual.push(chave)
  }
  const saida: Record<string, string> = {
    [PREFERENCIAS_QUE_VIAJAM.silenciados]: JSON.stringify(partes[0]),
    [SILENCIADOS_MAIS]: `${partes.length - 1}:${marca}`,
  }
  partes.slice(1).forEach((parte, i) => {
    saida[parteDosSilenciados(i + 2)] = JSON.stringify({ v: marca, l: parte })
  })
  return saida
}

/** The list the account brings, read leniently. `undefined` means the account does not have it (or not all of it). */
export function silenciadosDaConta(preferencias: Readonly<Record<string, string>>): string[] | undefined {
  const cru = preferencias[PREFERENCIAS_QUE_VIAJAM.silenciados]
  if (cru === undefined) return undefined
  try {
    const primeira = lerSilenciados(JSON.parse(cru))
    const mais = /^(\d+):(\d+)$/.exec(preferencias[SILENCIADOS_MAIS] ?? "")
    if (!mais) return primeira
    const lista = [...primeira]
    for (let i = 2; i <= Number(mais[1]) + 1; i++) {
      const parte = preferencias[parteDosSilenciados(i)]
      if (parte === undefined) return undefined
      const lida = JSON.parse(parte) as { v?: unknown; l?: unknown }
      if (String(lida.v) !== mais[2]) return undefined
      lista.push(...lerSilenciados(lida.l))
    }
    return lerSilenciados(lista)
  } catch {
    return undefined
  }
}

/** Push the whole list, in parts. Only the parts that changed. */
function subirSilenciados(
  lista: readonly string[],
  naConta: Readonly<Record<string, string>>,
  definir: (chave: string, valor: string, at?: number) => void,
  at?: number,
): void {
  const semPartes = (valor: string | undefined): boolean => valor === undefined || valor.startsWith("0:")
  for (const [chave, valor] of Object.entries(silenciadosEmPartes(lista))) {
    if (naConta[chave] === valor) continue
    // A list that fits in one part does not write the counter, if the account
    // also has no parts: it is the old format, byte for byte.
    if (chave === SILENCIADOS_MAIS && semPartes(valor) && semPartes(naConta[chave])) continue
    if (at === undefined) definir(chave, valor)
    else definir(chave, valor, at)
  }
}

/** The mark of a preference pushed from the browser: loses to any choice made on the account. */
export const MARCA_DE_SEMENTE = 1

function linguaGuardadaAqui(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(CHAVE_DA_LINGUA) !== null
  } catch {
    return false
  }
}

/** What the account says, applied to this device. Only what changes anything. */
export function aplicarPreferenciasDaConta(preferencias: Readonly<Record<string, string>>): void {
  const lingua = preferencias[PREFERENCIAS_QUE_VIAJAM.lingua]
  if (ePreferencia(lingua) && lingua !== lerPreferencia()) aplicarEscolhaDeLingua(lingua)

  const actuais = readPrefs()
  const cru = preferencias[PREFERENCIAS_QUE_VIAJAM.cor]
  const cor = cru !== undefined && /^\d+$/.test(cru) ? Number(cru) : undefined
  const densidadeCrua = preferencias[PREFERENCIAS_QUE_VIAJAM.densidade]
  const densidade: Density | undefined = densidadeCrua === "compacta" || densidadeCrua === "confortavel" ? densidadeCrua : undefined
  const silenciados = silenciadosDaConta(preferencias)
  const novas: Prefs = {
    ...actuais,
    ...(cor !== undefined && cor < ACCENTS.length ? { accent: cor } : {}),
    ...(densidade !== undefined ? { density: densidade } : {}),
    ...(silenciados !== undefined ? { silenciados } : {}),
  }
  if (
    novas.accent !== actuais.accent ||
    novas.density !== actuais.density ||
    JSON.stringify(novas.silenciados) !== JSON.stringify(actuais.silenciados)
  ) {
    writePrefs(novas)
    applyPrefs(novas)
  }
}

/**
 * Link preferences to the account: apply what it has, push what only this
 * device chose, and from then on carry each gesture and bring each change.
 *
 * Receives state by parameter (`estadoDaConta.ts`), so this module does not
 * import it back. Returns the function that disconnects.
 */
export function ligarPreferenciasDaConta(
  ler: () => { readonly preferencias: Readonly<Record<string, string>> },
  aoMudar: (ouvinte: () => void) => () => void,
  definir: (chave: string, valor: string, at?: number) => void,
  { semear = true }: { semear?: boolean } = {},
): () => void {
  const naConta = ler().preferencias
  aplicarPreferenciasDaConta(naConta)

  /*
    Chosen here before the account knows: push it. Only real choices, not
    factory values, so a new device does not erase a sibling's choice with
    something no one ever chose.

    Pushes as a SEED, with the lowest mark (`MARCA_DE_SEMENTE`): a choice the
    account already has on a sibling, and has not reached here yet, wins. With
    the "now" mark, the last device to update would force theirs on everyone.
    And without the first read (`semear: false`) nothing pushes: we do not know
    what the account has.
  */
  if (semear) {
    if (naConta[PREFERENCIAS_QUE_VIAJAM.lingua] === undefined && linguaGuardadaAqui()) {
      definir(PREFERENCIAS_QUE_VIAJAM.lingua, lerPreferencia(), MARCA_DE_SEMENTE)
    }
    const locais = readPrefs()
    if (naConta[PREFERENCIAS_QUE_VIAJAM.cor] === undefined && locais.accent !== DEFAULT_PREFS.accent) {
      definir(PREFERENCIAS_QUE_VIAJAM.cor, String(locais.accent), MARCA_DE_SEMENTE)
    }
    if (naConta[PREFERENCIAS_QUE_VIAJAM.densidade] === undefined && locais.density !== DEFAULT_PREFS.density) {
      definir(PREFERENCIAS_QUE_VIAJAM.densidade, locais.density, MARCA_DE_SEMENTE)
    }
    if (naConta[PREFERENCIAS_QUE_VIAJAM.silenciados] === undefined && locais.silenciados.length > 0) {
      subirSilenciados(locais.silenciados, naConta, definir, MARCA_DE_SEMENTE)
    }
  }

  let vistas = ler().preferencias
  const largarConta = aoMudar(() => {
    const agora = ler().preferencias
    if (agora === vistas) return
    vistas = agora
    aplicarPreferenciasDaConta(agora)
  })
  const largarLingua = aoEscolherLingua((preferencia) => definir(PREFERENCIAS_QUE_VIAJAM.lingua, preferencia))
  /*
    Muting is a gesture written in this device's preferences (`usePrefs`), and
    pushes from there. We hear the same event as the drawer, and push only what
    differs from what the account already has: what the account just brought
    also comes through this event, and cannot go back there as a new choice.
  */
  const aoMudarPrefs = (): void => {
    const locais = readPrefs().silenciados
    const naConta = ler().preferencias
    const daConta = silenciadosDaConta(naConta) ?? []
    if (JSON.stringify(locais) === JSON.stringify(daConta)) return
    subirSilenciados(locais, naConta, definir)
  }
  if (typeof window !== "undefined") window.addEventListener(PREFS_EVENT, aoMudarPrefs)
  /*
    Color and density no longer have a gesture to carry them: they left
    settings in 0.9 (see `applyPrefs`). What an old vault has of them still
    reads without error, above, and the format of the keys does not change.
  */
  return () => {
    largarConta()
    largarLingua()
    if (typeof window !== "undefined") window.removeEventListener(PREFS_EVENT, aoMudarPrefs)
  }
}
