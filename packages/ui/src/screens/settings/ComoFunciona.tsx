import { useId, useState } from "react"
import { Button } from "../../components/Button.js"
import { Modal } from "../../components/Modal.js"
import { strings } from "../../strings.js"

/**
 * "How it works": six cards, one per idea (phase 6, layer 2, plan
 * `docs/planos/definicoes-0-9.md`).
 *
 * The source is `docs/COMO-FUNCIONA-A-MIUDOS.html`. The document has twelve sections;
 * the app shows the six that change what the user does: because there is no "forgot password",
 * because the new channel comes empty, because you don't create another account on the second device.
 * The rest (sync, tombstones, voice, federation) stays in the document and the public page (layer 3).
 *
 * Each card shows two sentences and a drawing, and hides the rest behind "Read more".
 * The user who opens this came with a question, and six walls of text were hiding the answer.
 *
 * Needs no account or bridge: it is text and drawing. That is why the gate opens it
 * before there is a vault (see `FolhaComoFunciona`).
 */
export const IDEIAS = ["carteiro", "chave", "cofre", "canal", "aparelhos", "servidor"] as const

export type Ideia = (typeof IDEIAS)[number]

export function ComoFunciona(): React.JSX.Element {
  return (
    <div className="como-funciona">
      {IDEIAS.map((ideia) => (
        <CartaoDaIdeia key={ideia} ideia={ideia} />
      ))}
    </div>
  )
}

/**
 * The same page in a sheet: what the gate opens, and what the settings card opens.
 * One only, so the text does not differ between the two places.
 */
export function FolhaComoFunciona({ onClose }: { onClose: () => void }): React.JSX.Element {
  const titulo = useId()
  return (
    <Modal className="sheet como-funciona-folha" labelledBy={titulo} onClose={onClose}>
      <header className="sheet-header">
        <h2 id={titulo}>{strings.comoFunciona.titulo}</h2>
        <Button variant="ghost" type="button" onClick={onClose}>
          {strings.common.close}
        </Button>
      </header>
      <p className="sheet-lead">{strings.comoFunciona.lead}</p>
      <div className="sheet-body">
        <ComoFunciona />
      </div>
    </Modal>
  )
}

function CartaoDaIdeia({ ideia }: { ideia: Ideia }): React.JSX.Element {
  const [aberto, setAberto] = useState(false)
  const resto = useId()
  const texto = strings.comoFunciona[ideia]
  // The devices card opens with the sentence from phase 8.1, the same as Devices:
  // one key only, so the two do not say different things.
  const resumo = ideia === "aparelhos" ? `${strings.comoFunciona.umaContaChega} ${texto.resumo}` : texto.resumo
  return (
    <article className="como-funciona-cartao" data-ideia={ideia}>
      <h3>{texto.titulo}</h3>
      <p>{resumo}</p>
      <figure className="como-funciona-desenho">
        <Desenho ideia={ideia} />
      </figure>
      {/* Local state, not `<details>`: the button says "Read less" when open,
          and `<summary>` does not change text without state there. */}
      <button
        type="button"
        className="gate-link como-funciona-mais"
        aria-expanded={aberto}
        aria-controls={resto}
        onClick={() => setAberto((antes) => !antes)}
      >
        {aberto ? strings.comoFunciona.lerMenos : strings.comoFunciona.lerMais}
      </button>
      {aberto && (
        <div id={resto} className="como-funciona-resto">
          {texto.mais.map((paragrafo) => (
            <p key={paragrafo}>{paragrafo}</p>
          ))}
        </div>
      )}
    </article>
  )
}

/**
 * The id of the arrow tip, one per drawing.
 *
 * The page can be mounted twice (the settings card and the sheet), and two `<marker id="seta">`
 * in the same document make the second arrow point to the first definition. The colons from
 * `useId` are removed: inside `url(#…)` they are not reliable on all engines.
 */
