import { useEffect, useId, useState } from "react"
import type { Power } from "@enclave/protocol"
import { Button } from "../../components/Button.js"
import { Enquadrar } from "../../components/Enquadrar.js"
import { Field } from "../../components/Field.js"
import { Modal } from "../../components/Modal.js"
import { RoomIcon } from "../../components/RoomIcon.js"
import { useConfirmar } from "../../hooks/useConfirmar.js"
import { podeEnquadrar } from "../../lib/enquadrar.js"
import { avisoDeAnimacaoPerdida, compressImage, IMAGE_BUDGETS, type CompressedImage } from "../../lib/images.js"
import type { MembroDoCanal } from "../chat/RoleEditor.js"
import { SeccaoCargos } from "./SeccaoCargos.js"
import { etiquetaDaSeccao, type SeccaoDoCanal, seccaoDoCanalValida, seccoesVisiveis } from "./seccoesDoCanal.js"
import type { ChannelRole } from "../../bridge.js"
import { strings, traduzirErro } from "../../strings.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"

/**
 * A channel's properties: name, description, and icon. That is all.
 *
 * The identifier was here, read-only, with a note explaining it does not
 * change. It is gone, because it is channeling and not content. It comes by
 * default (from the server for the main channel; from `newRoomId` for rooms),
 * no one chooses it, no one edits it, and showing it next to the name field
 * only invited confusion between the two: the name changes freely precisely
 * because the identifier is born hidden and never changes again.
 *
 * Anyone who really needs it to report a fault has it in the diagnostic log
 * in Settings, which is where identifiers already lived and where they make
 * sense, next to the time and what happened.
 *
 * ## By sections, from 3/11/2026
 *
 * Request from the owner: properties arranged in tabs or a side column, so they
 * read well (plan `docs/planos/paridade-discord-plano.md` §5.3). On a wide
 * screen, the sections column stays on the left and content on the right, like
 * Discord settings. On mobile, sections are a row of tabs on top. Sections live
 * in `seccoesDoCanal.ts`.
 *
 * They are only reorganized. Everything saves as before: name, description, and
 * icon with the "Save" button at the bottom (which only shows in General, because
 * only General saves); the AFK room with its button; roles now. Panels for other
 * sections stay mounted and hidden: switching sections does not lose what you
 * wrote, and the open section stays saved while the form is open.
 */
