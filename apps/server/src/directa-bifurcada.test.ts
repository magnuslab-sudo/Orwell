import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { eMoradaOpaca, moradaDirecta, temChaveDeConta, type Identity, type Payload } from "@enclave/protocol"
import { ate, Cliente, contasDeTeste, desligarContas, levantarServidor, type ContaDeTeste, type ServidorDeTeste } from "../testes/cliente-de-teste.js"

/** The account key of an identity created in this test: check it and fail loud if missing. */
function chaveDeConta(identity: Identity): Uint8Array {
  if (!temChaveDeConta(identity)) throw new Error("esta identidade não tem a chave de conta")
  return identity.signingPrivateKey
}

/**
 * The direct conversation opened by both sides at the same instant (phase 1g).
 *
 * Finding from phase 1d: two cross friend requests, with the direct not opened
 * before, would create two MLS groups with the same name (in 0.9, `!dm-a.b`; in
 * 1.0, the opaque address of the DH of both accounts, which both also calculate the same).
 * Each side wrote to its group and the other did not read it. In the interface
 * this showed the account owner's report: "Friends (1)" and a pending request at the same time.
 *
 * These tests use accounts and a real server. The proof is always the same:
 * at the end both sides are in the SAME group (the same epoch and the same leaves)
 * and each reads what the other wrote.
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

const leu = (conta: ContaDeTeste, canal: string, corpo: string): boolean =>
  conta.session.history(canal).some((entrada) => entrada.payload["body"] === corpo)

describe("a directa aberta pelos dois lados no mesmo instante", () => {
  // Three times: the race is time-sensitive, and one run that passes proves nothing.
  for (const volta of [1, 2, 3]) {
    it(`os dois ficam no mesmo grupo e lêem-se (volta ${volta})`, async () => {
      const [ana, bruno] = await contas("Ana", "Bruno")
      const [dmA, dmB] = await Promise.all([
        ana!.session.openDirect(bruno!.address),
        bruno!.session.openDirect(ana!.address),
      ])
      expect(dmA).toBe(dmB)
      const dm = dmA

      // Each writes right away, before any Welcome has time to arrive: it is the exact
      // race of the frames from 1d (`application` of both, seq 0 and 1).
      await Promise.all([ana!.session.send(dm, mensagem("da Ana")), bruno!.session.send(dm, mensagem("do Bruno"))])

      await ate(() => leu(bruno!, dm, "da Ana") && leu(ana!, dm, "do Bruno"), "cada um lê o primeiro do outro", 30_000)

      // And what is written after also gets through, in both directions.
      await ana!.session.send(dm, mensagem("depois, da Ana"))
      await bruno!.session.send(dm, mensagem("depois, do Bruno"))
      await ate(
        () => leu(bruno!, dm, "depois, da Ana") && leu(ana!, dm, "depois, do Bruno"),
        "cada um lê o segundo do outro",
        30_000,
      )
      expect(ana!.session.membersOf(dm).map(String).sort()).toEqual(bruno!.session.membersOf(dm).map(String).sort())
    }, 120_000)
  }

  it("dois pedidos de amizade cruzados sem directa aberta dão «amigos» dos dois lados", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    // What the interface does when you click "Request friend": opens the direct and requests.
    const pedir = async (quem: ContaDeTeste, a: ContaDeTeste): Promise<void> => {
      const dm = await quem.session.openDirect(a.address)
      await quem.session.sendFriendRequest(dm)
    }
    await Promise.all([pedir(ana!, bruno!), pedir(bruno!, ana!)])
    await ate(
      () =>
        ana!.session.friendTies().get(bruno!.address)?.link === "amigos" &&
        bruno!.session.friendTies().get(ana!.address)?.link === "amigos",
      "os dois ficam amigos",
      45_000,
    )
  }, 120_000)
})

/**
 * The repair for someone who lost the direct group (1.0 "Arca", slice 3).
 *
 * Until 0.9 this was "the pair already split": a client before 1g would create its
 * group and seat the other, both at the same time, and the server let each side
 * of a `!dm-a.b` refound the channel at epoch 0. With the opaque address the
 * server does not know whose direct it is and no one refounds it (slice 4, the safe side).
 * So the split no longer happens: whoever loses the group (a `forgetChannel`, a
 * restored vault) and opens the direct again does not create a second group, but
 * asks the pair for a seat (`channel.claim` with `empty: false`). The four loops
 * prove that both return to the same group without losing the vault.
 */
