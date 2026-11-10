import { useId, useState } from "react"
import type { ConnectionState, Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { Button } from "../../components/Button.js"
import { ConnectionBanner } from "../../components/ConnectionBanner.js"
import { Modal } from "../../components/Modal.js"
import { LockIcon } from "../../icons.js"
import { connectionLabel, formatStamp, nomeEmFalta } from "../../lib/format.js"
import { strings } from "../../strings.js"
import { PostDetail } from "../social/PostDetail.js"
import { RoomIcon } from "../../components/RoomIcon.js"
import { ProfileBody } from "./ProfileBody.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

/** A channel this account founded, already with the name and icon resolved. */
export interface CanalFundado {
  canal: string
  nome: string
  icone?: string | undefined
  oficial?: boolean | undefined
}

/**
 * "Channels I founded", on your own profile (owner's request, October 27, 2026).
 *
 * Only on your own: whoever founded a channel is a fact the core knows about each
 * channel (`channels.founder`), but the list of channels of SOMEONE ELSE would be
 * the list of places they are in, and that is shown to no one. Empty, it says it is
 * empty, instead of disappearing: whoever looks for the section finds it.
 */
export function CanaisFundados({
  canais,
  onAbrir,
}: {
  canais: readonly CanalFundado[]
  onAbrir: (canal: string) => void
}): React.JSX.Element {
  const titulo = useId()
  return (
    <section className="profile-fundados" aria-labelledby={titulo}>
      <h3 id={titulo}>{strings.profile.foundedTitle}</h3>
      {canais.length === 0 ? (
        <p className="field-note">{strings.profile.foundedEmpty}</p>
      ) : (
        <ul>
          {canais.map((canal) => (
            <li key={canal.canal}>
              <button
                type="button"
                className="profile-fundado"
                aria-label={strings.profile.foundedOpen(canal.nome)}
                onClick={() => onAbrir(canal.canal)}
              >
                <RoomIcon channel={canal.canal} label={canal.nome} icon={canal.icone} official={canal.oficial ?? false} size={32} />
                <span className="profile-fundado-nome">{canal.nome}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Your own profile, rendered from the same pieces that show anyone else's.
 *
 * Built this way on purpose: "as others see it" then holds by construction rather
 * than by remembering to keep two screens in step. Since the profile of others exists,
 * this stopped being an intention and became a fact, it is the same `ProfileBody`
 * that draws both.
 *
 * What this screen has and the other cannot have is editing, and it comes in through
 * a slot: the button goes from here into the body. Another person's profile passes
 * no slot.
 */
export function ProfileScreen({
  profile,
  address,
  posts,
  messages,
  directory,
  nameFor,
  onCompose,
  onEdit,
  connection,
  connectionDetail,
  canaisFundados,
  onAbrirCanal,
}: {
  profile: Profile
  address: string | null
  posts: ChatMessage[]
  /**
   * The entire thread, so an open publication can bring the thumbs and the comments.
   * It is not the same as `posts`: those are publications, and a vote or a comment are
   * separate messages that point to them.
   */
  messages: ChatMessage[]
  directory: Map<string, Profile>
  nameFor: (sender: string) => string
  onCompose: () => void
  onEdit: () => void
  connection: ConnectionState
  connectionDetail: string | null
  /** Missing (or no `onAbrirCanal`), the section does not render. See `CanaisFundados`. */
  canaisFundados?: readonly CanalFundado[] | undefined
  onAbrirCanal?: ((canal: string) => void) | undefined
}): React.JSX.Element {
  const [open, setOpen] = useState<ChatMessage | null>(null)
  const heading = useId()

  return (
    <main className="main">
      <ConnectionBanner state={connection} detail={connectionDetail} />
      <header className="topbar">
        <h1>
          <NomeDePessoa nome={profile.displayName || nomeEmFalta(address ?? undefined)} endereco={address} />
        </h1>
        <span className="sealed" title={strings.profile.sealedTitle}>
          <LockIcon size={13} />
          {strings.profile.sealed}
        </span>
      </header>

      <div className="profile-scroll">
        <ProfileBody
          profile={profile}
          address={address}
          posts={posts}
          onOpenPost={setOpen}
          labels={{
            posts: strings.profile.postsListLabel,
          }}
          empty={{
            title: strings.profile.emptyTitle,
            body: strings.profile.emptyBody,
            action: { label: strings.profile.newPost, onClick: onCompose },
          }}
          action={
            <Button variant="ghost" onClick={onEdit}>
              {strings.profile.editProfile}
            </Button>
          }
          depoisDaCabeca={
            canaisFundados && onAbrirCanal ? <CanaisFundados canais={canaisFundados} onAbrir={onAbrirCanal} /> : undefined
          }
        />
      </div>

      <footer className="statusbar">{connectionLabel(connection)}</footer>

      {open && (
        <Modal className="sheet narrow" labelledBy={heading} onClose={() => setOpen(null)}>
          <header className="sheet-header">
            {/* The time here and the title just below, inside the body: repeating it in
                both places gave two headings with the same name, which reads poorly
                and sounds worse. */}
            <h2 id={heading}>{formatStamp(open.payload.postedAt)}</h2>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              {strings.common.close}
            </Button>
          </header>
          <div className="sheet-body">
            <PostDetail post={open} messages={messages} me={address} directory={directory} nameFor={nameFor} />
          </div>
        </Modal>
      )}
    </main>
  )
}
