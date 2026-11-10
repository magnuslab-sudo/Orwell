import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { argon2id } from "@noble/hashes/argon2.js"
import { contasJuntadas, Session, Vault, type PairEvento } from "@enclave/client-core"
import { friendsOfTies } from "@enclave/protocol"
import {
  ate,
  CofreEmMemoria,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * "Merge accounts" (phase 8.2 of 0.9), with real accounts and server.
 *
 * Ana is the extra account (the secondary): Bruno's friend and a member of a channel
 * founded by Carla. Dora is the main one. Ana merges into Dora: her device pairs
 * with Dora, notifies Bruno and the channel, leaves everything, and becomes
 * one of Dora's devices.
 *
 * We measure what each VAULT knows, not what went on the wire. The server does not change.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  await servidor?.fechar()
})

async function contas(...nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes)
  abertas.push(...novas)
  return novas
}

function esperarFase<F extends PairEvento["fase"]>(session: Session, fase: F, prazoMs = 20_000): Promise<Extract<PairEvento, { fase: F }>> {
  return new Promise((resolve, reject) => {
    const prazo = setTimeout(() => {
      desligar()
      reject(new Error(`nunca chegou a fase ${fase}`))
    }, prazoMs)
    const desligar = session.on("pair", (evento) => {
      if (evento.fase === fase) {
        clearTimeout(prazo)
        desligar()
        resolve(evento as Extract<PairEvento, { fase: F }>)
      } else if (evento.fase === "falhou" && fase !== "falhou") {
        clearTimeout(prazo)
        desligar()
        reject(new Error(`falhou: ${evento.razao}`))
      }
    })
  })
}

const amigos = (conta: ContaDeTeste): string[] => friendsOfTies(conta.session.friendTies())

/**
 * The account the disk holds, opened cold with a passphrase: the account public key
 * and whether the private key is there. `null` if the passphrase does not open it.
 *
 * The disk and not memory, and not "byte by byte": the session writes the vault all the
 * time (markers, groups), and what matters is which account is there.
 */
async function contaNoDisco(conta: ContaDeTeste, frase: string): Promise<{ chave: string | undefined; privada: boolean } | null> {
  const frio = new Vault(conta.backend)
  try {
    await frio.unlock(frase)
  } catch {
    return null
  }
  return { chave: frio.contents.accountPublicKey, privada: Boolean(frio.contents.signingPrivateKey) }
}

/**
 * Ana with vault key derivation OUTSIDE this thread, as in the browser
 * (the web's `kdf-worker`): derivation yields to the event loop, and in
 * that gap the screen can ask the session things.
 */
async function contaComDerivacaoLenta(nome: string): Promise<ContaDeTeste> {
  const backend = new CofreEmMemoria()
  const vault = new Vault(backend, async (frase, sal, parametros) => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    return argon2id(new TextEncoder().encode(frase), sal, parametros)
  })
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault)
  const identidade = await session.createIdentity(servidor.casa)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  const conta = { nome, session, vault, backend, address: identidade.address, avisos: [] }
  abertas.push(conta)
  return conta
}

/** Ana and Bruno are friends, and Ana is in one of Carla's channels. */
async function cenario(): Promise<{ ana: ContaDeTeste; bruno: ContaDeTeste; carla: ContaDeTeste; dora: ContaDeTeste; canal: string }> {
  const ana = await contaComDerivacaoLenta("Ana")
  const [bruno, carla, dora] = await contas("Bruno", "Carla", "Dora")
  const dm = await ana.session.openDirect(bruno!.address)
  await ate(() => bruno!.session.channels.includes(dm), "o Bruno entra na directa")
  await ana.session.sendFriendRequest(dm)
  await ate(() => bruno!.session.friendTies().get(ana.address)?.link === "pedido-recebido", "o pedido chega ao Bruno")
  await bruno!.session.acceptFriend(dm, ana.address)
  await ate(() => amigos(ana).includes(bruno!.address) && amigos(bruno!).includes(ana.address), "a Ana e o Bruno são amigos")
  const canal = await canalComTodos(servidor, carla!, [ana])
  return { ana, bruno: bruno!, carla: carla!, dora: dora!, canal }
}

