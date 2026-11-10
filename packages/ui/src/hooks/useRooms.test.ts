import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { EnclaveBridge } from "../bridge.js"
import type { ChatMessage } from "../types.js"
import { NOME_POR_OMISSAO, nomeDaSala, useRooms } from "./useRooms.js"

afterEach(cleanup)

const CANAL = "!orwell:orwell.pt"

function ponte(
  rooms: (() => ReturnType<NonNullable<EnclaveBridge["channels"]["rooms"]>>) | undefined,
  closed?: () => ReturnType<NonNullable<EnclaveBridge["channels"]["rooms"]>>,
  categories?: () => { category: string; position: number }[],
): EnclaveBridge {
  return {
    channels: {
      rooms: rooms ? () => rooms() : undefined,
      ...(closed ? { closedRooms: () => closed() } : {}),
      ...(categories ? { categories: () => categories() } : {}),
    },
  } as unknown as EnclaveBridge
}

function meta(payload: Record<string, unknown>): ChatMessage {
  return { channel: CANAL, seq: 1, sender: "@a:s", at: 1, payload } as unknown as ChatMessage
}

/**
 * The rooms in a channel, and what the interface needs to know about them.
 *
 * A channel with no rooms returns an empty list on purpose: the interface handles that
 * as it always has, with a single conversation, and that is what keeps channels before
 * this idea working without any migration.
 */
describe("useRooms", () => {
  it("um canal sem salas tem na mesma a sala por omissão", () => {
    // Where everything said before rooms existed lives. Without it, creating the
    // first room would make the existing conversation disappear from screen.
    const { result } = renderHook(() => useRooms(ponte(() => []), CANAL, []))
    expect(result.current.rooms.map((r) => r.room)).toEqual([""])
    expect(result.current.groups).toHaveLength(1)
  })

  it("agrupa por categoria, pela ordem em que as salas saem", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(() => [
          { room: "a", name: "Geral", category: "Conversa", kind: "text", position: 0 },
          { room: "b", name: "Aleatório", category: "Conversa", kind: "text", position: 1 },
          { room: "v", name: "Sala de estar", category: "Voz", kind: "voice", position: 0 },
        ]),
        CANAL,
        [],
      ),
    )
    // The first category is the empty one, where the default room lives.
    expect(result.current.groups.map((g) => g.category)).toEqual(["", "Conversa", "Voz"])
    expect(result.current.groups[1]?.rooms.map((r) => r.name)).toEqual(["Geral", "Aleatório"])
    expect(result.current.groups[2]?.rooms[0]?.kind).toBe("voice")
  })

  it("uma sala criada agora aparece sem esperar pela gravação", () => {
    const { result } = renderHook(() =>
      useRooms(ponte(() => []), CANAL, [meta({ t: "channel.meta", room: "n", name: "Nova", updatedAt: 5 })]),
    )
    expect(result.current.rooms.map((r) => r.name)).toEqual(["geral", "Nova"])
  })

  it("fechar uma sala tira-a da lista, e ela continua a saber-se", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(() => [{ room: "x", name: "Antiga", category: "", kind: "text", position: 0 }]),
        CANAL,
        [meta({ t: "channel.meta", room: "x", name: "Antiga", closed: true, updatedAt: 9 })],
      ),
    )
    expect(result.current.rooms.map((r) => r.room)).toEqual([""])
    // Hidden, not destroyed: without this list there would be no way to reopen it.
    expect(result.current.closed.map((r) => r.name)).toEqual(["Antiga"])
  })

  it("uma alteração antiga não derruba a que já lá está", () => {
    const { result } = renderHook(() =>
      useRooms(ponte(() => []), CANAL, [
        meta({ t: "channel.meta", room: "a", name: "Nome novo", updatedAt: 200 }),
        meta({ t: "channel.meta", room: "a", name: "Nome velho", updatedAt: 100 }),
      ]),
    )
    expect(result.current.rooms[1]?.name).toBe("Nome novo")
  })

  it("as salas fechadas do cofre chegam à interface", () => {
    // After restarting the app there are no messages in memory: if the
    // vault did not provide them, a closed room would stay closed forever.
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          () => [],
          () => [{ room: "arquivada", name: "2024", category: "", kind: "text", position: 0 }],
        ),
        CANAL,
        [],
      ),
    )
    expect(result.current.rooms.map((r) => r.room)).toEqual([""])
    expect(result.current.closed.map((r) => r.name)).toEqual(["2024"])
  })

  it("ignora salas de outro canal", () => {
    const doOutro = { ...meta({ t: "channel.meta", room: "z", name: "De outro", updatedAt: 1 }), channel: "!outro:s" }
    const { result } = renderHook(() => useRooms(ponte(() => []), CANAL, [doOutro as ChatMessage]))
    expect(result.current.rooms.map((r) => r.room)).toEqual([""])
  })
})

