import { useCallback, useEffect, useState } from "react"
import { TIPOS_DE_SOM, type TipoDeSom } from "./familia.js"

/**
 * Sound choices by type, for this device.
 *
 * They stay on the device and do not travel with the account, like the master
 * toggle and volume (`sounds` and `soundVolume` in `usePrefs`). The phone in
 * a pocket and the laptop on a desk need different things, and it's the same
 * person requesting them.
 *
 * A separate key, alongside `enclave.prefs` and not inside it: general
 * preferences have their own migration history (`chosen`), and these choices
 * have no past.
 */

export const CHAVE_DOS_SONS = "enclave.sons"
/** Fired in this tab on each choice, for whoever draws them to update. */
export const EVENTO_DOS_SONS = "enclave:sons"

export interface PreferenciasDeSom {
  /** One toggle per type. */
  porTipo: Record<TipoDeSom, boolean>
  /** Vibrate along with the sound, where the device can vibrate. */
  vibrar: boolean
  /** The incoming call ring overrides Busy and Invisible. */
  chamadaComOcupado: boolean
}

/**
 * Defaults to all on except a friend's post notification.
 *
 * An active feed is volume: posts arrive on their own, with no one waiting for
 * a reply. Same reason they don't count in the Social badge (see `lib/porAtender.ts`).
 */
export const PREFERENCIAS_DE_SOM_POR_OMISSAO: PreferenciasDeSom = {
  porTipo: {
    directa: true,
    mencao: true,
    // A new type (3/11/2026), on. Those who already have saved choices get it on
    // too: reading applies defaults to each type the disk doesn't have. The common
    // room comes silent another way (`lib/salaComumCalada.ts`).
    canal: true,
    pedido: true,
    aceite: true,
    chamada: true,
    entrou: true,
    saiu: true,
    ligado: true,
    cotovelada: true,
    ticket: true,
    publicacao: false,
    // On: notifies once per version, and that's what says the app fell behind.
    actualizacao: true,
    "mic-silenciado": true,
    "mic-ligado": true,
    "tudo-silenciado": true,
    "tudo-ligado": true,
    "amigo-online": true,
    "sala-afk": true,
    // A new type: those who already have saved choices get it on, because reading
    // applies defaults to each type the disk doesn't have.
    enviada: true,
    // The Discord parity ones (3/11/2026), all on, for the same reason.
    "a-chamar": true,
    "voz-perdida": true,
    movido: true,
    "transmissao-iniciada": true,
    "transmissao-terminada": true,
    "espectador-entrou": true,
    "espectador-saiu": true,
  },
  vibrar: true,
  chamadaComOcupado: true,
}

/** Lenient reading: anything that is not exactly a boolean gets the default. */
export function lerPreferenciasDeSom(armazem: Pick<Storage, "getItem"> | null = armazemDoBrowser()): PreferenciasDeSom {
  const omissao = PREFERENCIAS_DE_SOM_POR_OMISSAO
  try {
    const cru = armazem?.getItem(CHAVE_DOS_SONS)
    if (!cru) return omissao
    const lido = JSON.parse(cru) as Partial<{ porTipo: Record<string, unknown>; vibrar: unknown; chamadaComOcupado: unknown }>
    const porTipo = { ...omissao.porTipo }
    for (const tipo of TIPOS_DE_SOM) {
      const valor = lido?.porTipo?.[tipo]
      if (typeof valor === "boolean") porTipo[tipo] = valor
    }
    return {
      porTipo,
      vibrar: typeof lido?.vibrar === "boolean" ? lido.vibrar : omissao.vibrar,
      chamadaComOcupado:
        typeof lido?.chamadaComOcupado === "boolean" ? lido.chamadaComOcupado : omissao.chamadaComOcupado,
    }
  } catch {
    return omissao
  }
}

export function gravarPreferenciasDeSom(
  preferencias: PreferenciasDeSom,
  armazem: Pick<Storage, "setItem"> | null = armazemDoBrowser(),
): void {
  try {
    armazem?.setItem(CHAVE_DOS_SONS, JSON.stringify(preferencias))
  } catch {
    // Disk full or locked. The choice stands until close.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_DOS_SONS))
}

function armazemDoBrowser(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

/** Options shown and changed on a screen. */
export function usePreferenciasDeSom(): {
  preferencias: PreferenciasDeSom
  mudar: (patch: Partial<Omit<PreferenciasDeSom, "porTipo">> & { tipo?: [TipoDeSom, boolean] }) => void
} {
  const [preferencias, setPreferencias] = useState(() => lerPreferenciasDeSom())

  useEffect(() => {
    if (typeof window === "undefined") return
    const reler = (): void => setPreferencias(lerPreferenciasDeSom())
    window.addEventListener(EVENTO_DOS_SONS, reler)
    return () => window.removeEventListener(EVENTO_DOS_SONS, reler)
  }, [])

  const mudar = useCallback(
    (patch: Partial<Omit<PreferenciasDeSom, "porTipo">> & { tipo?: [TipoDeSom, boolean] }) => {
      // What is on disk, not the snapshot of this screen.
      const antes = lerPreferenciasDeSom()
      const { tipo, ...resto } = patch
      const depois: PreferenciasDeSom = {
        ...antes,
        ...resto,
        porTipo: tipo ? { ...antes.porTipo, [tipo[0]]: tipo[1] } : antes.porTipo,
      }
      gravarPreferenciasDeSom(depois)
      setPreferencias(depois)
    },
    [],
  )

  return { preferencias, mudar }
}
