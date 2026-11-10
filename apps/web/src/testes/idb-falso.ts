/**
 * A fake IndexedDB, with the part of the contract that the vault depends on.
 *
 * jsdom does not ship IndexedDB, and the `fake-indexeddb` package is not in the project.
 * This fake mimics only what `vault-backend.ts` uses, but it mimics it for real:
 *
 * - transactions run one at a time, in the order they were created
 *   (this is what the browser does for `readwrite` transactions on the same store, from
 *   any connection, that is, from any tab);
 * - what a transaction writes only becomes visible on `oncomplete`, and an `abort`
 *   discards everything it did;
 * - requests made inside the `onsuccess` of another request belong to the same
 *   transaction (this is how the owner's token is read and written without races).
 *
 * `reter` lets the test decide when each transaction completes.
 */

type Op = { fazer: (dados: Map<string, unknown>) => unknown; pedido: PedidoFalso }

interface PedidoFalso {
  result: unknown
  error: DOMException | null
  onsuccess: (() => void) | null
  onerror: (() => void) | null
}

class TxFalsa {
  readonly ops: Op[] = []
  oncomplete: (() => void) | null = null
  onabort: (() => void) | null = null
  onerror: (() => void) | null = null
  error: DOMException | null = null
  abortada = false
  activa = false
  aCorrer = false
  staging: Map<string, unknown> | null = null
  puts = 0
  putsDoCofre = 0

  constructor(
    private readonly idb: IdbFalso,
    readonly modo: string,
  ) {}

  objectStore(): unknown {
    const pedir = (fazer: Op["fazer"]): PedidoFalso => {
      if (this.abortada) throw new DOMException("transaction aborted", "TransactionInactiveError")
      const pedido: PedidoFalso = { result: undefined, error: null, onsuccess: null, onerror: null }
      this.ops.push({ fazer, pedido })
      if (this.activa) this.idb.processar(this)
      return pedido
    }
    return {
      get: (chave: string) => pedir((dados) => dados.get(chave)),
      put: (valor: unknown, chave: string) =>
        pedir((dados) => {
          if (this.modo !== "readwrite") throw new DOMException("read only", "ReadOnlyError")
          this.puts += 1
          if (chave === "current") this.putsDoCofre += 1
          dados.set(chave, valor)
          return chave
        }),
      delete: (chave: string) =>
        pedir((dados) => {
          dados.delete(chave)
          return undefined
        }),
    }
  }

  abort(): void {
    if (this.abortada) return
    this.abortada = true
    this.idb.abortar(this)
  }
}

export class IdbFalso {
  readonly dados = new Map<string, unknown>()
  /** How many `put` calls reached disk (complete transactions). */
  putsGravados = 0
  /** Of those, how many came from the vault itself (the `current` key), not counting the token. */
  putsDoCofre = 0
  /** How many times `open` was called. */
  aberturas = 0
  /** How many transactions were created. */
  transaccoes = 0
  reter = false
  readonly #retidas: (() => void)[] = []
  readonly #fila: TxFalsa[] = []
  #activa: TxFalsa | null = null

  readonly indexedDB = {
    open: (): PedidoFalso & { onupgradeneeded: (() => void) | null } => {
      this.aberturas += 1
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => {},
        close: () => {},
        onversionchange: null,
        onclose: null,
        transaction: (_store: string, modo: string) => {
          this.transaccoes += 1
          const tx = new TxFalsa(this, modo)
          this.#fila.push(tx)
          setTimeout(() => this.#seguinte(), 0)
          return tx
        },
      }
      const pedido = { result: db as unknown, error: null, onsuccess: null as (() => void) | null, onerror: null, onupgradeneeded: null }
      setTimeout(() => pedido.onsuccess?.(), 0)
      return pedido
    },
  }

  /** Let retained transactions complete. */
  soltar(): void {
    this.reter = false
    for (const acabar of this.#retidas.splice(0)) acabar()
  }

  get retidas(): number {
    return this.#retidas.length
  }

  #seguinte(): void {
    if (this.#activa) return
    const tx = this.#fila.shift()
    if (!tx) return
    if (tx.abortada) {
      this.#seguinte()
      return
    }
    this.#activa = tx
    tx.activa = true
    tx.staging = new Map(this.dados)
    this.processar(tx)
  }

  processar(tx: TxFalsa): void {
    if (tx.aCorrer || tx.abortada) return
    const op = tx.ops.shift()
    if (!op) {
      // No requests: wait a moment for requests made in `onsuccess` callbacks.
      setTimeout(() => {
        if (tx.ops.length > 0) this.processar(tx)
        else this.#acabar(tx)
      }, 0)
      return
    }
    tx.aCorrer = true
    setTimeout(() => {
      tx.aCorrer = false
      if (tx.abortada || !tx.staging) return
      try {
        op.pedido.result = op.fazer(tx.staging)
      } catch (erro) {
        op.pedido.error = erro as DOMException
        tx.error = erro as DOMException
        op.pedido.onerror?.()
        tx.abort()
        return
      }
      op.pedido.onsuccess?.()
      this.processar(tx)
    }, 0)
  }

  #acabar(tx: TxFalsa): void {
    if (tx.abortada || this.#activa !== tx) return
    const acabar = (): void => {
      if (tx.abortada) return
      if (tx.staging) for (const chave of [...this.dados.keys()]) if (!tx.staging.has(chave)) this.dados.delete(chave)
      for (const [chave, valor] of tx.staging ?? []) this.dados.set(chave, valor)
      this.putsGravados += tx.puts
      this.putsDoCofre += tx.putsDoCofre
      tx.activa = false
      this.#activa = null
      tx.oncomplete?.()
      this.#seguinte()
    }
    if (this.reter) this.#retidas.push(acabar)
    else acabar()
  }

  abortar(tx: TxFalsa): void {
    tx.staging = null
    if (this.#activa === tx) this.#activa = null
    tx.activa = false
    setTimeout(() => {
      tx.onabort?.()
      this.#seguinte()
    }, 0)
  }
}
