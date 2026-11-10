import type { Payload, UserAddress } from "@enclave/protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Call, type CallBridge, type MediaKeyMaterial } from "../call.js"
import { CHAVES_DE_PREFERENCIA, type EstadoDoAudio, type FonteDePreferenciasDeAudio } from "./controlo.js"
import { CONFIGURACAO_DO_PERFIL } from "./perfis.js"
import type { ConfiguracaoDaCadeia, MensagemDoWorklet } from "./processador-de-voz.js"

/**
 * Voice chain control and its connection to the call.
 *
 * Audio itself is measured in `cadeia.test.ts`. Here we measure what surrounds it:
 * what we request from `getUserMedia`, which track goes to WebRTC, what we save
 * to preferences, what happens when the model fails to load, and suspended context.
 * Node has no Web Audio: the mocks below stand in for it.
 */

// ------------------------------------------------------------------ duplos

interface FaixaFalsa {
  kind: string
  enabled: boolean
  stop: ReturnType<typeof vi.fn>
  applyConstraints: ReturnType<typeof vi.fn>
  clone: () => FaixaFalsa
  /** The clones this track created. */
  clones: FaixaFalsa[]
}

function faixa(kind = "audio"): FaixaFalsa {
  const nova: FaixaFalsa = {
    kind,
    enabled: true,
    stop: vi.fn(),
    applyConstraints: vi.fn(async () => {}),
    clones: [],
    clone: () => {
      const copia = faixa(kind)
      nova.clones.push(copia)
      return copia
    },
  }
  return nova
}

class MediaStreamFalso {
  readonly faixas: FaixaFalsa[]
  constructor(faixas: FaixaFalsa[] = []) {
    this.faixas = [...faixas]
  }
  getTracks(): FaixaFalsa[] {
    return this.faixas
  }
  getAudioTracks(): FaixaFalsa[] {
    return this.faixas.filter((f) => f.kind === "audio")
  }
  getVideoTracks(): FaixaFalsa[] {
    return this.faixas.filter((f) => f.kind === "video")
  }
}

class NoDeWorkletFalso {
  static instancias: NoDeWorkletFalso[] = []
  readonly port = {
    mensagens: [] as unknown[],
    onmessage: null as ((evento: { data: MensagemDoWorklet }) => void) | null,
    postMessage(mensagem: unknown) {
      this.mensagens.push(mensagem)
    },
  }
  readonly ligacoes = new Set<unknown>()
  constructor(
    readonly contexto: ContextoFalso,
    readonly nome: string,
    readonly opcoes: { processorOptions: { config: ConfiguracaoDaCadeia } },
  ) {
    NoDeWorkletFalso.instancias.push(this)
  }
  connect(destino: unknown): unknown {
    this.ligacoes.add(destino)
    return destino
  }
  disconnect(destino?: unknown): void {
    if (destino === undefined) this.ligacoes.clear()
    else this.ligacoes.delete(destino)
  }
  /** The worklet talking to the main thread. */
  dizer(mensagem: MensagemDoWorklet): void {
    this.port.onmessage?.({ data: mensagem })
  }
}

class ContextoFalso {
  static instancias: ContextoFalso[] = []
  state = "suspended"
  retomado = 0
  fechado = false
  modulos: string[] = []
  ouvintes = new Map<string, () => void>()
  readonly destination = { nome: "altifalantes" }
  readonly saida = new MediaStreamFalso([faixa()])
  readonly audioWorklet = {
    addModule: async (endereco: string) => {
      this.modulos.push(endereco)
    },
  }
  constructor(readonly opcoes?: { sampleRate?: number }) {
    ContextoFalso.instancias.push(this)
  }
  createMediaStreamSource() {
    return { connect: (destino: unknown) => destino, disconnect: () => {} }
  }
  createMediaStreamDestination() {
    return { channelCount: 2, stream: this.saida }
  }
  addEventListener(nome: string, ouvinte: () => void) {
    this.ouvintes.set(nome, ouvinte)
  }
  removeEventListener(nome: string) {
    this.ouvintes.delete(nome)
  }
  async resume(): Promise<void> {
    this.retomado++
    this.state = "running"
  }
  async close(): Promise<void> {
    this.fechado = true
    this.state = "closed"
  }
}
// `"audioWorklet" in AudioContext.prototype` is the check `cadeiaDisponivel` performs.
Object.defineProperty(ContextoFalso.prototype, "audioWorklet", { value: null, writable: true })

