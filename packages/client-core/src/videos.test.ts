import { VIDEO_BYTES_POR_PARTE, VIDEO_MAX_BYTES, type ParteDeVideo } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import {
  bytesParaBase64,
  apagarVideo,
  guardarVideo,
  HISTORY_MEDIA_BUDGET_BYTES,
  newVaultContents,
  videoNoCofre,
  type StoredChatMessage,
  type VaultContents,
} from "./vault.js"
import {
  ERROS_DO_VIDEO,
  MemoriaDeVideos,
  partesDoAnexo,
  partir,
  resumoDoVideo,
  tamanhoDaParte,
  validarVideo,
  videoEmUso,
  VideosDaSessao,
  type EventoDoVideo,
} from "./videos.js"

const bytes = (n: number, semente = 1): Uint8Array => new Uint8Array(n).map((_, i) => (i * 31 + semente) & 0xff)

describe("validar antes de enviar", () => {
  it("recusa o formato, o tamanho e a duração, com a frase estável e o tecto no cause", () => {
    const pequeno = bytes(10)
    expect(() => validarVideo({ bytes: pequeno, mediaType: "video/x-matroska", duration: 1 })).toThrow(ERROS_DO_VIDEO.formato)
    expect(() => validarVideo({ bytes: pequeno, mediaType: "video/mp4", duration: 90.5 })).toThrow(ERROS_DO_VIDEO.longo)
    expect(() => validarVideo({ bytes: pequeno, mediaType: "video/mp4", duration: Number.NaN })).toThrow(ERROS_DO_VIDEO.longo)
    const grande = { length: VIDEO_MAX_BYTES + 1 } as unknown as Uint8Array
    try {
      validarVideo({ bytes: grande, mediaType: "video/webm", duration: 1 })
      expect.unreachable()
    } catch (erro) {
      expect((erro as Error).message).toBe(ERROS_DO_VIDEO.grande)
      expect((erro as Error).cause).toEqual({ max: VIDEO_MAX_BYTES })
    }
    expect(() => validarVideo({ bytes: pequeno, mediaType: "video/quicktime", duration: 90 })).not.toThrow()
  })
})

describe("as partes", () => {
  it("parte pelo tamanho, a última com o resto, sem copiar", () => {
    const tudo = bytes(2 * VIDEO_BYTES_POR_PARTE + 5)
    const partes = partir(tudo)
    expect(partes.map((p) => p.length)).toEqual([VIDEO_BYTES_POR_PARTE, VIDEO_BYTES_POR_PARTE, 5])
    expect(partes[0]!.buffer).toBe(tudo.buffer)
    const declaradas = { n: 3, sha256: "A".repeat(43), bytes: VIDEO_BYTES_POR_PARTE }
    expect(tamanhoDaParte(declaradas, tudo.length, 0)).toBe(VIDEO_BYTES_POR_PARTE)
    expect(tamanhoDaParte(declaradas, tudo.length, 2)).toBe(5)
  })

  it("um anexo com contas que não fecham não é um vídeo em partes", () => {
    const P = VIDEO_BYTES_POR_PARTE
    const certo = { byteLength: P + 10, partes: { n: 2, sha256: "A".repeat(43), bytes: P } }
    expect(partesDoAnexo(certo)).toMatchObject({ n: 2, byteLength: P + 10 })
    expect(partesDoAnexo({ ...certo, byteLength: 2 * P + 1 })).toBeNull()
    expect(partesDoAnexo({ ...certo, byteLength: P })).toBeNull()
    expect(partesDoAnexo({ byteLength: 10 })).toBeNull()
  })

  it("o resumo é SHA-256 em base64url, 43 caracteres", async () => {
    const resumo = await resumoDoVideo(new TextEncoder().encode("abc"))
    // SHA-256("abc") = ba7816bf...
    expect(resumo).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0")
  })
})

