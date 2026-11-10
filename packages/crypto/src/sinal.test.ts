import { generateIdentity, parseServerName } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { addMembers, createChannel, decodeKeyPackage, generateKeyPackages, joinChannel, receive } from "./group.js"
import { deriveSframeKeyMaterial } from "./sframe.js"
import { abrirSinal, derivarChaveDoSinal, epocaDoSinal, selarSinal } from "./sinal.js"

/**
 * The signal key comes from the MLS epoch exporter, like the SFrame key (phase S4).
 * Tested against real MLS: two members derive the same key, whoever joins later
 * cannot open a signal from the earlier epoch, and the channel and epoch are
 * bound to the bytes.
 */

const CASA = parseServerName("orwell.test")
const CANAL = "!lagar:orwell.test"

async function anaBrunoECarla() {
  const ana = generateIdentity(CASA)
  const bruno = generateIdentity(CASA)
  const carla = generateIdentity(CASA)
  const [pacoteBruno] = await generateKeyPackages(bruno, 1)
  const [pacoteCarla] = await generateKeyPackages(carla, 1)
  if (!pacoteBruno || !pacoteCarla) throw new Error("sem key packages")
  const fundacao = await createChannel(ana, CANAL)
  const convite = await addMembers(fundacao, [decodeKeyPackage(pacoteBruno.wire)])
  const anaAntes = convite.session
  const brunoAntes = await joinChannel(CANAL, convite.welcome, pacoteBruno.publicPackage, pacoteBruno.privatePackage)
  const entrada = await addMembers(anaAntes, [decodeKeyPackage(pacoteCarla.wire)])
  const aplicado = await receive(brunoAntes, entrada.commit)
  if (aplicado.kind !== "epoch") throw new Error("o Bruno não aplicou o commit")
  const carla2 = await joinChannel(CANAL, entrada.welcome, pacoteCarla.publicPackage, pacoteCarla.privatePackage)
  return { anaAntes, brunoAntes, anaDepois: entrada.session, brunoDepois: aplicado.session, carla: carla2 }
}

const texto = new TextEncoder().encode('{"k":"r0"}')

describe("a chave do sinal", () => {
  it("dois membros da mesma época abrem o sinal um do outro", async () => {
    const { anaAntes, brunoAntes } = await anaBrunoECarla()
    const daAna = await derivarChaveDoSinal(anaAntes, CANAL)
    const doBruno = await derivarChaveDoSinal(brunoAntes, CANAL)
    const selado = selarSinal(daAna, CANAL, texto)
    expect(epocaDoSinal(selado)).toBe(daAna.epoca)
    expect(abrirSinal(doBruno, CANAL, selado)).toEqual(texto)
  }, 60_000)

  it("quem entra depois não abre um sinal da época anterior, e a época nova abre", async () => {
    const { anaAntes, anaDepois, carla } = await anaBrunoECarla()
    const antiga = selarSinal(await derivarChaveDoSinal(anaAntes, CANAL), CANAL, texto)
    const daCarla = await derivarChaveDoSinal(carla, CANAL)
    expect(abrirSinal(daCarla, CANAL, antiga)).toBeNull()
    const nova = selarSinal(await derivarChaveDoSinal(anaDepois, CANAL), CANAL, texto)
    expect(abrirSinal(daCarla, CANAL, nova)).toEqual(texto)
  }, 60_000)

  it("o canal e os bytes estão presos: outro canal ou um bit trocado não abrem", async () => {
    const { anaAntes, brunoAntes } = await anaBrunoECarla()
    const chave = await derivarChaveDoSinal(anaAntes, CANAL)
    const selado = selarSinal(chave, CANAL, texto)
    expect(abrirSinal(await derivarChaveDoSinal(brunoAntes, CANAL), "!outro:orwell.test", selado)).toBeNull()
    const trocado = selado.slice()
    trocado[trocado.length - 1] = (trocado[trocado.length - 1] ?? 0) ^ 1
    expect(abrirSinal(chave, CANAL, trocado)).toBeNull()
    // The declared epoch too: lying about it does not open with another epoch's key.
    const outraEpoca = selado.slice()
    outraEpoca[8] = (outraEpoca[8] ?? 0) ^ 1
    expect(abrirSinal(chave, CANAL, outraEpoca)).toBeNull()
  }, 60_000)

  it("a chave do sinal não é a do SFrame: rótulo próprio", async () => {
    const { anaAntes } = await anaBrunoECarla()
    const sinal = await derivarChaveDoSinal(anaAntes, CANAL)
    const media = await deriveSframeKeyMaterial(anaAntes, 0, 0)
    expect(Buffer.from(sinal.chave).toString("hex")).not.toBe(Buffer.from(media.subarray(0, 32)).toString("hex"))
  }, 60_000)
})
