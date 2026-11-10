import { useEffect, useState } from "react"
import type { DenunciaRecebida } from "@enclave/client-core"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { formatarBytes } from "../../lib/ficheiros.js"
import { linguaActual, strings, traduzirErro } from "../../strings.js"
import { NomeDePessoa } from "../../components/NomeDePessoa.js"

/**
 * The reports that reached the channel founder, in the Moderation section of
 * properties (`docs/planos/denuncias-design.md`, §6.2).
 *
 * Each report is a card: the reason, the day, the reported person, the channel
 * and room, proof of the report, notes and messages, each marked "Verified" or
 * "Not verified" (the founder's device verifies the authenticity of each item).
 * The layout is in `styles/denunciasDoCanal.css`.
 *
 * On a paired device without the account key, copies stay on the server waiting
 * for the device that has it. The section says how many, and does not say
 * "No one reported anything" (`carregarPorAbrir`). Never shows who reported, and
 * from the report only the day: the copy brings nothing more, and this section
 * does not invent.
 *
 * Reports that show are marked as read (`onLida`).
 */
export function SeccaoDenuncias({
  carregar,
  carregarPorAbrir,
  nomeDe,
  nomeDoCanal,
  nomeDaSala = (sala) => sala,
  onLida,
}: {
  /** The channel's reports, most recent first. See `bridge.denuncias.lista`. */
  carregar: () => Promise<DenunciaRecebida[]>
  /**
   * How many copies of this channel are on the server waiting for the device
   * with the account key (a paired device does not open them). See
   * `bridge.denuncias.porAbrir`. Missing, or failing, counts as zero.
   */
  carregarPorAbrir?: (() => Promise<number>) | undefined
  nomeDe: (endereco: string) => string
  /** The name of the channel for these properties, as the sidebar shows it. */
  nomeDoCanal?: string | undefined
  /** The readable name of a room in this channel. The identifier is not shown. */
  nomeDaSala?: ((sala: string) => string) | undefined
  onLida?: ((id: string) => void) | undefined
}): React.JSX.Element {
  const [denuncias, setDenuncias] = useState<DenunciaRecebida[] | null>(null)
  const [porAbrir, setPorAbrir] = useState(0)
  const [erro, setErro] = useState<string | null>(null)
  const t = strings.roomProperties.denuncias

  useEffect(() => {
    let viva = true
    carregar()
      .then((lista) => {
        if (!viva) return
        setDenuncias(lista)
        for (const denuncia of lista) if (!denuncia.lida) onLida?.(denuncia.id)
      })
      .catch((e: unknown) => {
        if (viva) setErro(traduzirErro(e))
      })
    // Counting the waiting ones is a side concern: one failure does not hide the ones that arrived.
    carregarPorAbrir?.()
      .then((n) => {
        if (viva && Number.isSafeInteger(n) && n > 0) setPorAbrir(n)
      })
      .catch(() => {})
    return () => {
      viva = false
    }
    // One read on mount: the properties panel remounts this section when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="sheet-grupo seccao-denuncias">
      <h3>{t.titulo}</h3>
      <p className="hint">{t.nota}</p>
      {porAbrir > 0 && erro === null && (
        <p className="denuncias-a-espera" role="status">
          {t.porAbrir(porAbrir)}
        </p>
      )}
      {erro !== null ? (
        <p className="erro" role="alert">
          <TextoDeErro texto={erro} />
        </p>
      ) : denuncias === null ? (
        <p className="hint">{t.aLer}</p>
      ) : denuncias.length === 0 ? (
        porAbrir > 0 ? null : <p className="hint">{t.vazio}</p>
      ) : (
        <ul className="denuncias">
          {denuncias.map((denuncia) => (
            <Denuncia key={denuncia.id} denuncia={denuncia} nomeDe={nomeDe} nomeDoCanal={nomeDoCanal} nomeDaSala={nomeDaSala} />
          ))}
        </ul>
      )}
    </div>
  )
}

const localDaLingua = (): string => (linguaActual() === "en" ? "en-GB" : "pt-PT")

/** One UTC day (`YYYY-MM-DD`) in full text, no time. In UTC: otherwise a time zone west of UTC would show the previous day. */
function diaPorExtenso(dia: string): string {
  const data = new Date(`${dia}T00:00:00Z`)
  if (Number.isNaN(data.getTime())) return dia
  return data.toLocaleDateString(localDaLingua(), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
}

/**
 * Proof of the entire report (§7 of the design). In a message, it is proof of
 * the reported message. In a person, all messages must match, and with no
 * messages there is no proof. Each message gets its mark alongside it.
 */
export function denunciaVerificada(denuncia: DenunciaRecebida): boolean {
  const denunciada = denuncia.itens.find((item) => item.denunciada)
  if (denunciada) return denunciada.verificada
  return denuncia.itens.length > 0 && denuncia.itens.every((item) => item.verificada)
}

function MarcaDaProva({ verificada, testid }: { verificada: boolean; testid?: string }): React.JSX.Element {
  const t = strings.roomProperties.denuncias
  return (
    <span className={verificada ? "denuncia-prova verificada" : "denuncia-prova nao-verificada"} data-testid={testid}>
      {verificada ? t.verificada : t.naoVerificada}
    </span>
  )
}

function Denuncia({
  denuncia,
  nomeDe,
  nomeDoCanal,
  nomeDaSala,
}: {
  denuncia: DenunciaRecebida
  nomeDe: (endereco: string) => string
  nomeDoCanal: string | undefined
  nomeDaSala: (sala: string) => string
}): React.JSX.Element {
  const t = strings.roomProperties.denuncias
  return (
    <li className={denuncia.lida ? "denuncia" : "denuncia nova"}>
      <div className="denuncia-cabecalho" data-testid="denuncia-cabecalho">
        <strong className="denuncia-motivo">{t.motivos[denuncia.motivo]}</strong>
        {!denuncia.lida && <span className="denuncia-nova">{t.nova}</span>}
        <span className="denuncia-dia" data-testid="denuncia-dia">
          {diaPorExtenso(denuncia.dia)}
        </span>
      </div>
      <dl className="denuncia-dados">
        <div>
          <dt>{t.pessoaRotulo}</dt>
          <dd data-testid="denuncia-denunciado">
            <NomeDePessoa nome={nomeDe(denuncia.denunciado)} endereco={denuncia.denunciado} />
          </dd>
        </div>
        {nomeDoCanal !== undefined && (
          <div>
            <dt>{t.canalRotulo}</dt>
            <dd data-testid="denuncia-canal">{nomeDoCanal}</dd>
          </div>
        )}
        {denuncia.sala !== undefined && denuncia.sala !== "" && (
          <div>
            <dt>{t.salaRotulo}</dt>
            <dd data-testid="denuncia-sala">{nomeDaSala(denuncia.sala)}</dd>
          </div>
        )}
        <div>
          <dt>{t.provaRotulo}</dt>
          <dd>
            <MarcaDaProva verificada={denunciaVerificada(denuncia)} testid="denuncia-prova" />
          </dd>
        </div>
      </dl>
      {denuncia.nota !== "" && (
        <div className="denuncia-nota">
          <span className="denuncia-rotulo">{t.notaRotulo}</span>
          <p>{denuncia.nota}</p>
        </div>
      )}
      {denuncia.itens.length > 0 && (
        <>
          <span className="denuncia-rotulo">{t.mensagensRotulo}</span>
          <ol className="denuncia-itens">
            {denuncia.itens.map((item, indice) => (
              <li key={indice} className={item.denunciada ? "denuncia-item denunciada" : "denuncia-item"}>
                <div className="denuncia-item-cabecalho">
                  <strong>
                    <NomeDePessoa nome={nomeDe(item.autor)} endereco={item.autor} />
                  </strong>
                  <span className="denuncia-hora">{`${diaPorExtenso(item.dia)} ${item.hora}`}</span>
                  <MarcaDaProva verificada={item.verificada} />
                  {item.denunciada && <span className="denuncia-marca">{t.denunciada}</span>}
                </div>
                <p className="denuncia-texto">{item.texto !== "" ? item.texto : t.semTexto}</p>
                {item.anexos.map((anexo, n) => (
                  <p key={n} className="denuncia-anexo">
                    {t.anexo(anexo.name, anexo.mediaType)}
                    {anexo.byteLength !== undefined ? `, ${formatarBytes(anexo.byteLength)}` : ""}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        </>
      )}
    </li>
  )
}
