import { useMemo } from "react"
import { codificarQr, desenhoDoQr } from "../lib/qr.js"

/**
 * A QR code drawn from text, for the pairing link.
 *
 * An `<svg>` with a single `path` (see `desenhoDoQr`), square, filling the
 * width given to it. White background and black modules ALWAYS, whatever the
 * theme: a camera reads contrast, not the app palette, and a QR in gray on
 * dark gray is a QR that cannot be read.
 */
export function QrCode({ texto, alt, size }: { texto: string; alt: string; size?: number }): React.JSX.Element {
  const desenho = useMemo(() => desenhoDoQr(codificarQr(texto)), [texto])
  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${desenho.lado} ${desenho.lado}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={alt}
      {...(size !== undefined ? { width: size, height: size } : {})}
    >
      <rect width={desenho.lado} height={desenho.lado} fill="#fff" />
      <path d={desenho.d} fill="#000" />
    </svg>
  )
}
