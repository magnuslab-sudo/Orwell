/**
 * The game overlay, for decisions that don't need Electron.
 *
 * Owner request on November 2, 2026: proposal 4 from
 * `~/Downloads/Orwell-overlays-jogo/` ("the 4 with transparency, draggable").
 * A translucent pill above the game, with the voice room name and the
 * faces of who is there; the ring lights up when someone talks; a short
 * alert when someone joins or leaves.
 *
 * Separate from `overlay-janela.ts` for the same reason as `ecra.ts` and
 * `aviso.ts`: what is decided is measured without opening a window. The
 * overlay page (`renderer/overlay/`) imports measurements and
 * `mudancasNaSala` from here, so this file doesn't import anything from
 * Node or Electron.
 *
 * **What crosses IPC, and what never does.** The main renderer sends a
 * minimal summary: the room name and, per person, the name, whether they're
 * talking, and whether they're muted. Faces go separately, once per person
 * (`sanearCaras`): the talking state changes several times a second, and
 * sending faces with it was pushing hundreds of KB through IPC per syllable.
 * No keys, no messages, no network addresses. The overlay page has no
 * network access (see the CSP in `renderer/overlay.html`).
 */

import { sanearIcone } from "./aviso.js"

/** The IPC channels, in one place so the two `preload` files and the main process align. */
export const CANAIS_DA_OVERLAY = {
  /** Main renderer → main process: room summary, or `null` when not in a room. */
  estado: "overlay:estado",
  /** Main renderer → main: the new faces, by id. */
  caras: "overlay:caras",
  /** Renderer principal → principal: ligada e opacidade. */
  preferencias: "overlay:preferencias",
  /** Main renderer → main process: shortcut loaded. */
  alternar: "overlay:alternar",
  /** Either → main process: return to center, on top. */
  repor: "overlay:repor",
  /** Overlay page → main process: mouse is (or left) over the pill. */
  rato: "overlay:rato",
  /** Overlay page → main process: drag started or ended. */
  arrastar: "overlay:arrastar",
  /** Overlay page → main process: pill width changed. */
  largura: "overlay:largura",
  /** Main process → overlay page: what to draw. */
  desenhar: "overlay:desenhar",
  /** Main process → overlay page: new faces. */
  carasDaPagina: "overlay:caras-da-pagina",
} as const

/*
  Window measurements in density-independent pixels. The page draws with these
  same constants, so they live here.
*/
export const ALTURA_DA_PILULA = 56
export const ALTURA_DO_AVISO = 48
export const LARGURA_DO_AVISO = 300
/** Between the pill and the alert. */
export const INTERVALO = 8
/** Around everything: the green ring lights up outside the face and needs room. */
export const MARGEM_DA_JANELA = 8
/** Distance from screen top in the default position. */
export const MARGEM_DO_TOPO = 16
/** How many faces fit in the pill. Beyond this shows as "+N". */
export const MAX_PESSOAS = 25
/** The cap on reduced face size, in data URL characters. A 64 px face fits easily. */
export const MAX_CARA = 64 * 1024
const MAX_NOME = 48
const MAX_SALA = 64

export interface Area {
  x: number
  y: number
  width: number
  height: number
}

/** Where the pill is: horizontal center and top in screen coordinates. */
export interface Posicao {
  cx: number
  y: number
}

export interface PessoaNaOverlay {
  id: string
  nome: string
  aFalar: boolean
  micCalado: boolean
  somDesligado: boolean
  /** The name comes from the address, not user-chosen, so it's drawn discreetly. */
  doEndereco?: boolean
}

export interface ResumoDaOverlay {
  sala: string
  /**
   * A number that changes each time you enter a room. Two rooms with the same
   * name in different channels are separate entries, so switching between them
   * doesn't announce everyone joining.
   */
  entrada: number
  pessoas: PessoaNaOverlay[]
}

/**
 * Alert text in the interface language. They come from the renderer catalog
 * (`strings.overlayDeJogo`): this process doesn't load it, nor does the
 * overlay page. The name leads, highlighted: "**Kaori** joined the room".
 */
export interface TextosDaOverlay {
  entrou: string
  saiu: string
}

export const TEXTOS_POR_OMISSAO: TextosDaOverlay = { entrou: "entrou na sala", saiu: "saiu da sala" }

export interface PreferenciasDaOverlay {
  ligada: boolean
  /** The pill background opacity, from 0.2 to 1. */
  opacidade: number
  textos: TextosDaOverlay
}

export const OPACIDADE_POR_OMISSAO = 0.45
export const OPACIDADE_MINIMA = 0.2

/** What the main process sends to the page: what to draw and where the alert goes. */
export interface DesenhoDaOverlay {
  resumo: ResumoDaOverlay
  opacidade: number
  lado: "abaixo" | "acima"
  textos: TextosDaOverlay
}

