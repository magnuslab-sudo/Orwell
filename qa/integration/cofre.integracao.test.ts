import { afterEach, describe, expect, it } from "vitest"
import { Session, Vault } from "@enclave/client-core"
import { CofreEmMemoria, levantarServidor } from "../../apps/server/testes/cliente-de-teste.js"

/**
 * O Argon2id verdadeiro, contra um homeserver verdadeiro.
 *
 * A suíte do servidor troca esta derivação por uma barata. Este ficheiro corre
 * no Vitest de `qa/integration`, que não carrega esse substituto. São três
 * derivações: criar, abrir com a frase certa, falhar com a frase errada.
 */

const FRASE = "frase-passe-de-teste"
const fechos: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const fechar of fechos.splice(0)) await fechar()
})

describe("cofre com o KDF de produção", () => {
  it("abre outra vez com a mesma frase, liga a mesma conta, e recusa a frase errada", async () => {
    const servidor = await levantarServidor()
    fechos.push(servidor.fechar)
    const backend = new CofreEmMemoria()

    const vault = new Vault(backend)
    await vault.create(FRASE)
    const sessao = new Session(vault)
    const identidade = await sessao.createIdentity(servidor.casa)
    await sessao.connect()
    expect(servidor.enclave.store.signingKeyOf(identidade.address)).toBeDefined()
    sessao.disconnect()
    vault.lock()
    expect(vault.unlocked).toBe(false)

    const deNovo = new Vault(backend)
    await deNovo.unlock(FRASE)
    const segunda = new Session(deNovo)
    expect(segunda.loadIdentity().address).toBe(identidade.address)
    await segunda.connect()
    expect(servidor.enclave.store.signingKeyOf(identidade.address)).toBeDefined()
    segunda.disconnect()
    deNovo.lock()

    const errada = new Vault(backend)
    await expect(errada.unlock("outra-frase-completamente-diferente")).rejects.toThrow(
      "wrong passphrase, or the vault is damaged",
    )
    expect(errada.unlocked).toBe(false)
  }, 120_000)
})
