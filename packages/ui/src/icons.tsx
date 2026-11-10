/**
 * Icons, drawn inline.
 *
 * Not an icon font and not a sprite sheet: both are extra bytes over the network
 * for an app whose renderer is forbidden from making network requests at all.
 * These are a dozen paths and they inherit `currentColor`, so themes just work.
 */

import { useId } from "react"
import { LIMIAR_MARCA_CHEIA, MARCA_CHEIA, MARCA_COMPACTA } from "./marca.gen.js"

type IconProps = { size?: number }

function Svg({ size = 20, children }: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
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
 * A filled icon with the "disconnected" bar cutting a path.
 *
 * The call icons are filled (owner, October 28, 2026: "I want the icons filled,
 * I don't want them empty inside"), like the call marker in the home grid
 * (`MarcaDeChamada`). In a stroke drawing the bar would cross the lines and
 * show; in a filled drawing it would match the form color and vanish. So the
 * form is clipped by a mask along the bar, wider than the bar itself, and the
 * bar draws on top. The mask's `id` comes from `useId`, so two icons on the
 * same page don't share a mask with each other.
 */
function Riscado({ risco, children }: { risco: string | null; children: React.ReactNode }): React.JSX.Element {
  const mascara = `risco-${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  if (!risco) return <>{children}</>
  return (
    <>
      <mask id={mascara} maskUnits="userSpaceOnUse" x={0} y={0} width={24} height={24}>
        <rect width={24} height={24} fill="#fff" />
        <path d={risco} stroke="#000" strokeWidth={5} strokeLinecap="round" />
      </mask>
      <g mask={`url(#${mascara})`}>{children}</g>
      <path d={risco} stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
    </>
  )
}

/** Conversations. A speech bubble, the least ambiguous shape there is. */
export function ChatIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M20 12a7.5 7.5 0 0 1-7.5 7.5H8l-4 3v-3.6A7.5 7.5 0 0 1 12.5 4.5 7.5 7.5 0 0 1 20 12Z" />
    </Svg>
  )
}

/**
 * The feed: entries, one under the other.
 *
 * It was a people group until August 20, 2026, and the written reason was good:
 * the section was called "Social" and these were the people you follow. The
 * destination next to it became **Friends**, and from then on a people group in
 * the rail names the wrong neighbor, people is what Friends is. The group
 * design moved there (see `FriendsIcon`) and this one kept what its name always
 * said.
 *
 * The photo stack stays set aside, and for the usual reason: it says "gallery",
 * and a gallery is an album you keep. What is here is the form of a post, who
 * wrote it on the left, what they wrote on the right, repeated twice, which is
 * the form of a feed, not an album. The human element that the old note defended
 * is not lost: it is in the two circles.
 *
 * Two entries, not three, and lines of different lengths. At 20 pixels in the
 * rail, it is the silhouette that sets this apart from the rest, and there are
 * two neighbors to set it apart from: the `MenuIcon`, which at 390px draws three
 * buttons above, and the `TextRoomIcon` in the next column. Both are straight
 * lines all the same; the circles and the ragged right margin are what is not
 * here.
 */
export function FeedIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="6.3" cy="8.2" r="2.7" />
      <path d="M12 8.2h8.4" />
      <circle cx="6.3" cy="16.6" r="2.7" />
      <path d="M12 16.6h5.6" />
    </Svg>
  )
}

export function PlusIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

/**
 * The close cross.
 *
 * Close, don't delete, and that is why it is a cross, not a trash can. In the
 * direct message list it removes the line from view and nothing else: the
 * history stays in the vault and the conversation comes back when a message
 * arrives. A trash can promised destruction, and promising destruction where
 * there is tidying scares people the opposite way of what the thing does.
 */
export function CloseIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  )
}

/** The count of a text channel. Drawn, to match the others. */
export function HashIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" />
      <line x1="16" y1="3" x2="14" y2="21" />
    </Svg>
  )
}

/** Speaker: a voice channel. Distinct from the microphone on purpose, the
 *  microphone is what you plug in, this is where you speak. */
export function SpeakerIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </Svg>
  )
}

