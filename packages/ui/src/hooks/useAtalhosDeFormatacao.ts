import { useEffect, useRef } from "react"
import { envolver, marcadorDe } from "../lib/atalhosDeFormatacao.js"

/**
 * Formatting shortcuts inside a controlled text input.
 *
 * The key table and marker arithmetic live in `lib/atalhosDeFormatacao.ts`,
 * with no React in between. What is left here is the only part that needs the
 * document, and it is the part that takes work: **put the selection back where
 * it was after the text changes.**
 *
 * The problem, stated once: boxes in this product are controlled, the text
 * lives in the component above. Changing the text forces a redraw, and the
 * redraw puts the cursor at the end. Without restoring the selection, the
 * second Cmd+B would never find what the first one had marked, and a shortcut
 * that only works the first time is not a shortcut.
 *
 * So the restoration happens in an effect tied to the VALUE, not right after
 * the call: only after the new value has reached the box is there a place to
 * put the cursor. It is the same dance the emoji picker already did in
 * `Composer`.
 *
 * **The box comes from the event itself**, not passed in by reference from
 * outside. That is what lets this hook go into any field with a single line,
 * no plumbing: `onKeyDown={(e) => { if (aoTeclar(e)) return; … }}`. Where
 * other work is happening at the same time, the smallest possible touch is a
 * feature, not laziness.
 *
 * Returns `true` when it handled the key. Returns `false` for everything else,
 * including unmodified keys, inside a text input, the keyboard belongs to
 * whoever is typing, and the caller stays free to handle Enter, Escape and
 * arrows as always.
 */
export function useAtalhosDeFormatacao(
  valor: string,
  onChange: (texto: string) => void,
): (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => boolean {
  const porDevolver = useRef<{ campo: HTMLInputElement | HTMLTextAreaElement; inicio: number; fim: number } | null>(
    null,
  )

  useEffect(() => {
    const espera = porDevolver.current
    if (!espera) return
    porDevolver.current = null
    // A field that left the document in the meantime, channel switch mid-shortcut, gets no focus: that would steal it from whoever has it now.
    if (!espera.campo.isConnected) return
    espera.campo.focus()
    espera.campo.setSelectionRange(espera.inicio, espera.fim)
  }, [valor])

  return (event) => {
    const marcador = marcadorDe(event)
    if (marcador === null) return false

    const campo = event.currentTarget
    const principio = campo.selectionStart ?? valor.length
    const fim = campo.selectionEnd ?? principio
    // Only after there is an action: `preventDefault` on a combo we will not use
    // takes it from the browser for nothing in return. It is the rule that
    // `useAtalhos` already follows.
    event.preventDefault()

    const feito = envolver(valor, principio, fim, marcador)
    onChange(feito.texto)
    porDevolver.current = { campo, inicio: feito.inicio, fim: feito.fim }
    return true
  }
}
