import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  BATIMENTO_MS,
  JANELA_MS,
  SILENCIO_MS,
  criarPosse,
  type CanalMin,
  type EstadoDaPosse,
  type OpcoesDaPosse,
  type Posse,
  type TrincosMin,
} from "./posse-do-separador.js"

/**
 * One owner per browser, proven with a fake lock and a fake channel.
 *
 * The fakes mimic the part of the browser contract that ownership depends on: the
 * Web Locks queue (the requester waits its turn; `ifAvailable` answers right away
 * with `null`; `steal` takes the lock from whoever has it, and their promise rejects
 * with `AbortError`) and the BroadcastChannel delivery (async, to everyone but the
 * sender). The script `scripts/e2e-separadores.mjs` proves the same on all three
 * real engines.
 */

function abortError(): Error {
  const erro = new Error("aborted")
  erro.name = "AbortError"
  return erro
}

interface Entrada {
  trabalho: (trinco: unknown) => Promise<unknown> | unknown
  resolver: (valor: unknown) => void
  rejeitar: (erro: unknown) => void
  sinal?: AbortSignal | undefined
}

class TrincosFalsos implements TrincosMin {
  dono: Entrada | null = null
  fila: Entrada[] = []

  /** How many `steal` calls fail before they get granted (a browser that refuses). */
  falharRoubos = 0

  request(
    _nome: string,
    opcoes: { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal },
    trabalho: (trinco: unknown) => Promise<unknown> | unknown,
  ): Promise<unknown> {
    if (opcoes.steal && this.falharRoubos > 0) {
      this.falharRoubos -= 1
      return Promise.reject(new TypeError("steal recusado"))
    }
    return new Promise((resolver, rejeitar) => {
      const entrada: Entrada = { trabalho, resolver, rejeitar, sinal: opcoes.signal }
      if (opcoes.steal) {
        const antigo = this.dono
        this.dono = null
        antigo?.rejeitar(abortError())
        this.#conceder(entrada)
        return
      }
      if (this.dono || this.fila.length > 0) {
        if (opcoes.ifAvailable) {
          Promise.resolve(trabalho(null)).then(resolver, rejeitar)
          return
        }
        this.fila.push(entrada)
        opcoes.signal?.addEventListener("abort", () => {
          const i = this.fila.indexOf(entrada)
          if (i >= 0) {
            this.fila.splice(i, 1)
            rejeitar(abortError())
          }
        })
        return
      }
      this.#conceder(entrada)
    })
  }

  #conceder(entrada: Entrada): void {
    this.dono = entrada
    Promise.resolve()
      .then(() => entrada.trabalho({ name: "trinco" }))
      .then(
        (valor) => {
          if (this.dono !== entrada) return
          this.dono = null
          entrada.resolver(valor)
          this.#seguinte()
        },
        (erro) => {
          if (this.dono !== entrada) return
          this.dono = null
          entrada.rejeitar(erro)
          this.#seguinte()
        },
      )
  }

  #seguinte(): void {
    const proxima = this.fila.shift()
    if (proxima) this.#conceder(proxima)
  }

  /** The tab that holds the lock closes: the browser releases it without asking. */
  fecharDono(): void {
    const antigo = this.dono
    this.dono = null
    // The promise of a dead tab does not matter to anyone.
    void antigo
    this.#seguinte()
  }
}

/** A BroadcastChannel bus: async delivery, never to the sender. */
class Barramento {
  canais = new Set<CanalFalso>()
  criar = (): CanalMin => {
    const canal = new CanalFalso(this)
    this.canais.add(canal)
    return canal
  }
}

class CanalFalso implements CanalMin {
  ouvintes: ((evento: { data: unknown }) => void)[] = []
  fechado = false
  constructor(private readonly barramento: Barramento) {}
  postMessage(mensagem: unknown): void {
    // A closed channel (frozen or dead tab) reaches no one.
    if (this.fechado) return
    for (const outro of this.barramento.canais) {
      if (outro === this || outro.fechado) continue
      setTimeout(() => {
        if (!outro.fechado) for (const ouvinte of outro.ouvintes) ouvinte({ data: structuredClone(mensagem) })
      }, 0)
    }
  }
  addEventListener(_tipo: "message", ouvinte: (evento: { data: unknown }) => void): void {
    this.ouvintes.push(ouvinte)
  }
  close(): void {
    this.fechado = true
  }
}

