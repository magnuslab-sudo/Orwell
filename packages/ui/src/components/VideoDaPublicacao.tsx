import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react"
import { videoAceite } from "@enclave/protocol"
import { BridgeContext } from "../App.js"
import { nomeSeguro } from "../lib/ficheiros.js"
import { formatarDuracao } from "../lib/videos.js"
import { strings } from "../strings.js"
import type { MediaItem } from "../types.js"
import { usePedirAnexo } from "./AnexoAPedido.js"

/**
 * If an attachment is a segmented video (the format as of 26/10/2026) that this
 * client can display. A video without `partes` is a file like any other: the row
 * with the name, which is what a 0.8.0 client also shows.
 */
export function eVideo(item: MediaItem): boolean {
  return Boolean(item.partes && typeof item.partes.sha256 === "string" && videoAceite(item.mediaType ?? ""))
}

/** The play triangle. Here, not in `icons.tsx` like the one in `Carousel`. */
function TocarIcon({ size = 28 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  )
}

/** The camera for recording, for the video attach button. Same grid and stroke as the home icons. */
export function VideoIcon({ size = 17 }: { size?: number }): React.JSX.Element {
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
    >
      <rect x="3" y="6" width="12.5" height="12" rx="2.5" />
      <path d="m15.5 10.5 5-3v9l-5-3" />
    </svg>
  )
}

type Fase =
  | { fase: "parado" }
  | { fase: "a-abrir" }
  | { fase: "a-tocar"; url: string }
  | { fase: "a-receber"; feitas: number; de: number }
  | { fase: "sem-bytes" }
  | { fase: "a-pedir" }
  | { fase: "falhou"; frase: string }

/**
 * The video of a post: the thumbnail with the play button, and the player when
 * the user taps.
 *
 * **No autoplay.** Nothing plays without a tap. The `<video>` element is created
 * only after a tap, with `preload="none"` and browser controls.
 *
 * **Only from a `blob:` URL** made from bytes the core has (memory or vault),
 * never from a network address. CSP already forbids it (`media-src 'self' blob:`),
 * and the Blob type is one of three allowed: bytes are never read as anything else.
 *
 * **Without the bytes**, the thumbnail stays and says why: the video is still
 * arriving (segment by segment), or no longer on this device, and then we offer
 * "Request from other members" (S5).
 */
/** While paused, the player drops the bytes and the thumbnail returns. */
const PAUSA_ATE_LARGAR_MS = 60_000

