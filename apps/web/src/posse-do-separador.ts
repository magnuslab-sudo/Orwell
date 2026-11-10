/**
 * One owner per browser: only one tab opens the vault, connects to the server,
 * and writes.
 *
 * Why it exists. Two tabs from the same browser opened the SAME vault in
 * IndexedDB, and both connected to the server and wrote. Each had its own
 * in-memory copy of the MLS groups, and the forgotten tab's copy grew stale.
 * On October 18, 2026 a tab with old state published epochs 44 through 55 when
 * the shared room was already at 57, and broke it for everyone. Two live copies
 * of the same MLS state don't reconcile: one has to stay quiet.
 *
 * The design, in order of preference:
 *
 * 1. **Web Locks** (`navigator.locks`). One exclusive lock per account. The tab
 *    that holds it is the owner. Others wait in the browser's queue, and when
 *    the owner closes its tab the browser hands the lock to the next one. No
 *    clock, no heartbeat: a tab that dies releases the lock instantly.
 * 2. **BroadcastChannel**, when Web Locks aren't available (old Safari, insecure
 *    context). Simple election: the owner announces itself every second, and
 *    anyone who stops hearing it runs. Tie goes to the most recent announcement.
 * 3. **Nothing.** Without either one the tab runs as before, and the user gets
 *    a warning. No third way invented with `localStorage`: a lock that
 *    sometimes fails is worse than an honest warning.
 *
 * Passing ownership to another tab ("Use this tab") is cooperative: the
 * requester tells the owner over the channel; the owner stops writing, waits
 * for the last write to hit disk, and replies "I yield". Only then the new
 * owner takes the lock (`steal`, to jump ahead of others in the queue).
 *
 * **An owner that doesn't respond no longer loses ownership on its own.** After
 * the timeout the screen asks again ("The other tab doesn't respond. Use this
 * one anyway?"), and only the second click forces it. A late "I yield" that
 * arrives in the meantime resolves normally. Forcing it no longer risks the
 * vault: the lock decides who COMMANDS, and the ownership record in IndexedDB
 * itself (`vault-backend.ts`, fencing) decides who WRITES. The old owner, if
 * it wakes up, finds another's record and each write aborts inside the
 * transaction.
 *
 * This module knows nothing of the vault or the session. It receives
 * `pararDeEscrever` and calls it before letting go. That's what makes it
 * testable with a fake lock.
 */

/** The part of `LockManager` that is used. The test fake implements only this. */
export interface TrincosMin {
  request(
    nome: string,
    opcoes: { mode?: "exclusive"; ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal },
    trabalho: (trinco: unknown) => Promise<unknown> | unknown,
  ): Promise<unknown>
}

/** The part of `BroadcastChannel` that is used. */
export interface CanalMin {
  postMessage(mensagem: unknown): void
  addEventListener(tipo: "message", ouvinte: (evento: { data: unknown }) => void): void
  close(): void
}

export type EstadoDaPosse =
  /** Still asking. Lasts less than half a second. */
  | { t: "a-decidir" }
  /** This tab is in control. `via` says what protection is behind it. */
  | { t: "dono"; via: "trinco" | "difusao" | "nenhuma" }
  /**
   * Another tab is in control. `aPedir` when the user clicked "Use this tab"
   * and is waiting for the "yield". `semResposta` when the timeout passed
   * with no reply: the screen asks whether to force the takeover.
   */
  | { t: "espera"; aPedir: boolean; semResposta: boolean }
  /** This tab was the owner and is no longer. It already stopped writing; the user will reload. */
  | { t: "cedido" }
  /** Exited for good (old version). Does not rejoin the queue. */
  | { t: "largado" }

/**
 * How to stop.
 *
 * `gravar: true` is the polite stop: the owner is still the owner, saves what
 * it has and only then seals. `gravar: false` is for one that already lost the
 * lock: the other tab might be reading the vault right now, and saving now
 * would overwrite it. Seal first, and whatever was pending to save is lost
 * on this side (the server has the frames, and the new owner will fetch them).
 */
export interface ModoDeParar {
  gravar: boolean
}