export function MicIcon({ off, ...props }: IconProps & { off?: boolean }): React.JSX.Element {
  return (
    <Svg {...props}>
      <Riscado risco={off ? "M4 3l16 18" : null}>
        {/* The full capsule; the arc and stem stay as strokes, like in the grid marker. */}
        <rect x="9" y="2.5" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
        <path d="M12 17.5V21" />
      </Riscado>
    </Svg>
  )
}

/**
 * Headphones: the sound that arrives, and turning it off.
 *
 * Distinct from `SpeakerIcon` on purpose, and the distinction is the usual one
 * in this family, the speaker is the PLACE where you speak (a voice room),
 * these are what THIS person hears. Two drawings because they are two things: a
 * speaker doing both would force you to guess which one was saying what.
 *
 * The `off` bar is the same idea as the microphone and camera, same diagonal,
 * same thickness, same endpoints, but measured for this shape, not copied from
 * there. The corner-to-corner diagonal works on the microphone because the
 * microphone is narrow and centered; here it would cross the left shell and
 * erase it, and what was left read as a triangle. This one runs inside the arc,
 * between the two shells, and leaves the whole silhouette.
 *
 * And it is an extra drawing, never the same drawing more faded, transparency
 * reads as "unavailable", and this is a choice.
 */
export function HeadphonesIcon({ off, ...props }: IconProps & { off?: boolean }): React.JSX.Element {
  return (
    <Svg {...props}>
      <Riscado risco={off ? "M7.2 5.6l9.6 13" : null}>
        {/* Perfect semicircle: the chord is 14.6 and the radius 7.3. The arc as stroke, the shells filled. */}
        <path d="M4.7 13.8V12a7.3 7.3 0 0 1 14.6 0v1.8" />
        <rect x="2.6" y="13.2" width="4.2" height="7.2" rx="2.1" fill="currentColor" stroke="none" />
        <rect x="17.2" y="13.2" width="4.2" height="7.2" rx="2.1" fill="currentColor" stroke="none" />
      </Riscado>
    </Svg>
  )
}

export function CameraIcon({ off, ...props }: IconProps & { off?: boolean }): React.JSX.Element {
  return (
    <Svg {...props}>
      <Riscado risco={off ? "M4 3l16 18" : null}>
        <rect x="2.5" y="6" width="13" height="12" rx="2.5" fill="currentColor" stroke="none" />
        <path d="M15.5 10.5l6-3.2v9.4l-6-3.2z" fill="currentColor" stroke="none" />
      </Riscado>
    </Svg>
  )
}

/** Leaving a call. A handset tipped over, the universal hang-up. */
export function HangUpIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path
        d="M2.5 14.2c5.2-5 13.8-5 19 0l-2.3 2.3a1.7 1.7 0 0 1-2.2.2l-1.7-1.2a1.7 1.7 0 0 1-.6-1.9l.3-1a11 11 0 0 0-6 0l.3 1a1.7 1.7 0 0 1-.6 1.9l-1.7 1.2a1.7 1.7 0 0 1-2.2-.2Z"
        fill="currentColor"
        strokeWidth={1}
      />
    </Svg>
  )
}

export function PersonAddIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="9.5" cy="8" r="3.5" />
      <path d="M3 20a6.5 6.5 0 0 1 13 0" />
      <path d="M18.5 7.5v6M15.5 10.5h6" />
    </Svg>
  )
}

/** Your own profile. A single person, against the group in `FriendsIcon`. */
export function PersonIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </Svg>
  )
}

/** The member panel toggle: two people, front and back. Distinct from
 * `FriendsIcon` (staggered, with paths cut) so the topbar and the rail never
 * show the same glyph meaning two different things. */
export function PeopleIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8.5" r="3.4" />
      <path d="M3 20a6.5 6.5 0 0 1 12.5-2" />
      <path d="M16 5.6a3.4 3.4 0 0 1 0 5.9" />
      <path d="M17.5 15.1a6.5 6.5 0 0 1 3.8 4.9" />
    </Svg>
  )
}