interface Separador {
  posse: Posse
  estados: EstadoDaPosse["t"][]
  paragens: number
  modos: boolean[]
  escritas: string[]
}

function abrir(id: string, opcoes: Partial<OpcoesDaPosse>, demoraDaParagem = 50): Separador {
  const separador: Separador = { posse: null as unknown as Posse, estados: [], paragens: 0, modos: [], escritas: [] }
  separador.posse = criarPosse({
    nome: "orwell:conta:enclave",
    id,
    pararDeEscrever: async ({ gravar }) => {
      separador.paragens += 1
      separador.modos.push(gravar)
      // The last write takes time to reach the disk.
      await new Promise((resolve) => setTimeout(resolve, demoraDaParagem))
      separador.escritas.push(gravar ? "ultima" : "selado-sem-gravar")
    },
    ...opcoes,
  })
  separador.posse.aoMudar((estado) => separador.estados.push(estado.t))
  return separador
}

const passar = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
}

/** In the broadcast, taking over brings the question window, randomness, and an unchallenged heartbeat. */
const ASSUMIR_POR_DIFUSAO = JANELA_MS + 200 + BATIMENTO_MS + 50

const ESPERA = { t: "espera", aPedir: false, semResposta: false }

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("com Web Locks", () => {
  it("o primeiro separador é dono, o segundo fica à espera", async () => {
    const trincos = new TrincosFalsos()
    const barramento = new Barramento()
    const a = abrir("a", { trincos, criarCanal: barramento.criar })
    await passar(0)
    const b = abrir("b", { trincos, criarCanal: barramento.criar })
    await passar(0)
    expect(a.posse.estado).toEqual({ t: "dono", via: "trinco" })
    expect(b.posse.estado).toEqual(ESPERA)
    // While waiting there is nothing to stop: it never wrote.
    expect(b.paragens).toBe(0)
    expect(a.posse.id).toBe("a")
  })

  it("quando o dono fecha, o seguinte assume sozinho", async () => {
    const trincos = new TrincosFalsos()
    abrir("a", { trincos })
    await passar(0)
    const b = abrir("b", { trincos })
    const c = abrir("c", { trincos })
    await passar(0)
    trincos.fecharDono()
    await passar(0)
    expect(b.posse.estado.t).toBe("dono")
    // The queue is first come, first served: the third one keeps waiting.
    expect(c.posse.estado.t).toBe("espera")
  })

  it('"Usar este separador": o dono GRAVA e pára ANTES de largar, e quem pediu assume', async () => {
    const trincos = new TrincosFalsos()
    const barramento = new Barramento()
    const a = abrir("a", { trincos, criarCanal: barramento.criar })
    await passar(0)
    const b = abrir("b", { trincos, criarCanal: barramento.criar })
    await passar(0)

    b.posse.pedir()
    expect(b.posse.estado).toEqual({ t: "espera", aPedir: true, semResposta: false })
    await passar(10)
    // The owner is stopping, and has not released yet: the requester keeps waiting.
    expect(a.paragens).toBe(1)
    expect(b.posse.estado.t).toBe("espera")
    expect(trincos.dono).not.toBeNull()

    await passar(60)
    expect(a.escritas).toEqual(["ultima"])
    expect(a.modos).toEqual([true])
    expect(b.posse.estado.t).toBe("dono")
    expect(a.posse.estado.t).toBe("cedido")
    // One stop only, even if the lock rejection arrives after the "yield".
    expect(a.paragens).toBe(1)
  })

  it("passa à frente de quem já estava na fila", async () => {
    const trincos = new TrincosFalsos()
    const barramento = new Barramento()
    abrir("a", { trincos, criarCanal: barramento.criar })
    await passar(0)
    const b = abrir("b", { trincos, criarCanal: barramento.criar })
    const c = abrir("c", { trincos, criarCanal: barramento.criar })
    await passar(0)
    c.posse.pedir()
    await passar(100)
    expect(c.posse.estado.t).toBe("dono")
    expect(b.posse.estado.t).toBe("espera")
  })

  it("um dono que não responde NÃO perde a posse sozinho: o prazo só faz perguntar outra vez", async () => {
    const trincos = new TrincosFalsos()
    const barramento = new Barramento()
    const a = abrir("a", { trincos, criarCanal: barramento.criar, prazoParaCeder: 3_000 })
    await passar(0)
    // Separator A freezes: its channel stops delivering and receiving.
    const [canalDeA] = barramento.canais
    ;(canalDeA as CanalFalso).fechado = true
    const b = abrir("b", { trincos, criarCanal: barramento.criar, prazoParaCeder: 3_000 })
    await passar(0)
    b.posse.pedir()
    await passar(3_000)
    expect(b.posse.estado).toEqual({ t: "espera", aPedir: false, semResposta: true })
    await passar(30_000)
    // Nobody took anything without the person saying so.
    expect(a.posse.estado.t).toBe("dono")
    expect(b.posse.estado.t).toBe("espera")

    // O segundo clique.
    b.posse.pedir({ forcar: true })
    await passar(0)
    expect(b.posse.estado.t).toBe("dono")
    // A resumes and discovers the lock rejection, then stops WITHOUT saving.
    await passar(60)
    expect(a.modos).toEqual([false])
    expect(a.escritas).toEqual(["selado-sem-gravar"])
    expect(a.posse.estado.t).toBe("cedido")
  })

  it('um "cedi" atrasado depois do prazo resolve pelo caminho normal, com gravação', async () => {
    const trincos = new TrincosFalsos()
    const barramento = new Barramento()
    // The owner takes 5 s to save (a large vault on a slow phone).
    const a = abrir("a", { trincos, criarCanal: barramento.criar, prazoParaCeder: 3_000 }, 5_000)
    await passar(0)
    const b = abrir("b", { trincos, criarCanal: barramento.criar, prazoParaCeder: 3_000 })
    await passar(0)
    b.posse.pedir()
    await passar(3_000)
    expect(b.posse.estado).toEqual({ t: "espera", aPedir: false, semResposta: true })
    await passar(2_100)
    expect(a.modos).toEqual([true])
    expect(a.escritas).toEqual(["ultima"])
    expect(b.posse.estado.t).toBe("dono")
    expect(a.posse.estado.t).toBe("cedido")
  })

  it("sem canal, pedir pergunta logo, e só o segundo clique toma", async () => {
    const trincos = new TrincosFalsos()
    const a = abrir("a", { trincos })
    await passar(0)
    const b = abrir("b", { trincos })
    await passar(0)
    b.posse.pedir()
    expect(b.posse.estado).toEqual({ t: "espera", aPedir: false, semResposta: true })
    expect(a.posse.estado.t).toBe("dono")
    b.posse.pedir({ forcar: true })
    await passar(60)
    expect(b.posse.estado.t).toBe("dono")
    expect(a.modos).toEqual([false])
  })

  it("um roubo que o browser recusa volta à espera e à fila", async () => {
    const trincos = new TrincosFalsos()
    const a = abrir("a", { trincos })
    await passar(0)
    const b = abrir("b", { trincos })
    await passar(0)
    b.posse.pedir()
    trincos.falharRoubos = 1
    b.posse.pedir({ forcar: true })
    await passar(0)
    expect(b.posse.estado).toEqual(ESPERA)
    expect(a.posse.estado.t).toBe("dono")
    // Back in the queue: when A closes, B takes over.
    trincos.fecharDono()
    await passar(0)
    expect(b.posse.estado.t).toBe("dono")
  })

  it("largar (versão velha) pára de escrever, solta, e não volta à fila", async () => {
    const trincos = new TrincosFalsos()
    const a = abrir("a", { trincos })
    await passar(0)
    const b = abrir("b", { trincos })
    await passar(0)
    const largado = a.posse.largar()
    await passar(60)
    await largado
    expect(a.paragens).toBe(1)
    expect(a.modos).toEqual([true])
    expect(a.posse.estado.t).toBe("largado")
    await passar(0)
    expect(b.posse.estado.t).toBe("dono")
    // B closes: A does not take over, because it exited for good.
    trincos.fecharDono()
    await passar(0)
    expect(a.posse.estado.t).toBe("largado")
  })

  it("um separador à espera que larga sai da fila", async () => {
    const trincos = new TrincosFalsos()
    abrir("a", { trincos })
    await passar(0)
    const b = abrir("b", { trincos })
    await passar(0)
    await b.posse.largar()
    expect(trincos.fila).toHaveLength(0)
    expect(b.paragens).toBe(0)
  })

  it("um trinco concedido depois de sair devolve-se logo, sem passar a dono", async () => {
    const trincos = new TrincosFalsos()
    abrir("a", { trincos })
    await passar(0)
    const b = abrir("b", { trincos })
    await passar(0)
    // Exit in the middle of a takeover: the request leaves, and `release` arrives before the grant.
    b.posse.pedir()
    b.posse.pedir({ forcar: true })
    const largado = b.posse.largar()
    await passar(0)
    await largado
    expect(b.estados).not.toContain("dono")
    expect(trincos.dono).toBeNull()
  })
})

