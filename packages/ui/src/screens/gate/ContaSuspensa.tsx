import { useState } from "react"
import { NOTA_MAX, type AvisoDeSuspensao, type Motivo } from "@enclave/protocol"
import { Button } from "../../components/Button.js"
import { Field } from "../../components/Field.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { strings, translateError, traduzirErro } from "../../strings.js"

/**
 * The account suspension notice (reports, §8 and §9b; art. 17.3 of DSA).
 *
 * In the order of law: the measure, the duration, the scope, the facts, where it came
 * from, that there were no automated means, the rule or clause, and the remedies
 * (internal review, courts and ANACOM). With the review decided, the decision and
 * notice, and no request again.
 *
 * Appears in the gate (`App`, "suspended" stage) with the vault open: the review
 * request is signed by this device, no gateway. This component knows nothing of the
 * bridge: `onPedirRevisao` is what sends it.
 *
 * `aviso` at `null`: the account is suspended, but the notice wasn't read. It's said,
 * and the paths continue.
 */
export function ContaSuspensa({
  aviso,
  onPedirRevisao,
  onTentarOutraVez,
}: {
  aviso: AvisoDeSuspensao | null
  onPedirRevisao: (nota: string) => Promise<void>
  onTentarOutraVez: () => void
}): React.JSX.Element {
  const t = strings.contaSuspensa
  const [nota, setNota] = useState("")
  const [estado, setEstado] = useState<"parado" | "a-enviar" | "enviado">("parado")
  const [erro, setErro] = useState<string | null>(null)
  // Review already decided: the decision is stated, not another request.
  const decidida = aviso !== null && aviso.revisao.decisao !== "pendente" ? aviso.revisao : null

  const pedir = (): void => {
    const texto = nota.trim()
    if (texto === "" || estado === "a-enviar") return
    setEstado("a-enviar")
    setErro(null)
    onPedirRevisao(texto).then(
      () => setEstado("enviado"),
      (e: unknown) => {
        setEstado("parado")
        setErro(traduzirErro(e))
      },
    )
  }

  return (
    <div className="gate">
      <div className="gate-pilha">
        <div className="gate-card">
          <h1>{t.titulo}</h1>
          <p className="gate-lead" role="status">
            <TextoDeErro texto={translateError("account-suspended")} />
          </p>

          {aviso === null ? (
            <p className="field-note">{t.semAviso}</p>
          ) : (
            <>
              <p>{t.medida}</p>
              <p>{t.motivo(t.motivos[aviso.motivo as Motivo])}</p>
              <p>{aviso.ate === null ? t.ateARevisao(aviso.desde) : t.duracao(aviso.desde, aviso.ate)}</p>
              <p>{t.ambito(aviso.ambito)}</p>
              <p>{t.factos(aviso.factos)}</p>
              <p>{t.origem[aviso.origem]}</p>
              <p>{t.semMeiosAutomaticos}</p>
              <p>{t.norma(aviso.norma)}</p>
            </>
          )}

          <h2>{t.viasTitulo}</h2>
          {decidida ? (
            <>
              <p>{t.decisao[decidida.decisao as "mantida" | "levantada"]}</p>
              {decidida.nota !== "" && <p>{t.notaDaDecisao(decidida.nota)}</p>}
            </>
          ) : estado === "enviado" ? (
            <p className="field-note" role="status">
              {t.revisaoEnviada}
            </p>
          ) : (
            <>
              {aviso?.revisao.pedida && <p className="field-note">{t.revisaoPedida(aviso.revisao.pedida.slice(0, 10))}</p>}
              <Field label={t.notaRevisao}>
                <textarea value={nota} maxLength={NOTA_MAX} rows={4} onChange={(event) => setNota(event.target.value)} />
              </Field>
              <p className="field-note">{t.notaDica}</p>
              <Button variant="primary" type="button" disabled={nota.trim() === "" || estado === "a-enviar"} onClick={pedir}>
                {estado === "a-enviar" ? t.aEnviar : t.pedirRevisao}
              </Button>
            </>
          )}
          {erro !== null && (
            <p className="field-note warn" role="alert">
              <TextoDeErro texto={erro} />
            </p>
          )}
          <p>{t.tribunais}</p>
          <p>{t.anacom}</p>

          <Button variant="ghost" type="button" onClick={onTentarOutraVez}>
            {t.tentarOutraVez}
          </Button>
        </div>
      </div>
    </div>
  )
}
