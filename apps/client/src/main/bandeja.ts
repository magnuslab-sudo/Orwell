import { app, Menu, nativeImage, Notification, Tray, type BrowserWindow } from "electron"
import { ICONE_CLARO_16, ICONE_CLARO_32, ICONE_ESCURO_16, ICONE_ESCURO_32 } from "./icone.js"
import { entregaDoAviso, type Aviso, type Recusa } from "./aviso.js"

export { sanearAviso, type Aviso, type Recusa } from "./aviso.js"

/**
 * The app in the system tray and the notices it sends.
 *
 * This exists to answer "notifications with the app closed" without paying the
 * usual price. The usual price is browser push: a third-party delivery service
 * learns what time someone writes to you, without knowing who wrote or what,  * conversation metadata handed to a third party, which is precisely what this
 * app exists not to do.
 *
 * On a desktop that price does not have to be paid. Closing the window hides
 * it and the process stays alive and connected, decrypting here inside as
 * always; the notice that shows on screen is from the local OS. No one gets in
 * the middle.
 *
 * What this module does NOT do, and must not start to do: decide what deserves
 * a notice. That rule is one and lives in `packages/ui/src/lib/notifications.ts`,
 * next to the bell inside the app. Here we only show what was already decided
 * there, two rules deciding the same thing always drift apart, and the day
 * they drift is the day a mention stops alerting.
 */

export interface Bandeja {
  /** Shows a notice. Returns the reason for refusal, or `null` if it appeared. */
  avisar: (aviso: Aviso) => Recusa
  /** Brings the window back to the foreground, regardless of where the request came from. */
  revelar: () => void
  /** The vault closed: the count dies with it. */
  aoTrancar: () => void
  destruir: () => void
}

/**
 * The log, under the same flag as the rest of the main process.
 *
 * Never includes the notice body: a diagnostic log that copies decrypted
 * messages to stderr is a leak with another name. Only what happened and why,  * which is precisely what you need to know when a notice does not appear.
 */
const rasto = (linha: string): void => {
  if (process.env.ENCLAVE_TRACE) process.stderr.write(`[bandeja] ${linha}\n`)
}

function imagemDoIcone(): Electron.NativeImage {
  // Outside macOS there is no template image, and the tray is usually dark.
  const molde = process.platform === "darwin"
  const imagem = nativeImage.createFromDataURL(`data:image/png;base64,${molde ? ICONE_ESCURO_16 : ICONE_CLARO_16}`)
  imagem.addRepresentation({
    scaleFactor: 2,
    dataURL: `data:image/png;base64,${molde ? ICONE_ESCURO_32 : ICONE_CLARO_32}`,
  })
  if (molde) imagem.setTemplateImage(true)
  return imagem
}

/** Autostart is only controllable where Electron knows how to control it. */
const ARRANQUE_GOVERNAVEL = process.platform === "darwin" || process.platform === "win32"

function arrancaComOSistema(): boolean {
  if (!ARRANQUE_GOVERNAVEL) return false
  return app.getLoginItemSettings().openAtLogin
}

export interface OpcoesDaBandeja {
  janela: BrowserWindow
  /**
   * The vault is open.
   *
   * A notice with the vault closed would be a contradiction: when closed there
   * are no keys, and without keys there is nothing decrypted to say. An app
   * that stayed in the tray decrypting with the vault closed would be the
   * failure, not the feature.
   */
  cofreAberto: () => boolean
  /** Quit for real. Closing the window is not this, see `index.ts`. */
  sair: () => void
}

