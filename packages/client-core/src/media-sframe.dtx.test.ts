import { importSframeKey, readHeader, SframeSender } from "@enclave/crypto"
import type { UserAddress } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CifraDeMedia, MAIOR_QUADRO_DE_SILENCIO, quadroDeSilencio, type MaterialDeChave } from "./media-sframe.js"
import { servirCifraDeMedia, type Contagens, type EscopoDoWorker, type RespostaDeCifra } from "./media-sframe-worker.js"

/**
 * Phase M1: DTX for real.
 *
 * Measured on 2 November 2026 (`scripts/e2e-limiar-microfone.mjs`): in digital
 * silence the app sent 50 packets per second, with `usedtx=1` negotiated. Opus
 * delivered to encryption 47.5 frames per second of 2 bytes or less (the DTX
 * marker), and encryption added header and tag: the RTP sender stopped
 * recognizing them and sent them all. These tests prove the marker does not
 * leak, in BOTH encryption paths, and the receiver still rejects what does not
 * open.
 */

const EU = "@eu:enclave.test" as UserAddress
const OUTRO = "@outro:enclave.test" as UserAddress
const CANAL = "!sala:enclave.test"

const chave = (byte: number, keyId = 1): MaterialDeChave => ({ keyId, senderId: 3, material: new Uint8Array(28).fill(byte) })

/** What Opus delivers in silence with DTX: just the TOC, or TOC and one byte. */
const MARCADORES = [new Uint8Array([]), new Uint8Array([0x08]), new Uint8Array([0x08, 0x00])]
/** A voice frame (or the comfort of 400 em 400 ms): it has sound and carries on. */
const VOZ = new Uint8Array([0x08, 0x8b, 0x4f, 0x21, 0x9c])

type Quadro = { data: ArrayBuffer; type?: string }

/** Pass frames through a `TransformStream` transformation, with both ends under test control. */
function fluxos(): { readable: ReadableStream<Quadro>; writable: WritableStream<Quadro>; empurrar: (q: Quadro) => void; fechar: () => void; saida: Quadro[] } {
  const saida: Quadro[] = []
  let controlador!: ReadableStreamDefaultController<Quadro>
  const readable = new ReadableStream<Quadro>({ start: (c) => void (controlador = c) })
  const writable = new WritableStream<Quadro>({ write: (q) => void saida.push(q) })
  return { readable, writable, saida, empurrar: (q) => controlador.enqueue(q), fechar: () => controlador.close() }
}

const assentar = async (condicao: () => boolean = () => false, voltas = 50): Promise<void> => {
  for (let volta = 0; volta < voltas && !condicao(); volta++) await new Promise((resolve) => setTimeout(resolve, 1))
}

const audio = (bytes: Uint8Array): Quadro => ({ data: bytes.slice().buffer as ArrayBuffer })
const video = (bytes: Uint8Array): Quadro => ({ data: bytes.slice().buffer as ArrayBuffer, type: "delta" })

describe("quadroDeSilencio", () => {
  it("só o áudio de 2 bytes ou menos; o vídeo nunca", () => {
    expect(MAIOR_QUADRO_DE_SILENCIO).toBe(2)
    for (const marcador of MARCADORES) expect(quadroDeSilencio({}, marcador)).toBe(true)
    expect(quadroDeSilencio({}, new Uint8Array(3))).toBe(false)
    expect(quadroDeSilencio({}, VOZ)).toBe(false)
    for (const marcador of MARCADORES) expect(quadroDeSilencio({ type: "delta" }, marcador)).toBe(false)
  })
})

