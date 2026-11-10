import { generateIdentity, parseServerName, type Payload } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import {
  createChannel,
  decodeKeyPackage,
  encryptPayload,
  generateKeyPackages,
  joinChannelExternally,
  publishableGroupInfo,
  receive,
  type GroupSession,
} from "./group.js"
import { memberAddresses } from "./sender.js"

const HOME = parseServerName("enclave.test")
const CANAL = "!984:enclave.test"

function text(body: string): Payload {
  return { t: "message", id: crypto.randomUUID(), sentAt: 1_700_000_000_000, body, attachments: [], mentions: [], links: [] }
}

function membros(session: GroupSession): string[] {
  return [...memberAddresses(session.state.ratchetTree).values()].map(String).sort()
}

/**
 * The door that opens by itself, proved end to end.
 *
 * What these tests pin down is not the library: it is the contract the product now
 * depends on. A newcomer to a public room joins with no one on the other
 * side, and the members already there accept that join without doing anything.
 * Tests that assembled the format by hand would prove none of this; what proves
 * it is the full round trip, with both ends running the real code.
 */
describe("entrada por commit externo", () => {
  it("quem chega entra sozinho, e quem lá estava vê-o entrar", async () => {
    const fundador = generateIdentity(HOME)
    const recemChegado = generateIdentity(HOME)

    let salaDoFundador = await createChannel(fundador, CANAL)
    const cartao = await publishableGroupInfo(salaDoFundador)

    const [pacote] = await generateKeyPackages(recemChegado, 1)
    if (!pacote) throw new Error("sem key package")

    // No one on the other side: just the card, which was stored on the server.
    const entrada = await joinChannelExternally(CANAL, cartao, pacote.publicPackage, pacote.privatePackage)
    expect(membros(entrada.session)).toEqual([fundador.address, recemChegado.address].sort())

    // And the founder, who was asleep, applies the commit on waking up.
    const aplicado = await receive(salaDoFundador, entrada.commit)
    expect(aplicado.kind).toBe("epoch")
    salaDoFundador = aplicado.session
    expect(membros(salaDoFundador)).toEqual([fundador.address, recemChegado.address].sort())
  })

  it("e a partir daí falam os dois, nos dois sentidos", async () => {
    const fundador = generateIdentity(HOME)
    const recemChegado = generateIdentity(HOME)

    let salaDoFundador = await createChannel(fundador, CANAL)
    const [pacote] = await generateKeyPackages(recemChegado, 1)
    if (!pacote) throw new Error("sem key package")

    const entrada = await joinChannelExternally(
      CANAL,
      await publishableGroupInfo(salaDoFundador),
      pacote.publicPackage,
      pacote.privatePackage,
    )
    let salaDoNovo = entrada.session
    salaDoFundador = (await receive(salaDoFundador, entrada.commit)).session

    const daCasa = await encryptPayload(salaDoFundador, text("bem-vindo"))
    const lidoPeloNovo = await receive(salaDoNovo, daCasa.ciphertext)
    expect(lidoPeloNovo.kind).toBe("payload")
    if (lidoPeloNovo.kind === "payload") {
      expect(lidoPeloNovo.sender).toBe(fundador.address)
      salaDoNovo = lidoPeloNovo.session
    }

    const doNovo = await encryptPayload(salaDoNovo, text("obrigado"))
    const lidoPelaCasa = await receive(salaDoFundador, doNovo.ciphertext)
    expect(lidoPelaCasa.kind).toBe("payload")
    if (lidoPelaCasa.kind === "payload") expect(lidoPelaCasa.sender).toBe(recemChegado.address)
  })

  it("um cartão gasto produz um commit que a sala recusa, e é por isso que é de uso único", async () => {
    /*
     * The finding that set the design straight, and that only the full round trip shows.
     *
     * Joining with a card from a past epoch does NOT fail for the joiner:
     * the library builds the commit and returns a state that looks fine. A joiner
     * in this state thinks they are inside, writes, and is heard by no one: the
     * silent fork again, now through a new door.
     *
     * That is why the card is handed out ONCE and disappears from the server: two
     * newcomers arriving at the same instant cannot get the same one, and the one who
     * misses it asks again. Whoever joins publishes the next one, and any member
     * who connects puts one back if it is missing.
     */
    const fundador = generateIdentity(HOME)
    const segundo = generateIdentity(HOME)
    const terceiro = generateIdentity(HOME)

    let salaDoFundador = await createChannel(fundador, CANAL)
    const cartaoVelho = await publishableGroupInfo(salaDoFundador)

    const [pacoteDoSegundo] = await generateKeyPackages(segundo, 1)
    const [pacoteDoTerceiro] = await generateKeyPackages(terceiro, 1)
    if (!pacoteDoSegundo || !pacoteDoTerceiro) throw new Error("sem key packages")

    const entradaDoSegundo = await joinChannelExternally(
      CANAL,
      cartaoVelho,
      pacoteDoSegundo.publicPackage,
      pacoteDoSegundo.privatePackage,
    )
    salaDoFundador = (await receive(salaDoFundador, entradaDoSegundo.commit)).session

    // The third arrives with the same card, which no longer describes the room.
    const entradaTardia = await joinChannelExternally(
      CANAL,
      cartaoVelho,
      pacoteDoTerceiro.publicPackage,
      pacoteDoTerceiro.privatePackage,
    )
    const recusado = await receive(salaDoFundador, entradaTardia.commit)
    expect(recusado.kind).toBe("ignored")
    expect(membros(recusado.session)).toEqual([fundador.address, segundo.address].sort())

    // With the card the second one published, it joins the same room as the others.
    const entradaBoa = await joinChannelExternally(
      CANAL,
      await publishableGroupInfo(entradaDoSegundo.session),
      pacoteDoTerceiro.publicPackage,
      pacoteDoTerceiro.privatePackage,
    )
    expect(membros(entradaBoa.session)).toEqual([fundador.address, segundo.address, terceiro.address].sort())
  })

  it("um cartão de outro canal é recusado antes de se lhe tocar", async () => {
    // Protection against a server that answers a room request with the
    // card of another: the newcomer would join, in good faith, a room they never asked for.
    const dono = generateIdentity(HOME)
    const forasteiro = generateIdentity(HOME)

    const outraSala = await createChannel(dono, "!privado:enclave.test")
    const [pacote] = await generateKeyPackages(forasteiro, 1)
    if (!pacote) throw new Error("sem key package")

    await expect(
      joinChannelExternally(CANAL, await publishableGroupInfo(outraSala), pacote.publicPackage, pacote.privatePackage),
    ).rejects.toThrow(/not !984:enclave.test/)
  })

  it("e lixo no lugar do cartão não passa por cartão", async () => {
    const forasteiro = generateIdentity(HOME)
    const [pacote] = await generateKeyPackages(forasteiro, 1)
    if (!pacote) throw new Error("sem key package")

    await expect(
      joinChannelExternally(CANAL, new Uint8Array([1, 2, 3]), pacote.publicPackage, pacote.privatePackage),
    ).rejects.toThrow(/malformed|expected group info/)
  })
})
