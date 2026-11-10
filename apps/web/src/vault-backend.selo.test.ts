import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { IdbFalso } from "./testes/idb-falso.js"
import { BrowserVaultBackend, RECUSA_DE_ESCRITA, confereResumo, resumoDoCofre, resumoInteiroDoCofre, type MotivoDaPerda } from "./vault-backend.js"

/**
 * The seal and the vault owner token, against the fake IndexedDB in `testes/`.
 *
 * What holds:
 * - a write only counts as done on the transaction's `oncomplete`;
 * - the seal rejects what comes after and lets what already started finish;
 * - the token locks, within the same transaction, a write from a tab
 *   whose name is no longer the owner's (fencing);
 * - the IndexedDB connection opens once, and with it open the transaction starts
 *   on the `write` call itself (the `pagehide` handler needs this).
 */

let idb: IdbFalso

beforeEach(() => {
  idb = new IdbFalso()
  ;(globalThis as { indexedDB?: unknown }).indexedDB = idb.indexedDB
})

afterEach(() => {
  vi.useRealTimers()
})

const esperar = (ms = 5): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const bytes = (n: number): Uint8Array => new Uint8Array([n])
const gravado = (): number | undefined => {
  const valor = idb.dados.get("current") as ArrayBuffer | undefined
  return valor ? new Uint8Array(valor)[0] : undefined
}

describe("o selo do cofre", () => {
  it("depois do selo, escrever e apagar são recusados com a chave 117", async () => {
    const backend = new BrowserVaultBackend()
    backend.selar()
    await expect(backend.write(bytes(1))).rejects.toThrow(RECUSA_DE_ESCRITA)
    await expect(backend.clear()).rejects.toThrow(RECUSA_DE_ESCRITA)
    expect(idb.putsGravados).toBe(0)
  })

  it("a escrita que partiu antes do selo segue, e escritasAcabadas espera pelo oncomplete", async () => {
    const backend = new BrowserVaultBackend()
    idb.reter = true
    const escrita = backend.write(bytes(7))
    backend.selar()
    let acabou = false
    const espera = backend.escritasAcabadas().then(() => {
      acabou = true
    })
    await esperar(20)
    // The request already ran; the transaction has not completed yet.
    expect(idb.retidas).toBe(1)
    expect(acabou).toBe(false)
    idb.soltar()
    await escrita
    await espera
    expect(acabou).toBe(true)
    expect(gravado()).toBe(7)
  })
})

describe("a ligação ao IndexedDB", () => {
  it("abre-se uma vez para muitas escritas", async () => {
    const backend = new BrowserVaultBackend()
    await backend.write(bytes(1))
    await backend.write(bytes(2))
    await backend.read()
    expect(idb.aberturas).toBe(1)
    expect(gravado()).toBe(2)
  })

  it("com a ligação aberta, a transacção nasce na própria chamada a write", async () => {
    const backend = new BrowserVaultBackend()
    await backend.write(bytes(1))
    const antes = idb.transaccoes
    const escrita = backend.write(bytes(2))
    // No `await` in between: this is what the `pagehide` handler needs.
    expect(idb.transaccoes).toBe(antes + 1)
    await escrita
    expect(gravado()).toBe(2)
  })
})

describe("a ficha de posse (fencing)", () => {
  it("o dono escreve; quem perdeu a ficha é recusado dentro da transacção, e avisado", async () => {
    let perdeu = 0
    const antigo = new BrowserVaultBackend({ aoPerderPosse: () => (perdeu += 1) })
    const novo = new BrowserVaultBackend()

    expect((await antigo.assumirPosse("a")).geracao).toBe(1)
    await antigo.write(bytes(1))
    expect(gravado()).toBe(1)

    // Another tab takes over. The old one wakes and tries to write.
    expect((await novo.assumirPosse("b")).geracao).toBe(2)
    await expect(antigo.write(bytes(99))).rejects.toThrow(RECUSA_DE_ESCRITA)
    expect(gravado()).toBe(1)
    expect(perdeu).toBe(1)

    // And it stays sealed: it does not try again.
    await expect(antigo.write(bytes(98))).rejects.toThrow(RECUSA_DE_ESCRITA)
    expect(perdeu).toBe(1)

    await novo.write(bytes(2))
    expect(gravado()).toBe(2)
  })

  it("uma escrita do antigo que partiu ANTES da ficha nova fica no disco antes da leitura do novo", async () => {
    const antigo = new BrowserVaultBackend()
    const novo = new BrowserVaultBackend()
    await antigo.assumirPosse("a")
    await antigo.write(bytes(1))

    const ultima = antigo.write(bytes(5))
    const ficha = novo.assumirPosse("b")
    const lido = novo.read()
    await ultima
    await ficha
    expect(new Uint8Array((await lido) ?? [])[0]).toBe(5)
  })

  it("uma escrita do antigo que parte DEPOIS da ficha nova aborta inteira", async () => {
    const antigo = new BrowserVaultBackend()
    const novo = new BrowserVaultBackend()
    await antigo.assumirPosse("a")
    await antigo.write(bytes(1))
    await novo.assumirPosse("b")
    await expect(antigo.write(bytes(6))).rejects.toThrow(RECUSA_DE_ESCRITA)
    await expect(antigo.clear()).rejects.toThrow(RECUSA_DE_ESCRITA)
    expect(gravado()).toBe(1)
  })

  it("sem ficha assumida (browser sem protecção) escreve como antes", async () => {
    const backend = new BrowserVaultBackend()
    await backend.write(bytes(3))
    expect(gravado()).toBe(3)
  })
})

