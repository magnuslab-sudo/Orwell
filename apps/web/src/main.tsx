import { mostrarFaixa } from "./faixa.js"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App, arrancarLingua, OutroSeparador, Splash, strings, tocarSomDeActualizacao } from "@enclave/ui"
import "@enclave/ui/styles.css"
import { createBrowserBridge, ouvirBloqueios, type PonteDoBrowser } from "./bridge.js"
import { armazenamentoDoSeparador, lerAmigoDeArranque, lerConviteDeArranque, lerEmparelhamentoDeArranque } from "./convite-arranque.js"
import { capacidadesDoBrowser, criarPosse, type EstadoDaPosse } from "./posse-do-separador.js"
import { DB_NAME, type MotivoDaPerda } from "./vault-backend.js"
import { versaoMudou, watchForNewVersion } from "./version-watch.js"

/*
  The invite, BEFORE everything else: before `#root`, language, the bridge and any
  `await`. An invite link carries a secret in the fragment after the `#`, and every
  moment it sits in the address bar is a moment it can end up in history and tab sync.
  Reading and clearing it is the first thing this page does. See `convite-arranque.ts`.
  */
const conviteDeArranque = lerConviteDeArranque({
  location: window.location,
  history: window.history,
  storage: armazenamentoDoSeparador(),
  base: import.meta.env.BASE_URL,
})
// And the pairing link, by the same path and for the same reason: a secret
// in the fragment, read and cleared before anything else.
const emparelhamentoDeArranque = lerEmparelhamentoDeArranque({
  location: window.location,
  history: window.history,
  storage: armazenamentoDoSeparador(),
  base: import.meta.env.BASE_URL,
})
// And the friend link, by the same three steps: read, clear, store in the tab.
const amigoDeArranque = lerAmigoDeArranque({
  location: window.location,
  history: window.history,
  storage: armazenamentoDoSeparador(),
  base: import.meta.env.BASE_URL,
})

const root = document.getElementById("root")
if (!root) throw new Error("missing #root")

/*
  The language, decided before there is a screen.

  Here and not inside `@enclave/ui`: running detection at module load caught
  also the jsdom in tests, where `navigator` says "en-US", and ran
  two thousand seven hundred assertions written for Portuguese text
  against English. The package defaults to Portuguese; detection is the job of whoever
  has a browser in front, which is this file.

  Before `render` because the first frame has to come out right: changing the
  language afterwards is fine and works, but a startup screen in Portuguese
  turning to English half a second later is a flicker nobody asked for.

  The `<html lang>` goes next, and it is not decoration: it is how a screen reader
  chooses its voice, and it tells the browser what language the page it offered
  to translate is in.
*/
document.documentElement.lang = arrancarLingua()

/*
  The bridge is born only in the tab that owns the account.
  
  Creating it no longer opens the vault, but the `App` that receives it does: the
  gate reads the IndexedDB and connects to the server. A waiting tab cannot do either,
  so neither the bridge nor the `App` exist while it waits. See `posse-do-separador.ts`.
  */
let bridge: PonteDoBrowser | null = null
/** The tab noticed the new version: it does not take over the account, even if offered. */
let versaoVelha = false
/** It was waiting for another tab. It could be open for hours, running old code. */
let esperou = false

/*
  The Service Worker, which exists for one thing only: notifications on Android, where
  Chrome does not let a page create a system notification on its own. It does not
  intercept requests or cache code (`public/sw.js` explains why, and
  `pwa.test.ts` locks it down), so `watchForNewVersion` below keeps seeing the
  real `index.html`.

  Production only: on the dev server a registration survived the session and
  stayed attached to `127.0.0.1:5173` for the next project. `updateViaCache:
  "none"` tells the browser to always fetch the script from the network. Fails silently:
  without a Service Worker the app works fully, it just does not notify on Android.
*/
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: "none" })
    .catch(() => {})
}

// The new version banner and the old tab writing: see `faixa.ts`.

/*
  A new build does not reach an already open tab. Two different versions fail to
  negotiate with each other (calls included), and an old version WRITING breaks the
  state of others: on October 18, 2026 an old tab published commits in past epochs
  and broke the common room.

  So the old tab stops writing the moment it notices the new version: it releases
  ownership (disconnects, saves what it had, seals the vault) and goes read-only.
  Reloading is up to the user, and the banner tells them. The text comes from the
  catalog, short and direct, at the request of the owner (October 19, 2026).
*/
function bloquearPorVersao(): void {
  if (versaoVelha) return
  versaoVelha = true
  mostrarFaixa(
    strings.actualizacao.webTexto,
    { rotulo: strings.actualizacao.webRecarregar, aoCarregar: () => window.location.reload() },
    strings.actualizacao.webDetalhe,
  )
  // The "Update available" sound, following the rules of the other sounds
  // (Busy, Away, the pause). Once: `versaoVelha` does not allow repeats.
  tocarSomDeActualizacao()
  void posse.largar()
}

const raiz = createRoot(root)
/*
  The startup screen, now. Until the tab lock decides ("undecided"), and
  until the ownership record and version check answer, the root stayed
  empty: a background with nothing, then the gate splash appearing. Now the
  first frame is the splash from `index.html` (`abertura-no-html.ts`), this one
  takes its place at the same point in the cycle, and the gate replaces it with the same.
*/
raiz.render(<Splash />)

/** The lock name and the account channel: one vault, one owner. */
const NOME_DA_CONTA = `orwell:conta:${DB_NAME}`

const posse = criarPosse({
  nome: NOME_DA_CONTA,
  ...capacidadesDoBrowser(),
  pararDeEscrever: (modo) => bridge?.pararDeEscrever(modo) ?? Promise.resolve(),
})