describe("o cofre: o vídeo conta no orçamento e sai primeiro", () => {
  function comFotografia(contents: VaultContents, caracteres: number, at: number): void {
    const entrada: StoredChatMessage = {
      seq: at,
      sender: "@ana:x",
      at,
      payload: { t: "post", id: `p-${at}-000000`, media: [{ name: "f.png", mediaType: "image/png", inline: "x".repeat(caracteres) }] },
    }
    contents.estadoDoCanal["!c:x"] = [...(contents.estadoDoCanal["!c:x"] ?? []), entrada]
  }

  it("guarda o vídeo que cabe, e despeja-o antes das fotografias quando o orçamento passa", () => {
    const contents = newVaultContents()
    comFotografia(contents, 1_000_000, 1)
    expect(guardarVideo(contents, "V".repeat(43), "a".repeat(2_000_000), 10)).toBe(true)
    expect(videoNoCofre(contents, "V".repeat(43))).toHaveLength(2_000_000)
    // Another video blows the budget: the oldest video leaves, and the still stays.
    expect(guardarVideo(contents, "W".repeat(43), "b".repeat(1_500_000), 20)).toBe(true)
    expect(videoNoCofre(contents, "V".repeat(43))).toBeNull()
    expect(videoNoCofre(contents, "W".repeat(43))).not.toBeNull()
    const foto = (contents.estadoDoCanal["!c:x"]![0]!.payload["media"] as Record<string, unknown>[])[0]!
    expect(foto["inline"]).toBeDefined()
  })

  it("um vídeo maior do que o orçamento inteiro não entra", () => {
    const contents = newVaultContents()
    expect(guardarVideo(contents, "V".repeat(43), "a".repeat(HISTORY_MEDIA_BUDGET_BYTES + 1), 1)).toBe(false)
    expect(contents.videos ?? {}).toEqual({})
  })

  it("um resumo que é nome de propriedade do protótipo não é um vídeo", () => {
    expect(videoNoCofre(newVaultContents(), "constructor")).toBeNull()
  })
})

describe("a memória", () => {
  it("guarda até ao tecto, e a menos usada sai primeiro", () => {
    const memoria = new MemoriaDeVideos(10)
    memoria.guardar("a", bytes(4))
    memoria.guardar("b", bytes(4))
    expect(memoria.obter("a")).not.toBeNull() // "a" becomes the most used one.
    memoria.guardar("c", bytes(4))
    expect(memoria.obter("b")).toBeNull()
    expect(memoria.obter("a")).not.toBeNull()
    expect(memoria.total).toBe(8)
    memoria.guardar("enorme", bytes(11))
    expect(memoria.obter("enorme")).toBeNull()
  })
})

/** A fake session: the vault in memory, the parts in one list, the events in another. */
function montar(contents = newVaultContents()) {
  const enviadas: { canal: string; parte: ParteDeVideo }[] = []
  const eventos: EventoDoVideo[] = []
  const chegadas: { sha: string; completo: boolean }[] = []
  const videos = new VideosDaSessao({
    conteudo: () => contents,
    guardarNoCofre: async (sha, b64) => guardarVideo(contents, sha, b64, 1),
    enviarParte: async (canal, parte) => {
      enviadas.push({ canal, parte })
    },
    emitir: (evento) => eventos.push(evento),
    aoChegar: (_canal, sha, completo) => chegadas.push({ sha, completo }),
  })
  return { videos, enviadas, eventos, chegadas, contents }
}

