import { useId, useState } from "react"
import {
  CRYPTOGRAPHIC_POWERS,
  IMPLICACOES,
  IRREVERSIBLE_POWERS,
  PODERES_CUMPRIDOS,
  PODERES_POR_SALA_CUMPRIDOS,
  type Power,
} from "@enclave/protocol"
import type { LugarDaSobreposicao, SobreposicaoDaSala } from "../../bridge.js"
import { Button } from "../../components/Button.js"
import { Interruptor } from "../../components/Interruptor.js"
import { AnuncioDaOrdem, classesDaLinha, PegaDaOrdem, SetasDaOrdem, useOrdemDosCargos } from "../../components/OrdemDosCargos.js"
import { hexDaCor, ROLE_COLOUR_ORDER } from "../../lib/roleColours.js"
import { strings } from "../../strings.js"

/**
 * Roles and permissions (1.2, §4 of the parity plan): the order of roles
 * (the hierarchy), each role with name, color and permissions, what everyone
 * can do (`@todos`), and permissions by room and by category.
 *
 * A presentation-only component: it receives state and returns gestures. Whoever
 * mounts it (the "Roles" section in the channel properties) connects it to the
 * bridge. The real guard is in the core: what is off here is what the session
 * would refuse.
 *
 * Each part saves itself, no global "Save": a switch publishes right away, like
 * the AFK room.
 */

/** A role as the component shows it. */
export interface CargoNaLista {
  role: string
  name: string
  colour?: string | undefined
  powers: readonly Power[]
  rank: number
}

/** A place to put overlays. */
export interface LugarNaLista {
  lugar: LugarDaSobreposicao
  /** The name that shows ("Studio", "Games"). */
  nome: string
}

export interface PropsDeCargosEPermissoes {
  /** Declared roles, excluding `admin` and `@todos`. Ordered by `rank`, highest first. */
  cargos: readonly CargoNaLista[]
  /** Permissions for everyone. */
  todos: readonly Power[]
  /** Rooms and categories in the channel, in display order. */
  lugares: readonly LugarNaLista[]
  /** Saved overrides for a location. */
  sobreposicoes: (lugar: LugarDaSobreposicao) => readonly SobreposicaoDaSala[]
  /** Permissions of the user in the channel: you can only grant what you have. */
  poderesProprios: readonly Power[]
  /** Whether the user can modify this role, including `@todos`. */
  podeGerir: (role: string) => boolean
  /** Whether the user can create roles. */
  podeCriar: boolean
  /** Whether the user can reorder roles, founder and admin only. */
  podeOrdenar: boolean
  /** Whether the user can change overrides for this location. */
  podeSobrepor: (lugar: LugarDaSobreposicao) => boolean
  /** False when delegation is off and the user is neither founder nor admin (D13). */
  delegacaoLigada?: boolean
  /** Which sections to show. All by default. */
  partes?: { cargos?: boolean; todos?: boolean; sobreposicoes?: boolean }
  onCriar: (nome: string) => void
  onMudar: (role: string, mudanca: { name?: string; colour?: string | undefined; powers?: Power[] }) => void
  onApagar: (role: string) => void
  /** The new order, top to bottom. A promise, so the list can wait for it without skipping. */
  onOrdenar: (ordem: string[]) => Promise<unknown> | void
  onTodos: (powers: Power[]) => void
  onSobrepor: (lugar: LugarDaSobreposicao, perms: SobreposicaoDaSala[]) => void
}

const CARGO_TODOS = "@todos"

function naturezaDe(poder: Power): string {
  if (CRYPTOGRAPHIC_POWERS.includes(poder)) return strings.cargosEPermissoes.natureza.cifra
  if (IRREVERSIBLE_POWERS.includes(poder)) return strings.cargosEPermissoes.natureza.semVolta
  return strings.cargosEPermissoes.natureza.combinado
}

const nomeDoPoder = (poder: Power): string => strings.roles.powers[poder] ?? poder

/** Which permission this derives from, if it comes from one that the list already has (`IMPLICACOES`). */
function implicadaPor(poder: Power, lista: readonly Power[]): Power | undefined {
  return lista.find((outro) => outro !== poder && (IMPLICACOES[outro] ?? []).includes(poder))
}

/** See `components/OrdemDosCargos.tsx`: the reorder gesture lives there for both editors. */
export { reordenar } from "../../components/OrdemDosCargos.js"