export function VideoDaPublicacao({ item }: { item: MediaItem }): React.JSX.Element {
  const bridge = useContext(BridgeContext)
  const { pode, estado: pedido, pedir, cancelar } = usePedirAnexo(item)
  const [estado, setEstado] = useState<Fase>({ fase: "parado" })
  const urlRef = useRef<string | null>(null)
  /**
   * The player is created on tap, outside React, and its first `play()` fires
   * in the same gesture: iOS only allows sound from an element a gesture touched,
   * and bytes arrive later (`bridge.video` is async). The same element receives
   * the `src` when bytes arrive, and enters the stage.
   */
  const leitorRef = useRef<HTMLVideoElement | null>(null)
  const palcoRef = useRef<HTMLDivElement | null>(null)
  const raizRef = useRef<HTMLDivElement | null>(null)
  const sha = item.partes?.sha256 ?? ""
  const nome = nomeSeguro(item.name)
  const duracao = formatarDuracao(item.duration ?? 0)
  // Only an image thumbnail: the vault is lenient, and this goes into a `src`.
  const poster = typeof item.poster === "string" && item.poster.startsWith("data:image/") ? item.poster : null

  /**
   * Drop the player and its `blob:` URL: video bytes (up to 25 MB) would stay
   * locked in memory until the page closed. The thumbnail returns.
   */
  const largar = useCallback((): void => {
    const leitor = leitorRef.current
    leitorRef.current = null
    if (leitor) {
      try {
        leitor.pause()
      } catch {
        // A player that was never tapped.
      }
      leitor.removeAttribute("src")
      leitor.remove()
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
  }, [])

  // The `blob:` URL dies with the component.
  useEffect(() => largar, [largar])

  /*
    It also dies when the video ends, when paused for over a minute, and when
    it leaves the screen. While paused, we give a minute of grace: the user may
    want to continue, and dropping it immediately would force reading the bytes again.
  */
  useEffect(() => {
    if (estado.fase !== "a-tocar") return
    const leitor = leitorRef.current
    const parar = (): void => {
      largar()
      setEstado({ fase: "parado" })
    }
    let pausa: ReturnType<typeof setTimeout> | null = null
    const aoPausar = (): void => {
      if (pausa) clearTimeout(pausa)
      pausa = setTimeout(parar, PAUSA_ATE_LARGAR_MS)
    }
    const aoTocar = (): void => {
      if (pausa) clearTimeout(pausa)
      pausa = null
    }
    leitor?.addEventListener("ended", parar)
    leitor?.addEventListener("pause", aoPausar)
    leitor?.addEventListener("play", aoTocar)
    let vigia: IntersectionObserver | null = null
    if (typeof IntersectionObserver !== "undefined" && raizRef.current) {
      vigia = new IntersectionObserver((entradas) => {
        if (entradas.some((entrada) => !entrada.isIntersecting)) parar()
      })
      vigia.observe(raizRef.current)
    }
    return () => {
      if (pausa) clearTimeout(pausa)
      leitor?.removeEventListener("ended", parar)
      leitor?.removeEventListener("pause", aoPausar)
      leitor?.removeEventListener("play", aoTocar)
      vigia?.disconnect()
    }
  }, [estado.fase, largar])

  // The progress of this video, segment by segment, as it arrives.
  useEffect(() => {
    if (!bridge?.on.video || !sha) return
    return bridge.on.video((evento) => {
      if (evento.sha !== sha) return
      if (evento.fase === "a-receber") {
        setEstado((atual) => (atual.fase === "a-tocar" ? atual : { fase: "a-receber", feitas: evento.feitas, de: evento.de }))
      } else if (evento.fase === "pronto") {
        setEstado((atual) => (atual.fase === "a-receber" || atual.fase === "a-pedir" ? { fase: "parado" } : atual))
      } else if (evento.fase === "falhou") {
        setEstado((atual) => (atual.fase === "a-tocar" ? atual : { fase: "falhou", frase: strings.social.videoFailed }))
      }
    })
  }, [bridge, sha])

  /** The player for this video, created if it does not exist yet. Standard attributes: controls, no autoplay. */
  const leitor = (): HTMLVideoElement => {
    if (leitorRef.current) return leitorRef.current
    const novo = document.createElement("video")
    novo.controls = true
    novo.playsInline = true
    novo.setAttribute("playsinline", "")
    novo.preload = "none"
    novo.setAttribute("aria-label", nome)
    if (poster) novo.poster = poster
    leitorRef.current = novo
    return novo
  }

  /** On gesture: the player is created and its first `play()` fires right away (no `src`, just to make iOS accept it later). */
  const tocarNoGesto = (): void => {
    void leitor()
      .play()
      .catch(() => {})
  }

  // Bytes arrived: the gesture player enters the stage, with the `blob:` URL, and plays.
  useLayoutEffect(() => {
    if (estado.fase !== "a-tocar" || !palcoRef.current) return
    const elemento = leitor()
    if (elemento.parentNode === palcoRef.current && elemento.getAttribute("src") === estado.url) return
    elemento.src = estado.url
    palcoRef.current.appendChild(elemento)
    void elemento.play().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `leitor` only reads refs and this video: the state is the trigger
  }, [estado])

  const abrir = async (): Promise<void> => {
    if (!bridge?.video || !sha || !item.mediaType || !videoAceite(item.mediaType)) {
      setEstado({ fase: "falhou", frase: strings.social.videoCannotPlay })
      return
    }
    setEstado({ fase: "a-abrir" })
    const situacao = await bridge.video.estado(sha).catch(() => ({ fase: "sem-bytes" as const }))
    if (situacao.fase === "a-receber" || situacao.fase === "a-enviar") {
      setEstado({ fase: "a-receber", feitas: situacao.feitas, de: situacao.de })
      return
    }
    const bytes = situacao.fase === "pronto" ? await bridge.video.bytes(sha).catch(() => null) : null
    if (!bytes) {
      setEstado({ fase: "sem-bytes" })
      return
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: item.mediaType }))
    urlRef.current = url
    setEstado({ fase: "a-tocar", url })
  }

  const pedirAosOutros = async (): Promise<void> => {
    setEstado({ fase: "a-pedir" })
    const chegou = await pedir()
    if (chegou) {
      await abrir()
      return
    }
    setEstado({ fase: "sem-bytes" })
  }

  if (estado.fase === "a-tocar") {
    // The `<video>` enters here via the `useLayoutEffect` above: it is the element from the gesture.
    return (
      <div
        className="video-da-publicacao a-tocar"
        ref={(no) => {
          palcoRef.current = no
          raizRef.current = no
        }}
      />
    )
  }

  const miniatura = poster ? <img src={poster} alt="" draggable={false} /> : <span className="video-sem-miniatura" aria-hidden="true" />

  // No bytes: the thumbnail stays, with options below.
  const aviso = ((): React.JSX.Element | null => {
    switch (estado.fase) {
      case "a-receber":
        return <span role="status">{strings.social.videoReceiving(estado.feitas, estado.de)}</span>
      case "sem-bytes":
        return (
          <>
            <span role="status">
              {pedido.fase === "falhou"
                ? pedido.motivo === "sem-ligacao"
                  ? strings.sincronia.anexoSemLigacao
                  : pedido.motivo === "recusado"
                    ? strings.sincronia.anexoRecusado
                    : strings.social.videoNobody
                : strings.social.videoNotHere}
            </span>
            {pode && (
              <button type="button" className="ghost" onClick={() => void pedirAosOutros()}>
                {strings.sincronia.anexoPedir}
              </button>
            )}
          </>
        )
      case "a-pedir":
        return (
          <>
            <span role="status">{strings.social.videoAsking}</span>
            {cancelar && (
              <button type="button" className="ghost" onClick={cancelar}>
                {strings.sincronia.anexoCancelar}
              </button>
            )}
          </>
        )
      case "falhou":
        return <span role="status">{estado.frase}</span>
      default:
        return null
    }
  })()

  return (
    <div className="video-da-publicacao">
      <button
        type="button"
        className="video-tocar"
        aria-label={strings.social.videoPlay(nome, duracao)}
        disabled={estado.fase === "a-abrir" || estado.fase === "a-pedir"}
        onClick={() => {
          tocarNoGesto()
          void abrir()
        }}
      >
        {miniatura}
        <span className="video-tocar-marca" aria-hidden="true">
          <TocarIcon />
        </span>
        <span className="video-duracao" aria-hidden="true">
          {duracao}
        </span>
      </button>
      {aviso && <div className="video-aviso">{aviso}</div>}
    </div>
  )
}