describe("o emissor no worker (RTCRtpScriptTransform)", () => {
  function worker(): { escopo: EscopoDoWorker; ordenar: (ordem: unknown) => void; respostas: RespostaDeCifra[] } {
    const ouvintes: ((evento: { data: unknown }) => void)[] = []
    const respostas: RespostaDeCifra[] = []
    const escopo: EscopoDoWorker = {
      onrtctransform: null,
      addEventListener: (_tipo, ouvinte) => void ouvintes.push(ouvinte),
      postMessage: (mensagem) => void respostas.push(mensagem),
    }
    servirCifraDeMedia(escopo)
    return { escopo, respostas, ordenar: (ordem) => ouvintes.forEach((ouvinte) => ouvinte({ data: ordem })) }
  }

  async function contagens(lado: ReturnType<typeof worker>): Promise<Contagens> {
    lado.ordenar({ t: "contar", eco: 99 })
    await assentar(() => lado.respostas.some((r) => r.t === "contagens"))
    const resposta = lado.respostas.find((r) => r.t === "contagens")
    if (resposta?.t !== "contagens") throw new Error("o worker não contou")
    return resposta.contagens
  }

  it("o marcador do DTX não se cifra nem se enfileira; a voz sim", async () => {
    const lado = worker()
    lado.ordenar({ t: "emissor", eco: 1, chave: chave(5), contador: 0 })
    await assentar(() => lado.respostas.length > 0)
    const f = fluxos()
    lado.escopo.onrtctransform?.({ transformer: { readable: f.readable, writable: f.writable, options: { papel: "emissor" } } })
    for (const marcador of MARCADORES) f.empurrar(audio(marcador))
    f.empurrar(audio(VOZ))
    for (const marcador of MARCADORES) f.empurrar(audio(marcador))
    f.fechar()
    await assentar(() => f.saida.length >= 1)
    await assentar()

    expect(f.saida).toHaveLength(1)
    const saiu = new Uint8Array(f.saida[0]!.data)
    // Encrypted, and with counter 0: the dropped marker used no nonce.
    expect(readHeader(saiu)?.counter).toBe(0)
    expect(await contagens(lado)).toEqual({ cifrados: 1, silencios: 6, abertos: 0, falhados: 0 })
  })

  it("um fotograma de vídeo pequeno cifra-se na mesma", async () => {
    const lado = worker()
    lado.ordenar({ t: "emissor", eco: 1, chave: chave(5), contador: 0 })
    await assentar(() => lado.respostas.length > 0)
    const f = fluxos()
    lado.escopo.onrtctransform?.({ transformer: { readable: f.readable, writable: f.writable, options: { papel: "emissor" } } })
    f.empurrar(video(new Uint8Array([0x10, 0x02])))
    f.fechar()
    await assentar(() => f.saida.length >= 1)
    expect(f.saida).toHaveLength(1)
    expect(f.saida[0]!.data.byteLength).toBeGreaterThan(2)
  })

  it("o receptor continua a recusar um quadro pequeno que não abre, e com silêncio no meio abre a voz toda", async () => {
    const material = chave(7)
    const lado = worker()
    lado.ordenar({ t: "receptor", eco: 1, address: OUTRO, chaves: [material] })
    await assentar(() => lado.respostas.length > 0)
    const emissor = new SframeSender(await importSframeKey(material.material, material.keyId, material.senderId))
    const f = fluxos()
    lado.escopo.onrtctransform?.({ transformer: { readable: f.readable, writable: f.writable, options: { papel: "receptor", address: OUTRO } } })
    // A marker in the clear, as an old sender or a router would put it: does not pass.
    for (const marcador of MARCADORES) f.empurrar(audio(marcador))
    // Voice, a DTX pause (nothing arrives from our side), voice again.
    f.empurrar(audio(await emissor.encrypt(VOZ.slice())))
    f.empurrar(audio(await emissor.encrypt(VOZ.slice())))
    f.fechar()
    await assentar(() => f.saida.length >= 2)
    await assentar()
    expect(f.saida).toHaveLength(2)
    expect([...new Uint8Array(f.saida[1]!.data)]).toEqual([...VOZ])
    expect(await contagens(lado)).toMatchObject({ abertos: 2, falhados: 3 })
  })
})

describe("o emissor na thread principal (insertable streams)", () => {
  beforeEach(() => {
    class Ponta {
      createEncodedStreams(): unknown {
        throw new Error("as pontas destes testes trazem os seus fluxos")
      }
    }
    vi.stubGlobal("RTCRtpSender", Ponta)
    vi.stubGlobal("RTCRtpReceiver", Ponta)
  })
  afterEach(() => vi.unstubAllGlobals())

  function cifra(avisos: string[] = []): CifraDeMedia {
    const c = new CifraDeMedia(
      {
        selfAddress: EU,
        mediaKey: async (_canal, address) => (address === EU ? chave(1) : chave(2)),
        reservarContadorSframe: async () => 0,
      },
      (code) => void avisos.push(code),
    )
    c.canal = CANAL
    return c
  }

  it("o marcador do DTX não se cifra nem se enfileira; a voz sim", async () => {
    const f = fluxos()
    const ponta = { createEncodedStreams: () => ({ readable: f.readable, writable: f.writable }) } as unknown as RTCRtpSender
    expect(await cifra().protegerEmissor(ponta)).toBe(true)
    for (const marcador of MARCADORES) f.empurrar(audio(marcador))
    f.empurrar(audio(VOZ))
    f.empurrar(audio(MARCADORES[1]!))
    f.empurrar(video(new Uint8Array([0x10, 0x02])))
    await assentar(() => f.saida.length >= 2)
    await assentar()
    expect(f.saida).toHaveLength(2)
    expect(readHeader(new Uint8Array(f.saida[0]!.data))?.counter).toBe(0)
    expect(f.saida[1]!.type).toBe("delta")
  })

  it("o silêncio do outro lado não acende a vigia da decifra", async () => {
    const avisos: string[] = []
    const c = cifra(avisos)
    const f = fluxos()
    const ponta = { createEncodedStreams: () => ({ readable: f.readable, writable: f.writable }) } as unknown as RTCRtpReceiver
    expect(await c.protegerReceptor(ponta, OUTRO)).toBe(true)
    const material = chave(2)
    const emissor = new SframeSender(await importSframeKey(material.material, material.keyId, material.senderId))
    // Voice, 3 s of DTX with nothing arriving, voice: no failures, no warnings.
    f.empurrar(audio(await emissor.encrypt(VOZ.slice())))
    await assentar(() => f.saida.length >= 1)
    f.empurrar(audio(await emissor.encrypt(VOZ.slice())))
    await assentar(() => f.saida.length >= 2)
    expect(f.saida).toHaveLength(2)
    expect(avisos).toEqual([])
  })
})

