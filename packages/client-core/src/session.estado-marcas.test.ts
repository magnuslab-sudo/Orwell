import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"
import { moradaDeTeste } from "../testes/moradas.js"

/** The vault the session holds inside. `vault` is private in production; the test touches it on purpose. */
const cofreDe = (session: Session): Vault => (session as unknown as { vault: Vault }).vault

/**
 * Account state marks on a single device, offline (revision of 0.6.0).
 *
 *  - `arquivar(channel, at)`: the migration passes the old timestamp, and the mark is
 *    `min(at, agora)`. A mark that loses to the one already there changes nothing.
 *  - `definirPreferencia(chave, valor, at)`: seed with a low mark, so that
 *    the choice the account already has wins.
 *  - `marcarLido`: never more than one day ahead of this device's clock.
 */

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

const DIA = 24 * 60 * 60_000
const CANAL = moradaDeTeste("directa a b", "localhost:8448")
const lidasMs = Session.LIDAS_MS
let session: Session

beforeEach(async () => {
  Session.LIDAS_MS = 60_000
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  session = new Session(vault)
  await session.createIdentity("localhost:8448")
})

afterEach(() => {
  session.disconnect()
  Session.LIDAS_MS = lidasMs
})

describe("arquivar com a hora do gesto", () => {
  it('a migração grava a hora antiga, e não "agora"', async () => {
    const ontem = Date.now() - DIA
    await session.arquivar(CANAL, ontem)
    expect(session.arquivo()[CANAL]).toBe(ontem)
  })

  it('uma hora no futuro fica em "agora"', async () => {
    const antes = Date.now()
    await session.arquivar(CANAL, antes + 365 * DIA)
    expect(session.arquivo()[CANAL]).toBeGreaterThanOrEqual(antes)
    expect(session.arquivo()[CANAL]).toBeLessThanOrEqual(Date.now())
  })

  it("o desarquivar mais recente de outro aparelho ganha à migração", async () => {
    const ontem = Date.now() - DIA
    // The phone unarchived an hour ago; this browser's old archive is from yesterday.
    cofreDe(session).contents.arquivo = { [CANAL]: { arquivado: false, at: Date.now() - 60 * 60_000 } }
    const eventos: unknown[] = []
    session.on("arquivo", (evento) => eventos.push(evento))
    await session.arquivar(CANAL, ontem)
    expect(session.arquivo()[CANAL]).toBeUndefined()
    expect(eventos).toEqual([])
  })

  it("sem hora, é o gesto de agora e passa por cima do que lá está", async () => {
    cofreDe(session).contents.arquivo = { [CANAL]: { arquivado: false, at: Date.now() - 1_000 } }
    const antes = Date.now()
    await session.arquivar(CANAL)
    expect(session.arquivo()[CANAL]).toBeGreaterThanOrEqual(antes)
  })

  it("uma hora inválida é recusada com chave estável", async () => {
    await expect(session.arquivar(CANAL, Number.NaN)).rejects.toThrow("archive time is invalid")
  })
})

describe("semear uma preferência com marca baixa", () => {
  it("a escolha que a conta já tem ganha, e nada muda nem viaja", async () => {
    cofreDe(session).contents.preferencias = { tema: { valor: "escuro", at: 5_000 } }
    const eventos: unknown[] = []
    session.on("preferencias", (evento) => eventos.push(evento))
    await session.definirPreferencia("tema", "claro", 1)
    expect(session.preferencias()["tema"]).toBe("escuro")
    expect(eventos).toEqual([])
  })

  it("sem escolha na conta, a semente fica, com a marca 1", async () => {
    await session.definirPreferencia("tema", "claro", 1)
    expect(session.preferencias()["tema"]).toBe("claro")
    expect(cofreDe(session).contents.preferencias?.["tema"]?.at).toBe(1)
  })

  it("sem hora, a escolha de agora passa por cima", async () => {
    cofreDe(session).contents.preferencias = { tema: { valor: "escuro", at: 5_000 } }
    await session.definirPreferencia("tema", "claro")
    expect(session.preferencias()["tema"]).toBe("claro")
  })
})

describe("uma marca de lido no futuro", () => {
  it("fica a um dia, no máximo, à frente do relógio deste aparelho", async () => {
    const antes = Date.now()
    await session.marcarLido("!sala:localhost:8448", antes + 365 * DIA)
    const marca = session.lidas()["!sala:localhost:8448"] ?? 0
    expect(marca).toBeLessThanOrEqual(Date.now() + DIA)
    expect(marca).toBeGreaterThanOrEqual(antes + DIA)
  })
})