export interface Posse {
  /** The identifier of this tab. It is the name that goes in the vault's ownership token. */
  readonly id: string
  readonly estado: EstadoDaPosse
  aoMudar(ouvinte: (estado: EstadoDaPosse) => void): () => void
  /**
   * "Use this tab": asks the owner to release and takes over.
   * With `forcar`, after the timeout passes with no reply, forces the lock.
   */
  pedir(opcoes?: { forcar?: boolean }): void
  /** Exit for good: stops writing if the owner, releases the lock and does not rejoin the queue. */
  largar(): Promise<void>
  /** The page is going away. Only broadcast-based election needs to know. */
  fechar(): void
  /** The page became visible again. Broadcast confirms it is still the owner. */
  ficouVisivel(): void
}

export interface OpcoesDaPosse {
  /** The lock name. One per vault: the vault cannot have two owners. */
  nome: string
  /** `navigator.locks`, or nothing. */
  trincos?: TrincosMin | undefined
  /** Creates the channel between tabs, or nothing. */
  criarCanal?: ((nome: string) => CanalMin) | undefined
  /** The owner stops writing. Ownership is only released after this completes. */
  pararDeEscrever: (modo: ModoDeParar) => Promise<void>
  /** How long to wait for the "yield" before asking whether to force the takeover. */
  prazoParaCeder?: number
  /** For tests. In a browser it is random. */
  id?: string
}

/** How long the owner waits for being removed from the lock after saying "yield". */
const PRAZO_PARA_SER_TIRADO_MS = 5_000
/** Broadcast: how often the owner announces itself. */
export const BATIMENTO_MS = 1_000
/** Broadcast: silence after which the owner is assumed dead. */
export const SILENCIO_MS = 3_500
/** Broadcast: how long to wait for a reply to a "who is the owner?" question. */
export const JANELA_MS = 300

type Mensagem =
  | { t: "quem"; de: string }
  | { t: "dono"; de: string; desde: number }
  | { t: "ceder"; de: string }
  | { t: "cedi"; de: string; para: string }
  | { t: "larguei"; de: string }

function ehMensagem(valor: unknown): valor is Mensagem {
  return typeof valor === "object" && valor !== null && typeof (valor as { t?: unknown }).t === "string"
}

function ehAborto(erro: unknown): boolean {
  return typeof erro === "object" && erro !== null && (erro as { name?: unknown }).name === "AbortError"
}

const ESPERA: EstadoDaPosse = { t: "espera", aPedir: false, semResposta: false }

