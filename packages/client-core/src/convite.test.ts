import { readdirSync, readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { PAIR_SECRET_BYTES, toBase64 } from "@enclave/protocol"
import {
  FRIEND_PATH,
  formatInviteLink,
  formatPairLink,
  friendLink,
  INVITE_PATH,
  PAIR_PATH,
  parseFriendLink,
  parseInviteLink,
  parsePairLink,
  sameHomeserver,
} from "./session.js"
import { moradaDeTeste } from "../testes/moradas.js"

const MURAL_ABC123 = moradaDeTeste("mural abc123", "orwell.pt")
const DM_AAA_BBB = moradaDeTeste("directa aaa bbb", "orwell.pt")

/**
 * The invite link in both forms.
 *
 * What is locked here is a security rule, not a formatting preference: the
 * channel and code live in the FRAGMENT, which the browser never sends to the
 * server. A link with the code in the path or query has already delivered it to
 * whoever logs requests, and accepting it would teach that such links work.
 *
 * `createInvite` needs a live connection to mint; the link formatter is
 * `formatInviteLink`, pure code, and it is the one that does the round trip here.
 */

/** A code shaped like the real thing: 24 bytes, base64url, 32 characters. */
function codigo(semente = 7): string {
  return toBase64(new Uint8Array(24).map((_, i) => (i * 37 + semente) % 256))
}

const CANAIS = [
  "!geral:orwell.pt",
  MURAL_ABC123,
  DM_AAA_BBB,
  "!sala com espaços/e barra:orwell.pt",
  "!ação-çãõ#cardinal?e=query:orwell.pt",
  "!local:localhost:8452",
]

describe("formatInviteLink", () => {
  it("cunha https com caminho fixo, e tudo o que identifica vai depois do #", () => {
    const link = formatInviteLink("orwell.pt", "!geral:orwell.pt", codigo())
    expect(link).toBe(`https://orwell.pt/app/convite#${encodeURIComponent("!geral:orwell.pt")}/${codigo()}`)

    const url = new URL(link)
    expect(url.pathname).toBe(INVITE_PATH)
    expect(url.search).toBe("")
    // What the browser sends to the server is origin + path + query. The code and
    // channel cannot be there.
    const enviado = url.origin + url.pathname + url.search
    expect(enviado).not.toContain(codigo())
    expect(enviado).not.toContain("geral")
  })

  it("http só para o servidor de desenvolvimento local, pela mesma regra do gateway", () => {
    expect(formatInviteLink("localhost:8452", "!a:localhost:8452", "c")).toMatch(/^http:\/\/localhost:8452\/app\/convite#/)
    expect(formatInviteLink("127.0.0.1:8452", "!a:x", "c")).toMatch(/^http:\/\/127\.0\.0\.1:8452\//)
    expect(formatInviteLink("localhost.evil.pt", "!a:x", "c")).toMatch(/^https:\/\//)
    expect(formatInviteLink("orwell.pt", "!a:x", "c")).toMatch(/^https:\/\//)
  })

  it("o código verdadeiro nunca tem o separador do fragmento", () => {
    for (let semente = 0; semente < 256; semente++) {
      expect(codigo(semente)).toHaveLength(32)
      expect(codigo(semente)).not.toContain("/")
    }
  })
})

describe("parseInviteLink", () => {
  it.each(CANAIS)("ida e volta em https: %s", (canal) => {
    const servidor = canal.endsWith("localhost:8452") ? "localhost:8452" : "orwell.pt"
    const link = formatInviteLink(servidor, canal, codigo())
    expect(parseInviteLink(link)).toEqual({ server: servidor, channel: canal, code: codigo() })
    // And the channel, even with `/`, `#` or `?` inside it, stays in the fragment.
    const url = new URL(link)
    expect(url.pathname).toBe(INVITE_PATH)
    expect(url.search).toBe("")
  })

  it.each(CANAIS)("a forma antiga continua a valer, e dá o mesmo: %s", (canal) => {
    const antigo = `enclave://join/orwell.pt/${encodeURIComponent(canal)}#${codigo()}`
    const novo = formatInviteLink("orwell.pt", canal, codigo())
    expect(parseInviteLink(antigo)).toEqual({ server: "orwell.pt", channel: canal, code: codigo() })
    expect(parseInviteLink(antigo)).toEqual(parseInviteLink(novo))
  })

  it("tolera espaço à volta e maiúsculas no esquema e no host", () => {
    const link = `  HTTPS://Orwell.PT/app/convite#${encodeURIComponent("!geral:orwell.pt")}/${codigo()}\n`
    expect(parseInviteLink(link)).toEqual({ server: "orwell.pt", channel: "!geral:orwell.pt", code: codigo() })
  })

  it("recusa o código na query, mesmo com um fragmento válido ao lado", () => {
    const canal = encodeURIComponent("!geral:orwell.pt")
    expect(parseInviteLink(`https://orwell.pt/app/convite?code=${codigo()}#${canal}/${codigo()}`)).toBeNull()
    expect(parseInviteLink(`https://orwell.pt/app/convite?c=${canal}&k=${codigo()}`)).toBeNull()
    // An empty query too: the path is a literal, not a starting point.
    expect(parseInviteLink(`https://orwell.pt/app/convite?#${canal}/${codigo()}`)).toBeNull()
  })

  it("recusa o código ou o canal no caminho", () => {
    const canal = encodeURIComponent("!geral:orwell.pt")
    expect(parseInviteLink(`https://orwell.pt/app/convite/${canal}/${codigo()}`)).toBeNull()
    expect(parseInviteLink(`https://orwell.pt/app/convite/${canal}#${codigo()}`)).toBeNull()
    expect(parseInviteLink(`https://orwell.pt/app/convite/${codigo()}#${canal}/${codigo()}`)).toBeNull()
    expect(parseInviteLink(`https://orwell.pt/join/orwell.pt/${canal}#${codigo()}`)).toBeNull()
  })

  it("recusa outro caminho, mesmo parecido", () => {
    const resto = `#${encodeURIComponent("!geral:orwell.pt")}/${codigo()}`
    for (const caminho of ["", "/", "/app", "/app/", "/app/convite/", "/app/convites", "/convite", "/APP/CONVITE", "/app/../app/convite"]) {
      expect(parseInviteLink(`https://orwell.pt${caminho}${resto}`), caminho).toBeNull()
    }
  })

  it("recusa um fragmento que não seja exactamente canal/código", () => {
    const canal = encodeURIComponent("!geral:orwell.pt")
    for (const fragmento of ["", "/", canal, `${canal}/`, `/${codigo()}`, `${canal}/${codigo()}/mais`, `${canal}//${codigo()}`, `%E0%A4%A/${codigo()}`]) {
      expect(parseInviteLink(`https://orwell.pt/app/convite#${fragmento}`), fragmento).toBeNull()
    }
    expect(parseInviteLink("https://orwell.pt/app/convite")).toBeNull()
  })

  it("recusa http para um host que não seja local, e esquemas que não são nossos", () => {
    const resto = `/app/convite#${encodeURIComponent("!geral:orwell.pt")}/${codigo()}`
    expect(parseInviteLink(`http://orwell.pt${resto}`)).toBeNull()
    expect(parseInviteLink(`http://localhost.evil.pt${resto}`)).toBeNull()
    expect(parseInviteLink(`http://localhost:8452${resto}`)).not.toBeNull()
    expect(parseInviteLink(`http://127.0.0.1:8452${resto}`)).not.toBeNull()
    for (const esquema of ["ftp", "javascript", "file", "ws", "wss", "orwell"]) {
      expect(parseInviteLink(`${esquema}://orwell.pt${resto}`), esquema).toBeNull()
    }
  })

  it("recusa credenciais no endereço: o host que se lê tem de ser o host que se abre", () => {
    const resto = `/app/convite#${encodeURIComponent("!geral:orwell.pt")}/${codigo()}`
    expect(parseInviteLink(`https://orwell.pt@evil.pt${resto}`)).toBeNull()
    expect(parseInviteLink(`https://orwell.pt:x@evil.pt${resto}`)).toBeNull()
  })

  it("a forma antiga passa pela mesma regra de host: minúsculas, e sem @ nem %", () => {
    const resto = `/${encodeURIComponent("!geral:orwell.pt")}#${codigo()}`
    expect(parseInviteLink(`enclave://join/Orwell.PT${resto}`)?.server).toBe("orwell.pt")
    expect(parseInviteLink(`enclave://join/orwell.pt@evil.pt${resto}`)).toBeNull()
    expect(parseInviteLink(`enclave://join/orwell%2Ept${resto}`)).toBeNull()
    expect(parseInviteLink(`enclave://join/orwell.pt\u202E${resto}`)).toBeNull()
  })

  it("um host com %, espaço ou marcas de direcção não é um host, em https também", () => {
    const resto = `/app/convite#${encodeURIComponent("!geral:orwell.pt")}/${codigo()}`
    for (const host of ["orwell%2Ept", "orwell.pt%20", "orwell .pt", "orwell.pt\u202Etp.live", "orwell.pt:99999999", "orwell.pt:"]) {
      expect(parseInviteLink(`https://${host}${resto}`), host).toBeNull()
    }
    expect(parseInviteLink(`https://orwell.pt:8443${resto}`)?.server).toBe("orwell.pt:8443")
    expect(parseInviteLink(`https://[::1]:8452${resto}`)?.server).toBe("[::1]:8452")
  })

  it("tem tecto de comprimento, e o maior link que o produto cunha cabe com folga", () => {
    const host = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(58)}.pt`
    expect(host).toHaveLength(253)
    const pessoa = "milsinda-odreto-viddyvox-pofletum-x"
    const maior = formatInviteLink(host, `!dm-${pessoa}.${pessoa}:${host}`, codigo())
    expect(maior.length).toBeLessThan(700)
    expect(parseInviteLink(maior)?.code).toBe(codigo())

    const enorme = formatInviteLink("orwell.pt", `!${"x".repeat(200_000)}:orwell.pt`, codigo())
    expect(parseInviteLink(enorme)).toBeNull()
    expect(parseInviteLink(`enclave://join/orwell.pt/${"x".repeat(200_000)}#${codigo()}`)).toBeNull()
    // Junk around it does not count toward the limit, nor breaks the link.
    expect(parseInviteLink(`\n\t  ${maior}  \r\n`)?.code).toBe(codigo())
  })

  it("recusa lixo", () => {
    for (const lixo of ["", "   ", "olá", "orwell.pt/app/convite#a/b", "enclave://join/", "enclave://join/x/y", "enclave://join/x/y#", "enclave://join/x/%E0%A4%A#z", "https://", "#a/b"]) {
      expect(parseInviteLink(lixo), JSON.stringify(lixo)).toBeNull()
    }
  })
})

/**
 * The pairing link, by the same rules with higher stakes: whoever holds the
 * secret joins the vault. The secret lives in the fragment and nowhere else.
 */
describe("formatPairLink / parsePairLink", () => {
  const segredo = new Uint8Array(PAIR_SECRET_BYTES).map((_, i) => (i * 53 + 11) % 256)

  it("cunha https com caminho fixo, e o segredo vai depois do #", () => {
    const link = formatPairLink("orwell.pt", segredo)
    const url = new URL(link)
    expect(url.protocol).toBe("https:")
    expect(url.pathname).toBe(PAIR_PATH)
    expect(url.search).toBe("")
    expect(url.origin + url.pathname + url.search).toBe(`https://orwell.pt${PAIR_PATH}`)
    expect(url.hash).toBe(`#${toBase64(segredo)}`)
    const lido = parsePairLink(link)
    expect(lido?.server).toBe("orwell.pt")
    expect(toBase64(lido?.segredo ?? new Uint8Array())).toBe(toBase64(segredo))
  })

  it("http só para loopback, como o convite e o gateway", () => {
    expect(formatPairLink("localhost:8448", segredo).startsWith("http://")).toBe(true)
    expect(parsePairLink(`http://localhost:8448${PAIR_PATH}#${toBase64(segredo)}`)?.server).toBe("localhost:8448")
    expect(parsePairLink(`http://orwell.pt${PAIR_PATH}#${toBase64(segredo)}`)).toBeNull()
  })

  it("aceita a forma do plano de Agosto, enclave://pair/<servidor>#<segredo>", () => {
    const lido = parsePairLink(`enclave://pair/orwell.pt#${toBase64(segredo)}`)
    expect(lido?.server).toBe("orwell.pt")
    expect(toBase64(lido?.segredo ?? new Uint8Array())).toBe(toBase64(segredo))
    expect(parsePairLink(`enclave://pair/orwell.pt/extra#${toBase64(segredo)}`)).toBeNull()
  })

  it("recusa o segredo na query ou no caminho, outro caminho, e um fragmento que não são 32 bytes", () => {
    const s = toBase64(segredo)
    expect(parsePairLink(`https://orwell.pt${PAIR_PATH}?s=${s}#${s}`)).toBeNull()
    expect(parsePairLink(`https://orwell.pt${PAIR_PATH}/${s}`)).toBeNull()
    expect(parsePairLink(`https://orwell.pt${PAIR_PATH}/${s}#${s}`)).toBeNull()
    expect(parsePairLink(`https://orwell.pt/app/convite#${s}`)).toBeNull()
    expect(parsePairLink(`https://orwell.pt${PAIR_PATH}#${s.slice(0, 42)}`)).toBeNull()
    expect(parsePairLink(`https://orwell.pt${PAIR_PATH}#${s}a`)).toBeNull()
    expect(parsePairLink(`https://orwell.pt${PAIR_PATH}#${s}/x`)).toBeNull()
    expect(parsePairLink(`https://orwell.pt${PAIR_PATH}#`)).toBeNull()
    expect(parsePairLink(`https://user@orwell.pt${PAIR_PATH}#${s}`)).toBeNull()
    expect(parsePairLink("")).toBeNull()
    expect(parsePairLink("x".repeat(3000))).toBeNull()
  })

  it("tolera espaço à volta e maiúsculas no host", () => {
    const lido = parsePairLink(`  HTTPS://Orwell.PT${PAIR_PATH}#${toBase64(segredo)}\n`)
    expect(lido?.server).toBe("orwell.pt")
  })
})

/**
 * The friendship link (stage 4 of the friendship plan). No secret; the address
 * goes in the fragment so the server does not know who is being sought.
 */
describe("friendLink / parseFriendLink", () => {
  const ELA = "@lux-ignis-terra-mare:orwell.pt"

  it("o endereço vai no fragmento, legível, e volta inteiro", () => {
    const link = friendLink("orwell.pt", ELA)
    expect(link).toBe(`https://orwell.pt${FRIEND_PATH}#${ELA}`)
    const url = new URL(link)
    expect(url.pathname).toBe(FRIEND_PATH)
    expect(url.search).toBe("")
    expect(parseFriendLink(link)).toEqual({ server: "orwell.pt", address: ELA })
  })

  it("uma conta de outro servidor, e o porto do loopback em http", () => {
    const outra = "@aqua-ventus-sol-luna:localhost:8448"
    const link = friendLink("localhost:8448", outra)
    expect(link.startsWith("http://localhost:8448/app/amigo#")).toBe(true)
    expect(parseFriendLink(link)).toEqual({ server: "localhost:8448", address: outra })
    expect(parseFriendLink(friendLink("orwell.pt", outra))).toEqual({ server: "orwell.pt", address: outra })
  })

  it("aceita o endereço escapado e o link com espaços à volta", () => {
    expect(parseFriendLink(`https://orwell.pt/app/amigo#${encodeURIComponent(ELA)}`)?.address).toBe(ELA)
    expect(parseFriendLink(`  HTTPS://Orwell.PT/app/amigo#${ELA}\n`)).toEqual({ server: "orwell.pt", address: ELA })
  })

  it("recusa tudo o que não é exactamente um endereço de conta no fragmento", () => {
    for (const lixo of [
      `https://orwell.pt/app/amigo`,
      `https://orwell.pt/app/amigo#`,
      `https://orwell.pt/app/amigo#!geral:orwell.pt`,
      `https://orwell.pt/app/amigo#ela`,
      `https://orwell.pt/app/amigo#@ela`,
      `https://orwell.pt/app/amigo#${ELA}/mais`,
      `https://orwell.pt/app/amigo#%E0%A4%A`,
      `https://orwell.pt/app/amigo?a=1#${ELA}`,
      `https://orwell.pt/app/amigo/x#${ELA}`,
      `https://orwell.pt/app/convite#${ELA}`,
      `http://orwell.pt/app/amigo#${ELA}`,
      `https://user@orwell.pt/app/amigo#${ELA}`,
      `enclave://amigo/orwell.pt#${ELA}`,
      "",
      "x".repeat(3000),
    ]) {
      expect(parseFriendLink(lixo), lixo).toBeNull()
    }
  })
})

describe("sameHomeserver", () => {
  it("ignora maiúsculas e conta com a porta", () => {
    expect(sameHomeserver("orwell.pt", "Orwell.PT")).toBe(true)
    expect(sameHomeserver("localhost:8452", "localhost:8452")).toBe(true)
    expect(sameHomeserver("localhost:8452", "localhost:8453")).toBe(false)
    expect(sameHomeserver("orwell.pt", "orwell.pt.evil.pt")).toBe(false)
  })

  it("duas grafias do mesmo servidor são o mesmo: ponto final, e a porta 443", () => {
    expect(sameHomeserver("orwell.pt.", "orwell.pt")).toBe(true)
    expect(sameHomeserver("orwell.pt:443", "orwell.pt")).toBe(true)
    expect(sameHomeserver("Orwell.PT.:443", "orwell.pt")).toBe(true)
    expect(sameHomeserver("orwell.pt:8443", "orwell.pt")).toBe(false)
    expect(sameHomeserver("orwell.pt:80", "orwell.pt")).toBe(false)
    // On loopback the port IS the server: nothing is dropped.
    expect(sameHomeserver("localhost:443", "localhost")).toBe(false)
    expect(sameHomeserver("127.0.0.1:443", "127.0.0.1")).toBe(false)
  })
})

/**
 * Nobody anywhere in the repo builds a link with the secret outside the
 * fragment.
 *
 * The parser rejects them, but that only protects the reader. Someone WRITING a
 * link by hand (a script, a test, a help phrase) can put the code in the path
 * or query without going through `formatInviteLink`, and that link, when
 * clicked, delivers the code to the access log before the app rejects it. The
 * form has only one place where it starts; everything else calls it.
 */
describe("o código nunca se escreve fora do fragmento", () => {
  const raiz = fileURLToPath(new URL("../../../", import.meta.url))
  /** Those who write broken links ON PURPOSE to prove they get rejected. */
  const PROVAS_DE_RECUSA = new Set([
    "packages/client-core/src/convite.test.ts",
    "apps/web/src/convite-arranque.test.ts",
    "packages/ui/src/App.convite.test.tsx",
  ])

  function ficheiros(pasta: string): string[] {
    const saida: string[] = []
    for (const nome of readdirSync(`${raiz}${pasta}`)) {
      if (nome === "node_modules" || nome === "dist" || nome === "out" || nome.startsWith(".")) continue
      const caminho = `${pasta}/${nome}`
      if (statSync(`${raiz}${caminho}`).isDirectory()) saida.push(...ficheiros(caminho))
      else if (/\.(ts|tsx|mjs|js|cjs|html|sh)$/.test(nome)) saida.push(caminho)
    }
    return saida
  }

  it("nenhum ficheiro de código escreve /app/convite ou /app/emparelhar seguidos de caminho ou de query", () => {
    const culpados: string[] = []
    const vistos = ["packages", "apps", "scripts"].flatMap(ficheiros)
    for (const caminho of vistos) {
      if (PROVAS_DE_RECUSA.has(caminho)) continue
      readFileSync(`${raiz}${caminho}`, "utf8")
        .split("\n")
        .forEach((linha, i) => {
          // The pairing secret by the same rule: whoever has it enters the vault, and a
          // link with it in the query already gave it to the access log.
          if (/app\/(convite|emparelhar)[/?]/.test(linha)) culpados.push(`${caminho}:${i + 1}`)
        })
    }
    // The guard only works if it looked at something.
    expect(vistos.length).toBeGreaterThan(200)
    expect(vistos).toContain("packages/client-core/src/session.ts")
    expect(culpados, `links de convite com algo fora do fragmento:\n${culpados.join("\n")}`).toEqual([])
  })
})
