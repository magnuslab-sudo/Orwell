import { useEffect, useRef } from "react"
import { useAnalisador } from "../../hooks/useAnalisador.js"
import { strings } from "../../strings.js"

/** How many bars: like classic Winamp, around twenty. */
const BARRAS = 20
/** How much the peak falls per frame, as a fraction of height: slow, like Winamp. */
const QUEDA_DO_PICO = 0.006

/**
 * The spectrum display on the "Share audio" sheet: vertical bars in green and
 * cyan, each with its own peak that stays up for a moment and falls slowly.
 * It is the Winamp design, in skin colors (owner, 27 October 2026: "think
 * Winamp and Windows Media Player. Nostalgia.").
 *
 * The bands are logarithmic, like hearing: the first bar is around 40 Hz and
 * the last around 14 kHz, not half the bars spent above 10 kHz. The same
 * `AnalyserNode` as the card visualizer (`useAnalisador`), over the playback
 * track. It only runs while playing; stopped or with low motion, there are no
 * bars: the display floor shows in CSS.
 */
export function Espectro({ stream, aTocar }: { stream: MediaStream | null; aTocar: boolean }): React.JSX.Element {
  const tela = useRef<HTMLCanvasElement>(null)
  const reduzido =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  const analisador = useAnalisador(stream, aTocar && !reduzido)

  useEffect(() => {
    const canvas = tela.current
    // Stopped draws nothing: the bar floor is CSS (`.audio-espectro`).
    if (!canvas || !analisador) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const estilo = getComputedStyle(canvas)
    const verde = estilo.getPropertyValue("--presenca").trim() || "#50fa7b"
    const ciano = estilo.getPropertyValue("--acento").trim() || "#8be9fd"
    const escala = window.devicePixelRatio || 1
    const largura = Math.max(1, Math.round(canvas.clientWidth * escala))
    const altura = Math.max(1, Math.round(canvas.clientHeight * escala))
    canvas.width = largura
    canvas.height = altura

    const vao = Math.max(1, Math.round(2 * escala))
    const larguraDaBarra = (largura - vao * (BARRAS - 1)) / BARRAS
    const gradiente = ctx.createLinearGradient(0, altura, 0, 0)
    gradiente.addColorStop(0, verde)
    gradiente.addColorStop(1, ciano)
    const picos = new Float32Array(BARRAS)

    const desenhar = (niveis: ArrayLike<number>): void => {
      ctx.clearRect(0, 0, largura, altura)
      for (let i = 0; i < BARRAS; i++) {
        const nivel = niveis[i] ?? 0
        picos[i] = Math.max(nivel, (picos[i] ?? 0) - QUEDA_DO_PICO)
        const x = i * (larguraDaBarra + vao)
        // Bars at steps, like display segments.
        const degrau = 3 * escala
        const h = Math.max(degrau, Math.round((nivel * altura) / degrau) * degrau)
        ctx.globalAlpha = 0.9
        ctx.fillStyle = gradiente
        ctx.fillRect(x, altura - h, larguraDaBarra, h)
        ctx.globalAlpha = 1
        ctx.fillStyle = ciano
        ctx.fillRect(x, altura - Math.max(degrau, (picos[i] ?? 0) * altura) - escala, larguraDaBarra, Math.max(1, escala))
      }
    }

    const dados = new Uint8Array(analisador.frequencyBinCount)
    const niveis = new Float32Array(BARRAS)
    const hzPorBanda = analisador.context.sampleRate / analisador.fftSize
    // The bounds of each bar, in analyzer bands, on a logarithmic scale.
    const limites = Array.from({ length: BARRAS + 1 }, (_, i) =>
      Math.min(dados.length - 1, Math.max(1, Math.round((40 * Math.pow(14000 / 40, i / BARRAS)) / hzPorBanda))),
    )
    let pedido = 0
    const quadro = (): void => {
      pedido = requestAnimationFrame(quadro)
      if (document.hidden) return
      analisador.getByteFrequencyData(dados)
      for (let i = 0; i < BARRAS; i++) {
        const de = limites[i] ?? 1
        const ate = Math.max(de + 1, limites[i + 1] ?? de + 1)
        let maior = 0
        for (let b = de; b < ate; b++) maior = Math.max(maior, dados[b] ?? 0)
        niveis[i] = maior / 255
      }
      desenhar(niveis)
    }
    pedido = requestAnimationFrame(quadro)
    return () => {
      cancelAnimationFrame(pedido)
      ctx.clearRect(0, 0, largura, altura)
    }
  }, [analisador])

  return <canvas ref={tela} className="audio-espectro" role="img" aria-label={strings.leitorDeMusica.espectro} data-espectro="1" />
}
