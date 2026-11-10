import { useRef, useState } from "react"
import type { MediaItem } from "../types.js"
import { strings } from "../strings.js"
import { ImagemAPedido } from "./AnexoAPedido.js"
import { eVideo, VideoDaPublicacao } from "./VideoDaPublicacao.js"

/**
 * The arrow that moves to the next photo.
 *
 * Drawn here, not in `icons.tsx`, for the same reason as the thumbs in
 * `PostEngagement`: that file is being reworked, and an icon added
 * now would collide with that change midway. Same 24 grid, same stroke width, same
 * `currentColor`-when both changes cross, it moves in one line.
 */
function ChevronIcon({ size = 20, tras }: { size?: number; tras?: boolean }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={tras ? { transform: "rotate(180deg)" } : undefined}
    >
      <path d="m9.5 5.5 7 6.5-7 6.5" />
    </svg>
  )
}

/** How far a finger must travel to count as a photo change. */
const ARRASTO_MINIMO = 44

/**
 * The photos in a post, one at a time and large.
 *
 * It is not the `PostImages` grid, and the difference is not a matter of taste. The grid exists
 * for a feed, where a post is a line among many and the photo is
 * a poster: cropped square (`object-fit: cover`), two side by side,
 * and whoever wants to see more opens it. In an OPEN post the photo is no longer
 * a poster for anything-it is the thing itself. Cropping it there would hide
 * half of what the person came to see, and putting them side by side would give each
 * half the stage.
 *
 * So: one at a time, whole (`contain`), and a way to move to the next. Three, because
 * three kinds of people move through photos in different ways-arrows for mouse users,
 * dots for those who want to jump to the fourth, drag for a finger. And keyboard,
 * which is not a fourth way but the arrow way by another door.
 *
 * **A photo still opens on top of everything.** The `onOpen` is the same
 * as in `PostImages` and leads to the same `Lightbox`: here it is large, there it fills
 * the screen. An image pulled from the vault does not become a button-no bytes
 * to enlarge, and a button that opened empty was worse than nothing.
 */
export function Carrossel({
  media,
  onOpen,
}: {
  media: MediaItem[]
  /** When given, the live photo is a button that opens it full-screen. */
  onOpen?: ((item: MediaItem) => void) | undefined
}): React.JSX.Element | null {
  const [escolhida, setEscolhida] = useState(0)
  /**
   * Where the finger landed, and whether it moved.
   *
   * The `arrastou` exists because of the click that follows a drag: the
   * browser fires it anyway, and without this flag a photo change
   * always ended with the zoom sheet open on top of it.
   */
  const pousou = useRef<number | null>(null)
  const arrastou = useRef(false)

  if (media.length === 0) return null

  const total = media.length
  // Clamped within read bounds, not by an effect: a post with
  // fewer photos than the last one cannot point to one that does not exist.
  const indice = Math.min(escolhida, total - 1)
  const item = media[indice] as MediaItem
  const varias = total > 1

  const mover = (passo: number): void => {
    // It wraps around: from the last to the first. A carousel that stops at the end
    // forces you to scroll all the way back to see the one that mattered again.
    setEscolhida((atual) => (Math.min(atual, total - 1) + passo + total) % total)
  }

  /**
   * `draggable={false}` is not decoration: without it the carousel does not move photos.
   *
   * An `<img>` is draggable by default, and the browser claims the gesture
   * as soon as the pointer moves-it starts a file drag, and the `pointerup` that
   * would close the move never arrives. The finger passed the image, the image did not pass.
   * Measured in Chromium: the profile script reports it.
   */
  const fotografia = <img src={item.inline ?? item.url} alt={item.name ?? ""} draggable={false} />

  return (
    <div
      className="carrossel"
      onKeyDown={(event) => {
        if (!varias) return
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        // Only the arrows, and only in here: Escape is the dialog's and so is Tab.
        event.preventDefault()
        mover(event.key === "ArrowRight" ? 1 : -1)
      }}
    >
      <div
        className="carrossel-palco"
        onPointerDown={(event) => {
          // A finger on video controls is moving through time, not moving photos.
          if (event.target instanceof Element && event.target.closest("video")) {
            pousou.current = null
            return
          }
          pousou.current = event.clientX
          arrastou.current = false
        }}
        onPointerUp={(event) => {
          const inicio = pousou.current
          pousou.current = null
          if (inicio === null || !varias) return
          const andou = event.clientX - inicio
          if (Math.abs(andou) < ARRASTO_MINIMO) return
          arrastou.current = true
          mover(andou < 0 ? 1 : -1)
        }}
      >
        {/* A video on stage: no zoom and no drag over the controls. The
            key changes with the position, so the video reader does not stay on the
            next one when moving from one to another. */}
        {eVideo(item) ? (
          <VideoDaPublicacao key={indice} item={item} />
        ) : item.evicted ? (
          <ImagemAPedido item={item} onOpen={onOpen} />
        ) : onOpen ? (
          <button
            type="button"
            className="image-open"
            title={strings.social.viewImage}
            onClick={(event) => {
              /*
                A drag that just changed photos is not a click.
                
                The `detail` is what tells them apart, and it is not overkill. On a
                touch screen, a finger that travels far enough to change photos does NOT
                fire a click-the flag stayed raised, and
                the next activation was swallowed. If that activation was an Enter
                on the keyboard, a mouse-free user clicked once for no reason. A pointer click
                brings a click count; an Enter brings zero, and that never came from a drag.
                */
              if (event.detail !== 0 && arrastou.current) {
                arrastou.current = false
                return
              }
              onOpen(item)
            }}
          >
            {fotografia}
          </button>
        ) : (
          fotografia
        )}

        {varias && (
          <>
            <button
              type="button"
              className="carrossel-passo anterior"
              title={strings.social.imagePrev}
              aria-label={strings.social.imagePrev}
              onClick={() => mover(-1)}
            >
              <ChevronIcon tras />
            </button>
            <button
              type="button"
              className="carrossel-passo seguinte"
              title={strings.social.imageNext}
              aria-label={strings.social.imageNext}
              onClick={() => mover(1)}
            >
              <ChevronIcon />
            </button>
            {/* The corner count, for those who see. The same count reaches those who
                listen via the live line below, spelled out in full. */}
            <span className="carrossel-conta" aria-hidden="true">
              {indice + 1}/{total}
            </span>
          </>
        )}
      </div>

      {varias && (
        <ol className="carrossel-pontos">
          {media.map((_, onde) => (
            <li key={onde}>
              <button
                type="button"
                className={onde === indice ? "ponto agora" : "ponto"}
                aria-current={onde === indice}
                title={strings.social.imageGo(onde + 1)}
                aria-label={strings.social.imageGo(onde + 1)}
                onClick={() => setEscolhida(onde)}
              />
            </li>
          ))}
        </ol>
      )}

      {/* Which photo is front and center, announced. Without this, a screen reader
          user presses the arrow and gets nothing: the image that changed does not announce itself. */}
      {varias && (
        <span className="sr-only" aria-live="polite">
          {strings.social.imageAt(indice + 1, total)}
        </span>
      )}
    </div>
  )
}