/**
 * The Friends destination: two people.
 *
 * It was a contacts card, and was called `ContactsIcon`, while the destination
 * was "Contacts". A card is where you file who you know; a friend is not filed.
 * The drawing here is what used to be in `FeedIcon`, one person in front, one
 * behind, and comes from there whole on purpose: it was already proven at 20
 * pixels in the rail, and already proven against the `PeopleIcon` in the top bar,
 * which is the other pair of people in the app and still tells itself apart the
 * same way (offset, with strokes cut). The relationship that was
 * `FeedIcon` × `PeopleIcon` is now `FriendsIcon` × `PeopleIcon`, with the same
 * two drawings: nothing got worse, and both can still be seen at the same time.
 *
 * Against the `PersonIcon` in the "Me" destination, just above in the rail, the
 * difference is the usual one in this family and was already used here: one
 * person against a group.
 */
export function FriendsIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19.5a6 6 0 0 1 12 0" />
      <circle cx="17" cy="6.8" r="2.4" />
      <path d="M15.2 12.4a5 5 0 0 1 5.8 4.9" />
    </Svg>
  )
}

/** Pop the call out into the floating dock: a box with an arrow leaving it. */
/** Full screen: four corners opening outward. */
export function EcraInteiroIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </Svg>
  )
}

/** Exit full screen: the same four corners, closing inward. */
export function SairDoEcraInteiroIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M9 4v5H4" />
      <path d="M15 4v5h5" />
      <path d="M9 20v-5H4" />
      <path d="M15 20v-5h5" />
    </Svg>
  )
}

export function PopOutIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M19.5 13v5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
      <path d="M14.5 4.5H20V10" />
      <path d="M20 4.5 11.5 13" />
    </Svg>
  )
}

/**
 * The Orwell mark: a redacted O.
 *
 * Redaction bars stacked with the O's empty space in the middle and one bar
 * shifted out of alignment. The name is deliberate irony and so is the mark:
 * the bar that censors text in the novel is here what protects it. It was a
 * closed eye until 13/8/2026, which said the same thing by worn metaphor, but
 * no privacy app needs to draw an eye to say it does not watch.
 *
 * Solid, not stroke, unlike the other icons in this file: a redaction bar is
 * a bar because it is filled. That is why we have a custom `svg` here instead
 * of the `Svg` above, which paints `stroke`.
 *
 * The bars are generated from `marca/gerar-marca.py`, which draws the same O
 * for the favicon, the dock icon and the system tray, four copies by hand
 * would diverge on the first fix made in only one place.
 */
export function OrwellMark({ size = 20 }: IconProps): React.JSX.Element {
  // Two visual variants: the full one has seven banners and six gaps, and below ~40px there are no pixels to fit them in, what appears is a gray rectangle.
  const tarjas = size >= LIMIAR_MARCA_CHEIA ? MARCA_CHEIA : MARCA_COMPACTA
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {tarjas.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

/** The notification bell. */
export function BellIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M18.5 15.5H5.5c1.2-1.3 1.8-2.4 1.8-5a4.7 4.7 0 0 1 9.4 0c0 2.6 0.6 3.7 1.8 5Z" />
      <path d="M10.2 18.5a1.9 1.9 0 0 0 3.6 0" />
    </Svg>
  )
}

/** The narrow-screen drawer toggle. Three lines; there is no better idea. */
export function MenuIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  )
}

/**
 * A real gear, with teeth that grip the rim.
 *
 * What was here before was a small circle with eight lines radiating outward, and that is not a gear, it is the canonical drawing of a sun, which is what almost everyone uses for "light mode". What gave it away was the SEPARATION: in a real gear the teeth grow from the body, and a gap between the circle and the tips reads as rays, not teeth. Enlarged it might have passed; at the size it actually appears, it does not.
 *
 * Six teeth instead of eight, and the number came from seeing them at actual size rather than enlarged. Starting from seven, at 16 px the valleys between teeth close up with the stroke width and the gear becomes a blurry flower. With six, and with the tooth taking up half the pitch, each valley stays open at 16 px.
 *
 * Slider cursors were the other obvious choice, and they were ruled out because they clash: three horizontal lines is the `MenuIcon`, which is already in the product.
 */
