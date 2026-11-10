import { sha256 } from "@noble/hashes/sha2.js"
import { describe, expect, it } from "vitest"
import { Autoria, TIPOS_COM_AUTORIA } from "./autoria.js"
import { Payload } from "./payload.js"

/**
 * The rule for the signed form (S4 review, finding 9; written in the plan, §4.1).
 *
 * The author signs the payload NORMALIZED by the schema: with default values
 * filled in and without fields the schema does not know. A new field (or a new
 * default value) in one of the fourteen types that carry authorship changes the
 * normalized form in one version and not the other: what one version signs,
 * the other verifies with different bytes, and the report is rejected as
 * `autoria`.
 *
 * So the form of each of these schemas is locked here, to the format version
 * (`Autoria.v`). Changing a schema without bumping the version makes this test
 * fail. Bumping the version is deciding how the two coexist (the old one verifies
 * with the old form), and only then updating the impressions.
 */

/** The version of the authorship format that the impressions below belong to. */
const VERSAO_DAS_IMPRESSOES = 1

/*
  `message`, `post` and `space.meta` changed 26/10/2026 without bumping the version:
  `Attachment` gained `poster` and `partes` (the video from posts). They are
  optional and have no default value, and in attachments the signed form only
  stores the name and type. Coexistence with 0.8.0 is proven in `video.test.ts`
  (the same normalized bytes without the fields; the same signed form with them).
*/
/*
  `message` changed again 28/10/2026 without bumping the version (phase 3 of 0.9,
  moderation): it gained `apelido`, and the `ticket` mark gained `removed`. Both
  are optional and have no default value: a message without them has the same
  signed form in 0.9.3 and here, which are all that already exist. A message WITH
  them, reported (and not live) to a 0.9.3, does not verify there, because 0.9.3
  strips the field before verifying; live MLS authenticates the sender and
  authorship is not read. Proven in `payload.moderar.test.ts`.
*/
/*
  `message` changed 28/10/2026 for the third time without bumping the version
  (phase 8.2 of 0.9, "Merge accounts"): it gained `sucessora`, and the invite
  (`invite`) gained `sucessao`. Both are optional and have no default value,
  like those from phase 3: a message without them signs the same in 0.9.4 and
  here. One WITH them, reported to a 0.9.4, does not verify there; live authorship
  is not read. Proven in `payload.sucessora.test.ts`.
*/
/*
  `channel.meta` changed 2/11/2026 without bumping the version (AFK room, after 1.0.6):
  it gained `afk`, optional and with no default value. A room without it signs the
  same in 1.0.6 and here, which are all that already exist. An AFK room reported
  (and not live) to a 1.0.6 does not verify there; live authorship is not read.
  Proven in `payload.afk.test.ts`.
*/
/*
  `profile` entered 2/11/2026 (decision D1 from the encrypted state plan, phase 1
  of 1.1): it is the 14th form. It entered with `Autoria.v` at 1 because the signed
  form is per type and no profile carried authorship before: there is no prior
  version to coexist with. The portrait (`avatar`) enters the form only by name
  and type, with the digest in `m`, like attachments (`eRetratoDoPerfil` in
  `autoria.ts`). A 1.0.x client drops the field and reads the profile as always.
*/
/*
  `channel.meta`, `channel.category` and `role.define` changed 3/11/2026 without
  bumping the version (the permissions model, §4.2 from the parity plan): they
  gained `perms` (the first two) and `rank` (the third), optional and with no
  default value. A room, a category or a role without them signs the same in 1.1.0
  and here. WITH them, reported (and not live) to a 1.1.0, does not verify there,
  because it strips the field before verifying; live MLS authenticates the sender
  and authorship is not read. Inviting a 1.1.0 does not skip the cascade
  (`EXTENSAO_PERMISSOES`), so it receives live what the portrait does not prove.
  Proven in `payload.permissoes.test.ts`.
*/
const IMPRESSOES: Record<string, string> = {
  message: "e9a118722fe65056",
  edit: "a0e49f49e674e700",
  redact: "6d8d79dd33db05b9",
  reaction: "8e9e01afa380db2a",
  "space.meta": "8496af12b04aa1af",
  "channel.meta": "904d159ce0c1bc53",
  "channel.category": "723d670c93969e71",
  "role.define": "802a74f1a7f15f2b",
  "role.assign": "349bc31e5a3e17b6",
  post: "ad0427ac563c8f24",
  "post.comment": "d690361043385a6e",
  "post.reaction": "455fd49290b2a60a",
  "room.created": "0072be3f8a6078ca",
  profile: "4d894679ccc4fce5",
}

