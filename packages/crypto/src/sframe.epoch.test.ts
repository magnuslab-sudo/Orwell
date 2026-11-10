import { generateIdentity, parseServerName, type UserAddress } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import {
  addMembers,
  createChannel,
  decodeKeyPackage,
  epochOf,
  generateKeyPackages,
  joinChannel,
  receive,
  type GroupSession,
} from "./group.js"
import { leafIndexOf } from "./sender.js"
import { deriveSframeKeyMaterial, importSframeKey, readHeader, SframeReceiver, SframeSender } from "./sframe.js"

/**
 * The media key comes from the MLS epoch exporter, proven against real MLS.
 *
 * This is the premise on which all call encryption rests, and until now there
 * was not a single test for it. `call.sframe.test.ts` proves that `Call` rotates
 * keys when the epoch changes, but proves it against a fake bridge whose
 * `mediaKey` returns `material(7)` and `material(8)`, two invented byte strings
 * that are obviously different from each other. What nobody had measured is the
 * lower step: that real MLS actually produces different material at each epoch,
 * and, the part that matters, that the key from the previous epoch is **not
 * derived again** from the new state.
 *
 * Without that step, the promise the owner designed is an act of faith: A and B
 * at epoch 41; C joins, the commit advances everyone to 42, and C does not
 * derive 41. That is not code discipline (there is no line saying "do not
 * derive"), it is MLS future secrecy: the exporter secret of 41 no longer
 * exists in anyone's state. These tests force that statement to be true.
 *
 * What is replicated here from `Session.mediaKey`, on purpose: `keyId` is the
 * epoch truncated to 16 bits and `senderId` is the leaf index. The goal is to
 * measure DERIVATION, and the `Session` that wraps it lives in another package
 * with a vault and a connection behind it: bringing it here would measure three
 * things instead of one.
 */

const CASA = parseServerName("orwell.test")
const CANAL = "!chamada:orwell.test"

/** What `Session.mediaKey` does, without the vault or session around it. */
async function chaveDeMedia(
  grupo: GroupSession,
  quem: UserAddress,
): Promise<{ keyId: number; senderId: number; material: Uint8Array }> {
  const senderId = leafIndexOf(grupo.state.ratchetTree, quem)
  if (senderId === undefined) throw new Error(`${quem} não tem folha nesta árvore`)
  const keyId = Number(epochOf(grupo) % 65_536n)
  return { keyId, senderId, material: await deriveSframeKeyMaterial(grupo, keyId, senderId) }
}

