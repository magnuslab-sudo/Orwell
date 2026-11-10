import { useEffect, useRef, useState } from "react"
import { Button } from "./Button.js"
import { strings } from "../strings.js"

/**
 * The QR reader: the back camera, and a decoder.
 *
 * Two decoders, in order: the browser's `BarcodeDetector` when it exists (Chrome and
 * Android), and the vendored `jsQR` when it doesn't. **Safari on iPhone does NOT have
 * `BarcodeDetector`**, and iPhone is the device this exists for: the `jsQR` path is the
 * primary one, not a fallback. `jsQR` loads via `import()` only when needed, because
 * 250 KB is something the desktop, which shows the QR and does not read it, never needs
 * to download.
 *
 * What this does NOT do: authenticate anything. The QR saves transcribing an eighty-character
 * link, that is all. The six words on the next screen decide if the pairing is honest. That
 * is why the paste link button is always beside it: no camera, no permission, or no light,
 * the pasted link gets to the same place.
 */

/** The browser's `BarcodeDetector`, optional and untyped in `lib.dom`. */
interface DetectorDeCodigos {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
interface DetectorDeCodigosConstrutor {
  new (options?: { formats?: string[] }): DetectorDeCodigos
}

function detectorNativo(): DetectorDeCodigos | null {
  const ctor = (globalThis as { BarcodeDetector?: DetectorDeCodigosConstrutor }).BarcodeDetector
  if (!ctor) return null
  try {
    return new ctor({ formats: ["qr_code"] })
  } catch {
    return null
  }
}

/** How many times per second we try to read. Ten is enough: they are pointing, not moving. */
const LEITURAS_POR_SEGUNDO = 10

type Estado = "a-pedir" | "a-ler" | "negada" | "sem-camara"

export function LeitorQr({
  onLido,
  onCancelar,
  aLer,
}: {
  onLido: (texto: string) => void
  onCancelar: () => void
  /** What the line says while the camera searches. By default, the pairing one. */
  aLer?: string | undefined
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement | null>(null)
  const [estado, setEstado] = useState<Estado>("a-pedir")

  useEffect(() => {
    let vivo = true
    let stream: MediaStream | null = null
    let temporizador: ReturnType<typeof setTimeout> | null = null
    const tela = document.createElement("canvas")

    const parar = (): void => {
      vivo = false
      if (temporizador !== null) clearTimeout(temporizador)
      for (const faixa of stream?.getTracks() ?? []) faixa.stop()
      stream = null
    }

    const lerComJsQr = async (): Promise<((imagem: ImageData) => string | null) | null> => {
      try {
        const modulo = await import("../vendor/jsQR.js")
        return (imagem) => modulo.default(imagem.data, imagem.width, imagem.height, { inversionAttempts: "dontInvert" })?.data ?? null
      } catch {
        return null
      }
    }

    const arrancar = async (): Promise<void> => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setEstado("sem-camara")
        return
      }
      try {
        // The back camera, which is the one you point at a screen. No `exact`: a laptop
        // with one camera also reads it, facing another screen.
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      } catch (erro) {
        setEstado((erro as { name?: string }).name === "NotAllowedError" ? "negada" : "sem-camara")
        return
      }
      if (!vivo) {
        parar()
        return
      }
      const elemento = video.current
      // No element means nowhere to display, but the camera is already open: leaving without
      // closing it left the light on and the stream live until the page died.
      if (!elemento) {
        parar()
        return
      }
      elemento.srcObject = stream
      // `autoplay` alone is not enough when the source arrives after mount: see
      // the same pattern in `VideoTile.tsx`.
      await elemento.play().catch(() => {})
      setEstado("a-ler")

      let nativo = detectorNativo()
      let proprio = nativo ? null : await lerComJsQr()
      if (!vivo) return
      if (!nativo && !proprio) {
        setEstado("sem-camara")
        return
      }
      /**
       * How many frames the native one saw without reading anything. After three seconds
       * we bring in jsQR: a `BarcodeDetector` that exists and always returns empty
       * (Chromium without the system engine underneath) is indistinguishable from a
       * poorly aimed camera except by time.
       */
      let frustracoesDoNativo = 0

      const ler = async (): Promise<void> => {
        if (!vivo) return
        const largura = elemento.videoWidth
        const altura = elemento.videoHeight
        if (largura > 0 && altura > 0) {
          let texto: string | null = null
          if (nativo) {
            try {
              texto = (await nativo.detect(elemento))[0]?.rawValue ?? null
              if (texto === null && ++frustracoesDoNativo > 3 * LEITURAS_POR_SEGUNDO && !proprio) proprio = await lerComJsQr()
            } catch {
              // A `BarcodeDetector` that exists but does not work (a browser without the engine
              // underneath, a context with no GPU): switch to jsQR for good instead of trying
              // the same frame that will not read until the person gives up.
              nativo = null
              proprio = await lerComJsQr()
            }
          }
          if (texto === null && proprio) {
            try {
              tela.width = largura
              tela.height = altura
              const contexto = tela.getContext("2d", { willReadFrequently: true })
              if (contexto) {
                contexto.drawImage(elemento, 0, 0, largura, altura)
                texto = proprio(contexto.getImageData(0, 0, largura, altura))
              }
            } catch {
              // A frame that does not read is just the next frame.
            }
          }
          if (texto && vivo) {
            parar()
            onLido(texto)
            return
          }
        }
        temporizador = setTimeout(() => void ler(), 1000 / LEITURAS_POR_SEGUNDO)
      }
      void ler()
    }

    void arrancar()
    return parar
    // `onLido` is stable for the caller; restarting the camera on every render would ask for permission in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="leitor-qr">
      {(estado === "a-pedir" || estado === "a-ler") && (
        <>
          <video ref={video} autoPlay playsInline muted className="leitor-qr-video" />
          <p className="field-note" role="status">
            {aLer ?? strings.pairing.scanning}
          </p>
        </>
      )}
      {estado === "negada" && (
        <p className="gate-warning" role="alert">
          {strings.pairing.cameraDenied}
        </p>
      )}
      {estado === "sem-camara" && (
        <p className="gate-warning" role="alert">
          {strings.pairing.cameraUnavailable}
        </p>
      )}
      <Button variant="ghost" type="button" onClick={onCancelar}>
        {strings.pairing.stopScan}
      </Button>
    </div>
  )
}
