/**
 * Sidebar icons, drawn for here.
 *
 * They replace borrowed characters that played the icon role: the `#` for a
 * text channel, the `♪` for a voice one, the `@` for a direct message. The
 * problem was never the hash. It looked improvised: an alphabet playing the
 * interface. These are a family: same 24 grid, same stroke thickness, same
 * rounded ends, same optical size next to the letters they accompany.
 *
 * `currentColor` in all of them, on purpose: a line to read, open or closed,
 * paints the icon with the same rule that paints the name, and there is no
 * variant per state. `color` exists for cases where you want to force it. The
 * live circle of a voice room is the only one that uses it today.
 *
 * They live apart from `icons.tsx`, which is the family for the entire app
 * (app bar, top, buttons). These only make sense inside a channel list and that
 * is where they read against each other.
 */

interface MarcaProps {
  size?: number
  /** By default it inherits the line color. See the comment above. */
  color?: string
}

function Marca({ size = 14, color, children }: MarcaProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/**
 * A text channel: lines written, with the last one incomplete.
 *
 * Not the hamburger menu: that is three equal lines end to end, and the
 * difference is all the irregularity of these. A paragraph has a ragged right
 * edge, a menu does not.
 */
export function TextRoomIcon(props: MarcaProps): React.JSX.Element {
  return (
    <Marca {...props}>
      <path d="M4.5 7h15" />
      <path d="M4.5 12h15" />
      <path d="M4.5 17h9" />
    </Marca>
  )
}

/**
 * A voice channel: a circle.
 *
 * One shape only, filled, against the lines of the text channel: at the
 * distance a sidebar reads, the silhouette tells the two types apart, not the
 * detail. What blinks is the line when people are there. See `.room-live` in
 * the styles. State does not go in here on purpose: the icon inherits color
 * from what holds it, so there is no drawing variant per state.
 */
export function VoiceRoomIcon(props: MarcaProps): React.JSX.Element {
  return (
    <Marca {...props}>
      <circle cx="12" cy="12" r="4.4" fill={props.color ?? "currentColor"} stroke="none" />
    </Marca>
  )
}

/**
 * A ticket room: a sheet with a checkmark.
 *
 * The third silhouette in this family, chosen for that reason: against the
 * loose lines of text and the filled disk of voice, this is a CLOSED shape with
 * a mark inside. At the distance a sidebar reads, the outline tells the three
 * apart, and three different outlines distinguish better than three variations
 * of the same.
 *
 * The checkmark not a question mark: a ticket is something you resolve, and the
 * drawing says the outcome not the complaint. No state inside the icon, by the
 * family rule. The line paints state, and the list already carries open and
 * closed labels where they read as words.
 */
export function TicketRoomIcon(props: MarcaProps): React.JSX.Element {
  return (
    <Marca {...props}>
      <rect x="4.6" y="4.6" width="14.8" height="14.8" rx="3.2" />
      <path d="M8.8 12.2l2.4 2.4 4-4.8" />
    </Marca>
  )
}

/**
 * The icon for a room, decided in one place.
 *
 * The rule lived written twice in the sidebar: once in the live line, once in
 * the list of closed ones. A third room type is exactly what makes two copies
 * diverge: the first would get the new drawing, the second would stay showing
 * closed rooms as text rooms. One function, two callers.
 *
 * **A layout this version does not know draws as text.** It is the same discount
 * that `rolesOf` gives to an unknown permission and that the interface gives to
 * a role color it cannot paint: under the hood, a room with strange layout IS a
 * text room, and that is what the icon must say.
 */
export function RoomGlyph({
  kind,
  layout,
  size = 14,
}: MarcaProps & { kind: "text" | "voice"; layout?: string | undefined }): React.JSX.Element {
  if (kind === "voice") return <VoiceRoomIcon size={size} />
  if (layout === "tickets") return <TicketRoomIcon size={size} />
  return <TextRoomIcon size={size} />
}

/**
 * The fold triangle.
 *
 * One drawing for all three levels that collapse: the channel, the category,
 * and the list of who is in a voice room. CSS rotates it, from the `aria-expanded`
 * of the button that holds it. State is said once, where it also serves those
 * listening to the screen, instead of existing twice.
 */
export function ChevronIcon({ size = 12, color }: MarcaProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 9.5 12 15.5 18 9.5" />
    </svg>
  )
}

/**
 * A crossed bell: muted notifications (owner request, 27 October 2026). Same
 * family as the others: 24 grid, 1.7 stroke, rounded ends. The line crosses
 * the bell corner to corner, like the muted microphone in a call, to read as
 * "off" not as another bell.
 */
export function SinoRiscadoIcon(props: MarcaProps): React.JSX.Element {
  return (
    <Marca {...props}>
      <path d="M6 16.5V11a6 6 0 0 1 9.4-4.9M18 10.5v6l1.5 1.5H4.5L6 16.5" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
      <path d="M4 3.5l16 17" />
    </Marca>
  )
}
