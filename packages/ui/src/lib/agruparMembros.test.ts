import { describe, expect, it } from "vitest"
import { agruparMembros, type CargoDoMembro } from "./agruparMembros.js"

/**
 * The member list for a channel, organized like a Discord server.
 *
 * Request from the owner on 10 September 2026: *"users on the right should be organized by
 * role. Online/offline, just like Discord"*. Today the list comes out in ADDRESS order,
 * which means nothing to anyone: a random string deciding who shows first.
 *
 * The rules that hold here, and why each one:
 *
 * - **Offline members go into a single block at the end, with no division by role.**
 *   A role is a responsibility over the channel, and the responsibility of someone offline
 *   is not being exercised; separating absent members by role would fill the list with
 *   headers for one person each. This is also what Discord does, and the owner asked for
 *   Discord.
 * - **Online members group by their highest role**, and only that one: a person shows once.
 *   The subtext still lists all their roles.
 * - **Alphabetical order within each group, by display name.** The address breaks ties, so
 *   order does not shift between two people with the same name.
 * - **Empty groups do not appear.** A "Moderator" header with nothing under it is a
 *   question without an answer for the reader.
 */

const CARGOS: Record<string, CargoDoMembro> = {
  "@fundadora:s": { label: "Fundadora", grupo: { id: "fundador", nome: "Fundadora", ordem: 0 } },
  "@admin:s": { label: "Administrador", grupo: { id: "admin", nome: "Administrador", ordem: 1 } },
  "@mod1:s": { label: "Moderador", grupo: { id: "mod", nome: "Moderador", ordem: 2, tint: "#7a85f5" } },
  "@mod2:s": { label: "Moderador, Anfitrião", grupo: { id: "mod", nome: "Moderador", ordem: 2, tint: "#7a85f5" } },
}

const NOMES: Record<string, string> = {
  "@fundadora:s": "Ana",
  "@admin:s": "Bruno",
  "@mod1:s": "Zulmira",
  "@mod2:s": "Carlos",
  "@sem:s": "Duarte",
  "@outro:s": "Eva",
}

function agrupar(members: string[], offline: string[] = []): ReturnType<typeof agruparMembros> {
  return agruparMembros(members, {
    online: (quem) => !offline.includes(quem),
    cargoDe: (quem) => CARGOS[quem] ?? null,
    nameFor: (quem) => NOMES[quem] ?? quem,
    titulos: { online: "Online", offline: "Offline" },
  })
}

describe("agrupar as pessoas de um canal", () => {
  it("põe os cargos por ordem, depois quem não tem, e o offline no fim", () => {
    const grupos = agrupar(["@sem:s", "@mod1:s", "@fundadora:s", "@admin:s"], ["@admin:s"])

    expect(grupos.map((grupo) => grupo.id)).toEqual(["fundador", "mod", "online", "offline"])
    expect(grupos.at(-1)?.membros).toEqual(["@admin:s"])
  })

  it("não divide o offline por cargo", () => {
    // The admin is offline: goes to the end block, alongside members with no role, and does not
    // open a header for just one person.
    const grupos = agrupar(["@admin:s", "@sem:s", "@mod1:s"], ["@admin:s", "@sem:s"])

    expect(grupos.map((grupo) => grupo.id)).toEqual(["mod", "offline"])
    // By name, not by role: Bruno (the admin) before Duarte (no role). Inside this block they
    // are all equal, which is what the block says.
    expect(grupos.at(-1)?.membros).toEqual(["@admin:s", "@sem:s"])
  })

  it("ordena cada grupo pelo nome que se vê, e não pelo endereço", () => {
    // `@mod1` is Zulmira and `@mod2` is Carlos: by address it would come out backwards.
    const grupos = agrupar(["@mod1:s", "@mod2:s"])

    expect(grupos[0]?.membros).toEqual(["@mod2:s", "@mod1:s"])
  })

  it("cada pessoa aparece uma vez, e não se perde ninguém", () => {
    const todos = ["@fundadora:s", "@admin:s", "@mod1:s", "@mod2:s", "@sem:s", "@outro:s"]
    const grupos = agrupar(todos, ["@outro:s", "@mod2:s"])

    const listados = grupos.flatMap((grupo) => grupo.membros)
    expect(listados.length).toBe(todos.length)
    expect(new Set(listados).size).toBe(todos.length)
  })

  it("não inventa grupos vazios", () => {
    const grupos = agrupar(["@sem:s"])

    expect(grupos.map((grupo) => grupo.id)).toEqual(["online"])
  })

  it("sem cargos nenhuns, só Online e Offline", () => {
    // This is the case of a private conversation, where nobody has authority over anyone.
    const grupos = agruparMembros(["@a:s", "@b:s"], {
      online: (quem) => quem === "@a:s",
      cargoDe: () => null,
      nameFor: (quem) => quem,
      titulos: { online: "Online", offline: "Offline" },
    })

    expect(grupos.map((grupo) => grupo.id)).toEqual(["online", "offline"])
  })

  it("leva o título e a cor do cargo para o cabeçalho", () => {
    const grupos = agrupar(["@mod1:s"])

    expect(grupos[0]?.titulo).toBe("Moderador")
    expect(grupos[0]?.tint).toBe("#7a85f5")
  })

  it("e os títulos de Online e Offline vêm de fora, para as línguas os poderem dar", () => {
    const grupos = agrupar(["@sem:s", "@outro:s"], ["@outro:s"])

    expect(grupos.map((grupo) => grupo.titulo)).toEqual(["Online", "Offline"])
  })
})
