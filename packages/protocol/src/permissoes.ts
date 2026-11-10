import { IRREVERSIBLE_POWERS, POWERS, type Power, type Sobreposicao } from "./payload.js"

/**
 * The permissions model (1.2), stateless: `docs/planos/paridade-discord-plano.md`, §4.
 *
 * Everything here is a pure function of an `EstadoDePermissoes`. The session builds
 * the state from the vault and asks. It lives in the protocol so there is ONE rule:
 * whoever sends (`may`, the buttons) and whoever receives (`#recordPayload`, the
 * portrait) ask the same function, and the tests of this rule need no network.
 *
 * **What this guarantees, stated plainly.** Nothing here is cryptographic. Each
 * honest client decides on receipt and on send; an altered client sends what it
 * wants, and what stops it from having effect is honest clients refusing. The only
 * permission with the weight of encryption is still `expulsar` (removes the MLS
 * leaf), and even that only in effect. The per-room overlays are organization of who
 * can do what, and do not take away any key: the room is a label inside the group.
 */

/**
 * "orwell-permissoes-v1", in the private use range, alongside `EXTENSAO_RETRATO`.
 *
 * Never travels as an extension: it is only DECLARED in the capabilities of the
 * leaf (the key package of whoever enters). It means "this client reads the `rank`,
 * the `perms` and the new powers, and verifies the signature of a role or room that
 * carries them". A 1.1.0 declares the portrait and does not declare this: strips the
 * new fields before verifying, and a portrait item with them does not verify there.
 * Whoever invites does not skip the cascade if some new leaf does not declare this,
 * and the 1.1.0 receives live (authenticated by MLS) what the portrait does not
 * prove to it.
 */
export const EXTENSAO_PERMISSOES = 0xf0f1

/** The built-in admin role. Gives everything, and never erases. */
export const CARGO_ADMIN = "admin"

/**
 * The built-in role "everyone": the base permissions for everyone on the channel.
 *
 * **`@todos` and not `todos`**, and this is a deviation from the plan. The identifiers
 * of roles created by the interface come from the name (`criarPapel` in `App.tsx`:
 * lowercase, letters, digits and hyphens), and a role called "Everyone" would get
 * the id `todos`. In a channel that already has it, the built-in role with that name
 * would give everyone the powers of a role that someone assigned to three people.
 * With `@` at the front no interface id collides.
 *
 * A normal `role.define`. Not assigned to anyone (applies to all), not deleted (republish
 * without powers is "nobody can do anything basic"). A client 1.0.x or 1.1.0
 * lists it as one more role called "everyone" and lets it be assigned: harmless,
 * because whoever gets it already had it.
 */
export const CARGO_TODOS = "@todos"

/**
 * What everyone can do when the channel did not set `@todos`: what is free
 * today. Absent or deleted, this applies.
 */
export const PODERES_DE_TODOS_POR_OMISSAO: readonly Power[] = [
  "escrever",
  "anexar",
  "reagir",
  "ligar",
  "falar",
  "video",
  "ecra",
  "musica",
]

/** The eight powers that clients 1.0.x and 1.1.0 know. See `fundirCargoAntigo`. */
export const PODERES_ANTIGOS: readonly Power[] = POWERS.slice(0, 8)

/**
 * Whoever has the top power has the bottom one. The migration of roles that
 * already existed (§4.4): `gerirsalas` came out of `renomear`, `apelidos` out
 * of `moderar`, and `desligar` out of `mover`. A role saved with the old power
 * keeps doing everything it did, with no rewrite.
 *
 * Always, not just in old roles: "manage the channel" includes rooms, and
 * moving someone includes removing them from the call, as in Discord. To grant
 * only the bottom power, grant only the bottom power.
 */
export const IMPLICACOES: Readonly<Partial<Record<Power, readonly Power[]>>> = {
  renomear: ["gerirsalas"],
  moderar: ["apelidos"],
  mover: ["desligar"],
}

/**
 * The permissions that a room or category override can change. The others
 * belong to the entire channel (kick, invite, manage roles, manage the channel,
 * delete the channel) and a room cannot change them.
 */