describe("publicar e receber", () => {
  it("prepara o anexo sem bytes, envia as partes, e do outro lado junta-as e confere", async () => {
    const tudo = bytes(2 * VIDEO_BYTES_POR_PARTE + 100)
    const autor = montar()
    const { anexo, sha } = await autor.videos.preparar({ bytes: tudo, name: "v.mp4", mediaType: "video/mp4", duration: 4 })
    expect(anexo).toMatchObject({ kind: "video", byteLength: tudo.length, partes: { n: 3, sha256: sha } })
    expect(anexo.inline).toBeUndefined()
    await autor.videos.enviarPartes("!feed:x", sha)
    expect(autor.enviadas).toHaveLength(3)
    expect(autor.eventos.at(-1)).toEqual({ sha, fase: "pronto" })

    const leitor = montar()
    leitor.videos.esperar("!feed:x", [anexo])
    // Out of order and with one repeated: count it once.
    for (const indice of [2, 0, 0, 1]) await leitor.videos.aoParte("!feed:x", autor.enviadas[indice]!.parte, "ana")
    expect(leitor.videos.estado(sha)).toEqual({ fase: "pronto" })
    expect(await resumoDoVideo(leitor.videos.bytes(sha)!)).toBe(sha)
    expect(leitor.chegadas.at(-1)).toEqual({ sha, completo: true })
    expect(leitor.eventos.filter((e) => e.fase === "a-receber").map((e) => ("feitas" in e ? e.feitas : 0))).toEqual([1, 2])
  })

  it("recusa partes de um vídeo que nenhuma publicação do canal anunciou", async () => {
    const tudo = bytes(100)
    const autor = montar()
    const { sha } = await autor.videos.preparar({ bytes: tudo, name: "v.mp4", mediaType: "video/mp4", duration: 1 })
    await autor.videos.enviarPartes("!feed:x", sha)
    const leitor = montar()
    await leitor.videos.aoParte("!feed:x", autor.enviadas[0]!.parte, "ana")
    expect(leitor.videos.estado(sha)).toEqual({ fase: "sem-bytes" })
  })

  it("bytes que não dão o resumo anunciado não se guardam", async () => {
    const tudo = bytes(100)
    const autor = montar()
    const { anexo, sha } = await autor.videos.preparar({ bytes: tudo, name: "v.mp4", mediaType: "video/mp4", duration: 1 })
    const leitor = montar()
    leitor.videos.esperar("!feed:x", [anexo])
    const falsa = bytesParaBase64(bytes(100, 7))
    await leitor.videos.aoParte("!feed:x", { sha, parte: 0, de: 1, dados: falsa }, "ana")
    expect(leitor.videos.estado(sha)).toEqual({ fase: "sem-bytes" })
    expect(leitor.eventos.at(-1)).toEqual({ sha, fase: "falhou" })
  })

  it("uma parte com o tamanho errado não conta", async () => {
    const tudo = bytes(VIDEO_BYTES_POR_PARTE + 10)
    const autor = montar()
    const { anexo, sha } = await autor.videos.preparar({ bytes: tudo, name: "v.mp4", mediaType: "video/mp4", duration: 1 })
    const leitor = montar()
    leitor.videos.esperar("!feed:x", [anexo])
    await leitor.videos.aoParte("!feed:x", { sha, parte: 1, de: 2, dados: bytesParaBase64(bytes(11)) }, "ana")
    expect(leitor.videos.estado(sha)).toEqual({ fase: "sem-bytes" })
  })

  it("encontra o anúncio no cofre, quando a memória já não o tem (depois de recarregar)", async () => {
    const tudo = bytes(100)
    const autor = montar()
    const { anexo, sha } = await autor.videos.preparar({ bytes: tudo, name: "v.mp4", mediaType: "video/mp4", duration: 1 })
    await autor.videos.enviarPartes("!feed:x", sha)
    const contents = newVaultContents()
    contents.estadoDoCanal["!feed:x"] = [{ seq: 1, sender: "@a:x", at: 1, payload: { t: "post", id: "p-0000000001", media: [anexo] } }]
    const leitor = montar(contents)
    await leitor.videos.aoParte("!feed:x", autor.enviadas[0]!.parte, "ana")
    expect(leitor.videos.estado(sha)).toEqual({ fase: "pronto" })
  })

  it("cancelar pára antes da parte seguinte e o erro diz cancelado", async () => {
    const autor = montar()
    const { sha } = await autor.videos.preparar({
      bytes: bytes(3 * VIDEO_BYTES_POR_PARTE),
      name: "v.mp4",
      mediaType: "video/mp4",
      duration: 1,
    })
    const envio = autor.videos.enviarPartes("!feed:x", sha)
    expect(autor.videos.estado(sha)).toMatchObject({ fase: "a-enviar", de: 3 })
    expect(autor.videos.cancelarEnvio()).toBe(true)
    await expect(envio).rejects.toThrow(ERROS_DO_VIDEO.cancelado)
    expect(autor.enviadas.length).toBeLessThan(3)
    expect(autor.eventos.at(-1)).toEqual({ sha, fase: "cancelado" })
    expect(autor.videos.cancelarEnvio()).toBe(false)
  })

  it("servir (S5): as partes outra vez com o q, e pára na primeira recusa de vez", async () => {
    const autor = montar()
    const { sha } = await autor.videos.preparar({
      bytes: bytes(2 * VIDEO_BYTES_POR_PARTE),
      name: "v.mp4",
      mediaType: "video/mp4",
      duration: 1,
    })
    expect(await autor.videos.servir("!feed:x", sha, "anx.1", async () => true)).toBe(true)
    expect(autor.enviadas.map((e) => e.parte.q)).toEqual(["anx.1", "anx.1"])
    let vezes = 0
    expect(await autor.videos.servir("!feed:x", sha, "anx.2", async () => vezes++ === 0)).toBe(false)
    expect(autor.enviadas).toHaveLength(3)
    expect(await autor.videos.servir("!feed:x", "Z".repeat(43), "anx.3", async () => true)).toBe(false)
  })
})

