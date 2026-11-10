import { strings } from "../strings.js"
import { SinoRiscadoIcon } from "./SidebarIcons.js"

/**
 * The crossed-out bell next to the name of a muted place: a room, a channel, or
 * a private conversation. It is described in words to those who cannot see it,
 * like the other badges on the line. See `lib/silenciados.ts`.
 */
export function MarcaDeSilencio(): React.JSX.Element {
  return (
    <span className="marca-silencio" role="img" aria-label={strings.silencio.marca} title={strings.silencio.marca}>
      <SinoRiscadoIcon size={12} />
    </span>
  )
}
