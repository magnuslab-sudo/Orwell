import type { AvisoDeActualizacao as Aviso } from "../bridge.js"
import { strings } from "../strings.js"
import { Button } from "./Button.js"

/**
 * "There is a new version", and the path to get it.
 *
 * **It does not update anything, and the interface does not pretend it does.** There
 * is no automatic update in this application and there will not be until the
 * installers are signed, the full reason, along with what signing would unlock,
 * is in the header of `apps/client/src/main/actualizacao.ts`. The
 * button says where it leads ("Go to downloads") and not what we wish
 * it would do.
 *
 * **The checksum is visible on purpose.** Without code signing, the SHA-256
 * published next to the file is the only defense against a tampered installer, and a checksum
 * that only exists on a page no one opens defends against nothing. Someone reading it
 * here, before downloading, can compare it afterward.
 *
 * Only exists in the installed application: in the browser there is no version to fall
 * behind. The absence of `bridge.actualizacao` decides that, not this
 * component.
 *
 * No state inside here, one warning in, two gestures out, and so
 * it is measurable without main process, without network and without a clock.
 */
export function AvisoDeActualizacao({
  aviso,
  onDescarregar,
  onDispensar,
}: {
  /** What is new, or `null` when there is nothing to say. */
  aviso: Aviso | null
  onDescarregar: () => void
  onDispensar: () => void
}): React.JSX.Element | null {
  if (!aviso) return null

  return (
    /*
      `status` not `alert`: this is information not an emergency. An
      `alert` interrupts what a screen reader is saying, and interrupting
      someone in the middle of a conversation to talk about a version number is
      exactly the kind of warning people learn to ignore.
    */
    <div className="aviso-versao" role="status" aria-live="polite">
      <h2 className="aviso-versao-titulo">{strings.actualizacao.titulo}</h2>
      <p className="aviso-versao-versoes">
        {aviso.nome
          ? strings.actualizacao.versoesComNome(aviso.instalada, aviso.disponivel, aviso.nome)
          : strings.actualizacao.versoes(aviso.instalada, aviso.disponivel)}
      </p>
      <p className="aviso-versao-nota">{strings.actualizacao.nota}</p>

      {aviso.soma && (
        <div className="aviso-versao-soma">
          <span className="aviso-versao-rotulo">{strings.actualizacao.somaRotulo}</span>
          {/*
            Break anywhere, and it is measure not style: 64 characters
            without a space, and on a 320px card they push everything next to it out. Someone
            wanting to verify it copies it; someone who does not see a small
            block of text that does not wreck the card.
          */}
          <code>{aviso.soma}</code>
          <span className="aviso-versao-nota">{strings.actualizacao.somaNota}</span>
        </div>
      )}

      <div className="aviso-versao-gestos">
        <Button variant="primary" onClick={onDescarregar}>
          {strings.actualizacao.descarregar}
        </Button>
        <Button
          variant="ghost"
          onClick={onDispensar}
          title={strings.actualizacao.dispensarTitulo(aviso.disponivel)}
        >
          {strings.actualizacao.dispensar}
        </Button>
      </div>
    </div>
  )
}