describe("um escritor sem ficha (separador com o código de antes)", () => {
  /*
    The old tab does not read the token or the lock: it writes over them. This mimics
    a backend that never took ownership, which is exactly what the old production
    code did.
  */
  it("o dono dá pela escrita alheia na seguinte, não grava por cima, e diz porquê", async () => {
    const motivos: MotivoDaPerda[] = []
    const dono = new BrowserVaultBackend({ aoPerderPosse: (motivo) => motivos.push(motivo) })
    const antigo = new BrowserVaultBackend()

    await dono.assumirPosse("dono")
    await dono.write(bytes(1))
    await dono.write(bytes(2))
    expect(gravado()).toBe(2)

    await antigo.write(bytes(40))
    await expect(dono.write(bytes(3))).rejects.toThrow(RECUSA_DE_ESCRITA)
    // What the old tab wrote stays: the owner does not write over a state it does not know.
    expect(gravado()).toBe(40)
    expect(motivos).toEqual(["outro-escritor"])
    // E fica selado.
    await expect(dono.write(bytes(4))).rejects.toThrow(RECUSA_DE_ESCRITA)
    expect(motivos).toEqual(["outro-escritor"])
  })

  it("assumir com um cofre já gravado guarda o resumo dele, e escrever a seguir passa", async () => {
    await new BrowserVaultBackend().write(bytes(9))
    const dono = new BrowserVaultBackend()
    const ficha = await dono.assumirPosse("dono")
    expect(ficha.ultimo).toBe(resumoDoCofre(idb.dados.get("current")))
    await dono.write(bytes(10))
    expect(gravado()).toBe(10)
  })

  it("apagar e voltar a gravar mantém o resumo certo", async () => {
    const dono = new BrowserVaultBackend()
    await dono.assumirPosse("dono")
    await dono.write(bytes(1))
    await dono.clear()
    expect(gravado()).toBeUndefined()
    await dono.write(bytes(2))
    expect(gravado()).toBe(2)
  })

  it("o resumo muda com o conteúdo e não com a cópia", () => {
    expect(resumoDoCofre(new Uint8Array([1, 2, 3]).buffer)).toBe(resumoDoCofre(new Uint8Array([1, 2, 3]).buffer))
    expect(resumoDoCofre(new Uint8Array([1, 2, 3]).buffer)).not.toBe(resumoDoCofre(new Uint8Array([1, 2, 4]).buffer))
    expect(resumoDoCofre(new Uint8Array([0]).buffer)).not.toBe(resumoDoCofre(new Uint8Array([0, 0]).buffer))
    expect(resumoDoCofre(undefined)).toBe("vazio")
  })

  /*
    Summary of the endpoints (slow-after-enter, 4/11/2026): the whole digest took
    18 s of 54 s of writes in a profile with 11 MB and CPU 4x slower.
  */
  it("o resumo das pontas vê outra gravação do mesmo tamanho, pelo nonce do início", () => {
    const um = new Uint8Array(11_000_000)
    const outro = new Uint8Array(11_000_000)
    outro[150] = 7 // where the random nonce for each write lives
    expect(resumoDoCofre(um.buffer)).not.toBe(resumoDoCofre(outro.buffer))
    expect(confereResumo(um.buffer, resumoDoCofre(um.buffer))).toBe(true)
    expect(confereResumo(outro.buffer, resumoDoCofre(um.buffer))).toBe(false)
    // And it costs the same with 11 MB or 11 KB: it reads only the endpoints.
    const inicio = performance.now()
    for (let i = 0; i < 100; i++) resumoDoCofre(um.buffer)
    expect(performance.now() - inicio).toBeLessThan(200)
  })

  it("uma ficha da versão anterior (resumo inteiro) continua a valer, e a escrita seguinte passa ao formato novo", async () => {
    await new BrowserVaultBackend().write(bytes(5))
    const dono = new BrowserVaultBackend()
    await dono.assumirPosse("dono")
    // The token as 1.3.0 left it: the digest of the entire file.
    const ficha = idb.dados.get("dono") as { id: string; geracao: number; ultimo: string }
    idb.dados.set("dono", { ...ficha, ultimo: resumoInteiroDoCofre(idb.dados.get("current")) })
    await dono.write(bytes(6))
    expect(gravado()).toBe(6)
    expect((idb.dados.get("dono") as { ultimo: string }).ultimo).toBe(resumoDoCofre(idb.dados.get("current")))
    expect((idb.dados.get("dono") as { ultimo: string }).ultimo.startsWith("p1-")).toBe(true)
  })
})