// "Lock now" in another tab erases the key from this tab's cache. See `avisarBloqueio`.
ouvirBloqueios(NOME_DA_CONTA)

/*
  The vault refused a write from this tab. It stops without saving in both cases:
  someone else is already writing, and saving now would overwrite.

  - `outro-dono`: the record is from another tab. This happens to an owner that was
    frozen and had ownership taken by force. It reloads, like one who gave way.
  - `outro-escritor`: a tab running code from BEFORE this version wrote
    the vault underneath. That tab does not know the lock and will keep writing, so
    reloading does not fix it: tell the user to close it.
*/
let avisouOutroEscritor = false
function perdeuAFicha(motivo: MotivoDaPerda): void {
  const parado = bridge?.pararDeEscrever({ gravar: false }) ?? Promise.resolve()
  if (motivo === "outro-dono") {
    void parado.then(() => window.location.reload())
    return
  }
  if (avisouOutroEscritor) return
  avisouOutroEscritor = true
  void parado.then(() =>
    mostrarFaixa(strings.separadores.outroEscritor, {
      rotulo: strings.actualizacao.webRecarregar,
      aoCarregar: () => window.location.reload(),
    }),
  )
}

/**
 * The IndexedDB refused the ownership record. Without a record the app does not open:
 * opening would be writing with no defense against another tab. The screen is the same
 * one the gate shows when storage fails (`GateError`), with "Try again". Written here
 * because `GateError` does not leave the UI package.
 */
function mostrarFalhaDaFicha(tentarOutraVez: () => void): void {
  raiz.render(
    <div className="gate">
      <div className="gate-card">
        <p className="gate-lead">{strings.errors.boot}</p>
        <button type="button" className="primary" onClick={tentarOutraVez}>
          {strings.common.retry}
        </button>
      </div>
    </div>,
  )
}

function desenharAplicacao(ponte: PonteDoBrowser): void {
  raiz.render(
    <StrictMode>
      <App
        bridge={ponte}
        startupInvite={conviteDeArranque}
        startupPairing={emparelhamentoDeArranque}
        startupFriend={amigoDeArranque}
      />
    </StrictMode>,
  )
}

function abrirAplicacao(via: "trinco" | "difusao" | "nenhuma"): void {
  if (versaoVelha) return
  const nova = !bridge
  bridge ??= createBrowserBridge({ aoPerderPosse: perdeuAFicha, canalDaConta: NOME_DA_CONTA })
  const ponte = bridge
  if (!nova || via === "nenhuma") {
    desenharAplicacao(ponte)
    return
  }
  /*
    The ownership record BEFORE the gate reads the vault. It is what stops writes
    from an old owner that wakes up after this, and from a tab running old code.
    Without it there is never a write: a refusal shows the failure and lets you try again.
    */
  const tentar = (): void => {
    void ponte.assumirPosse(posse.id).then(
      () => desenharAplicacao(ponte),
      () => mostrarFalhaDaFicha(tentar),
    )
  }
  tentar()
}

/*
  A tab that waited may be running old code: ask before opening the vault. With
  `then` not `await`: `convite-arranque.test.ts` reads this file and forbids
  any `await`, so nothing gets ahead of reading the invite.
*/
function arrancarComoDono(via: "trinco" | "difusao" | "nenhuma"): void {
  if (!esperou || bridge) {
    abrirAplicacao(via)
    return
  }
  void versaoMudou().then((mudou) => (mudou ? bloquearPorVersao() : abrirAplicacao(via)))
}

function desenhar(estado: EstadoDaPosse): void {
  switch (estado.t) {
    case "dono":
      arrancarComoDono(estado.via)
      if (estado.via === "nenhuma") mostrarFaixa(strings.separadores.semProteccao)
      return
    case "espera":
      esperou = true
      raiz.render(
        <OutroSeparador
          aPedir={estado.aPedir}
          semResposta={estado.semResposta}
          temConvite={Boolean(conviteDeArranque.invite)}
          temEmparelhamento={Boolean(emparelhamentoDeArranque.link)}
          // Old, the tab does not take over: the button reloads, which brings the new code.
          onUsar={() => (versaoVelha ? window.location.reload() : posse.pedir())}
          onForcar={() => (versaoVelha ? window.location.reload() : posse.pedir({ forcar: true }))}
        />,
      )
      return
    case "cedido":
      /*
        Another tab took over. This one already stopped writing, and its memory is
        a copy that will age: it reloads. On return, the page joins the lock queue
        and shows the screen of the other tab. This tab's vault and key (`sessionStorage`)
        stay: if the other closes, this one takes over without asking for the password again.
        */
      window.location.reload()
      return
    case "a-decidir":
    case "largado":
      // Undecided lasts less than half a second. Hung keeps what is on screen.
      return
  }
}

posse.aoMudar(desenhar)
/*
  Leaving for the navigation cache (`persisted`) the page does not die: it releases
  ownership for good, like an old version, so another tab can take over. On return,
  the `pageshow` below reloads.
*/
window.addEventListener("pagehide", (evento) => {
  if (evento.persisted) void posse.largar()
  else posse.fechar()
})
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return
  /*
    iOS can fire `pagehide` with `persisted` (which releases ownership) and then
    never fire the `pageshow` that would reload. The page comes back to view with
    no owner and no queue. If it was not the old version that released it, reload.
  */
  if (posse.estado.t === "largado" && !versaoVelha) {
    window.location.reload()
    return
  }
  posse.ficouVisivel()
})
/*
  A page that comes back from the navigation cache (back button) comes back with the
  ownership from before, which by then may belong to another tab. Reloading asks
  the question again, from the start.
*/
window.addEventListener("pageshow", (evento) => {
  if (evento.persisted) window.location.reload()
})

watchForNewVersion(bloquearPorVersao)