describe("sem Web Locks, com BroadcastChannel", () => {
  it("o primeiro assume depois da janela e de um batimento sem contestação; o segundo ouve-o e espera", async () => {
    const barramento = new Barramento()
    const a = abrir("a", { criarCanal: barramento.criar })
    expect(a.posse.estado.t).toBe("a-decidir")
    await passar(JANELA_MS + 200)
    // Already announced, but has not opened the vault yet.
    expect(a.posse.estado.t).toBe("a-decidir")
    await passar(BATIMENTO_MS + 50)
    expect(a.posse.estado).toEqual({ t: "dono", via: "difusao" })
    const b = abrir("b", { criarCanal: barramento.criar })
    await passar(ASSUMIR_POR_DIFUSAO)
    expect(b.posse.estado.t).toBe("espera")
  })

  it("o dono fecha a página: o outro assume logo", async () => {
    const barramento = new Barramento()
    const a = abrir("a", { criarCanal: barramento.criar })
    await passar(ASSUMIR_POR_DIFUSAO)
    const b = abrir("b", { criarCanal: barramento.criar })
    await passar(ASSUMIR_POR_DIFUSAO)
    a.posse.fechar()
    await passar(ASSUMIR_POR_DIFUSAO)
    expect(b.posse.estado.t).toBe("dono")
  })

  it("o dono morre sem avisar: o silêncio passa a posse a outro", async () => {
    const barramento = new Barramento()
    abrir("a", { criarCanal: barramento.criar })
    await passar(ASSUMIR_POR_DIFUSAO)
    const b = abrir("b", { criarCanal: barramento.criar })
    await passar(ASSUMIR_POR_DIFUSAO)
    // A dies without `pagehide` (dead process): its channel goes silent.
    const [canalDeA] = barramento.canais
    ;(canalDeA as CanalFalso).fechado = true
    expect(b.posse.estado.t).toBe("espera")
    await passar(SILENCIO_MS + BATIMENTO_MS + ASSUMIR_POR_DIFUSAO)
    expect(b.posse.estado.t).toBe("dono")
  })

  it("enquanto o dono bate, ninguém se candidata", async () => {
    const barramento = new Barramento()
    const a = abrir("a", { criarCanal: barramento.criar })
    await passar(ASSUMIR_POR_DIFUSAO)
    const b = abrir("b", { criarCanal: barramento.criar })
    await passar(SILENCIO_MS * 4)
    expect(a.posse.estado.t).toBe("dono")
    expect(b.posse.estado.t).toBe("espera")
  })

  it("um dono só escondido (temporizadores lentos) não perde a posse sem razão", async () => {
    const barramento = new Barramento()
    const a = abrir("a", { criarCanal: barramento.criar })
    await passar(ASSUMIR_POR_DIFUSAO)
    const b = abrir("b", { criarCanal: barramento.criar })
    await passar(ASSUMIR_POR_DIFUSAO)
    // The clock jumps without timers running: the browser slowed them down.
    vi.setSystemTime(Date.now() + 5 * 60_000)
    await passar(BATIMENTO_MS + 60)
    expect(a.posse.estado.t).toBe("dono")
    expect(a.paragens).toBe(0)
    expect(b.posse.estado.t).toBe("espera")
  })

  it("um dono congelado que acorda com outro dono no lugar perde, sem gravar", async () => {
    const barramento = new Barramento()
    const a = abrir("a", { criarCanal: barramento.criar })
    await passar(ASSUMIR_POR_DIFUSAO)
    const b = abrir("b", { criarCanal: barramento.criar })
    await passar(ASSUMIR_POR_DIFUSAO)
    // A freezes: its channel goes silent and B, without hearing it, takes over.
    const [canalDeA] = barramento.canais
    ;(canalDeA as CanalFalso).fechado = true
    await passar(SILENCIO_MS + BATIMENTO_MS + ASSUMIR_POR_DIFUSAO)
    expect(b.posse.estado.t).toBe("dono")
    // A wakes up: asks and re-announces itself; B's announcement is more recent.
    ;(canalDeA as CanalFalso).fechado = false
    vi.setSystemTime(Date.now() + SILENCIO_MS + 1_000)
    await passar(BATIMENTO_MS * 2 + 60)
    expect(a.modos).toEqual([false])
    expect(a.posse.estado.t).toBe("cedido")
    expect(b.posse.estado.t).toBe("dono")
  })

  it('"Usar este separador" por difusão: o dono grava, diz "cedi", e o outro assume', async () => {
    const barramento = new Barramento()
    const a = abrir("a", { criarCanal: barramento.criar })
    await passar(ASSUMIR_POR_DIFUSAO)
    const b = abrir("b", { criarCanal: barramento.criar })
    await passar(ASSUMIR_POR_DIFUSAO)
    b.posse.pedir()
    await passar(10)
    expect(b.posse.estado.t).toBe("espera")
    await passar(60 + BATIMENTO_MS + 50)
    expect(a.escritas).toEqual(["ultima"])
    expect(a.posse.estado.t).toBe("cedido")
    expect(b.posse.estado.t).toBe("dono")
  })

  it("um dono calado por difusão também pede o segundo clique", async () => {
    const barramento = new Barramento()
    const a = abrir("a", { criarCanal: barramento.criar, prazoParaCeder: 3_000 })
    await passar(ASSUMIR_POR_DIFUSAO)
    const b = abrir("b", { criarCanal: barramento.criar, prazoParaCeder: 3_000 })
    await passar(ASSUMIR_POR_DIFUSAO)
    // A stops responding to requests, but its heartbeat is still heard.
    const [canalDeA] = barramento.canais
    const ouvintesDeA = (canalDeA as CanalFalso).ouvintes.splice(0)
    b.posse.pedir()
    await passar(3_000)
    expect(b.posse.estado).toEqual({ t: "espera", aPedir: false, semResposta: true })
    ;(canalDeA as CanalFalso).ouvintes.push(...ouvintesDeA)
    b.posse.pedir({ forcar: true })
    await passar(BATIMENTO_MS + 100)
    expect(b.posse.estado.t).toBe("dono")
    // B's announcement is more recent: A loses, without saving.
    expect(a.modos).toEqual([false])
    expect(a.posse.estado.t).toBe("cedido")
  })

  it("dois candidatos ao mesmo tempo: só um chega a dono, e o outro nunca abriu o cofre", async () => {
    const barramento = new Barramento()
    const a = abrir("a", { criarCanal: barramento.criar })
    const b = abrir("b", { criarCanal: barramento.criar })
    await passar(ASSUMIR_POR_DIFUSAO + BATIMENTO_MS * 2)
    const donos = [a, b].filter((s) => s.posse.estado.t === "dono")
    expect(donos).toHaveLength(1)
    const outro = donos[0] === a ? b : a
    expect(outro.posse.estado.t).toBe("espera")
    // The confirmation heartbeat brought the loser back to waiting without ever being the owner.
    expect(outro.estados).not.toContain("dono")
    expect(outro.paragens).toBe(0)
  })
})

describe("sem nada", () => {
  it("corre como antes, e diz que não há protecção", async () => {
    const a = abrir("a", {})
    await passar(0)
    expect(a.posse.estado).toEqual({ t: "dono", via: "nenhuma" })
  })

  it("e largar continua a parar a escrita, gravando", async () => {
    const a = abrir("a", {})
    await passar(0)
    const largado = a.posse.largar()
    await passar(60)
    await largado
    expect(a.modos).toEqual([true])
    expect(a.posse.estado.t).toBe("largado")
  })
})
