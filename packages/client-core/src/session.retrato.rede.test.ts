import { assinarAutoria, moradaDeSala, partirRetrato, Payload, type ItemRelatado } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
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
import type { FonteDoRetrato, RetratoMontado } from "./retrato.js"
import { Session } from "./session.js"

/**
 * The channel portrait in Welcome, with server and sessions for real (phase 1 of
 * `docs/planos/estado-cifrado-plano.md`).
 *
 * Whoever joins must see the whole channel in the first `channels`, with nobody
 * connected on the other side: no anti-entropy, no handoff and no cascade from
 * whoever invites (who disconnects in the same tick after commit). And can't
 * trust whoever invites: a forged portrait only includes what has valid authorship
 * from whoever could write it.
 */

/**
 * The caller changed from who invites, for the case of the lying invitee: the
 * portrait assembly is the real one, and `forjar` changes it on the way out. Only for the
 * count in `forjar.quem`.
 */
const forjar: { quem: string | null; mexer: ((montado: RetratoMontado, fonte: FonteDoRetrato) => RetratoMontado) | null } = {
  quem: null,
  mexer: null,
}
// Harness sessions come from the `dist` of this package (`@enclave/client-core`), and that's where the assembly swaps.
vi.mock("../dist/retrato.js", async (original) => {
  const real = await original<typeof import("./retrato.js")>()
  return {
    ...real,
    montarRetrato: (fonte: FonteDoRetrato, geradoEm: number, tecto?: number) => {
      const montado = real.montarRetrato(fonte, geradoEm, tecto)
      return forjar.mexer && fonte.eu.address === forjar.quem ? forjar.mexer(montado, fonte) : montado
    },
  }
})

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const revezamentoAntes = Session.REVEZAMENTO_DAS_SALAS_MS

beforeAll(async () => {
  servidor = await levantarServidor()
  // Room rotation is excluded: only the frame is measured.
  Session.REVEZAMENTO_DAS_SALAS_MS = { de: 2_000_000_000, ate: 2_000_000_000 }
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
  forjar.quem = null
  forjar.mexer = null
})

afterAll(async () => {
  Session.REVEZAMENTO_DAS_SALAS_MS = revezamentoAntes
  await servidor?.fechar()
})

async function contas(...nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes)
  for (const conta of novas) conta.session.antiEntropiaLigada = false
  abertas.push(...novas)
  return novas
}

/** A one-pixel PNG as data URL: the smallest avatar the profile accepts. */
const RETRATO_DO_PERFIL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

interface Fotografia {
  salas: string[]
  categorias: string[]
  nome: string | undefined
  fundador: string | null
  cargosDoBruno: string[]
}

/** What this account knows about the channel at the moment the first `channels` brings it. */
function primeiroChannels(conta: ContaDeTeste, canal: string, bruno: string): Promise<Fotografia> {
  return new Promise((resolve) => {
    const desligar = conta.session.on("channels", ({ channels }) => {
      if (!channels.includes(canal)) return
      desligar()
      resolve({
        salas: conta.session
          .roomsOf(canal)
          .map((sala) => sala.name)
          .sort(),
        categorias: conta.session
          .categoriesOf(canal)
          .map((c) => c.category)
          .sort(),
        nome: conta.session.spaceMeta(canal)?.name,
        fundador: conta.session.founderOf(canal),
        cargosDoBruno: conta.session.rolesFor(canal, bruno),
      })
    })
  })
}

/**
 * Ana starts the Lagar with 3 rooms, 2 categories, a name, and the "gatekeeper"
 * role (invites only) given to Bruno and, if she joins, to Carla.
 */
async function lagarArrumado(ana: ContaDeTeste, membros: ContaDeTeste[], porteiros: ContaDeTeste[]): Promise<string> {
  const canal = moradaDeSala(servidor.casa)
  await ana.session.createSpaceChannel(canal, "Lagar")
  await ate(() => ana.session.founderOf(canal) === ana.address, "a Ana funda o canal")
  await ana.session.upsertCategory(canal, { category: "Adega", position: 1 })
  await ana.session.upsertCategory(canal, { category: "Eira", position: 2 })
  await ana.session.upsertRoom(canal, { room: "prensa", name: "prensa", category: "Adega" })
  await ana.session.upsertRoom(canal, { room: "tonel", name: "tonel", category: "Adega" })
  await ana.session.upsertRoom(canal, { room: "debulha", name: "debulha", category: "Eira" })
  await ana.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["convidar"] })
  for (const membro of membros) {
    await ana.session.seat(canal, membro.address)
    await ate(() => membro.session.channels.includes(canal), `${membro.nome} entra no canal`)
  }
  for (const porteiro of porteiros) await ana.session.assignRoles(canal, porteiro.address, ["porteiro"])
  for (const membro of membros) {
    await ate(
      () => porteiros.every((p) => membro.session.rolesFor(canal, p.address).includes("porteiro")),
      `${membro.nome} sabe quem é porteiro`,
    )
  }
  return canal
}

const SALAS = ["debulha", "prensa", "tonel"]

