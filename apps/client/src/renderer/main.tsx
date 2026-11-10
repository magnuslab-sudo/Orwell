import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App, arrancarLingua } from "@enclave/ui"
import "@enclave/ui/styles.css"
import { createDesktopBridge } from "./bridge.js"

const root = document.getElementById("root")
if (!root) throw new Error("missing #root")

/**
 * The system languages, asked from the main process.
 *
 * Here is the difference between the installed app and the web page, and it is not
 * cosmetic: inside Electron `navigator.languages` returns the locale with which the
 * app STARTED, which on macOS is often just "en-US" with the whole system in
 * Portuguese. The real list is in System Preferences, and whoever reaches it is the
 * main process, with `app.getPreferredSystemLanguages()`.
 *
 * What comes is given raw from another process: it is filtered to strings before
 * giving to whoever decides. Empty, or a version of the host that does not bring this
 * gate, reads as "I don't know", and then `arrancarLingua` falls back to
 * `navigator`, which is the browser answer and better than nothing.
 */
function linguasDoSistema(): readonly string[] | undefined {
  const anfitriao = (window as { enclaveHost?: { lingua?: { doSistema?: () => unknown } } }).enclaveHost
  const respondido = anfitriao?.lingua?.doSistema?.()
  if (!Array.isArray(respondido)) return undefined
  const limpas = respondido.filter((etiqueta): etiqueta is string => typeof etiqueta === "string")
  return limpas.length > 0 ? limpas : undefined
}

// Before `render`: the first draw must go out already in the right language. Changing
// after is legitimate and works, but a startup in Portuguese shifting to English half
// a second later is a flicker that nobody asked for.
document.documentElement.lang = arrancarLingua({ doSistema: linguasDoSistema() })

createRoot(root).render(
  <StrictMode>
    <App bridge={createDesktopBridge()} />
  </StrictMode>,
)