const EU = "@eu:enclave.test" as UserAddress
const CANAL = "!geral:enclave.test"

function ponte(portao: boolean[] = []): CallBridge {
  return {
    selfAddress: EU,
    async sendSignal(_channel: string, _payload: Payload) {},
    async mediaKey(): Promise<MediaKeyMaterial | null> {
      return { keyId: 1, senderId: 0, material: new Uint8Array(28) }
    },
    async reservarContadorSframe(): Promise<number> {
      return 0
    },
    async setMediaActive(aberto: boolean) {
      portao.push(aberto)
    },
  } as unknown as CallBridge
}

class FakePeerConnection {
  localDescription: unknown = null
  addTrack(): unknown {
    return {}
  }
  async createOffer(): Promise<unknown> {
    return { type: "offer", sdp: "v=0\r\n" }
  }
  async setLocalDescription(): Promise<void> {}
  close(): void {}
}

let pedidos: { audio: Record<string, unknown> }[] = []
let capturas: MediaStreamFalso[] = []

function fontePropria(inicial: Record<string, string> = {}) {
  const valores: Record<string, string> = { ...inicial }
  const ouvintes = new Set<(dados: { preferencias: Readonly<Record<string, string>> }) => void>()
  const fonte: FonteDePreferenciasDeAudio & { valores: Record<string, string>; vindoDeFora(m: Record<string, string>): void } = {
    valores,
    preferencias: () => ({ ...valores }),
    definirPreferencia: async (chave, valor) => {
      valores[chave] = valor
    },
    on: (_evento, ouvinte) => {
      ouvintes.add(ouvinte)
      return () => ouvintes.delete(ouvinte)
    },
    vindoDeFora(mudanca) {
      Object.assign(valores, mudanca)
      for (const ouvinte of ouvintes) ouvinte({ preferencias: { ...valores } })
    },
  }
  return fonte
}

beforeEach(() => {
  ContextoFalso.instancias = []
  NoDeWorkletFalso.instancias = []
  pedidos = []
  capturas = []
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection)
  vi.stubGlobal("RTCRtpSender", class {})
  vi.stubGlobal("AudioContext", ContextoFalso)
  vi.stubGlobal("AudioWorkletNode", NoDeWorkletFalso)
  vi.stubGlobal("MediaStream", MediaStreamFalso)
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async (pedido: { audio: Record<string, unknown> }) => {
        pedidos.push(pedido)
        const captura = new MediaStreamFalso([faixa()])
        capturas.push(captura)
        return captura
      },
    },
  })
})

// ------------------------------------------------------------------ testes