describe("o retrato no Welcome, com ninguém do outro lado", () => {
  it("(a) a casa fica vazia no tique a seguir ao convite, e quem entra vê o canal inteiro no primeiro channels", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await lagarArrumado(ana!, [bruno!], [bruno!])
    bruno!.session.disconnect()

    const fotografia = primeiroChannels(carla!, canal, bruno!.address)
    // Ana invites and disconnects right after the commit: her cascade doesn't go out.
    const enviados: string[] = []
    const enviar = ana!.session.send.bind(ana!.session)
    ana!.session.send = (async (destino: string, payload: { t: string }) => {
      if (destino === canal) enviados.push(payload.t)
      return enviar(destino, payload as Parameters<typeof enviar>[1])
    }) as Session["send"]
    await ana!.session.seat(canal, carla!.address)
    ana!.session.disconnect()

    const vista = await fotografia
    expect(vista.salas).toEqual(expect.arrayContaining(SALAS))
    expect(vista.categorias).toEqual(["Adega", "Eira"])
    expect(vista.nome).toBe("Lagar")
    expect(vista.fundador).toBe(ana!.address)
    expect(vista.cargosDoBruno).toEqual(["porteiro"])
    expect(carla!.session.rolesOf(canal).map((papel) => papel.role)).toContain("porteiro")
    // Member names too, with each person's authorship.
    expect(carla!.vault.contents.directory[ana!.address]?.payload["displayName"]).toBe("Ana")
    expect(carla!.vault.contents.directory[bruno!.address]?.payload["displayName"]).toBe("Bruno")
    expect(carla!.avisos).toContain("retrato-aplicado")
    // And the inviter's cascade didn't go out: the frame held everything.
    expect(enviados.filter((t) => ["room.created", "role.define", "role.assign", "channel.meta", "channel.category", "space.meta", "profile"].includes(t))).toEqual([])
  }, 120_000)

  it("(b) o convidado mentiroso: o Dário recusa o cargo que a Carla se dá, a fundação dela e a sala trocada, e aceita o resto", async () => {
    const [ana, bruno, carla, dario] = await contas("Ana", "Bruno", "Carla", "Dário")
    const canal = await lagarArrumado(ana!, [bruno!, carla!], [bruno!, carla!])
    // Carla is a gatekeeper (invites only): she forges the link while Ana is online.
    const link = await carla!.session.createInvite(canal)
    ana!.session.disconnect()
    bruno!.session.disconnect()

    // Carla's client lies in the frame.
    forjar.quem = carla!.address
    forjar.mexer = (montado, fonte) => {
      // Valid signatures from Carla's device, on the normalized form: guards are measured, not the signature.
      const assinar = (bruto: Record<string, unknown>, autor = fonte.eu.address): Record<string, unknown> => {
        const p = Payload.parse(bruto) as Record<string, unknown>
        return { ...p, autoria: assinarAutoria({ canal, autor, payload: p, aparelho: fonte.eu.aparelho, assinar: fonte.eu.assinar }) }
      }
      const daCarla = (p: Record<string, unknown>): ItemRelatado => ({ s: -1, a: fonte.eu.address, p: assinar(p) })
      const itens = montado.retrato.itens.map((item) =>
        // Ana's room with a different name, and Ana's signature on it.
        item.p["t"] === "channel.meta" && item.p["room"] === "prensa" ? { ...item, p: { ...item.p, name: "da carla" } } : item,
      )
      const forjados: ItemRelatado[] = [
        // A foundation of hers, ahead of Ana's.
        daCarla({ t: "room.created", name: "lagar", createdAt: 0 }),
        // And she makes herself an administrator.
        daCarla({ t: "role.assign", subject: fonte.eu.address, roles: ["admin"], assignedAt: Date.now() }),
        // A role in Ana's name, signed by Carla's device.
        { s: -1, a: ana!.address, p: assinar({ t: "role.assign", subject: fonte.eu.address, roles: ["admin"], assignedAt: Date.now() }, ana!.address) },
        // What she can already do: a room she signed.
        daCarla({ t: "channel.meta", room: "lagar-da-carla", name: "lagar da carla", kind: "text", position: 9, updatedAt: Date.now() }),
      ]
      const partido = partirRetrato(canal, [...forjados, ...itens].map((item) => ({ item })), montado.retrato.geradoEm)
      return { ...partido, completo: montado.completo }
    }

    const relatos: string[] = []
    dario!.session.on("status", (evento) => {
      if (evento.code === "retrato-aplicado") relatos.push(evento.detail)
    })
    const fotografia = primeiroChannels(dario!, canal, bruno!.address)
    await dario!.session.redeemInvite(link)
    const vista = await fotografia

    // Each lie falls by its guard, and none by her signature (Carla's are valid):
    // the extra foundation, the role she gave herself (`#mandaEm`), the role in Ana's name (the device isn't
    // hers), and Ana's room with the name changed (Ana's signature doesn't verify).
    expect(relatos).toHaveLength(1)
    expect(relatos[0]).toContain("fundador 1")
    expect(relatos[0]).toContain("manda-em 1")
    expect(relatos[0]).toContain("aparelho 1")
    expect(relatos[0]).toContain("autoria 1")

    // The foundation is Ana's: Carla's comes extra, and sheet 0 is Ana's.
    expect(vista.fundador).toBe(ana!.address)
    // The role she gave herself doesn't stick, nor the one she put in Ana's mouth.
    expect(dario!.session.rolesFor(canal, carla!.address)).toEqual(["porteiro"])
    expect(dario!.session.mayManageRoles(canal)).toBe(false)
    // The swapped room doesn't verify: it stays gone, and never with the fake name.
    expect(dario!.session.roomsOf(canal).map((sala) => sala.name)).not.toContain("da carla")
    // The rest comes through: the other rooms, the categories, the name, Bruno's role.
    expect(vista.salas).toEqual(expect.arrayContaining(["debulha", "tonel"]))
    expect(vista.categorias).toEqual(["Adega", "Eira"])
    expect(vista.nome).toBe("Lagar")
    expect(vista.cargosDoBruno).toEqual(["porteiro"])
    // And the room Carla signed is worth what a `channel.meta` from her is worth today.
    expect(vista.salas).toContain("lagar da carla")
  }, 120_000)

  it("(b2) o que o mentiroso ainda consegue, e é o que já conseguia ao vivo: omitir a fundação verdadeira e meter a sua", async () => {
    const [ana, bruno, carla, dario] = await contas("Ana", "Bruno", "Carla", "Dário")
    const canal = await lagarArrumado(ana!, [bruno!, carla!], [bruno!, carla!])
    const link = await carla!.session.createInvite(canal)
    ana!.session.disconnect()
    bruno!.session.disconnect()

    forjar.quem = carla!.address
    forjar.mexer = (montado, fonte) => {
      const p = Payload.parse({ t: "room.created", name: "lagar", createdAt: 0 }) as Record<string, unknown>
      const fundacao: ItemRelatado = {
        s: -1,
        a: fonte.eu.address,
        p: { ...p, autoria: assinarAutoria({ canal, autor: fonte.eu.address, payload: p, aparelho: fonte.eu.aparelho, assinar: fonte.eu.assinar }) },
      }
      const semAVerdadeira = montado.retrato.itens.filter((item) => item.p["t"] !== "room.created")
      const partido = partirRetrato(canal, [fundacao, ...semAVerdadeira].map((item) => ({ item })), montado.retrato.geradoEm)
      return { ...partido, completo: montado.completo }
    }
    await dario!.session.redeemInvite(link)
    await ate(() => dario!.session.channels.includes(canal), "o Dário entra")
    // She looks like a founder in Dario's eyes, the way she would today with a `room.created` of hers in the feed
    // before someone with a role comes online: the first one wins, and there's no proof of who created the group.
    expect(dario!.session.founderOf(canal)).toBe(carla!.address)
    // And what was Ana's stops passing in Dario's `#mandaEm`: Ana's roles fall.
    expect(dario!.session.rolesFor(canal, bruno!.address)).toEqual([])
    // Other members don't change: their founder is still Ana.
    expect(carla!.session.founderOf(canal)).toBe(ana!.address)
  }, 120_000)

  it("(c) o principal senta o telemóvel com os amigos desligados, e o telemóvel tem os nomes e os retratos com autoria", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    await bruno!.session.updateProfile({ displayName: "Bruno", statusText: "a ler", donations: [], avatarDataUrl: RETRATO_DO_PERFIL })
    const canal = await lagarArrumado(ana!, [bruno!], [bruno!])
    await ate(
      () => ana!.vault.contents.directory[bruno!.address]?.payload["avatar"] !== undefined,
      "a Ana tem o retrato do Bruno",
      30_000,
    )
    bruno!.session.disconnect()

    const telemovel = await emparelharAparelho(ana!)
    abertas.push(telemovel)
    telemovel.session.antiEntropiaLigada = false
    // What the phone knows when the channel appears: before 1.1, Bruno's name
    // told by the primary (`partial`, without frame) and nothing else.
    expect(telemovel.session.channels).not.toContain(canal)
    const naEntrada = new Promise<{ perfil: unknown; parcial: unknown; salas: string[]; fundador: string | null }>((resolve) => {
      const desligar = telemovel.session.on("channels", ({ channels }) => {
        if (!channels.includes(canal)) return
        desligar()
        const guardado = telemovel.vault.contents.directory[bruno!.address]
        resolve({
          perfil: structuredClone(guardado?.payload),
          parcial: guardado?.parcial,
          salas: telemovel.session.roomsOf(canal).map((sala) => sala.name),
          fundador: telemovel.session.founderOf(canal),
        })
      })
    })
    const vista = await naEntrada
    const perfil = vista.perfil as Record<string, unknown> | undefined
    expect(perfil?.["displayName"]).toBe("Bruno")
    expect(perfil?.["autoria"]).toBeDefined()
    expect(vista.parcial).toBeUndefined()
    expect((perfil?.["avatar"] as { inline?: string } | undefined)?.inline).toBe(RETRATO_DO_PERFIL)
    expect(vista.salas).toEqual(expect.arrayContaining(SALAS))
    expect(vista.fundador).toBe(ana!.address)
  }, 180_000)
})