export const PODERES_POR_SALA: readonly Power[] = [
  "gerirsalas",
  "mover",
  "desligar",
  "fixar",
  "moderar",
  "apelidos",
  "atender",
  "escrever",
  "anexar",
  "reagir",
  "mencionartodos",
  "ligar",
  "falar",
  "video",
  "ecra",
  "musica",
  "silenciarvoz",
  "ensurdecer",
  "prioridade",
]

/**
 * The permissions that THIS version enforces: the ones the interface offers.
 * The others in `POWERS` are recorded vocabulary for future releases (write,
 * react, ban...), and offering a toggle that does nothing would promise what
 * the app does not deliver.
 */
export const PODERES_CUMPRIDOS: readonly Power[] = [
  ...PODERES_ANTIGOS,
  "gerircargos",
  "gerirsalas",
  "desligar",
  "mencionartodos",
]

/** The per-room permissions that THIS version enforces (`mover`, `desligar`, `gerirsalas`, `mencionartodos`). */
export const PODERES_POR_SALA_CUMPRIDOS: readonly Power[] = ["mover", "desligar", "gerirsalas", "mencionartodos"]

/**
 * The mention of everyone (`@all`, `@todos`, `@everyone`) in the thread: this text
 * inside `mentions`, in place of an address.
 *
 * An address always starts with `@` (`@a-b-c-d:servidor`), and this text does not: it never
 * collides with an account. A client 1.1.0 reads it as one more address that is not
 * theirs, and the message arrives with no mention. Nothing rejects it.
 *
 * **App rule, not cipher rule.** The sender without `mencionartodos` does not add it;
 * the receiver checks the author's permission in that room (`mencoesConferidas`) and
 * discards it if they do not have it. A modified app can send it anyway; honest
 * apps do not give it effect.
 */
export const MENCAO_TODOS = "todos"

/**
 * The mentions that count, after checking the sender's permission.
 *
 * `podeMencionarTodos` is the answer from `permissoesEm(estado, autor, { sala })`
 * for `mencionartodos`. Without it, `MENCAO_TODOS` is removed, and the addresses
 * remain. Returns the SAME list when nothing changes, for identity comparison.
 */
export function mencoesConferidas(mentions: readonly string[], podeMencionarTodos: boolean): readonly string[] {
  if (podeMencionarTodos || !mentions.includes(MENCAO_TODOS)) return mentions
  return mentions.filter((mencao) => mencao !== MENCAO_TODOS)
}

/** Only the names this version knows, in the order of `POWERS`. A future name is not granted. */
export function poderesConhecidos(lista: unknown): Power[] {
  if (!Array.isArray(lista)) return []
  const tem = new Set(lista as unknown[])
  return POWERS.filter((poder) => tem.has(poder))
}

/** The list with the implications (`IMPLICACOES`) added. */
export function comImplicacoes(poderes: Iterable<Power>): Set<Power> {
  const todos = new Set<Power>()
  for (const poder of poderes) {
    todos.add(poder)
    for (const implicado of IMPLICACOES[poder] ?? []) todos.add(implicado)
  }
  return todos
}

/** A role as defined, the way the model reads it. */
export interface CargoDefinido {
  powers: readonly Power[]
  rank: number
}

/**
 * The state of a channel that the model needs to read. The session builds it
 * from the vault; tests build it by hand.
 */
export interface EstadoDePermissoes {
  /** Whoever founded it, or null if not known. */
  fundador: string | null
  /** The identifiers of this person's roles (including `admin` if they have it). */
  cargosDe(address: string): readonly string[]
  /** A role defined and active, without `admin` or `@todos`. */
  cargo(role: string): CargoDefinido | undefined
  /** The permissions of `@todos`: the ones defined, or `PODERES_DE_TODOS_POR_OMISSAO`. */
  todos: readonly Power[]
  /** The category name of a room ("" if not in a category). */
  categoriaDaSala?(room: string): string
  /** The saved overrides of a room. */
  sobreposicoesDaSala?(room: string): readonly Sobreposicao[] | undefined
  /** The saved overrides of a category. */
  sobreposicoesDaCategoria?(category: string): readonly Sobreposicao[] | undefined
}