/**
 * The default room is no longer untouchable.
 *
 * It is the room with empty identifier, where everything said before
 * rooms existed lives. It can now have its own name and be closed, but
 * closed means hidden: what is there stays there, messages that arrive without
 * a room still have a place, and there is always a way to bring it back.
 */
describe("useRooms — a sala por omissão", () => {
  it("sem nada publicado chama-se geral e vem à cabeça", () => {
    const { result } = renderHook(() => useRooms(ponte(() => []), CANAL, []))
    expect(result.current.rooms[0]).toMatchObject({ room: "", name: "geral", category: "" })
  })

  it("aceita nome próprio, publicado como o das outras", () => {
    const { result } = renderHook(() =>
      useRooms(ponte(() => []), CANAL, [meta({ t: "channel.meta", room: "", name: "recepção", updatedAt: 3 })]),
    )
    expect(result.current.rooms.map((r) => r.name)).toEqual(["recepção"])
    // Only one, not two: the published name replaces the factory default instead of
    // adding to it.
    expect(result.current.rooms.filter((r) => r.room === "")).toHaveLength(1)
  })

  it("com categoria publicada arruma-se com as outras, sem lugar cativo", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(() => [{ room: "a", name: "avisos", category: "Início", kind: "text", position: 0 }]),
        CANAL,
        [meta({ t: "channel.meta", room: "", name: "recepção", category: "Início", position: 1, updatedAt: 4 })],
      ),
    )
    expect(result.current.groups.map((g) => g.category)).toEqual(["Início"])
    expect(result.current.groups[0]?.rooms.map((r) => r.name)).toEqual(["avisos", "recepção"])
  })

  it("fechada, sai da lista e fica onde se pode ir buscá-la", () => {
    const { result } = renderHook(() =>
      useRooms(ponte(() => []), CANAL, [
        meta({ t: "channel.meta", room: "", name: "geral", closed: true, updatedAt: 10 }),
      ]),
    )
    expect(result.current.rooms).toHaveLength(0)
    expect(result.current.closed.map((r) => r.room)).toEqual([""])
  })

  it("reabrir devolve-a, com o nome que tinha", () => {
    // The newest timestamp wins, like everything else: reopening is publishing
    // `closed: false` on top, not undoing anything.
    const { result } = renderHook(() =>
      useRooms(ponte(() => []), CANAL, [
        meta({ t: "channel.meta", room: "", name: "recepção", closed: true, updatedAt: 10 }),
        meta({ t: "channel.meta", room: "", name: "recepção", closed: false, updatedAt: 11 }),
      ]),
    )
    expect(result.current.rooms.map((r) => r.name)).toEqual(["recepção"])
    expect(result.current.closed).toHaveLength(0)
  })
})

/**
 * Delete a room: the tombstone, and the room no tombstone kills.
 *
 * The tombstone exists because silence does not propagate, stopping publishing the room
 * would let the previous `channel.meta`, stored in all vaults, resurrect it on
 * the next startup. That is why `removed` is something that gets SAID, with a timestamp
 * newer than what created it.
 */
describe("useRooms — salas eliminadas", () => {
  it("uma sala com lápide sai da lista, e não vai parar aos fechados", () => {
    const { result } = renderHook(() =>
      useRooms(ponte(() => [{ room: "r1", name: "avisos", category: "", kind: "text", position: 1 }]), CANAL, [
        meta({ t: "channel.meta", room: "r1", name: "avisos", closed: true, removed: true, updatedAt: 2 }),
      ]),
    )
    expect(result.current.rooms.map((r) => r.room)).not.toContain("r1")
    // "Deleted" is not "closed": it is not offered for reopening.
    expect(result.current.closed.map((r) => r.room)).not.toContain("r1")
  })

  it("uma lápide antiga não mata uma sala que voltou a ser publicada depois", () => {
    // The timestamp decides, like everything else in this file.
    const { result } = renderHook(() =>
      useRooms(ponte(() => []), CANAL, [
        meta({ t: "channel.meta", room: "r1", name: "avisos", removed: true, updatedAt: 1 }),
        meta({ t: "channel.meta", room: "r1", name: "avisos", updatedAt: 5 }),
      ]),
    )
    expect(result.current.rooms.map((r) => r.room)).toContain("r1")
  })

  /**
   * The invariant, and why it is checked HERE and not just in the core.
   *
   * The core refuses to publish this tombstone, but the core is ours. An altered
   * client from elsewhere can send it, and without this defense it would erase
   * from screen the only room that must not be missing: the one that holds
   * everything said before rooms existed, and where messages without a label fall, including
   * messages from deleted rooms.
   */
  it("a sala por omissão sobrevive a uma lápide vinda de fora", () => {
    const { result } = renderHook(() =>
      useRooms(ponte(() => []), CANAL, [
        meta({ t: "channel.meta", room: "", name: "geral", removed: true, updatedAt: 9 }),
      ]),
    )
    expect(result.current.rooms.map((r) => r.room)).toContain("")
  })
})

