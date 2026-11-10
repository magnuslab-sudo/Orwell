import { useEffect, useId, useRef, useState } from "react"
import type { AlvoDaDenuncia, DenunciaPreparada, EscolhaDaDenuncia as EscolhaDoNucleo, ItemPreparado } from "@enclave/client-core"
import { MOTIVOS, NOTA_MAX, type Motivo } from "@enclave/protocol"
import { useBridge } from "../../App.js"
import { Avatar } from "../../components/Avatar.js"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { Modal } from "../../components/Modal.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { BandeiraIcon, EnvelopeIcon, EtiquetaIcon, HashIcon, LockIcon, NotaIcon, PersonIcon, VistoIcon } from "../../icons.js"
import { formatarBytes } from "../../lib/ficheiros.js"
import { nomeEmFalta } from "../../lib/format.js"
import { VERSAO_DA_APP } from "../../lib/versao.js"
import { strings, translateError, traduzirErro } from "../../strings.js"
import {
  PASSOS_A_VISTA,
  passoAVista,
  passoAnterior,
  passoSeguinte,
  pedeDetalhes,
  validarEscolha,
  type EscolhaDaDenuncia,
  type PassoDaDenuncia,
} from "./denunciar.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

/**
 * The report sheet for a message or a person (`docs/planos/denuncias-design.md`,
 * §4 and §9b). Opens from the message menu (`ChatScreen`) and the person
 * menu (`menuDaPessoa`, linked in `App`). Both use this flow.
 *
 * The design is what the owner chose on 4/11/2026 (`docs/planos/denunciar-layout/`):
 * on desktop, a step-by-step window (Reason, Review, Send); on mobile,
 * a bottom sheet with a handle and the button fixed at the bottom. Styles in
 * `styles/folhaDeDenunciar.css`.
 *
 * The steps and rules live in `denunciar.ts`. The preview shows OUR
 * copy (`itens`) as it leaves the device: the author, day and time in
 * UTC, the signed original text (an edited message goes as it was written
 * first) and attachments only by name, type and size. No image is drawn.
 * Addresses go in the request, and stay in the "Show addresses" detail.
 *
 * The founder warning only appears when a copy goes (`temCopia`).
 */