describe("a cadeia de voz na chamada", () => {
  it('por omissão é "Normal", com tudo ligado e força 1', () => {
    const call = new Call(ponte())
    expect(call.audio.perfil()).toBe("normal")
    expect(call.audio.etapas()).toEqual({ passaAlto: true, supressao: true, gate: true, compressor: true, deEsser: true })
    expect(call.audio.forcaDaSupressao()).toBe(1)
    expect(call.audio.medir()).toEqual({
      entradaDb: -120,
      saidaDb: -120,
      ruidoEstimadoDb: -120,
      cpuMs: 0,
      portaoDb: -120,
      vozAtiva: false,
      anelDb: -120,
    })
    expect(call.audio.limiar()).toBeNull()
  })

  it("com a cadeia, o supressor e o ganho nativos não se pedem, e a faixa que sai é a da cadeia", async () => {
    const call = new Call(ponte())
    await call.join(CANAL)

    expect(pedidos[0]?.audio).toMatchObject({ echoCancellation: true, noiseSuppression: false, autoGainControl: false })
    const contexto = ContextoFalso.instancias[0]!
    expect(contexto.opcoes?.sampleRate).toBe(48000)
    expect(contexto.modulos).toHaveLength(1)
    expect(contexto.retomado).toBeGreaterThan(0)
    expect(call.localStream?.getAudioTracks()[0]).toBe(contexto.saida.getAudioTracks()[0])
    const no = NoDeWorkletFalso.instancias[0]!
    expect(no.nome).toBe("orwell-cadeia-de-voz")
    expect(no.opcoes.processorOptions.config.etapas).toEqual(CONFIGURACAO_DO_PERFIL.normal.etapas)
  })

  it("silenciar mexe na faixa que sai, e sair fecha o contexto e o microfone", async () => {
    const call = new Call(ponte())
    await call.join(CANAL)
    call.setMuted(true)
    const contexto = ContextoFalso.instancias[0]!
    expect(contexto.saida.getAudioTracks()[0]!.enabled).toBe(false)

    await call.leave()
    expect(contexto.fechado).toBe(true)
    expect(capturas[0]!.getAudioTracks()[0]!.stop).toHaveBeenCalled()
    expect(NoDeWorkletFalso.instancias[0]!.port.mensagens).toContainEqual({ tipo: "destruir" })
  })

  it("trocar de chamada monta uma cadeia nova e desmonta a velha", async () => {
    const call = new Call(ponte())
    await call.join(CANAL)
    await call.join(CANAL, { room: "outra" })
    expect(ContextoFalso.instancias).toHaveLength(2)
    expect(ContextoFalso.instancias[0]!.fechado).toBe(true)
    expect(ContextoFalso.instancias[1]!.fechado).toBe(false)
  })

  it('"Desligado" é a captura de sempre, sem contexto e com o supressor nativo', async () => {
    const call = new Call(ponte())
    await call.audio.definirPerfil("desligado")
    await call.join(CANAL)
    expect(ContextoFalso.instancias).toHaveLength(0)
    expect(pedidos[0]?.audio).toMatchObject({ noiseSuppression: true, autoGainControl: true })
  })

  it("se o modelo não carregar, o supressor nativo volta à faixa crua", async () => {
    const call = new Call(ponte())
    const estados: EstadoDoAudio[] = []
    call.on("audio", (estado) => estados.push(estado))
    await call.join(CANAL)
    NoDeWorkletFalso.instancias[0]!.dizer({ tipo: "motor", estado: "falhou", detalhe: "CompileError" })
    await Promise.resolve()

    const crua = capturas[0]!.getAudioTracks()[0]!
    expect(crua.applyConstraints).toHaveBeenLastCalledWith(
      expect.objectContaining({ noiseSuppression: true, autoGainControl: false }),
    )
    expect(estados.at(-1)?.motor).toBe("nativo")
  })

  it("mudar a meio da chamada chega ao worklet e às restrições nativas", async () => {
    const call = new Call(ponte())
    await call.join(CANAL)
    const no = NoDeWorkletFalso.instancias[0]!
    no.dizer({ tipo: "motor", estado: "pronto" })

    await call.audio.definirEtapa("supressao", false)
    const ultima = no.port.mensagens.at(-1) as { tipo: string; config: ConfiguracaoDaCadeia }
    expect(ultima.tipo).toBe("configurar")
    expect(ultima.config.etapas.supressao).toBe(false)
    expect(capturas[0]!.getAudioTracks()[0]!.applyConstraints).toHaveBeenLastCalledWith(
      expect.objectContaining({ noiseSuppression: true }),
    )

    await call.audio.definirPerfil("desligado")
    const desligado = no.port.mensagens.at(-1) as { config: ConfiguracaoDaCadeia }
    expect(Object.values(desligado.config.etapas).every((ligada) => !ligada)).toBe(true)
  })

  it("as medidas do worklet chegam a `medir()`", async () => {
    const call = new Call(ponte())
    await call.join(CANAL)
    NoDeWorkletFalso.instancias[0]!.dizer({
      tipo: "medidas",
      medidas: {
        entradaDb: -30,
        saidaDb: -21,
        ruidoEstimadoDb: -55,
        cpuMs: 0.08,
        relogioPreciso: true,
        vozAtiva: true,
        motorPronto: true,
        portaoDb: -33,
      },
    })
    expect(call.audio.medir()).toEqual({
      entradaDb: -30,
      saidaDb: -21,
      ruidoEstimadoDb: -55,
      cpuMs: 0.08,
      portaoDb: -33,
      vozAtiva: true,
      anelDb: -30,
    })
  })

  it("um contexto que volta a ficar suspenso é retomado sozinho", async () => {
    const call = new Call(ponte())
    await call.join(CANAL)
    const contexto = ContextoFalso.instancias[0]!
    const antes = contexto.retomado
    contexto.state = "suspended"
    contexto.ouvintes.get("statechange")?.()
    expect(contexto.retomado).toBe(antes + 1)
  })
})

