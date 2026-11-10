import { useEffect, useId, useState } from "react"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { useBridge } from "../../App.js"
import type { Profile } from "../../bridge.js"
import { BotaoCopiarId } from "../../components/BotaoCopiarId.js"
import { Button } from "../../components/Button.js"
import { Enquadrar } from "../../components/Enquadrar.js"
import { Field } from "../../components/Field.js"
import { Interruptor } from "../../components/Interruptor.js"
import { Modal } from "../../components/Modal.js"
import { useConfirmar } from "../../hooks/useConfirmar.js"
import { podeEnquadrar } from "../../lib/enquadrar.js"
import { avisoDeAnimacaoPerdida, compressImage, IMAGE_BUDGETS, type CompressedImage } from "../../lib/images.js"
import { strings, traduzirErro } from "../../strings.js"

const DONATION_KINDS = ["url", "paypal", "kofi", "liberapay", "iban", "bitcoin", "monero", "outro"] as const

/**
 * The name caps at 32 characters.
 *
 * Measured, not chosen to taste: in the people panel the column is 149 px,
 * which gives eighteen characters before the ellipsis. A 64-character name
 * appeared cut off everywhere you need to recognize someone at a glance, and
 * a name nobody reads in full is not a name, it is a sign.
 *
 * The schema still accepts 64 on read, on purpose, see `payload.ts`. Anyone
 * who already has a longer name is still read in full; what changes is what
 * gets written anew.
 */
const NAME_MAX = 32

