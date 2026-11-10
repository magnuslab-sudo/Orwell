import { ed25519 } from "@noble/curves/ed25519.js"
import { abrirSinal, selarSinal } from "@enclave/crypto"
import { fromBase64, toBase64, VIDEO_BYTES_POR_PARTE, type Attachment, type Payload, type RelatosNoFio } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { appendHistory, entradasDoCanal, guardarVideo, newVaultContents, type StoredPayload, type VaultContents } from "../vault.js"
import { resumoDoVideo, VideosDaSessao } from "../videos.js"
import { TECTOS_DA_SINCRONIA, type Folha } from "./eleicao.js"
import { anexoEm, comAnexo, resumoDoAnexo, TECTOS_DOS_ANEXOS } from "./instantaneo.js"
import { _paraTestes, AntiEntropia, comAutoria, type PortaDaAntiEntropia } from "./pedido.js"
import { normalizar, type QuemRelata } from "./relato.js"
import { chaveCurta, itemDoPayload } from "./resumo.js"

/**
 * On-demand video (S5) in a memory network, like the one in `instantaneo.test.ts`,
 * with a `VideosDaSessao` at each node: parts go to all others, like a stored
 * `typing`. Findings 4, 8, 9, 12 and 14 from the video review (26/10/2026).
 * With real sessions and server: `apps/server/src/video-publicacao.test.ts`.
 */

const CANAL = "!lagar:orwell.test"
const CHAVE = { epoca: 1n, chave: new Uint8Array(32).fill(7) }

interface No {
  nome: string
  eu: QuemRelata
  folha: Folha
  contents: VaultContents
  anti: AntiEntropia
  videos: VideosDaSessao
  lugar: number
  /** The bodies of signals this node sent, in order. */
  corpos: Record<string, unknown>[]
  /** How many video parts this node received. */
  partesRecebidas: number
}

class Rede {
  nos: No[] = []
  seq = 1_000
  emVoo = 0
  /** Signals from this node don't propagate outward (a silent leaf). */
  calado: No | null = null