export function DenunciarSheet({
  alvo,
  nomeDoAlvo,
  nomeDe = nomeEmFalta,
  nomeDoCanal,
  nomeDaSala = (sala) => sala,
  onClose,
}: {
  alvo: AlvoDaDenuncia
  /** The name of who is being reported, already resolved by the caller. */
  nomeDoAlvo: string
  /** The name of each author in the preview. Without it, `nomeEmFalta` (the address word, subtle); the address stays in addresses. */
  nomeDe?: ((endereco: string) => string) | undefined
  /** The readable name of the channel. Without it, the channel line does not appear. */
  nomeDoCanal?: string | undefined
  /** The readable name of the report room. Without it, the identifier. */
  nomeDaSala?: ((sala: string) => string) | undefined
  onClose: () => void
}): React.JSX.Element {
  const bridge = useBridge()
  const heading = useId()
  const t = strings.denunciar
  const [passo, setPasso] = useState<PassoDaDenuncia>("motivo")
  const [escolha, setEscolha] = useState<EscolhaDaDenuncia>({ motivo: null, nota: "", boaFe: false, nome: "", email: "" })
  const [preparada, setPreparada] = useState<DenunciaPreparada | null>(null)
  /** The preparation failure stays separate: changing the choice does not clear it. */
  const [erroDaPreparacao, setErroDaPreparacao] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aEnviar, setAEnviar] = useState(false)
  // The target stays the one from opening: the caller builds it each render, and
  // preparation does not repeat because of that.
  const [alvoFixo] = useState(alvo)
  /** The step title. Receives focus when the step changes. */
  const tituloDoPasso = useRef<HTMLHeadingElement | null>(null)
  const primeiroDesenho = useRef(true)

  const mudar = (parte: Partial<EscolhaDaDenuncia>): void => {
    setEscolha((antes) => ({ ...antes, ...parte }))
    setErro(null)
  }

  /* The report prepares once, on open: the reason step already shows the
     reported message. Prepare only reads the vault and asks the server who the
     founder is; nothing leaves the device before "Send report". Going back and
     changing the reason does not change what leaves the device. */
  useEffect(() => {
    const denuncias = bridge.denuncias
    if (!denuncias) {
      setErroDaPreparacao(strings.common.unsupported)
      return
    }
    let viva = true
    denuncias
      .preparar(alvoFixo)
      .then((feita) => {
        if (viva) setPreparada(feita)
      })
      .catch((e: unknown) => {
        if (viva) setErroDaPreparacao(traduzirErro(e))
      })
    return () => {
      viva = false
    }
  }, [bridge, alvoFixo])

  /* Focus follows the step: the button that was pressed disappears, and the
     screen reader reads the new title. On first render the `Modal` already set
     focus. */
  useEffect(() => {
    if (primeiroDesenho.current) {
      primeiroDesenho.current = false
      return
    }
    tituloDoPasso.current?.focus()
  }, [passo])

  const enviar = async (lista: DenunciaPreparada): Promise<void> => {
    const denuncias = bridge.denuncias
    const motivo = escolha.motivo
    if (!denuncias || motivo === null) return
    setAEnviar(true)
    setErro(null)
    try {
      await denuncias.enviar(lista, escolhaDoNucleo(motivo, escolha))
      setPasso("enviada")
    } catch (e: unknown) {
      setErro(traduzirErro(e))
    } finally {
      setAEnviar(false)
    }
  }

  const continuar = (): void => {
    if (passo === "motivo") {
      const falta = validarEscolha(escolha)
      if (falta !== null) {
        setErro(translateError(falta))
        return
      }
    }
    const proximo = passoSeguinte(passo, escolha, preparada?.temCopia ?? false)
    if (proximo === "enviada") {
      if (preparada) void enviar(preparada)
      return
    }
    setErro(null)
    setPasso(proximo)
  }

  const voltar = (): void => {
    setErro(null)
    setPasso(passoAnterior(passo))
  }

  const titulo = alvo.mensagem ? t.tituloMensagem(nomeDoAlvo) : t.tituloPessoa(nomeDoAlvo)
  // The preview button sends when there is no warning to follow.
  const enviaJa = passo === "aviso" || (passo === "previsualizacao" && preparada !== null && !preparada.temCopia)
  const comDetalhes = escolha.motivo !== null && pedeDetalhes(escolha.motivo)

  return (
    <Modal
      className="sheet denunciar"
      labelledBy={heading}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault()
        if (passo !== "enviada" && !aEnviar) continuar()
      }}
    >
      <span className="denunciar-pega" aria-hidden="true" />
      <header className="sheet-header">
        <h2 id={heading}>{titulo}</h2>
        <Button variant="ghost" type="button" onClick={onClose}>
          {strings.common.close}
        </Button>
      </header>

      <Passos passo={passo} />

      {/* `key`: each step enters fresh, and the fade restarts. */}
      <div className="sheet-body denunciar-corpo" key={passo}>
        {passo === "motivo" && (
          <>
            <h3 className="sr-only" tabIndex={-1} ref={tituloDoPasso}>
              {t.passos.motivo}
            </h3>
            <CartaoDoAlvo alvo={alvoFixo} nomeDoAlvo={nomeDoAlvo} preparada={preparada} nomeDe={nomeDe} />
            <fieldset className="denunciar-motivos">
              <legend>{t.motivoLegenda}</legend>
              {MOTIVOS.map((motivo) => (
                <label key={motivo} className="denunciar-motivo" htmlFor={`${heading}-motivo-${motivo}`}>
                  <input
                    id={`${heading}-motivo-${motivo}`}
                    type="radio"
                    name={`${heading}-motivo`}
                    checked={escolha.motivo === motivo}
                    onChange={() => mudar({ motivo })}
                  />
                  {t.motivos[motivo]}
                </label>
              ))}
            </fieldset>

            {comDetalhes && (
              <div className="sheet-grupo denunciar-detalhes">
                <Field label={escolha.motivo === 8 ? t.notaObrigatoria : t.nota}>
                  <textarea
                    value={escolha.nota}
                    maxLength={NOTA_MAX}
                    rows={3}
                    onChange={(event) => mudar({ nota: event.target.value })}
                  />
                </Field>
                <p className="field-note">{t.notaDica}</p>
                <label className="checkbox denunciar-boa-fe" htmlFor={`${heading}-boa-fe`}>
                  <input
                    id={`${heading}-boa-fe`}
                    type="checkbox"
                    checked={escolha.boaFe}
                    onChange={(event) => mudar({ boaFe: event.target.checked })}
                  />
                  {t.boaFe}
                </label>
                <fieldset className="denunciar-contacto">
                  <legend>{t.contactoLegenda}</legend>
                  <Field label={t.nome}>
                    <input value={escolha.nome} autoComplete="name" onChange={(event) => mudar({ nome: event.target.value })} />
                  </Field>
                  <Field label={t.email}>
                    <input
                      type="email"
                      value={escolha.email}
                      autoComplete="email"
                      onChange={(event) => mudar({ email: event.target.value })}
                    />
                  </Field>
                  <p className="field-note">{t.contactoNota}</p>
                </fieldset>
              </div>
            )}
          </>
        )}

        {passo === "previsualizacao" && (
          <>
            <h3 className="denunciar-titulo-do-passo" tabIndex={-1} ref={tituloDoPasso}>
              {t.previsualizacaoTitulo}
            </h3>
            {preparada === null ? (
              erroDaPreparacao === null && <p className="field-note">{t.aPreparar}</p>
            ) : (
              <Previsualizacao
                preparada={preparada}
                escolha={escolha.motivo !== null ? escolhaDoNucleo(escolha.motivo, escolha) : null}
                nomeDe={nomeDe}
                nomeDoCanal={nomeDoCanal}
                nomeDaSala={nomeDaSala}
              />
            )}
          </>
        )}

        {passo === "aviso" && (
          <>
            <h3 className="denunciar-titulo-do-passo" tabIndex={-1} ref={tituloDoPasso}>
              {t.avisoTitulo}
            </h3>
            <p className="field-note warn denunciar-aviso">{t.aviso}</p>
          </>
        )}

        {passo === "enviada" && (
          <div className="denunciar-enviada">
            <span className="denunciar-enviada-marca" aria-hidden="true">
              <VistoIcon size={28} />
            </span>
            <h3 className="sr-only" tabIndex={-1} ref={tituloDoPasso}>
              {t.passos.enviar}
            </h3>
            <p className="field-note" role="status">
              {t.enviada}
            </p>
          </div>
        )}

        {erroDaPreparacao !== null && passo !== "enviada" && (
          <p className="field-note warn" role="alert">
            <TextoDeErro texto={erroDaPreparacao} />
          </p>
        )}
        {erro !== null && (
          <p className="field-note warn" role="alert">
            <TextoDeErro texto={erro} />
          </p>
        )}
      </div>

      <div className="sheet-actions">
        {passo === "enviada" ? (
          <Button variant="primary" type="button" onClick={onClose}>
            {strings.common.close}
          </Button>
        ) : (
          <>
            {passo !== "motivo" && (
              <Button variant="ghost" type="button" disabled={aEnviar} onClick={voltar}>
                {t.voltar}
              </Button>
            )}
            <Button
              variant="primary"
              type="submit"
              disabled={
                aEnviar ||
                (passo === "motivo" && escolha.motivo === null) ||
                (passo === "previsualizacao" && preparada === null)
              }
            >
              {aEnviar ? t.aEnviar : enviaJa ? t.enviar : t.continuar}
            </Button>
          </>
        )}
      </div>
    </Modal>
  )
}

