import { useEffect } from "react"

/**
 * How much the virtual keyboard covers, written in a sheet variable.
 *
 * The app blocks the page from scrolling: `base.css` gives it `overflow: hidden`
 * and `100dvh`, because a chat is a window, not a document. The price is that the
 * usual fix, the page scrolls and the input bar rises with it, does not exist
 * here. With the keyboard open, the input bar ended up below it and there was no
 * gesture to bring it back: you typed blind.
 *
 * Half of this solves itself in `index.html` with `interactive-widget=resizes-content`
 * in the viewport: where the value is known, the page shrinks and the sheet needs
 * to know nothing. Today's iOS does not know it, there the keyboard OVERLAYS, the
 * `visualViewport` shrinks and the layout viewport stays the same size. This is the
 * other half: measure the difference and write it to `--teclado`, which `movel.css`
 * adds to the bottom margin.
 *
 * **Touch only.** On a desktop there is no virtual keyboard, and `visualViewport`
 * moves for other reasons (the zoom bar, for example) that have nothing to do with
 * this.
 *
 * Without `visualViewport`, and some engines lack it, this does nothing, and the
 * variable never gets created: the `var(--teclado, 0px)` in the sheet reads zero,
 * which is exactly the old behavior.
 */
export function useVisualViewport(): void {
  useEffect(() => {
    if (typeof window === "undefined") return
    const janela = window.visualViewport
    if (!janela) return
    // `matchMedia` can be missing (jsdom), and absence reads as desktop.
    if (typeof window.matchMedia !== "function" || !window.matchMedia("(pointer: coarse)").matches) return

    const medir = (): void => {
      /*
        With the page zoomed, this calculation lies, and does not correct itself, it gives up.
        
        Zooming with two fingers shrinks `visualViewport` exactly like a keyboard would:
        at 2x on an 844-pixel screen, `height` gives 422 and the calculation announces
        420 px of keyboard that does not exist. The app opened that entire margin at the
        bottom and the dock rose with it, with your finger zooming.
        
        Zoom IS ACCESSIBILITY and cannot be blocked. What we do is not confuse the
        two things: while the page is zoomed, this measurement has nothing to say, and
        says zero. A keyboard on top of a zoomed page still covers what it covered,         which is the old behavior before this piece, not a new regression.
        */
      if ((janela.scale ?? 1) > 1.01) {
        document.documentElement.style.setProperty("--teclado", "0px")
        return
      }
      /*
        What is covered at the bottom: the window height minus what still shows of it.
        `offsetTop` enters because iOS shifts the `visualViewport` upward when it pushes
        the focused field out of the keyboard, without it, the calculation gave zero
        exactly when it mattered.
      */
      const tapado = window.innerHeight - (janela.height + janela.offsetTop)
      document.documentElement.style.setProperty("--teclado", `${Math.max(0, Math.round(tapado))}px`)
    }

    medir()
    janela.addEventListener("resize", medir)
    janela.addEventListener("scroll", medir)
    return () => {
      janela.removeEventListener("resize", medir)
      janela.removeEventListener("scroll", medir)
      // Exiting without cleaning left the app with a bottom margin the size of a keyboard that no longer exists.
      document.documentElement.style.removeProperty("--teclado")
    }
  }, [])
}
