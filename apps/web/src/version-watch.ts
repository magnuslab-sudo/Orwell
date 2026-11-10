/**
 * Warn when the server started serving a different version than this.
 *
 * Why it exists: a tab left open keeps running the JavaScript it downloaded,
 * forever. After a release, two people can end up on different versions with
 * nothing on screen to say so, and the one who loses is the negotiation between
 * them, which fails in silence. It happened live: a call that would not connect
 * because one side ran code from an hour before, with seven distinct bundles
 * requested from the server in that same hour.
 *
 * How it knows: it compares its own module name with what the server's
 * `index.html` now tells to load. The name carries the content hash, so it
 * changes exactly when the code changes, and the server does not need to
 * declare a version or coordinate anything on deploy.
 *
 * What it does: it warns, and whoever calls it stops writing (`main.tsx`). It
 * never reloads by itself, because reloading under someone who is writing, or
 * mid-call, is worse than running old. But to keep WRITING with it is worse
 * still: on October 18, 2026 an old tab published commits to past times and
 * broke the shared room. Since October 20, a tab that sees the new version is
 * read-only until it reloads.
 */

const INTERVALO_MS = 3 * 60_000

function meuBundle(): string | null {
  try {
    const nome = new URL(import.meta.url).pathname.split("/").pop()
    return nome && nome.startsWith("index-") ? nome : null
  } catch {
    return null
  }
}

async function bundleDoServidor(): Promise<string | null> {
  try {
    /*
      `BASE_URL` and not `"/"`.

      The root now serves the public page, which has no JavaScript at all:
      looking for `index-*.js` there finds nothing and the warning goes silent
      forever, which is exactly the failure this file exists to prevent. Tabs
      already open before this change stay deaf the same way, and there is no
      fix from this side; it is one reason the change goes in the restart
      window, where everyone reloads.
    */
    const html = await fetch(import.meta.env.BASE_URL, { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""))
    return html.match(/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null
  } catch {
    // Offline, or the server restarting. Not news; try again later.
    return null
  }
}

/** The sources of the comparison, for tests to swap them. */
export interface FontesDaVersao {
  meu: () => string | null
  doServidor: () => Promise<string | null>
}

const FONTES_REAIS: FontesDaVersao = { meu: meuBundle, doServidor: bundleDoServidor }

/**
 * One question only: is the server already serving different code?
 *
 * `true` only when known for sure. With no answer (offline, development) it is
 * `false`: blocking writes over a doubt would leave the app stuck whenever the
 * network fails.
 *
 * `main.tsx` asks it also when a standby tab becomes owner. That tab could have
 * been open for hours, and that is exactly what cannot claim the vault with old
 * code.
 */
export async function versaoMudou(fontes: FontesDaVersao = FONTES_REAIS): Promise<boolean> {
  const meu = fontes.meu()
  if (!meu) return false
  const servidor = await fontes.doServidor()
  return Boolean(servidor && servidor !== meu)
}

/**
 * @param aoDetectar called once, when the server version differs.
 */
export function watchForNewVersion(aoDetectar: () => void, fontes: FontesDaVersao = FONTES_REAIS): () => void {
  // In development the module is not a bundle with a hash: there is nothing to compare.
  if (!fontes.meu()) return () => {}

  let parado = false
  const verificar = async (): Promise<void> => {
    if (parado) return
    if (!(await versaoMudou(fontes))) return
    if (parado) return
    parado = true
    aoDetectar()
  }

  const timer = setInterval(() => void verificar(), INTERVALO_MS)
  // A check when returning to the tab catches the common case: the user was away,
  // content was published in the meantime, and they come back to try again.
  const aoFocar = (): void => void verificar()
  window.addEventListener("focus", aoFocar)

  return () => {
    parado = true
    clearInterval(timer)
    window.removeEventListener("focus", aoFocar)
  }
}