/** Like `montar`, with vault deletion and recordings counted. */
function montarComCofre(contents = newVaultContents()) {
  const base = montar(contents)
  const gravados: string[] = []
  const videos = new VideosDaSessao({
    conteudo: () => contents,
    guardarNoCofre: async (sha, b64) => {
      gravados.push(sha)
      return guardarVideo(contents, sha, b64, 1)
    },
    apagarDoCofre: async (sha) => {
      apagarVideo(contents, sha)
    },
    enviarParte: async (canal, parte) => {
      base.enviadas.push({ canal, parte })
    },
    emitir: (evento) => base.eventos.push(evento),
    aoChegar: (_canal, sha, completo) => base.chegadas.push({ sha, completo }),
  })
  return { ...base, videos, gravados }
}

/** A post with these attachments, stored in the vault. */
function publicacaoNoCofre(contents: VaultContents, canal: string, id: string, media: unknown[], seq = 1): void {
  contents.estadoDoCanal[canal] = [
    ...(contents.estadoDoCanal[canal] ?? []),
    { seq, sender: "@ana:x", at: seq, payload: { t: "post", id, media } } as StoredChatMessage,
  ]
}

describe("revisão do vídeo: os tectos da recepção (achado 2)", () => {
  it("um anexo acima do tecto, ou com partes de outro tamanho, não é um vídeo e não reserva memória", async () => {
    const enorme = { byteLength: 768 * 1024 * 1024, partes: { n: 256, sha256: "A".repeat(43), bytes: 3 * 1024 * 1024 } }
    expect(partesDoAnexo(enorme)).toBeNull()
    expect(partesDoAnexo({ byteLength: VIDEO_MAX_BYTES + 1, partes: { n: 26, sha256: "A".repeat(43), bytes: VIDEO_BYTES_POR_PARTE } })).toBeNull()
    expect(partesDoAnexo({ byteLength: 10, partes: { n: 1, sha256: "A".repeat(43), bytes: 64 } })).toBeNull()
    const leitor = montar()
    leitor.videos.esperar("!feed:x", [enorme])
    // A 3 MB part of the size the attachment declares: nobody expects it.
    await leitor.videos.aoParte("!feed:x", { sha: "A".repeat(43), parte: 0, de: 256, dados: bytesParaBase64(bytes(3 * 1024 * 1024)) }, "bruno")
    expect(leitor.videos.estado("A".repeat(43))).toEqual({ fase: "sem-bytes" })
    expect(leitor.eventos).toEqual([])
  })
})

