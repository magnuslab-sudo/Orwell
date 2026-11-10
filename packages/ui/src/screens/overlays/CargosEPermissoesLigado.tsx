import { useState } from "react"
import { compararCargos, PODERES_DE_TODOS_POR_OMISSAO, type Power } from "@enclave/protocol"
import type { EnclaveBridge } from "../../bridge.js"
import { podeOrdenarCargos } from "../../components/OrdemDosCargos.js"
import { strings, traduzirErro } from "../../strings.js"
import { CargosEPermissoes, type LugarNaLista, type PropsDeCargosEPermissoes } from "./CargosEPermissoes.js"

/**
 * `CargosEPermissoes` wired to the bridge, for the "Roles" section of channel
 * properties. Reads the bridge on each render and re-reads after each gesture.
 *
 * Null when the host does not have the permissions model (`bridge.channels.permissoes`):
 * an older desktop app keeps the traditional role editor.
 */
export function CargosEPermissoesLigado({
  bridge,
  channel,
  address,
  partes,
  podeCriar = false,
  ordemAoLado = false,
  onMudou,
  onErro,
}: {
  bridge: EnclaveBridge
  channel: string
  /** The account of the user. */
  address: string
  partes?: PropsDeCargosEPermissoes["partes"]
  /** The traditional role editor already creates roles inline: by default, this one does not. */
  podeCriar?: boolean
  /**
   * The traditional role editor is inline and already reorders (`RoleEditor` with
   * `onReorder`). For users who can reorder, the "Role order" section here comes out:
   * two draggable lists of the same roles, one above the other, were two doors to the
   * same gesture. Those who manage by delegation and do not reorder still see it,
   * for reading the order and modifying roles below theirs.
   */
  ordemAoLado?: boolean
  /** Roles changed, for those keeping a copy like the member list. */
  onMudou?: () => void
  onErro: (mensagem: string) => void
}): React.JSX.Element | null {
  const [, setVersao] = useState(0)
  const p = bridge.channels.permissoes
  if (!p) return null
  const depois = (pedido: Promise<unknown> | undefined): Promise<void> =>
    Promise.resolve(pedido)
      .then(() => {
        setVersao((n) => n + 1)
        onMudou?.()
      })
      .catch((error: Error) => onErro(traduzirErro(error)))
  // Channel order, same rule as core and the traditional editor.
  const cargos = [...bridge.channels.roles(channel)]
    .sort(compararCargos)
    .map((papel) => ({ role: papel.role, name: papel.name, colour: papel.colour, powers: papel.powers, rank: papel.rank ?? 0 }))
  const salas = bridge.channels.rooms(channel)
  const categorias = [...new Set([...(bridge.channels.categories?.(channel) ?? []).filter((c) => c.removed !== true).map((c) => c.category), ...salas.map((s) => s.category)])].filter(Boolean)
  const lugares: LugarNaLista[] = [
    ...categorias.map((categoria) => ({ lugar: { categoria }, nome: categoria })),
    ...salas.map((sala) => ({ lugar: { sala: sala.room }, nome: sala.name })),
  ]
  const ordena = podeOrdenarCargos(bridge, channel, address)
  const todos = p.todos(channel)
  const gereTudo = bridge.channels.mayManageRoles?.(channel) ?? false
  const doPapel = (role: string): (typeof cargos)[number] | undefined => cargos.find((c) => c.role === role)
  const definir = (role: string, mudanca: { name?: string; colour?: string | undefined; powers?: Power[] }): void => {
    const actual = doPapel(role)
    if (!actual) return
    const cor = "colour" in mudanca ? mudanca.colour : actual.colour
    void depois(
      bridge.channels.defineRole(channel, {
        role,
        name: mudanca.name ?? actual.name,
        powers: mudanca.powers ?? [...actual.powers],
        ...(cor ? { colour: cor } : {}),
      }),
    )
  }
  return (
    <CargosEPermissoes
      cargos={cargos}
      todos={todos.definido ? todos.powers : [...PODERES_DE_TODOS_POR_OMISSAO]}
      lugares={lugares}
      sobreposicoes={(lugar) => p.sobreposicoes(channel, lugar)}
      poderesProprios={p.em(channel, address)}
      podeGerir={(role) => gereTudo && p.mayManageRole(channel, role)}
      podeCriar={podeCriar && gereTudo}
      podeOrdenar={ordena}
      podeSobrepor={(lugar) => p.maySetSobreposicoes(channel, lugar)}
      delegacaoLigada={p.delegacao(channel)}
      {...(partes || (ordemAoLado && ordena) ? { partes: { ...(ordemAoLado && ordena ? { cargos: false } : {}), ...partes } } : {})}
      onCriar={(nome) => {
        const base = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
        const usados = new Set(cargos.map((c) => c.role))
        let id = base || "papel"
        for (let n = 2; usados.has(id); n += 1) id = `${base}-${n}`
        void depois(bridge.channels.defineRole(channel, { role: id, name: nome, powers: [], rank: 0 }))
      }}
      onMudar={definir}
      onApagar={(role) => void depois(bridge.channels.deleteRole(channel, role))}
      onOrdenar={(ordem) => depois(bridge.channels.reorderRoles?.(channel, ordem))}
      onTodos={(powers) => void depois(bridge.channels.defineRole(channel, { role: "@todos", name: strings.cargosEPermissoes.todos, powers }))}
      onSobrepor={(lugar, perms) => void depois(p.setSobreposicoes(channel, lugar, perms))}
    />
  )
}