describe("comDtxNoOpus (malha)", () => {
  const SDP = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "a=rtpmap:63 red/48000/2",
    "a=fmtp:63 111/111",
    "a=rtpmap:9 G722/8000",
    "m=audio 9 UDP/TLS/RTP/SAVPF 112",
    "a=rtpmap:112 OPUS/48000/2",
    "m=video 9 UDP/TLS/RTP/SAVPF 96",
    "a=rtpmap:96 VP8/90000",
    "a=fmtp:96 x-google-start-bitrate=600",
    "",
  ].join("\r\n")

  it("pede DTX em todos os Opus, e só neles", async () => {
    const { comDtxNoOpus } = await import("./call.js")
    const saida = comDtxNoOpus(SDP)
    expect(saida).toContain("a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1\r\n")
    expect(saida).toContain("a=rtpmap:112 OPUS/48000/2\r\na=fmtp:112 usedtx=1\r\n")
    expect(saida).toContain("a=fmtp:63 111/111\r\n")
    expect(saida).toContain("a=fmtp:96 x-google-start-bitrate=600\r\n")
    expect(saida.split("\r\n").length).toBe(SDP.split("\r\n").length + 1)
  })

  it("não mexe no que já diz usedtx, nem numa descrição vazia", async () => {
    const { comDtxNoOpus } = await import("./call.js")
    const ja = SDP.replace("useinbandfec=1", "useinbandfec=1;usedtx=0")
    expect(comDtxNoOpus(ja)).toContain("a=fmtp:111 minptime=10;useinbandfec=1;usedtx=0\r\n")
    expect(comDtxNoOpus("")).toBe("")
    expect(comDtxNoOpus(comDtxNoOpus(SDP))).toBe(comDtxNoOpus(SDP))
  })
})

/*
 * Constant bitrate (3/11/2026). In variable bitrate the size of each voice
 * packet follows the sound, and that is enough to guess sentences (Wright et
 * al., "Spot me if you can"). With `cbr=1` the encoder for whoever reads this
 * fills each voice frame up to the same size; DTX still cuts the silence.
 */
describe("comDtxECbrNoOpus (malha)", () => {
  const SDP = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "a=rtpmap:63 red/48000/2",
    "a=fmtp:63 111/111",
    "a=rtpmap:9 G722/8000",
    "m=audio 9 UDP/TLS/RTP/SAVPF 112",
    "a=rtpmap:112 OPUS/48000/2",
    "m=video 9 UDP/TLS/RTP/SAVPF 96",
    "a=rtpmap:96 VP8/90000",
    "a=fmtp:96 x-google-start-bitrate=600",
    "",
  ].join("\r\n")

  it("pede DTX e débito constante em todos os Opus, e só neles", async () => {
    const { comDtxECbrNoOpus } = await import("./call.js")
    const saida = comDtxECbrNoOpus(SDP)
    expect(saida).toContain("a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1;cbr=1\r\n")
    expect(saida).toContain("a=rtpmap:112 OPUS/48000/2\r\na=fmtp:112 usedtx=1;cbr=1\r\n")
    expect(saida).toContain("a=fmtp:63 111/111\r\n")
    expect(saida).toContain("a=fmtp:96 x-google-start-bitrate=600\r\n")
    expect(saida.split("\r\n").length).toBe(SDP.split("\r\n").length + 1)
  })

  it("não mexe no que já diz cbr ou usedtx, e é idempotente", async () => {
    const { comDtxECbrNoOpus } = await import("./call.js")
    const ja = SDP.replace("useinbandfec=1", "useinbandfec=1;cbr=0;usedtx=0")
    expect(comDtxECbrNoOpus(ja)).toContain("a=fmtp:111 minptime=10;useinbandfec=1;cbr=0;usedtx=0\r\n")
    expect(comDtxECbrNoOpus("")).toBe("")
    expect(comDtxECbrNoOpus(comDtxECbrNoOpus(SDP))).toBe(comDtxECbrNoOpus(SDP))
  })

  it("aceita fmtp sem espaço depois do ponto e vírgula e não confunde chaves parecidas", async () => {
    const { comDtxECbrNoOpus } = await import("./call.js")
    const parecida = SDP.replace("useinbandfec=1", "useinbandfec=1; xcbr=1")
    expect(comDtxECbrNoOpus(parecida)).toContain("a=fmtp:111 minptime=10;useinbandfec=1; xcbr=1;usedtx=1;cbr=1\r\n")
  })
})
