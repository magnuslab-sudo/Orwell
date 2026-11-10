import { useId } from "react"
import type { FonteDeEcra } from "../../bridge.js"
import { Button } from "../../components/Button.js"
import { Modal } from "../../components/Modal.js"
import { strings } from "../../strings.js"

/**
 * The window selector for the installed application.
 *
 * In the browser this does not exist and is not needed: Chrome opens its selector,
 * already translated, and the page never sees the list. Inside Electron the
 * selector is ours, the `setDisplayMediaRequestHandler` in the main process
 * gets the request, stores it, and waits for a response only the interface can
 * give. Without this screen the request would time out after two minutes, and the
 * share button was a button that did nothing.
 *
 * Runs on all systems, macOS 15+ included: the system selector (`useSystemPicker`)
 * is off because it skipped the handler and sharing came out mute. See
 * `USAR_SELECTOR_DO_SISTEMA` in `apps/client/src/main/ecra.ts`.
 *
 * **System audio always goes**, where the system gives it (`somDisponivel`). It
 * was a box off by default until 2/11/2026, and the owner does not want it: "that
 * does not need to be an option, audio is also broadcast by default". A line stays
 * that says this, because system audio also carries the call voice, and explains
 * how to mute it midway ("Mute screen sound", in the call).
 *
 * Component with no host link on purpose: gets the list and returns the choice.
 * Whoever talks to IPC is `usePartilhaDeEcra`.
 */
export function ScreenPicker({
  fontes,
  aCarregar,
  somDisponivel = false,
  soSom = null,
  onEscolher,
  onCancelar,
}: {
  fontes: FonteDeEcra[]
  /** The system is still building the list. Different from having nothing. */
  aCarregar: boolean
  /** The system plays its audio: the box appears. */
  somDisponivel?: boolean
  /**
   * DJ audio-only mode (tab or window): windows only, no image output.
   * Electron plays the system audio, not the window audio: that's how it works.
   */
  soSom?: "separador" | "janela" | null | undefined
  /** The source you chose. Audio is not a choice: it goes wherever the system sends it. */
  onEscolher: (fonte: FonteDeEcra) => void
  /**
   * Dismiss.
   *
   * The normal path, not an error: the caller opened the picker and closed it,
   * changed their mind. What cannot happen is the request left unanswered, so
   * this is also called by the escape key and clicks outside, the `Modal`
   * handles both.
   */
  onCancelar: () => void
}): React.JSX.Element {
  const titulo = useId()
  /*
    Screens first, then everything else in the order the system gave it.

    The system order is by recent use, which is a good order and we don't
    change it. What we do change is the split: a full screen and a window are
    different choices with different consequences, and someone looking for "the
    whole screen" should not have to find it among forty windows.
  */
  const ecras = soSom ? [] : fontes.filter((fonte) => fonte.ecraInteiro)
  const janelas = fontes.filter((fonte) => !fonte.ecraInteiro)
  const aria = soSom ? strings.ecra.escolherSomAria : strings.ecra.escolherAria

  const grupo = (titulo: string, lista: FonteDeEcra[]): React.JSX.Element | null =>
    lista.length === 0 ? null : (
      <section className="ecra-grupo">
        <h3>{titulo}</h3>
        <div className="ecra-fontes">
          {lista.map((fonte) => {
            /*
              The label for untitled windows, repeated here.

              The main process already applies it in `reduzirFontes`, and yet
              this exists: a source that arrives with no name draws a grey box
              with no image and no text, and a silent box in the middle of a
              grid cannot be chosen because you don't know what it is. This
              was seen in a measurement with a real layout engine, where these
              things show up: in jsdom an empty name is an empty text node and
              nobody notices it.
            */
            const nome = fonte.nome.trim() || strings.ecra.semNome
            return (
            <button
              key={fonte.id}
              type="button"
              className="ecra-fonte"
              aria-label={aria(nome)}
              onClick={() => onEscolher(fonte)}
            >
              {/* No thumbnail, no `<img>`: macOS returns windows with no
                  image, and an element with `src=""` draws a broken-image icon
                  , worse than having no image at all. The name stays, and that
                  is what identifies the window. */}
              {fonte.miniatura !== "" && <img src={fonte.miniatura} alt="" />}
              <span className="ecra-nome">{nome}</span>
            </button>
            )
          })}
        </div>
      </section>
    )

  return (
    <Modal className="sheet" labelledBy={titulo} onClose={onCancelar}>
      <header className="sheet-header">
        <h2 id={titulo}>{soSom ? strings.ecra.escolherSomTitulo : strings.ecra.escolherTitulo}</h2>
        <Button variant="ghost" type="button" onClick={onCancelar}>
          {strings.common.close}
        </Button>
      </header>

      <p className="sheet-lead">{soSom ? strings.ecra.escolherSomLead : strings.ecra.escolherLead}</p>

      <div className="sheet-body">
        {/* The line comes BEFORE the list: choosing a source closes the picker, and
            a line at the bottom of forty windows would not be readable in time. */}
        {soSom ? (
          <>
            <p className="field-note" role="note">
              {strings.musica.notaDaFonte(soSom, true)}
            </p>
            <p className="field-note aviso">{strings.musica.ecoNaApp}</p>
          </>
        ) : (
          somDisponivel && (
            <p className="field-note" role="note">
              {strings.ecra.somDoSistemaNota}
            </p>
          )
        )}
        {/* "Searching" and "nothing found" are different states, and mixing them
            makes people give up on a list that is still coming in. */}
        {aCarregar && fontes.length === 0 && <p className="field-note">{strings.ecra.aCarregar}</p>}
        {!aCarregar && fontes.length === 0 && <p className="field-note">{strings.ecra.vazio}</p>}

        {grupo(strings.ecra.ecras, ecras)}
        {ecras.length > 0 && <p className="field-note">{strings.ecra.ecraInteiroNota}</p>}
        {grupo(strings.ecra.janelas, janelas)}
      </div>

      <div className="sheet-actions">
        <Button variant="ghost" type="button" onClick={onCancelar}>
          {strings.common.cancel}
        </Button>
      </div>
    </Modal>
  )
}
