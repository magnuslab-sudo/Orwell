import { partesDoVideo, VIDEO_BYTES_POR_PARTE } from "@enclave/protocol"
import { bytesParaBase64, resumoDoVideo, TECTOS_DOS_ANEXOS } from "@enclave/client-core"
import { DatabaseSync } from "node:sqlite"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * Video publishing, with real sessions against a real server.
 *
 * - Ana publishes a synthetic 3 MB video; Bruno, who follows, receives it, and the
 *   bytes have the same SHA-256.
 * - Cancelling midway deletes the publication, and followers no longer see it.
 * - Anyone who arrives later (Carla) has the publication with the thumbnail but no bytes,
 *   asks the other members for them (S5), and receives identical bytes.
 *
 * With `MEDIR_VIDEO=1`, also measures the time for 5, 15 and 30 MB and the size of each
 * frame on the server (lines `MEDIDA-VIDEO`). It is the measurement that set the cap.
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

/** Bytes that do not compress or repeat: the worst case for the wire. */
function bytesSinteticos(tamanho: number): Uint8Array {
  const bytes = new Uint8Array(tamanho)
  for (let inicio = 0; inicio < tamanho; inicio += 65_536) {
    crypto.getRandomValues(bytes.subarray(inicio, Math.min(tamanho, inicio + 65_536)))
  }
  return bytes
}

const POSTER = `data:image/webp;base64,${"UklGRg".repeat(40)}`

/** The feed of `autor` with `leitores` in it. */
async function feedCom(autor: ContaDeTeste, ...leitores: ContaDeTeste[]): Promise<string> {
  for (const leitor of leitores) await autor.session.acceptFollower(leitor.address)
  const feed = autor.session.feedChannel
  for (const leitor of leitores) await ate(() => leitor.session.channels.includes(feed), `${leitor.nome} entra no feed`)
  return feed
}

function publicacoes(conta: ContaDeTeste, feed: string): Record<string, unknown>[] {
  return conta.session
    .history(feed)
    .filter((entrada) => entrada.payload.t === "post")
    .map((entrada) => entrada.payload as Record<string, unknown>)
}

describe("o vídeo de uma publicação, entre duas sessões", () => {
  it("Ana publica 3 MB, Bruno recebe os mesmos bytes (SHA-256), com a miniatura", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const feed = await feedCom(ana!, bruno!)
    const bytes = bytesSinteticos(3 * 1024 * 1024)
    const sha = await resumoDoVideo(bytes)
    const progresso: number[] = []
    ana!.session.on("video", (evento) => {
      if (evento.fase === "a-enviar") progresso.push(evento.feitas)
    })

    const id = await ana!.session.publicarVideo("a praia", [], {}, {
      bytes,
      name: "praia.webm",
      mediaType: "video/webm",
      duration: 12,
      poster: POSTER,
    })

    expect(progresso).toEqual([1, 2, 3])
    await ate(() => bruno!.session.estadoDoVideo(sha).fase === "pronto", "o vídeo chega inteiro ao Bruno", 30_000)
    const recebidos = bruno!.session.bytesDoVideo(sha)
    expect(recebidos).not.toBeNull()
    expect(await resumoDoVideo(recebidos!)).toBe(sha)
    expect(recebidos!.length).toBe(bytes.length)

    const [publicacao] = publicacoes(bruno!, feed)
    expect(publicacao?.["id"]).toBe(id)
    const anexo = (publicacao?.["media"] as Record<string, unknown>[])[0]
    expect(anexo).toMatchObject({ kind: "video", name: "praia.webm", poster: POSTER, partes: { n: 3, sha256: sha } })
    expect(anexo).not.toHaveProperty("inline")
  }, 60_000)

  it("cancelar a meio apaga a publicação, e o erro diz que foi cancelado", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const feed = await feedCom(ana!, bruno!)
    const bytes = bytesSinteticos(4 * VIDEO_BYTES_POR_PARTE)
    ana!.session.on("video", (evento) => {
      if (evento.fase === "a-enviar" && evento.feitas === 1) ana!.session.cancelarEnvioDeVideo()
    })
    await expect(
      ana!.session.publicarVideo("vai ser cancelado", [], {}, { bytes, name: "x.mp4", mediaType: "video/mp4", duration: 3 }),
    ).rejects.toThrow("the video upload was cancelled")

    // The publication reached Bruno before it was canceled, and the tombstone arrives after.
    await ate(() => publicacoes(bruno!, feed).length === 1, "a publicação chega ao Bruno", 30_000)
    const id = publicacoes(bruno!, feed)[0]?.["id"]
    await ate(
      () => bruno!.session.history(feed).some((entrada) => entrada.payload.t === "redact" && entrada.payload["target"] === id),
      "a lápide chega ao Bruno",
      30_000,
    )
    expect(ana!.session.estadoDoVideo(await resumoDoVideo(bytes)).fase).toBe("sem-bytes")
  }, 60_000)

  it("os tectos recusam antes de sair: tamanho, duração, formato", async () => {
    const [ana] = await contas("Ana")
    const pequeno = new Uint8Array(10)
    await expect(
      ana!.session.publicarVideo("", [], {}, { bytes: pequeno, name: "x.mkv", mediaType: "video/x-matroska", duration: 1 }),
    ).rejects.toThrow("this video format is not accepted")
    await expect(
      ana!.session.publicarVideo("", [], {}, { bytes: pequeno, name: "x.mp4", mediaType: "video/mp4", duration: 91 }),
    ).rejects.toThrow("the video is too long")
  }, 30_000)
})

