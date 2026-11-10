import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import type { Participant } from "@enclave/client-core"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { strings } from "../../strings.js"
import { CallPanel } from "./CallPanel.js"

afterEach(cleanup)

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

/**
 * The "Minimal" control bar (board H4, chosen by the owner on October 21, 2026):
 * icons without background, fixed order, and the off state told by a strike
 * through the icon and a color that still reads.
 *
 * The weak point the designer pointed out is contrast: without background or
 * frame, the off icon stands alone against the page background. Measured here
 * with the same WCAG formula as in `hooks/usePrefs.test.ts`, against the
 * background and against the background at the lightest spot of its gradients.
 */
const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const semComentarios = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "")
const tokens = semComentarios(ler("../../styles/tokens.css"))
const fundoCss = semComentarios(ler("../../styles/fundo.css"))
const ecras = semComentarios(ler("../../styles/screens.css"))

function token(nome: string): string {
  const valor = new RegExp(`${nome}:\\s*(#[0-9a-f]{6})`, "i").exec(tokens)?.[1]
  if (!valor) throw new Error(`falta ${nome} em tokens.css`)
  return valor
}

type Rgb = readonly [number, number, number]
const rgb = (hex: string): Rgb => {
  const v = Number.parseInt(hex.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** WCAG relative luminance, as in `usePrefs.test.ts`. */
function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number): number => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const first = luminance(a)
  const second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** An `rgba` layer on top of a solid color. */
const compor = (base: Rgb, [r, g, b, a]: readonly [number, number, number, number]): Rgb =>
  [base[0] + (r - base[0]) * a, base[1] + (g - base[1]) * a, base[2] + (b - base[2]) * a] as const

/** The layers of the background gradients, read from `fundo.css`. */
const gradientes = [...fundoCss.matchAll(/radial-gradient\([^)]*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g)].map(
  (m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const,
)

const fundo = rgb(token("--fundo"))
/** The worst case: both gradients at their max, one on top of the other. */
const fundoMaisClaro = gradientes.reduce(compor, fundo)
/** An `rgba(r, g, b, a)` token from `tokens.css`. */
function rgbaDe(nome: string): readonly [number, number, number, number] {
  const m = new RegExp(`${nome}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)`).exec(tokens)
  if (!m) throw new Error(`falta ${nome} em tokens.css`)
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const
}

/**
 * The minimal bar is a pill on top of the aurora (`paineis.css`), no filter. The
 * worst case: each patch of the aurora at its max, without its blur bringing it
 * down, and the bar ink on top.
 */
const manchas = ["--aurora-azul", "--aurora-violeta", "--aurora-rosa", "--aurora-verde"].map(rgbaDe)
const tintaDaBarra = rgbaDe("--painel-barra")
const sobAurora = Object.fromEntries(
  manchas.map((mancha, i) => [`a mancha ${i + 1} da aurora, sob a tinta da barra`, compor(compor(fundo, mancha), tintaDaBarra)]),
)

const superficies: Record<string, Rgb> = {
  "--fundo": fundo,
  "--vidro-solido": rgb(token("--vidro-solido")),
  "o fundo no ponto mais claro dos gradientes": fundoMaisClaro,
  ...sobAurora,
}

describe('barra "Mínima" — o contraste dos estados', () => {
  it("os gradientes do fundo foram lidos (sem eles, o pior caso não é o pior)", () => {
    expect(gradientes.length).toBe(2)
  })

  it("desligado e neutro usam a cor discreta, que é a mais fraca da barra", () => {
    const regra = (seletor: string): string =>
      new RegExp(`${seletor.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`).exec(ecras)?.[1] ?? ""
    expect(regra(".call-barra .call-btn")).toMatch(/color:\s*var\(--discreto\)/)
    expect(regra(".call-barra .call-btn.off")).toMatch(/color:\s*var\(--discreto\)/)
    expect(regra(".call-barra .call-btn.on")).toMatch(/color:\s*var\(--acento\)/)
    expect(regra(".call-barra .call-btn.hangup")).toMatch(/color:\s*var\(--rosa\)/)
  })

  it("o traço do ligado não usa pseudo-elementos: são os da dica (`[data-tip]`)", () => {
    expect(ecras).not.toMatch(/\.call-barra \.call-btn[^{,]*::(after|before)/)
  })

  it.each([
    ["desligado e neutro (--discreto)", "--discreto"],
    ["ligado (--acento)", "--acento"],
    ["desligar (--rosa)", "--rosa"],
  ])("%s passa 4,5:1 sobre todas as superfícies", (_nome, cor) => {
    for (const [onde, superficie] of Object.entries(superficies)) {
      expect(contrast(rgb(token(cor)), superficie), onde).toBeGreaterThanOrEqual(4.5)
    }
  })
})

/* ------------------------------------------------------------ a barra montada */

const perfil = { displayName: "Eu", donations: [] } as unknown as Profile
const comCamara = {
  getVideoTracks: () => [{}],
  getAudioTracks: () => [],
  getTracks: () => [],
} as unknown as MediaStream

function painel(overrides: Partial<React.ComponentProps<typeof CallPanel>> = {}): React.JSX.Element {
  return (
    <CallPanel
      call={
        {
          setMuted: () => {},
          setCameraOff: () => {},
          podePartilharEcra: true,
          tectoDePartilha: 99,
        } as unknown as EnclaveBridge["call"]
      }
      channel="!geral:s"
      participants={[{ address: "@ana:s", connected: true, stream: null } as Participant]}
      localStream={comCamara}
      selfLabel="Eu"
      selfProfile={perfil}
      nameFor={(sender) => sender}
      directory={new Map()}
      onToggleMic={() => {}}
      onToggleSound={() => {}}
      onLeave={() => {}}
      {...overrides}
    />
  )
}

const botoes = (container: HTMLElement): HTMLButtonElement[] => [
  ...container.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button'),
]

describe('barra "Mínima" — a ordem e o risco', () => {
  it("microfone, som, ecrã, vídeo, desligar", () => {
    const { container } = render(painel())
    expect(botoes(container).map((botao) => botao.getAttribute("aria-label"))).toEqual([
      strings.call.micAria(false),
      strings.call.soundAria(false),
      strings.call.screenAria(false),
      strings.call.cameraOff,
      strings.call.leave,
    ])
  })

  it("desligado diz-se também pelo risco no ícone, que não depende da cor", () => {
    const { container } = render(painel({ micMuted: true, soundOff: true }))
    const [mic, som] = botoes(container)
    expect(mic?.classList.contains("off")).toBe(true)
    expect(som?.classList.contains("off")).toBe(true)
    expect(mic?.querySelector('path[d="M4 3l16 18"]')).not.toBeNull()
    expect(som?.querySelector('path[d="M7.2 5.6l9.6 13"]')).not.toBeNull()
  })

  it("ligado, sem risco", () => {
    const { container } = render(painel())
    const [mic, som] = botoes(container)
    expect(mic?.classList.contains("on")).toBe(true)
    expect(mic?.querySelector('path[d="M4 3l16 18"]')).toBeNull()
    expect(som?.querySelector('path[d="M7.2 5.6l9.6 13"]')).toBeNull()
  })
})