describe("revisão do vídeo: cada aparelho monta à parte (achado 3)", () => {
  it("o lixo do Bruno com o tamanho certo não impede o vídeo da Ana", async () => {
    const tudo = bytes(VIDEO_BYTES_POR_PARTE + 100)
    const autor = montar()
    const { anexo, sha } = await autor.videos.preparar({ bytes: tudo, name: "v.mp4", mediaType: "video/mp4", duration: 1 })
    await autor.videos.enviarPartes("!feed:x", sha)
    const leitor = montar()
    leitor.videos.esperar("!feed:x", [anexo])
    // Bruno arrives first, with both parts the right size and wrong bytes.
    await leitor.videos.aoParte("!feed:x", { sha, parte: 0, de: 2, dados: bytesParaBase64(bytes(VIDEO_BYTES_POR_PARTE, 9)) }, "bruno")
    await leitor.videos.aoParte("!feed:x", { sha, parte: 1, de: 2, dados: bytesParaBase64(bytes(100, 9)) }, "bruno")
    expect(leitor.videos.estado(sha)).toEqual({ fase: "sem-bytes" })
    for (const enviada of autor.enviadas) await leitor.videos.aoParte("!feed:x", enviada.parte, "ana")
    expect(leitor.videos.estado(sha)).toEqual({ fase: "pronto" })
    expect(await resumoDoVideo(leitor.videos.bytes(sha)!)).toBe(sha)
  })

  it('o lixo do Bruno a meio da montagem da Ana não a estraga, nem diz "falhou"', async () => {
    const tudo = bytes(VIDEO_BYTES_POR_PARTE + 100)
    const autor = montar()
    const { anexo, sha } = await autor.videos.preparar({ bytes: tudo, name: "v.mp4", mediaType: "video/mp4", duration: 1 })
    await autor.videos.enviarPartes("!feed:x", sha)
    const leitor = montar()
    leitor.videos.esperar("!feed:x", [anexo])
    await leitor.videos.aoParte("!feed:x", autor.enviadas[0]!.parte, "ana")
    await leitor.videos.aoParte("!feed:x", { sha, parte: 0, de: 2, dados: bytesParaBase64(bytes(VIDEO_BYTES_POR_PARTE, 9)) }, "bruno")
    await leitor.videos.aoParte("!feed:x", { sha, parte: 1, de: 2, dados: bytesParaBase64(bytes(100, 9)) }, "bruno")
    expect(leitor.eventos.some((e) => e.fase === "falhou")).toBe(false)
    await leitor.videos.aoParte("!feed:x", autor.enviadas[1]!.parte, "ana")
    expect(leitor.videos.estado(sha)).toEqual({ fase: "pronto" })
  })

  it("a guarda do canal: as partes de um vídeo de outro canal não o completam", async () => {
    const tudo = bytes(VIDEO_BYTES_POR_PARTE + 100)
    const autor = montar()
    const { anexo, sha } = await autor.videos.preparar({ bytes: tudo, name: "v.mp4", mediaType: "video/mp4", duration: 1 })
    await autor.videos.enviarPartes("!feed:x", sha)
    const leitor = montar()
    leitor.videos.esperar("!feed:x", [anexo])
    await leitor.videos.aoParte("!feed:x", autor.enviadas[0]!.parte, "ana")
    // The second part arrives on a channel where no post announced it.
    await leitor.videos.aoParte("!outro:x", autor.enviadas[1]!.parte, "ana")
    expect(leitor.videos.estado(sha)).toMatchObject({ fase: "a-receber", feitas: 1 })
  })
})

describe("revisão do vídeo: um envio de cada vez (achado 5)", () => {
  it("um segundo envio com outro em curso lança, e não pisa o primeiro", async () => {
    const autor = montar()
    const um = await autor.videos.preparar({ bytes: bytes(2 * VIDEO_BYTES_POR_PARTE), name: "a.mp4", mediaType: "video/mp4", duration: 1 })
    const dois = await autor.videos.preparar({ bytes: bytes(10, 3), name: "b.mp4", mediaType: "video/mp4", duration: 1 })
    const primeiro = autor.videos.enviarPartes("!feed:x", um.sha)
    expect(autor.videos.aEnviar).toBe(true)
    // The refusal comes right at the call, with the first one halfway through.
    const segundo = autor.videos.enviarPartes("!feed:x", dois.sha)
    expect(autor.videos.estado(um.sha)).toMatchObject({ fase: "a-enviar" })
    await expect(segundo).rejects.toThrow(ERROS_DO_VIDEO.ocupado)
    await primeiro
    expect(autor.videos.aEnviar).toBe(false)
    expect(autor.enviadas.every((e) => e.parte.sha === um.sha)).toBe(true)
  })
})

