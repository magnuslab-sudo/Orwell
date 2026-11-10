import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { eMoradaOpaca, friendsOfTies, moradaDeSala, moradaDirecta, temChaveDeConta, type Identity, type Payload } from "@enclave/protocol"
import { DatabaseSync } from "node:sqlite"
import {
  ate,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * Opaque addresses in the session (1.0 "Arca", slice 3), with real accounts, devices and
 * server.
 *
 * Each block is a point in the slice: the direct (DH of account keys), the wall
 * (owner secret), the room (random, with the name inside the encrypted state) and
 * the account channel (derived from the key). We measure what each vault knows
 * and what the server stores.
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

async function telemovelDe(conta: ContaDeTeste): Promise<ContaDeTeste> {
  const telemovel = await emparelharAparelho(conta)
  abertas.push(telemovel)
  return telemovel
}

function mensagem(corpo: string): Payload {
  return {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body: corpo,
    attachments: [],
    links: [],
    mentions: [],
  } as unknown as Payload
}

/** The account key of an identity created in this test: check it and fail loud if missing. */
function chaveDeConta(identity: Identity): Uint8Array {
  if (!temChaveDeConta(identity)) throw new Error("esta identidade não tem a chave de conta")
  return identity.signingPrivateKey
}

const leu = (conta: ContaDeTeste, canal: string, corpo: string): boolean =>
  conta.session.history(canal).some((entrada) => entrada.payload["body"] === corpo)

describe("a conversa directa opaca", () => {
  it("os dois lados chegam à mesma morada sem falar, e o servidor não a vê nos endereços", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const ia = ana!.session.identity
    const ib = bruno!.session.identity
    // Each side only with its own private key and the other's public key.
    const doLadoDaAna = moradaDirecta(chaveDeConta(ia), ib.signingPublicKey, ia.address, ib.address)
    const doLadoDoBruno = moradaDirecta(chaveDeConta(ib), ia.signingPublicKey, ib.address, ia.address)
    expect(doLadoDaAna).toBe(doLadoDoBruno)
    expect(eMoradaOpaca(doLadoDaAna)).toBe(true)
    for (const conta of [ana!, bruno!]) expect(doLadoDaAna).not.toContain(conta.session.identity.accountId)

    // And the session opens the direct at that address; Bruno recognizes it on its own as the direct with Ana.
    const dm = await ana!.session.openDirect(bruno!.address)
    expect(dm).toBe(doLadoDaAna)
    await ate(() => bruno!.session.channels.includes(dm), "o Bruno entra na directa")
    expect(bruno!.session.fichaDoCanal(dm)).toEqual({ tipo: "directa", par: ana!.address })
    expect(ana!.session.fichaDoCanal(dm)).toEqual({ tipo: "directa", par: bruno!.address })
    // Bruno opens the same one, without creating another.
    expect(await bruno!.session.openDirect(ana!.address)).toBe(dm)
  }, 60_000)

  it("um aparelho emparelhado recebe a morada e a ficha pelo cofre, e abre a directa", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    // A direct that already exists when the phone pairs: it comes in the snapshot.
    const comBruno = await ana!.session.openDirect(bruno!.address)
    await ate(() => bruno!.session.channels.includes(comBruno), "o Bruno entra na directa")
    const telemovel = await telemovelDe(ana!)
    expect(telemovel.session.temChaveDeConta).toBe(false)
    expect(telemovel.session.fichaDoCanal(comBruno)).toEqual({ tipo: "directa", par: bruno!.address })
    await ate(() => telemovel.session.channels.includes(comBruno), "o telemóvel entra na directa com o Bruno", 30_000)
    expect(await telemovel.session.openDirect(bruno!.address)).toBe(comBruno)

    // A direct opened later, on the computer: the record arrives through the account channel.
    const comCarla = await ana!.session.openDirect(carla!.address)
    await ate(() => telemovel.session.fichaDoCanal(comCarla).tipo === "directa", "a ficha da directa com a Carla chega ao telemóvel", 30_000)
    expect(telemovel.session.fichaDoCanal(comCarla)).toEqual({ tipo: "directa", par: carla!.address })
    expect(await telemovel.session.openDirect(carla!.address)).toBe(comCarla)
    await ate(() => telemovel.session.channels.includes(comCarla), "o telemóvel entra na directa com a Carla", 30_000)
    await telemovel.session.send(comCarla, mensagem("do telemóvel da Ana"))
    await ate(() => leu(carla!, comCarla, "do telemóvel da Ana"), "a Carla lê o telemóvel da Ana", 30_000)
  }, 120_000)

  it("sem a chave de conta, o aparelho não começa uma conversa com quem a conta nunca falou", async () => {
    const [ana, dora] = await contas("Ana", "Dora")
    const telemovel = await telemovelDe(ana!)
    await expect(telemovel.session.openDirect(dora!.address)).rejects.toThrow("this device cannot start a new conversation")
  }, 60_000)
})

