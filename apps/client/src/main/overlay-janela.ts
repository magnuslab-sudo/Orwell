/**
 * The game overlay, connected to Electron.
 *
 * The decisions are in `overlay-controlador.ts` and `overlay.ts`; here we just connect
 * the ports to `BrowserWindow`, `screen` and the disk. `index.ts`
 * calls `ligarOverlayDeJogo` once, with the main window.
 *
 * **The window.** Transparent, no frame, no shadow, outside the taskbar, no focus (`focusable: false`: clicking the pill doesn't steal keyboard from the game) and above everything at level `screen-saver`.
 *
 *  - macOS: `type: "panel"` makes it a `NSPanel`, the only kind of window the system lets above a fullscreen app (in its own Space). `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` takes it to all Spaces, including fullscreen ones. `skipTransformProcessType`
 *    prevents Electron from changing the process type, which hid the dock icon for a moment each time.
 *  - Windows: most DX11 and DX12 games in "fullscreen" on Windows 10
 *    and 11 corre with fullscreen optimizations (the DWM composites the game as a window), and there a "topmost" window shows up on top. The game can put itself to the front when it gets focus: the controller reaffirms the top 2 em
 *    2 s (`PERIODO_DO_TOPO_MS`) and when the overlay window ITSELF loses "always on top" (`always-on-top-changed`), and `showInactive` shows without stealing focus.
 *  - Exclusive fullscreen: off, by owner's decision (anti-cheat risk). Orwell never injects code or reads other processes' memory.
 *
 * **Nothing here looks at the game.** Windows from other processes aren't enumerated, the game window isn't tracked, and there are no global keyboard or mouse hooks beyond the shortcuts that already existed (`atalhos.ts`). The top is reaffirmed only by the overlay window's state: its events and a timer.
 *
 * **Who talks to whom.** The main renderer sends state, faces, preferences and the shortcut; the overlay page sends mouse, drag and width. Each channel checks who sent it: the overlay page can't change the summary, and the main renderer can't drag the window.
 */

import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from "electron"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { criarControladorDaOverlay, type Ecra } from "./overlay-controlador.js"
import { CANAIS_DA_OVERLAY, type DesenhoDaOverlay } from "./overlay.js"

