import { ROLE_COLOURS, type RoleColour } from "@enclave/protocol"
import type { CSSProperties } from "react"
import type { ChannelRole } from "../bridge.js"

/**
 * What pixel each role color draws, and why that one.
 *
 * The protocol publishes the NAME of the color; the values live here. This split
 * makes readability verifiable: whoever picks "Mint" knows nothing about what
 * background the text lands on, and the interface does. It knows the same label
 * appears in an 11px subline over `--bg-side` and in a card over `--bg-raised`.
 * With the value loose in the payload, every new role was a bet. With the table
 * here, you measure once and it stays measured.
 *
 * **Measured against the lightest surface in the product, not the one that
 * happens.** `--bg-hover` (#2f3138) is the lightest in the tokens sheet, so
 * whoever passes there passes everywhere else. WCAG contrast, the same numbers
 * that the test beside recalculates every run:
 *
 * | color      | value   | worst (over --bg-hover) |
 * |------------|---------|-------------------------|
 * | Red        | #ff6b6b | 5.62:1                  |
 * | Fuchsia    | #f472b6 | 5.89:1                  |
 * | Blue       | #60a5fa | 6.13:1                  |
 * | Violet     | #b794ff | 6.46:1                  |
 * | Pink       | #ff7eb3 | 6.60:1                  |
 * | Lilac      | #b9a7ff | 7.45:1                  |
 * | Coral      | #ff9a76 | 7.53:1                  |
 * | Orange     | #ff9f43 | 7.64:1                  |
 * | Emerald    | #2dd4bf | 8.38:1                  |
 * | Green      | #4ade80 | 8.95:1                  |
 * | Sky        | #7cd0ff | 9.15:1                  |
 * | Turquoise  | #4fe3dc | 9.92:1                  |
 * | Amber      | #ffc857 | 10.14:1                 |
 * | Mint       | #5cf0a8 | 10.76:1                 |
 * | Yellow     | #ffd93d | 11.32:1                 |
 * | Lime       | #c6f06a | 11.94:1                 |
 *
 * Sixteen, not eight, and all more vivid, from October 27, 2026 onward (owner
 * request: "role color with more tones, more vivid"). The original eight values
 * increased in saturation without losing contrast; the eight new ones are the
 * missing tones on the wheel. Measured over midnight skin.
 *
 * The worst is Red at 5.62:1 over the lightest surface. AA minimum for text is
 * 4.5:1, and the subline is the worst place this product has to put color: 11px,
 * meant to be faint. The margin is intentional. At 4.27:1 the "Muted" state
 * background had to be rebuilt, and we do not cross that line again for the sake
 * of a tone.
 *
 * **Deliberately not the `ACCENTS`.** They look similar, not the same values:
 * the accent is a local preference of who is looking, the role color is published
 * data everyone sees alike. Sharing the table would tie the two together, and one
 * day someone would tweak an accent and repaint, unknowingly, roles in other
 * channels.
 */
export const ROLE_COLOUR_HEX: Record<RoleColour, string> = {
  rosa: "#ff7eb3",
  coral: "#ff9a76",
  ambar: "#ffc857",
  lima: "#c6f06a",
  menta: "#5cf0a8",
  turquesa: "#4fe3dc",
  ceu: "#7cd0ff",
  lilas: "#b9a7ff",
  vermelho: "#ff6b6b",
  laranja: "#ff9f43",
  amarelo: "#ffd93d",
  verde: "#4ade80",
  esmeralda: "#2dd4bf",
  azul: "#60a5fa",
  violeta: "#b794ff",
  fucsia: "#f472b6",
}

/** The order in which colors are offered: the wheel order, so they are easy to find. */
export const ROLE_COLOUR_ORDER: readonly RoleColour[] = [
  "vermelho",
  "rosa",
  "fucsia",
  "coral",
  "laranja",
  "ambar",
  "amarelo",
  "lima",
  "verde",
  "menta",
  "esmeralda",
  "turquesa",
  "ceu",
  "azul",
  "lilas",
  "violeta",
]

/**
 * The value of a role color, if it is one this version knows.
 *
 * `undefined` for everything else. No color, never black or transparent. A role
 * with no color is the normal case, not a role missing something.
 */
export function hexDaCor(colour: string | undefined): string | undefined {
  if (!colour) return undefined
  return ROLE_COLOUR_HEX[colour as RoleColour]
}

/**
 * Which color wins when someone has multiple roles.
 *
 * **The first role in channel order that HAS a color.** Channel order is what
 * `rolesOf` already returns: `position` ascending, name as tiebreaker. Same order
 * you read in the role editor, top to bottom. We do not invent a second hierarchy
 * here. Discord does the same with their list backwards, and what matters is not
 * the direction, only that there is one order. Two diverging rules would disagree
 * the day someone dragged a role.
 *
 * **The one with color, not the first one period.** Skipping roles with no color
 * is what prevents giving someone a new role with no color from silently erasing
 * the color they already had. The effect would be a label changing appearance
 * because of a gesture that said nothing about color.
 *
 * Color is never the only information: what it paints is the role name, written
 * right there beside it and still there if no one sees the color.
 */
/**
 * The `style` that delivers the color to CSS, nothing else.
 *
 * A variable (`--role-tint`), not `color` inline, because it is the variable that
 * lets the style sheet write the fallback: `color: var(--role-tint,
 * var(--accent))`. No color, the `style` does not exist at all and the rule
 * falls back to the accent. That is exactly what the label was before colors
 * existed. Painting `color` inline would force the interface to know the "no
 * color" value, and the right answer is it should not know.
 *
 * The template is a custom property, which React types do not index.
 */
export function tintaDoPapel(hex: string | undefined): CSSProperties | undefined {
  return hex ? ({ "--role-tint": hex } as CSSProperties) : undefined
}

export function corDosPapeis(declarados: readonly ChannelRole[], seus: readonly string[]): string | undefined {
  const tem = new Set(seus)
  for (const papel of declarados) {
    if (!tem.has(papel.role)) continue
    const hex = hexDaCor(papel.colour)
    if (hex) return hex
  }
  return undefined
}
