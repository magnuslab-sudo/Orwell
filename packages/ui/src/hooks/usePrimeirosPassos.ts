import { useCallback, useEffect, useState } from "react"

/**
 * The account that just came to life on this device and has not reached anyone yet.
 *
 * Stores a fingerprint of the ADDRESS, not a yes/no: someone who creates an
 * account, deletes it, and creates another on the same browser deserves the card
 * again. Someone who unlocks an old account or imports one never sees it, because
 * the fingerprint does not match.
 *
 * Fingerprint not the address in the clear: `localStorage` is not encrypted, sits
 * outside the vault, and an address is a person's identifier. Sixteen characters
 * of SHA-256 suffice to tell the accounts in a browser apart.
 */
export const PRIMEIROS_PASSOS_KEY = "enclave.primeirosPassos"

export async function impressaoDoEndereco(address: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16)
}

/** Called by the gate when creating the account. Tolerant like other writes. */
export async function marcarPrimeirosPassos(
  address: string,
  storage: Pick<Storage, "setItem"> = localStorage,
): Promise<void> {
  // Never throws: `crypto.subtle` only exists in secure context (https or
  // localhost), and without it the card does not show, not the account.
  try {
    storage.setItem(PRIMEIROS_PASSOS_KEY, await impressaoDoEndereco(address))
  } catch {
    // Storage locked or no `crypto.subtle`: card does not show, nothing else is lost.
  }
}

function lerMarca(): string | null {
  try {
    return localStorage.getItem(PRIMEIROS_PASSOS_KEY)
  } catch {
    return null
  }
}

function apagarMarca(): void {
  try {
    localStorage.removeItem(PRIMEIROS_PASSOS_KEY)
  } catch {
    // Applies to this session only: the state already says it is done.
  }
}

/**
 * Whether the first steps card shows, and how it closes.
 *
 * `temAlguem` is the first friend or first channel, decided by the shell. With
 * it the card vanishes right away. `podeEsquecer` says if that judgment can be
 * trusted yet (the common room was announced by the server): only then is the
 * mark erased for real. Without this guard, the common room counted as "first
 * channel" the instant before the server said which it was, and the card died
 * before anyone saw it.
 */
export function usePrimeirosPassos(
  address: string | null,
  temAlguem: boolean,
  podeEsquecer: boolean,
): { visivel: boolean; fechar: () => void } {
  const [marca, setMarca] = useState<string | null>(lerMarca)
  const [minhaImpressao, setMinhaImpressao] = useState<string | null>(null)

  // The mark is written by the gate, which runs before this hook has an address.
  useEffect(() => {
    if (!address) return
    let vivo = true
    void impressaoDoEndereco(address)
      .then((impressao) => {
        if (!vivo) return
        setMinhaImpressao(impressao)
        setMarca(lerMarca())
      })
      .catch(() => {
        // No `crypto.subtle` (outside secure context): no card, no loose rejection.
      })
    return () => {
      vivo = false
    }
  }, [address])

  const fechar = useCallback(() => {
    apagarMarca()
    setMarca(null)
  }, [])

  const minha = address !== null && minhaImpressao !== null && marca === minhaImpressao
  useEffect(() => {
    if (minha && temAlguem && podeEsquecer) fechar()
  }, [minha, temAlguem, podeEsquecer, fechar])

  return { visivel: minha && !temAlguem, fechar }
}