export function ligarOverlayDeJogo(opcoes: {
  principal: BrowserWindow
  /** `out/preload/overlay.cjs`. */
  preload: string
  /** Loads the overlay page in the given window. */
  carregar: (janela: BrowserWindow) => Promise<void>
  /** The app's data folder (`app.getPath("userData")`). */
  pastaDeDados: string
}): { libertar: () => void } {
  const { principal } = opcoes
  const ficheiro = join(opcoes.pastaDeDados, "overlay.json")
  let janela: BrowserWindow | null = null
  /** What arrived before the page finished loading. Delivered in `did-finish-load`. */
  let pronta = false
  let ultimoDesenho: DesenhoDaOverlay | null = null
  const carasPendentes: Record<string, string | null> = {}

  const enviarParaAPagina = (canal: string, valor: unknown): void => {
    if (janela && !janela.isDestroyed() && pronta) janela.webContents.send(canal, valor)
  }

  const ecraDe = (display: Electron.Display): Ecra => ({ id: String(display.id), area: display.workArea })

  const controlador = criarControladorDaOverlay({
    guardadas: null,
    janela: {
      criar: () => {
        if (janela && !janela.isDestroyed()) return
        pronta = false
        const nova = new BrowserWindow({
          width: 400,
          height: 136,
          show: false,
          frame: false,
          transparent: true,
          backgroundColor: "#00000000",
          hasShadow: false,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          focusable: false,
          alwaysOnTop: true,
          ...(process.platform === "darwin" ? { type: "panel" } : {}),
          title: "Orwell",
          webPreferences: {
            preload: opcoes.preload,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: false,
            webSecurity: true,
            spellcheck: false,
            // The page doesn't decide whether the user is looking, unlike the main one (see
            // the note in `index.ts`). Here it just needs to keep animating the ring above the
            // game.
            backgroundThrottling: false,
          },
        })
        nova.setAlwaysOnTop(true, "screen-saver")
        nova.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
        nova.setIgnoreMouseEvents(true, { forward: true })
        nova.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
        nova.webContents.on("will-navigate", (evento) => evento.preventDefault())
        nova.webContents.on("did-finish-load", () => {
          pronta = true
          if (Object.keys(carasPendentes).length > 0) nova.webContents.send(CANAIS_DA_OVERLAY.carasDaPagina, { ...carasPendentes })
          if (ultimoDesenho) nova.webContents.send(CANAIS_DA_OVERLAY.desenhar, ultimoDesenho)
        })
        // If the system takes away "always on top", it comes back immediately, without waiting for the timer.
        nova.on("always-on-top-changed", (_evento, porCima) => {
          if (!porCima && nova.isVisible()) nova.setAlwaysOnTop(true, "screen-saver")
        })
        nova.on("closed", () => {
          if (janela === nova) janela = null
        })
        janela = nova
        void opcoes.carregar(nova).catch((erro: Error) => {
          process.stderr.write(`overlay failed to load: ${erro.message}\n`)
        })
      },
      mostrar: () => janela?.showInactive(),
      esconder: () => janela?.hide(),
      colocar: (limites) => janela?.setBounds(limites),
      ignorarRato: (sim) => {
        if (!janela || janela.isDestroyed()) return
        if (sim) janela.setIgnoreMouseEvents(true, { forward: true })
        else janela.setIgnoreMouseEvents(false)
      },
      desenhar: (desenho) => {
        ultimoDesenho = desenho
        enviarParaAPagina(CANAIS_DA_OVERLAY.desenhar, desenho)
      },
      enviarCaras: (caras) => {
        Object.assign(carasPendentes, caras)
        enviarParaAPagina(CANAIS_DA_OVERLAY.carasDaPagina, caras)
      },
      reafirmarTopo: () => {
        if (!janela || janela.isDestroyed()) return
        janela.setAlwaysOnTop(true, "screen-saver")
        janela.moveTop()
      },
      destruir: () => {
        if (janela && !janela.isDestroyed()) janela.destroy()
        janela = null
        pronta = false
        ultimoDesenho = null
        for (const id of Object.keys(carasPendentes)) delete carasPendentes[id]
      },
    },
    ecras: {
      ecraEm: (ponto) => ecraDe(screen.getDisplayNearestPoint(ponto)),
      ecraPorId: (id) => {
        const achado = screen.getAllDisplays().find((display) => String(display.id) === id)
        return achado ? ecraDe(achado) : null
      },
      principal: () => ecraDe(screen.getPrimaryDisplay()),
      cursor: () => screen.getCursorScreenPoint(),
    },
    gravar: (posicoes) => {
      // An interface preference with no secrets: stored outside the vault, like the skipped
      // update. Write failures just forget the location.
      void writeFile(ficheiro, `${JSON.stringify(posicoes)}\n`, "utf8").catch(() => {})
    },
    repetir: (fazer, periodo) => {
      const id = setInterval(fazer, periodo)
      return () => clearInterval(id)
    },
  })

  // Screen positions arrive after startup; center-top works until then.
  void readFile(ficheiro, "utf8")
    .then((texto) => controlador.carregarPosicoes(texto))
    .catch(() => {})

  const doPrincipal = (evento: IpcMainEvent): boolean => evento.sender === principal.webContents
  const daOverlay = (evento: IpcMainEvent): boolean => janela !== null && !janela.isDestroyed() && evento.sender === janela.webContents

  const ouvir = (canal: string, conferir: (evento: IpcMainEvent) => boolean, fazer: (valor: unknown) => void): void => {
    ipcMain.on(canal, (evento, valor: unknown) => {
      if (conferir(evento)) fazer(valor)
    })
  }
  const doisLados = (evento: IpcMainEvent): boolean => doPrincipal(evento) || daOverlay(evento)

  ouvir(CANAIS_DA_OVERLAY.estado, doPrincipal, (valor) => controlador.estado(valor))
  ouvir(CANAIS_DA_OVERLAY.caras, doPrincipal, (valor) => controlador.caras(valor))
  ouvir(CANAIS_DA_OVERLAY.preferencias, doPrincipal, (valor) => controlador.preferencias(valor))
  ouvir(CANAIS_DA_OVERLAY.alternar, doPrincipal, () => controlador.alternar())
  ouvir(CANAIS_DA_OVERLAY.repor, doisLados, () => controlador.repor())
  ouvir(CANAIS_DA_OVERLAY.rato, daOverlay, (valor) => controlador.rato(valor === true))
  ouvir(CANAIS_DA_OVERLAY.arrastar, daOverlay, (valor) => {
    if (valor === "inicio" || valor === "fim") controlador.arrastar(valor)
  })
  ouvir(CANAIS_DA_OVERLAY.largura, daOverlay, (valor) => {
    if (typeof valor === "number") controlador.largura(valor)
  })

  // The main window in front hides the overlay: the call is already visible there.
  const aFrente = (): boolean =>
    !principal.isDestroyed() && principal.isVisible() && !principal.isMinimized() && principal.isFocused()
  const reler = (): void => controlador.janelaPrincipal(aFrente())
  principal.on("focus", reler)
  principal.on("blur", reler)
  principal.on("show", reler)
  principal.on("hide", reler)
  principal.on("minimize", reler)
  principal.on("restore", reler)
  reler()

  // A crashed or reloaded renderer no longer reports leaving the room.
  const fora = (): void => controlador.estado(null)
  principal.webContents.on("render-process-gone", fora)
  principal.webContents.on("did-start-navigation", (detalhes) => {
    if (detalhes.isMainFrame && !detalhes.isSameDocument) fora()
  })

  const mudaram = (): void => controlador.ecrasMudaram()
  screen.on("display-removed", mudaram)
  screen.on("display-added", mudaram)
  screen.on("display-metrics-changed", mudaram)

  return {
    libertar: () => {
      screen.removeListener("display-removed", mudaram)
      screen.removeListener("display-added", mudaram)
      screen.removeListener("display-metrics-changed", mudaram)
      controlador.libertar()
    },
  }
}