export function GearIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M9.59 3.02L14.41 3.02L14.80 5.48L16.25 6.31L18.58 5.42L20.98 9.59L19.05 11.17L19.05 12.83L20.98 14.41L18.58 18.58L16.25 17.69L14.80 18.52L14.41 20.98L9.59 20.98L9.20 18.52L7.75 17.69L5.42 18.58L3.02 14.41L4.95 12.83L4.95 11.17L3.02 9.59L5.42 5.42L7.75 6.31L9.20 5.48Z" />
      <circle cx="12" cy="12" r="2.9" />
    </Svg>
  )
}

export function ImageIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M3.5 17l4.6-4.2a1.8 1.8 0 0 1 2.4 0L15 17" />
      <path d="M14 15l1.8-1.6a1.8 1.8 0 0 1 2.4 0L21 16" />
    </Svg>
  )
}

/**
 * The emoji picker: a drawn face, not an emoji.
 *
 * There was a literal `🙂` here, justified on the grounds that the button showed exactly the kind of thing it opens. The argument is sound and the consequence is bad: an emoji is rendered by the system's emoji font, which has its own optical metrics and its own color. Next to two monochromatic siblings on the same 24-unit grid, it looks larger, more colorful, and misaligned, and no CSS rule puts it in line, because the glyph does not respect `currentColor` or the stroke width of the family.
 *
 * Drawn, it fits the grid like the others and changes color with the theme.
 */
export function SmileyIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.4" />
      {/* Eyes as two short strokes: with rounded ends they read as dots, and a dot drawn with `fill` did not match the stroke width of the family. */}
      <path d="M9.4 9.8v1" />
      <path d="M14.6 9.8v1" />
      <path d="M8.5 13.4Q12 16.6 15.5 13.4" />
    </Svg>
  )
}

/**
 * The nudge: a frame being shaken.
 *
 * What the button does is written in its own `title`, "shake the other person's screen", and that is what the drawing says: the frame in the middle is the screen, and the arcs on each side are the motion. No waving hand: a hand at 17 pixels is a blur, and the `👋` that was here was an emoji, which is the thing this product does not want.
 *
 * Symmetric on purpose. The `SpeakerIcon` also has arcs, but only on one side, one comes from a sound source, this one shakes on both. At the distance from which a 34-pixel button reads, it is the symmetry that tells them apart.
 */
export function BuzzIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="8.2" y="7.4" width="7.6" height="9.2" rx="2" />
      <path d="M5.6 10.2Q4 12 5.6 13.8" />
      <path d="M2.9 8.4Q1.2 12 2.9 15.6" />
      <path d="M18.4 10.2Q20 12 18.4 13.8" />
      <path d="M21.1 8.4Q22.8 12 21.1 15.6" />
    </Svg>
  )
}

export function LinkIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M10 13.8a4 4 0 0 0 5.7 0l3.2-3.2a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
      <path d="M14 10.2a4 4 0 0 0-5.7 0l-3.2 3.2a4 4 0 0 0 5.7 5.7l1.5-1.5" />
    </Svg>
  )
}

/** Crop: the two crossed corners of the cut, the drawing everyone knows. */
export function CropIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </Svg>
  )
}

export function CopyIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2.5" />
      <path d="M15 6.5v-1A2 2 0 0 0 13 3.5H5.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2h1" />
    </Svg>
  )
}

/**
 * The other person's microphone, muted, the mark next to their name.
 *
 * It is the same drawing as `MicIcon` with the bar, and it is a reference not a second copy of the strokes on purpose. Two copies of an icon diverge the first time someone tunes one of them, and the result would be the same fact drawn two ways on the same screen: the control bar button saying "muted" one way and the mark next to the name another way. A reference cannot diverge.
 *
 * It exists as its own icon, not as `<MicIcon off />` in each place, because its users have no state to pass: either you put the mark or you do not. A boolean prop in a place where only one of the values makes sense is an invitation to write `off={false}` by mistake and draw a live microphone where the interface meant to say the opposite.
 */
export function MicOffIcon(props: IconProps): React.JSX.Element {
  return <MicIcon {...props} off />
}

