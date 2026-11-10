import type { MemoriaDaSessao, VaultBackend } from "@enclave/client-core"
import { CONTA_PRINCIPAL, idDeContaValido } from "@enclave/client-core/contas"

/**
 * Vault storage for the browser: IndexedDB, and no OS key wrapping.
 *
 * A web page has nowhere to keep a key the user does not type. There is no
 * credential store it can reach, and anything it could stash durably,  * localStorage, IndexedDB, a cookie, is readable by any script that ends up
 * running in this origin. So the browser build requires a passphrase per tab,
 * and says so rather than inventing a protection it cannot provide. (The one
 * concession, made in bridge.ts: the derived key rides out reloads in
 * sessionStorage, which lives exactly as long as the tab does.)
 *
 * This is a real difference from the desktop app, not an oversight, and it is
 * the honest reason to prefer the desktop app for a long-lived identity.
 */

/** Exported because it names the lock between tabs: one vault, one owner. */
export const DB_NAME = "enclave"
const STORE = "vault"
const KEY = "current"

/**
 * The keys for each account in the store ("Switch account"). The primary one stays in
 * `current` and `sessao`, where it always lived: for anyone with one account, nothing
 * moves. The others go in `cofre:<id>` and `sessao:<id>`.
 */
export function chavesDaConta(conta: string): { cofre: string; sessao: string } {
  if (!idDeContaValido(conta)) throw new Error("there is no such account on this device")
  return conta === CONTA_PRINCIPAL ? { cofre: KEY, sessao: "sessao" } : { cofre: `cofre:${conta}`, sessao: `sessao:${conta}` }
}

/**
 * IndexedDB failure uses interface key 114, with the browser exception in
 * `cause` for diagnostics.
 *
 * Full quota passes through unchanged: `write` recognizes it by `DOMException`
 * and gives it its own key ("vault storage is full"), which tells the user what
 * to do.
 */
function falhaDoArmazenamento(erro: DOMException | null, passo: "open" | "request"): Error {
  if (erro instanceof DOMException && erro.name === "QuotaExceededError") return erro
  return new Error("local storage failed", { cause: { passo, nome: erro?.name, detalhe: erro?.message } })
}

/**
 * Rejection when a tab no longer owns it, or sealed the vault.
 *
 * One key for both cases (code 117): for the user it is the same thing, this
 * tab can no longer write. The reason goes in `cause`.
 */
export const RECUSA_DE_ESCRITA = "this tab no longer writes to the vault"

/**
 * The ownership record, stored in the vault's own store, alongside it.
 *
 * This is the final defense against two owners (fencing). The latch between
 * tabs decides who COMMANDS; the record decides who WRITES, and decides it
 * within the same transaction that writes. A frozen tab that wakes after its
 * latch is taken away can no longer write anything: the record has another name.
 */
export interface FichaDePosse {
  id: string
  geracao: number
  /**
   * The vault's state as the owner left it on the last write.
   *
   * It exists because of tabs running code from BEFORE this version: they know
   * no latch or record, and keep writing over it. The record does not stop them,
   * because they do not read it. But each write of theirs changes the vault, and
   * the owner sees it on the next write: the vault there is no longer what he
   * left. Then it stops, before writing over a state it does not know.
   */
  ultimo: string
}
const FICHA = "dono"
/**
 * The memorized session (F1), in the SAME vault store, under a separate key
 * (`sessao`, or `sessao:<id>` in an added account; see `chavesDaConta`).
 *
 * The plan proposed a new store, with the base bumping to version 2. It stayed
 * in the same store on purpose: raising the IndexedDB version gets blocked
 * while any tab with version 1 is open (`onversionchange`), which is the risk
 * the plan names. A new key does not change the schema. The ownership record
 * only summarizes the vault key, so memorizing does not count as writing from
 * another (`outro-escritor`).
 */

/** The memorized session record, as it sits in IndexedDB. */
interface RegistoDaSessao {
  v: 1
  via: "webcrypto"
  /** AES-GCM 256, NOT extractable: the page's JS uses it, but cannot read it. */
  chave: CryptoKey
  iv: Uint8Array
  embrulho: ArrayBuffer
}