function useSeta(): { id: string; url: string } {
  const id = `seta${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  return { id, url: `url(#${id})` }
}

function Ponta({ id }: { id: string }): React.JSX.Element {
  return (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
        <path d="M0 0L10 5L0 10z" fill="currentColor" />
      </marker>
    </defs>
  )
}

function Desenho({ ideia }: { ideia: Ideia }): React.JSX.Element {
  switch (ideia) {
    case "carteiro":
      return <DesenhoDoCarteiro />
    case "chave":
      return <DesenhoDaChave />
    case "cofre":
      return <DesenhoDoCofre />
    case "canal":
      return <DesenhoDoCanal />
    case "aparelhos":
      return <DesenhoDosAparelhos />
    case "servidor":
      return <DesenhoDoServidor />
  }
}

/*
  The drawings are from the document, with colors replaced by classes: cyan,
  pink, and green come from `--acento`, `--rosa`, and `--presenca` (see `screens.css`,
  "How it works"), and the rest is `currentColor`. The meaning of each color matches the
  document: green is the server that does not read, pink is what reads or gets lost,
  cyan is what is yours.
*/

function DesenhoDoCarteiro(): React.JSX.Element {
  const t = strings.comoFunciona.carteiro
  const seta = useSeta()
  return (
    <svg viewBox="0 0 720 230" role="img" aria-label={t.desenho}>
      <Ponta id={seta.id} />
      <text x="20" y="24" className="cf-tt">{t.outraApp}</text>
      <rect x="20" y="40" width="110" height="44" rx="10" className="cf-caixa" />
      <text x="75" y="67" textAnchor="middle" className="cf-tx">{t.ana}</text>
      <line x1="130" y1="62" x2="210" y2="62" className="cf-fio" markerEnd={seta.url} />
      <text x="170" y="54" textAnchor="middle" className="cf-cx">{t.ola}</text>
      <rect x="212" y="30" width="150" height="64" rx="10" className="cf-rosa" />
      <text x="287" y="55" textAnchor="middle" className="cf-tt">{t.servidor}</text>
      <text x="287" y="75" textAnchor="middle" className="cf-cx">{t.leEGuarda}</text>
      <line x1="362" y1="62" x2="440" y2="62" className="cf-fio" markerEnd={seta.url} />
      <text x="400" y="54" textAnchor="middle" className="cf-cx">{t.ola}</text>
      <rect x="442" y="40" width="110" height="44" rx="10" className="cf-caixa" />
      <text x="497" y="67" textAnchor="middle" className="cf-tx">{t.rui}</text>

      <text x="20" y="134" className="cf-tt">{t.orwell}</text>
      <rect x="20" y="150" width="110" height="44" rx="10" className="cf-caixa" />
      <text x="75" y="177" textAnchor="middle" className="cf-tx">{t.ana}</text>
      <line x1="130" y1="172" x2="210" y2="172" className="cf-fio" markerEnd={seta.url} />
      <rect x="152" y="153" width="36" height="22" rx="4" className="cf-envelope" />
      <text x="170" y="168" textAnchor="middle" className="cf-envelope-tx">■■■</text>
      <rect x="212" y="140" width="150" height="64" rx="10" className="cf-presenca" />
      <text x="287" y="165" textAnchor="middle" className="cf-tt">{t.servidor}</text>
      <text x="287" y="185" textAnchor="middle" className="cf-cx">{t.soAMorada}</text>
      <line x1="362" y1="172" x2="440" y2="172" className="cf-fio" markerEnd={seta.url} />
      <rect x="383" y="153" width="36" height="22" rx="4" className="cf-envelope" />
      <text x="401" y="168" textAnchor="middle" className="cf-envelope-tx">■■■</text>
      <rect x="442" y="150" width="110" height="44" rx="10" className="cf-caixa" />
      <text x="497" y="177" textAnchor="middle" className="cf-tx">{t.rui}</text>
      {t.nota.map((linha, i) => (
        <text key={linha} x="572" y={160 + i * 16} className="cf-cx">
          {linha}
        </text>
      ))}
    </svg>
  )
}

function DesenhoDaChave(): React.JSX.Element {
  const t = strings.comoFunciona.chave
  const seta = useSeta()
  return (
    <svg viewBox="0 0 720 200" role="img" aria-label={t.desenho}>
      <Ponta id={seta.id} />
      <rect x="20" y="30" width="330" height="150" rx="14" className="cf-caixa cf-tracejado" />
      <text x="36" y="54" className="cf-tt">{t.oTeuAparelho}</text>
      <rect x="36" y="70" width="140" height="94" rx="10" className="cf-acento" />
      <text x="106" y="92" textAnchor="middle" className="cf-tt">{t.cofre}</text>
      <text x="106" y="112" textAnchor="middle" className="cf-tx">{t.chaveDaConta}</text>
      <text x="106" y="130" textAnchor="middle" className="cf-tx">{t.chavesDosCanais}</text>
      <text x="106" y="148" textAnchor="middle" className="cf-tx">{t.mensagensLidas}</text>
      <rect x="200" y="96" width="130" height="40" rx="10" className="cf-caixa" />
      <text x="265" y="120" textAnchor="middle" className="cf-tx">{t.palavraPasse}</text>
      <line x1="200" y1="116" x2="180" y2="116" className="cf-fio" markerEnd={seta.url} />
      <text x="190" y="150" textAnchor="middle" className="cf-cx">{t.abre}</text>
      <line x1="176" y1="88" x2="440" y2="88" className="cf-fio" markerEnd={seta.url} />
      <text x="360" y="80" textAnchor="middle" className="cf-cx">{t.resumoDaChave}</text>
      <rect x="442" y="68" width="150" height="40" rx="10" className="cf-caixa" />
      <text x="517" y="92" textAnchor="middle" className="cf-tx">{t.endereco}</text>
      <line x1="517" y1="108" x2="517" y2="140" className="cf-fio" markerEnd={seta.url} />
      <rect x="442" y="142" width="150" height="40" rx="10" className="cf-presenca" />
      <text x="517" y="166" textAnchor="middle" className="cf-tx">{t.soIsto}</text>
      {t.semVolta.map((linha, i) => (
        <text key={linha} x="606" y={92 + i * 14} className="cf-cx">
          {linha}
        </text>
      ))}
    </svg>
  )
}

/**
 * The vault and the turnstile. This drawing is not in the document (section 3 has none);
 * it follows the same rules: the vault in cyan, the server in green, and the queue
 * of spent keys that only moves forward.
 */
function DesenhoDoCofre(): React.JSX.Element {
  const t = strings.comoFunciona.cofre
  const seta = useSeta()
  return (
    <svg viewBox="0 0 720 200" role="img" aria-label={t.desenho}>
      <Ponta id={seta.id} />
      <rect x="20" y="20" width="330" height="110" rx="14" className="cf-caixa cf-tracejado" />
      <text x="36" y="44" className="cf-tt">{t.oTeuAparelho}</text>
      <rect x="36" y="56" width="298" height="60" rx="10" className="cf-acento" />
      <text x="185" y="80" textAnchor="middle" className="cf-tt">{t.cofre}</text>
      <text x="185" y="100" textAnchor="middle" className="cf-tx">{t.mensagensEmClaro}</text>
      <text x="185" y="140" textAnchor="middle" className="cf-cx">{t.cifrado}</text>
      <line x1="440" y1="75" x2="352" y2="75" className="cf-fio" markerEnd={seta.url} />
      <rect x="442" y="40" width="200" height="70" rx="12" className="cf-presenca" />
      <text x="542" y="68" textAnchor="middle" className="cf-tt">{t.servidor}</text>
      <text x="542" y="88" textAnchor="middle" className="cf-tx">{t.envelopes}</text>
      <text x="542" y="126" textAnchor="middle" className="cf-cx">{t.unsDias}</text>
      {[0, 1, 2, 3].map((i) => (
        <circle key={i} cx={90 + i * 80} cy="172" r="12" className={i === 3 ? "cf-acento" : "cf-caixa cf-tracejado"} />
      ))}
      <line x1="60" y1="172" x2="400" y2="172" className="cf-fio" markerEnd={seta.url} />
      <text x="420" y="176" className="cf-cx">{t.catraca}</text>
    </svg>
  )
}

function DesenhoDoCanal(): React.JSX.Element {
  const t = strings.comoFunciona.canal
  const seta = useSeta()
  const epocas = [
    { n: 1, x: 90, classe: "cf-caixa" },
    { n: 2, x: 210, classe: "cf-caixa" },
    { n: 3, x: 330, classe: "cf-acento" },
    { n: 4, x: 450, classe: "cf-caixa" },
    { n: 5, x: 570, classe: "cf-rosa" },
  ]
  return (
    <svg viewBox="0 0 720 210" role="img" aria-label={t.desenho}>
      <Ponta id={seta.id} />
      <line x1="30" y1="100" x2="690" y2="100" className="cf-fio" markerEnd={seta.url} />
      <text x="700" y="90" textAnchor="end" className="cf-cx">{t.tempo}</text>
      {epocas.map((epoca) => (
        <g key={epoca.n}>
          <circle cx={epoca.x} cy="100" r="18" className={epoca.classe} />
          <text x={epoca.x} y="105" textAnchor="middle" className="cf-tt">
            {epoca.n}
          </text>
        </g>
      ))}
      <text x="360" y="30" textAnchor="middle" className="cf-cx">{t.cadaCirculo}</text>
      <line x1="330" y1="82" x2="330" y2="52" className="cf-fio-acento" />
      <text x="330" y="46" textAnchor="middle" className="cf-tx">{t.ruiEntra}</text>
      <line x1="570" y1="82" x2="570" y2="52" className="cf-fio-rosa" />
      <text x="570" y="46" textAnchor="middle" className="cf-tx">{t.anaSai}</text>
      <rect x="312" y="130" width="378" height="26" rx="6" className="cf-faixa-acento" />
      <text x="500" y="147" textAnchor="middle" className="cf-tx">{t.ruiLe}</text>
      <rect x="30" y="130" width="280" height="26" rx="6" className="cf-caixa cf-pontilhado" />
      <text x="170" y="147" textAnchor="middle" className="cf-cx">{t.ruiNaoLe}</text>
      <rect x="30" y="166" width="520" height="26" rx="6" className="cf-faixa-rosa" />
      <text x="290" y="183" textAnchor="middle" className="cf-tx">{t.anaLeu}</text>
      <rect x="552" y="166" width="138" height="26" rx="6" className="cf-caixa cf-fio-rosa cf-pontilhado" />
      <text x="621" y="183" textAnchor="middle" className="cf-cx">{t.anaNaoLe}</text>
    </svg>
  )
}

function DesenhoDosAparelhos(): React.JSX.Element {
  const t = strings.comoFunciona.aparelhos
  const seta = useSeta()
  return (
    <svg viewBox="0 0 720 230" role="img" aria-label={t.desenho}>
      <Ponta id={seta.id} />
      <rect x="20" y="30" width="190" height="110" rx="12" className="cf-acento" />
      <text x="115" y="54" textAnchor="middle" className="cf-tt">{t.principal}</text>
      <text x="115" y="76" textAnchor="middle" className="cf-tx">{t.chaveDaConta}</text>
      <text x="115" y="96" textAnchor="middle" className="cf-tx">{t.chaveDoAparelho1}</text>
      <text x="115" y="124" textAnchor="middle" className="cf-cx">{t.soEste}</text>
      <rect x="510" y="30" width="190" height="110" rx="12" className="cf-caixa" />
      <text x="605" y="54" textAnchor="middle" className="cf-tt">{t.novo}</text>
      <text x="605" y="76" textAnchor="middle" className="cf-tx">{t.chaveDoAparelho2}</text>
      <text x="605" y="96" textAnchor="middle" className="cf-tx">{t.assinada}</text>
      <text x="605" y="124" textAnchor="middle" className="cf-cx">{t.semChaveDaConta}</text>
      <rect x="290" y="62" width="140" height="46" rx="10" className="cf-presenca" />
      <text x="360" y="81" textAnchor="middle" className="cf-tx">{t.servidor}</text>
      <text x="360" y="98" textAnchor="middle" className="cf-cx">{t.cofreTemporario}</text>
      <line x1="210" y1="85" x2="288" y2="85" className="cf-fio" markerEnd={seta.url} />
      <line x1="430" y1="85" x2="508" y2="85" className="cf-fio" markerEnd={seta.url} />
      <line x1="115" y1="140" x2="115" y2="175" className="cf-fio" />
      <line x1="115" y1="175" x2="605" y2="175" className="cf-fio-acento cf-tracejado" />
      <line x1="605" y1="175" x2="605" y2="140" className="cf-fio" markerEnd={seta.url} />
      <text x="360" y="168" textAnchor="middle" className="cf-tx">{t.segredo}</text>
      <text x="360" y="208" textAnchor="middle" className="cf-cx">{t.seisPalavras}</text>
    </svg>
  )
}

/**
 * Knows and does not know, side by side. Also not in the document as a drawing (section 5
 * is two text boxes): becomes the two boxes, one green and one pink, with short lines,
 * and the detail stays in "Read more".
 */
function DesenhoDoServidor(): React.JSX.Element {
  const t = strings.comoFunciona.servidor
  return (
    <svg viewBox="0 0 720 190" role="img" aria-label={t.desenho}>
      <rect x="20" y="20" width="330" height="160" rx="14" className="cf-presenca" />
      <text x="40" y="48" className="cf-tt cf-sim">{t.sabe}</text>
      {t.listaSabe.map((linha, i) => (
        <text key={linha} x="40" y={76 + i * 24} className="cf-tx">
          {linha}
        </text>
      ))}
      <rect x="370" y="20" width="330" height="160" rx="14" className="cf-rosa" />
      <text x="390" y="48" className="cf-tt cf-nao">{t.naoSabe}</text>
      {t.listaNaoSabe.map((linha, i) => (
        <text key={linha} x="390" y={76 + i * 22} className="cf-tx">
          {linha}
        </text>
      ))}
    </svg>
  )
}