/** The state of a permission in an override: inherit, grant, or deny. */
export type EstadoDaSobreposicao = "herda" | "da" | "tira"

export function estadoNaSobreposicao(perms: readonly SobreposicaoDaSala[], role: string, poder: Power): EstadoDaSobreposicao {
  const entrada = perms.find((p) => p.role === role)
  if (entrada?.deny.includes(poder)) return "tira"
  if (entrada?.allow.includes(poder)) return "da"
  return "herda"
}

/** Overrides with a permission changed for a role. An empty entry is removed from the list. */
export function comEstado(
  perms: readonly SobreposicaoDaSala[],
  role: string,
  poder: Power,
  estado: EstadoDaSobreposicao,
): SobreposicaoDaSala[] {
  const actual = perms.find((p) => p.role === role) ?? { role, allow: [], deny: [] }
  const allow = actual.allow.filter((p) => p !== poder)
  const deny = actual.deny.filter((p) => p !== poder)
  if (estado === "da") allow.push(poder)
  if (estado === "tira") deny.push(poder)
  const resto = perms.filter((p) => p.role !== role)
  return allow.length === 0 && deny.length === 0 ? resto : [...resto, { role, allow, deny }]
}

function Permissao({
  poder,
  ligado,
  lista,
  disabled,
  semPoder,
  onMudar,
}: {
  poder: Power
  ligado: boolean
  lista: readonly Power[]
  disabled: boolean
  semPoder: boolean
  onMudar: (ligado: boolean) => void
}): React.JSX.Element {
  const de = ligado ? undefined : implicadaPor(poder, lista)
  return (
    <li className="cep-permissao">
      <Interruptor
        ligado={ligado || de !== undefined}
        disabled={disabled || semPoder || de !== undefined}
        onMudar={onMudar}
        rotulo={nomeDoPoder(poder)}
      />
      <span className="cep-ajuda">
        {strings.cargos.powerHelp[poder] ?? ""} {naturezaDe(poder)}
        {de !== undefined ? ` ${strings.cargosEPermissoes.implicada(nomeDoPoder(de))}` : ""}
        {semPoder && !ligado ? ` ${strings.cargosEPermissoes.semPoder}` : ""}
      </span>
    </li>
  )
}

function ListaDePermissoes({
  powers,
  disabled,
  poderesProprios,
  rotulo,
  onMudar,
}: {
  powers: readonly Power[]
  disabled: boolean
  poderesProprios: readonly Power[]
  rotulo: string
  onMudar: (powers: Power[]) => void
}): React.JSX.Element {
  return (
    <ul className="cep-permissoes" aria-label={rotulo}>
      {PODERES_CUMPRIDOS.map((poder) => (
        <Permissao
          key={poder}
          poder={poder}
          ligado={powers.includes(poder)}
          lista={powers}
          disabled={disabled}
          semPoder={!poderesProprios.includes(poder)}
          onMudar={(ligado) =>
            onMudar(PODERES_CUMPRIDOS.filter((p) => (p === poder ? ligado : powers.includes(p))).concat(
              // Those this version does not support stay as they were.
              powers.filter((p) => !PODERES_CUMPRIDOS.includes(p)),
            ))
          }
        />
      ))}
    </ul>
  )
}