/**
 * Categories that exist with no rooms at all.
 *
 * The category is still mainly the name written in each room's `category` field.
 * The `channel.category` entry adds the only thing that field cannot say,  * that the category exists while empty, and that is what makes "create category"
 * and "create room" two separate gestures instead of one.
 */
describe("useRooms — categorias declaradas", () => {
  it("uma categoria declarada aparece vazia, à espera de salas", () => {
    const { result } = renderHook(() =>
      useRooms(ponte(() => [], undefined, () => [{ category: "Direcção", position: 10 }]), CANAL, []),
    )
    const direccao = result.current.groups.find((grupo) => grupo.category === "Direcção")
    expect(direccao).toBeTruthy()
    expect(direccao?.rooms).toEqual([])
  })

  it("a ordem declarada manda, e não a alfabética", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          () => [],
          undefined,
          () => [
            { category: "Zulu", position: 1 },
            { category: "Alfa", position: 2 },
          ],
        ),
        CANAL,
        [],
      ),
    )
    // The first is the empty one, where the default room lives; declared ones come
    // in the order they were given, not alphabetically.
    expect(result.current.groups.map((grupo) => grupo.category)).toEqual(["", "Zulu", "Alfa"])
  })

  it("as salas soltas ficam à cabeça, acima de qualquer categoria declarada", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          () => [{ room: "r1", name: "geral", category: "", kind: "text", position: 1 }],
          undefined,
          () => [{ category: "Direcção", position: 1 }],
        ),
        CANAL,
        [],
      ),
    )
    expect(result.current.groups[0]?.category).toBe("")
  })

  it("uma sala com o nome escrito enche a categoria declarada em vez de a duplicar", () => {
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          () => [{ room: "r1", name: "avisos", category: "Direcção", kind: "text", position: 1 }],
          undefined,
          () => [{ category: "Direcção", position: 1 }],
        ),
        CANAL,
        [],
      ),
    )
    const direccao = result.current.groups.filter((grupo) => grupo.category === "Direcção")
    expect(direccao).toHaveLength(1)
    expect(direccao[0]?.rooms.map((sala) => sala.room)).toEqual(["r1"])
  })

  it("retirar a declaração não apaga a categoria que tem salas a nomeá-la", () => {
    // What defines the category is the text that rooms carry. The
    // declaration only kept it alive when empty.
    const { result } = renderHook(() =>
      useRooms(
        ponte(
          () => [{ room: "r1", name: "avisos", category: "Direcção", kind: "text", position: 1 }],
          undefined,
          () => [{ category: "Direcção", position: 1 }],
        ),
        CANAL,
        [meta({ t: "channel.category", category: "Direcção", removed: true, updatedAt: 9 })],
      ),
    )
    expect(result.current.groups.map((grupo) => grupo.category)).toContain("Direcção")
  })

  it("declarada por mensagem, aparece sem se esperar pelo cofre", () => {
    const { result } = renderHook(() =>
      useRooms(ponte(() => []), CANAL, [
        meta({ t: "channel.category", category: "Direcção", position: 5, updatedAt: 3 }),
      ]),
    )
    expect(result.current.groups.map((grupo) => grupo.category)).toContain("Direcção")
  })
})

/**
 * The name of a room, so the call dock can say where it is from.
 *
 * The dock floats above any screen, and the call's channel often is not
 * the one being read, which is exactly when it appears. That is why the
 * lookup is a pure function over a room list, not a read of the open channel.
 */
describe("nomeDaSala", () => {
  const salas = [
    { room: "voz", name: "pátio", category: "", kind: "voice" as const, position: 1 },
    { room: "", name: "geral", category: "", kind: "text" as const, position: -1 },
  ]

  it("devolve o nome publicado da sala", () => {
    expect(nomeDaSala(salas, "voz")).toBe("pátio")
  })

  it("uma sala desconhecida não ganha nome inventado", () => {
    // A dock that invents a name sends someone looking for a room that does not
    // exist. With no name, it says only the channel, which stays true.
    expect(nomeDaSala(salas, "fantasma")).toBeUndefined()
  })

  it("a sala por omissão tem nome mesmo sem nada publicado", () => {
    // It is the one with empty identifier, and it always exists: see `SALA_POR_OMISSAO`.
    expect(nomeDaSala([], "")).toBe(NOME_POR_OMISSAO)
    // And the published name beats the factory default.
    expect(nomeDaSala([{ room: "", name: "praça", category: "", kind: "text", position: 0 }], "")).toBe("praça")
  })
})