/**
 * Share screen. A monitor with an arrow coming out of it, upward.
 *
 * The monitor alone is the "video" drawing in half the apps that exist and it was one pixel away from the camera, which is on the button next to it. The arrow is what says the direction: this goes out of here to other people.
 */
export function ScreenShareIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="2.5" y="4" width="19" height="13" rx="2.5" />
      <path d="M8.5 20.5h7" />
      <path d="M12 13.5V7.5" />
      <path d="M9.2 10.3 12 7.5l2.8 2.8" />
    </Svg>
  )
}

/** Nothing is readable from outside. Shown wherever we claim that. */
export function LockIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="4.5" y="10" width="15" height="10.5" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Svg>
  )
}

/*
  The two that came from `icons-anexos.tsx`.

  That file existed so attachments could be born without touching this one,
  which someone else was working on at the same time. It was a good reason
  that week and it stopped being one: two icon files make anyone looking for
  a drawing have to guess which one it is in.
*/

/**
 * The clip: attach a file.
 *
 * Drawn and not a `📎`, for the same reason the emoji face was redrawn, it is written out in full in `SmileyIcon`: a glyph from the system font has its own metrics and color, and next to monochromatic siblings on the same 24-unit grid it looks larger, colorful and out of line, with no CSS to fix it.
 *
 * The shape is the paper clip everyone knows, and that is the intent: next to a button that is already a photograph, the clip only has to say "the other one", and any invented drawing would say it worse.
 */
export function PaperclipIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M20.4 11.6 12 20a5.3 5.3 0 0 1-7.5-7.5l8.4-8.4a3.5 3.5 0 0 1 5 5l-8.4 8.4a1.8 1.8 0 0 1-2.5-2.5l7.7-7.7" />
    </Svg>
  )
}

/**
 * Save the file: the arrow that goes into the tray.
 *
 * A down arrow alone was ambiguous, this product already has arrows that mean "move down the list". The tray below is what makes it a download and not just a movement.
 */
export function DownloadIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12 3.5v11" />
      <path d="M8 10.5 12 14.5l4-4" />
      <path d="M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" />
    </Svg>
  )
}

/**
 * Pin: a pin stuck in, with the head tilted.
 *
 * Tilted on purpose. A straight pin reads as a marker or a down arrow, and there are arrows in this product that mean "move down the list". The tilt is what makes it a gesture of sticking in a wall, which is the whole metaphor.
 */
export function PinIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M15.5 3.2 20.8 8.5" />
      <path d="M16.6 4.3 13 7.9c-1.5-.5-3.2-.2-4.4 1L15 15.4c1.2-1.2 1.5-2.9 1-4.4l3.6-3.6" />
      <path d="M11.2 12.8 4.4 19.6" />
    </Svg>
  )
}

/**
 * Search: the magnifying glass, and there is no second choice.
 *
 * It is one of the few symbols in this file that is not debated: anyone who has ever used a computer knows what a magnifying glass does, and drawing anything else would waste the familiarity for no reason. The handle comes out at 45 degrees from the bottom right corner because that is how it reads as a glass and not as a key.
 */
export function SearchIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.3 15.3 20.5 20.5" />
    </Svg>
  )
}

/**
 * The drag handle: six dots, nothing more.
 *
 * The universal symbol for "this is something you grab", and it was the only thing missing from the line of someone in a voice room. It was draggable from the start, and the only way to find out was to hover and wait for the tooltip, or stumble on it by accident. A gesture you only discover by accident is a gesture most people never find.
 *
 * Dots and not lines: horizontal lines are the handle for REORDERING a list, and nothing gets reordered here, you move a person from one room to another.
 */
export function GripIcon(props: IconProps): React.JSX.Element {
  /*
    The fill goes in each circle and not in the `<svg>`: the `Svg` in this codebase
    declares `fill="none"` and `stroke="currentColor"`, and that is how all the
    other icons work, which are strokes. This is the only filled one, and the exception
    stays contained in the six circles instead of opening the wrapper to props
    that nobody else uses.
  */
  return (
    <Svg {...props}>
      {[6, 12, 18].flatMap((y) =>
        [9, 15].map((x) => <circle key={`${x}:${y}`} cx={x} cy={y} r="1.4" fill="currentColor" stroke="none" />),
      )}
    </Svg>
  )
}

