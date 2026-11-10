/**
 * The accounts on this device ("Switch account", requested by the owner on
 * November 3, 2026).
 *
 * A device held ONE account: one vault, and its remembered session. To log out
 * of one account and into another without losing the first, the device can now
 * have several, each with its OWN vault and its OWN remembered session, side by
 * side. This list says which ones exist and which one is active.
 *
 * **Nothing changes for anyone with just one account.** The account the device
 * always had is `CONTA_PRINCIPAL`, stored where it always was (`vault.enc` on
 * the desktop, key `current` in IndexedDB). With no list saved, the device has
 * only it. The list is saved only when the person adds a second account.
 *
 * **What is in the clear.** Each account's id is random and says nothing. The
 * name is the profile name, so the gate can say "Ana" and "Bruno" without
 * opening any vault. It is the only new thing in the clear on the device, and
 * it exists only with two or more accounts (`docs/THREAT-MODEL.md`).
 */

/** The account the device always had, in the place where it always was. */
export const CONTA_PRINCIPAL = "principal"

export interface ContaDoAparelho {
  id: string
  /** The profile name the last time this account was open. Can be "". */
  nome: string
}

export interface ListaDeContas {
  v: 1
  activa: string
  contas: ContaDoAparelho[]
}

/** The device as always: one account, the main one. */
export function listaSozinha(): ListaDeContas {
  return { v: 1, activa: CONTA_PRINCIPAL, contas: [{ id: CONTA_PRINCIPAL, nome: "" }] }
}

/**
 * An id that serves as a folder name and an IndexedDB key with no escaping:
 * only lowercase letters and digits. The main one also qualifies.
 */
export function idDeContaValido(id: unknown): id is string {
  return typeof id === "string" && /^[a-z0-9]{1,32}$/.test(id)
}

/** A new, random id (16 characters of base 36). */
export function idDeContaNova(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("")
}

/**
 * The saved list, read with suspicion: anything that does not have the right
 * shape counts as not being there, and the active account must be in the list.
 * A corrupted file gives the device as always, which opens the main account.
 */
export function lerListaDeContas(texto: string | null | undefined): ListaDeContas {
  if (!texto) return listaSozinha()
  try {
    const bruto = JSON.parse(texto) as Partial<ListaDeContas> | null
    if (!bruto || bruto.v !== 1 || !Array.isArray(bruto.contas)) return listaSozinha()
    const vistas = new Set<string>()
    const contas: ContaDoAparelho[] = []
    for (const conta of bruto.contas) {
      const id = (conta as Partial<ContaDoAparelho> | null)?.id
      if (!idDeContaValido(id) || vistas.has(id)) continue
      vistas.add(id)
      const nome = (conta as Partial<ContaDoAparelho>).nome
      contas.push({ id, nome: typeof nome === "string" ? nome.slice(0, 80) : "" })
    }
    if (contas.length === 0) return listaSozinha()
    const activa = idDeContaValido(bruto.activa) && vistas.has(bruto.activa) ? bruto.activa : (contas[0] as ContaDoAparelho).id
    return { v: 1, activa, contas }
  } catch {
    return listaSozinha()
  }
}

/** The list with a new account, active. */
export function comContaNova(lista: ListaDeContas, id: string): ListaDeContas {
  if (lista.contas.some((conta) => conta.id === id)) return { ...lista, activa: id }
  return { v: 1, activa: id, contas: [...lista.contas, { id, nome: "" }] }
}

/** The list with another account active. Throw if the account is not on this device. */
export function comContaActiva(lista: ListaDeContas, id: string): ListaDeContas {
  if (!lista.contas.some((conta) => conta.id === id)) throw new Error("there is no such account on this device")
  return { ...lista, activa: id }
}

/** The name of an account, as the profile says it now. */
export function comNome(lista: ListaDeContas, id: string, nome: string): ListaDeContas {
  const limpo = nome.trim().slice(0, 80)
  return { ...lista, contas: lista.contas.map((conta) => (conta.id === id ? { ...conta, nome: limpo } : conta)) }
}

/**
 * The list without an account (deleted, or a new account that never had a
 * vault). If it was active, the first remaining one becomes active. With none
 * left, the device goes back to as always.
 */
export function semConta(lista: ListaDeContas, id: string): ListaDeContas {
  const contas = lista.contas.filter((conta) => conta.id !== id)
  if (contas.length === 0) return listaSozinha()
  const activa = lista.activa === id ? (contas[0] as ContaDoAparelho).id : lista.activa
  return { v: 1, activa, contas }
}

