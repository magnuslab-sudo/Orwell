import { importSframeKey, leavesOf, SframeSender } from "@enclave/crypto"
import type { UserAddress } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"
import { CifraDeMedia } from "./media-sframe.js"

/**
 * SEC-03 (external audit of 1.1.0), with accounts, sessions, and server for real.
 *
 * A person expelled from the channel mid-call left the old key in cache: frames
 * they kept encrypting with that key would open. Here the expulsion is a true
 * MLS commit (`expel`), and the question "do you have a sheet?" is the session
 * answering about the current tree. Only the media endpoints are from the test.
 * The distinction that must not be lost: a reseat (no sheet in one commit, a
 * different one in the next) continues to be heard.
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

beforeEach(() => {
  // A Chromium browser: insertable streams. The endpoints bring their own flows.
  class Ponta {
    createEncodedStreams(): unknown {
      throw new Error("as pontas destes testes trazem os seus fluxos")
    }
  }
  vi.stubGlobal("RTCRtpSender", Ponta)
  vi.stubGlobal("RTCRtpReceiver", Ponta)
  return () => vi.unstubAllGlobals()
})

/** A media receiver with both endpoints under test control. */
function receptor(): { ponta: RTCRtpReceiver; empurrar: (bytes: Uint8Array) => void; saida: Uint8Array[] } {
  const saida: Uint8Array[] = []
  let controlador!: ReadableStreamDefaultController<{ data: ArrayBuffer }>
  const readable = new ReadableStream<{ data: ArrayBuffer }>({
    start(controller) {
      controlador = controller
    },
  })
  const writable = new WritableStream<{ data: ArrayBuffer }>({
    write(frame) {
      saida.push(new Uint8Array(frame.data))
    },
  })
  return {
    ponta: { createEncodedStreams: () => ({ readable, writable }) } as unknown as RTCRtpReceiver,
    saida,
    empurrar: (bytes) => controlador.enqueue({ data: bytes.slice().buffer as ArrayBuffer }),
  }
}

/** The media encryption for an account, with their session as the key source. */
function cifraDe(conta: ContaDeTeste, canal: string, diagnosticos: string[] = []): CifraDeMedia {
  const cifra = new CifraDeMedia(
    {
      selfAddress: conta.address as UserAddress,
      mediaKey: (c, address, folha) => conta.session.mediaKey(c, address, folha),
      reservarContadorSframe: (c, keyId) => conta.session.reservarContadorSframe(c, keyId),
    },
    (code) => diagnosticos.push(code),
  )
  cifra.canal = canal
  return cifra
}

const folhasDe = (quem: ContaDeTeste, em: ContaDeTeste, canal: string): number[] => {
  const grupo = em.session.groupFor(canal)
  return grupo ? leavesOf(grupo.state.ratchetTree, quem.address as UserAddress) : []
}


/** Voice frames encrypted with a media key, as the sender encrypts them. */
async function falar(chave: { keyId: number; senderId: number; material: Uint8Array }, quantos = 5): Promise<Uint8Array[]> {
  const emissor = new SframeSender(await importSframeKey(chave.material, chave.keyId, chave.senderId))
  const saida: Uint8Array[] = []
  for (let i = 0; i < quantos; i++) saida.push(await emissor.encrypt(new Uint8Array([i, 1, 2, 3])))
  return saida
}

const assentar = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