async function amigos(a: ContaDeTeste, b: ContaDeTeste): Promise<string> {
  const dm = await a.session.openDirect(b.address)
  await ate(() => b.session.channels.includes(dm), `${b.nome} entra na directa`)
  await a.session.sendFriendRequest(dm)
  await ate(() => b.session.friendTies().get(a.address)?.link === "pedido-recebido", `o pedido chega a ${b.nome}`)
  await b.session.acceptFriend(dm, a.address)
  await ate(
    () => friendsOfTies(a.session.friendTies()).includes(b.address) && friendsOfTies(b.session.friendTies()).includes(a.address),
    "os dois são amigos",
  )
  return dm
}

/** All text from the server tables, to find what shouldn't be there. */
function textoDaBase(alvo: ServidorDeTeste = servidor): string {
  const base = new DatabaseSync(alvo.baseDeDados, { readOnly: true })
  try {
    const tabelas = base.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    let texto = ""
    for (const { name } of tabelas) {
      for (const linha of base.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[]) {
        for (const valor of Object.values(linha)) if (typeof valor === "string") texto += `${valor}\n`
      }
    }
    return texto
  } finally {
    base.close()
  }
}

describe("o mural opaco (D1)", () => {
  it("o amigo recebe o segredo no perfil e entra no mural; um estranho na sala comum não o sabe", async () => {
    // A server just for this test: the common room is born with Ana, who stays connected
    // to admit Carla (the ones from other tests have nobody listening anymore).
    const proprio = await levantarServidor()
    const [ana, bruno, carla] = await contasDeTeste(proprio, ["Ana", "Bruno", "Carla"])
    abertas.push(ana!, bruno!, carla!)
    const mural = ana!.session.feedChannel
    expect(eMoradaOpaca(mural)).toBe(true)
    expect(mural).not.toContain(ana!.session.identity.accountId)

    await amigos(ana!, bruno!)
    await ate(() => bruno!.session.channels.includes(mural), "o Bruno entra no mural da Ana", 30_000)
    expect(bruno!.session.muralDe(ana!.address)).toBe(mural)
    expect(bruno!.session.fichaDoCanal(mural)).toEqual({ tipo: "mural", dono: ana!.address })
    // Her wall is also opaque, and Ana enters.
    await ate(() => ana!.session.channels.includes(bruno!.session.feedChannel), "a Ana entra no mural do Bruno", 30_000)

    // Carla is with Ana in the common room, and nothing else: she doesn't know the address.
    const sala = proprio.sala
    await ate(() => carla!.session.channels.includes(sala) && ana!.session.channels.includes(sala), "as duas na sala comum", 30_000)
    await ana!.session.publishProfile([sala], true)
    await ate(() => carla!.vault.contents.directory[ana!.address] !== undefined, "o perfil da Ana chega à Carla", 30_000)
    expect(carla!.vault.contents.directory[ana!.address]?.payload["mural"]).toBeUndefined()
    expect(carla!.session.muralDe(ana!.address)).toBeNull()
    expect(carla!.session.channels).not.toContain(mural)
    // What she can try is the old form, which is nobody's wall anymore.
    expect(carla!.session.channels.some((canal) => canal.startsWith("!feed-"))).toBe(false)

    // And the server: no wall address with an account id, no `!feed-`.
    const texto = textoDaBase(proprio)
    expect(texto).not.toContain("!feed-")
    expect(texto).toContain(mural)
    desligarContas(abertas.splice(0))
    await proprio.fechar()
  }, 120_000)

  it("um aparelho emparelhado sabe o mural da conta sem a chave", async () => {
    const [ana] = await contas("Ana")
    const mural = await ana!.session.ensureFeed()
    const telemovel = await telemovelDe(ana!)
    expect(telemovel.session.temChaveDeConta).toBe(false)
    expect(telemovel.session.feedChannel).toBe(mural)
    await ate(() => telemovel.session.channels.includes(mural), "o telemóvel entra no mural da conta", 30_000)
    expect(telemovel.session.fichaDoCanal(mural)).toEqual({ tipo: "mural", dono: ana!.address })
  }, 60_000)
})

