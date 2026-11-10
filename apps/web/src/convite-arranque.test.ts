// @vitest-environment node
//
// `node`, like `pwa.test.ts`: nothing here needs a DOM (the environment is injected), and under
// jsdom `import.meta.url` stops being a `file:`.
import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import {
  CHAVE_DO_AMIGO,
  CHAVE_DO_CONVITE,
  CHAVE_DO_EMPARELHAMENTO,
  lerAmigoDeArranque,
  lerConviteDeArranque,
  lerEmparelhamentoDeArranque,
  type AmbienteDoArranque,
} from "./convite-arranque.js"

/**
 * Startup via invite link.
 *
 * What gets locked here is the order: the address is ALWAYS cleared when the page opens at
 * `/app/convite`, whether the link is good or not, and cleared before anything else happens.
 * The code is a bearer secret; what stays in the bar stays in history and goes in tab sync.
 */

const CODIGO = "AbCdEfGhIjKlMnOpQrStUvWxYz012345"
const CANAL = "!geral:orwell.pt"
const BOM = `https://orwell.pt/app/convite#${encodeURIComponent(CANAL)}/${CODIGO}`

class Armazem {
  readonly dados = new Map<string, string>()
  getItem(chave: string): string | null {
    return this.dados.get(chave) ?? null
  }
  setItem(chave: string, valor: string): void {
    this.dados.set(chave, valor)
  }
  removeItem(chave: string): void {
    this.dados.delete(chave)
  }
}

function ambiente(href: string, storage: AmbienteDoArranque["storage"] = new Armazem()) {
  const replaceState = vi.fn()
  const url = new URL(href)
  return {
    replaceState,
    storage,
    ambiente: { location: { href, pathname: url.pathname }, history: { replaceState }, storage, base: "/app/" },
  }
}