  criar(nome: string, indice: number): No {
    const privada = new Uint8Array(32).fill(indice + 1)
    const eu: QuemRelata = {
      address: `@${nome}:orwell.test`,
      aparelho: ed25519.getPublicKey(privada),
      assinar: (m) => ed25519.sign(m, privada),
    }
    const contents = newVaultContents()
    const folha: Folha = { indice, address: eu.address, aparelho: toBase64(eu.aparelho) }
    const rede = this
    const videos = new VideosDaSessao({
      conteudo: () => contents,
      guardarNoCofre: async (sha, b64) => guardarVideo(contents, sha, b64, 1),
      enviarParte: async (_canal, parte) => {
        rede.#entregar(no, (outro) => {
          outro.partesRecebidas += 1
          return outro.videos.aoParte(CANAL, parte, folha.aparelho)
        })
      },
      emitir: () => {},
      aoChegar: (canal, sha, completo, aparelho) => no.anti.aoVideo(canal, sha, completo, aparelho),
    })
    const porta: PortaDaAntiEntropia = {
      eu,
      conteudo: () => contents,
      podeSinalizar: () => true,
      elegivel: () => true,
      ehDirecta: () => false,
      membros: () => rede.nos.map((n) => n.eu.address),
      folhas: () => rede.nos.map((n) => n.folha),
      epocaAtual: () => 1n,
      derivarChave: async () => CHAVE,
      lugar: () => no.lugar,
      ancora: () => rede.seq,
      enviarSinal: (_canal, sinal) => {
        no.corpos.push(corpoDe(sinal))
        if (rede.calado === no) return
        rede.#entregar(no, (outro) => outro.anti.aoSinal({ channel: CANAL, from: eu.address, sinal }))
      },
      enviarRelatos: async (_canal, relatos: RelatosNoFio) => {
        const seq = ++rede.seq
        rede.#entregar(no, (outro) => outro.anti.aoRelatos(CANAL, seq, relatos, folha.aparelho))
      },
      gravarRelatado: (_canal, seq, autor, payload: Payload) => {
        const p = payload as unknown as StoredPayload
        if (p.t === "room.created") {
          contents.channelFounder[CANAL] = { address: autor, seq, payload: p } as never
          return
        }
        if (p.t === "channel.meta") {
          contents.channelRooms[CANAL] = { ...contents.channelRooms[CANAL], [String(p["room"])]: { at: 0, payload: p, por: autor, seq } } as never
          return
        }
        appendHistory(contents, CANAL, { seq, sender: autor, at: 0, payload: p })
        // Like `#recordPayload` in the session: videos in a post become expected.
        if (p.t === "post") videos.esperar(CANAL, p["media"])
      },
      escoar: async () => {},
      marcarParaGravar: () => {},
      aparelhoConfiavel: async (_canal, autor, aparelho) => rede.nos.some((n) => n.eu.address === autor && n.folha.aparelho === aparelho),
      cadeiaDe: () => null,
      bloqueado: () => false,
      online: () => true,
      agora: () => Date.now(),
      // Like `#gravarAnexo` in the session: in place of the marker, in the vault.
      gravarAnexo: async (_canal, autor, alvo, indice, anexo) => {
        for (const entrada of entradasDoCanal(contents, CANAL)) {
          if (entrada.sender !== autor || entrada.payload["id"] !== alvo) continue
          const novo = comAnexo(entrada.payload, indice, anexo)
          if (novo) entrada.payload = novo as StoredPayload
        }
      },
      bytesDoVideo: (sha) => videos.bytes(sha),
      servirVideo: (canal, sha, q, vez) => videos.servir(canal, sha, q, vez),
      esperarVideo: (canal, anexo) => videos.esperar(canal, [anexo]),
    }
    const no: No = { nome, eu, folha, contents, anti: new AntiEntropia(porta), videos, lugar: -1, corpos: [], partesRecebidas: 0 }
    this.nos.push(no)
    return no
  }

  #entregar(de: No, fazer: (outro: No) => Promise<void>): void {
    for (const outro of this.nos) {
      if (outro === de) continue
      this.emVoo += 1
      setTimeout(() => {
        void fazer(outro).finally(() => {
          this.emVoo -= 1
        })
      }, 1)
    }
  }
}

/** The body of a signal, opened. */
function corpoDe(sinal: string): Record<string, unknown> {
  const aberto = abrirSinal(CHAVE, CANAL, fromBase64(sinal))
  return aberto ? (JSON.parse(new TextDecoder().decode(aberto)) as { c: Record<string, unknown> }).c : {}
}

async function ateSilencio(rede: Rede, ms = 8_000): Promise<void> {
  const inicio = Date.now()
  let calmo = 0
  while (Date.now() - inicio < ms) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    calmo = rede.emVoo === 0 ? calmo + 1 : 0
    if (calmo >= 25) return
  }
}

/** A signal written by hand, signed by `de`. */
function sinalDe(de: No, corpo: Record<string, unknown>): string {
  const assinatura = de.eu.assinar(_paraTestes.mensagemDoSinal(CANAL, de.eu.address, CHAVE.epoca, corpo as never))
  const envelope = { ap: de.folha.aparelho, as: toBase64(assinatura), c: corpo }
  return toBase64(selarSinal(CHAVE, CANAL, new TextEncoder().encode(JSON.stringify(envelope))))
}

const bytes = (n: number, semente = 1): Uint8Array => new Uint8Array(n).map((_, i) => (i * 31 + semente) & 0xff)

const TECTOS_ORIGINAIS = { sincronia: { ...TECTOS_DA_SINCRONIA }, anexos: { ...TECTOS_DOS_ANEXOS } }
beforeEach(() => {
  TECTOS_DA_SINCRONIA.passoDaSupressaoMs = 150
  TECTOS_DOS_ANEXOS.esperaMs = 2_000
})
afterEach(() => {
  Object.assign(TECTOS_DA_SINCRONIA, TECTOS_ORIGINAIS.sincronia)
  Object.assign(TECTOS_DOS_ANEXOS, TECTOS_ORIGINAIS.anexos)
})