describe("preferências", () => {
  it("cada escolha grava-se nas chaves da conta", async () => {
    const call = new Call(ponte())
    const fonte = fontePropria()
    call.audio.ligarPreferencias(fonte)

    await call.audio.definirPerfil("leve")
    expect(fonte.valores[CHAVES_DE_PREFERENCIA.perfil]).toBe("leve")
    expect(JSON.parse(fonte.valores[CHAVES_DE_PREFERENCIA.etapas]!)).toEqual(CONFIGURACAO_DO_PERFIL.leve.etapas)
    expect(fonte.valores[CHAVES_DE_PREFERENCIA.forca]).toBe("0.6")

    await call.audio.definirEtapa("deEsser", true)
    expect(JSON.parse(fonte.valores[CHAVES_DE_PREFERENCIA.etapas]!).deEsser).toBe(true)
    await call.audio.definirForcaDaSupressao(0.4)
    expect(fonte.valores[CHAVES_DE_PREFERENCIA.forca]).toBe("0.4")
  })

  it("o que está guardado aplica-se ao ligar, e o que muda noutro aparelho também", async () => {
    const call = new Call(ponte())
    const estados: EstadoDoAudio[] = []
    call.on("audio", (estado) => estados.push(estado))
    const fonte = fontePropria({
      [CHAVES_DE_PREFERENCIA.perfil]: "maximo",
      [CHAVES_DE_PREFERENCIA.etapas]: JSON.stringify({ gate: false }),
      [CHAVES_DE_PREFERENCIA.forca]: "0.8",
    })
    call.audio.ligarPreferencias(fonte)
    await Promise.resolve()
    await Promise.resolve()
    expect(call.audio.perfil()).toBe("maximo")
    expect(call.audio.etapas().gate).toBe(false)
    expect(call.audio.etapas().supressao).toBe(true)
    expect(call.audio.forcaDaSupressao()).toBe(0.8)

    fonte.vindoDeFora({ [CHAVES_DE_PREFERENCIA.perfil]: "leve", [CHAVES_DE_PREFERENCIA.forca]: "0.5" })
    expect(call.audio.perfil()).toBe("leve")
    expect(call.audio.forcaDaSupressao()).toBe(0.5)
    expect(estados.at(-1)?.perfil).toBe("leve")
  })

  it("valores estragados nas preferências não estragam nada", async () => {
    const call = new Call(ponte())
    call.audio.ligarPreferencias(
      fontePropria({
        [CHAVES_DE_PREFERENCIA.perfil]: "turbo",
        [CHAVES_DE_PREFERENCIA.etapas]: "{não é json",
        [CHAVES_DE_PREFERENCIA.forca]: "7",
      }),
    )
    await Promise.resolve()
    expect(call.audio.perfil()).toBe("normal")
    expect(call.audio.forcaDaSupressao()).toBe(1)
  })

  it("pedidos inválidos recusam com chave estável e não mudam nada", async () => {
    const call = new Call(ponte())
    await expect(call.audio.definirPerfil("turbo" as never)).rejects.toThrow("audio-invalid-profile")
    await expect(call.audio.definirEtapa("reverb" as never, true)).rejects.toThrow("audio-invalid-stage")
    await expect(call.audio.definirForcaDaSupressao(1.5)).rejects.toThrow("audio-invalid-strength")
    expect(call.audio.perfil()).toBe("normal")
  })

  it("uma gravação que falha diz-se com chave e `cause`, e a escolha fica aplicada", async () => {
    const call = new Call(ponte())
    call.audio.ligarPreferencias({
      preferencias: () => ({}),
      definirPreferencia: async () => {
        throw new Error("offline")
      },
    })
    const promessa = call.audio.definirPerfil("maximo")
    await expect(promessa).rejects.toThrow("audio-preference-save-failed")
    await promessa.catch((erro: Error) => expect(erro.cause).toEqual({ mensagem: "offline" }))
    expect(call.audio.perfil()).toBe("maximo")
  })
})

