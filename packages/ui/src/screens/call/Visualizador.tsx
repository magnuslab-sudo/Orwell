import { useEffect, useRef, useState } from "react"
import { lerBandas, useAnalisador } from "../../hooks/useAnalisador.js"

/**
 * The background of the card from whoever streams music: light that dances
 * with the sound.
 *
 * Request from the owner on October 27, 2026: "a modern Windows Media Player
 * style animation in the background of the user card that streams", then
 * "think Winamp and Windows Media Player. Nostalgia.". It's the "Alchemy" and
 * "Battery" family from Media Player, in midnight skin: four color blobs (cyan,
 * indigo, pink and green from the skin) that move in Lissajous curves and swell
 * with the bands (bass, mids, treble), two wave ribbons that twist with the
 * mids, and a trail: each frame paints the panel color on top at 22%, and what
 * was behind fades instead of disappearing. The blur comes from CSS.
 *
 * Cost, and why it's low: the canvas draws HALF the resolution of the card
 * (the blur hides it), and there's only `requestAnimationFrame` while the music
 * plays AND the card is in view (`IntersectionObserver`, and the tab visible).
 * FPS with four cards are measured in `scripts/medir-chamada-23h.mjs`.
 *
 * To the rhythm (owner, October 28, 2026: "I need movement and color to the
 * beat of the sound"): the blobs don't move at fixed speed, they move with the
 * energy of the sound, and each bass hit (`batida`: energy jumping above its
 * average) gives a push to the speed, swells the blobs and rotates the colors
 * (each hit makes each blob shift to the next color in the skin), with the core
 * lighting up almost white at the instant of the hit. Without sound, almost
 * nothing moves.
 *
 * With reduced motion the blobs still draw, slower and dimmer (`suave`): until
 * October 28, 2026 it was a fixed gradient, and on Windows with animations
 * disabled the owner saw the DJ card frozen ("the wmp style background on the
 * dj card isn't working"). What the music does to the card is the signal that
 * the music is there; the owner preferred the blobs to a bar equalizer, same day.
 */