/** Where we ask: the entire channel, a room, or a category. */
export interface Lugar {
  sala?: string | undefined
  categoria?: string | undefined
}

function aplicar(tem: Set<Power>, sobreposicoes: readonly Sobreposicao[] | undefined, cargos: readonly string[]): void {
  if (!sobreposicoes || sobreposicoes.length === 0) return
  const meus = new Set(cargos)
  const daSala = (poderes: readonly string[]): Power[] =>
    poderesConhecidos(poderes).filter((poder) => PODERES_POR_SALA.includes(poder))
  const deTodos = sobreposicoes.filter((entrada) => entrada.role === CARGO_TODOS)
  const dosCargos = sobreposicoes.filter((entrada) => entrada.role !== CARGO_TODOS && meus.has(entrada.role))
  // Discord's order: everyone's first, then roles in order; within each one,
  // remove before grant. A "grant" from a role beats a "remove" from everyone.
  for (const entrada of deTodos) for (const poder of daSala(entrada.deny)) tem.delete(poder)
  for (const entrada of deTodos) for (const poder of comImplicacoes(daSala(entrada.allow))) tem.add(poder)
  for (const entrada of dosCargos) for (const poder of daSala(entrada.deny)) tem.delete(poder)
  for (const entrada of dosCargos) for (const poder of comImplicacoes(daSala(entrada.allow))) tem.add(poder)
}

/**
 * What this person can do in this place. The single source of truth (§4.3).
 *
 * 1. Founder can do everything and cannot be removed.
 * 2. No known founder: only what is unconditional (the rule from `powersOf`, before).
 * 3. `admin` can do everything; overrides do not touch it.
 * 4. The base: `@todos` plus this person's roles, with implications.
 * 5. The room's category, then the room (`aplicar`).
 */
export function permissoesEm(estado: EstadoDePermissoes, address: string, lugar: Lugar = {}): Power[] {
  if (estado.fundador !== null && estado.fundador === address) return [...POWERS]
  if (estado.fundador === null) return POWERS.filter((poder) => !IRREVERSIBLE_POWERS.includes(poder))
  const cargos = estado.cargosDe(address)
  if (cargos.includes(CARGO_ADMIN)) return [...POWERS]
  const base: Power[] = [...estado.todos]
  // A deleted role grants nothing, even to someone who still has it in their list.
  for (const role of cargos) base.push(...(estado.cargo(role)?.powers ?? []))
  const tem = comImplicacoes(base)
  const categoria =
    lugar.categoria ?? (lugar.sala !== undefined ? (estado.categoriaDaSala?.(lugar.sala) ?? "") : undefined)
  if (categoria) aplicar(tem, estado.sobreposicoesDaCategoria?.(categoria), cargos)
  if (lugar.sala !== undefined) aplicar(tem, estado.sobreposicoesDaSala?.(lugar.sala), cargos)
  return POWERS.filter((poder) => tem.has(poder))
}

/**
 * A person's height in the hierarchy: founder above all, `admin` right after,
 * then the highest `rank` of their roles. No roles: -1, below any role, so
 * whoever manages a role with `rank` 0 can grant it to them.
 */
export function alturaDe(estado: EstadoDePermissoes, address: string): number {
  if (estado.fundador !== null && estado.fundador === address) return Number.POSITIVE_INFINITY
  const cargos = estado.cargosDe(address)
  if (cargos.includes(CARGO_ADMIN)) return Number.MAX_SAFE_INTEGER
  let altura = -1
  for (const role of cargos) {
    const cargo = estado.cargo(role)
    if (cargo) altura = Math.max(altura, cargo.rank)
  }
  return altura
}

/**
 * The channel's order: the order in which roles appear everywhere.
 *
 * Highest `rank` first, because the list IS the hierarchy: the top role commands
 * those below. Then `position` ascending and name, which are the pre-1.2 order
 * and break ties among roles that still have `rank` zero (all of them).
 *
 * A 1.1.x client only reads `position`. So `reorderRoles` always writes both to
 * match (the first with the highest `rank` and position zero), and a new role is
 * born at the bottom of both. Someone who never reordered sees the same order
 * always; someone who did sees the same order across all versions.
 *
 * `admin` and `@todos` do not enter here: they have a fixed place (`alturaDoCargo`),
 * the first above all and the second at the bottom.
 */