const ID = "post-video-0000"

/**
 * Ana publishes a 1.5 MB video (two parts) to a channel. Members in
 * `comBytes` have the full post and the bytes; Carlos joins at 500 with nothing.
 */
async function canalComVideo(nomes: readonly string[], comBytes: readonly string[], tamanho = VIDEO_BYTES_POR_PARTE + VIDEO_BYTES_POR_PARTE / 2) {
  const rede = new Rede()
  const nos = nomes.map((nome, indice) => rede.criar(nome, indice))
  const ana = nos[0]!
  const carla = rede.criar("carla", nos.length)
  carla.lugar = 500
  const video = { bytes: bytes(tamanho), name: "lagar.mp4", mediaType: "video/mp4", duration: 9, poster: "data:image/webp;base64,UklGRg==" }
  let anexo: Attachment | null = null
  let sha = ""
  for (const no of nos) {
    if (!comBytes.includes(no.nome)) continue
    const preparado = await no.videos.preparar(video)
    anexo = preparado.anexo
    sha = preparado.sha
  }
  const post = comAutoria(CANAL, { t: "post", id: ID, postedAt: 100, caption: "o lagar", media: [anexo] } as never, ana.eu) as unknown as StoredPayload
  const fundacao = comAutoria(CANAL, { t: "room.created", name: "Lagar", createdAt: 1 } as never, ana.eu) as unknown as StoredPayload
  for (const no of nos) {
    appendHistory(no.contents, CANAL, { seq: 100, sender: ana.eu.address, at: 100, payload: post })
    no.contents.channelFounder[CANAL] = { address: ana.eu.address, seq: 1, payload: fundacao } as never
  }
  for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarCapacidades(CANAL, outro.folha.aparelho, ["sincronia-v1"])
  expect(sha).toBe(await resumoDoVideo(video.bytes))
  return { rede, nos, ana, carla, post, anexo: anexo as unknown as Record<string, unknown>, sha }
}

const pedidosDeAnexo = (no: No): Record<string, unknown>[] => no.corpos.filter((corpo) => corpo["k"] === "pa")

describe("o vídeo a quem recebeu a publicação por relato (achado 8)", () => {
  it("a Carla recebe a publicação pelo instantâneo, sem partes; pede, recebe o anexo, confere-o, e só depois as partes", async () => {
    const { rede, carla, sha } = await canalComVideo(["ana", "bruno"], ["ana", "bruno"])
    await carla.anti.aoWelcome(CANAL)
    await ateSilencio(rede)
    const daCarla = entradasDoCanal(carla.contents, CANAL).find((e) => e.payload["id"] === ID)!
    // The snapshot carries the attachment without bytes: the marker, no parts.
    expect((daCarla.payload["media"] as Record<string, unknown>[])[0]).toEqual({ evicted: true, name: "lagar.mp4", mediaType: "video/mp4" })

    const desfecho = await carla.anti.pedirAnexo(CANAL, ID, 0)
    expect(desfecho.ok).toBe(true)
    expect(await resumoDoVideo(carla.videos.bytes(sha)!)).toBe(sha)
    // The attachment with parts and thumbnail ended up in the vault, replacing the marker.
    const depois = entradasDoCanal(carla.contents, CANAL).find((e) => e.payload["id"] === ID)!
    expect((depois.payload["media"] as Record<string, unknown>[])[0]).toMatchObject({ partes: { sha256: sha }, poster: "data:image/webp;base64,UklGRg==" })
    // Two passes: the first without `v`, the second with it.
    const pedidos = pedidosDeAnexo(carla)
    expect(pedidos[0]).not.toHaveProperty("v")
    expect(pedidos.at(-1)).toMatchObject({ v: sha })
    // Parts only went out once, on the second pass: none were consumed before the attachment.
    expect(carla.partesRecebidas).toBe(2)
  })

  it("um pedido sem `v` não recebe partes: recebe o anexo sem bytes", async () => {
    const { rede, ana, carla, post } = await canalComVideo(["ana"], ["ana"])
    const c = chaveCurta(itemDoPayload(ana.eu.address, post, CANAL)!.chave)
    const m = (post["autoria"] as { m: string[] }).m[0]
    await ana.anti.aoSinal({ channel: CANAL, from: carla.eu.address, sinal: sinalDe(carla, { k: "pa", id: "anx.semv", para: ana.folha.aparelho, l: 500, c, i: 0, m }) })
    await ateSilencio(rede)
    expect(carla.partesRecebidas).toBe(0)
    expect(ana.anti.estatisticas.anexosEnviados).toBe(1)
  })
})

