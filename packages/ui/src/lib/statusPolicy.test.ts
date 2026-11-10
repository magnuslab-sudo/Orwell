import { describe, expect, it } from "vitest"
import {
  COALESCE_MS,
  QUIET_WINDOW_MS,
  fraseDoStatus,
  routeStatus,
  type RoutingContext,
  type SessionStatus,
} from "./statusPolicy.js"
import { strings } from "../strings.js"
import { moradaDeTeste } from "../../testes/moradas.js"

const [MURAL_A, MURAL_B, MURAL_C, MURAL_D] = ["a", "b", "c", "d"].map((dono) => moradaDeTeste(`mural ${dono}`, "x"))

const at = (now: number, connectedAt = 0, lastToastAt = new Map<string, number>()): RoutingContext => ({
  now,
  connectedAt,
  lastToastAt,
})

describe("routeStatus", () => {
  it("mecânica interna não interrompe ninguém", () => {
    const mechanics: SessionStatus[] = [
      { detail: "entrou em !geral:x", level: "info", code: "channel-joined", route: "log" },
      { detail: "chaves renovadas", level: "info", code: "channel-readopted", route: "log" },
      { detail: "convite expirou", level: "info", code: "welcome-dead", route: "log" },
      { detail: "perdeu o acesso", level: "info", code: "channel-deaf", route: "log" },
      { detail: "bad-frame: unparseable", level: "error", code: "server-error", route: "log" },
      { detail: "evento 12 ignorado", level: "error", code: "event-failed", route: "log" },
    ]
    for (const status of mechanics) {
      expect(routeStatus(status, at(1_000_000)).target).toBe("log")
    }
  })

  it("um erro accionável interrompe, mesmo durante o arranque", () => {
    // The startup burst is exactly when "part of this account cannot be read
    // on this device" happens — silencing it would be the opposite mistake.
    const decision = routeStatus(
      { detail: "2 canal(is) com estado ilegível", level: "error", code: "channels-unreadable", route: "toast" },
      at(1_000, 900),
    )
    expect(decision).toMatchObject({ target: "toast", level: "error" })
  })

  it("o resultado de um pedido feito agora interrompe", () => {
    const decision = routeStatus(
      { detail: "Esse convite expirou.", level: "error", code: "invite-rejected", route: "toast" },
      at(1_000_000, 100),
    )
    expect(decision.target).toBe("toast")
  })

  it("cala informação nos primeiros segundos depois de ligar", () => {
    const status: SessionStatus = { detail: "tudo certo", level: "info", code: "something", route: "toast" }
    expect(routeStatus(status, at(100_000, 100_000 - QUIET_WINDOW_MS + 1))).toEqual({
      target: "log",
      reason: "quiet-window",
    })
    // Past the window the same event is allowed through.
    expect(routeStatus(status, at(100_000, 100_000 - QUIET_WINDOW_MS - 1)).target).toBe("toast")
  })

  it("erros do servidor calam-se durante o arranque e falam depois", () => {
    const status: SessionStatus = { detail: "internal", level: "error", code: "server-error", route: "toast" }
    expect(routeStatus(status, at(1_000, 900)).target).toBe("log")
    expect(routeStatus(status, at(100_000, 900)).target).toBe("toast")
  })

  it("o mesmo tipo de evento só interrompe uma vez por janela", () => {
    const seen = new Map<string, number>([["channel-forked", 99_000]])
    const status: SessionStatus = { detail: "!a: recriado", level: "error", code: "channel-forked", route: "toast" }
    expect(routeStatus(status, at(99_000 + COALESCE_MS - 1, 0, seen))).toEqual({
      target: "log",
      reason: "coalesced",
    })
    expect(routeStatus(status, at(99_000 + COALESCE_MS + 1, 0, seen)).target).toBe("toast")
  })

  it("eventos que dizem respeito a uma pessoa vão para o sino", () => {
    const decision = routeStatus(
      {
        detail: "@abc:x entrou por convite",
        level: "info",
        code: "member-joined",
        route: "notice",
        channel: "!geral:x",
        actor: "@abc:x",
      },
      at(1_000_000),
    )
    expect(decision).toEqual({
      target: "notice",
      detail: "@abc:x entrou por convite",
      code: "member-joined",
      channel: "!geral:x",
      actor: "@abc:x",
    })
  })

  it("sem rota da origem, a gravidade decide — e um erro continua a aparecer", () => {
    expect(routeStatus({ detail: "algo antigo", level: "error" }, at(1_000_000)).target).toBe("toast")
    expect(routeStatus({ detail: "algo antigo", level: "info" }, at(1_000_000)).target).toBe("log")
  })

  it("o arranque real de uma conta carregada não produz um único toast", () => {
    // The sequence a person with rooms, friendships and pending welcomes saw
    // when they logged in — every line of it a popup in the corner, before.
    const burst: SessionStatus[] = [
      { detail: "entrou em !geral:x", level: "info", code: "channel-joined", route: "log", channel: "!geral:x" },
      { detail: "entrou em !fotos:x", level: "info", code: "channel-joined", route: "log", channel: "!fotos:x" },
      { detail: `${MURAL_A}: ligação restabelecida`, level: "info", code: "channel-readopted", route: "log" },
      { detail: `Convite para ${MURAL_B} expirou.`, level: "info", code: "welcome-dead", route: "log" },
      { detail: `Convite para ${MURAL_C} expirou.`, level: "info", code: "welcome-dead", route: "log" },
      { detail: `${MURAL_D}: perdeu o acesso`, level: "info", code: "channel-deaf", route: "log" },
      { detail: "internal: frame handling failed", level: "error", code: "server-error", route: "log" },
      { detail: "Pedido enviado.", level: "info", code: "invite-sent", route: "log" },
    ]

    const context = at(2_000, 1_000)
    const targets = burst.map((status) => routeStatus(status, context).target)
    expect(targets.every((target) => target === "log")).toBe(true)
  })
})

