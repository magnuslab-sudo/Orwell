import { useEffect, useState } from "react"
import { copiarTexto } from "../../lib/copiar.js"
import type { StoredInvite } from "@enclave/client-core"
import { useBridge } from "../../App.js"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { QrCode } from "../../components/QrCode.js"
import { useToast } from "../../components/Toast.js"
import { formatStamp } from "../../lib/format.js"
import { strings, traduzirErro } from "../../strings.js"

/*
  Functions, not constants, and the reason is language.

  A label table built at the top of the module reads `strings` ONCE on load,
  and locks into the language at that moment. Changing the language would
  redraw the whole sheet and leave these eight words in the old language, with
  nothing on screen to explain it. Called on each render, they read the current
  language. See `strings.captura.test.ts`, which caught both of these.
*/
function escolhasDePrazo(): readonly { label: string; seconds: number | undefined }[] {
  return [
    { label: strings.invite.expiry1h, seconds: 3600 },
    { label: strings.invite.expiry1d, seconds: 86_400 },
    { label: strings.invite.expiry7d, seconds: 604_800 },
    { label: strings.invite.expiryNever, seconds: undefined },
  ]
}

function escolhasDeUsos(): readonly { label: string; uses: number | undefined }[] {
  return [
    { label: strings.invite.uses1, uses: 1 },
    { label: strings.invite.uses5, uses: 5 },
    { label: strings.invite.uses25, uses: 25 },
    { label: strings.invite.usesUnlimited, uses: undefined },
  ]
}

/**
 * The channel's live invites, presentational so the rendering is testable.
 *
 * What the server tracks is what is shown: a hash, a policy and a use count.
 * The codes themselves exist only in links already handed out — nothing here
 * can recover one, which is exactly the property the sheet's copy promises.
 */
export function ActiveInvites({
  invites,
  onRevoke,
}: {
  invites: StoredInvite[]
  onRevoke: (codeHash: string) => void
}): React.JSX.Element {
  return (
    <div className="choice">
      <span className="choice-label">{strings.invite.activeTitle}</span>
      {invites.length === 0 ? (
        <p className="field-note">{strings.invite.activeEmpty}</p>
      ) : (
        <ul className="invite-list">
          {invites.map((invite) => (
            <li key={invite.codeHash} className="invite-row">
              <span className="invite-row-labels">
                <span className="invite-row-main">
                  {invite.expiresAt === null
                    ? strings.invite.neverExpires
                    : strings.invite.expiresAt(formatStamp(invite.expiresAt * 1000))}
                </span>
                <span className="invite-row-sub">
                  {strings.invite.usesOf(invite.uses, invite.maxUses)} · {invite.codeHash.slice(0, 8)}…
                </span>
              </span>
              <Button variant="ghost" type="button" className="danger" onClick={() => onRevoke(invite.codeHash)}>
                {strings.invite.revoke}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The "By link" mode of the invite sheet: create an invite link.
 *
 * The copy is blunt about what a link is, because the choice being made here is
 * a security one: naming somebody by address admits exactly that person, while a
 * link admits whoever ends up holding it. Expiry and a use limit are how you
 * bound that, so they are the first thing on the form rather than an advanced
 * option nobody opens.
 *
 * It was its own sheet, opened only from the member list footer. Now it is one
 * of three modes in `ConvidarSheet`, which is the single invite sheet: no
 * `Modal` and no header, because the sheet itself draws them.
 */
export function ConviteDeLink({ channel }: { channel: string }): React.JSX.Element {
  const bridge = useBridge()
  const toast = useToast()
  const [expiry, setExpiry] = useState<number | undefined>(86_400)
  const [uses, setUses] = useState<number | undefined>(1)
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Null while the first list is still in flight. */
  const [invites, setInvites] = useState<StoredInvite[] | null>(null)
  /*
    `actualizacao` only exists where the renderer is a frozen copy inside an
    installed application (see `EnclaveBridge`), and that is exactly where an
    https link does not open this window: it opens the browser. In the browser
    this sentence would be false.
    */
  const naAplicacaoInstalada = bridge.actualizacao !== undefined

  // The list is loaded when the sheet opens and refreshed after every mint,
  // so what is on screen is what the server will actually honour.
  useEffect(() => {
    let cancelled = false
    void bridge.invites
      .list(channel)
      .then((list) => {
        if (!cancelled) setInvites(list)
      })
      .catch(() => {
        // Offline, most likely. The sheet still mints; the list just stays out.
        if (!cancelled) setInvites(null)
      })
    return () => {
      cancelled = true
    }
  }, [channel, link])

  const create = (): void => {
    setBusy(true)
    void bridge.invites
      .create(channel, {
        ...(expiry !== undefined ? { expiresInSeconds: expiry } : {}),
        ...(uses !== undefined ? { maxUses: uses } : {}),
      })
      .then(setLink)
      .catch((error: Error) => toast(traduzirErro(error), "error"))
      .finally(() => setBusy(false))
  }

  const revoke = (codeHash: string): void => {
    void bridge.invites
      .revoke(codeHash)
      .then(() => {
        toast(strings.invite.revoked)
        setInvites((current) => current?.filter((invite) => invite.codeHash !== codeHash) ?? null)
      })
      .catch((error: Error) => toast(traduzirErro(error), "error"))
  }

  return (
    <>
      <div className="choice">
        <span className="choice-label">{strings.invite.expiresIn}</span>
        <div className="choice-row">
          {escolhasDePrazo().map((choice) => (
            <button
              key={choice.label}
              type="button"
              className={expiry === choice.seconds ? "chip on" : "chip"}
              aria-pressed={expiry === choice.seconds}
              onClick={() => {
                setExpiry(choice.seconds)
                setLink(null)
              }}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>

      <div className="choice">
        <span className="choice-label">{strings.invite.usesFor}</span>
        <div className="choice-row">
          {escolhasDeUsos().map((choice) => (
            <button
              key={choice.label}
              type="button"
              className={uses === choice.uses ? "chip on" : "chip"}
              aria-pressed={uses === choice.uses}
              onClick={() => {
                setUses(choice.uses)
                setLink(null)
              }}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>

      {link ? (
        <>
          <Field label={strings.invite.yourLink}>
            <input value={link} readOnly onFocus={(event) => event.target.select()} />
          </Field>
          {/* The QR code for the same link you copy: the short one, when there is one,
              makes a smaller QR code that is easier to read from one screen to
              another. */}
          <QrCode texto={link} alt={strings.invite.qrAlt} size={168} />
          <p className="field-note">{strings.invite.linkCare}</p>
          {naAplicacaoInstalada && <p className="field-note invite-desktop-note">{strings.invite.desktopNote}</p>}
        </>
      ) : (
        <p className="field-note">{strings.invite.waitingNote}</p>
      )}

      <div className="convidar-accao">
        {link ? (
          <Button
            variant="primary"
            type="button"
            onClick={() => {
              void copiarTexto(link)
                .then(() => toast(strings.invite.linkCopied))
                .catch(() => toast(strings.common.copyFailed, "error"))
            }}
          >
            {strings.invite.copyLink}
          </Button>
        ) : (
          <Button variant="primary" type="button" disabled={busy} onClick={create}>
            {busy ? strings.invite.creating : strings.invite.createLink}
          </Button>
        )}
      </div>

      {invites !== null && <ActiveInvites invites={invites} onRevoke={revoke} />}
    </>
  )
}