/**
 * Whether the overlay shows now.
 *
 * Only in a voice room, and only when the main window is not focused: with it
 * focused, the call is already visible there, so the pill would be redundant.
 * The shortcut hides it until the next call.
 */
export function deveMostrar(factos: {
  ligada: boolean
  emSala: boolean
  janelaAFrente: boolean
  escondidaPelaPessoa: boolean
}): boolean {
  return factos.ligada && factos.emSala && !factos.janelaAFrente && !factos.escondidaPelaPessoa
}

export function posicaoPorOmissao(area: Area): Posicao {
  return { cx: area.x + area.width / 2, y: area.y + MARGEM_DO_TOPO }
}

const prender = (valor: number, minimo: number, maximo: number): number =>
  maximo < minimo ? minimo : Math.min(maximo, Math.max(minimo, valor))

/**
 * The entire window, based on the pill position.
 *
 * It holds the pill and alert space, both centered on the same axis. The alert
 * goes below the pill; if it doesn't fit (pill at screen bottom), it goes
 * above. The pill doesn't jump when the alert switches sides: the window grows
 * the other way. Everything stays within the screen's work area, outside
 * taskbar and menu bar. On a smaller screen, the top-left corner wins.
 */
export function janelaDaOverlay(
  posicao: Posicao,
  larguraDaPilula: number,
  area: Area,
): Area & { lado: "abaixo" | "acima"; pilulaY: number; posicao: Posicao } {
  // A pill wider than the screen clips: the page draws "+N".
  const pilula = Math.min(Number.isFinite(larguraDaPilula) ? larguraDaPilula : 0, area.width - 2 * MARGEM_DA_JANELA)
  const largura = Math.round(Math.max(pilula, Math.min(LARGURA_DO_AVISO, area.width - 2 * MARGEM_DA_JANELA)) + 2 * MARGEM_DA_JANELA)
  const altura = ALTURA_DA_PILULA + INTERVALO + ALTURA_DO_AVISO + 2 * MARGEM_DA_JANELA
  const metade = largura / 2

  const cx = prender(posicao.cx, area.x + metade, area.x + area.width - metade)
  // The pill with its margin must fit.
  const pilulaY = prender(
    posicao.y,
    area.y + MARGEM_DA_JANELA,
    area.y + area.height - ALTURA_DA_PILULA - MARGEM_DA_JANELA,
  )
  const cabePorBaixo = pilulaY - MARGEM_DA_JANELA + altura <= area.y + area.height
  const lado = cabePorBaixo ? "abaixo" : "acima"
  const yDaJanela = lado === "abaixo" ? pilulaY - MARGEM_DA_JANELA : pilulaY + ALTURA_DA_PILULA + MARGEM_DA_JANELA - altura

  return {
    x: Math.max(area.x, Math.round(cx - metade)),
    y: Math.max(area.y, Math.round(yDaJanela)),
    width: largura,
    height: altura,
    lado,
    pilulaY,
    posicao: { cx, y: pilulaY },
  }
}

/**
 * Saved positions, one per screen, relative to that screen's work area corner.
 * Relative because screen layouts change (a laptop docked to a monitor on the
 * left): a spot you picked on one screen stays put on that screen.
 */
export interface PosicoesGuardadas {
  ecras: Record<string, { dx: number; dy: number }>
  /** The screen the pill was on last time. */
  ultimo: string | null
}

const VAZIAS = (): PosicoesGuardadas => ({ ecras: {}, ultimo: null })

/** The file, treated as "nothing saved" when corrupted. */
export function lerPosicoes(cru: unknown): PosicoesGuardadas {
  let valor = cru
  if (typeof valor === "string") {
    try {
      valor = JSON.parse(valor)
    } catch {
      return VAZIAS()
    }
  }
  if (typeof valor !== "object" || valor === null) return VAZIAS()
  const lido = valor as { ecras?: unknown; ultimo?: unknown }
  const saida = VAZIAS()
  if (typeof lido.ecras === "object" && lido.ecras !== null) {
    for (const [ecra, pos] of Object.entries(lido.ecras as Record<string, unknown>).slice(0, 16)) {
      const { dx, dy } = (pos ?? {}) as { dx?: unknown; dy?: unknown }
      if (typeof dx === "number" && typeof dy === "number" && Number.isFinite(dx) && Number.isFinite(dy)) {
        saida.ecras[ecra.slice(0, 32)] = { dx, dy }
      }
    }
  }
  if (typeof lido.ultimo === "string" && lido.ultimo.length <= 32) saida.ultimo = lido.ultimo
  return saida
}