describe("servir um vídeo não pára a fila do canal (achado 4)", () => {
  it("um sinal do canal é tratado enquanto as partes esperam pelo tecto do minuto", async () => {
    const { rede, ana, carla, post, anexo, sha } = await canalComVideo(["ana"], ["ana"])
    // Carlos already has the attachment with parts: requests immediately with `v`.
    appendHistory(carla.contents, CANAL, { seq: 100, sender: ana.eu.address, at: 100, payload: post })
    carla.videos.esperar(CANAL, [anexo])
    // One part per minute: the second waits its turn.
    TECTOS_DOS_ANEXOS.bytesPorMinuto = Math.ceil((VIDEO_BYTES_POR_PARTE * 4) / 3) + 1_000
    const c = chaveCurta(itemDoPayload(ana.eu.address, post, CANAL)!.chave)
    const m = (post["autoria"] as { m: string[] }).m[0]
    await ana.anti.aoSinal({ channel: CANAL, from: carla.eu.address, sinal: sinalDe(carla, { k: "pa", id: "anx.video", para: ana.folha.aparelho, l: 500, c, i: 0, m, v: sha }) })
    await ateSilencio(rede, 1_000)
    expect(carla.partesRecebidas).toBe(1)
    // Another signal to the same channel: it gets handled right away, not a minute from now.
    const tratado = ana.anti
      .aoSinal({ channel: CANAL, from: carla.eu.address, sinal: sinalDe(carla, { k: "pa", id: "anx.outro", para: ana.folha.aparelho, l: 500, c, i: 0, m, v: sha }) })
      .then(() => "tratado")
    const preso = new Promise((resolver) => setTimeout(() => resolver("preso"), 1_500))
    expect(await Promise.race([tratado, preso])).toBe("tratado")
    rede.calado = ana
  })
})

describe("os tectos de quem serve contam base64 (achado 9)", () => {
  it("o tecto do dia recusa um vídeo cujos bytes crus cabiam e a base64 não", async () => {
    const { rede, ana, carla, post, anexo, sha } = await canalComVideo(["ana"], ["ana"])
    appendHistory(carla.contents, CANAL, { seq: 100, sender: ana.eu.address, at: 100, payload: post })
    carla.videos.esperar(CANAL, [anexo])
    const crus = VIDEO_BYTES_POR_PARTE + VIDEO_BYTES_POR_PARTE / 2
    TECTOS_DOS_ANEXOS.bytesDeVideoPorCanalPorDia = Math.floor(crus * 1.2)
    const c = chaveCurta(itemDoPayload(ana.eu.address, post, CANAL)!.chave)
    const m = (post["autoria"] as { m: string[] }).m[0]
    await ana.anti.aoSinal({ channel: CANAL, from: carla.eu.address, sinal: sinalDe(carla, { k: "pa", id: "anx.dia", para: ana.folha.aparelho, l: 500, c, i: 0, m, v: sha }) })
    await ateSilencio(rede, 1_000)
    expect(carla.partesRecebidas).toBe(0)
    expect(ana.corpos.at(-1)).toMatchObject({ k: "ri", id: "anx.dia", de: 0 })
  })
})