/**
 * Does this list need to be saved? Only with more than one account, or with an
 * account that is not the main one. The list as always is not saved: it is the
 * absence of it.
 */
export function listaPrecisaDeGravar(lista: ListaDeContas): boolean {
  return lista.contas.length > 1 || lista.activa !== CONTA_PRINCIPAL || lista.contas[0]?.id !== CONTA_PRINCIPAL
}

/** What the host knows how to do with accounts: where the list lives, and what is in each one. */
export interface PortaDasContas {
  /** The saved list, as text, or `null` with no list. */
  lerLista(): string | null
  /** Save the list; `null` deletes it (the device as always). */
  gravarLista(texto: string | null): void
  /** What this account has on this device, without opening anything. */
  estadoDaConta(id: string): Promise<{ temCofre: boolean; memorizada: boolean }>
  /** Clears what remains of an account that leaves the list (an empty folder). Optional. */
  largarConta?(id: string): Promise<void>
}

/** An account as the interface sees it. */
export interface ContaNaLista extends ContaDoAparelho {
  activa: boolean
  temCofre: boolean
  memorizada: boolean
}

/**
 * Switch account operations, identical on both hosts. The caller closes the
 * session and vault of the account being left BEFORE `switch` or `add`, then
 * reloads the interface: the vault the host opens next belongs to the active
 * account in the list.
 *
 * The list is reread on each operation: in the browser, another tab may have
 * changed it while this one waited for the lock.
 */
export class ContasDoAparelho {
  readonly #porta: PortaDasContas

  constructor(porta: PortaDasContas) {
    this.#porta = porta
  }

  /** The persisted list, or the default one. */
  get lista(): ListaDeContas {
    return lerListaDeContas(this.#porta.lerLista())
  }

  get activa(): string {
    return this.lista.activa
  }

  /**
   * The accounts and what each holds. `nomeDaActiva` is the profile name of the
   * currently open account, if any: it stays in the list so the gate can report
   * it later. Only persisted once the list itself is persisted (two or more
   * accounts).
   */
  async listar(nomeDaActiva?: string): Promise<ContaNaLista[]> {
    let lista = this.lista
    if (nomeDaActiva !== undefined && listaPrecisaDeGravar(lista)) {
      lista = comNome(lista, lista.activa, nomeDaActiva)
      this.#gravar(lista)
    }
    return Promise.all(
      lista.contas.map(async (conta) => ({
        ...conta,
        activa: conta.id === lista.activa,
        ...(await this.#porta.estadoDaConta(conta.id)),
      })),
    )
  }

  /**
   * Another account becomes active. An account being left without a vault (an
   * added account that was never created) leaves the list.
   */
  async mudar(id: string, nomeDaActiva?: string): Promise<void> {
    let lista = this.lista
    comContaActiva(lista, id)
    if (lista.activa === id) return
    lista = await this.#largarSeVazia(this.#nomear(lista, nomeDaActiva))
    this.#gravar(comContaActiva(lista, id))
  }

  /** A new, empty account becomes active. The gate opens signup on it. */
  async acrescentar(nomeDaActiva?: string): Promise<string> {
    const lista = await this.#largarSeVazia(this.#nomear(this.lista, nomeDaActiva))
    const id = idDeContaNova()
    this.#gravar(comContaNova(lista, id))
    return id
  }

  /** The active account was deleted: it leaves the list, and another becomes active. */
  async esquecerActiva(): Promise<void> {
    const lista = this.lista
    if (lista.contas.length <= 1 && lista.activa === CONTA_PRINCIPAL) return
    await this.#porta.largarConta?.(lista.activa)
    this.#gravar(semConta(lista, lista.activa))
  }

  #nomear(lista: ListaDeContas, nome: string | undefined): ListaDeContas {
    return nome === undefined ? lista : comNome(lista, lista.activa, nome)
  }

  async #largarSeVazia(lista: ListaDeContas): Promise<ListaDeContas> {
    const { temCofre } = await this.#porta.estadoDaConta(lista.activa)
    if (temCofre || lista.contas.length <= 1) return lista
    await this.#porta.largarConta?.(lista.activa)
    return semConta(lista, lista.activa)
  }

  #gravar(lista: ListaDeContas): void {
    this.#porta.gravarLista(listaPrecisaDeGravar(lista) ? JSON.stringify(lista) : null)
  }
}