describe("prévia", () => {
  it("fora de chamada abre o microfone com o portão, liga aos altifalantes, e fecha tudo", async () => {
    const portao: boolean[] = []
    const call = new Call(ponte(portao))
    await call.audio.previa(true)
    expect(portao).toEqual([true])
    const no = NoDeWorkletFalso.instancias[0]!
    expect(no.ligacoes.has(no.contexto.destination)).toBe(true)
    expect(call.audio.estado().previa).toBe(true)

    await call.audio.previa(false)
    expect(no.contexto.fechado).toBe(true)
    expect(capturas[0]!.getAudioTracks()[0]!.stop).toHaveBeenCalled()
    expect(portao).toEqual([true, false])
  })

  it("em chamada usa a cadeia da chamada, sem abrir outro microfone", async () => {
    const call = new Call(ponte())
    await call.join(CANAL)
    await call.audio.previa(true)
    expect(capturas).toHaveLength(1)
    const no = NoDeWorkletFalso.instancias[0]!
    expect(no.ligacoes.has(no.contexto.destination)).toBe(true)
    await call.audio.previa(false)
    expect(no.ligacoes.has(no.contexto.destination)).toBe(false)
    expect(no.contexto.fechado).toBe(false)
  })

  it("entrar em chamada com a prévia ligada passa-a para a cadeia da chamada", async () => {
    const call = new Call(ponte())
    await call.audio.previa(true)
    await call.join(CANAL)
    expect(ContextoFalso.instancias[0]!.fechado).toBe(true)
    const daChamada = NoDeWorkletFalso.instancias[1]!
    expect(daChamada.ligacoes.has(daChamada.contexto.destination)).toBe(true)
  })

  it('em chamada SEM cadeia ("Desligado"), usa clones da faixa da chamada e não abre outro microfone', async () => {
    // Opening the microphone again mid-call could stop its track.
    const portao: boolean[] = []
    const call = new Call(ponte(portao))
    await call.audio.definirPerfil("desligado")
    await call.join(CANAL)
    expect(capturas).toHaveLength(1)
    const daChamada = capturas[0]!.getAudioTracks()[0]!

    await call.audio.previa(true)
    expect(capturas).toHaveLength(1)
    expect(daChamada.clones).toHaveLength(1)
    expect(call.audio.estado().previa).toBe(true)

    await call.audio.previa(false)
    // Stop the clone only: the call track keeps running.
    expect(daChamada.clones[0]!.stop).toHaveBeenCalled()
    expect(daChamada.stop).not.toHaveBeenCalled()
    // And the Electron gate does not close while the call is active.
    expect(portao).not.toContain(false)
  })

  it("sem Web Audio, a prévia recusa com chave estável", async () => {
    vi.stubGlobal("AudioWorkletNode", undefined)
    const call = new Call(ponte())
    await expect(call.audio.previa(true)).rejects.toThrow("audio-preview-unavailable")
    expect(call.audio.estado().previa).toBe(false)
  })
})