describe("uma pessoa expulsa a meio de uma chamada", () => {
  it("perde todas as chaves no dono, e os quadros com a chave antiga deixam de abrir", async () => {
    const [dono, bruno, carla] = await contasDeTeste(servidor, ["dono", "bruno", "carla"])
    abertas.push(dono!, bruno!, carla!)
    const canal = await canalComTodos(servidor, dono!, [bruno!, carla!])
    await ate(() => folhasDe(carla!, dono!, canal).length === 1, "a carla tem folha na árvore do dono")
    await ate(() => folhasDe(bruno!, dono!, canal).length === 1, "o bruno tem folha na árvore do dono")

    const cifra = cifraDe(dono!, canal)
    expect(await cifra.emissor()).toBeDefined()
    const daCarla = receptor()
    const doBruno = receptor()
    expect(await cifra.protegerReceptor(daCarla.ponta, carla!.address as UserAddress)).toBe(true)
    expect(await cifra.protegerReceptor(doBruno.ponta, bruno!.address as UserAddress)).toBe(true)

    // Carla speaks with her key, and it opens.
    const chaveAntigaDaCarla = await carla!.session.mediaKey(canal, carla!.address as UserAddress)
    const chaveAntigaDoBruno = await bruno!.session.mediaKey(canal, bruno!.address as UserAddress)
    if (!chaveAntigaDaCarla || !chaveAntigaDoBruno) throw new Error("sem chaves próprias")
    for (const quadro of await falar(chaveAntigaDaCarla)) daCarla.empurrar(quadro)
    await ate(() => daCarla.saida.length === 5, "a carla ouve-se antes", 5_000, 5)

    // The commit that removes her, and the rotation the owner does with it. Carla
    // is not in the list (her presence does not matter): only bruno.
    await dono!.session.expel(canal, carla!.address)
    await ate(() => folhasDe(carla!, dono!, canal).length === 0, "a carla saiu da árvore do dono")
    expect(await cifra.rodar([bruno!.address as UserAddress])).toEqual([carla!.address])
    expect(cifra.receptoresDe(carla!.address as UserAddress)).toBe(0)

    // Carla does not know, or pretends not to know, and keeps encrypting with the key she had.
    for (const quadro of await falar(chaveAntigaDaCarla)) daCarla.empurrar(quadro)
    await assentar()
    expect(daCarla.saida).toHaveLength(5)

    // Bruno stays in the tree: the two-key window is for him, and frames still
    // arriving with the previous epoch key open.
    expect(cifra.receptoresDe(bruno!.address as UserAddress)).toBe(2)
    for (const quadro of await falar(chaveAntigaDoBruno)) doBruno.empurrar(quadro)
    await ate(() => doBruno.saida.length === 5, "o bruno continua a ouvir-se", 5_000, 5)
  }, 90_000)

  it("um reassento continua a ouvir-se no MESMO receptor, mesmo com a rotação a ver o commit do meio", async () => {
    const [dono, bruno, carla] = await contasDeTeste(servidor, ["dono", "bruno", "carla"])
    abertas.push(dono!, bruno!, carla!)
    const canal = await canalComTodos(servidor, dono!, [bruno!, carla!])
    await ate(() => folhasDe(carla!, dono!, canal).length === 1, "a carla tem folha na árvore do dono")

    const cifra = cifraDe(dono!, canal)
    expect(await cifra.emissor()).toBeDefined()
    const daCarla = receptor()
    expect(await cifra.protegerReceptor(daCarla.ponta, carla!.address as UserAddress)).toBe(true)

    // The reseat is two commits, and the rotation sees the middle one: no sheet at all.
    await dono!.session.expel(canal, carla!.address)
    await ate(() => folhasDe(carla!, dono!, canal).length === 0, "a carla saiu da árvore do dono")
    expect(await cifra.rodar([carla!.address as UserAddress])).toEqual([carla!.address])
    expect(cifra.receptoresDe(carla!.address as UserAddress)).toBe(0)

    await dono!.session.seat(canal, carla!.address)
    await ate(() => folhasDe(carla!, dono!, canal).length === 1, "a carla voltou à árvore do dono")
    const folhaNova = folhasDe(carla!, dono!, canal)[0]!
    await ate(() => folhasDe(carla!, carla!, canal)[0] === folhaNova, "a carla abriu o Welcome")

    // Carla in the same epoch as the owner (she applies the commits following the
    // Welcome on her own). Before that she encrypts with an epoch the owner already left.
    const keyIdDe = async (quem: ContaDeTeste): Promise<number | undefined> =>
      (await quem.session.mediaKey(canal, carla!.address as UserAddress))?.keyId
    for (let volta = 0; (await keyIdDe(carla!)) !== (await keyIdDe(dono!)); volta++) {
      if (volta > 300) throw new Error("a carla não chegou à epoch do dono")
      await assentar()
    }

    // The next commit gives her the key back, and it does not leak outside.
    expect(await cifra.rodar([carla!.address as UserAddress])).toEqual([])
    const chaveNova = await carla!.session.mediaKey(canal, carla!.address as UserAddress)
    if (!chaveNova) throw new Error("a carla não tem chave própria")
    expect(chaveNova.senderId).toBe(folhaNova)
    for (const quadro of await falar(chaveNova)) daCarla.empurrar(quadro)
    await ate(() => daCarla.saida.length === 5, "o som da carla volta, no mesmo receptor", 5_000, 5)
  }, 90_000)
})