export function guardarPosicao(
  guardadas: PosicoesGuardadas,
  ecra: string,
  area: Area,
  posicao: Posicao,
): PosicoesGuardadas {
  return {
    ecras: { ...guardadas.ecras, [ecra]: { dx: Math.round(posicao.cx - area.x), dy: Math.round(posicao.y - area.y) } },
    ultimo: ecra,
  }
}

export function posicaoGuardada(guardadas: PosicoesGuardadas, ecra: string, area: Area): Posicao {
  const desta = guardadas.ecras[ecra]
  return desta ? { cx: area.x + desta.dx, y: area.y + desta.dy } : posicaoPorOmissao(area)
}

const texto = (valor: unknown, maximo: number): string =>
  typeof valor === "string" ? valor.replace(/\s+/g, " ").trim().slice(0, maximo) : ""

/**
 * The summary from the renderer, sanitized.
 *
 * The renderer shows what other people wrote (the names are theirs), so what
 * it sends is treated as untrusted: only known fields pass through, trimmed.
 * `null` and garbage mean "not in a room".
 */
export function sanearResumo(cru: unknown): ResumoDaOverlay | null {
  if (typeof cru !== "object" || cru === null) return null
  const lido = cru as { sala?: unknown; entrada?: unknown; pessoas?: unknown }
  if (!Array.isArray(lido.pessoas)) return null
  const vistos = new Set<string>()
  const pessoas: PessoaNaOverlay[] = []
  for (const item of lido.pessoas) {
    if (pessoas.length >= MAX_PESSOAS) break
    if (typeof item !== "object" || item === null) continue
    const p = item as Record<string, unknown>
    const id = texto(p.id, 256)
    if (!id || vistos.has(id)) continue
    vistos.add(id)
    pessoas.push({
      id,
      nome: texto(p.nome, MAX_NOME),
      aFalar: p.aFalar === true,
      micCalado: p.micCalado === true,
      somDesligado: p.somDesligado === true,
      ...(p.doEndereco === true ? { doEndereco: true } : {}),
    })
  }
  const entrada = typeof lido.entrada === "number" && Number.isSafeInteger(lido.entrada) ? lido.entrada : 0
  return { sala: texto(lido.sala, MAX_SALA), entrada, pessoas }
}

/** Face avatars indexed by ID. A rejected face is `null`: the page renders the placeholder. */
export function sanearCaras(cru: unknown): Record<string, string | null> {
  if (typeof cru !== "object" || cru === null || Array.isArray(cru)) return {}
  const saida: Record<string, string | null> = {}
  for (const [id, cara] of Object.entries(cru as Record<string, unknown>).slice(0, MAX_PESSOAS)) {
    saida[id.slice(0, 256)] = sanearIcone(cara, MAX_CARA)
  }
  return saida
}

export function sanearPreferencias(cru: unknown): PreferenciasDaOverlay {
  const lido = (typeof cru === "object" && cru !== null ? cru : {}) as {
    ligada?: unknown
    opacidade?: unknown
    textos?: { entrou?: unknown; saiu?: unknown }
  }
  const opacidade =
    typeof lido.opacidade === "number" && Number.isFinite(lido.opacidade)
      ? Math.min(1, Math.max(OPACIDADE_MINIMA, lido.opacidade))
      : OPACIDADE_POR_OMISSAO
  // Disabled by default since 2/11/2026: only an explicit `true` turns it on.
  const entrou = texto(lido.textos?.entrou, 40)
  const saiu = texto(lido.textos?.saiu, 40)
  return {
    ligada: lido.ligada === true,
    opacidade,
    textos: { entrou: entrou || TEXTOS_POR_OMISSAO.entrou, saiu: saiu || TEXTOS_POR_OMISSAO.saiu },
  }
}

export interface MudancaNaSala {
  tipo: "entrou" | "saiu"
  pessoa: PessoaNaOverlay
}

/**
 * Who joined and who left between two room snapshots.
 *
 * The first snapshot of an entry reports no one: people already there when we
 * arrived did not join. Joins come before leaves.
 */
export function mudancasNaSala(antes: ResumoDaOverlay | null, depois: ResumoDaOverlay | null): MudancaNaSala[] {
  if (!antes || !depois || antes.entrada !== depois.entrada) return []
  const idsAntes = new Set(antes.pessoas.map((p) => p.id))
  const idsDepois = new Set(depois.pessoas.map((p) => p.id))
  return [
    ...depois.pessoas.filter((p) => !idsAntes.has(p.id)).map((pessoa) => ({ tipo: "entrou" as const, pessoa })),
    ...antes.pessoas.filter((p) => !idsDepois.has(p.id)).map((pessoa) => ({ tipo: "saiu" as const, pessoa })),
  ]
}