describe("o vídeo a pedido (S5)", () => {
  it("quem chega depois vê a miniatura sem os bytes, pede-os aos outros membros e recebe-os iguais", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const feed = await feedCom(ana!, bruno!)
    const bytes = bytesSinteticos(3 * 1024 * 1024)
    const sha = await resumoDoVideo(bytes)
    const id = await ana!.session.publicarVideo("antes da Carla", [], {}, {
      bytes,
      name: "lagar.mp4",
      mediaType: "video/mp4",
      duration: 20,
      poster: POSTER,
    })
    await ate(() => bruno!.session.estadoDoVideo(sha).fase === "pronto", "o Bruno tem o vídeo", 30_000)

    await ana!.session.acceptFollower(carla!.address)
    await ate(() => carla!.session.channels.includes(feed), "a Carla entra no feed")
    await ate(() => publicacoes(carla!, feed).some((p) => p["id"] === id), "a publicação chega à Carla", 60_000)
    expect(carla!.session.estadoDoVideo(sha).fase).toBe("sem-bytes")

    const inicio = Date.now()
    const desfecho = await carla!.session.pedirAnexo(feed, id, 0)
    expect(desfecho.ok).toBe(true)
    const recebidos = carla!.session.bytesDoVideo(sha)
    expect(recebidos).not.toBeNull()
    expect(await resumoDoVideo(recebidos!)).toBe(sha)
    console.log(`MEDIDA-VIDEO ${JSON.stringify({ cenario: "s5-3MB", ms: Date.now() - inicio })}`)
  }, 120_000)
})