function Cargo({
  cargo,
  aberto,
  pode,
  poderesProprios,
  onAbrir,
  onMudar,
  onApagar,
}: {
  cargo: CargoNaLista
  aberto: boolean
  pode: boolean
  poderesProprios: readonly Power[]
  onAbrir: () => void
  onMudar: PropsDeCargosEPermissoes["onMudar"]
  onApagar: (role: string) => void
}): React.JSX.Element {
  const [nome, setNome] = useState(cargo.name)
  const t = strings.cargosEPermissoes
  return (
    <div className="cep-cargo-corpo">
      <button type="button" className="cep-cargo-nome" aria-expanded={aberto} onClick={onAbrir} title={t.abrir(cargo.name)}>
        <span className="cep-cor" aria-hidden="true" style={{ background: hexDaCor(cargo.colour) ?? "transparent" }} />
        {cargo.name}
      </button>
      {aberto && (
        <div className="cep-editor">
          {!pode && <p className="cep-nota">{t.bloqueado}</p>}
          <label className="cep-campo">
            <span>{t.nome(cargo.name)}</span>
            <input
              value={nome}
              disabled={!pode}
              aria-label={t.nome(cargo.name)}
              maxLength={48}
              onChange={(e) => setNome(e.target.value)}
              onBlur={() => {
                if (nome.trim() && nome.trim() !== cargo.name) onMudar(cargo.role, { name: nome.trim() })
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur()
              }}
            />
          </label>
          <label className="cep-campo">
            <span>{t.cor(cargo.name)}</span>
            <select
              aria-label={t.cor(cargo.name)}
              disabled={!pode}
              value={cargo.colour ?? ""}
              onChange={(e) => onMudar(cargo.role, { colour: e.target.value || undefined })}
            >
              <option value="">{t.semCor}</option>
              {ROLE_COLOUR_ORDER.map((cor) => (
                <option key={cor} value={cor}>
                  {strings.roles.colourNames[cor] ?? cor}
                </option>
              ))}
            </select>
          </label>
          <ListaDePermissoes
            powers={cargo.powers}
            disabled={!pode}
            poderesProprios={poderesProprios}
            rotulo={t.permissoesDe(cargo.name)}
            onMudar={(powers) => onMudar(cargo.role, { powers })}
          />
          {pode && (
            <Button variant="ghost" type="button" onClick={() => onApagar(cargo.role)}>
              {t.apagar(cargo.name)}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function SeccaoOrdem(props: PropsDeCargosEPermissoes): React.JSX.Element {
  const t = strings.cargosEPermissoes
  const titulo = useId()
  const [aberto, setAberto] = useState<string | null>(null)
  const [novo, setNovo] = useState("")
  const ordem = useOrdemDosCargos({
    ids: props.cargos.map((cargo) => cargo.role),
    nomeDe: (role) => props.cargos.find((cargo) => cargo.role === role)?.name ?? role,
    onOrdenar: props.podeOrdenar ? props.onOrdenar : undefined,
  })
  const cargos = ordem.ordem.flatMap((role) => props.cargos.filter((cargo) => cargo.role === role))
  const criar = (): void => {
    if (!novo.trim()) return
    props.onCriar(novo.trim())
    setNovo("")
  }
  return (
    <section className="cep-seccao" aria-labelledby={titulo}>
      <h3 id={titulo}>{t.ordemTitulo}</h3>
      <p className="cep-nota">
        {t.ordemNota} {t.fundador}
        {ordem.pode ? ` ${t.ordemComoMudar}` : ""}
      </p>
      {props.delegacaoLigada === false && <p className="cep-nota">{t.delegacaoDesligada}</p>}
      <AnuncioDaOrdem ordem={ordem} />
      <ol className="cep-ordem">
        {cargos.map((cargo, indice) => (
          <li key={cargo.role} className={classesDaLinha(ordem, "cep-cargo", indice, cargo.role)} {...ordem.arrasto(indice, cargo.role)}>
            <PegaDaOrdem ordem={ordem} nome={cargo.name} />
            <Cargo
              cargo={cargo}
              aberto={aberto === cargo.role}
              pode={props.podeGerir(cargo.role)}
              poderesProprios={props.poderesProprios}
              onAbrir={() => setAberto(aberto === cargo.role ? null : cargo.role)}
              onMudar={props.onMudar}
              onApagar={props.onApagar}
            />
            <SetasDaOrdem ordem={ordem} role={cargo.role} nome={cargo.name} indice={indice} />
          </li>
        ))}
      </ol>
      {props.podeCriar && (
        // A `div`, not a `form`: the section lives inside the property sheet, which is
        // already a form, and a form inside a form does not exist in HTML (the browser
        // removes the inner one).
        <div className="cep-novo">
          <input
            aria-label={t.novoNome}
            placeholder={t.novo}
            value={novo}
            maxLength={48}
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return
              // Enter creates the role, it does not submit the surrounding sheet.
              e.preventDefault()
              criar()
            }}
          />
          <Button type="button" variant="ghost" disabled={!novo.trim()} onClick={criar}>
            {t.criar}
          </Button>
        </div>
      )}
    </section>
  )
}

function SeccaoTodos(props: PropsDeCargosEPermissoes): React.JSX.Element {
  const t = strings.cargosEPermissoes
  const titulo = useId()
  // Closed on open, like a role in the list: only shows switches to whoever opens it.
  const [aberta, setAberta] = useState(false)
  return (
    <section className="cep-seccao" aria-labelledby={titulo}>
      <h3 id={titulo}>
        <button type="button" className="cep-cargo-nome" aria-expanded={aberta} onClick={() => setAberta(!aberta)}>
          {t.todosTitulo}
        </button>
      </h3>
      <p className="cep-nota">{t.todosNota}</p>
      {aberta && (
        <ListaDePermissoes
          powers={props.todos}
          disabled={!props.podeGerir(CARGO_TODOS)}
          poderesProprios={props.poderesProprios}
          rotulo={t.todosTitulo}
          onMudar={props.onTodos}
        />
      )}
    </section>
  )
}

function SeccaoSobreposicoes(props: PropsDeCargosEPermissoes): React.JSX.Element {
  const t = strings.cargosEPermissoes
  const titulo = useId()
  const chave = (lugar: LugarDaSobreposicao): string => ("sala" in lugar ? `s:${lugar.sala}` : `c:${lugar.categoria}`)
  const [escolhido, setEscolhido] = useState<string>(props.lugares[0] ? chave(props.lugares[0].lugar) : "")
  const actual = props.lugares.find((l) => chave(l.lugar) === escolhido) ?? props.lugares[0]
  const nomeDoLugar = (l: LugarNaLista): string => ("sala" in l.lugar ? t.sala(l.nome) : t.categoria(l.nome))
  const linhas: { role: string; name: string }[] = [{ role: CARGO_TODOS, name: t.todos }, ...props.cargos]
  return (
    <section className="cep-seccao" aria-labelledby={titulo}>
      <h3 id={titulo}>{t.sobreposicoesTitulo}</h3>
      <p className="cep-nota">{t.sobreposicoesNota}</p>
      {!actual ? (
        <p className="cep-nota">{t.semLugares}</p>
      ) : (
        <>
          <label className="cep-campo">
            <span>{t.lugar}</span>
            <select aria-label={t.lugar} value={chave(actual.lugar)} onChange={(e) => setEscolhido(e.target.value)}>
              {props.lugares.map((l) => (
                <option key={chave(l.lugar)} value={chave(l.lugar)}>
                  {nomeDoLugar(l)}
                </option>
              ))}
            </select>
          </label>
          {(() => {
            const pode = props.podeSobrepor(actual.lugar)
            const perms = props.sobreposicoes(actual.lugar)
            return (
              <>
                {!pode && <p className="cep-nota">{t.semPermissaoNoLugar}</p>}
                <table className="cep-tabela">
                  <thead>
                    <tr>
                      <th scope="col" />
                      {PODERES_POR_SALA_CUMPRIDOS.map((poder) => (
                        <th key={poder} scope="col" title={`${strings.cargos.powerHelp[poder] ?? ""} ${naturezaDe(poder)}`}>
                          {nomeDoPoder(poder)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((linha) => (
                      <tr key={linha.role}>
                        <th scope="row">{linha.name}</th>
                        {PODERES_POR_SALA_CUMPRIDOS.map((poder) => (
                          <td key={poder}>
                            <select
                              aria-label={t.estadoDe(nomeDoPoder(poder), linha.name, nomeDoLugar(actual))}
                              disabled={!pode || !props.poderesProprios.includes(poder)}
                              value={estadoNaSobreposicao(perms, linha.role, poder)}
                              onChange={(e) =>
                                props.onSobrepor(actual.lugar, comEstado(perms, linha.role, poder, e.target.value as EstadoDaSobreposicao))
                              }
                            >
                              <option value="herda">{t.estado.herda}</option>
                              <option value="da">{t.estado.da}</option>
                              <option value="tira">{t.estado.tira}</option>
                            </select>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )
          })()}
        </>
      )}
    </section>
  )
}

export function CargosEPermissoes(props: PropsDeCargosEPermissoes): React.JSX.Element {
  const partes = { cargos: true, todos: true, sobreposicoes: true, ...props.partes }
  return (
    <div className="cargos-e-permissoes">
      {partes.cargos && <SeccaoOrdem {...props} />}
      {partes.todos && <SeccaoTodos {...props} />}
      {partes.sobreposicoes && <SeccaoSobreposicoes {...props} />}
    </div>
  )
}
