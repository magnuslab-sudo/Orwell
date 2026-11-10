import { useId, useState } from "react"
import type { RepairOutcome } from "../../bridge.js"
import { useBridge } from "../../App.js"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { Modal } from "../../components/Modal.js"
import { useToast } from "../../components/Toast.js"
import { strings, traduzirErro } from "../../strings.js"
import { ConviteDeLink } from "./InviteSheet.js"

/** The three modes of the sheet. */
export type ModoDeConvite = "endereco" | "link" | "meter"

/**
 * One phrase per outcome of "Add now", and each says exactly what happened.
 *
 * There were two: "joined" and "already reading". The second also appeared when
 * the device did not yet know if the person read the channel, or when one of
 * their devices had no keys to enter. In neither case were they reading.
 */
export function fraseDeMeter(outcome: RepairOutcome): string {
  switch (outcome) {
    case "invited":
    case "reseated":
      return strings.prompts.seatDone
    case "live":
      return strings.prompts.seatAlready
    case "unproven":
      return strings.convidar.meterPorProvar
    case "cooldown":
      return strings.convidar.meterEspera
    case "device-unreachable":
      return strings.convidar.meterSemAparelho
  }
}

/**
 * Invite someone to a channel: one sheet, three modes.
 *
 * There were five doors and three behaviors. The channel menu had "Invite
 * someone" (which used the OPEN channel not the menu's) and "Add to channel";
 * the chat header and the member list footer opened a prompt; only the footer
 * reached the link; the person menu had a list of channels that invited right
 * away. Now all open this sheet, and all say the channel.
 *
 * - **By address** sends an invite via private chat. The person joins if they
 *   accept.
 * - **By link** creates a link. Anyone with it joins, after someone inside lets
 *   them in.
 * - **Add now** adds the person without waiting for acceptance, and leaves the
 *   invite sealed for them. It exists for people who should be in the channel
 *   but are not. Only with the `convidar` responsibility: the same power,
 *   without the permission.
 */
export function ConvidarSheet({
  channel,
  label,
  pessoa,
  modoInicial = "endereco",
  podeMeter,
  onClose,
}: {
  /** The channel, always explicit: never "whichever is open". */
  channel: string
  /** The channel name, already resolved by the shell. */
  label: string
  /** Who is being invited, when the door already knows (the person menu). */
  pessoa?: string | undefined
  modoInicial?: ModoDeConvite | undefined
  /** Comes from `mayInvite`. Absent or false hides the "Add now" mode. */
  podeMeter?: boolean | undefined
  onClose: () => void
}): React.JSX.Element {
  const bridge = useBridge()
  const toast = useToast()
  const heading = useId()
  const [modo, setModo] = useState<ModoDeConvite>(modoInicial === "meter" && !podeMeter ? "endereco" : modoInicial)
  const [quem, setQuem] = useState(pessoa ?? "")
  const [ocupado, setOcupado] = useState(false)
  /*
    The link is built on first visit to the mode and stays built: switching
    modes and coming back cannot lose a link already created, which exists only
    there.
    */
  const [linkVisto, setLinkVisto] = useState(modoInicial === "link")

  const modos: { id: ModoDeConvite; label: string }[] = [
    { id: "endereco", label: strings.convidar.modoEndereco },
    { id: "link", label: strings.convidar.modoLink },
    ...(podeMeter ? [{ id: "meter" as const, label: strings.convidar.modoMeter }] : []),
  ]

  const enviar = (): void => {
    const endereco = quem.trim()
    if (!endereco || ocupado) return
    setOcupado(true)
    if (modo === "meter") {
      /*
        `force` true: adding is the gesture that does not ask the limiter for
        permission. The kernel still refuses anyone already reading, and that is
        what `outcome` reports.
      */
      void bridge.social
        .repairInvite(channel, endereco, true)
        .then(({ outcome }) => {
          toast(fraseDeMeter(outcome))
          onClose()
        })
        .catch((error: Error) => toast(traduzirErro(error), "error"))
        .finally(() => setOcupado(false))
      return
    }
    void bridge.channels
      .invite(channel, endereco)
      /*
        Say the invite went out, because nothing else shows: inviting sends a
        message and the member list only changes when the person accepts.
      */
      .then(() => {
        toast(strings.userMenu.invited(label))
        onClose()
      })
      .catch((error: Error) => toast(traduzirErro(error), "error"))
      .finally(() => setOcupado(false))
  }

  return (
    <Modal
      className="sheet narrow convidar"
      labelledBy={heading}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        if (modo !== "link") enviar()
      }}
    >
      <header className="sheet-header">
        <h2 id={heading}>{strings.convidar.title(label)}</h2>
        <Button variant="ghost" type="button" onClick={onClose}>
          {strings.common.close}
        </Button>
      </header>

      <div className="sheet-body">
        {/* Real buttons, with `aria-pressed`: it is a choice of one from three, and
            each one says if it is chosen. */}
        <div className="choice-row convidar-modos" role="group" aria-label={strings.convidar.modosLabel}>
          {modos.map((m) => (
            <button
              key={m.id}
              type="button"
              className={modo === m.id ? "chip on" : "chip"}
              aria-pressed={modo === m.id}
              onClick={() => {
                setModo(m.id)
                if (m.id === "link") setLinkVisto(true)
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {linkVisto && (
          <div className="sheet-grupo" hidden={modo !== "link"}>
            <ConviteDeLink channel={channel} />
          </div>
        )}
        {modo !== "link" && (
          <>
            <Field label={strings.prompts.personLabel}>
              <input
                value={quem}
                placeholder={strings.prompts.personPlaceholder}
                autoFocus={pessoa === undefined}
                onChange={(event) => setQuem(event.target.value)}
              />
            </Field>
            <p className="field-note">{modo === "meter" ? strings.convidar.meterHint : strings.convidar.enderecoHint}</p>
          </>
        )}
      </div>

      {modo !== "link" && (
        <footer className="sheet-actions">
          <Button variant="ghost" type="button" onClick={onClose}>
            {strings.prompts.cancel}
          </Button>
          <Button variant="primary" type="submit" disabled={ocupado || quem.trim().length === 0}>
            {modo === "meter" ? strings.convidar.meterAccao : strings.convidar.enderecoAccao}
          </Button>
        </footer>
      )}
    </Modal>
  )
}