describe("revisão do vídeo (26/10/2026)", () => {
  /** The attachment of a video, as `preparar` does it, to publish by hand on a channel that is not the feed. */
  async function anexoDe(bytes: Uint8Array, nome: string): Promise<{ sha: string; anexo: Record<string, unknown> }> {
    const sha = await resumoDoVideo(bytes)
    return {
      sha,
      anexo: {
        url: "",
        key: "",
        nonce: "",
        digest: "",
        kind: "video",
        name: nome,
        mediaType: "video/mp4",
        duration: 8,
        byteLength: bytes.length,
        poster: POSTER,
        partes: { n: partesDoVideo(bytes.length), sha256: sha, bytes: VIDEO_BYTES_POR_PARTE },
      },
    }
  }

  it("achado 8: a Carla recebe a publicação pelo instantâneo (do Bruno, com a Ana fora) e consegue o vídeo", async () => {
    const [ana, bruno, carla] = await contas("Ana", "Bruno", "Carla")
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const bytes = bytesSinteticos(VIDEO_BYTES_POR_PARTE + VIDEO_BYTES_POR_PARTE / 2)
    const { sha, anexo } = await anexoDe(bytes, "lagar.mp4")
    const id = crypto.randomUUID()
    await ana!.session.send(canal, { t: "post", id, postedAt: Date.now(), caption: "o lagar", media: [anexo], links: [], tags: [] } as never)
    const n = partesDoVideo(bytes.length)
    for (let parte = 0; parte < n; parte++) {
      const dados = bytesParaBase64(bytes.subarray(parte * VIDEO_BYTES_POR_PARTE, (parte + 1) * VIDEO_BYTES_POR_PARTE))
      await ana!.session.send(canal, { t: "typing", until: 0, video: { sha, parte, de: n, dados } })
    }
    await ate(() => bruno!.session.estadoDoVideo(sha).fase === "pronto", "o Bruno tem o vídeo", 30_000)

    // Ana leaves before Carla arrives: what Carla has of the publication can only come from Bruno's report.
    ana!.session.disconnect()
    await bruno!.session.seat(canal, carla!.address)
    await ate(() => carla!.session.channels.includes(canal), "a Carla entra")
    await ate(() => carla!.session.history(canal).some((e) => e.payload["id"] === id), "a publicação chega à Carla", 60_000)
    const chegada = carla!.session.history(canal).find((e) => e.payload["id"] === id)!
    expect((chegada.payload["media"] as Record<string, unknown>[])[0]).toEqual({ evicted: true, name: "lagar.mp4", mediaType: "video/mp4" })
    expect(carla!.session.estadoDoVideo(sha).fase).toBe("sem-bytes")

    const desfecho = await carla!.session.pedirAnexo(canal, id, 0)
    expect(desfecho.ok).toBe(true)
    const recebidos = carla!.session.bytesDoVideo(sha)
    expect(recebidos).not.toBeNull()
    expect(await resumoDoVideo(recebidos!)).toBe(sha)
  }, 180_000)

  it("achado 6: um vídeo de 1 MB cancelado não fica no cofre de quem publicou", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    await feedCom(ana!, bruno!)
    // 1.5 MB: two parts, and 2 million characters, which fit in the vault.
    const bytes = bytesSinteticos(VIDEO_BYTES_POR_PARTE + VIDEO_BYTES_POR_PARTE / 2)
    const sha = await resumoDoVideo(bytes)
    ana!.session.on("video", (evento) => {
      if (evento.fase === "a-enviar" && evento.feitas === 1) ana!.session.cancelarEnvioDeVideo()
    })
    // Before cancellation, the bytes were in the vault: that proves they were removed.
    let estavaNoCofre = false
    ana!.session.on("video", (evento) => {
      if (evento.sha === sha && evento.fase === "a-enviar") estavaNoCofre ||= ana!.vault.contents.videos?.[sha] !== undefined
    })
    await expect(
      ana!.session.publicarVideo("vai ser cancelado", [], {}, { bytes, name: "x.mp4", mediaType: "video/mp4", duration: 3 }),
    ).rejects.toThrow("the video upload was cancelled")
    expect(estavaNoCofre).toBe(true)
    expect(ana!.vault.contents.videos?.[sha]).toBeUndefined()
    expect(ana!.session.bytesDoVideo(sha)).toBeNull()
  }, 60_000)

  it("achado 6: apagar a publicação tira o vídeo do cofre de quem o recebeu", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    await feedCom(ana!, bruno!)
    const bytes = bytesSinteticos(VIDEO_BYTES_POR_PARTE)
    const sha = await resumoDoVideo(bytes)
    const id = await ana!.session.publicarVideo("vai ser apagado", [], {}, { bytes, name: "x.mp4", mediaType: "video/mp4", duration: 3 })
    await ate(() => bruno!.vault.contents.videos?.[sha] !== undefined, "o vídeo fica no cofre do Bruno", 30_000)
    expect(ana!.vault.contents.videos?.[sha]).toBeDefined()
    await ana!.session.deletePost(id)
    await ate(() => bruno!.vault.contents.videos?.[sha] === undefined, "o vídeo sai do cofre do Bruno", 30_000)
    await ate(() => ana!.vault.contents.videos?.[sha] === undefined, "e do da Ana", 30_000)
    expect(bruno!.session.bytesDoVideo(sha)).toBeNull()
  }, 60_000)

  it("achado 7: uma falha a meio apaga a publicação, e publicar outra vez não a duplica", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const feed = await feedCom(ana!, bruno!)
    const bytes = bytesSinteticos(3 * VIDEO_BYTES_POR_PARTE)
    const sha = await resumoDoVideo(bytes)
    // The second part is not sent (the connection dropped, for example).
    const enviar = ana!.session.send.bind(ana!.session)
    let partes = 0
    ana!.session.send = async (canal, payload) => {
      if (payload.t === "typing" && (payload as { video?: unknown }).video && ++partes === 2) throw new Error("not connected")
      return enviar(canal, payload)
    }
    await expect(
      ana!.session.publicarVideo("vai falhar", [], {}, { bytes, name: "x.mp4", mediaType: "video/mp4", duration: 3 }),
    ).rejects.toThrow("the video upload failed")
    expect(ana!.session.bytesDoVideo(sha)).toBeNull()
    const primeira = publicacoes(ana!, feed)[0]?.["id"]
    await ate(
      () => bruno!.session.history(feed).some((e) => e.payload.t === "redact" && e.payload["target"] === primeira),
      "a lápide da publicação partida chega ao Bruno",
      30_000,
    )
    // Retry: a new publication, and the broken one stays deleted. Only one is live.
    ana!.session.send = enviar
    const segunda = await ana!.session.publicarVideo("outra vez", [], {}, { bytes, name: "x.mp4", mediaType: "video/mp4", duration: 3 })
    await ate(() => bruno!.session.estadoDoVideo(sha).fase === "pronto", "o vídeo chega ao Bruno", 30_000)
    const apagadas = new Set(
      bruno!.session
        .history(feed)
        .filter((e) => e.payload.t === "redact")
        .map((e) => e.payload["target"]),
    )
    const vivas = publicacoes(bruno!, feed).filter((p) => !apagadas.has(p["id"]))
    expect(vivas.map((p) => p["id"])).toEqual([segunda])
  }, 90_000)

  it("N3: duas chamadas seguidas com o mesmo ficheiro: a segunda recusa antes de publicar, e os bytes ficam", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const feed = await feedCom(ana!, bruno!)
    const bytes = bytesSinteticos(3 * VIDEO_BYTES_POR_PARTE)
    const sha = await resumoDoVideo(bytes)
    const video = { bytes, name: "a.mp4", mediaType: "video/mp4", duration: 3 }
    // Without the interface guard: both in the same tick, before `preparar` finishes.
    const primeiro = ana!.session.publicarVideo("o primeiro", [], {}, video)
    const segundo = ana!.session.publicarVideo("o segundo", [], {}, video)
    await expect(segundo).rejects.toThrow("a video upload is already in progress")
    await primeiro
    expect(publicacoes(ana!, feed).map((p) => p["caption"])).toEqual(["o primeiro"])
    expect(ana!.session.bytesDoVideo(sha)).not.toBeNull()
    await ate(() => bruno!.session.estadoDoVideo(sha).fase === "pronto", "o vídeo chega ao Bruno", 30_000)
  }, 60_000)

  it("N2: se a publicação nem sai, os bytes não ficam no cofre", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    await feedCom(ana!, bruno!)
    const bytes = bytesSinteticos(VIDEO_BYTES_POR_PARTE + VIDEO_BYTES_POR_PARTE / 2)
    const sha = await resumoDoVideo(bytes)
    // The `post` is refused (no connection, or server rate limit), after `preparar` has saved the bytes.
    let estavaNoCofre = false
    ana!.session.post = async () => {
      estavaNoCofre = ana!.vault.contents.videos?.[sha] !== undefined
      throw new Error("not connected")
    }
    await expect(
      ana!.session.publicarVideo("não sai", [], {}, { bytes, name: "x.mp4", mediaType: "video/mp4", duration: 3 }),
    ).rejects.toThrow("not connected")
    expect(estavaNoCofre).toBe(true)
    expect(ana!.vault.contents.videos?.[sha]).toBeUndefined()
    expect(ana!.session.bytesDoVideo(sha)).toBeNull()
  }, 60_000)

  it("achado 5: com um envio em curso, outro publicar recusa antes de publicar", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const feed = await feedCom(ana!, bruno!)
    const primeiro = ana!.session.publicarVideo("o primeiro", [], {}, {
      bytes: bytesSinteticos(3 * VIDEO_BYTES_POR_PARTE),
      name: "a.mp4",
      mediaType: "video/mp4",
      duration: 3,
    })
    await new Promise<void>((resolver) => {
      const largar = ana!.session.on("video", (evento) => {
        if (evento.fase === "a-enviar") {
          largar?.()
          resolver()
        }
      })
    })
    await expect(
      ana!.session.publicarVideo("o segundo", [], {}, { bytes: bytesSinteticos(10), name: "b.mp4", mediaType: "video/mp4", duration: 1 }),
    ).rejects.toThrow("a video upload is already in progress")
    await primeiro
    expect(publicacoes(ana!, feed).map((p) => p["caption"])).toEqual(["o primeiro"])
  }, 60_000)
})