describe("fraseDoStatus", () => {
  it("um canal largado diz-se na língua de quem lê, com o nome do canal", () => {
    expect(
      fraseDoStatus({ detail: "x", level: "info", code: "channel-removed", channel: "!lagar:s" }, () => "lagar"),
    ).toBe(strings.avisosDoNucleo.channelRemoved("lagar"))
  })

  it("um canal eliminado diz-se pelo código, com o nome que o núcleo leu antes de o esquecer", () => {
    expect(
      fraseDoStatus(
        { detail: "channel-deleted: lagar", level: "info", code: "channel-deleted", channel: "!lagar:s" },
        () => "!lagar:s",
      ),
    ).toBe(strings.avisosDoNucleo.channelDeleted("lagar"))
    expect(
      fraseDoStatus({ detail: "", level: "info", code: "channel-deleted", channel: "!lagar:s" }, () => "lagar"),
    ).toBe(strings.avisosDoNucleo.channelDeleted("lagar"))
  })

  it("um canal recriado nunca mostra a morada opaca: sem nome, a frase sai sem ele (Erro 349)", () => {
    const opaca = moradaDeTeste("mural-da-ana", "s")
    const curta = opaca.replace(/^!/, "").split(":")[0] ?? opaca
    const recriado = { detail: "x", level: "error" as const, code: "channel-forked", channel: opaca }
    for (const rotulo of [curta, opaca]) {
      const frase = fraseDoStatus(recriado, () => rotulo)
      expect(frase).toBe("Erro 349\nEste canal perdeu o estado e foi recriado. Convida outra vez quem lá estava.")
      expect(frase).not.toContain(curta)
    }
    // With name, the name.
    expect(fraseDoStatus(recriado, () => "celeiro")).toBe(
      'Erro 349\nO canal "celeiro" perdeu o estado e foi recriado. Convida outra vez quem lá estava.',
    )
  })

  it("um resgate recusado por ritmo diz-se com o código próprio, e não como convite que já não existe (Erro 365)", () => {
    expect(
      fraseDoStatus({ detail: "too many invite requests", level: "error", code: "invite-rejected", route: "toast" }, (c) => c),
    ).toBe("Erro 365\nDemasiados pedidos de entrada. Espera um minuto e tenta outra vez.")
  })

  it("um convite que já não abre tem frase própria", () => {
    expect(fraseDoStatus({ detail: "x", level: "info", code: "welcome-dead" }, (c) => c)).toBe(
      strings.avisosDoNucleo.welcomeDead,
    )
  })

  it("um código sem frase devolve nada, e fica o `detail` de sempre", () => {
    expect(fraseDoStatus({ detail: "x", level: "info", code: "outra-coisa" }, (c) => c)).toBeNull()
  })
})