interface DefDoZod {
  type: string
  shape?: Record<string, unknown>
  element?: unknown
  options?: unknown[]
  valueType?: unknown
  innerType?: unknown
  in?: unknown
  defaultValue?: unknown
}

const defDe = (schema: unknown): DefDoZod | undefined => (schema as { _zod?: { def?: DefDoZod } })?._zod?.def

/** The paths of a schema: each field, each list, each alternative, and the default values. */
function caminhos(schema: unknown, prefixo: string, saida: string[], vistos: Set<unknown>): void {
  const def = defDe(schema)
  if (!def || vistos.has(schema)) return
  vistos.add(schema)
  switch (def.type) {
    case "object":
      for (const [chave, filho] of Object.entries(def.shape ?? {})) {
        saida.push(`${prefixo}.${chave}`)
        caminhos(filho, `${prefixo}.${chave}`, saida, vistos)
      }
      break
    case "array":
      caminhos(def.element, `${prefixo}[]`, saida, vistos)
      break
    case "union":
      ;(def.options ?? []).forEach((opcao, i) => caminhos(opcao, `${prefixo}|${i}`, saida, vistos))
      break
    case "record":
      caminhos(def.valueType, `${prefixo}{}`, saida, vistos)
      break
    default:
      if (def.type === "default") saida.push(`${prefixo}=${JSON.stringify(def.defaultValue)}`)
      if (def.innerType) caminhos(def.innerType, prefixo, saida, vistos)
      if (def.in) caminhos(def.in, prefixo, saida, vistos)
  }
  vistos.delete(schema)
}

function impressao(schema: unknown, tipo: string): string {
  const saida: string[] = []
  caminhos(schema, tipo, saida, new Set())
  const bytes = sha256(new TextEncoder().encode(saida.sort().join("\n")))
  return [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function esquemaDe(tipo: string): unknown {
  const opcoes = (Payload as unknown as { options: { shape: { t: { value: string } } }[] }).options
  return opcoes.find((opcao) => opcao.shape.t.value === tipo)
}

describe("a forma assinada está presa à versão da autoria", () => {
  it("as impressões são da versão em vigor", () => {
    expect((Autoria.shape.v as unknown as { value: number }).value).toBe(VERSAO_DAS_IMPRESSOES)
  })

  it("nenhum dos catorze esquemas mudou sem subir Autoria.v", () => {
    expect(Object.keys(IMPRESSOES).sort()).toEqual([...TIPOS_COM_AUTORIA].sort())
    const agora = Object.fromEntries(TIPOS_COM_AUTORIA.map((tipo) => [tipo, impressao(esquemaDe(tipo), tipo)]))
    expect(agora, "um esquema com autoria mudou: sobe Autoria.v (e decide a convivência) antes de actualizar IMPRESSOES").toEqual(IMPRESSOES)
  })

  it("a impressão apanha um campo novo, mesmo dentro de um objecto aninhado", () => {
    const base = esquemaDe("message") as { extend: (campos: Record<string, unknown>) => unknown }
    const opcional = (esquemaDe("message") as { shape: { body: unknown } }).shape.body
    expect(impressao(base.extend({ novo: opcional }), "message")).not.toBe(impressao(base, "message"))
  })
})