describe.skipIf(!process.env["MEDIR_VIDEO"])("medidas (MEDIR_VIDEO=1)", () => {
  /**
   * Publishes through the low-level path (the publication and the parts by hand). Up to
   * the cap: since the 26/10/2026 review, the receiver rejects an attachment
   * above `VIDEO_MAX_BYTES` (this is where 30 MB used to be measured).
   */
  async function emBruto(autor: ContaDeTeste, feed: string, bytes: Uint8Array): Promise<{ sha: string; envioMs: number }> {
    const sha = await resumoDoVideo(bytes)
    const n = partesDoVideo(bytes.length)
    const inicio = Date.now()
    await autor.session.post("medida", [], {
      media: [
        {
          url: "",
          key: "",
          nonce: "",
          digest: "",
          kind: "video",
          name: "medida.mp4",
          mediaType: "video/mp4",
          duration: 60,
          byteLength: bytes.length,
          partes: { n, sha256: sha, bytes: VIDEO_BYTES_POR_PARTE },
        },
      ],
    })
    for (let parte = 0; parte < n; parte++) {
      const dados = bytesParaBase64(bytes.subarray(parte * VIDEO_BYTES_POR_PARTE, (parte + 1) * VIDEO_BYTES_POR_PARTE))
      await autor.session.send(feed, { t: "typing", until: 0, video: { sha, parte, de: n, dados } })
    }
    return { sha, envioMs: Date.now() - inicio }
  }

  it.each([5, 15, 25])("%i MB: o tempo de quem envia e o de quem recebe, e o peso de cada trama", async (mb) => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const feed = await feedCom(ana!, bruno!)
    const bytes = bytesSinteticos(mb * 1024 * 1024)
    const inicio = Date.now()
    const { sha, envioMs } = await emBruto(ana!, feed, bytes)
    await ate(() => bruno!.session.estadoDoVideo(sha).fase === "pronto", "o vídeo chega inteiro", 300_000)
    const recebidoMs = Date.now() - inicio
    expect(await resumoDoVideo(bruno!.session.bytesDoVideo(sha)!)).toBe(sha)

    const base = new DatabaseSync(servidor.baseDeDados, { readOnly: true })
    const linhas = base
      .prepare("SELECT length(ciphertext) AS bytes FROM events WHERE channel = ? AND kind = 'application' ORDER BY seq")
      .all(feed) as { bytes: number }[]
    base.close()
    const maior = Math.max(...linhas.map((linha) => linha.bytes))
    console.log(
      `MEDIDA-VIDEO ${JSON.stringify({
        mb,
        partes: partesDoVideo(bytes.length),
        envioMs,
        recebidoMs,
        maiorTramaBytes: maior,
        maiorTramaSeladaBase64: Math.ceil(maior / 3) * 4,
        escritasDoCofreDeQuemEnvia: ana!.backend.escritas,
        mbPorSegundo: Number((mb / (recebidoMs / 1000)).toFixed(2)),
      })}`,
    )
  }, 320_000)

  it("15 MB com o cofre de quem envia cheio de média (cada parte grava o cofre)", async () => {
    const [ana, bruno] = await contas("Ana", "Bruno")
    const feed = await feedCom(ana!, bruno!)
    // An image that exhausts the vault's media budget (4 million characters).
    const imagem = `data:image/png;base64,${bytesParaBase64(bytesSinteticos(2_900_000))}`
    await ana!.session.post("cheio", [], { media: [{ url: "", key: "", nonce: "", digest: "", kind: "image", name: "f.png", mediaType: "image/png", byteLength: 2_900_000, inline: imagem }] })
    await ana!.session.flush()
    const cofreMB = (ana!.backend.bytes?.length ?? 0) / 1024 / 1024
    const inicio = Date.now()
    const { sha, envioMs } = await emBruto(ana!, feed, bytesSinteticos(15 * 1024 * 1024))
    await ate(() => bruno!.session.estadoDoVideo(sha).fase === "pronto", "o vídeo chega inteiro", 300_000)
    console.log(
      `MEDIDA-VIDEO ${JSON.stringify({ mb: 15, cofreDeQuemEnviaMB: Number(cofreMB.toFixed(1)), envioMs, recebidoMs: Date.now() - inicio })}`,
    )
  }, 320_000)

  it("o tecto do servidor: 600 envios por minuto, contados", () => {
    // Not a measure of time: it is the calculation that the report uses, written where the suite sees it.
    const partesNoTecto = partesDoVideo(25 * 1024 * 1024)
    expect(partesNoTecto).toBe(25)
    expect(partesNoTecto).toBeLessThan(600)
    expect(TECTOS_DOS_ANEXOS.bytesDeVideoPorCanalPorDia).toBeGreaterThanOrEqual(25 * 1024 * 1024)
  })
})