/** Three dots: "there are more actions here". Opens the same menu as right-click. */
export function MoreIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="19" cy="12" r="1.3" fill="currentColor" />
    </Svg>
  )
}

/** The four corners: see only the call stage, with no bars around it. */
export function PalcoIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </Svg>
  )
}

/** An eye: how many people are watching the shared screen. */
export function OlhoIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  )
}

/**
 * The filled eye, next to the "LIVE" badge: how many are watching. Filled like the
 * call icons; the iris is a hole (`evenodd`) and the pupil fills again.
 */
export function OlhoCheioIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        stroke="none"
        fillRule="evenodd"
        d="M12 5C5.5 5 2 12 2 12s3.5 7 10 7 10-7 10-7-3.5-7-10-7zm0 3.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zm0 1.9a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"
      />
    </Svg>
  )
}

/** Play, filled and with rounded corners: the "Watch broadcast" button. */
export function ReproduzirCheioIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path fill="currentColor" d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" />
    </Svg>
  )
}

/** A left arrow: go back to the previous place on the person's page. */
export function SetaParaTrasIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Svg>
  )
}

/** Reply to a message: the arrow that curves back, like in Discord. */
export function ResponderIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M9.5 6 4 11.5 9.5 17" />
      <path d="M4.5 11.5H14a6 6 0 0 1 6 6V19" />
    </Svg>
  )
}

/** A musical note: "Share audio", next to "Share screen". */
export function MusicaIcon({ off, ...props }: IconProps & { off?: boolean }): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
      {/* Struck through: this person's audio is muted (the line from other "off" marks). */}
      {off && <path d="M3 3l18 18" />}
    </Svg>
  )
}

/** Play: a triangle. */
export function TocarIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M7 4.5v15L19 12z" />
    </Svg>
  )
}

/** Pausar: duas barras. */
export function PausarIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M8 5v14M16 5v14" />
    </Svg>
  )
}

/** Skip to next: a triangle against a bar. */
export function SaltarIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5 5v14l10-7zM19 5v14" />
    </Svg>
  )
}

/** Previous: the Skip mirrored. */
export function AnteriorIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M19 5v14L9 12zM5 5v14" />
    </Svg>
  )
}

/** Stop: a square. */
export function PararIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </Svg>
  )
}

/** Open files: the eject from players, a triangle above a bar. */
export function AbrirIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M12 5 5 14h14zM5 19h14" />
    </Svg>
  )
}

/** Repeat: two arrows going around. */
export function RepetirIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" />
    </Svg>
  )
}

/** Shuffle: two arrows crossing. */
export function BaralharIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
    </Svg>
  )
}

/* The icons from the notification timeline (November 3, 2026): one per notification type, in a rounded square. See `NotificationPanel`. */

/** A mention: the at sign. */
export function ArrobaIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M15.6 12v1.4a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.5 7" />
    </Svg>
  )
}

/** A call: the telephone handset. */
export function TelefoneIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5 4h3.2l1.6 4-2 1.3a10.5 10.5 0 0 0 4.9 4.9l1.3-2 4 1.6V17a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z" />
    </Svg>
  )
}

/** An invite: the envelope. */
export function EnvelopeIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </Svg>
  )
}

/* The four from the report sheet (4/11/2026): the summary of what comes out of the device has one icon per line, as in the design chosen by the owner. */

/** A reason: the flag to mark. */
export function BandeiraIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5.5 21V4" />
      <path d="M5.5 4.5h11l-2.5 4 2.5 4h-11" />
    </Svg>
  )
}

/** A written note: the sheet with lines. */
export function NotaIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
      <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5" />
    </Svg>
  )
}

/** Done, confirmed: the checkmark. */
export function VistoIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  )
}

/** A version: the tag. */
export function EtiquetaIcon(props: IconProps): React.JSX.Element {
  return (
    <Svg {...props}>
      <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.7 6.7a1.4 1.4 0 0 1-2 0z" />
      <circle cx="8" cy="8" r="1.4" />
    </Svg>
  )
}