describe("lerConviteDeArranque", () => {
  it("lê o convite, limpa o endereço para a base, e guarda-o no separador", () => {
    const { ambiente: a, replaceState, storage } = ambiente(BOM)
    const lido = lerConviteDeArranque(a)

    expect(lido.invite).toEqual({ server: "orwell.pt", channel: CANAL, code: CODIGO })
    expect(lido.invalid).toBe(false)
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/app/")
    expect(JSON.parse((storage as Armazem).getItem(CHAVE_DO_CONVITE) ?? "null")).toEqual(lido.invite)
  })

  it("o endereço limpa-se ANTES de se guardar seja o que for", () => {
    const ordem: string[] = []
    const storage = new Armazem()
    const guardar = storage.setItem.bind(storage)
    storage.setItem = (chave, valor) => {
      ordem.push("guardar")
      guardar(chave, valor)
    }
    const { ambiente: a, replaceState } = ambiente(BOM, storage)
    replaceState.mockImplementation(() => ordem.push("limpar"))
    lerConviteDeArranque(a)
    expect(ordem).toEqual(["limpar", "guardar"])
  })

  it.each([
    ["sem fragmento", "https://orwell.pt/app/convite"],
    ["fragmento a meio", `https://orwell.pt/app/convite#${encodeURIComponent(CANAL)}`],
    ["código na query", `https://orwell.pt/app/convite?k=${CODIGO}#${encodeURIComponent(CANAL)}/${CODIGO}`],
  ])("um link estragado (%s) também sai da barra, e não fica nada à espera", (_nome, href) => {
    const storage = new Armazem()
    storage.setItem(CHAVE_DO_CONVITE, JSON.stringify({ server: "orwell.pt", channel: "!velho:orwell.pt", code: "velho" }))
    const { ambiente: a, replaceState } = ambiente(href, storage)
    const lido = lerConviteDeArranque(a)

    expect(lido).toMatchObject({ invite: null, invalid: true })
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/app/")
    expect(storage.getItem(CHAVE_DO_CONVITE)).toBeNull()
  })

  it("fora de /app/convite não toca no endereço, e devolve o que o separador guardou", () => {
    const storage = new Armazem()
    const guardado = { server: "orwell.pt", channel: CANAL, code: CODIGO }
    storage.setItem(CHAVE_DO_CONVITE, JSON.stringify(guardado))
    // An invite-looking fragment in a path that is not its own is not an invite.
    const { ambiente: a, replaceState } = ambiente(`https://orwell.pt/app/#${encodeURIComponent("!x:y")}/outro`, storage)
    const lido = lerConviteDeArranque(a)

    expect(replaceState).not.toHaveBeenCalled()
    expect(lido).toMatchObject({ invite: guardado, invalid: false })
  })

  it("o que está guardado e não tem a forma certa deita-se fora", () => {
    for (const lixo of ["{", "null", "[]", JSON.stringify({ server: "orwell.pt", channel: CANAL }), JSON.stringify({ server: 1, channel: 2, code: 3 })]) {
      const storage = new Armazem()
      storage.setItem(CHAVE_DO_CONVITE, lixo)
      const { ambiente: a } = ambiente("https://orwell.pt/app/", storage)
      expect(lerConviteDeArranque(a).invite, lixo).toBeNull()
      expect(storage.getItem(CHAVE_DO_CONVITE), lixo).toBeNull()
    }
  })

  it("`forget` apaga o que ficou guardado", () => {
    const { ambiente: a, storage } = ambiente(BOM)
    const lido = lerConviteDeArranque(a)
    expect((storage as Armazem).getItem(CHAVE_DO_CONVITE)).not.toBeNull()
    lido.forget()
    expect((storage as Armazem).getItem(CHAVE_DO_CONVITE)).toBeNull()
  })

  it("sem armazenamento, ou com um que atira, o convite fica em memória e nada rebenta", () => {
    const semNada = ambiente(BOM, null)
    expect(lerConviteDeArranque(semNada.ambiente).invite?.code).toBe(CODIGO)
    expect(semNada.replaceState).toHaveBeenCalledOnce()

    const queAtira = {
      getItem: () => {
        throw new Error("bloqueado")
      },
      setItem: () => {
        throw new Error("bloqueado")
      },
      removeItem: () => {
        throw new Error("bloqueado")
      },
    }
    const comAtirador = ambiente(BOM, queAtira)
    const lido = lerConviteDeArranque(comAtirador.ambiente)
    expect(lido.invite?.code).toBe(CODIGO)
    expect(() => lido.forget()).not.toThrow()
    expect(lerConviteDeArranque(ambiente("https://orwell.pt/app/", queAtira).ambiente).invite).toBeNull()
  })

  it("um `history` que atira não leva a aplicação atrás: o convite lê-se na mesma", () => {
    const { ambiente: a, replaceState, storage } = ambiente(BOM)
    replaceState.mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError")
    })
    let lido: ReturnType<typeof lerConviteDeArranque> | undefined
    expect(() => (lido = lerConviteDeArranque(a))).not.toThrow()
    expect(replaceState).toHaveBeenCalledOnce()
    expect(lido?.invite?.code).toBe(CODIGO)
    expect((storage as Armazem).getItem(CHAVE_DO_CONVITE)).not.toBeNull()
  })

  it("o servidor de desenvolvimento, em http, também abre", () => {
    const href = `http://localhost:8452/app/convite#${encodeURIComponent("!a:localhost:8452")}/${CODIGO}`
    expect(lerConviteDeArranque(ambiente(href).ambiente).invite).toEqual({
      server: "localhost:8452",
      channel: "!a:localhost:8452",
      code: CODIGO,
    })
  })
})

