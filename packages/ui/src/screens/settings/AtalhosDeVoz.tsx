import { useEffect, useState, type ReactElement } from "react"
import type { EnclaveBridge } from "../../bridge.js"
import { Button } from "../../components/Button.js"
import { useToast } from "../../components/Toast.js"
import {
  ACCOES_DE_VOZ,
  ACCOES_GLOBAIS,
  ATALHOS_POR_OMISSAO,
  SO_NA_SECRETARIA,
  avisoDaCombinacao,
  combinacaoDeEvento,
  combinacaoDeRato,
  combinacaoValida,
  formatarCombinacao,
  pedeAcessibilidadeNoMac,
  plataformaDoTeclado,
  type AccaoDeVoz,
  type MapaDeAtalhos,
} from "../../lib/atalhosDeVoz.js"
import { strings } from "../../strings.js"

/**
 * The keyboard shortcut card for voice commands.
 *
 * One line per command: what it does, the key it has, and "Change". Clicking
 * "Change" makes that line listen for the next key combo that goes down on the
 * keyboard; Esc gives up. The combo only enters if it is a valid shortcut (see
 * `combinacaoValida`), and if it already belonged to another command, it leaves
 * there: a key with two owners did two things, and no one wants that.
 *
 * From 1.0.6 on, any single key enters and mouse buttons 4 and 5 (point 8 of
 * `docs/planos/depois-da-1-0.md`). A key that types enters with a warning,
 * because its cost only shows later: either it does not work in a text box, or
 * (in the desktop app, during a call) it stops typing in other apps. `atalhosGlobais`
 * only exists in the desktop app.
 */
export function AtalhosDeVoz({
  mapa,
  onMudar,
  atalhosGlobais,
}: {
  mapa: MapaDeAtalhos
  onMudar: (mapa: MapaDeAtalhos) => void
  atalhosGlobais?: EnclaveBridge["atalhosGlobais"]
}): ReactElement {
  const [aGravar, setAGravar] = useState<AccaoDeVoz | null>(null)
  const toast = useToast()
  const plataforma = plataformaDoTeclado()
  const naSecretaria = atalhosGlobais !== undefined

  /*
    While recording, the globals stop. Without this, during a call, the key
    that mutes today would mute again instead of reaching the recorder: the
    system delivers it to the global shortcut before the window.
  */
  useEffect(() => {
    if (!aGravar || !atalhosGlobais) return
    void atalhosGlobais.suspender(true).catch(() => {})
    return () => {
      void atalhosGlobais.suspender(false).catch(() => {})
    }
  }, [aGravar, atalhosGlobais])

  useEffect(() => {
    if (!aGravar) return
    const accao = aGravar
    const gravar = (combinacao: string): void => {
      if (!combinacaoValida(combinacao)) {
        toast(strings.settings.atalhoInvalido, "error")
        return
      }
      const proximo: MapaDeAtalhos = { ...mapa }
      for (const outra of ACCOES_DE_VOZ) if (proximo[outra] === combinacao) proximo[outra] = null
      proximo[accao] = combinacao
      onMudar(proximo)
      setAGravar(null)
      const aviso = avisoDaCombinacao(combinacao)
      const global = naSecretaria && (ACCOES_GLOBAIS as readonly AccaoDeVoz[]).includes(accao)
      if (aviso === "escreve" && global) toast(strings.settings.atalhoAvisoEscreve, "info")
      else if (aviso !== null) toast(strings.settings.atalhoAvisoComum, "info")
    }
    const aoCarregar = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault()
        setAGravar(null)
        return
      }
      const combinacao = combinacaoDeEvento(event)
      if (!combinacao) return
      event.preventDefault()
      event.stopPropagation()
      gravar(combinacao)
    }
    /*
      Mouse buttons 4 and 5. The others pass through: clicking "Change" again
      must keep canceling. The `mouseup` and `auxclick` are also stopped,
      or the browser would read button 4 as "back" and leave Settings.
    */
    const aoCarregarNoRato = (event: MouseEvent): void => {
      const combinacao = combinacaoDeRato(event)
      if (!combinacao) return
      event.preventDefault()
      event.stopPropagation()
      gravar(combinacao)
    }
    const engolirORato = (event: MouseEvent): void => {
      if (combinacaoDeRato(event)) event.preventDefault()
    }
    // On capture, before other listeners: the combination the user is choosing cannot trigger their current shortcut.
    document.addEventListener("keydown", aoCarregar, true)
    document.addEventListener("mousedown", aoCarregarNoRato, true)
    document.addEventListener("mouseup", engolirORato, true)
    document.addEventListener("auxclick", engolirORato, true)
    return () => {
      document.removeEventListener("keydown", aoCarregar, true)
      document.removeEventListener("mousedown", aoCarregarNoRato, true)
      document.removeEventListener("mouseup", engolirORato, true)
      document.removeEventListener("auxclick", engolirORato, true)
    }
  }, [aGravar, mapa, onMudar, toast, naSecretaria])

  // On macOS, a global media key requires Accessibility permission.
  const pedeAcessibilidade =
    naSecretaria &&
    plataforma === "mac" &&
    ACCOES_GLOBAIS.some((accao) => {
      const combinacao = mapa[accao]
      return combinacao !== null && pedeAcessibilidadeNoMac(combinacao)
    })

  return (
    <section className="card settings-card" aria-label={strings.settings.atalhos}>
      <h2>{strings.settings.atalhos}</h2>
      <p className="settings-note">{naSecretaria ? strings.settings.atalhosNotaSecretaria : strings.settings.atalhosNota}</p>
      {pedeAcessibilidade && (
        <p className="settings-note" data-aviso="acessibilidade">
          {strings.settings.atalhoSemAcessibilidade}{" "}
          <Button variant="ghost" onClick={() => void atalhosGlobais?.abrirAcessibilidade().catch(() => {})}>
            {strings.settings.atalhoAbrirAcessibilidade}
          </Button>
        </p>
      )}
      <ul className="atalhos">
        {ACCOES_DE_VOZ.filter((accao) => naSecretaria || !SO_NA_SECRETARIA.includes(accao)).map((accao) => {
          const combinacao = mapa[accao]
          const emCaptura = aGravar === accao
          return (
            <li key={accao} className="atalho" data-accao={accao}>
              <span className="atalho-rotulo">{strings.settings.atalhoAccao[accao]}</span>
              <span className="atalho-tecla" aria-live="polite">
                {emCaptura ? (
                  <em>{strings.settings.atalhoAGravar}</em>
                ) : combinacao ? (
                  <kbd>{formatarCombinacao(combinacao, plataforma, strings.settings.atalhoRato)}</kbd>
                ) : (
                  <span className="atalho-vazio">{strings.settings.atalhoNenhum}</span>
                )}
              </span>
              <span className="atalho-botoes">
                <Button
                  variant="ghost"
                  aria-pressed={emCaptura}
                  onClick={() => setAGravar(emCaptura ? null : accao)}
                >
                  {strings.settings.atalhoMudar}
                </Button>
                {combinacao && !emCaptura && (
                  <Button variant="ghost" onClick={() => onMudar({ ...mapa, [accao]: null })}>
                    {strings.settings.atalhoLimpar}
                  </Button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <div>
        <Button variant="ghost" onClick={() => onMudar({ ...ATALHOS_POR_OMISSAO })}>
          {strings.settings.atalhosRepor}
        </Button>
      </div>
    </section>
  )
}
