/**
 * The game overlay controller: when it shows, where it sits, and dragging.
 *
 * No Electron, for the reason in `atalhos.ts`: the ports come as parameters,
 * and `overlay-janela.ts` connects them to the real `BrowserWindow` and
 * `screen`. The rules are tested in `overlay-controlador.test.ts`.
 *
 * **Dragging is done here, not by the system.** The other way was to mark the
 * pill as a drag zone (`-webkit-app-region: drag`). It doesn't work, for three
 * reasons: the drag zone swallows double-click (which resets position), on
 * Windows it doesn't play well with a window that passes the mouse through
 * (`setIgnoreMouseEvents`), and the system can't pin the window to the desktop
 * of each screen. Here, while the button is down, the main thread reads the
 * cursor 60 times a second and puts the window there. Reading the cursor, not
 * page events, is what keeps dragging going when the mouse leaves the window
 * faster than it follows.
 */

import {
  guardarPosicao,
  janelaDaOverlay,
  lerPosicoes,
  posicaoGuardada,
  posicaoPorOmissao,
  sanearCaras,
  sanearPreferencias,
  sanearResumo,
  deveMostrar,
  type Area,
  type DesenhoDaOverlay,
  type Posicao,
  type PosicoesGuardadas,
  type PreferenciasDaOverlay,
  type ResumoDaOverlay,
} from "./overlay.js"

/**
 * How often to reaffirm "always on top".
 *
 * On Windows a game in fullscreen (with the fullscreen optimizations, which are the normal case on Windows 10 e 11) can put itself above "topmost" windows when it gets focus or changes mode. Reaffirming every 2 em 2 s costs a system call and brings the pill back without the user noticing.
 */
export const PERIODO_DO_TOPO_MS = 2000
/** Dragging reads the cursor at 60 Hz. */
const PERIODO_DO_ARRASTO_MS = 16
/** A drag without an "end" (the page crashed mid-drag) ends on its own. */
const ARRASTO_MAXIMO_MS = 60_000

export interface Ecra {
  id: string
  /** The work area: the screen without the taskbar or menu bar. */
  area: Area
}

/** The overlay window, stripped to what's used. `criar` is idempotent. */
export interface PortaDaJanela {
  criar: () => void
  /** Show without taking focus from the game (`showInactive`). */
  mostrar: () => void
  esconder: () => void
  colocar: (limites: Area) => void
  /** `true`: clicks pass through to what's below (the game). */
  ignorarRato: (sim: boolean) => void
  desenhar: (desenho: DesenhoDaOverlay) => void
  enviarCaras: (caras: Record<string, string | null>) => void
  reafirmarTopo: () => void
  destruir: () => void
}

export interface PortaDosEcras {
  ecraEm: (ponto: { x: number; y: number }) => Ecra
  ecraPorId: (id: string) => Ecra | null
  principal: () => Ecra
  cursor: () => { x: number; y: number }
}

export interface ControladorDaOverlay {
  estado: (cru: unknown) => void
  caras: (cru: unknown) => void
  preferencias: (cru: unknown) => void
  /** The shortcut: hides until next call, or shows again. */
  alternar: () => void
  repor: () => void
  rato: (dentro: boolean) => void
  arrastar: (fase: "inicio" | "fim") => void
  largura: (pixeis: number) => void
  janelaPrincipal: (aFrente: boolean) => void
  /** The screens changed (a monitor came or went): re-pin. */
  ecrasMudaram: () => void
  /**
   * The positions from disk, read after startup. They only count if the pill
   * hasn't been placed yet: what the user did in the meantime wins.
   */
  carregarPosicoes: (cru: unknown) => void
  libertar: () => void
}