describe("revisão do vídeo: os bytes saem do cofre (achado 6)", () => {
  it("esquecer apaga da memória e do cofre", async () => {
    const autor = montarComCofre()
    const { sha } = await autor.videos.preparar({ bytes: bytes(VIDEO_BYTES_POR_PARTE), name: "v.mp4", mediaType: "video/mp4", duration: 1 })
    expect(videoNoCofre(autor.contents, sha)).not.toBeNull()
    await autor.videos.esquecer(sha)
    expect(videoNoCofre(autor.contents, sha)).toBeNull()
    expect(autor.videos.estado(sha)).toEqual({ fase: "sem-bytes" })
  })

  it("apagar uma publicação larga o vídeo só se nenhuma outra publicação viva o usa", async () => {
    const autor = montarComCofre()
    const { anexo, sha } = await autor.videos.preparar({ bytes: bytes(100), name: "v.mp4", mediaType: "video/mp4", duration: 1 })
    publicacaoNoCofre(autor.contents, "!feed:x", "p-1", [anexo], 1)
    publicacaoNoCofre(autor.contents, "!feed:x", "p-2", [anexo], 2)
    expect(videoEmUso(autor.contents, sha, { canal: "!feed:x", id: "p-1" })).toBe(true)
    await autor.videos.largarDaPublicacao("!feed:x", "p-1", [sha])
    expect(videoNoCofre(autor.contents, sha)).not.toBeNull()
    // The second one is also deleted by the author: nobody uses it anymore.
    autor.contents.estadoDoCanal["!feed:x"]!.push({ seq: 3, sender: "@ana:x", at: 3, payload: { t: "redact", target: "p-2" } } as StoredChatMessage)
    await autor.videos.largarDaPublicacao("!feed:x", "p-1", [sha])
    expect(videoNoCofre(autor.contents, sha)).toBeNull()
  })
})

describe("revisão do vídeo: o cofre não despeja à toa (recomendação 10)", () => {
  it("um vídeo que não cabe ao lado das fotografias é recusado, e os vídeos antigos ficam", () => {
    const contents = newVaultContents()
    publicacaoNoCofre(contents, "!c:x", "p-f", [{ name: "f.png", mediaType: "image/png", inline: "x".repeat(2_500_000) }])
    expect(guardarVideo(contents, "V".repeat(43), "a".repeat(1_000_000), 1)).toBe(true)
    // 2.5 M photos plus 2 M new video exceed 4 M: reject immediately, without discarding the old one.
    expect(guardarVideo(contents, "W".repeat(43), "b".repeat(2_000_000), 2)).toBe(false)
    expect(videoNoCofre(contents, "V".repeat(43))).not.toBeNull()
    expect(videoNoCofre(contents, "W".repeat(43))).toBeNull()
  })

  it("um vídeo que não cabe nem chega a ser passado a base64 para o cofre", async () => {
    const autor = montarComCofre()
    // 3 MB translates to 4.2 million characters: over the entire budget.
    await autor.videos.preparar({ bytes: bytes(3 * VIDEO_BYTES_POR_PARTE), name: "v.mp4", mediaType: "video/mp4", duration: 1 })
    expect(autor.gravados).toEqual([])
  })
})

describe("revisão do vídeo: servir conta o que vai no fio (achado 9)", () => {
  it("cada parte pede a vez pelo tamanho em base64, e não pelos bytes crus", async () => {
    const autor = montar()
    const { sha } = await autor.videos.preparar({ bytes: bytes(VIDEO_BYTES_POR_PARTE + 3), name: "v.mp4", mediaType: "video/mp4", duration: 1 })
    const custos: number[] = []
    await autor.videos.servir("!feed:x", sha, "anx.1", async (custo) => {
      custos.push(custo)
      return true
    })
    expect(custos[0]).toBe(Math.ceil((VIDEO_BYTES_POR_PARTE * 4) / 3) + 256)
    expect(custos[0]).toBeGreaterThanOrEqual(autor.enviadas[0]!.parte.dados.length)
    expect(custos[1]).toBeGreaterThanOrEqual(autor.enviadas[1]!.parte.dados.length)
  })
})
