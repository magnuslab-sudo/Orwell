import { friendsOfTies } from "@enclave/protocol"
import { DatabaseSync } from "node:sqlite"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
// The server of the server harness, for real, on an ephemeral port, and its
// accounts and pairing. The sessions are those of this package: it is the core
// being tested.
import {
  ate,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * Profiles of other people across devices on the same account (1.0 "Arca").
 *
 * Owner's report (29/10/2026): "after pairing on another PC via browser,
 * all users appear as 'no name'". Pairing brought the person's own profile,
 * not others'; and a profile only reaches those in the channel when the person
 * publishes it. Anyone who was offline stayed "no name".
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

const nomeNoDiretorio = (conta: ContaDeTeste, address: string): unknown =>
  conta.vault.contents.directory[address]?.payload["displayName"]

/** A one-pixel PNG as data URL: the smallest avatar the profile accepts. */
const RETRATO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

describe("os perfis das outras pessoas no emparelhamento", () => {
  it("o aparelho novo nasce com os nomes dos amigos, mesmo do que está desligado", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    await bruno!.session.updateProfile({ displayName: "Bruno", statusText: "a ler", donations: [], avatarDataUrl: RETRATO })
    await amigos(ana!, bruno!)
    await amigos(ana!, carla!)
    await ate(
      () => nomeNoDiretorio(ana!, bruno!.address) === "Bruno" && nomeNoDiretorio(ana!, carla!.address) === "Carla",
      "a Ana sabe os dois nomes",
      30_000,
    )
    const versaoDoBruno = ana!.vault.contents.directory[bruno!.address]!.at

    // Bruno goes offline before Ana pairs the new device.
    bruno!.session.disconnect()
    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)

    // Both have names right away on entry, without Bruno coming back.
    expect(nomeNoDiretorio(telemovel, bruno!.address)).toBe("Bruno")
    expect(nomeNoDiretorio(telemovel, carla!.address)).toBe("Carla")
    const doBruno = telemovel.vault.contents.directory[bruno!.address]!
    expect(doBruno.at).toBe(versaoDoBruno)
    expect(doBruno.payload["statusText"]).toBe("a ler")
    // Without the avatar: it does not travel during pairing.
    expect(doBruno.payload["avatar"]).toBeUndefined()
    expect(doBruno.parcial).toBe(true)
    // The person's own profile does not enter the directory through this path.
    expect(telemovel.vault.contents.directory[ana!.address]?.parcial).toBeUndefined()

    // The avatar arrives when Bruno comes back: he republishes the profile on each
    // channel where Ana gained a device (the channel grew).
    await bruno!.session.connect()
    await ate(
      () => typeof (telemovel.vault.contents.directory[bruno!.address]?.payload["avatar"] as { inline?: unknown } | undefined)?.inline === "string",
      "o retrato do Bruno chega ao telemóvel quando ele volta",
      60_000,
    )
    expect(telemovel.vault.contents.directory[bruno!.address]?.parcial).toBeUndefined()
  }, 180_000)
})

/*
  A partition at the channel level, only for the device that wants to be deaf: live
  events from channels in `silenced` do not reach it. It is the "not sharing the channel
  live at that moment" from the request, without disconnecting the device (if disconnected,
  recovery on the next connection would bring the profile through the account channel itself,
  and the path through the account would not be visible). Only affects open connections
  while the filter is in place.
*/
const silenciados = new Set<string>()
const WebSocketDeVerdade = globalThis.WebSocket
class WebSocketComFiltro extends WebSocketDeVerdade {
  override addEventListener(...args: Parameters<WebSocket["addEventListener"]>): void {
    const [tipo, ouvinte, opcoes] = args
    if (tipo !== "message" || ouvinte === null) return super.addEventListener(tipo, ouvinte, opcoes)
    const entrega = typeof ouvinte === "function" ? ouvinte : ouvinte.handleEvent.bind(ouvinte)
    super.addEventListener(
      "message",
      (evento: Event) => {
        try {
          const trama = JSON.parse(String((evento as MessageEvent).data)) as { t?: string; channel?: string }
          if (trama.t === "channel.event" && trama.channel !== undefined && silenciados.has(trama.channel)) return
        } catch {
          // Not JSON: it passes, and whoever reads it decides.
        }
        entrega.call(this, evento)
      },
      opcoes,
    )
  }
}

/** How many events the server keeps on the channel. */
function eventosNoCanal(canal: string): number {
  const base = new DatabaseSync(servidor.baseDeDados, { readOnly: true })
  try {
    return (base.prepare("SELECT COUNT(*) AS n FROM events WHERE channel = ?").get(canal) as { n: number }).n
  } finally {
    base.close()
  }
}

describe("os perfis das outras pessoas pelo canal da conta", () => {
  it("um amigo muda o nome; o outro aparelho da Ana fica a saber pela conta, uma vez", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    await amigos(ana!, bruno!)
    await ate(() => nomeNoDiretorio(ana!, bruno!.address) === "Bruno", "a Ana sabe o nome do Bruno", 30_000)

    globalThis.WebSocket = WebSocketComFiltro as typeof WebSocket
    let telemovel: ContaDeTeste
    try {
      telemovel = await emparelharAparelho(ana!)
    } finally {
      globalThis.WebSocket = WebSocketDeVerdade
    }
    abertas.push(telemovel)
    const daConta = ana!.session.canalDaConta
    await ate(
      () => ana!.vault.contents.groups[daConta] !== undefined && telemovel.vault.contents.groups[daConta] !== undefined,
      "os dois aparelhos no canal da conta",
      30_000,
    )
    const ouvidos: string[][] = []
    telemovel.session.on("perfis", ({ enderecos }) => ouvidos.push(enderecos))

    // The mobile device stops listening live to channels it shares with Bruno.
    for (const canal of telemovel.session.channels) silenciados.add(canal)
    try {
      await bruno!.session.updateProfile({ displayName: "Bruno Silva", statusText: "de férias", donations: [] })
      await ate(() => nomeNoDiretorio(ana!, bruno!.address) === "Bruno Silva", "o computador ouve o nome novo", 30_000)
      const versao = ana!.vault.contents.directory[bruno!.address]!.at
      await ate(() => nomeNoDiretorio(telemovel, bruno!.address) === "Bruno Silva", "o telemóvel sabe o nome novo pela conta", 60_000)
      const noTelemovel = telemovel.vault.contents.directory[bruno!.address]!
      expect(noTelemovel.at).toBe(versao)
      expect(noTelemovel.payload["statusText"]).toBe("de férias")
      // It came from a sibling, not from Bruno: the mobile device did not hear the channel.
      expect(noTelemovel.parcial).toBe(true)
      expect(ouvidos).toContainEqual([bruno!.address])

      /*
        Cutoff by burst: the profile was said once, and the mobile device does not echo it back.
        First we wait for the account channel to go quiet (a burst of something else,
        with the machine loaded, is not what we measure), then Bruno publishes the SAME
        version again on all channels.
      */
      let antes = -1
      await ate(
        () => {
          const agora = eventosNoCanal(daConta)
          const calado = agora === antes
          antes = agora
          return calado
        },
        "o canal da conta cala",
        60_000,
        3_000,
      )
      const depois = eventosNoCanal(daConta)
      await bruno!.session.publishProfile(undefined, true)
      await new Promise((resolve) => setTimeout(resolve, 3 * 2_000))
      expect(eventosNoCanal(daConta)).toBe(depois)
    } finally {
      silenciados.clear()
    }
  }, 180_000)
})