function iguais(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

/**
 * The whole thing: A and B in a call, C joining mid-stream.
 *
 * Returns the two moments, because the comparison between them is the proof,
 * and returns the old epoch material stored separately, which is the only way
 * it can still exist after the commit. Storing it is exactly what
 * `#sframeReceivers` does in `call.ts` by holding on to the previous key.
 */
async function aEntradaDeCarla() {
  const ana = generateIdentity(CASA)
  const bruno = generateIdentity(CASA)
  const carla = generateIdentity(CASA)

  const [pacoteBruno] = await generateKeyPackages(bruno, 1)
  const [pacoteCarla] = await generateKeyPackages(carla, 1)
  if (!pacoteBruno || !pacoteCarla) throw new Error("sem key packages")

  // A e B na chamada.
  const fundacao = await createChannel(ana, CANAL)
  const convite = await addMembers(fundacao, [decodeKeyPackage(pacoteBruno.wire)])
  const anaAntes = convite.session
  const brunoAntes = await joinChannel(CANAL, convite.welcome, pacoteBruno.publicPackage, pacoteBruno.privatePackage)

  const chaveDaAnaAntes = await chaveDeMedia(anaAntes, ana.address)

  // C joins: one commit, and everyone moves to the next epoch.
  const entrada = await addMembers(anaAntes, [decodeKeyPackage(pacoteCarla.wire)])
  const anaDepois = entrada.session
  const aplicado = await receive(brunoAntes, entrada.commit)
  if (aplicado.kind !== "epoch") throw new Error(`o Bruno não aplicou o commit: ${aplicado.kind}`)
  const brunoDepois = aplicado.session
  const carlaDepois = await joinChannel(CANAL, entrada.welcome, pacoteCarla.publicPackage, pacoteCarla.privatePackage)

  return {
    ana,
    bruno,
    carla,
    anaAntes,
    anaDepois,
    brunoAntes,
    brunoDepois,
    carlaDepois,
    chaveDaAnaAntes,
  }
}

describe("a chave de media e a epoch", () => {
  it("uma epoch nova dá uma chave nova ao mesmo emissor", async () => {
    const { ana, anaAntes, anaDepois, chaveDaAnaAntes } = await aEntradaDeCarla()
    const depois = await chaveDeMedia(anaDepois, ana.address)

    // The commit advanced the epoch, so the label that travels in the header changes.
    expect(epochOf(anaDepois)).toBeGreaterThan(epochOf(anaAntes))
    expect(depois.keyId).not.toBe(chaveDaAnaAntes.keyId)
    // And Ana's leaf did not move: it is the SAME person, with a different key. If
    // the material were the same, a join would not rekey anything and
    // this whole section of the design would be decorative.
    expect(depois.senderId).toBe(chaveDaAnaAntes.senderId)
    expect(iguais(depois.material, chaveDaAnaAntes.material)).toBe(false)
  }, 60_000)

  it("a chave da epoch anterior não se volta a derivar a partir da nova", async () => {
    const { ana, anaDepois, chaveDaAnaAntes } = await aEntradaDeCarla()

    // Explicitly ask for the old keyId from the group that already advanced. It is
    // the most obvious attempt to recover the old key, and it has to fail: the
    // `keyId` is a LABEL in the header, not a key. The exporter secret of the epoch
    // chooses the key, and the one from before no longer exists anywhere in this
    // state.
    const tentativa = await deriveSframeKeyMaterial(anaDepois, chaveDaAnaAntes.keyId, chaveDaAnaAntes.senderId)
    expect(iguais(tentativa, chaveDaAnaAntes.material)).toBe(false)
  }, 60_000)

  it("quem entra na epoch nova não abre um frame da anterior", async () => {
    const { ana, carla, carlaDepois, chaveDaAnaAntes } = await aEntradaDeCarla()

    // A frame from the call before: Ana speaking when there were only two of them.
    const emissor = new SframeSender(
      await importSframeKey(chaveDaAnaAntes.material, chaveDaAnaAntes.keyId, chaveDaAnaAntes.senderId),
    )
    const frameAntigo = await emissor.encrypt(new Uint8Array([1, 2, 3, 4]))

    // Carla reads the header (it is in the clear, as it must be so the SFU can
    // forward without any key) and knows exactly which key to ask for.
    const cabecalho = readHeader(frameAntigo)
    expect(cabecalho?.keyId).toBe(chaveDaAnaAntes.keyId)
    expect(cabecalho?.senderId).toBe(chaveDaAnaAntes.senderId)

    // And she asks for it. With the state she has, which is the only one she has:
    // she joined in the next epoch and never saw the previous one.
    const oQueACarlaConsegue = await deriveSframeKeyMaterial(
      carlaDepois,
      cabecalho?.keyId ?? 0,
      cabecalho?.senderId ?? 0,
    )
    expect(iguais(oQueACarlaConsegue, chaveDaAnaAntes.material)).toBe(false)

    const receptor = new SframeReceiver(
      await importSframeKey(oQueACarlaConsegue, chaveDaAnaAntes.keyId, chaveDaAnaAntes.senderId),
    )
    // Silence, not an error: the AES-GCM tag does not verify and the frame drops. It
    // is MLS future secrecy doing the work, without a line of code deciding
    // anything about Carla.
    expect(await receptor.decrypt(frameAntigo)).toBeUndefined()
    // And Carla is a full member of the new epoch (her leaf exists), so what fails
    // above is really the epoch and not the tree.
    expect(leafIndexOf(carlaDepois.state.ratchetTree, carla.address)).toBeDefined()
    expect(leafIndexOf(carlaDepois.state.ratchetTree, ana.address)).toBeDefined()
  }, 60_000)

  it("nem quem JÁ LÁ ESTAVA a recupera, se não a tiver guardado", async () => {
    /*
      The consequence that forces the two-key window to exist, and which is easy
      to read backwards.

      Bruno was in the old epoch. That does not let him derive it
      again after applying the commit: the exporter secret it came from was
      replaced in his own state. The only reason he still hears the frames
      that were in flight is that he KEPT the previous key object, which is
      exactly what `#sframeReceivers` does in `call.ts` with its `slice(0, 2)`.

      Put another way: the two-key window is not an implementation convenience
      that can be removed in a refactor. It is the only thing that stops every
      join from cutting the sound for everyone during the gap between two
      clients applying the same commit.
    */
    const { ana, brunoAntes, brunoDepois, chaveDaAnaAntes } = await aEntradaDeCarla()

    // Before the commit, Bruno derived Ana's key byte by byte.
    const oQueOBrunoTinha = await chaveDeMedia(brunoAntes, ana.address)
    expect(iguais(oQueOBrunoTinha.material, chaveDaAnaAntes.material)).toBe(true)

    // After the commit, with the same request, he no longer does.
    const oQueOBrunoConsegue = await deriveSframeKeyMaterial(
      brunoDepois,
      chaveDaAnaAntes.keyId,
      chaveDaAnaAntes.senderId,
    )
    expect(iguais(oQueOBrunoConsegue, chaveDaAnaAntes.material)).toBe(false)
  }, 60_000)
})

/**
 * The two-key window, fed by the real keys of the epoch.
 *
 * The mechanism already existed and is proven in `call.sframe.test.ts`: the
 * header carries `keyId` per frame, the receiver keeps the current key and the
 * previous one, and picks the one the frame declares. What was missing is
 * proof that it works with material that real MLS produces, not just invented
 * bytes: two consecutive epochs of a real group, two frames, and the header
 * deciding which opens with which.
 */
describe("a janela de duas chaves com epochs verdadeiras", () => {
  it("o cabeçalho escolhe a chave, e as duas epochs abrem", async () => {
    const { ana, anaDepois, chaveDaAnaAntes } = await aEntradaDeCarla()
    const chaveNova = await chaveDeMedia(anaDepois, ana.address)

    const antigo = await new SframeSender(
      await importSframeKey(chaveDaAnaAntes.material, chaveDaAnaAntes.keyId, chaveDaAnaAntes.senderId),
    ).encrypt(new Uint8Array([0xa1]))
    const novo = await new SframeSender(
      await importSframeKey(chaveNova.material, chaveNova.keyId, chaveNova.senderId),
    ).encrypt(new Uint8Array([0xb2]))

    // The chain that `#sharedReceiver` builds: the new key at the head, the
    // previous one right after, trimmed to two.
    const cadeia = [
      { keyId: chaveNova.keyId, receptor: new SframeReceiver(await importSframeKey(chaveNova.material, chaveNova.keyId, chaveNova.senderId)) },
      {
        keyId: chaveDaAnaAntes.keyId,
        receptor: new SframeReceiver(
          await importSframeKey(chaveDaAnaAntes.material, chaveDaAnaAntes.keyId, chaveDaAnaAntes.senderId),
        ),
      },
    ]

    async function abrir(frame: Uint8Array<ArrayBuffer>): Promise<Uint8Array | undefined> {
      const cabecalho = readHeader(frame)
      const escolhido = cadeia.find((entrada) => entrada.keyId === cabecalho?.keyId)
      return escolhido?.receptor.decrypt(frame)
    }

    expect(await abrir(novo)).toEqual(new Uint8Array([0xb2]))
    // And what was still in flight from the previous epoch still opens, which is
    // the difference between the call carrying on and everyone going silent for half
    // a second each time someone joins.
    expect(await abrir(antigo)).toEqual(new Uint8Array([0xa1]))

    // The counterfactual, so nobody confuses the window with generosity: a
    // receiver that only has the new key does not open the old frame.
    const soANova = new SframeReceiver(
      await importSframeKey(chaveNova.material, chaveNova.keyId, chaveNova.senderId),
    )
    expect(await soANova.decrypt(antigo)).toBeUndefined()
  }, 60_000)
})
