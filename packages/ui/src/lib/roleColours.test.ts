import { ROLE_COLOURS } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import type { ChannelRole } from "../bridge.js"
import { corDosPapeis, hexDaCor, ROLE_COLOUR_HEX } from "./roleColours.js"

/* --------------------------------------------------------------- contraste */
//
// Same math as `usePrefs.test.ts`, and intentionally: it is the WCAG definition,
// not a house method, and two versions of it would eventually disagree on the
// number. Here we measure the palette of roles.

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const linear = (channel: number): number => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const value = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * linear((value >> 16) & 255) + 0.7152 * linear((value >> 8) & 255) + 0.0722 * linear(value & 255)
}

function contrast(a: string, b: string): number {
  const first = luminance(a)
  const second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/**
 * The surfaces in `tokens.css` where a role color can land, from darkest to
 * lightest. Change them there, change them here too. That is the point: lightening
 * a background is a gesture that must pass this test.
 */
const SUPERFICIES = {
  "--bg-side": "#0c1123",
  "--bg-main": "#0b1020",
  "--bg-raised": "#131a33",
  "--bg-hover": "#192241",
}

describe("contraste da paleta dos papéis", () => {
  // A hand-picked color can become unreadable over a dark background, and the
  // people panel subline is the worst place this product has to put color: 11px
  // and meant to be faint. The palette is closed precisely so this number exists
  // and can be locked in.
  it.each(ROLE_COLOURS.map((cor) => [cor, ROLE_COLOUR_HEX[cor]] as const))(
    "%s passa AA (4,5:1) sobre todas as superfícies onde pode cair",
    (_cor, hex) => {
      for (const fundo of Object.values(SUPERFICIES)) {
        expect(contrast(hex, fundo)).toBeGreaterThanOrEqual(4.5)
      }
    },
  )

  it("pintar a sub-linha nunca a torna menos legível do que era por pintar", () => {
    /*
      The subline with no role is `--text-faint` over `--bg-side`: 6.02:1. A role
      color below that traded information for decoration. The label would read
      WORSE than the address it replaced, and the role is what you look for in a
      people list.

      The measure is readability, not hue difference. WCAG ratio compares
      luminances: two opposite hues with the same luminance give close to 1:1
      without anyone confusing them. Asking "difference" of this number was asking
      it what it cannot answer.
    */
    const faintNoPainel = contrast("#8591b8", SUPERFICIES["--bg-side"])
    for (const cor of ROLE_COLOURS) {
      expect(contrast(ROLE_COLOUR_HEX[cor], SUPERFICIES["--bg-side"])).toBeGreaterThanOrEqual(faintNoPainel)
    }
  })

  it("a tabela tem uma entrada por cor declarada, e nem uma a mais", () => {
    // A color in the protocol with no value here meant a role with no color, and no
    // one knew why. A value here with no color in the protocol meant a color you
    // could not publish.
    expect(Object.keys(ROLE_COLOUR_HEX).sort()).toEqual([...ROLE_COLOURS].sort())
  })
})

describe("a cor que manda quando alguém tem vários papéis", () => {
  const papel = (role: string, colour?: string): ChannelRole => ({
    role,
    name: role,
    powers: [],
    ...(colour ? { colour } : {}),
  })

  it("manda o primeiro papel pela ordem do canal", () => {
    // `declared` arrives sorted by `rolesOf`. The order the person received roles is
    // irrelevant. It used to matter: two people with the same two roles appeared in
    // different colors.
    const declarados = [papel("guarda", "menta"), papel("veterano", "coral")]
    expect(corDosPapeis(declarados, ["veterano", "guarda"])).toBe(ROLE_COLOUR_HEX.menta)
    expect(corDosPapeis(declarados, ["guarda", "veterano"])).toBe(ROLE_COLOUR_HEX.menta)
  })

  it("um papel sem cor não apaga a cor de outro que a pessoa também tenha", () => {
    const declarados = [papel("convidado"), papel("guarda", "menta")]
    expect(corDosPapeis(declarados, ["convidado", "guarda"])).toBe(ROLE_COLOUR_HEX.menta)
  })

  it("sem cor nenhuma é ausência, e não uma cor por omissão", () => {
    const declarados = [papel("convidado"), papel("guarda")]
    expect(corDosPapeis(declarados, ["convidado", "guarda"])).toBeUndefined()
    expect(corDosPapeis(declarados, [])).toBeUndefined()
  })

  it("um papel que a pessoa não tem não lhe dá a cor", () => {
    const declarados = [papel("chefe", "coral"), papel("guarda", "menta")]
    expect(corDosPapeis(declarados, ["guarda"])).toBe(ROLE_COLOUR_HEX.menta)
  })

  it("uma cor que esta versão não conhece lê-se como ausência de cor", () => {
    // Comes from a newer client. Does not render, does not break, and the next role,
    // the known one, is what gives the color.
    const declarados = [papel("chefe", "cobalto"), papel("guarda", "menta")]
    expect(hexDaCor("cobalto")).toBeUndefined()
    expect(corDosPapeis(declarados, ["chefe", "guarda"])).toBe(ROLE_COLOUR_HEX.menta)
  })
})
