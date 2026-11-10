import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * What only the mouse revealed, and what was too small for a finger.
 *
 * Two families of bugs that jsdom never catches, because it does not apply CSS,
 * and that on desktop do not show up, because there is a mouse.
 *
 * **Mouse only.** `.fold` (the triangle that collapses a channel) and `.room-reopen`
 * (the text that reopens a closed room) are born at `opacity: 0` and only appear
 * on hover. On mobile there is no hover: collapsing a channel and reopening a room
 * were gestures that simply did not exist.
 *
 * **Too small.** Four targets below the 44px that a finger can hit:
 * `.rail-btn` (40), `.members-toggle` (34), `.people-bar-conversas` (32) and
 * `.fold` (22). The middle two only exist on narrow screens, that is, only where
 * the pointer is a finger: they were made small for the only pointer that reaches them.
 *
 * What matters here is that the fix stays written, and that it stays an EXCEPTION:
 * on desktop the original numbers rule, because the sheet cannot bloat the whole
 * app to solve mobile.
 */
/* The path goes via variable, not literal, as in `movel.test.ts`: Vite rewrites
   `new URL("./x", import.meta.url)` written verbatim to an asset address, and
   `fileURLToPath` was getting an `http://`. */
const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const folha = ler("./screens.css").replace(/\/\*[\s\S]*?\*\//g, "")

/** The body of a rule inside a `@media` with this condition. */
function dentroDe(condicao: string, selector: string): string | null {
  const blocos = [...folha.matchAll(new RegExp(`@media \\(${condicao}\\)\\s*\\{([\\s\\S]*?\\})\\s*\\}`, "g"))]
  for (const bloco of blocos) {
    const corpo = bloco[1] ?? ""
    const regra = new RegExp(`(^|\\})\\s*${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(corpo)
    if (regra) return regra[2] ?? ""
  }
  return null
}

/** The body of the FIRST top-level rule with this selector, which is desktop. */
function noRepouso(selector: string): string {
  const regra = new RegExp(`\\n${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(folha)
  return regra?.[1] ?? ""
}

describe("o que só o rato revelava fica à vista com o dedo", () => {
  it.each([".fold", ".room-reopen"])("%s aparece sempre onde não há hover", (selector) => {
    const corpo = dentroDe("hover: none", selector)
    expect(corpo, `falta a excepção de ${selector} em @media (hover: none)`).not.toBeNull()
    expect(corpo).toMatch(/opacity:\s*1/)
  })

  it.each([".fold", ".room-reopen"])("%s continua invisível em repouso, que é o desenho de secretária", (selector) => {
    expect(noRepouso(selector)).toMatch(/opacity:\s*0\s*;/)
  })
})

describe("os alvos de toque chegam aos 44px, e só com o dedo", () => {
  it.each([
    [".rail-btn", "40px"],
    [".members-toggle", "34px"],
    [".people-bar-conversas", "32px"],
    [".fold", "22px"],
  ])("%s cresce sob pointer: coarse (em secretária era %s)", (selector, original) => {
    const corpo = dentroDe("pointer: coarse", selector)
    expect(corpo, `falta o alvo de 44px para ${selector}`).not.toBeNull()
    expect(corpo).toMatch(/width:\s*44px/)
    // Height or min-height: `.fold` stretches with the row so it needs the latter,
    // and it is the one that forces the whole row to reach 44.
    expect(corpo).toMatch(/(min-)?height:\s*44px/)
    // Desktop stays as it was: the original number is still there.
    expect(noRepouso(selector)).toContain(original)
  })
})

describe("o toque longo não convida a bolha do Safari", () => {
  /*
    Long press on text in iOS makes the system select the word and open its own menu.
    With long tap opening OURS after half a second, both appeared, and the system
    wins. This ties the exception to rows that got long tap, and ties it also to
    fingers only: on desktop selecting a channel name still works.
    */
  const AS_LINHAS = [".channel-row", ".room-row", ".voice-member", ".member-row", ".direct-row", ".person-row"]

  it("as linhas com toque longo calam o callout e a selecção, sob pointer: coarse", () => {
    const bloco = [...folha.matchAll(/@media \(pointer: coarse\)\s*\{([\s\S]*?\})\s*\}/g)]
      .map((m) => m[1] ?? "")
      .find((corpo) => corpo.includes("-webkit-touch-callout"))
    expect(bloco, "falta a excepção do callout em screens.css").toBeDefined()
    for (const selector of AS_LINHAS) {
      expect(bloco, `${selector} ficou de fora`).toContain(selector)
    }
    expect(bloco).toMatch(/-webkit-touch-callout:\s*none/)
    expect(bloco).toMatch(/user-select:\s*none/)
  })

  it("e fora do dedo ninguém perde a selecção", () => {
    // Without the `pointer: coarse` block, none of these rows change the callout.
    const semOBloco = folha.replace(/@media \(pointer: coarse\)\s*\{[\s\S]*?-webkit-touch-callout[\s\S]*?\}\s*\}/, "")
    expect(semOBloco).not.toMatch(/-webkit-touch-callout/)
  })
})

describe("o teclado virtual não tapa a barra de escrita", () => {
  /*
    The other half lives in `movel.css`, where the notch margin is already
    there: here we ensure the sheet really adds `--teclado` to the bottom margin,
    and that the dock rises with it. What jsdom can never prove (a keyboard
    opening) is in the mobile script; what we catch here is the rule disappearing.
  */
  const movel = ler("./movel.css").replace(/\/\*[\s\S]*?\*\//g, "")

  it("a raiz da aplicação e a do portão abrem espaço por baixo, sob pointer: coarse", () => {
    const bloco = [...movel.matchAll(/@media \(pointer: coarse\)\s*\{([\s\S]*?\})\s*\}/g)]
      .map((m) => m[1] ?? "")
      .find((corpo) => corpo.includes("padding-bottom"))
    expect(bloco, "falta a regra do teclado em movel.css").toBeDefined()
    expect(bloco).toMatch(/\.app,\s*\.gate\s*\{/)
    expect(bloco).toMatch(/padding-bottom:\s*calc\(var\(--seguro-fundo\) \+ var\(--teclado, 0px\)\)/)
  })

  it("e a doca da chamada sobe pelo PÉ, e nunca por transform", () => {
    // `translateY` would only be safe with the dock in its factory corner. It
    // drags, and whoever drags it leaves it with `bottom: auto`, in that state
    // `translateY` subtracted from the chosen position and sent it off screen.
    // By design, the dragged case rules itself out.
    expect(movel).toMatch(/\.call-dock\s*\{\s*bottom:\s*calc\(var\(--space-5\) \+ var\(--seguro-fundo\) \+ var\(--teclado, 0px\)\)/)
    expect(movel).not.toMatch(/translateY\(calc\(-1 \* var\(--teclado/)
  })

  it("e as folhas modais abrem espaço por baixo, que é o que o iOS precisa", () => {
    // The `interactive-widget` serves Android on all screens; iOS does not know
    // it, and without this a sheet with a field would sit half below the keyboard,
    // with the confirm button out of reach.
    const bloco = [...movel.matchAll(/@media \(pointer: coarse\)\s*\{([\s\S]*?\})\s*\}/g)]
      .map((m) => m[1] ?? "")
      .find((corpo) => corpo.includes(".overlay"))
    expect(bloco, "falta a regra do teclado para as folhas em movel.css").toBeDefined()
    expect(bloco).toMatch(/\.overlay\s*\{\s*padding-bottom:\s*calc\(var\(--seguro-fundo\) \+ var\(--teclado, 0px\)\)/)
  })
})

/*
  The volume bar in the call menu (owner request on November 2, 2026).
  With a finger, the cursor and the button that resets to 100% must have 44 px
  of usable height, and horizontal drag must not scroll the page.
*/
describe("a barra do volume no menu chega ao dedo", () => {
  const menus = ler("./overlays.css").replace(/\/\*[\s\S]*?\*\//g, "")
  const grosso = /@media \(pointer: coarse\)\s*\{([\s\S]*?\})\s*\}/g
  const blocos = [...menus.matchAll(grosso)].map((bloco) => bloco[1] ?? "").join("\n")

  it("o cursor tem 44px de altura com o dedo", () => {
    expect(blocos).toMatch(/\.menu-deslizante input\[type="range"\]\s*\{[^}]*height:\s*44px/)
  })

  it('o botão "100 %" também', () => {
    expect(blocos).toMatch(/\.menu-deslizante-repor\s*\{[^}]*min-height:\s*44px/)
  })

  it("arrastar o cursor não rola a página", () => {
    expect(menus).toMatch(/\.menu-deslizante input\[type="range"\]\s*\{[^}]*touch-action:\s*none/)
  })
})

/*
  A YouTube video thumbnail (November 2, 2026). With reduced motion the play
  button still grows on hover, more slowly, and does not stop.
*/
describe("a miniatura do vídeo com movimento reduzido", () => {
  const reduzido = [...folha.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?\})\s*\}/g)]
    .map((bloco) => bloco[1] ?? "")
    .find((corpo) => corpo.includes(".facade-play"))

  it('o "play" continua a mexer, mais devagar', () => {
    expect(reduzido, "falta o bloco de movimento reduzido da miniatura").toBeDefined()
    expect(reduzido).not.toMatch(/transition:\s*none/)
    expect(reduzido).not.toMatch(/transform:\s*none/)
    expect(reduzido).toMatch(/\.facade-play\s*\{[^}]*transition-duration:\s*calc\(var\(--dur-fast\) \* 3\)/)
  })

  it("e o leitor embebido já não tem estilo: saiu", () => {
    expect(folha).not.toMatch(/\.facade-player/)
  })
})