function ehRegistoDaSessao(valor: unknown): valor is RegistoDaSessao {
  const r = valor as Partial<RegistoDaSessao> | null
  return typeof r === "object" && r !== null && r.v === 1 && r.via === "webcrypto" && r.chave !== undefined && r.iv !== undefined && r.embrulho !== undefined
}

/** The reason for rejection, for whoever shows what to do. */
export type MotivoDaPerda = "outro-dono" | "outro-escritor"

/**
 * A summary of the written vault, computed WITHOUT `await`.
 *
 * Must be synchronous: it runs inside the transaction, and an IndexedDB
 * transaction closes by itself as soon as it has no pending requests. A
 * `crypto.subtle.digest` in the middle would close it before the `put`. Does
 * not need to resist attacks: only needs to change when content changes. Two
 * passes of 32-bit FNV-1a, plus the size, are plenty and spare for that, at a
 * cost of milliseconds per MiB.
 */
export function resumoInteiroDoCofre(valor: unknown): string {
  const bytes = bytesDe(valor)
  if (!bytes) return "vazio"
  return `${bytes.length.toString(36)}-${fnv(bytes, 0, bytes.length)}`
}

/**
 * The summary the record keeps since slow-after-join (4/11/2026): file ends
 * and size, not the entire file.
 *
 * The entire summary ran twice per write over the full vault (what was there
 * and what is new), in JS on the page thread: with 11 MB and CPU 4x slower it
 * was 18 s out of 54 s in a write profile. The ends are enough for what the
 * record looks for, which is to know if SOMEONE ELSE wrote the vault: each
 * write of any version carries a random 24-byte nonce in the first two hundred
 * bytes of the file (the header and JSON start), so two files written by two
 * different writes differ there, even with identical content.
 *
 * The `p1-` prefix separates formats. A record left by the prior version stores
 * the entire summary, and is checked against the entire one (`confereResumo`):
 * whoever updates mid-session does not lose ownership over the swap.
 */
export function resumoDoCofre(valor: unknown): string {
  const bytes = bytesDe(valor)
  if (!bytes) return "vazio"
  const ponta = Math.min(PONTA_DO_RESUMO, bytes.length)
  return `p1-${bytes.length.toString(36)}-${fnv(bytes, 0, ponta)}-${fnv(bytes, bytes.length - ponta, bytes.length)}`
}

const PONTA_DO_RESUMO = 4096

/** The vault on disk still is what the record says, in the format it said. */
export function confereResumo(valor: unknown, guardado: string): boolean {
  return (guardado.startsWith("p1-") ? resumoDoCofre(valor) : resumoInteiroDoCofre(valor)) === guardado
}

function bytesDe(valor: unknown): Uint8Array | null {
  if (!(valor instanceof ArrayBuffer) && !ArrayBuffer.isView(valor)) return null
  return valor instanceof ArrayBuffer ? new Uint8Array(valor) : new Uint8Array(valor.buffer, valor.byteOffset, valor.byteLength)
}