export function Visualizador({ stream }: { stream: MediaStream | null }): React.JSX.Element {
  const caixa = useRef<HTMLSpanElement>(null)
  const tela = useRef<HTMLCanvasElement>(null)
  const [aVista, setAVista] = useState(true)
  const reduzido = useMovimentoReduzido()
  const analisador = useAnalisador(stream, aVista)

  // Out of view (off-screen, another tab, tab hidden), frozen.
  useEffect(() => {
    const elemento = caixa.current
    if (!elemento || typeof IntersectionObserver !== "function") return
    const observador = new IntersectionObserver((entradas) => {
      setAVista(entradas.some((entrada) => entrada.isIntersecting))
    })
    observador.observe(elemento)
    return () => observador.disconnect()
  }, [])

  useEffect(() => {
    const canvas = tela.current
    if (!canvas || !analisador) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const dados = new Uint8Array(analisador.frequencyBinCount)
    const estilo = getComputedStyle(canvas)
    const cor = (nome: string, recurso: string): string => estilo.getPropertyValue(nome).trim() || recurso
    const cores = [cor("--acento", "#8be9fd"), cor("--indigo", "#8b93e0"), cor("--rosa", "#e070a8"), cor("--presenca", "#50fa7b")]
    const tinta = cor("--painel-tinta", "rgba(12, 17, 35, 0.9)")
    // With reduced motion: half the speed of the curves and blobs that swell
    // less with the sound.
    const ritmo = reduzido ? 0.5 : 1
    const folego = reduzido ? 0.5 : 1

    let pedido = 0
    let largura = 0
    let altura = 0
    const medir = (): void => {
      // Half the resolution: the CSS blur hides the difference.
      largura = Math.max(1, Math.round(canvas.clientWidth / 2))
      altura = Math.max(1, Math.round(canvas.clientHeight / 2))
      canvas.width = largura
      canvas.height = altura
    }
    medir()
    const observador = typeof ResizeObserver === "function" ? new ResizeObserver(medir) : null
    observador?.observe(canvas)

    // The rhythm: the phase moves with the energy of the sound (not with the
    // clock), the slow average of the bass says what is "normal", and a hit is
    // what jumps above it. The hit decays on its own, frame by frame.
    let fase = 0
    let ultimo = 0
    let mediaDosGraves = 0
    let batida = 0
    let batidas = 0
    let gravesAntes = 0
    const quadro = (agora: number): void => {
      pedido = requestAnimationFrame(quadro)
      if (document.hidden) return
      const { graves, medios, agudos } = lerBandas(analisador, dados)
      const dt = ultimo ? Math.min(0.1, (agora - ultimo) / 1000) : 0
      ultimo = agora
      mediaDosGraves += (graves - mediaDosGraves) * 0.04
      const salto = graves - Math.max(mediaDosGraves * 1.25, gravesAntes + 0.06, 0.12)
      if (salto > 0 && batida < 0.35) {
        batida = 1
        batidas += 1
      } else {
        batida *= 0.88
      }
      gravesAntes = graves
      const energia = graves * 0.6 + medios * 0.3 + agudos * 0.1
      // Frozen without sound (0.15), to the beat with sound, and a push on each hit.
      fase += dt * ritmo * (0.15 + energia * 2.2 + batida * 2.5)
      const t = fase

      // The trail: the color on top, translucent, slowly erases the previous frame.
      ctx.globalCompositeOperation = "source-over"
      ctx.globalAlpha = 0.22
      ctx.fillStyle = tinta
      ctx.fillRect(0, 0, largura, altura)
      ctx.globalAlpha = 1

      // The blobs: add light where they cross, like in "Alchemy".
      ctx.globalCompositeOperation = "lighter"
      const base = Math.min(largura, altura)
      const bandas = [graves, medios, agudos, (graves + medios) / 2]
      for (let i = 0; i < 4; i++) {
        const forca = bandas[i] ?? 0
        const x = largura * (0.5 + 0.36 * Math.sin(t * (0.31 + i * 0.07) + i * 1.7))
        const y = altura * (0.5 + 0.32 * Math.cos(t * (0.23 + i * 0.05) + i * 2.3))
        // Swells with the band, and jumps on the hit.
        const raio = base * (0.22 + (forca * 0.55 + batida * 0.25) * folego)
        // The color rotates each hit: blob i gets color (i + hits).
        const corDaMancha = cores[(i + batidas) % 4] ?? "#fff"
        const gradiente = ctx.createRadialGradient(x, y, 0, x, y, raio)
        // The core lights up almost white at the instant of the hit.
        gradiente.addColorStop(0, batida > 0.5 ? "#ffffff" : corDaMancha)
        gradiente.addColorStop(batida > 0.5 ? 0.35 : 0, corDaMancha)
        gradiente.addColorStop(1, "transparent")
        // Clamped: with `lighter`, three full blobs summed to white and washed out the card.
        ctx.globalAlpha = Math.min(0.9, 0.22 + forca * 0.38 + batida * 0.3)
        ctx.fillStyle = gradiente
        ctx.fillRect(x - raio, y - raio, raio * 2, raio * 2)
      }

      // The ribbons: two waves that twist with the mids, like in "Battery".
      ctx.lineWidth = 1.5
      for (let fita = 0; fita < 2; fita++) {
        ctx.globalAlpha = 0.5 + agudos * 0.4
        ctx.strokeStyle = cores[((fita === 0 ? 0 : 2) + batidas) % 4] ?? "#fff"
        ctx.beginPath()
        const amplitude = altura * (0.08 + medios * 0.3 * folego)
        for (let x = 0; x <= largura; x += 4) {
          const fase = x / largura
          const y =
            altura / 2 +
            Math.sin(fase * (5 + fita * 2) + t * (1.2 + fita * 0.4)) * amplitude * Math.sin(fase * Math.PI) +
            (fita === 0 ? -1 : 1) * graves * altura * 0.08
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
    pedido = requestAnimationFrame(quadro)
    return () => {
      cancelAnimationFrame(pedido)
      observador?.disconnect()
    }
  }, [analisador, reduzido])

  return (
    <span ref={caixa} className={reduzido ? "visualizador suave" : "visualizador"} aria-hidden="true" data-visualizador="1">
      <canvas ref={tela} className="visualizador-tela" />
    </span>
  )
}

/** `prefers-reduced-motion`, and changes to it without reloading. */
function useMovimentoReduzido(): boolean {
  const consulta = typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null
  const [reduzido, setReduzido] = useState(() => consulta?.matches ?? false)
  useEffect(() => {
    if (!consulta) return
    const mudou = (): void => setReduzido(consulta.matches)
    consulta.addEventListener("change", mudou)
    return () => consulta.removeEventListener("change", mudou)
  }, [consulta?.media])
  return reduzido
}