describe("a sala opaca", () => {
  it("a morada é aleatória, o nome vai cifrado, e quem entra pelo Welcome recebe-o", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const NOME = "Lagar do Monte Velho"
    const sala = moradaDeSala(servidor.casa)
    await ana!.session.createSpace(sala, undefined, NOME)
    await ate(() => ana!.session.founderOf(sala) === ana!.address, "a Ana funda a sala")
    expect(ana!.session.fichaDoCanal(sala)).toEqual({ tipo: "sala" })
    expect(ana!.session.spaceMeta(sala)?.name).toBe(NOME)

    // By Welcome: Bruno is seated.
    await ana!.session.seat(sala, bruno!.address)
    await ate(() => bruno!.session.channels.includes(sala), "o Bruno entra")
    await ate(() => bruno!.session.spaceMeta(sala)?.name === NOME, "o nome chega ao Bruno", 30_000)
    expect(bruno!.session.tipoDoCanal(sala)).toBe("sala")

    // By invite: Carla enters through a link.
    const ligacao = await ana!.session.createInvite(sala, { maxUses: 1 })
    await carla!.session.redeemInvite(ligacao)
    await ate(() => carla!.session.channels.includes(sala), "a Carla entra pelo convite", 30_000)
    await ate(() => carla!.session.spaceMeta(sala)?.name === NOME, "o nome chega à Carla", 30_000)
    expect(carla!.session.tipoDoCanal(sala)).toBe("sala")

    // The server doesn't have the name anywhere, nor the name form.
    const texto = textoDaBase()
    expect(texto).toContain(sala)
    for (const pedaco of ["Lagar", "lagar", "Monte Velho", "monte-velho"]) expect(texto).not.toContain(pedaco)
  }, 120_000)
})

describe("o canal da conta opaco", () => {
  it("deriva-se da chave, e o aparelho emparelhado recebe a morada no emparelhamento", async () => {
    const [ana] = await contas("Ana")
    const proprio = ana!.session.canalDaConta
    expect(eMoradaOpaca(proprio)).toBe(true)
    expect(proprio).not.toContain(ana!.session.identity.accountId)
    const telemovel = await telemovelDe(ana!)
    expect(telemovel.session.temChaveDeConta).toBe(false)
    expect(telemovel.vault.contents.moradaDaConta).toBe(proprio)
    expect(telemovel.session.canalDaConta).toBe(proprio)
    await ate(() => telemovel.vault.contents.groups[proprio] !== undefined, "o telemóvel entra no canal da conta", 30_000)
    // Account state passes through it: a phone preference arrives at the computer.
    await telemovel.session.definirPreferencia("tema", "escuro")
    await ate(() => ana!.session.preferencias()["tema"] === "escuro", "a preferência chega ao computador", 30_000)
    // And the server has no `!self-` anywhere.
    expect(textoDaBase()).not.toContain("!self-")
    expect(textoDaBase()).toContain(proprio)
  }, 90_000)
})

describe("a ficha já vale quando o canal aparece", () => {
  /*
    Found by the script `e2e-amizade-cruzada`: the `channels` event leaves before
    the group is recorded, and the record (direct or wall) only entered the vault with
    it. At that moment the interface saw a room, and the bell said "You were
    added to #<address>" by a wall.
  */
  it("dois pedidos cruzados: cada directa e cada mural aparecem logo com o tipo certo", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const primeiraVez: Record<string, Record<string, string>> = { ana: {}, bruno: {} }
    for (const [nome, conta] of [["ana", ana!], ["bruno", bruno!]] as const) {
      conta.session.on("channels", ({ channels }) => {
        for (const canal of channels) primeiraVez[nome]![canal] ??= conta.session.tipoDoCanal(canal)
      })
    }
    const pedir = async (de: ContaDeTeste, para: ContaDeTeste): Promise<void> => {
      await de.session.sendFriendRequest(await de.session.openDirect(para.address))
    }
    await Promise.all([pedir(ana!, bruno!), pedir(bruno!, ana!)])
    const muralDaAna = ana!.session.feedChannel
    const muralDoBruno = bruno!.session.feedChannel
    await ate(
      () => bruno!.session.channels.includes(muralDaAna) && ana!.session.channels.includes(muralDoBruno),
      "cada um entra no mural do outro",
      45_000,
    )
    const dm = await ana!.session.openDirect(bruno!.address)
    expect(primeiraVez["ana"]![dm]).toBe("directa")
    expect(primeiraVez["bruno"]![dm]).toBe("directa")
    expect(primeiraVez["ana"]![muralDaAna]).toBe("mural")
    expect(primeiraVez["bruno"]![muralDaAna]).toBe("mural")
    expect(primeiraVez["ana"]![muralDoBruno]).toBe("mural")
  }, 120_000)
})