export function criarControladorDaOverlay(opcoes: {
  janela: PortaDaJanela
  ecras: PortaDosEcras
  /** The contents of the positions file, as it came from disk (or `null`). */
  guardadas: unknown
  gravar: (posicoes: PosicoesGuardadas) => void
  /** `setInterval` with the period already chosen by the caller; returns how to stop. */
  repetir: (fazer: () => void, periodoMs: number) => () => void
  agora?: () => number
}): ControladorDaOverlay {
  const { janela, ecras } = opcoes
  const agora = opcoes.agora ?? Date.now

  let preferencias: PreferenciasDaOverlay = sanearPreferencias(undefined)
  let resumo: ResumoDaOverlay | null = null
  const caras: Record<string, string | null> = {}
  let janelaAFrente = false
  let escondidaPelaPessoa = false
  let larguraDaPilula = 0
  let posicoes = lerPosicoes(opcoes.guardadas)
  let ecra: Ecra | null = null
  let posicao: Posicao | null = null
  let lado: "abaixo" | "acima" = "abaixo"
  let visivel = false
  let criada = false
  let ratoDentro = false
  let pararTopo: (() => void) | null = null
  let arrasto: { cursor: { x: number; y: number }; posicao: Posicao; desde: number; parar: () => void } | null = null

  const ecraActual = (): Ecra => {
    if (ecra) {
      const aindaExiste = ecras.ecraPorId(ecra.id)
      if (aindaExiste) return (ecra = aindaExiste)
    }
    const guardado = posicoes.ultimo ? ecras.ecraPorId(posicoes.ultimo) : null
    return (ecra = guardado ?? ecras.principal())
  }

  /** Puts the window where the position says, pinned to the screen. Returns if the warning side changed. */
  const colocar = (): boolean => {
    const onde = ecraActual()
    posicao ??= posicaoGuardada(posicoes, onde.id, onde.area)
    const limites = janelaDaOverlay(posicao, larguraDaPilula, onde.area)
    posicao = limites.posicao
    janela.colocar({ x: limites.x, y: limites.y, width: limites.width, height: limites.height })
    const mudou = limites.lado !== lado
    lado = limites.lado
    return mudou
  }

  const desenhar = (): void => {
    if (!visivel || !resumo) return
    janela.desenhar({ resumo, opacidade: preferencias.opacidade, lado, textos: preferencias.textos })
  }

  const pararArrasto = (): void => {
    if (!arrasto) return
    arrasto.parar()
    arrasto = null
  }

  const esconder = (): void => {
    pararArrasto()
    pararTopo?.()
    pararTopo = null
    if (visivel) janela.esconder()
    visivel = false
    ratoDentro = false
  }

  /** The only place that decides: runs after each new fact. */
  const decidir = (): void => {
    const mostrar = deveMostrar({ ligada: preferencias.ligada, emSala: resumo !== null, janelaAFrente, escondidaPelaPessoa })
    if (!mostrar) {
      esconder()
      return
    }
    if (!criada) {
      janela.criar()
      criada = true
    }
    if (!visivel) {
      colocar()
      // Always starts passing the mouse through: the pill only asks when the cursor is over it.
      janela.ignorarRato(true)
      if (Object.keys(caras).length > 0) janela.enviarCaras({ ...caras })
      visivel = true
      janela.mostrar()
      janela.reafirmarTopo()
      pararTopo = opcoes.repetir(() => janela.reafirmarTopo(), PERIODO_DO_TOPO_MS)
    }
    desenhar()
  }

  const gravarAqui = (): void => {
    if (!posicao) return
    const onde = ecraActual()
    posicoes = guardarPosicao(posicoes, onde.id, onde.area, posicao)
    opcoes.gravar(posicoes)
  }

  return {
    estado: (cru) => {
      const novo = sanearResumo(cru)
      // Outside a room, the shortcut stops counting: the next call starts visible.
      if (novo === null) escondidaPelaPessoa = false
      resumo = novo
      decidir()
    },
    caras: (cru) => {
      const novas = sanearCaras(cru)
      const mudadas: Record<string, string | null> = {}
      for (const [id, cara] of Object.entries(novas)) {
        if (caras[id] === cara) continue
        caras[id] = cara
        mudadas[id] = cara
      }
      // One face per person in the pill, plus faces of those who just left: the cap
      // is doubled, and the oldest leave first.
      const ids = Object.keys(caras)
      for (const id of ids.slice(0, Math.max(0, ids.length - 50))) delete caras[id]
      if (visivel && Object.keys(mudadas).length > 0) janela.enviarCaras(mudadas)
    },
    preferencias: (cru) => {
      preferencias = sanearPreferencias(cru)
      if (!preferencias.ligada && criada) {
        // Off in Settings: nothing waits in memory.
        esconder()
        janela.destruir()
        criada = false
        return
      }
      decidir()
    },
    alternar: () => {
      // With the main window in front the pill isn't visible, and the shortcut
      // doesn't change in the dark what the user will find when they go back to the game.
      if (resumo === null || janelaAFrente) return
      escondidaPelaPessoa = !escondidaPelaPessoa
      decidir()
    },
    repor: () => {
      const onde = ecraActual()
      posicao = posicaoPorOmissao(onde.area)
      if (visivel) {
        if (colocar()) desenhar()
      }
      gravarAqui()
    },
    rato: (dentro) => {
      ratoDentro = dentro === true
      // Mid-drag the cursor can leave the pill: clicks stay ours until release.
      if (visivel && !arrasto) janela.ignorarRato(!ratoDentro)
    },
    arrastar: (fase) => {
      if (fase === "fim") {
        if (!arrasto) return
        pararArrasto()
        gravarAqui()
        if (visivel) janela.ignorarRato(!ratoDentro)
        return
      }
      if (!visivel || arrasto || !posicao) return
      janela.ignorarRato(false)
      const inicio = { cursor: ecras.cursor(), posicao: { ...posicao }, desde: agora() }
      const parar = opcoes.repetir(() => {
        if (!arrasto) return
        if (agora() - arrasto.desde > ARRASTO_MAXIMO_MS) {
          pararArrasto()
          gravarAqui()
          janela.ignorarRato(!ratoDentro)
          return
        }
        const cursor = ecras.cursor()
        const desejada = {
          cx: arrasto.posicao.cx + (cursor.x - arrasto.cursor.x),
          y: arrasto.posicao.y + (cursor.y - arrasto.cursor.y),
        }
        // The screen is the one under the cursor: that's where the user is taking the pill.
        ecra = ecras.ecraEm(cursor)
        posicao = desejada
        if (colocar()) desenhar()
      }, PERIODO_DO_ARRASTO_MS)
      arrasto = { ...inicio, parar }
    },
    largura: (pixeis) => {
      if (typeof pixeis !== "number" || !Number.isFinite(pixeis) || pixeis < 0) return
      larguraDaPilula = Math.min(pixeis, 8192)
      if (visivel && colocar()) desenhar()
    },
    janelaPrincipal: (aFrente) => {
      janelaAFrente = aFrente === true
      decidir()
    },
    ecrasMudaram: () => {
      if (visivel && colocar()) desenhar()
    },
    carregarPosicoes: (cru) => {
      if (posicao !== null) return
      posicoes = lerPosicoes(cru)
      ecra = null
    },
    libertar: () => {
      esconder()
      if (criada) janela.destruir()
      criada = false
    },
  }
}
