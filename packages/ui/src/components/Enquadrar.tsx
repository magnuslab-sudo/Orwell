import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "./Button.js"
import { Modal } from "./Modal.js"
import { TextoDeErro } from "./TextoDeErro.js"
import {
  ampliar,
  arrastar,
  cortarImagem,
  enquadramentoInicial,
  gifQueFicaAnimado,
  limitar,
  PROPORCAO_DA_FORMA,
  recorteDe,
  zoomMaximo,
  type Enquadramento,
  type FormaDoEnquadramento,
  type Medidas,
} from "../lib/enquadrar.js"
import type { CompressedImage, ImageBudget } from "../lib/images.js"
import { strings, traduzirErro } from "../strings.js"

/**
 * Frame width when the engine cannot measure it (jsdom in tests returns zero
 * for everything). This is the circle width on desktop.
 */
const LARGURA_POR_OMISSAO = 272

/** One arrow step, in screen pixels. With Shift, five times more. */
const PASSO_DAS_SETAS = 8

/** One + or − tap: ten percent, like the slider moving slowly. */
const PASSO_DO_ZOOM = 1.1

/**
 * How much the mouse wheel zooms per pixel of `deltaY`. Exponential, so each
 * wheel click zooms the same proportion at zoom 1 and zoom 6.
 */
const ZOOM_POR_PIXEL_DA_RODA = 0.0015

/**
 * The crop sheet for an image before saving.
 *
 * Opens after choosing the file, on top of the sheet that chose it. You drag
 * and zoom (mouse, wheel, two fingers, the slider, or keyboard) inside a
 * circle, a rounded square, or a 16:10 rectangle. "Save" crops and compresses
 * within the limits of `lib/images.ts`; "Cancel", Escape, or a click outside
 * change nothing.
 *
 * In a portal, not inside the opener: the channel sheet is a `<form>`, and a
 * button from this sheet inside it would submit the entire channel. The `Modal`
 * stack still knows this one is on top, and only it hears Escape.
 *
 * All geometry lives in `lib/enquadrar.ts`: here we only translate gestures.
 */