describe("o prazo só se adia com partes da folha eleita (recomendação 12)", () => {
  it("partes de outro aparelho não seguram o pedido à espera de uma folha calada", async () => {
    const { rede, ana, carla, post, anexo, sha } = await canalComVideo(["ana"], ["ana"])
    appendHistory(carla.contents, CANAL, { seq: 100, sender: ana.eu.address, at: 100, payload: post })
    carla.videos.esperar(CANAL, [anexo])
    // Ana doesn't respond to anything; another device sends loose parts.
    rede.calado = ana
    ana.anti = { aoSinal: async () => {}, aoRelatos: async () => {} } as unknown as AntiEntropia
    TECTOS_DOS_ANEXOS.esperaMs = 300
    TECTOS_DOS_ANEXOS.janelaMs = 300
    TECTOS_DOS_ANEXOS.tentativas = 1
    const pulso = setInterval(() => carla.anti.aoVideo(CANAL, sha, false, "outro-aparelho"), 100)
    const inicio = Date.now()
    try {
      const desfecho = await carla.anti.pedirAnexo(CANAL, ID, 0)
      expect(desfecho).toEqual({ ok: false, motivo: "ninguem" })
      expect(Date.now() - inicio).toBeLessThan(1_500)
    } finally {
      clearInterval(pulso)
    }
  })
})

describe("quem serve confere o `m` da autoria (recomendação 14)", () => {
  it("um anexo trocado no cofre de quem serve não sai, mesmo que dê o `m` do pedido", async () => {
    const { rede, ana, carla, post } = await canalComVideo(["ana"], ["ana"])
    // Ana's vault has another video (with bytes) replacing the one the author signed.
    const { anexo: falso } = await ana.videos.preparar({ bytes: bytes(10), name: "lagar.mp4", mediaType: "video/mp4", duration: 1 })
    const entrada = entradasDoCanal(ana.contents, CANAL).find((e) => e.payload["id"] === ID)!
    entrada.payload = comAnexo(entrada.payload, 0, falso) as StoredPayload
    const c = chaveCurta(itemDoPayload(ana.eu.address, post, CANAL)!.chave)
    // Carlos requests by the fake attachment's digest (what Ana's vault gives), not the author's.
    const m = resumoDoAnexo(anexoEm(normalizar(entrada.payload as Record<string, unknown>)!, 0))
    expect(m).not.toBe((post["autoria"] as { m: string[] }).m[0])
    await ana.anti.aoSinal({ channel: CANAL, from: carla.eu.address, sinal: sinalDe(carla, { k: "pa", id: "anx.falso", para: ana.folha.aparelho, l: 500, c, i: 0, m }) })
    await ateSilencio(rede, 1_000)
    expect(ana.anti.estatisticas.anexosEnviados).toBe(0)
    expect(ana.corpos.at(-1)).toMatchObject({ k: "ri", id: "anx.falso", de: 0 })
  })
})

