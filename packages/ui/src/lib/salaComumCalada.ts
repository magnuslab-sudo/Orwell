import { readPrefs, writePrefs } from "../hooks/usePrefs.js"
import { definirPreferenciaDaConta, lerEstadoDaConta } from "./estadoDaConta.js"
import { alternarSilencio } from "./silenciados.js"

/**
 * The common channel comes muted out of the box, once (owner decision, November 3,
 * 2026).
 *
 * The common channel ("Orwell") has everyone on the server. With message sound in
 * channels (`somDoCanal`), a lively conversation there would play nonstop. So the
 * channel enters the muted list once, the same as "Mute" in the channel menu
 * (`lib/silenciados.ts`). The person turns it back on from the same menu, and
 * their choice stays.
 *
 * **Once, not every time you open.** Two flags say it was done:
 *  - on this device, `CHAVE_LOCAL` in `localStorage`;
 *  - on the account, `MARCA_NA_CONTA` in preferences that travel. A new device
 *    on the same account reads it and does not mute again what the person turned
 *    on elsewhere.
 * Both store the common channel address: a server that changes its common channel
 * mutes the new one once.
 *
 * **What the mute silences**, like any muted channel: sound, system notification,
 * and line count. Mention count stays. Mentions still play.
 */

export const CHAVE_LOCAL = "enclave.salaComumCalada"
export const MARCA_NA_CONTA = "interface.comum-silenciado"

export interface Dependencias {
  armazem?: Pick<Storage, "getItem" | "setItem"> | null
  lerConta?: () => { readonly preferencias: Readonly<Record<string, string>> }
  definirNaConta?: (chave: string, valor: string) => void
}

function armazemDoBrowser(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

/**
 * Mute the common channel, if not done yet. Return `true` when we muted it just
 * now.
 */
export function calarSalaComumUmaVez(salaComum: string | null, dependencias: Dependencias = {}): boolean {
  if (!salaComum) return false
  const armazem = dependencias.armazem === undefined ? armazemDoBrowser() : dependencias.armazem
  const lerConta = dependencias.lerConta ?? lerEstadoDaConta
  const definirNaConta = dependencias.definirNaConta ?? definirPreferenciaDaConta
  let local: string | null = null
  try {
    local = armazem?.getItem(CHAVE_LOCAL) ?? null
  } catch {
    local = null
  }
  const naConta = lerConta().preferencias[MARCA_NA_CONTA] === salaComum
  const marcar = (): void => {
    try {
      if (local !== salaComum) armazem?.setItem(CHAVE_LOCAL, salaComum)
    } catch {
      // Disk full or blocked: the account flag arrives.
    }
    // Without a linked account, `definirPreferenciaDaConta` does nothing: the flag
    // rises on the next connection, because this runs on every connection.
    if (!naConta) definirNaConta(MARCA_NA_CONTA, salaComum)
  }
  if (local === salaComum || naConta) {
    marcar()
    return false
  }
  const prefs = readPrefs()
  const calou = !prefs.silenciados.includes(salaComum)
  if (calou) writePrefs({ ...prefs, silenciados: alternarSilencio(prefs.silenciados, salaComum) })
  marcar()
  return calou
}