export function Enquadrar({
  ficheiro,
  forma,
  budget,
  onGuardar,
  onCancelar,
  cortar = cortarImagem,
}: {
  ficheiro: Blob
  forma: FormaDoEnquadramento
  budget: ImageBudget
  onGuardar: (imagem: CompressedImage) => void
  onCancelar: () => void
  /** The crop. Injectable because jsdom does not draw anything. */
  cortar?: typeof cortarImagem
}): React.JSX.Element {
  const titulo = useId()
  const ajuda = useId()
  const proporcao = PROPORCAO_DA_FORMA[forma]
  /** A GIF within the animated limit stays centered: see `gifQueFicaAnimado`. */
  const fixo = gifQueFicaAnimado(ficheiro, budget)

  // A local address for the image, only one: created on open, dropped on close.
  const endereco = useMemo(() => URL.createObjectURL(ficheiro), [ficheiro])
  useEffect(() => () => URL.revokeObjectURL(endereco), [endereco])

  const [medidas, setMedidas] = useState<Medidas | null>(null)
  const [estado, setEstado] = useState<Enquadramento>({ zoom: 1, cx: 0, cy: 0 })
  const [aGuardar, setAGuardar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const palco = useRef<HTMLDivElement | null>(null)
  const moldura = useRef<HTMLDivElement | null>(null)
  const [largura, setLargura] = useState(LARGURA_POR_OMISSAO)

  // The frame tracks the sheet width (narrower on mobile), and the image scale
  // on screen depends on it. The crop does not: it is in image pixels, so
  // rotating the phone mid-crop does not change what comes out.
  useLayoutEffect(() => {
    const no = moldura.current
    if (!no) return
    const medir = (): void => {
      const agora = no.getBoundingClientRect().width
      if (agora > 0) setLargura(agora)
    }
    medir()
    if (typeof ResizeObserver !== "function") return
    const observador = new ResizeObserver(medir)
    observador.observe(no)
    return () => observador.disconnect()
  }, [])

  /** Change the crop, always through one of the calculations in `lib/enquadrar.ts`. */
  const mudar = (conta: (actual: Enquadramento, m: Medidas) => Enquadramento): void => {
    if (!medidas || fixo || aGuardar) return
    setEstado((actual) => conta(actual, medidas))
  }

  /** Where a screen point sits inside the frame, from 0 to 1. */
  const focoEm = (clientX: number, clientY: number): { fx: number; fy: number } => {
    const caixa = moldura.current?.getBoundingClientRect()
    if (!caixa || caixa.width === 0 || caixa.height === 0) return { fx: 0.5, fy: 0.5 }
    const prender = (valor: number): number => Math.min(1, Math.max(0, valor))
    return { fx: prender((clientX - caixa.left) / caixa.width), fy: prender((clientY - caixa.top) / caixa.height) }
  }

  /*
    The mouse wheel, through a native listener not React's `onWheel`.

    React registers wheel as passive, and a passive listener cannot call
    `preventDefault`: the sheet would scroll underneath while the image zoomed.
    The listener is rebuilt when what it reads changes, and there is only one at a time.
  */
  const rodaRef = useRef<(evento: WheelEvent) => void>(() => {})
  rodaRef.current = (evento: WheelEvent): void => {
    if (!medidas || fixo || aGuardar) return
    evento.preventDefault()
    // Lines and pages become pixels: a classic scroll wheel sends lines.
    const escala = evento.deltaMode === 1 ? 16 : evento.deltaMode === 2 ? 400 : 1
    const factor = Math.exp(-evento.deltaY * escala * ZOOM_POR_PIXEL_DA_RODA)
    const foco = focoEm(evento.clientX, evento.clientY)
    mudar((actual, m) => ampliar(actual, actual.zoom * factor, foco, m, proporcao))
  }
  useEffect(() => {
    const no = palco.current
    if (!no) return
    const ouvir = (evento: WheelEvent): void => rodaRef.current(evento)
    no.addEventListener("wheel", ouvir, { passive: false })
    return () => no.removeEventListener("wheel", ouvir)
  }, [])

  /*
    Fingers and mouse, through Pointer Events.

    One pointer drags. Two pointers (pinch gesture) zoom by finger distance,
    keeping the point between them still, and drag by that point's path.
    The math is incremental, movement by movement: this way switching from one
    finger to two mid-gesture does not jump.
  */
  const ponteiros = useRef(new Map<number, { x: number; y: number }>())

  const meioEDistancia = (): { x: number; y: number; d: number } | null => {
    const [a, b] = [...ponteiros.current.values()]
    if (!a || !b) return null
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }
  }

  const aoPousar = (evento: React.PointerEvent<HTMLDivElement>): void => {
    if (!medidas || fixo || aGuardar) return
    if (evento.pointerType === "mouse" && evento.button !== 0) return
    evento.currentTarget.setPointerCapture?.(evento.pointerId)
    ponteiros.current.set(evento.pointerId, { x: evento.clientX, y: evento.clientY })
  }

  const aoMover = (evento: React.PointerEvent<HTMLDivElement>): void => {
    const antes = ponteiros.current.get(evento.pointerId)
    if (!antes) return
    const pinçaAntes = meioEDistancia()
    ponteiros.current.set(evento.pointerId, { x: evento.clientX, y: evento.clientY })
    const pinçaDepois = meioEDistancia()
    if (pinçaAntes && pinçaDepois && pinçaAntes.d > 0) {
      const foco = focoEm(pinçaDepois.x, pinçaDepois.y)
      const factor = pinçaDepois.d / pinçaAntes.d
      const dx = pinçaDepois.x - pinçaAntes.x
      const dy = pinçaDepois.y - pinçaAntes.y
      mudar((actual, m) =>
        arrastar(ampliar(actual, actual.zoom * factor, foco, m, proporcao), dx, dy, largura, m, proporcao),
      )
      return
    }
    const dx = evento.clientX - antes.x
    const dy = evento.clientY - antes.y
    mudar((actual, m) => arrastar(actual, dx, dy, largura, m, proporcao))
  }

  const aoLevantar = (evento: React.PointerEvent<HTMLDivElement>): void => {
    ponteiros.current.delete(evento.pointerId)
  }

  /** Keyboard in the frame: arrows move the image, plus and minus zoom. */
  const aoTeclar = (evento: React.KeyboardEvent<HTMLDivElement>): void => {
    const passo = evento.shiftKey ? PASSO_DAS_SETAS * 5 : PASSO_DAS_SETAS
    const meio = { fx: 0.5, fy: 0.5 }
    // Arrows move the IMAGE, like the mouse: right arrow moves it right.
    const movimentos: Record<string, [number, number]> = {
      ArrowLeft: [-passo, 0],
      ArrowRight: [passo, 0],
      ArrowUp: [0, -passo],
      ArrowDown: [0, passo],
    }
    const movimento = movimentos[evento.key]
    if (movimento) {
      evento.preventDefault()
      mudar((actual, m) => arrastar(actual, movimento[0], movimento[1], largura, m, proporcao))
      return
    }
    // "=" is "+" without Shift on English keyboards; "_" is "−" with Shift.
    if (evento.key === "+" || evento.key === "=") {
      evento.preventDefault()
      mudar((actual, m) => ampliar(actual, actual.zoom * PASSO_DO_ZOOM, meio, m, proporcao))
    } else if (evento.key === "-" || evento.key === "_") {
      evento.preventDefault()
      mudar((actual, m) => ampliar(actual, actual.zoom / PASSO_DO_ZOOM, meio, m, proporcao))
    }
  }

  const aoCarregar = (evento: React.SyntheticEvent<HTMLImageElement>): void => {
    const imagem = evento.currentTarget
    const lidas = { largura: imagem.naturalWidth, altura: imagem.naturalHeight }
    if (lidas.largura <= 0 || lidas.altura <= 0) {
      setErro(traduzirErro(new Error("this is not an image this device can read")))
      return
    }
    setMedidas(lidas)
    setEstado(limitar(enquadramentoInicial(lidas), lidas, proporcao))
  }

  const guardar = (): void => {
    if (!medidas || aGuardar) return
    setAGuardar(true)
    setErro(null)
    void cortar(ficheiro, recorteDe(estado, medidas, proporcao), forma, budget)
      .then(onGuardar)
      .catch((causa: Error) => {
        setErro(traduzirErro(causa))
        setAGuardar(false)
      })
  }

  /*
    The image on screen: the crop fills the frame, and the rest stays around it,
    darkened by the mask. Drawn at natural scale and shrunk by `transform`,
    which the compositor moves without redoing layout on each movement.
  */
  const recorte = medidas ? recorteDe(estado, medidas, proporcao) : null
  const escala = recorte ? largura / recorte.sw : 1
  const zoomMax = medidas ? zoomMaximo(medidas, proporcao) : 1

  return createPortal(
    <Modal className={`sheet narrow enquadrar enquadrar-${forma}`} labelledBy={titulo} describedBy={ajuda} onClose={onCancelar}>
      <header className="sheet-header">
        <h2 id={titulo}>{strings.enquadrar.titulo[forma]}</h2>
      </header>

      <div className="sheet-body">
        <div
          ref={palco}
          className={fixo ? "enquadrar-palco fixo" : "enquadrar-palco"}
          tabIndex={fixo ? -1 : 0}
          role="group"
          aria-label={strings.enquadrar.moldura}
          aria-describedby={ajuda}
          data-zoom={estado.zoom.toFixed(2)}
          onPointerDown={aoPousar}
          onPointerMove={aoMover}
          onPointerUp={aoLevantar}
          onPointerCancel={aoLevantar}
          onKeyDown={aoTeclar}
        >
          <div ref={moldura} className="enquadrar-moldura">
            <img
              src={endereco}
              alt=""
              draggable={false}
              onLoad={aoCarregar}
              onError={() => setErro(traduzirErro(new Error("this is not an image this device can read")))}
              style={
                recorte && medidas
                  ? {
                      width: medidas.largura,
                      height: medidas.altura,
                      transform: `translate(${-recorte.sx * escala}px, ${-recorte.sy * escala}px) scale(${escala})`,
                    }
                  : { visibility: "hidden" }
              }
            />
          </div>
        </div>

        <div className="enquadrar-zoom">
          <span aria-hidden="true">−</span>
          <input
            type="range"
            aria-label={strings.enquadrar.ampliar}
            min={1}
            max={zoomMax}
            step={0.01}
            value={estado.zoom}
            disabled={!medidas || fixo || aGuardar || zoomMax <= 1}
            onChange={(evento) => {
              const zoom = Number(evento.target.value)
              mudar((actual, m) => ampliar(actual, zoom, { fx: 0.5, fy: 0.5 }, m, proporcao))
            }}
          />
          <span aria-hidden="true">+</span>
        </div>

        <p className="hint" id={ajuda}>
          {fixo ? strings.enquadrar.gifFixo : `${strings.enquadrar.instrucoes} ${strings.enquadrar.teclado}`}
        </p>

        {erro && (
          <p className="error">
            <TextoDeErro texto={erro} />
          </p>
        )}
      </div>

      <footer className="sheet-actions">
        <Button variant="ghost" type="button" onClick={onCancelar}>
          {strings.common.cancel}
        </Button>
        <Button variant="primary" type="button" disabled={!medidas || aGuardar} onClick={guardar}>
          {aGuardar ? strings.enquadrar.aGuardar : strings.enquadrar.guardar}
        </Button>
      </footer>
    </Modal>,
    document.body,
  )
}