export function ProfileEditor({
  initial,
  address,
  onSaved,
  onClose,
  amigos,
}: {
  initial: Profile
  address: string | null
  onSaved: (profile: Profile) => void
  onClose: () => void
  /**
   * My friends, with the name already resolved, to choose who shows in the
   * list I display. Absent, the choice does not render.
   */
  amigos?: readonly { address: string; nome: string }[] | undefined
}): React.JSX.Element {
  const bridge = useBridge()
  const confirmar = useConfirmar()
  const [draft, setDraft] = useState<Profile>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The GIF that stopped moving because it was too heavy. It is not an error: the face changed. */
  const [avisoDoGif, setAvisoDoGif] = useState<string | null>(null)
  /** The file chosen, waiting to be framed in the sheet above. */
  const [aEnquadrar, setAEnquadrar] = useState<File | null>(null)
  const heading = useId()
  /*
    The friends list I display: off by default. `mostrados` is null while the
    bridge has not answered, and then nothing saves over what is there. Turning
    on chooses all friends; each one turns off by hand.
  */
  const podeMostrar = Boolean(amigos && bridge.social.setShownFriends && bridge.social.shownFriendsOf)
  const [mostradosAntes, setMostradosAntes] = useState<readonly string[] | null>(null)
  const [mostrados, setMostrados] = useState<readonly string[] | null>(null)
  useEffect(() => {
    if (!podeMostrar || !address) return
    const ler = bridge.social.shownFriendsOf
    if (!ler) return
    let vivo = true
    void ler(address)
      .then((guardado) => {
        if (!vivo) return
        const lista = guardado?.shown ?? []
        setMostradosAntes(lista)
        setMostrados(lista)
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [bridge, address, podeMostrar])
  const mostrar = (mostrados?.length ?? 0) > 0
  // As sets: the order in which the switches turn on is not a change.
  const listaMudou =
    mostrados !== null &&
    mostradosAntes !== null &&
    (mostrados.length !== mostradosAntes.length || mostrados.some((quem) => !mostradosAntes.includes(quem)))

  const patch = (changes: Partial<Profile>): void => setDraft((current) => ({ ...current, ...changes }))

  /**
   * The face, compressed in this device before leaving it.
   *
   * This used to refuse above 512 KB and save exactly what was below, and an
   * avatar is the most expensive image here, despite being the smallest on
   * screen. The profile is republished in EVERY channel the person belongs to,
   * and again whenever the makeup of one changes: one image costs (people ×
   * channels), not a copy. Half a megabyte like that multiplied was already
   * almost the whole database of a real server.
   *
   * Refusing did not solve anything either, it pushed the problem to the
   * person, who then had to find a way to shrink the photograph themselves.
   * Through the common compressor, 256 px and 96 KB give a sharp face at the
   * size it is drawn, with margin for dense screens, and an eighth of the old
   * cost. See `lib/images.ts` for the budgets and the reason for each one.
   *
   * An animated GIF goes up to 160 KB and keeps moving. Above that it stops,
   * and the sheet says why and what the maximum is.
   *
   * Before compressing, the person frames the face in a circle (requested on
   * November 2, 2026; see `components/Enquadrar.tsx`). A device that does not
   * know how to crop follows the old path: it compresses the whole image.
   */
  const pickAvatar = (file: File | undefined): void => {
    if (!file) return
    setError(null)
    setAvisoDoGif(null)
    if (podeEnquadrar()) {
      setAEnquadrar(file)
      return
    }
    void compressImage(file, IMAGE_BUDGETS.avatar)
      .then((imagem) => aplicarAvatar(file, imagem))
      .catch((erro: Error) => setError(traduzirErro(erro)))
  }

  const aplicarAvatar = (file: File, imagem: CompressedImage): void => {
    patch({ avatarDataUrl: imagem.dataUrl })
    setAvisoDoGif(avisoDeAnimacaoPerdida(file, imagem, IMAGE_BUDGETS.avatar))
  }

  const save = (): void => {
    if (!draft.displayName.trim()) {
      setError(strings.profileEditor.nameRequired)
      return
    }
    setBusy(true)
    setError(null)
    void bridge.profile
      .set({ ...draft, displayName: draft.displayName.trim() })
      .then(async () => {
        // The profile is already saved: tell whoever is above BEFORE the list,
        // which can fail (607) without undoing what already saved.
        onSaved(draft)
        // The list comes after the profile, and only when it changed: a new message
        // in my feed on each save. A failure stays in the sheet, which does not close.
        if (listaMudou && mostrados) {
          await bridge.social.setShownFriends?.([...mostrados])
          setMostradosAntes(mostrados)
        }
        onClose()
      })
      .catch((caught: Error) => setError(traduzirErro(caught)))
      .finally(() => setBusy(false))
  }

  // Click-outside and Escape with unsaved edits should not silently throw the
  // edits away — but they should not be trapped either. Ask.
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || listaMudou

  return (
    <Modal
      className="sheet"
      labelledBy={heading}
      onClose={onClose}
      confirmDiscard={() =>
        !dirty ||
        confirmar({
          titulo: strings.profileEditor.discard,
          corpo: strings.confirmar.descartarCorpo,
          verbo: strings.confirmar.descartar,
          destructive: true,
        })
      }
    >
      <header className="sheet-header">
        <h2 id={heading}>{strings.profileEditor.title}</h2>
        <Button variant="ghost" onClick={onClose}>
          {strings.common.close}
        </Button>
      </header>

      <p className="sheet-lead">{strings.profileEditor.lead}</p>

      <div className="sheet-body">
        <div className="avatar-row">
          <div className="avatar-preview">
            {draft.avatarDataUrl ? (
              <img src={draft.avatarDataUrl} alt="" />
            ) : (
              <span>{(draft.displayName[0] ?? address?.[1] ?? "?").toUpperCase()}</span>
            )}
          </div>
          <div className="avatar-actions">
            <label className="ghost file">
              {strings.profileEditor.chooseImage}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => {
                  pickAvatar(event.target.files?.[0])
                  // Clear the field: after clicking Cancel, opening the same file again must reopen the sheet.
                  event.target.value = ""
                }}
              />
            </label>
            {draft.avatarDataUrl && (
              <Button
                variant="ghost"
                // Drop the key rather than set it to undefined: with
                // exactOptionalPropertyTypes those are different things.
                onClick={() => {
                  setDraft(({ avatarDataUrl: _removed, ...rest }) => rest)
                  setAvisoDoGif(null)
                }}
              >
                {strings.profileEditor.remove}
              </Button>
            )}
          </div>
        </div>

        {avisoDoGif && (
          <p className="hint" role="status">
            {avisoDoGif}
          </p>
        )}

        <Field label={strings.profileEditor.name}>
          <input
            value={draft.displayName}
            maxLength={NAME_MAX}
            placeholder={strings.profileEditor.namePlaceholder}
            onChange={(event) => patch({ displayName: event.target.value })}
          />
        </Field>

        {/* No Status field: status changes on the account card, through the "How you appear"
            menu and "Custom…" (owner's order, October 27, 2026). Two places for the same
            line kept disagreeing. Text already there stays in the draft and saves as is:
            leaving the editor does not erase it. */}
        <Field label={strings.profileEditor.bio}>
          <textarea
            value={draft.bio ?? ""}
            maxLength={1000}
            rows={3}
            onChange={(event) => patch({ bio: event.target.value })}
          />
        </Field>
        {/* The difference from status, shown below the field: owner's request,
            October 27, 2026, labeled "Bio". */}
        <p className="field-note">{strings.profileEditor.bioNote}</p>

        <Field
          label={
            <>
              {strings.profileEditor.email} <span className="optional">{strings.profileEditor.optional}</span>
            </>
          }
        >
          <input
            value={draft.email ?? ""}
            maxLength={254}
            placeholder={strings.profileEditor.emailPlaceholder}
            onChange={(event) => patch({ email: event.target.value })}
          />
        </Field>
        <p className="field-note">{strings.profileEditor.emailNote}</p>

        <fieldset className="donations">
          <legend>{strings.profileEditor.donations}</legend>
          {draft.donations.map((entry, index) => (
            <div className="donation-row" key={index}>
              <select
                value={entry.kind}
                onChange={(event) => {
                  const next = [...draft.donations]
                  next[index] = { ...entry, kind: event.target.value }
                  patch({ donations: next })
                }}
              >
                {DONATION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
              {/*
                The caps come from the schema (48 and 256, in `profile.donations`).
                Without them, writing too much would not warn anyone: `encodePayload`
                would fail on send, and the entire profile, name, picture, bio,                 would stop being sent. Tightening the write costs nothing; letting it
                get ahead of the read costs the entire payload.
                */}
              <input
                value={entry.label}
                maxLength={48}
                placeholder={strings.profileEditor.donationLabelPlaceholder}
                onChange={(event) => {
                  const next = [...draft.donations]
                  next[index] = { ...entry, label: event.target.value }
                  patch({ donations: next })
                }}
              />
              <input
                value={entry.value}
                maxLength={256}
                placeholder={strings.profileEditor.donationValuePlaceholder}
                onChange={(event) => {
                  const next = [...draft.donations]
                  next[index] = { ...entry, value: event.target.value }
                  patch({ donations: next })
                }}
              />
              <Button
                variant="ghost"
                title={strings.common.remove}
                ariaLabel={strings.common.remove}
                onClick={() => patch({ donations: draft.donations.filter((_, i) => i !== index) })}
              >
                ×
              </Button>
            </div>
          ))}
          {draft.donations.length < 8 && (
            <Button
              variant="ghost"
              className="wide"
              onClick={() => patch({ donations: [...draft.donations, { kind: "url", label: "", value: "" }] })}
            >
              {strings.profileEditor.add}
            </Button>
          )}
          <p className="field-note">{strings.profileEditor.donationsNote}</p>
        </fieldset>

        {podeMostrar && amigos && (
          <fieldset className="mostrar-amigos" disabled={mostrados === null}>
            <legend className="sr-only">{strings.profileEditor.showFriends}</legend>
            <Interruptor
              ligado={mostrar}
              rotulo={strings.profileEditor.showFriends}
              disabled={mostrados === null || amigos.length === 0}
              onMudar={(ligar) => setMostrados(ligar ? amigos.map((amigo) => amigo.address) : [])}
            />
            <p className="field-note">
              {amigos.length === 0 ? strings.profileEditor.showFriendsEmpty : strings.profileEditor.showFriendsNote}
            </p>
            {mostrar && (
              <ul className="mostrar-amigos-lista" aria-label={strings.profileEditor.showFriendsWho}>
                {amigos.map((amigo) => (
                  <li key={amigo.address}>
                    <Interruptor
                      ligado={mostrados?.includes(amigo.address) ?? false}
                      rotulo={amigo.nome}
                      onMudar={(ligar) =>
                        setMostrados((actual) => {
                          const sem = (actual ?? []).filter((quem) => quem !== amigo.address)
                          return ligar ? [...sem, amigo.address] : sem
                        })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        )}
      </div>

      {error && (
        <p className="error">
          <TextoDeErro texto={error} />
        </p>
      )}

      {aEnquadrar && (
        <Enquadrar
          ficheiro={aEnquadrar}
          forma="circulo"
          budget={IMAGE_BUDGETS.avatar}
          onGuardar={(imagem) => {
            aplicarAvatar(aEnquadrar, imagem)
            setAEnquadrar(null)
          }}
          onCancelar={() => setAEnquadrar(null)}
        />
      )}

      <footer className="sheet-actions">
        {/* The id is not read, it is copied (owner's order, October 27, 2026). The
            empty `<span>` holds the space on the left: "Save" stays on the right. */}
        {address ? <BotaoCopiarId id={address} rotulo={strings.copiarId.proprio} /> : <span />}
        <Button variant="primary" disabled={busy} onClick={save}>
          {busy ? strings.profileEditor.saving : strings.profileEditor.save}
        </Button>
      </footer>
    </Modal>
  )
}