export function criarPosse(opcoes: OpcoesDaPosse): Posse {
  const id = opcoes.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const prazo = opcoes.prazoParaCeder ?? 3_000
  let estado: EstadoDaPosse = { t: "a-decidir" }
  const ouvintes = new Set<(estado: EstadoDaPosse) => void>()

  const mudar = (novo: EstadoDaPosse): void => {
    estado = novo
    for (const ouvinte of ouvintes) ouvinte(novo)
  }

  /*
    Stop writing runs exactly once, no matter where the request comes from. A
    yield request and a new version can arrive together, and two stops running in
    parallel would give two "yielded" responses. Whoever arrives first decides the mode.
  */
  let paragem: Promise<void> | null = null
  const parar = (modo: ModoDeParar): Promise<void> => {
    paragem ??= opcoes.pararDeEscrever(modo).catch(() => {})
    return paragem
  }

  const canal = opcoes.criarCanal ? abrirCanal(opcoes.criarCanal, opcoes.nome) : null
  const enviar = (mensagem: Mensagem): void => {
    try {
      canal?.postMessage(mensagem)
    } catch {
      // Channel already closed: the page is leaving.
    }
  }

  // The `get` must be born in the literal: spreading an object with a getter copied
  // the value at that moment, and the state stayed stuck in "deciding" forever.
  const montar = (metodos: Omit<Posse, "id" | "estado" | "aoMudar">): Posse => ({
    id,
    get estado() {
      return estado
    },
    aoMudar(ouvinte: (estado: EstadoDaPosse) => void) {
      ouvintes.add(ouvinte)
      return () => void ouvintes.delete(ouvinte)
    },
    ...metodos,
  })

  if (opcoes.trincos) return montar(comTrinco(opcoes.trincos))
  if (canal) return montar(comDifusao(canal))

  // No protection at all: the behavior from before, and whoever uses this knows the risks.
  queueMicrotask(() => mudar({ t: "dono", via: "nenhuma" }))
  return montar({
    pedir() {},
    async largar() {
      await parar({ gravar: true })
      mudar({ t: "largado" })
    },
    fechar() {},
    ficouVisivel() {},
  })

  // ---------------------------------------------------------------------------
  // Web Locks
  // ---------------------------------------------------------------------------
  function comTrinco(trincos: TrincosMin): Omit<Posse, "id" | "estado" | "aoMudar"> {
    /** Release the lock you hold: resolve the promise that binds you. */
    let soltar: (() => void) | null = null
    /** Cancela o lugar na fila. */
    let fila: AbortController | null = null
    /** The ownership request in progress: the deadline timer. */
    let pedido: ReturnType<typeof setTimeout> | null = null
    /** Already said "yielding" and waits to be removed. */
    let aCeder = false
    let saiu = false

    const segurar = (): Promise<void> => {
      // Left in the meantime (old version mid-request): the granted lock is given
      // back right away, never becoming an owner.
      if (saiu) return Promise.resolve()
      if (pedido) clearTimeout(pedido)
      pedido = null
      mudar({ t: "dono", via: "trinco" })
      return new Promise<void>((resolve) => {
        soltar = resolve
      })
    }

    /** The owner lost the lock: either by yielding or by being taken. */
    const perdido = (): void => {
      soltar = null
      // No "yielding" before, the other may already be reading: seal without writing.
      void parar({ gravar: aCeder }).then(() => {
        if (estado.t !== "largado") mudar({ t: "cedido" })
      })
    }

    const entrarNaFila = (): void => {
      if (saiu) return
      fila?.abort()
      const controlo = new AbortController()
      fila = controlo
      if (estado.t !== "espera") mudar(ESPERA)
      trincos
        .request(opcoes.nome, { mode: "exclusive", signal: controlo.signal }, () => segurar())
        .then(
          () => {},
          (erro: unknown) => {
            // Aborted by us (we moved ahead or left): nothing to do.
            if (controlo.signal.aborted) return
            // Taken while owning.
            if (ehAborto(erro)) perdido()
          },
        )
    }

    const tomar = (): void => {
      if (saiu) return
      if (pedido) clearTimeout(pedido)
      pedido = null
      fila?.abort()
      fila = null
      let concedido = false
      trincos
        .request(opcoes.nome, { mode: "exclusive", steal: true }, () => {
          concedido = true
          return segurar()
        })
        .catch((erro: unknown) => {
          if (concedido && ehAborto(erro)) {
            perdido()
            return
          }
          // The request never got granted: go back to waiting and the queue.
          entrarNaFila()
          mudar(ESPERA)
        })
    }

    canal?.addEventListener("message", ({ data }) => {
      if (!ehMensagem(data) || data.de === id) return
      if (data.t === "ceder" && estado.t === "dono" && !aCeder) {
        aCeder = true
        void parar({ gravar: true }).then(() => {
          enviar({ t: "cedi", de: id, para: data.de })
          // The requester takes the lock with `steal`, and rejection comes through
          // `lost`. If they died in the meantime, it releases anyway.
          setTimeout(() => {
            if (!soltar) return
            const largar = soltar
            soltar = null
            largar()
            if (estado.t === "dono") mudar({ t: "cedido" })
          }, PRAZO_PARA_SER_TIRADO_MS)
        })
        return
      }
      if (data.t === "cedi" && estado.t === "espera" && (estado.aPedir || estado.semResposta)) {
        if (data.para === id) tomar()
        else {
          // Yielded to another tab that requested at the same time. This one stays in the queue.
          if (pedido) clearTimeout(pedido)
          pedido = null
          mudar(ESPERA)
        }
      }
    })

    // The start: try without waiting. If nothing, join the queue.
    trincos
      .request(opcoes.nome, { mode: "exclusive", ifAvailable: true }, (trinco) => {
        if (trinco === null) {
          entrarNaFila()
          return undefined
        }
        return segurar()
      })
      .catch((erro: unknown) => {
        if (ehAborto(erro)) perdido()
      })

    return {
      pedir(opcoesDoPedido) {
        if (estado.t !== "espera" || saiu) return
        if (estado.semResposta && opcoesDoPedido?.forcar) {
          // The second click: the user knows the other is not responding.
          tomar()
          return
        }
        if (estado.aPedir) return
        if (!canal) {
          // No channel means no polite way to request, so there is no "yielding" to wait
          // for: ask right away if we take it by force.
          mudar({ t: "espera", aPedir: false, semResposta: true })
          return
        }
        mudar({ t: "espera", aPedir: true, semResposta: false })
        enviar({ t: "ceder", de: id })
        pedido = setTimeout(() => {
          pedido = null
          if (estado.t === "espera") mudar({ t: "espera", aPedir: false, semResposta: true })
        }, prazo)
      },
      async largar() {
        saiu = true
        fila?.abort()
        fila = null
        if (pedido) clearTimeout(pedido)
        if (estado.t === "dono") await parar({ gravar: true })
        const largar = soltar
        soltar = null
        largar?.()
        mudar({ t: "largado" })
      },
      fechar() {
        // The browser releases the lock on its own when the page dies.
      },
      ficouVisivel() {
        // The lock is not lost by the page being hidden.
      },
    }
  }

  // ---------------------------------------------------------------------------
  // BroadcastChannel, without Web Locks
  // ---------------------------------------------------------------------------
  function comDifusao(canal: CanalMin): Omit<Posse, "id" | "estado" | "aoMudar"> {
    let desde = 0
    let batimento: ReturnType<typeof setInterval> | null = null
    let vigia: ReturnType<typeof setInterval> | null = null
    let pedido: ReturnType<typeof setTimeout> | null = null
    /** When the owner was last heard from. The watchdog measures this silence. */
    let ouvidoEm = 0
    /** The largest `since` we have seen, so our next announcement is more recent. */
    let maiorDesde = 0
    /** When our own heartbeat last ran. */
    let ultimoBatimento = 0
    /** Announced and waits for a heartbeat without dispute before becoming owner. */
    let aConfirmar = false
    let aCandidatar = false
    let saiu = false

    /** The most recent announcement wins, ties broken by larger ID. */
    const ganhaAoMeu = (outroDesde: number, outroId: string): boolean =>
      outroDesde > desde || (outroDesde === desde && outroId > id)

    const pararDeBater = (): void => {
      if (batimento) clearInterval(batimento)
      batimento = null
    }

    const souOuQueroSerDono = (): boolean => estado.t === "dono" || aConfirmar

    const assumir = (): void => {
      if (saiu) return
      if (pedido) clearTimeout(pedido)
      pedido = null
      aCandidatar = false
      // Strictly increasing, so taking by force always beats the owner from before
      // even with the clock frozen (tests) or coarse.
      desde = Math.max(Date.now(), maiorDesde + 1)
      aConfirmar = true
      enviar({ t: "dono", de: id, desde })
      pararDeBater()
      ultimoBatimento = Date.now()
      batimento = setInterval(() => {
        /*
          A very late heartbeat means this page was stalled. It could have been
          frozen (and another tab took over), or just hidden: with the tab hidden
          for more than five minutes the browser runs timers minute by minute, and
          losing here would lose ownership for no reason, every five minutes.
          
          So we do not lose right away: we ask and re-announce. If another tab
          took over, its announcement is more recent and the response makes this
          one lose (`ganhaAoMeu`). Until then the vault token blocks any write
          from this one that comes after the other's.
          */
        const agora = Date.now()
        const atrasado = agora - ultimoBatimento > SILENCIO_MS
        ultimoBatimento = agora
        if (atrasado) enviar({ t: "quem", de: id })
        enviar({ t: "dono", de: id, desde })
      }, BATIMENTO_MS)
      /*
        A heartbeat without dispute before opening the vault. Two tabs that
        apply at the same instant hear each other in this window, and the
        one that loses never becomes owner, not even for a moment.
      */
      setTimeout(() => {
        if (!aConfirmar || saiu) return
        aConfirmar = false
        mudar({ t: "dono", via: "difusao" })
      }, BATIMENTO_MS)
    }

    const perder = (): void => {
      pararDeBater()
      if (aConfirmar && estado.t !== "dono") {
        // Not yet owner: wrote nothing, back to waiting.
        aConfirmar = false
        ouvidoEm = Date.now()
        mudar(ESPERA)
        return
      }
      aConfirmar = false
      // The other is already owner and may be reading: seal without writing.
      void parar({ gravar: false }).then(() => {
        if (estado.t !== "largado") mudar({ t: "cedido" })
      })
    }

    /** Ask who the owner is. If no one replies in the window, take over. */
    const candidatar = (): void => {
      if (aCandidatar || saiu) return
      aCandidatar = true
      const perguntaEm = Date.now()
      enviar({ t: "quem", de: id })
      // A bit of randomness: two tabs waiting for the same dead owner do not apply
      // in the same millisecond.
      setTimeout(
        () => {
          aCandidatar = false
          if (saiu || souOuQueroSerDono() || estado.t === "cedido") return
          if (ouvidoEm >= perguntaEm) {
            if (estado.t === "a-decidir") mudar(ESPERA)
            return
          }
          assumir()
        },
        JANELA_MS + Math.floor(Math.random() * 200),
      )
    }

    canal.addEventListener("message", ({ data }) => {
      if (!ehMensagem(data) || data.de === id || saiu) return
      switch (data.t) {
        case "quem":
          if (souOuQueroSerDono()) enviar({ t: "dono", de: id, desde })
          return
        case "dono":
          maiorDesde = Math.max(maiorDesde, data.desde)
          if (souOuQueroSerDono()) {
            if (ganhaAoMeu(data.desde, data.de)) perder()
            else enviar({ t: "dono", de: id, desde })
            return
          }
          // The time it was heard, not the announcement time: the watchdog measures silence.
          ouvidoEm = Date.now()
          if (estado.t === "a-decidir") mudar(ESPERA)
          return
        case "larguei":
          if (estado.t === "espera") {
            ouvidoEm = 0
            candidatar()
          }
          return
        case "ceder":
          if (estado.t === "dono") {
            pararDeBater()
            void parar({ gravar: true }).then(() => {
              enviar({ t: "cedi", de: id, para: data.de })
              if (estado.t !== "largado") mudar({ t: "cedido" })
            })
          }
          return
        case "cedi":
          if (estado.t !== "espera" || !(estado.aPedir || estado.semResposta)) return
          if (data.para === id) assumir()
          else {
            if (pedido) clearTimeout(pedido)
            pedido = null
            mudar(ESPERA)
          }
          return
      }
    })

    vigia = setInterval(() => {
      if (estado.t !== "espera" || estado.aPedir || estado.semResposta || aConfirmar) return
      if (Date.now() - ouvidoEm > SILENCIO_MS) candidatar()
    }, BATIMENTO_MS)

    candidatar()

    return {
      pedir(opcoesDoPedido) {
        if (estado.t !== "espera" || saiu) return
        if (estado.semResposta && opcoesDoPedido?.forcar) {
          // The second click. The announcement is more recent and wins, the vault token
          // blocks the old owner if they wake up.
          assumir()
          return
        }
        if (estado.aPedir) return
        mudar({ t: "espera", aPedir: true, semResposta: false })
        enviar({ t: "ceder", de: id })
        pedido = setTimeout(() => {
          pedido = null
          if (estado.t === "espera") mudar({ t: "espera", aPedir: false, semResposta: true })
        }, prazo)
      },
      async largar() {
        saiu = true
        if (vigia) clearInterval(vigia)
        vigia = null
        if (pedido) clearTimeout(pedido)
        const eraDono = estado.t === "dono"
        aConfirmar = false
        pararDeBater()
        if (eraDono) {
          await parar({ gravar: true })
          enviar({ t: "larguei", de: id })
        }
        mudar({ t: "largado" })
      },
      fechar() {
        if (estado.t === "dono") enviar({ t: "larguei", de: id })
        // A page that is leaving stops responding: otherwise the "who is the owner?"
        // from the one staying would still hear it, and no one would take over.
        saiu = true
        pararDeBater()
        if (vigia) clearInterval(vigia)
      },
      ficouVisivel() {
        /*
          Came back into view: announce again. If another tab took over while
          this one was frozen, its announcement is more recent and the response
          makes this one lose. The vault token blocks any write from this one
          that comes before the response.
        */
        if (estado.t === "dono") {
          enviar({ t: "quem", de: id })
          enviar({ t: "dono", de: id, desde })
        }
      },
    }
  }
}

function abrirCanal(criar: (nome: string) => CanalMin, nome: string): CanalMin | null {
  try {
    return criar(nome)
  } catch {
    return null
  }
}

/**
 * What the browser offers, read once.
 *
 * `navigator.locks` only exists in a secure context (https or localhost). On
 * `http://` over local network it does not exist, and that is where the channel
 * comes in.
 */
export function capacidadesDoBrowser(): Pick<OpcoesDaPosse, "trincos" | "criarCanal"> {
  const trincos =
    typeof navigator !== "undefined" && navigator.locks && typeof navigator.locks.request === "function"
      ? (navigator.locks as unknown as TrincosMin)
      : undefined
  const criarCanal =
    typeof BroadcastChannel === "function" ? (nome: string) => new BroadcastChannel(nome) as unknown as CanalMin : undefined
  return { trincos, criarCanal }
}