/**
 * The indicator of the three steps. The current one gets `aria-current="step"`;
 * the past ones get a checkmark and, for the screen reader, the word "done".
 * On confirmation, all three are done and the last one is still the current.
 */
function Passos({ passo }: { passo: PassoDaDenuncia }): React.JSX.Element {
  const t = strings.denunciar
  const agora = PASSOS_A_VISTA.indexOf(passoAVista(passo))
  const tudoFeito = passo === "enviada"
  return (
    <ol className="denunciar-passos" aria-label={t.passosRotulo}>
      {PASSOS_A_VISTA.map((nome, indice) => {
        const feito = indice < agora || tudoFeito
        const estado = indice === agora ? "agora" : feito ? "feito" : "depois"
        return (
          <li
            key={nome}
            className="denunciar-passo"
            data-estado={tudoFeito ? "feito" : estado}
            aria-current={indice === agora ? "step" : undefined}
          >
            <span className="denunciar-passo-numero" aria-hidden="true">
              {feito ? <VistoIcon size={14} /> : indice + 1}
            </span>
            <span className="denunciar-passo-nome">{t.passos[nome]}</span>
            {feito && <span className="sr-only">{` (${t.passoFeito})`}</span>}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * What is reported, at the top of the first step: the message (author, time and
 * text) or the person, with the "Reported" badge. The message arrives with
 * preparation; until then, only the name.
 */
function CartaoDoAlvo({
  alvo,
  nomeDoAlvo,
  preparada,
  nomeDe,
}: {
  alvo: AlvoDaDenuncia
  nomeDoAlvo: string
  preparada: DenunciaPreparada | null
  nomeDe: (endereco: string) => string
}): React.JSX.Element {
  const t = strings.denunciar
  const caixa = strings.roomProperties.denuncias
  const item = alvo.mensagem ? preparada?.itens.find((i) => i.denunciada) : undefined
  const nome = item ? nomeDe(item.autor) : nomeDoAlvo
  const enderecoDoNome = item ? item.autor : alvo.pessoa
  return (
    <div className="denunciar-alvo" data-testid="denunciar-alvo">
      <Avatar profile={undefined} fallback={inicial(nome)} />
      <div className="denunciar-alvo-texto">
        <p className="denunciar-alvo-cabecalho">
          <strong>
            <NomeDePessoa nome={nome} endereco={enderecoDoNome} />
          </strong>
          {item && <span className="denunciar-quando">{`${item.hora} UTC`}</span>}
        </p>
        {item && (
          <p className="denunciar-alvo-mensagem">
            {item.texto !== "" ? item.texto : item.anexos.length > 0 ? caixa.anexo(item.anexos[0]!.name, item.anexos[0]!.mediaType) : caixa.semTexto}
          </p>
        )}
      </div>
      <span className="denunciar-pilula">{t.denunciadaPilula}</span>
    </div>
  )
}

/**
 * The choice as the kernel receives it. For reason 1 nothing is requested: the
 * note, good faith and contact go empty. Contact only goes when there is a name
 * or email.
 */
function escolhaDoNucleo(motivo: Motivo, escolha: EscolhaDaDenuncia): EscolhaDoNucleo {
  if (!pedeDetalhes(motivo)) return { motivo, nota: "", boaFe: false }
  const nome = escolha.nome.trim()
  const email = escolha.email.trim()
  return {
    motivo,
    nota: escolha.nota.trim(),
    boaFe: escolha.boaFe,
    ...(nome !== "" || email !== "" ? { contacto: { nome, email } } : {}),
  }
}

/** The first letter, for the face without a photo. */
function inicial(nome: string): string {
  return [...nome.trim()][0] ?? "?"
}

/** A line of the summary: the icon, the label and the value ("Reason: Harassment or persecution"). */
function LinhaDoResumo({
  icone,
  rotulo,
  children,
  testid,
}: {
  icone: React.ReactNode
  rotulo: string
  children: React.ReactNode
  testid?: string
}): React.JSX.Element {
  return (
    <div className="denunciar-resumo-linha" data-testid={testid}>
      <span className="denunciar-resumo-icone" aria-hidden="true">
        {icone}
      </span>
      <dt>{`${rotulo}:`}</dt> <dd>{children}</dd>
    </div>
  )
}

/**
 * Everything that goes in the body of the report (§3): the messages; in the
 * summary, the person, the channel, the room, the reason, the note, good faith,
 * contact and app version; and in the detail, the address of each person. The
 * version is from the UI package (`VERSAO_DA_APP`); the bridge sends the app
 * package version, and a site test fails if the two differ.
 */
function Previsualizacao({
  preparada,
  escolha,
  nomeDe,
  nomeDoCanal,
  nomeDaSala,
}: {
  preparada: DenunciaPreparada
  escolha: EscolhaDoNucleo | null
  nomeDe: (endereco: string) => string
  nomeDoCanal?: string | undefined
  nomeDaSala: (sala: string) => string
}): React.JSX.Element {
  const t = strings.denunciar
  const r = t.rotulos
  const contacto = escolha?.contacto ? [escolha.contacto.nome, escolha.contacto.email].filter((parte) => parte !== "") : []
  // Each address once: first the reported person, then the authors in order.
  const enderecos = [...new Set([preparada.denunciado, ...preparada.itens.map((item) => item.autor)])]
  return (
    <>
      {preparada.itens.length === 0 ? (
        <p className="field-note">{t.semMensagens}</p>
      ) : (
        <ol className="denunciar-itens">
          {preparada.itens.map((item, indice) => (
            <ItemDaPrevisualizacao key={indice} item={item} nomeDe={nomeDe} />
          ))}
        </ol>
      )}

      <div className="denunciar-resumo" data-testid="denunciar-resumo">
        <h4 className="sr-only">{t.resumoTitulo}</h4>
        <dl>
          <LinhaDoResumo icone={<PersonIcon size={18} />} rotulo={r.pessoa} testid="denunciar-pessoa">
            <NomeDePessoa nome={nomeDe(preparada.denunciado)} endereco={preparada.denunciado} />
          </LinhaDoResumo>
          {nomeDoCanal !== undefined && (
            <LinhaDoResumo icone={<HashIcon size={18} />} rotulo={r.canal}>
              {nomeDoCanal}
            </LinhaDoResumo>
          )}
          {preparada.sala !== undefined && preparada.sala !== "" && (
            <LinhaDoResumo icone={<HashIcon size={18} />} rotulo={r.sala} testid="denunciar-sala">
              {nomeDaSala(preparada.sala)}
            </LinhaDoResumo>
          )}
          {escolha !== null && (
            <LinhaDoResumo icone={<BandeiraIcon size={18} />} rotulo={r.motivo}>
              {t.motivos[escolha.motivo]}
            </LinhaDoResumo>
          )}
          {escolha !== null && escolha.nota !== "" && (
            <LinhaDoResumo icone={<NotaIcon size={18} />} rotulo={r.nota}>
              {escolha.nota}
            </LinhaDoResumo>
          )}
          {escolha?.boaFe === true && (
            <LinhaDoResumo icone={<VistoIcon size={18} />} rotulo={r.boaFe}>
              {t.boaFeConfirmada}
            </LinhaDoResumo>
          )}
          {contacto.length > 0 && (
            <LinhaDoResumo icone={<EnvelopeIcon size={18} />} rotulo={r.contacto}>
              {contacto.join(", ")}
            </LinhaDoResumo>
          )}
          <LinhaDoResumo icone={<EtiquetaIcon size={18} />} rotulo={r.versao}>
            {VERSAO_DA_APP}
          </LinhaDoResumo>
        </dl>
        <details className="denunciar-enderecos" data-testid="denunciar-enderecos">
          <summary>{t.mostrarEnderecos}</summary>
          <p className="field-note">{t.enderecosNota}</p>
          <dl>
            {enderecos.map((endereco) => (
              <div key={endereco}>
                <dt>
                  <NomeDePessoa nome={nomeDe(endereco)} endereco={endereco} />
                </dt>{" "}
                <dd>{endereco}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>

      <p className="denunciar-sai">
        <LockIcon size={18} />
        <span>{t.previsualizacaoNota}</span>
      </p>
    </>
  )
}

/**
 * A message from the preview: the face, the name, the day and time in UTC, the
 * text and attachments. The reported one gets the bar and the badge; the
 * context appears more faded.
 */
function ItemDaPrevisualizacao({
  item,
  nomeDe,
}: {
  item: ItemPreparado
  nomeDe: (endereco: string) => string
}): React.JSX.Element {
  const caixa = strings.roomProperties.denuncias
  const nome = nomeDe(item.autor)
  return (
    <li className={item.denunciada ? "denunciar-item denunciada" : "denunciar-item"} data-testid="denunciar-item">
      <Avatar profile={undefined} fallback={inicial(nome)} />
      <div className="denunciar-item-corpo">
        <p className="denunciar-item-cabecalho">
          <strong>
            <NomeDePessoa nome={nome} endereco={item.autor} />
          </strong>
          <span className="denunciar-quando">
            {item.dia}
            <span className="sep" aria-hidden="true">
              ·
            </span>
            {`${item.hora} UTC`}
          </span>
        </p>
        <p className="denunciar-item-texto">{item.texto !== "" ? item.texto : caixa.semTexto}</p>
        {item.anexos.map((anexo, n) => (
          <p key={n} className="denunciar-item-anexo">
            {caixa.anexo(anexo.name, anexo.mediaType)}
            {anexo.byteLength !== undefined ? `, ${formatarBytes(anexo.byteLength)}` : ""}
          </p>
        ))}
        {item.denunciada && <span className="denunciar-pilula">{caixa.denunciada}</span>}
      </div>
    </li>
  )
}