/*
  The timeout for video requests against the one-minute wait (N1 from re-review
  26/10/2026). The server sends parts that fit in the window and waits; with a
  30 s timeout on an attachment, the request would fail midway ("nobody has it"
  with Ana serving) and each subsequent leaf would serve the whole video again.
  Here the window is 800 ms and fits one part per window; real numbers (two 1.4 MB
  parts in 4 MiB per 60 s) are measured in `apps/server/src/video-publicacao.test.ts`.
*/
describe("o prazo do pedido de vídeo conta com a janela do minuto (N1)", () => {
  const JANELA = 800
  const TRES_PARTES = VIDEO_BYTES_POR_PARTE * 2 + VIDEO_BYTES_POR_PARTE / 2
  beforeEach(() => {
    TECTOS_DOS_ANEXOS.esperaMs = 300
    TECTOS_DOS_ANEXOS.janelaMs = JANELA
    // One part per window: the second and third wait their turn, longer than `esperaMs`.
    TECTOS_DOS_ANEXOS.bytesPorMinuto = Math.ceil((VIDEO_BYTES_POR_PARTE * 4) / 3) + 1_000
  })

  /** Carlos already has the attachment with parts (requests immediately with `v`); members in `comBytes` have the bytes. */
  async function pronto(nomes: readonly string[], comBytes: readonly string[]) {
    const canal = await canalComVideo(nomes, comBytes, TRES_PARTES)
    appendHistory(canal.carla.contents, CANAL, { seq: 100, sender: canal.ana.eu.address, at: 100, payload: canal.post })
    canal.carla.videos.esperar(CANAL, [canal.anexo])
    return canal
  }

  it("com uma folha, o pedido espera pelas partes e acaba bem", async () => {
    const { carla, sha } = await pronto(["ana"], ["ana"])
    const inicio = Date.now()
    const desfecho = await carla.anti.pedirAnexo(CANAL, ID, 0)
    expect(desfecho.ok).toBe(true)
    expect(await resumoDoVideo(carla.videos.bytes(sha)!)).toBe(sha)
    // Two window waits, each longer than `esperaMs`: the old timeout would drop the request on the first.
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(2 * JANELA)
    expect(carla.partesRecebidas).toBe(3)
  })

  it("com duas folhas, só uma serve o vídeo", async () => {
    const { rede, nos, carla, sha } = await pronto(["ana", "bruno"], ["ana", "bruno"])
    const desfecho = await carla.anti.pedirAnexo(CANAL, ID, 0)
    expect(desfecho.ok).toBe(true)
    expect(await resumoDoVideo(carla.videos.bytes(sha)!)).toBe(sha)
    await ateSilencio(rede, 3 * JANELA)
    // Three parts, not six: the second leaf was never picked.
    expect(carla.partesRecebidas).toBe(3)
    expect(pedidosDeAnexo(carla)).toHaveLength(1)
    expect(nos.reduce((soma, no) => soma + no.anti.estatisticas.anexosEnviados, 0)).toBe(1)
  })

  it("quem pede desiste: a folha pára de servir", async () => {
    const { rede, ana, carla } = await pronto(["ana"], ["ana"])
    const pedido = carla.anti.pedirAnexo(CANAL, ID, 0)
    while (carla.partesRecebidas < 1) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(carla.anti.cancelarAnexo(CANAL, ID, 0)).toBe(true)
    expect(await pedido).toEqual({ ok: false, motivo: "cancelado" })
    const pa = pedidosDeAnexo(carla).at(-1)!
    expect(carla.corpos.at(-1)).toEqual({ k: "ri", id: pa["id"], de: 0 })
    await new Promise((resolve) => setTimeout(resolve, 3 * JANELA))
    await ateSilencio(rede, JANELA)
    expect(carla.partesRecebidas).toBe(1)
    expect(ana.anti.estatisticas.anexosEnviados).toBe(0)
  })

  it("a folha que se cala e volta não serve o vídeo inteiro depois de largada", async () => {
    const { rede, ana, carla, sha } = await pronto(["ana", "bruno"], ["ana", "bruno"])
    // Ana sends the first part and goes silent longer than the timeout; then tries the rest.
    const servir = ana.videos.servir.bind(ana.videos)
    let vezes = 0
    ana.videos.servir = (canal, video, q, vez) =>
      servir(canal, video, q, async (custo) => {
        vezes += 1
        if (vezes > 1) await new Promise((resolve) => setTimeout(resolve, 3 * (300 + JANELA)))
        return vez(custo)
      })
    const desfecho = await carla.anti.pedirAnexo(CANAL, ID, 0)
    expect(desfecho.ok).toBe(true)
    expect(await resumoDoVideo(carla.videos.bytes(sha)!)).toBe(sha)
    await new Promise((resolve) => setTimeout(resolve, 3 * (300 + JANELA)))
    await ateSilencio(rede, JANELA)
    // One part from Ana and three from Bruno. Without the flag, Ana would send the other two.
    expect(carla.partesRecebidas).toBe(4)
    const [daAna, doBruno] = pedidosDeAnexo(carla)
    expect(daAna!["id"]).not.toBe(doBruno!["id"])
    expect(carla.corpos).toContainEqual({ k: "ri", id: daAna!["id"], de: 0 })
  }, 15_000)
})