function fnv(bytes: Uint8Array, de: number, ate: number): string {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x9e3779b9
  for (let i = de; i < ate; i++) {
    const byte = bytes[i] as number
    a = Math.imul(a ^ byte, 0x01000193)
    b = Math.imul(b ^ byte, 0x01000193) ^ (b >>> 15)
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`
}

function ehFicha(valor: unknown): valor is FichaDePosse {
  return typeof valor === "object" && valor !== null && typeof (valor as FichaDePosse).id === "string"
}

export interface OpcoesDoCofre {
  /**
   * Called once, when a write is rejected: the record belongs to another tab
   * (`outro-dono`), or someone without a record wrote the vault underneath
   * (`outro-escritor`: a tab running prior code).
   */
  aoPerderPosse?: (motivo: MotivoDaPerda) => void
  /** This device's active account ("Switch account"). Absent: the main one. */
  conta?: string
}

export class BrowserVaultBackend implements VaultBackend {
  readonly supportsOsProtection = false

  /**
   * The memorized session of this browser. See `chavesDaConta` and
   * `MemoriaDaSessao`.
   *
   * Said honestly (and in `THREAT-MODEL.md`): the key that wraps it does not
   * leave the browser, but JS of this origin uses it, and whoever copies the
   * entire browser profile opens the account. It is the protection class of the
   * Discord token on the web.
   */
  readonly memoria: MemoriaDaSessao = {
    via: "webcrypto",
    disponivel: async () =>
      typeof indexedDB !== "undefined" && typeof crypto !== "undefined" && typeof crypto.subtle?.encrypt === "function",
    existe: async () => ehRegistoDaSessao(await this.#lerChave(this.#chaveDaSessao())),
    guardar: async (chave) => {
      // The cipher BEFORE the transaction: an IndexedDB transaction closes by
      // itself as soon as it has no pending requests, and an `await` in the middle
      // would close it.
      const embrulhadora = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const embrulho = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, embrulhadora, new Uint8Array(chave))
      const registo: RegistoDaSessao = { v: 1, via: "webcrypto", chave: embrulhadora, iv, embrulho }
      const nome = this.#chaveDaSessao()
      await this.#emTransacao<void>("readwrite", (store) => {
        store.put(registo, nome)
        return () => undefined
      })
    },
    ler: async () => {
      const registo = await this.#lerChave(this.#chaveDaSessao())
      if (!ehRegistoDaSessao(registo)) return null
      try {
        const iv = new Uint8Array(registo.iv)
        return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, registo.chave, registo.embrulho))
      } catch {
        return null
      }
    },
    apagar: async () => {
      const nome = this.#chaveDaSessao()
      await this.#emTransacao<void>("readwrite", (store) => {
        store.delete(nome)
        return () => undefined
      })
    },
  }

  #chaveDaSessao(): string {
    return chavesDaConta(this.#conta).sessao
  }

  /** The vault key of this tab's account, read at the moment of each request. */
  #chaveDoCofre(): string {
    return chavesDaConta(this.#conta).cofre
  }

  /** What an account has in this browser, without opening anything. */
  async estadoDaConta(conta: string): Promise<{ temCofre: boolean; memorizada: boolean }> {
    const chaves = chavesDaConta(conta)
    return this.#emTransacao("readonly", (store) => {
      const cofre = store.get(chaves.cofre)
      const sessao = store.get(chaves.sessao)
      return () => ({ temCofre: cofre.result !== undefined, memorizada: ehRegistoDaSessao(sessao.result) })
    })
  }

  async #lerChave(nome: string): Promise<unknown> {
    return this.#emTransacao<unknown>("readonly", (store) => {
      const pedido = store.get(nome)
      return () => pedido.result as unknown
    })
  }

  /*
    The IndexedDB connection, opened ONCE and stored.

    Opening a connection per write had two costs. The first is the obvious one.
    The second is what matters: with the connection already open, the
    transaction is created the instant `write` is called. That is what lets the
    `pagehide` write exist before the page dies; with an async `open()` in the
    middle, it might not even create the transaction.
  */
  #db: IDBDatabase | null = null
  #aAbrir: Promise<IDBDatabase> | null = null

  /*
    The seal: from this point on this tab does not write to the vault anymore.

    It exists because of `posse-do-separador.ts`. When another tab becomes the
    owner, or when this one has an old version, the last write of this one must
    reach disk BEFORE the other reads, and no write can arrive AFTER. Locking
    the vault in memory was not enough: the core encrypts synchronously and the
    IndexedDB write continues on its own, already without the key. The right
    place for the barrier is here, where the write happens.
  */
  #selado = false
  readonly #emCurso = new Set<Promise<unknown>>()

  /** The id with which this tab claimed the record. `null`: no ownership (no protection). */
  #minhaFicha: string | null = null
  #perdida = false
  readonly #aoPerderPosse: ((motivo: MotivoDaPerda) => void) | undefined

  /** This tab's account. Fixed: switching accounts reloads the page. */
  readonly #conta: string

  constructor(opcoes: OpcoesDoCofre = {}) {
    this.#aoPerderPosse = opcoes.aoPerderPosse
    this.#conta = opcoes.conta ?? CONTA_PRINCIPAL
    chavesDaConta(this.#conta)
  }

  /** Reject all writes from now on. Those already in flight continue. */
  selar(): void {
    this.#selado = true
  }

  /** Wait for writes already started to finish, good or bad. */
  async escritasAcabadas(): Promise<void> {
    while (this.#emCurso.size > 0) await Promise.allSettled([...this.#emCurso])
  }

  /**
   * Claim the ownership record: from now on only this tab writes.
   *
   * Called by `main.tsx` when this tab becomes owner, BEFORE the gate reads the
   * vault. The order closes the race: a write from the old owner that arrives
   * before the record stays on disk before our read; one that arrives after is
   * rejected by the record.
   */
  async assumirPosse(id: string): Promise<FichaDePosse> {
    const chaveDoCofre = this.#chaveDoCofre()
    const ficha = await this.#emTransacao<FichaDePosse>("readwrite", (store) => {
      let nova: FichaDePosse = { id, geracao: 1, ultimo: "vazio" }
      const pedido = store.get(FICHA)
      const cofre = store.get(chaveDoCofre)
      // The two requests run in order; the summary is read on the second.
      cofre.onsuccess = () => {
        const anterior = pedido.result as unknown
        nova = { id, geracao: (ehFicha(anterior) ? anterior.geracao : 0) + 1, ultimo: resumoDoCofre(cofre.result) }
        store.put(nova, FICHA)
      }
      return () => nova
    })
    this.#minhaFicha = id
    this.#perdida = false
    return ficha
  }

  async read(): Promise<Uint8Array | null> {
    const chaveDoCofre = this.#chaveDoCofre()
    const stored = await this.#emTransacao<ArrayBuffer | undefined>("readonly", (store) => {
      const pedido = store.get(chaveDoCofre)
      return () => pedido.result as ArrayBuffer | undefined
    })
    return stored ? new Uint8Array(stored) : null
  }

  write(bytes: Uint8Array): Promise<void> {
    if (this.#selado) return Promise.reject(new Error(RECUSA_DE_ESCRITA, { cause: { porque: "selado" } }))
    // Store a copy detached from any larger buffer, so IndexedDB does not retain
    // more of memory than the record itself.
    const copy = new Uint8Array(bytes.length)
    copy.set(bytes)
    return this.#seguir(
      this.#escreverComFicha(copy.buffer).catch((error: unknown) => {
        /**
         * Name the one failure that is not a fault.
         *
         * A full origin quota — reachable on an account carrying real photos,
         * since the vault is rewritten whole on every change — used to surface
         * as an anonymous DOM exception nobody classified. What the person saw
         * was messages that did not survive a reload, a catch-up replaying the
         * same events, and eventually "this device lost access": a story about
         * broken encryption, when the truth was a disk with no room on it.
         */
        if (error instanceof DOMException && error.name === "QuotaExceededError") {
          throw new Error("vault storage is full")
        }
        throw error
      }),
    )
  }

  async clear(): Promise<void> {
    if (this.#selado) throw new Error(RECUSA_DE_ESCRITA, { cause: { porque: "selado" } })
    await this.#seguir(this.#escreverComFicha(null))
  }

  /**
   * A write that first checks the record, in the SAME transaction.
   *
   * Without a claimed record (browser without protection between tabs) writes at
   * once, as before. With a record, it reads `dono` and the current vault, and
   * only writes if:
   * - the record is ours (otherwise another tab claimed it: `outro-dono`);
   * - the vault is what we left (otherwise someone without a record wrote over:
   *   `outro-escritor`, a tab running code from before this version).
   * Rejected, the transaction aborts entirely and nothing reaches disk. Accepted,
   * it writes the vault and the new summary to the record, together.
   *
   * `novo` is the vault to write, or `null` to delete it.
   */
  #escreverComFicha(novo: ArrayBuffer | null): Promise<void> {
    const minha = this.#minhaFicha
    // Read the key now, not inside the `onsuccess`: a write belongs to the
    // account as it was when requested.
    const chaveDoCofre = this.#chaveDoCofre()
    const gravar = (store: IDBObjectStore): void => {
      if (novo === null) store.delete(chaveDoCofre)
      else store.put(novo, chaveDoCofre)
    }
    return this.#emTransacao<void>("readwrite", (store, recusar) => {
      if (minha === null) {
        gravar(store)
        return () => undefined
      }
      const pedidoDaFicha = store.get(FICHA)
      const pedidoDoCofre = store.get(chaveDoCofre)
      pedidoDoCofre.onsuccess = () => {
        const ficha = pedidoDaFicha.result as unknown
        if (!ehFicha(ficha) || ficha.id !== minha) {
          recusar(new Error(RECUSA_DE_ESCRITA, { cause: { porque: "outro-dono", dono: ehFicha(ficha) ? ficha.id : null } }))
          this.#perdeuPosse("outro-dono")
          return
        }
        if (!confereResumo(pedidoDoCofre.result, ficha.ultimo)) {
          recusar(new Error(RECUSA_DE_ESCRITA, { cause: { porque: "outro-escritor" } }))
          this.#perdeuPosse("outro-escritor")
          return
        }
        gravar(store)
        store.put({ ...ficha, ultimo: resumoDoCofre(novo) }, FICHA)
      }
      return () => undefined
    })
  }

  #perdeuPosse(motivo: MotivoDaPerda): void {
    if (this.#perdida) return
    this.#perdida = true
    this.#selado = true
    this.#aoPerderPosse?.(motivo)
  }

  #seguir<T>(trabalho: Promise<T>): Promise<T> {
    this.#emCurso.add(trabalho)
    const largar = (): void => void this.#emCurso.delete(trabalho)
    trabalho.then(largar, largar)
    return trabalho
  }

  #ligacao(): Promise<IDBDatabase> {
    if (this.#db) return Promise.resolve(this.#db)
    this.#aAbrir ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
      }
      request.onsuccess = () => {
        const db = request.result
        // Another tab changing the schema, or the browser closing the base:
        // drop the connection and the next write opens another.
        db.onversionchange = () => {
          db.close()
          this.#esquecerLigacao(db)
        }
        db.onclose = () => this.#esquecerLigacao(db)
        this.#db = db
        this.#aAbrir = null
        resolve(db)
      }
      request.onerror = () => {
        this.#aAbrir = null
        reject(falhaDoArmazenamento(request.error, "open"))
      }
    })
    return this.#aAbrir
  }

  #esquecerLigacao(db: IDBDatabase): void {
    if (this.#db === db) this.#db = null
  }

  /**
   * A transaction that only resolves when the browser says it ENDED.
   *
   * Before it resolved on the request's `onsuccess`. That says the request ran,
   * not that the transaction was written: it could still abort (quota, disk) and
   * the write was marked done. `escritasAcabadas`, which authorizes dropping the
   * latch, was waiting for the wrong thing.
   *
   * `trabalho` makes the requests and returns how to read the result at the end.
   * `recusar` aborts the transaction with an error of ours.
   */
  #emTransacao<T>(
    modo: IDBTransactionMode,
    trabalho: (store: IDBObjectStore, recusar: (erro: Error) => void) => () => T,
  ): Promise<T> {
    const correr = (db: IDBDatabase): Promise<T> => {
      // Outside the executor on purpose: a closed connection throws here, and
      // `tentar` needs to see it to open another.
      const tx = db.transaction(STORE, modo)
      return new Promise<T>((resolve, reject) => {
        let recusa: Error | null = null
        const recusar = (erro: Error): void => {
          recusa = erro
          try {
            tx.abort()
          } catch {
            // It had already ended or aborted.
          }
        }
        let ler: () => T
        try {
          ler = trabalho(tx.objectStore(STORE), recusar)
        } catch (erro) {
          recusar(erro as Error)
          reject(erro)
          return
        }
        tx.oncomplete = () => resolve(ler())
        tx.onabort = () => reject(recusa ?? falhaDoArmazenamento(tx.error, "request"))
      })
    }

    const tentar = (db: IDBDatabase): Promise<T> => {
      try {
        return correr(db)
      } catch {
        // The stored connection closed in the meantime (`InvalidStateError`): open
        // another, once.
        this.#esquecerLigacao(db)
        return this.#ligacao().then(correr)
      }
    }

    // With the connection open, the transaction is born right now, within this call.
    if (this.#db) return tentar(this.#db)
    return this.#ligacao().then(tentar)
  }
}