export function compararCargos(
  a: { name: string; rank?: number | undefined; position?: number | undefined },
  b: { name: string; rank?: number | undefined; position?: number | undefined },
): number {
  return (b.rank ?? 0) - (a.rank ?? 0) || (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name)
}

/** A role's height. `@todos` is below everything; `admin`, above all declared ones. */
export function alturaDoCargo(estado: EstadoDePermissoes, role: string): number {
  if (role === CARGO_ADMIN) return Number.MAX_SAFE_INTEGER
  if (role === CARGO_TODOS) return -1
  return estado.cargo(role)?.rank ?? 0
}

/**
 * Whether this person commands the channel's roles without limit (founder or
 * `admin`). It is the rule from before (`#mandaEm`), and it still is the one a
 * 1.0.x knows.
 */
export function mandaNosCargos(estado: EstadoDePermissoes, address: string): boolean {
  if (estado.fundador === null) return false
  if (estado.fundador === address) return true
  return estado.cargosDe(address).includes(CARGO_ADMIN)
}

/** Whether `a` is contained in `b`. */
function contido(a: Iterable<Power>, b: ReadonlySet<Power>): boolean {
  for (const poder of a) if (!b.has(poder)) return false
  return true
}

/**
 * Whether `actor` can create, change, or delete the role `role`, from `antes`
 * to `depois` (§4.3, `#podeGerirCargo`). `antes` is the role as it stands (absent
 * if it does not exist); `depois` is how it becomes (absent to only ask).
 *
 * Founder: yes. `admin`: yes, also over `admin` itself (the name and color, as
 * of 2/11/2026: its powers do not change). Others: delegation. `gerircargos`, and
 * the role below the one who manages it, BEFORE and AFTER, and the role's powers
 * contained in those of the one who assigns it, BEFORE and AFTER. A role never
 * grants more power than the one assigning it has: this is what stops escalation.
 */
export function podeGerirCargo(
  estado: EstadoDePermissoes,
  actor: string,
  role: string,
  mudanca: { antes?: CargoDefinido | undefined; depois?: CargoDefinido | undefined } = {},
): boolean {
  if (mandaNosCargos(estado, actor)) return true
  if (estado.fundador === null) return false
  if (role === CARGO_ADMIN) return false
  const minhas = new Set(permissoesEm(estado, actor))
  if (!minhas.has("gerircargos")) return false
  const altura = alturaDe(estado, actor)
  const antes = mudanca.antes ?? (role === CARGO_TODOS ? { powers: estado.todos, rank: -1 } : estado.cargo(role))
  const alturaAntes = role === CARGO_TODOS ? -1 : (antes?.rank ?? 0)
  if (alturaAntes >= altura) return false
  if (antes && !contido(antes.powers, minhas)) return false
  if (mudanca.depois) {
    const alturaDepois = role === CARGO_TODOS ? -1 : mudanca.depois.rank
    if (alturaDepois >= altura) return false
    if (!contido(mudanca.depois.powers, minhas)) return false
  }
  return true
}

/**
 * Whether `actor` can change `subject`'s roles from `antes` to `depois`.
 *
 * Founder and `admin`: yes, as always. Others: never over the founder, only
 * over those below them, and each role that enters or leaves must pass through
 * `podeGerirCargo`. `@todos` does not count: it applies to everyone the same.
 */
export function podeAtribuir(
  estado: EstadoDePermissoes,
  actor: string,
  subject: string,
  antes: readonly string[],
  depois: readonly string[],
): boolean {
  if (mandaNosCargos(estado, actor)) return true
  if (estado.fundador === null || subject === estado.fundador) return false
  if (alturaDe(estado, subject) >= alturaDe(estado, actor)) return false
  const a = new Set(antes)
  const b = new Set(depois)
  const mudados = [...new Set([...antes, ...depois])].filter((role) => a.has(role) !== b.has(role) && role !== CARGO_TODOS)
  return mudados.every((role) => podeGerirCargo(estado, actor, role))
}