describe('lerConviteDeArranque e a ligação curta (1.0 "Arca", fatia 5b-2)', () => {
  const CURTA = "https://orwell.pt/c#ab23cd45.0123456789abcdef"
  // The `/c#…` that gets copied arrives here via Caddy's redirect.
  const ABERTA = "https://orwell.pt/app/c#ab23cd45.0123456789abcdef"

  it("lê /app/c#<curto>.<código>, limpa o endereço, e guarda a curta no separador", () => {
    const { ambiente: a, replaceState, storage } = ambiente(ABERTA)
    const lido = lerConviteDeArranque(a)

    expect(lido).toMatchObject({ invite: null, curta: CURTA, invalid: false })
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/app/")
    expect(JSON.parse((storage as Armazem).getItem(CHAVE_DO_CONVITE) ?? "null")).toEqual({ curta: CURTA })
  })

  it("o endereço limpa-se ANTES de se guardar a curta", () => {
    const ordem: string[] = []
    const storage = new Armazem()
    const guardar = storage.setItem.bind(storage)
    storage.setItem = (chave, valor) => {
      ordem.push("guardar")
      guardar(chave, valor)
    }
    const { ambiente: a, replaceState } = ambiente(ABERTA, storage)
    replaceState.mockImplementation(() => ordem.push("limpar"))
    lerConviteDeArranque(a)
    expect(ordem).toEqual(["limpar", "guardar"])
  })

  it("depois de recarregar, a curta guardada volta", () => {
    const storage = new Armazem()
    storage.setItem(CHAVE_DO_CONVITE, JSON.stringify({ curta: CURTA }))
    const { ambiente: a, replaceState } = ambiente("https://orwell.pt/app/", storage)
    expect(lerConviteDeArranque(a)).toMatchObject({ invite: null, curta: CURTA, invalid: false })
    expect(replaceState).not.toHaveBeenCalled()
  })

  it("uma curta guardada que já não é uma curta deita-se fora", () => {
    const storage = new Armazem()
    storage.setItem(CHAVE_DO_CONVITE, JSON.stringify({ curta: "https://orwell.pt/c#ab23cd45" }))
    const { ambiente: a } = ambiente("https://orwell.pt/app/", storage)
    expect(lerConviteDeArranque(a)).toMatchObject({ invite: null, curta: null })
    expect(storage.getItem(CHAVE_DO_CONVITE)).toBeNull()
  })

  it("uma curta estragada limpa o endereço na mesma, não guarda nada, e diz que não se leu", () => {
    for (const ma of [
      "https://orwell.pt/app/c#ab23cd45", // just the short code: not enough for the proof
      "https://orwell.pt/app/c#ab23cd45.0123456789abcdel", // l outside the alphabet
      "https://orwell.pt/app/c?x=1#ab23cd45.0123456789abcdef",
    ]) {
      const storage = new Armazem()
      storage.setItem(CHAVE_DO_CONVITE, JSON.stringify({ curta: CURTA }))
      const { ambiente: a, replaceState } = ambiente(ma, storage)
      expect(lerConviteDeArranque(a), ma).toMatchObject({ invite: null, curta: null, invalid: true })
      expect(replaceState, ma).toHaveBeenCalledOnce()
      expect(storage.getItem(CHAVE_DO_CONVITE), ma).toBeNull()
    }
  })

  it("a longa continua a valer, e uma substitui a outra no separador", () => {
    const storage = new Armazem()
    lerConviteDeArranque(ambiente(ABERTA, storage).ambiente)
    const longa = lerConviteDeArranque(ambiente(BOM, storage).ambiente)
    expect(longa).toMatchObject({ invite: { server: "orwell.pt", channel: CANAL, code: CODIGO }, curta: null })
    expect(JSON.parse(storage.getItem(CHAVE_DO_CONVITE) ?? "null")).toEqual(longa.invite)
  })
})

/**
 * Startup via pairing link, by the same rules: clear ALWAYS when the page opens at `/app/emparelhar`,
 * before looking, and keep the whole link in the tab. Only the web does this: a computer does not
 * join via link, it shows the QR.
 */
describe("lerEmparelhamentoDeArranque", () => {
  const SEGREDO = "6gzjKC5Y-jxiXv_ZLoIzYX6ZL4PeZ24HirzSb__z6VY"
  const LINK = `https://orwell.pt/app/emparelhar#${SEGREDO}`

  it("lê o link, limpa o endereço para a base, e guarda o link no separador", () => {
    const { ambiente: amb, replaceState, storage } = ambiente(LINK)
    const lido = lerEmparelhamentoDeArranque(amb)
    expect(lido.link).toBe(LINK)
    expect(lido.invalid).toBe(false)
    expect(replaceState).toHaveBeenCalledWith(null, "", "/app/")
    expect((storage as Armazem).dados.get(CHAVE_DO_EMPARELHAMENTO)).toBe(LINK)
    lido.forget()
    expect((storage as Armazem).dados.has(CHAVE_DO_EMPARELHAMENTO)).toBe(false)
  })

  it("um link que não se deixa ler limpa o endereço na mesma e não guarda nada", () => {
    const { ambiente: amb, replaceState, storage } = ambiente(`https://orwell.pt/app/emparelhar?s=${SEGREDO}`)
    const lido = lerEmparelhamentoDeArranque(amb)
    expect(replaceState).toHaveBeenCalledTimes(1)
    expect(lido.link).toBeNull()
    expect(lido.invalid).toBe(true)
    expect((storage as Armazem).dados.has(CHAVE_DO_EMPARELHAMENTO)).toBe(false)
  })

  it("fora de /app/emparelhar não toca no endereço, e devolve o que o separador guardou se ainda for um link", () => {
    const storage = new Armazem()
    storage.setItem(CHAVE_DO_EMPARELHAMENTO, LINK)
    const { ambiente: amb, replaceState } = ambiente("https://orwell.pt/app/", storage)
    expect(lerEmparelhamentoDeArranque(amb).link).toBe(LINK)
    expect(replaceState).not.toHaveBeenCalled()
    storage.setItem(CHAVE_DO_EMPARELHAMENTO, "lixo")
    expect(lerEmparelhamentoDeArranque(amb).link).toBeNull()
    expect(storage.dados.has(CHAVE_DO_EMPARELHAMENTO)).toBe(false)
  })

  it("o convite e o emparelhamento não se pisam: cada caminho lê o seu", () => {
    const { ambiente: amb } = ambiente(LINK)
    expect(lerConviteDeArranque(amb).invite).toBeNull()
    expect(lerConviteDeArranque(amb).invalid).toBe(false)
    const { ambiente: amb2 } = ambiente(BOM)
    expect(lerEmparelhamentoDeArranque(amb2).link).toBeNull()
    expect(lerEmparelhamentoDeArranque(amb2).invalid).toBe(false)
  })
})

