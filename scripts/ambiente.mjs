/**
 * Where scripts will hit, decided in one place.
 *
 * Ten different ports were scattered across thirty scripts, 8448, 8449, 8450,
 * 8452, 8453, 8459, 8461, 8462, 8470, 8471 -, each written by hand the day that
 * script was born. The development server (`dev-reiniciar-servidor.sh`) lives
 * on **8452**, and only it defines `ENCLAVE_COMMON_ROOM`; there is no common room
 * against any other port.
 *
 * The cost was not theoretical. On 13 August 2026, hunting a call defect
 * reported by the owner, `churn-chamada.mjs` was pointed at 8448: the bots
 * created accounts, joined the channel, then waited **three minutes each** for a
 * voice room that did not exist on that server. The conclusion almost drawn was
 * "the product is broken". The product was fine; the script was talking to the
 * wrong house.
 *
 * From now on: `ORWELL_SERVIDOR` in the environment, or 8452. A script that
 * really needs a different port passes it as an argument, and it is written in
 * the script itself why it is different.
 */

/** The development homeserver. `dev-reiniciar-servidor.sh` brings this up. */
export const SERVIDOR = process.env.ORWELL_SERVIDOR ?? "localhost:8452"

/**
 * The application served in development.
 *
 * The `/app/` is part of the address because the homepage took the domain root
 * (`vite.config.ts` in `@enclave/web` declares `base: "/app/"`). Without it, the
 * browser receives the page HTML instead of the bundle and the app never starts,  * the symptom is a sixty-second `waitFor` for the account creation screen, and
 * caught the portrait script before it caught this one.
 */
export const APP = comLingua(process.env.ORWELL_APP ?? "http://127.0.0.1:5173/app/")

/**
 * The language in which a script opens the app, and why it goes in the URL.
 *
 * On 20 August 2026 a the interface started picking its language on its own,
 * based on `navigator.languages`. That is what you want from a product and it is poison for a
 * script: thirty-five of these files search for hand-written PORTUGUESE text,  * `getByText("Criar canal")`, `getByRole("button",
 * { name: "Nova sala" })`, and Playwright's Chromium starts in English. A script would not
 * break: they would all break at once, and no test in the suite would catch it,
 * because the suite does not run scripts.
 *
 * So the language is REQUESTED, not left to chance on the system where the script
 * runs. It goes in the URL and not in a Playwright option on purpose: `locale`
 * in `newContext` would also change `Intl`, dates, times, numbers, and a dozen
 * scripts in this folder measure widths in pixels. Changing the language of the
 * INTERFACE is what you want; changing the formatting underneath it would drag
 * the measurements along with it.
 *
 * A URL that already has `lingua=` stays as is: a script that wants to measure
 * the app in English has every right to do so, as long as it says so.
 */
export function comLingua(endereco, lingua = "pt") {
  try {
    const analisado = new URL(endereco)
    /*
      Only ONE PAGE receives the request, and verification is not ceremonial.

      `new URL("localhost:8452")` does not throw: it accepts it with the scheme
      "localhost:", and what came out was `localhost:8452?lingua=pt`, a broken
      server name, handed to a script that would create accounts against it. A
      server address enters through `alvo()` not here, but the difference between
      the two functions cannot depend on someone remembering it.
    */
    if (analisado.protocol !== "http:" && analisado.protocol !== "https:") return endereco
    if (!analisado.searchParams.has("lingua")) analisado.searchParams.set("lingua", lingua)
    return analisado.toString()
  } catch {
    // Not an absolute address, a file path, or garbage. Return it as is:
    // inventing a scheme for it would silently change the script's target.
    return endereco
  }
}

/**
 * The passphrase for disposable accounts that scripts create.
 *
 * Out of code since the 5 August audit: what was written here was the phrase
 * from a real diagnostic account.
 */
export const FRASE = process.env.ORWELL_DIAG_PASSPHRASE ?? "frase-de-verificacao-2026"

/**
 * A script's target, with production locked down.
 *
 * Nine scripts had `orwell.pt` as the DEFAULT value, you only had to run one
 * without arguments to create accounts in production. Among them `carga-chamada.mjs`,
 * which is a load script, and on 6 August 2026 a load run against production
 * deleted the founding entry the owner had just published. On 13 August it
 * happened again, to me: I ran `e2e-dm.mjs` thinking I was hitting the local
 * server and created two disposable accounts in production.
 *
 * A dangerous default is an accident waiting to happen, and the lesson from it
 * happening twice is that warnings in comments are not enough. Production now
 * requires an explicit statement, in the environment not in an argument, an
 * argument gets copied from an old command line without being read.
 *
 * @param {string | undefined} pedido what came from the command line, if anything
 */
export function alvoApp(pedido) {
  const escolhido = comLingua(pedido ?? APP)
  guardarProducao(escolhido)
  return escolhido
}

/** The same lock, for those who only need it. */
function guardarProducao(escolhido) {
  const anfitriao = escolhido.replace(/^https?:\/\//, "").split("/")[0]
  if (!/(^|\.)orwell\.pt$/.test(anfitriao)) return
  if (process.env.ORWELL_PERMITIR_PRODUCAO === "sim") return
  console.error(`Recusado: ${escolhido} é produção.`)
  console.error("Guiões criam contas, salas e chamadas. Contra produção isso é ruído em cima")
  console.error("de pessoas que estão mesmo a falar, e já apagou dados uma vez.")
  console.error("")
  console.error("Se é mesmo isso que queres:  ORWELL_PERMITIR_PRODUCAO=sim node scripts/<guião>.mjs")
  process.exit(2)
}

export function alvo(pedido) {
  const escolhido = pedido ?? SERVIDOR
  guardarProducao(escolhido)
  return escolhido
}