function chaveDaEntrada(entrada: Sobreposicao): string {
  return JSON.stringify([[...new Set(entrada.allow)].sort(), [...new Set(entrada.deny)].sort()])
}

/**
 * Whether `actor` can change the overrides of a place from `antes` to `depois`.
 *
 * Founder and `admin`: yes. No known founder: nobody (a rule with no known owner
 * is not saved). Others: `gerirsalas` in that place, and each entry that changes
 * is from `@todos` or from a role below the one making the change, and only talks
 * about permissions the changer has there. Do not grant or remove what you do not have.
 */
export function podeSobrepor(
  estado: EstadoDePermissoes,
  actor: string,
  lugar: Lugar,
  antes: readonly Sobreposicao[] | undefined,
  depois: readonly Sobreposicao[],
): boolean {
  if (mandaNosCargos(estado, actor)) return true
  if (estado.fundador === null) return false
  const minhas = new Set(permissoesEm(estado, actor, lugar))
  if (!minhas.has("gerirsalas")) return false
  const altura = alturaDe(estado, actor)
  const porCargo = (lista: readonly Sobreposicao[] | undefined): Map<string, Sobreposicao> =>
    new Map((lista ?? []).map((entrada) => [entrada.role, entrada]))
  const velhas = porCargo(antes)
  const novas = porCargo(depois)
  for (const role of new Set([...velhas.keys(), ...novas.keys()])) {
    const velha = velhas.get(role)
    const nova = novas.get(role)
    if (velha && nova && chaveDaEntrada(velha) === chaveDaEntrada(nova)) continue
    if (role === CARGO_ADMIN) return false
    if (role !== CARGO_TODOS && alturaDoCargo(estado, role) >= altura) return false
    for (const entrada of [velha, nova]) {
      if (!entrada) continue
      if (!contido(poderesConhecidos([...entrada.allow, ...entrada.deny]), minhas)) return false
    }
  }
  return true
}

/**
 * The `role.define` to save when what arrives was written by an old client
 * (without `rank`) on top of one written by a new one (with `rank`).
 *
 * A 1.0.x or 1.1.0 only knows the eight old powers and does not know `rank`:
 * it republishes the role (when renaming it, or each time someone joins, with
 * the original date) without them. Without this merge, every old administrator
 * who connected would erase the hierarchy and new powers from the entire channel,
 * and nobody would notice. With it, what the old writer said applies to what they
 * know how to say (the name, color, position, the eight old ones, the tombstone),
 * and the rest stays as it was.
 */
export function fundirCargoAntigo(
  guardado: Readonly<Record<string, unknown>> | undefined,
  proposto: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const novo = { ...proposto }
  if (proposto["rank"] !== undefined || proposto["removed"] === true) return novo
  if (!guardado || guardado["removed"] === true || typeof guardado["rank"] !== "number") return novo
  const antigos = new Set<string>(PODERES_ANTIGOS)
  const ditos = Array.isArray(proposto["powers"]) ? (proposto["powers"] as unknown[]).filter((p) => typeof p === "string") : []
  const mantidos = Array.isArray(guardado["powers"])
    ? (guardado["powers"] as unknown[]).filter((p): p is string => typeof p === "string" && !antigos.has(p))
    : []
  novo["powers"] = [...new Set([...ditos, ...mantidos])]
  novo["rank"] = guardado["rank"]
  return novo
}

/**
 * The overrides to save for a place, with the `pinned` rule: absent keeps what
 * was known; present from someone who can changes it; present from someone who
 * cannot falls without taking the room with it.
 */
export function sobreposicoesAGuardar(
  anteriores: readonly Sobreposicao[] | undefined,
  propostas: readonly Sobreposicao[] | undefined,
  pode: boolean,
): readonly Sobreposicao[] | undefined {
  if (propostas === undefined || !pode) return anteriores
  return propostas
}