/**
 * The friend link (phase 4 of the friends plan). There is no secret, and the three steps are the same:
 * read, clear the bar, keep the ADDRESS in the tab.
 */
describe("lerAmigoDeArranque", () => {
  const ELA = "@lux-ignis-terra-mare:orwell.pt"
  const LINK = `https://orwell.pt/app/amigo#${ELA}`

  it("lê o endereço, limpa a barra para a base, e guarda o endereço no separador", () => {
    const { ambiente: amb, replaceState, storage } = ambiente(LINK)
    const lido = lerAmigoDeArranque(amb)
    expect(lido.address).toBe(ELA)
    expect(lido.invalid).toBe(false)
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/app/")
    expect((storage as Armazem).dados.get(CHAVE_DO_AMIGO)).toBe(ELA)
    lido.forget()
    expect((storage as Armazem).dados.has(CHAVE_DO_AMIGO)).toBe(false)
  })

  it("o endereço escapado também se lê", () => {
    const { ambiente: amb } = ambiente(`https://orwell.pt/app/amigo#${encodeURIComponent(ELA)}`)
    expect(lerAmigoDeArranque(amb).address).toBe(ELA)
  })

  it("a barra limpa-se ANTES de se guardar seja o que for", () => {
    const ordem: string[] = []
    const storage = new Armazem()
    const guardar = storage.setItem.bind(storage)
    storage.setItem = (chave, valor) => {
      ordem.push("guardar")
      guardar(chave, valor)
    }
    const { ambiente: amb, replaceState } = ambiente(LINK, storage)
    replaceState.mockImplementation(() => ordem.push("limpar"))
    lerAmigoDeArranque(amb)
    expect(ordem).toEqual(["limpar", "guardar"])
  })

  it.each([
    ["sem fragmento", "https://orwell.pt/app/amigo"],
    ["um canal e não uma conta", "https://orwell.pt/app/amigo#!geral:orwell.pt"],
    ["endereço na query", `https://orwell.pt/app/amigo?a=${ELA}#${ELA}`],
    ["http fora do loopback", `http://orwell.pt/app/amigo#${ELA}`],
  ])("um link estragado (%s) também sai da barra, e não fica nada à espera", (_nome, href) => {
    const { ambiente: amb, replaceState, storage } = ambiente(href)
    const lido = lerAmigoDeArranque(amb)
    expect(replaceState).toHaveBeenCalledTimes(1)
    expect(lido.address).toBeNull()
    expect(lido.invalid).toBe(true)
    expect((storage as Armazem).dados.has(CHAVE_DO_AMIGO)).toBe(false)
  })

  it("fora de /app/amigo não toca na barra, e devolve o que o separador guardou se ainda for um endereço", () => {
    const storage = new Armazem()
    storage.setItem(CHAVE_DO_AMIGO, ELA)
    const { ambiente: amb, replaceState } = ambiente("https://orwell.pt/app/", storage)
    expect(lerAmigoDeArranque(amb).address).toBe(ELA)
    expect(replaceState).not.toHaveBeenCalled()
    storage.setItem(CHAVE_DO_AMIGO, "lixo")
    expect(lerAmigoDeArranque(amb).address).toBeNull()
    expect(storage.dados.has(CHAVE_DO_AMIGO)).toBe(false)
  })

  it("sem armazenamento, ou com um que atira, e com um `history` que atira, nada rebenta", () => {
    const atira = {
      getItem: () => {
        throw new Error("bloqueado")
      },
      setItem: () => {
        throw new Error("bloqueado")
      },
      removeItem: () => {
        throw new Error("bloqueado")
      },
    }
    const { ambiente: amb, replaceState } = ambiente(LINK, atira)
    replaceState.mockImplementation(() => {
      throw new Error("SecurityError")
    })
    expect(lerAmigoDeArranque(amb).address).toBe(ELA)
    const { ambiente: semNada } = ambiente(LINK, null)
    expect(lerAmigoDeArranque(semNada).address).toBe(ELA)
  })

  it("a ligação curta da 1.0 (/app/a#<id>, depois do redireccionamento de /a) lê-se, limpa-se e guarda o endereço", () => {
    const { ambiente: amb, replaceState, storage } = ambiente("https://orwell.pt/app/a#lux-ignis-terra-mare")
    const lido = lerAmigoDeArranque(amb)
    expect(lido.address).toBe(ELA)
    expect(lido.invalid).toBe(false)
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/app/")
    expect((storage as Armazem).dados.get(CHAVE_DO_AMIGO)).toBe(ELA)
  })

  it("a curta de uma conta de outro servidor (<id>@<servidor>) dá o endereço de lá", () => {
    const { ambiente: amb } = ambiente("https://orwell.pt/app/a#rui@outro.pt")
    expect(lerAmigoDeArranque(amb).address).toBe("@rui:outro.pt")
  })

  it.each([
    ["sem fragmento", "https://orwell.pt/app/a"],
    ["a forma longa no caminho curto", `https://orwell.pt/app/a#${ELA}`],
    ["com query", "https://orwell.pt/app/a?x=1#lux"],
  ])("uma curta estragada (%s) sai da barra e dá o aviso", (_nome, href) => {
    const { ambiente: amb, replaceState, storage } = ambiente(href)
    const lido = lerAmigoDeArranque(amb)
    expect(replaceState).toHaveBeenCalledTimes(1)
    expect(lido.address).toBeNull()
    expect(lido.invalid).toBe(true)
    expect((storage as Armazem).dados.has(CHAVE_DO_AMIGO)).toBe(false)
  })

  it("o amigo, o convite e o emparelhamento não se pisam: cada caminho lê o seu", () => {
    const { ambiente: amb } = ambiente(LINK)
    expect(lerConviteDeArranque(amb).invite).toBeNull()
    expect(lerEmparelhamentoDeArranque(amb).link).toBeNull()
    const { ambiente: amb2 } = ambiente(BOM)
    expect(lerAmigoDeArranque(amb2).address).toBeNull()
    expect(lerAmigoDeArranque(amb2).invalid).toBe(false)
  })
})