describe("quem perdeu o grupo da directa volta a ela sem a refundar", () => {
  for (const volta of [1, 2, 3, 4]) {
    it(`os dois acabam no mesmo grupo e lêem-se (volta ${volta})`, async () => {
      const [ana, bruno] = await contas("Ana", "Bruno")
      const dm = await ana!.session.openDirect(bruno!.address)
      await ate(() => bruno!.session.channels.includes(dm), "o Welcome chega ao Bruno")
      await ana!.session.send(dm, mensagem("antiga da Ana"))
      await ate(() => leu(bruno!, dm, "antiga da Ana"), "o Bruno lê a primeira")

      // Half the loops: Ana loses the group; the other half, Bruno.
      const [perdeu, ficou] = volta % 2 === 1 ? [ana!, bruno!] : [bruno!, ana!]
      await perdeu.session.forgetChannel(dm)
      expect(perdeu.session.channels).not.toContain(dm)
      // Opens again: the same address, and joins via the seat the pair gives.
      expect(await perdeu.session.openDirect(ficou.address)).toBe(dm)
      expect(perdeu.session.channels).toContain(dm)
      expect(perdeu.avisos).not.toContain("channel-forked")

      let n = 0
      await ate(
        () => {
          n++
          if (n % 40 === 1) {
            void ana!.session.send(dm, mensagem(`nova da Ana ${n}`)).catch(() => {})
            void bruno!.session.send(dm, mensagem(`nova do Bruno ${n}`)).catch(() => {})
          }
          const anaLe = ana!.session.history(dm).some((e) => String(e.payload["body"]).startsWith("nova do Bruno"))
          const brunoLe = bruno!.session.history(dm).some((e) => String(e.payload["body"]).startsWith("nova da Ana"))
          return anaLe && brunoLe
        },
        "os dois voltam a ler-se",
        60_000,
      )
      // And whoever stayed lost nothing from the vault.
      expect(leu(ficou, dm, "antiga da Ana")).toBe(true)
      expect(ana!.session.membersOf(dm).map(String).sort()).toEqual(bruno!.session.membersOf(dm).map(String).sort())
    }, 150_000)
  }
})

describe("uma terceira conta não chega à directa de duas", () => {
  it("não sabe a morada, e reclamar o nome antigo não atrasa a directa", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const ic = carla!.session.identity
    // With her key and one of the other two, Carla can only reach her direct connection with him.
    const daCarla = moradaDirecta(chaveDeConta(ic), bruno!.session.identity.signingPublicKey, ic.address, bruno!.address)
    // The name that 0.9 used: claiming it does not touch the opaque address.
    const local = (conta: ContaDeTeste): string => conta.address.slice(1, conta.address.indexOf(":"))
    const [a, b] = [local(ana!), local(bruno!)].sort()
    const intrusa = await Cliente.ligar(servidor.url, ic)
    try {
      intrusa.enviar({ t: "channel.claim", channel: `!dm-${a}.${b}:${servidor.casa}` })
      await intrusa.proximoDe("channel.claim.result")
    } finally {
      intrusa.fechar()
    }
    const canal = await ana!.session.openDirect(bruno!.address)
    expect(canal).not.toBe(daCarla)
    expect(eMoradaOpaca(canal)).toBe(true)
    await ate(() => bruno!.session.channels.includes(canal), "o Bruno entra na directa")
    expect(ana!.avisos).not.toContain("directa-sem-estreia")
    expect(carla!.session.channels).not.toContain(canal)
  }, 120_000)
})