export function RoomProperties({
  channel,
  initial,
  mayEdit = true,
  founder,
  onClaim,
  onSubmit,
  onCancel,
  roles,
  mayManageRoles = false,
  onCreateRole,
  onEditRole,
  onDeleteRole,
  onReorderRoles,
  seccaoInicial,
  omissao,
  official = false,
  souFundador,
  cargoAdmin,
  membros,
  onSetMemberRole,
  seccaoAfk,
  seccaoPermissoes,
  seccaoDenuncias,
}: {
  channel: string
  initial: { name: string; topic?: string | undefined; icon?: string | undefined } | null
  /** False shows properties read-only. The real save is in the core. */
  mayEdit?: boolean | undefined
  /** Null means a channel with no owner, and in that case you are offered to take it. */
  founder?: string | null | undefined
  onClaim?: (() => Promise<void>) | undefined
  onSubmit: (next: { name: string; topic?: string; icon?: string }) => Promise<void>
  onCancel: () => void
  /**
   * What roles this channel declared, and how to create and delete them.
   *
   * Those who HAVE them live in each person's profile (`MemberRoles`). Since
   * 27 October 2026 the editor also has a "Members" tab, like Discord (owner's
   * request). It receives the list by `membros` and `onSetMemberRole`; without
   * them, the tab points to the person's profile.
   *
   * The whole section only exists for those `mayManageRoles` allows, those
   * who cannot do not see it greyed out, do not see it at all, which is the
   * rule that runs through all menus. And `mayManageRoles` is a CORE check:
   * managing roles is outside the four responsibilities on purpose, because if
   * it were one of them, having any power would be enough to promote yourself.
   */
  roles?: ChannelRole[] | undefined
  mayManageRoles?: boolean
  onCreateRole?: ((name: string, powers: Power[], colour: string | undefined) => void) | undefined
  /** Change a role that already exists: the label and the permissions. The
   *  identifier does not change, and that is what prevents rename from becoming
   *  demotion. */
  onEditRole?: ((role: string, name: string, powers: Power[], colour: string | undefined) => void) | undefined
  onDeleteRole?: ((role: string) => void) | undefined
  /** Change the order of roles. Only for those who can (the founder and `admin`). See `RoleEditor`. */
  onReorderRoles?: ((ordem: string[]) => Promise<unknown> | void) | undefined
  /** The section that opens first. Missing, or one this person cannot see: General. */
  seccaoInicial?: SeccaoDoCanal | undefined
  /**
   * The name to show while no one publishes one.
   *
   * The identifier used to be here, cut short: `!orwell:orwell.pt` gave "orwell"
   * in the name field. For a channel someone created that is harmless, the text
   * is what they wrote, but in the main channel the identifier comes by default
   * from the server, no one chose it, and seeing it in the name field was putting
   * channeling where only a label should be. Whoever calls this already knows what
   * name to show, because it is the same as what the sidebar shows.
   */
  omissao?: string | undefined
  /** The main channel the server announces. See `lib/oficial.ts`. */
  official?: boolean
  /**
   * For the "Members" tab and the built-in role notice, in the role editor.
   * Optional and passed as-is: see `RoleEditor`. Without them the editor shows
   * the door to the person's profile, as before.
   */
  souFundador?: boolean | undefined
  /** The name and color given to the built-in role, or null. See `RoleEditor`. */
  cargoAdmin?: { name: string; colour?: string } | null | undefined
  membros?: readonly MembroDoCanal[] | undefined
  onSetMemberRole?: ((address: string, role: string, ter: boolean) => void) | undefined
  /** The AFK room section (2/11/2026), already mounted. See `SeccaoSalaAfk`. */
  seccaoAfk?: React.ReactNode
  /** The permissions model (1.2), already mounted, for the "Roles" tab. See `SeccaoCargos`. */
  seccaoPermissoes?: React.ReactNode
  /**
   * The reports that reached the founder, already mounted (`SeccaoDenuncias`).
   * Only shown to those `souFundador` allows, in the "Moderation" tab.
   */
  seccaoDenuncias?: React.ReactNode
}): React.JSX.Element {
  const heading = useId()
  const confirmar = useConfirmar()
  const porOmissao = omissao ?? channel.replace(/^!/, "").split(":")[0] ?? channel
  /** The GIF that froze because it was too heavy: see `pickIcon`. */
  const [avisoDoGif, setAvisoDoGif] = useState<string | null>(null)
  /** The chosen icon, waiting to be framed. See `pickIcon`. */
  const [aEnquadrar, setAEnquadrar] = useState<File | null>(null)
  const [name, setName] = useState(initial?.name ?? porOmissao)
  const [topic, setTopic] = useState(initial?.topic ?? "")
  const [icon, setIcon] = useState(initial?.icon)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = name !== (initial?.name ?? porOmissao) || topic !== (initial?.topic ?? "") || icon !== initial?.icon

  const gerePapeis = mayManageRoles && onCreateRole !== undefined && onDeleteRole !== undefined
  const comDenuncias = souFundador === true && seccaoDenuncias !== undefined && seccaoDenuncias !== null
  const visiveis = seccoesVisiveis({
    mayEdit,
    gereCargos: gerePapeis,
    temSalas: seccaoAfk !== undefined && seccaoAfk !== null,
    ehFundador: comDenuncias,
  })
  const [seccao, setSeccao] = useState<SeccaoDoCanal>(() => seccaoDoCanalValida(seccaoInicial, visiveis))
  // A section that is no longer visible (lost the tab when the panel was open) falls back to General.
  const aberta = seccaoDoCanalValida(seccao, visiveis)
  const comSeccoes = visiveis.length > 1
  const ehEstreito = useEstreito()

  /**
   * Choose the channel icon.
   *
   * Rejecting a large file put the problem on the user: they knew they could
   * not use it, did not know how to fix it, and went to find another image.
   * Now we compress it here on the device before encrypting, the only moment
   * this can happen, because once encrypted the image is noise that no one can
   * reduce, not even the server. See `lib/images.ts`, and the budget `icon`:
   * an icon is published once per channel, not per person, but avatars at
   * 512 KB replicated per channel already consumed most of a real server's
   * database, the care carries forward.
   *
   * An animated GIF hits the avatar cap (160 KB). Above that it freezes, and
   * the panel says so, with the same message as the profile editor.
   *
   * Before compression, show the crop frame with the icon shape (a square with
   * rounded corners, like `.room-icon`). Without it, use the old path.
   */
  const pickIcon = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setAvisoDoGif(null)
    if (podeEnquadrar()) {
      setAEnquadrar(file)
      return
    }
    void compressImage(file, IMAGE_BUDGETS.icon)
      .then((imagem) => aplicarIcone(file, imagem))
      .catch(() => setError(strings.roomProperties.iconTooBig))
  }

  const aplicarIcone = (file: File, imagem: CompressedImage): void => {
    setError(null)
    setIcon(imagem.dataUrl)
    setAvisoDoGif(avisoDeAnimacaoPerdida(file, imagem, IMAGE_BUDGETS.icon))
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    /**
     * Block the form's default behavior.
     *
     * The `Modal` passes this handler directly to the `<form>` and does not
     * block anything itself, all other callers do this. Without it the browser
     * navigates when you click Save: the page reloads in the middle of publish,
     * the payload never leaves fully, and the name and icon do not appear on
     * the other side. To the caller it looked like it worked, because the local
     * state had already changed before the page went away.
     */
    event.preventDefault()
    if (busy) return
    const limpo = name.trim()
    if (!limpo) {
      setError(strings.roomProperties.nameRequired)
      return
    }
    setBusy(true)
    setError(null)
    void onSubmit({ name: limpo, ...(topic.trim() ? { topic: topic.trim() } : {}), ...(icon ? { icon } : {}) })
      .catch((cause: Error) => {
        setBusy(false)
        setError(traduzirErro(cause))
      })
  }

  /**
   * Arrows move between sections, like a real `tablist` (WAI-ARIA, tabs with
   * automatic activation). Up and down in the column, left and right in the
   * row on mobile; Home and End go to the edges. Focus follows the choice.
   */
  const teclaNasSeccoes = (evento: React.KeyboardEvent<HTMLDivElement>): void => {
    const antes = ehEstreito ? "ArrowLeft" : "ArrowUp"
    const depois = ehEstreito ? "ArrowRight" : "ArrowDown"
    const indice = visiveis.indexOf(aberta)
    let proximo: number
    if (evento.key === antes) proximo = (indice - 1 + visiveis.length) % visiveis.length
    else if (evento.key === depois) proximo = (indice + 1) % visiveis.length
    else if (evento.key === "Home") proximo = 0
    else if (evento.key === "End") proximo = visiveis.length - 1
    else return
    evento.preventDefault()
    const id = visiveis[proximo] as SeccaoDoCanal
    setSeccao(id)
    evento.currentTarget.ownerDocument.getElementById(`${heading}-aba-${id}`)?.focus()
  }

  const geral = (
    <>
      <p className="sheet-lead propriedades-lead">{strings.roomProperties.lead}</p>
      <div className="avatar-row">
        <RoomIcon channel={channel} label={name || porOmissao} size={56} icon={icon} official={official} />
        <div className="avatar-actions">
          {mayEdit && (
            <label className="ghost file">
              {strings.roomProperties.pickIcon}
              <input type="file" accept="image/*" onChange={pickIcon} />
            </label>
          )}
          {mayEdit && icon && (
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setIcon(undefined)
                setAvisoDoGif(null)
              }}
            >
              {strings.roomProperties.clearIcon}
            </Button>
          )}
        </div>
      </div>

      {avisoDoGif && (
        <p className="hint" role="status">
          {avisoDoGif}
        </p>
      )}

      <Field label={strings.roomProperties.nameLabel}>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoFocus readOnly={!mayEdit} />
      </Field>

      <Field label={strings.roomProperties.topicLabel}>
        <input
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          maxLength={1024}
          placeholder={strings.roomProperties.topicPlaceholder}
          readOnly={!mayEdit}
        />
      </Field>

      {!mayEdit && <p className="hint">{strings.roomProperties.readOnly}</p>}

      {/*
        A channel with no owner is editable by any member, and stays that way
        until someone claims it. Saying so here is the only way the person knows
        the door is open, and they close it with their own account, because
        no one can sign for another.
      */}
      {founder === null && onClaim && (
        <div className="claim-channel">
          <p className="hint">{strings.roomProperties.noOwner}</p>
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setBusy(true)
              void onClaim()
                .then(() => setBusy(false))
                .catch((cause: Error) => {
                  setBusy(false)
                  setError(traduzirErro(cause))
                })
            }}
            disabled={busy}
          >
            {strings.roomProperties.claim}
          </Button>
        </div>
      )}
    </>
  )

  /** The content of each section. We only fetch the section that this person can see. */
  const conteudoDe = (id: SeccaoDoCanal): React.ReactNode => {
    switch (id) {
      case "geral":
        return geral
      case "salas":
        return (
          <>
            {seccaoAfk}
            <p className="hint">{strings.roomProperties.salasNota}</p>
          </>
        )
      case "cargos":
        // `gerePapeis` is the condition that shows the tab, and guarantees both callbacks.
        return gerePapeis ? (
          <SeccaoCargos
            roles={roles ?? []}
            onCreateRole={onCreateRole}
            onEditRole={onEditRole ?? (() => {})}
            onDeleteRole={onDeleteRole}
            onReorderRoles={onReorderRoles}
            souFundador={souFundador}
            cargoAdmin={cargoAdmin}
            membros={membros}
            onSetMemberRole={onSetMemberRole}
            permissoes={seccaoPermissoes}
          />
        ) : null
      case "membros":
        return <p className="hint">{strings.roomProperties.membrosBreve}</p>
      case "convites":
        return <p className="hint">{strings.roomProperties.convitesBreve}</p>
      case "moderacao":
        return (
          <>
            {/* Only with the tab open: the section marks as read the ones it shows, and
                a hidden panel showed nothing to anyone. */}
            {comDenuncias && aberta === "moderacao" && seccaoDenuncias}
            {mayEdit && <p className="hint">{strings.roomProperties.moderacaoBreve}</p>}
          </>
        )
      case "eventos":
        return <p className="hint">{strings.roomProperties.eventosBreve}</p>
    }
  }

  return (
    <Modal
      className={comSeccoes ? "sheet propriedades-do-canal" : "sheet"}
      labelledBy={heading}
      onClose={onCancel}
      onSubmit={submit}
      confirmDiscard={() =>
        !dirty ||
        confirmar({
          titulo: strings.roomProperties.discard,
          corpo: strings.confirmar.descartarCorpo,
          verbo: strings.confirmar.descartar,
          destructive: true,
        })
      }
    >
      <header className="sheet-header">
        <h2 id={heading}>{strings.roomProperties.title}</h2>
      </header>

      <div className="propriedades">
        {comSeccoes && (
          <div
            className="propriedades-seccoes"
            role="tablist"
            aria-label={strings.roomProperties.seccoesLabel}
            aria-orientation={ehEstreito ? "horizontal" : "vertical"}
            onKeyDown={teclaNasSeccoes}
          >
            {visiveis.map((id) => (
              <button
                key={id}
                id={`${heading}-aba-${id}`}
                type="button"
                role="tab"
                className="propriedades-aba"
                aria-selected={id === aberta}
                aria-controls={`${heading}-painel-${id}`}
                tabIndex={id === aberta ? 0 : -1}
                onClick={() => setSeccao(id)}
              >
                {etiquetaDaSeccao(id)}
              </button>
            ))}
          </div>
        )}

        <div className="sheet-body propriedades-conteudo">
          {/* All panels stay mounted, and closed ones are hidden: switching sections
              does not lose what was typed in them. */}
          {visiveis.map((id) =>
            comSeccoes ? (
              <div
                key={id}
                id={`${heading}-painel-${id}`}
                role="tabpanel"
                aria-labelledby={`${heading}-aba-${id}`}
                className="sheet-grupo propriedades-painel"
                hidden={id !== aberta}
              >
                {conteudoDe(id)}
              </div>
            ) : (
              <div key={id} className="sheet-grupo propriedades-painel">
                {conteudoDe(id)}
              </div>
            ),
          )}

          {error && (
            <p className="error">
              <TextoDeErro texto={error} />
            </p>
          )}
        </div>
      </div>

      {aEnquadrar && (
        <Enquadrar
          ficheiro={aEnquadrar}
          forma="quadrado"
          budget={IMAGE_BUDGETS.icon}
          onGuardar={(imagem) => {
            aplicarIcone(aEnquadrar, imagem)
            setAEnquadrar(null)
          }}
          onCancelar={() => setAEnquadrar(null)}
        />
      )}

      <footer className="sheet-actions">
        {/* Inside a form, a button with no type is a submit button: without this,
            "Cancel" would save the changes it was about to discard. */}
        <Button variant="ghost" type="button" onClick={onCancel}>
          {strings.prompts.cancel}
        </Button>
        {/* Only in General: only General saves with this button. The other sections
            save themselves. */}
        {mayEdit && aberta === "geral" && (
          <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
            {busy ? strings.roomProperties.saving : strings.roomProperties.save}
          </Button>
        )}
      </footer>
    </Modal>
  )
}

/** The mobile breakpoint on this panel: the same as `.cargos`. */
const CONSULTA_DO_ESTREITO = "(max-width: 640px)"

function lerEstreito(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia(CONSULTA_DO_ESTREITO).matches
  } catch {
    return false
  }
}

/**
 * The screen is narrow: sections are a row on top, not a column. Only affects
 * the arrows and `aria-orientation`; the layout is in CSS. Without `matchMedia`
 * (in tests) the answer is "no": a column.
 */
function useEstreito(): boolean {
  const [estreito, setEstreito] = useState(lerEstreito)
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const consulta = window.matchMedia(CONSULTA_DO_ESTREITO)
    const mudou = (): void => setEstreito(consulta.matches)
    mudou()
    consulta.addEventListener("change", mudou)
    return () => consulta.removeEventListener("change", mudou)
  }, [])
  return estreito
}