describe("o main.tsx", () => {
  /*
    The function above could be perfect and the secret still stay in the bar if `main.tsx` calls it
    late. Read the file: the invite read must come before any other instruction that does anything,
    and with no `await`.
  */
  it("lê o convite antes de tudo o resto, e entrega-o à App", () => {
    const fonte = readFileSync(new URL("./main.tsx", import.meta.url), "utf8")
    const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    const instrucoes = semComentarios
      .split("\n")
      .map((linha) => linha.trim())
      .filter((linha) => linha && !linha.startsWith("import "))

    expect(instrucoes[0]).toBe("const conviteDeArranque = lerConviteDeArranque({")
    expect(semComentarios).not.toMatch(/\bawait\b/)
    expect(semComentarios).toContain("startupInvite={conviteDeArranque}")
    // And pairing right after, by the same path.
    expect(instrucoes[1]?.startsWith("location:")).toBe(true)
    expect(semComentarios).toContain("const emparelhamentoDeArranque = lerEmparelhamentoDeArranque({")
    expect(semComentarios).toContain("startupPairing={emparelhamentoDeArranque}")
    // And the friend, by the same path, before the first frame.
    expect(semComentarios).toContain("const amigoDeArranque = lerAmigoDeArranque({")
    expect(semComentarios).toMatch(/startupFriend[:=]\s*\{?\s*amigoDeArranque/)
  })
})