describe("sensibilidade do microfone", () => {
  const medidas = (vozAtiva: boolean): MensagemDoWorklet => ({
    tipo: "medidas",
    medidas: {
      entradaDb: -35,
      saidaDb: vozAtiva ? -21 : -120,
      ruidoEstimadoDb: -60,
      cpuMs: 0.05,
      relogioPreciso: true,
      vozAtiva,
      motorPronto: true,
      portaoDb: -38,
    },
  })

  it("a linha chega ao worklet a meio da chamada, pela mesma cadeia, sem recriar nada", async () => {
    const call = new Call(ponte())
    await call.join(CANAL)
    const no = NoDeWorkletFalso.instancias[0]!
    expect(no.opcoes.processorOptions.config.limiarDb).toBeNull()

    call.audio.definirLimiar(-42)
    const ultima = no.port.mensagens.at(-1) as { tipo: string; config: ConfiguracaoDaCadeia }
    expect(ultima).toMatchObject({ tipo: "configurar", config: { limiarDb: -42 } })
    // Changing the profile does not drop the connection.
    await call.audio.definirPerfil("leve")
    expect((no.port.mensagens.at(-1) as { config: ConfiguracaoDaCadeia }).config.limiarDb).toBe(-42)
    call.audio.definirLimiar(null)
    expect((no.port.mensagens.at(-1) as { config: ConfiguracaoDaCadeia }).config.limiarDb).toBeNull()
    expect(NoDeWorkletFalso.instancias).toHaveLength(1)
    expect(ContextoFalso.instancias).toHaveLength(1)
  })

  it("a captura seguinte já nasce com a linha", async () => {
    const call = new Call(ponte())
    call.audio.definirLimiar(-50)
    await call.join(CANAL)
    expect(NoDeWorkletFalso.instancias[0]!.opcoes.processorOptions.config.limiarDb).toBe(-50)
  })

  it('com "Desligado" e linha manual, a cadeia nasce na mesma, com tudo desligado menos a linha', async () => {
    const call = new Call(ponte())
    await call.audio.definirPerfil("desligado")
    call.audio.definirLimiar(-50)
    await call.join(CANAL)
    const config = NoDeWorkletFalso.instancias[0]!.opcoes.processorOptions.config
    expect(Object.values(config.etapas).every((ligada) => !ligada)).toBe(true)
    expect(config.limiarDb).toBe(-50)
    // Without our suppression, the native suppressor stays enabled.
    expect(pedidos[0]?.audio).toMatchObject({ noiseSuppression: true, autoGainControl: true })
  })

  it("linhas inválidas recusam com chave estável e não mudam nada", () => {
    const call = new Call(ponte())
    expect(() => call.audio.definirLimiar(5)).toThrow("audio-invalid-threshold")
    expect(() => call.audio.definirLimiar(-81)).toThrow("audio-invalid-threshold")
    expect(() => call.audio.definirLimiar(Number.NaN)).toThrow("audio-invalid-threshold")
    expect(() => call.audio.definirLimiar("-40" as never)).toThrow("audio-invalid-threshold")
    expect(call.audio.limiar()).toBeNull()
  })

  it("o anel segue o gate só no modo manual", async () => {
    const call = new Call(ponte())
    await call.join(CANAL)
    const no = NoDeWorkletFalso.instancias[0]!
    // Automatic: the ring shows input, gate closed or open (as before).
    no.dizer(medidas(false))
    expect(call.audio.medir().anelDb).toBe(-35)
    // Manual and closed: no one sees the person speaking.
    call.audio.definirLimiar(-30)
    expect(call.audio.medir().anelDb).toBe(-120)
    no.dizer(medidas(true))
    expect(call.audio.medir().anelDb).toBe(-35)
  })

  it("o medidor abre o microfone sem altifalantes, e larga-o ao sair", async () => {
    const portao: boolean[] = []
    const call = new Call(ponte(portao))
    await call.audio.medidor(true)
    expect(portao).toEqual([true])
    const no = NoDeWorkletFalso.instancias[0]!
    expect(no.ligacoes.has(no.contexto.destination)).toBe(false)
    expect(call.audio.estado().previa).toBe(false)
    // Requesting again does not open another microphone.
    await call.audio.medidor(true)
    expect(capturas).toHaveLength(1)

    // The preview on top uses the same chain; turning it off does not close the meter.
    await call.audio.previa(true)
    expect(capturas).toHaveLength(1)
    expect(no.ligacoes.has(no.contexto.destination)).toBe(true)
    await call.audio.previa(false)
    expect(no.contexto.fechado).toBe(false)
    expect(no.ligacoes.has(no.contexto.destination)).toBe(false)

    await call.audio.medidor(false)
    expect(no.contexto.fechado).toBe(true)
    expect(capturas[0]!.getAudioTracks()[0]!.stop).toHaveBeenCalled()
    expect(portao).toEqual([true, false])
  })

  it("com a prévia ligada, fechar o medidor deixa a prévia", async () => {
    const call = new Call(ponte())
    await call.audio.previa(true)
    await call.audio.medidor(true)
    await call.audio.medidor(false)
    expect(ContextoFalso.instancias[0]!.fechado).toBe(false)
    await call.audio.previa(false)
    expect(ContextoFalso.instancias[0]!.fechado).toBe(true)
  })

  it("em chamada, o medidor usa a cadeia da chamada", async () => {
    const call = new Call(ponte())
    await call.join(CANAL)
    await call.audio.medidor(true)
    expect(capturas).toHaveLength(1)
    expect(ContextoFalso.instancias).toHaveLength(1)
    await call.audio.medidor(false)
    expect(ContextoFalso.instancias[0]!.fechado).toBe(false)
  })

  it("uma permissão recusada diz-se com chave própria", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => {
          throw Object.assign(new Error("Permission denied"), { name: "NotAllowedError" })
        },
      },
    })
    const call = new Call(ponte())
    await expect(call.audio.medidor(true)).rejects.toThrow("audio-meter-denied")
    expect(ContextoFalso.instancias).toHaveLength(0)

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => {
          throw Object.assign(new Error("busy"), { name: "NotReadableError" })
        },
      },
    })
    await expect(call.audio.medidor(true)).rejects.toThrow("audio-meter-failed")
  })

  it("sem Web Audio, o medidor recusa com a chave da prévia", async () => {
    vi.stubGlobal("AudioWorkletNode", undefined)
    const call = new Call(ponte())
    await expect(call.audio.medidor(true)).rejects.toThrow("audio-preview-unavailable")
  })
})