export function montarBandeja({ janela, cofreAberto, sair }: OpcoesDaBandeja): Bandeja {
  const tray = new Tray(imagemDoIcone())
  let porLer = 0

  const revelar = (): void => {
    if (janela.isMinimized()) janela.restore()
    janela.show()
    janela.focus()
    // On macOS the window can be brought back with the app still in the background,
    // and then it appears behind what was in front.
    if (process.platform === "darwin") app.focus({ steal: true })
  }

  const desenhar = (): void => {
    tray.setToolTip(porLer > 0 ? `Orwell — ${porLer} por ler` : "Orwell")
    // The dock badge follows the same count, and so the same silence: with
    // "Show content" off, `porLer` never goes up.
    app.setBadgeCount(porLer)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Abrir o Orwell", click: revelar },
        { type: "separator" },
        ...(ARRANQUE_GOVERNAVEL
          ? ([
              {
                label: "Arrancar com o sistema",
                type: "checkbox",
                checked: arrancaComOSistema(),
                click: (item) => {
                  // Offered, never forced: born off and turns off here itself. `openAsHidden`
                  // is what makes the whole promise, start with the system and stay in the
                  // tray, not open a window on top of what someone was doing when they turned
                  // on the computer.
                  app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true })
                  desenhar()
                },
              },
              { type: "separator" },
            ] satisfies Electron.MenuItemConstructorOptions[])
          : []),
        { label: "Sair", click: sair },
      ]),
    )
  }

  const limparContagem = (): void => {
    if (porLer === 0) return
    porLer = 0
    desenhar()
  }

  /**
   * The window is open and in the foreground.
   *
   * This question is answered here, not on screen, because on screen the
   * answer is false: measured, a hidden window still tells its document it is
   * visible and has focus. This process is what hides it, and it is what
   * knows.
   */
  const aFrente = (): boolean => !janela.isDestroyed() && janela.isVisible() && janela.isFocused()

  const anunciarEstado = (): void => {
    if (janela.isDestroyed()) return
    janela.webContents.send("event:window-state", { inFront: aFrente() })
  }

  // Viewing the window is having read what the count announced.
  janela.on("show", limparContagem)
  janela.on("focus", limparContagem)

  janela.on("show", anunciarEstado)
  janela.on("hide", anunciarEstado)
  janela.on("focus", anunciarEstado)
  janela.on("blur", anunciarEstado)
  janela.on("minimize", anunciarEstado)
  janela.on("restore", anunciarEstado)
  // And once on arrival: the screen is born after this setup, and without it
  // would be waiting for the first hide to know where it is.
  janela.webContents.on("did-finish-load", anunciarEstado)

  // A click on the icon opens the app. It is the gesture everyone tries first,
  // and on Windows and Linux the menu is already on the right button.
  tray.on("click", revelar)

  desenhar()

  return {
    avisar: (aviso) => {
      const { recusa, contar } = entregaDoAviso({
        cofreAberto: cofreAberto(),
        suportado: Notification.isSupported(),
        aFrente: aFrente(),
        contavel: aviso.countable,
      })
      if (recusa) {
        rasto(`recusado ${aviso.id}: ${recusa}`)
        return recusa
      }
      const notificacao = new Notification({
        title: aviso.title,
        body: aviso.body,
        // Silent by design: the app already has its own sounds, and that is where
        // "Busy", volume, and mute live. Two sounds for the same event is the sign of
        // two rules each playing their own thing.
        silent: true,
        // The avatar of who the notice is about (the friend who came online). It comes
        // sanitized: just an embedded small image (`aviso.ts`).
        ...(aviso.icon ? { icon: nativeImage.createFromDataURL(aviso.icon) } : {}),
      })
      /**
       * "Asking" and "showing" are different things, and the difference costs
       * hours.
       *
       * With notifications denied to the app, `show()` returns without error
       * and nothing ever appears, the symptom is indistinguishable from a bug
       * on our side. In development it is the NORMAL case on macOS: the
       * unpackaged Electron binary has no permission, and the system responds
       * `UNErrorDomain error 1`. Packaged and signed, the app asks once and
       * then shows. It gets written to the log so no one has to guess which
       * side the problem is on.
       */
      notificacao.on("show", () => rasto(`o sistema desenhou ${aviso.id}`))
      notificacao.on("failed", (_evento, erro) => rasto(`o sistema recusou desenhar ${aviso.id}: ${erro}`))
      notificacao.on("click", () => {
        revelar()
        // The interface knows what to open: here we only say which notice was clicked,
        // and the destination comes from the channel like any other click.
        janela.webContents.send("event:notice-open", { id: aviso.id, channel: aviso.channel })
      })
      notificacao.show()
      // The friend came online notice closes itself (2 s): it is presence, and does
      // not wait for the person to dismiss it.
      if (aviso.expiraEmMs) setTimeout(() => notificacao.close(), aviso.expiraEmMs)
      if (contar) {
        porLer += 1
        desenhar()
      }
      rasto(`mostrado ${aviso.id} (contado=${aviso.countable}, porLer=${porLer})`)
      return null
    },
    revelar,
    aoTrancar: limparContagem,
    destruir: () => {
      tray.destroy()
    },
  }
}