/** Step 1: Ana pairs with Dora up to the certificate. */
async function emparelharComADora(ana: ContaDeTeste, dora: ContaDeTeste): Promise<void> {
  const sasDora = esperarFase(dora.session, "sas")
  const { link } = await dora.session.emparelharComoAnfitriao()
  const sasAna = esperarFase(ana.session, "sas")
  ana.session.emparelharParaJuntar(link)
  await Promise.all([sasDora, sasAna])
  const certificado = esperarFase(ana.session, "certificado")
  await ana.session.confirmarSas()
  await dora.session.confirmarSas()
  await certificado
}

describe("juntar contas, de ponta a ponta", () => {
  it("a Ana junta-se à Dora: o Bruno e a Carla são avisados, e a Ana desaparece", async () => {
    const { ana, bruno, carla, dora, canal } = await cenario()
    const secundaria = ana.address
    const antes = await contaNoDisco(ana, "frase-passe-de-teste")
    expect(antes?.privada).toBe(true)

    await emparelharComADora(ana, dora)
    expect(ana.session.contaParaJuntar).toBe(dora.address)
    // Step 1 did not touch the vault's account: it is still Ana's, with her key.
    expect(await contaNoDisco(ana, "frase-passe-de-teste")).toEqual(antes)

    await ana.session.juntarAvisar()
    // It left everything, and ended the friendship.
    expect(ana.session.channels).toEqual([])

    const concluidoDora = esperarFase(dora.session, "concluido", 30_000)
    // The screen keeps asking the session things during the swap: it must never
    // catch the session without an identity (the browser's "no identity loaded").
    let semIdentidade = 0
    const sonda = setInterval(() => {
      try {
        void ana.session.identity.address
      } catch {
        semIdentidade++
      }
    }, 1)
    const { address } = await ana.session.juntarTrocar("frase-nova-da-dora").finally(() => clearInterval(sonda))
    expect(address).toBe(dora.address)
    expect(semIdentidade).toBe(0)
    await concluidoDora
    // The main account records that it merged Ana.
    expect(contasJuntadas(ana.session.preferencias())).toEqual([secundaria])

    // Bruno: sees "Ana is now Dora" once, was a friend, and Ana leaves his friends.
    await ate(() => bruno.session.sucessoes()[secundaria]?.para === dora.address, "a sucessão chega ao Bruno")
    expect(bruno.session.sucessoes()[secundaria]?.eraAmigo).toBe(true)
    await ate(() => !amigos(bruno).includes(secundaria), "a Ana sai dos amigos do Bruno")

    // One tap sends the request to Dora; Dora accepts.
    await bruno.session.adicionarSucessora(secundaria)
    expect(bruno.session.sucessoes()[secundaria]?.feitos).toContain("amigo")
    await ate(() => dora.session.friendTies().get(bruno.address)?.link === "pedido-recebido", "o pedido do Bruno chega à Dora")
    const dmDora = dora.session.friendTies().get(bruno.address)!.channel
    await dora.session.acceptFriend(dmDora, bruno.address)
    await ate(() => amigos(bruno).includes(dora.address), "o Bruno e a Dora são amigos")

    // Carla: Ana left the channel, and the succession arrived through the channel.
    await ate(() => carla.session.sucessoes()[secundaria]?.canais.includes(canal) === true, "a sucessão chega à Carla pelo canal")
    await ate(() => !carla.session.membersOf(canal).map(String).includes(secundaria), "a Ana sai dos membros do canal")

    // One tap sends the invite to Dora; one of Dora's devices asks to join on its own.
    await carla.session.convidarSucessora(secundaria, canal)
    await ate(
      () => dora.session.channels.includes(canal) || ana.session.channels.includes(canal),
      "a Dora entra no canal sem tocar em nada",
      45_000,
    )
    await ate(() => carla.session.membersOf(canal).map(String).includes(dora.address), "a Dora está nos membros do canal", 30_000)

    // Ana's key no longer opens it: the disk holds Dora, without the account private key.
    expect(await contaNoDisco(ana, "frase-passe-de-teste")).toBeNull()
    const depois = await contaNoDisco(ana, "frase-nova-da-dora")
    expect(depois?.privada).toBe(false)
    expect(depois?.chave).not.toBe(antes?.chave)
    expect(ana.session.identity.address).toBe(dora.address)

    // And an account does not merge into itself: this device is already Dora's.
    const sasDora = esperarFase(dora.session, "sas")
    const { link } = await dora.session.emparelharComoAnfitriao()
    const sasAqui = esperarFase(ana.session, "sas")
    const falhou = esperarFase(ana.session, "falhou", 30_000)
    ana.session.emparelharParaJuntar(link)
    await Promise.all([sasDora, sasAqui])
    await ana.session.confirmarSas()
    await dora.session.confirmarSas()
    expect((await falhou).razao).toBe("mesma-conta")
    expect(ana.session.contaParaJuntar).toBeNull()
  }, 240_000)

  it("se o computador da principal desistir depois do certificado, nada se avisa nem se apaga", async () => {
    // `contas` returns one account per name, in name order.
    const [ana, dora] = (await contas("Ana", "Dora")) as [ContaDeTeste, ContaDeTeste]
    const antes = await contaNoDisco(ana, "frase-passe-de-teste")
    await emparelharComADora(ana, dora)
    expect(ana.session.contaParaJuntar).toBe(dora.address)
    dora.session.cancelarEmparelhamento()
    // Dora's computer closed the box: it would no longer publish this device.
    // The box closing reaches Ana through the server: half a second is enough.
    await new Promise((resolve) => setTimeout(resolve, 500))
    await expect(ana.session.juntarAvisar()).rejects.toThrow("the other device stopped waiting, nothing was deleted")
    expect(ana.session.contaParaJuntar).toBeNull()
    await expect(ana.session.juntarTrocar("frase-nova")).rejects.toThrow("there is no account to join")
    expect(ana.session.identity.address).toBe(ana.address)
    expect(await contaNoDisco(ana, "frase-passe-de-teste")).toEqual(antes)
  }, 60_000)

  it("se o emparelhamento falhar, nada se avisa e nada se apaga", async () => {
    const { ana, bruno, carla, dora, canal } = await cenario()
    const secundaria = ana.address
    const antes = await contaNoDisco(ana, "frase-passe-de-teste")

    const sasDora = esperarFase(dora.session, "sas")
    const { link } = await dora.session.emparelharComoAnfitriao()
    const falhou = esperarFase(ana.session, "falhou")
    ana.session.emparelharParaJuntar(link)
    await sasDora
    // Dora says "Não são" ("They are not").
    dora.session.recusarSas()
    await falhou

    expect(ana.session.contaParaJuntar).toBeNull()
    await expect(ana.session.juntarAvisar()).rejects.toThrow("there is no account to join")
    await expect(ana.session.juntarTrocar("outra")).rejects.toThrow("there is no account to join")

    // Ana stays whole: the same account, the same vault, the channel and the friend.
    expect(ana.session.identity.address).toBe(secundaria)
    expect(await contaNoDisco(ana, "frase-passe-de-teste")).toEqual(antes)
    expect(ana.session.channels).toContain(canal)
    expect(amigos(ana)).toContain(bruno.address)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(bruno.session.sucessoes()[secundaria]).toBeUndefined()
    expect(carla.session.sucessoes()[secundaria]).toBeUndefined()
    expect(carla.session.membersOf(canal).map(String)).toContain(secundaria)
  }, 120_000)
})
