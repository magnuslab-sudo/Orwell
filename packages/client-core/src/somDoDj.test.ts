import { describe, expect, it, vi } from "vitest"
import { capturarSomDaFonte, nomeDaOrigem, pedidoDoSomDaFonte, type DependenciasDaCaptura } from "./somDoDj.js"

/**
 * Sources captured from the DJ: system audio separator, system sound, and window.
 *
 * `getDisplayMedia` and the graph are dual. What we measure is the REQUEST (what
 * we ask the browser for each source), what we do with the image (drop it
 * immediately), what goes to the call (the destination track, not the browser's),
 * and the end (the browser's "Stop sharing" stops everything). Real audio is
 * measured in `scripts/e2e-dj-fontes.mjs`.
 */

interface FaixaFalsa {
  kind: "audio" | "video"
  id: string
  label: string
  readyState: "live" | "ended"
  stop: ReturnType<typeof vi.fn>
  addEventListener: (nome: string, ouvinte: () => void) => void
  terminar: () => void
}

function faixaFalsa(kind: "audio" | "video", label = ""): FaixaFalsa {
  const ouvintes: (() => void)[] = []
  const faixa: FaixaFalsa = {
    kind,
    id: `${kind}-${Math.random().toString(36).slice(2, 7)}`,
    label,
    readyState: "live",
    stop: vi.fn(() => {
      faixa.readyState = "ended"
    }),
    addEventListener: (nome, ouvinte) => {
      if (nome === "ended") ouvintes.push(ouvinte)
    },
    // The browser ends the track on its own ("Stop sharing"): `ended`, no `stop()`.
    terminar: () => {
      faixa.readyState = "ended"
      for (const ouvinte of ouvintes) ouvinte()
    },
  }
  return faixa
}

function fluxoFalso(faixas: FaixaFalsa[]) {
  return {
    getTracks: () => faixas,
    getAudioTracks: () => faixas.filter((f) => f.kind === "audio"),
    getVideoTracks: () => faixas.filter((f) => f.kind === "video"),
  }
}

function contextoFalso() {
  const saida = faixaFalsa("audio", "destino")
  const ligacoes: string[] = []
  const ganho = { gain: { value: 1 }, connect: (destino: { nome: string }) => ligacoes.push(`ganho→${destino.nome}`) }
  const contexto = {
    state: "suspended",
    resume: vi.fn(async function (this: { state: string }) {
      this.state = "running"
    }),
    close: vi.fn(async () => {}),
    createMediaStreamSource: vi.fn(() => ({ connect: () => ligacoes.push("fonte→ganho") })),
    createGain: () => ganho,
    createMediaStreamDestination: () => ({ nome: "chamada", channelCount: 1, stream: { getAudioTracks: () => [saida] } }),
  }
  return { contexto, saida, ligacoes, ganho }
}

function montar(faixas: FaixaFalsa[] | Error) {
  const grafo = contextoFalso()
  const pedidos: unknown[] = []
  const deps: DependenciasDaCaptura = {
    getDisplayMedia: async (pedido) => {
      pedidos.push(pedido)
      if (faixas instanceof Error) throw faixas
      return fluxoFalso(faixas) as unknown as MediaStream
    },
    criarContexto: () => grafo.contexto as unknown as AudioContext,
    criarFluxo: (lista) => fluxoFalso(lista as unknown as FaixaFalsa[]) as unknown as MediaStream,
  }
  return { deps, pedidos, ...grafo }
}

const erro = (name: string): Error => Object.assign(new Error(name), { name })

describe("o pedido de cada fonte", () => {
  it("todas: som sem tratamento de voz, sem a voz da chamada, e o separador continua a tocar para o DJ", () => {
    for (const fonte of ["separador", "sistema", "janela"] as const) {
      const pedido = pedidoDoSomDaFonte(fonte) as { audio: Record<string, unknown>; video: unknown }
      expect(pedido.audio).toMatchObject({
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        restrictOwnAudio: true,
        suppressLocalAudioPlayback: false,
      })
      // The browser requires video; request the smallest one and drop it.
      expect(pedido.video).toBeTruthy()
    }
  })

  it("separador: só separadores, nunca o nosso, e sem o som do sistema", () => {
    expect(pedidoDoSomDaFonte("separador")).toMatchObject({
      video: { displaySurface: "browser" },
      preferCurrentTab: false,
      selfBrowserSurface: "exclude",
      monitorTypeSurfaces: "exclude",
      systemAudio: "exclude",
    })
  })

  it("sistema: o ecrã inteiro, com a caixa do som do sistema", () => {
    expect(pedidoDoSomDaFonte("sistema")).toMatchObject({
      video: { displaySurface: "monitor" },
      monitorTypeSurfaces: "include",
      systemAudio: "include",
    })
  })

  it("janela: uma janela, e o som que o sistema der", () => {
    expect(pedidoDoSomDaFonte("janela")).toMatchObject({
      video: { displaySurface: "window" },
      windowAudio: "system",
    })
  })

  it('o "restrictOwnAudio" vive dentro de `audio`, nunca no topo (lá o Chrome ignora-o)', () => {
    for (const fonte of ["separador", "sistema", "janela"] as const) {
      expect(pedidoDoSomDaFonte(fonte)).not.toHaveProperty("restrictOwnAudio")
    }
  })
})

describe("capturar uma fonte", () => {
  it("deita fora a imagem logo, e o que sai para a chamada é a faixa do destino, estéreo", async () => {
    const imagem = faixaFalsa("video")
    const som = faixaFalsa("audio")
    const { deps, saida, ligacoes, contexto } = montar([imagem, som])
    const resultado = await capturarSomDaFonte("separador", deps)
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(imagem.stop).toHaveBeenCalled()
    expect(som.stop).not.toHaveBeenCalled()
    expect(resultado.som.faixa).toBe(saida)
    expect(resultado.som.fonte).toBe("separador")
    expect(ligacoes).toEqual(["fonte→ganho", "ganho→chamada"])
    // The context wakes up: when suspended, the track came out silent.
    expect(contexto.resume).toHaveBeenCalled()
  })

  it("o volume da emissão mexe no ganho, e o valor guardado vale logo", async () => {
    const { deps, ganho } = montar([faixaFalsa("video"), faixaFalsa("audio")])
    const resultado = await capturarSomDaFonte("sistema", deps, { volumeDaEmissao: 0.4 })
    if (!resultado.ok) throw new Error("devia ter capturado")
    expect(ganho.gain.value).toBeCloseTo(0.4)
    resultado.som.volumeDaEmissao = 0.7
    expect(ganho.gain.value).toBeCloseTo(0.7)
    resultado.som.volumeDaEmissao = 4
    expect(resultado.som.volumeDaEmissao).toBe(1)
  })

  it("cancelar o selector não é erro", async () => {
    for (const nome of ["NotAllowedError", "AbortError"]) {
      const { deps, contexto } = montar(erro(nome))
      expect(await capturarSomDaFonte("separador", deps)).toEqual({ ok: false, cancelado: true })
      expect(contexto.close).toHaveBeenCalled()
    }
  })

  it("sem som (a caixa do áudio por marcar): diz-se, e a captura fecha inteira", async () => {
    const imagem = faixaFalsa("video")
    const { deps, contexto } = montar([imagem])
    expect(await capturarSomDaFonte("sistema", deps)).toEqual({
      ok: false,
      cancelado: false,
      detail: "the chosen source gave no sound",
    })
    expect(imagem.stop).toHaveBeenCalled()
    expect(contexto.close).toHaveBeenCalled()
  })

  it("um browser sem `getDisplayMedia`: diz-se, sem abrir nada", async () => {
    const { deps } = montar([])
    const semCaptura = { ...deps, getDisplayMedia: undefined }
    expect(await capturarSomDaFonte("separador", semCaptura)).toEqual({
      ok: false,
      cancelado: false,
      detail: "this device cannot capture a sound source",
    })
  })

  it("outra recusa do browser: diz-se, com o nome do erro no detalhe", async () => {
    const { deps } = montar(erro("NotReadableError"))
    expect(await capturarSomDaFonte("separador", deps)).toEqual({
      ok: false,
      cancelado: false,
      detail: "could not capture this sound source",
      nome: "NotReadableError",
    })
  })

  it('o "Parar de partilhar" do browser acaba a fonte: avisa uma vez, e fecha o contexto', async () => {
    const som = faixaFalsa("audio")
    const { deps, contexto, saida } = montar([faixaFalsa("video"), som])
    const resultado = await capturarSomDaFonte("separador", deps)
    if (!resultado.ok) throw new Error("devia ter capturado")
    const fim = vi.fn()
    resultado.som.on("fim", fim)
    som.terminar()
    expect(fim).toHaveBeenCalledTimes(1)
    expect(resultado.som.parado).toBe(true)
    expect(saida.stop).toHaveBeenCalled()
    expect(contexto.close).toHaveBeenCalled()
    resultado.som.parar()
    expect(fim).toHaveBeenCalledTimes(1)
  })

  it("parar à mão pára a faixa do browser (a marca de gravação apaga-se)", async () => {
    const som = faixaFalsa("audio")
    const { deps } = montar([faixaFalsa("video"), som])
    const resultado = await capturarSomDaFonte("janela", deps)
    if (!resultado.ok) throw new Error("devia ter capturado")
    resultado.som.parar()
    expect(som.stop).toHaveBeenCalled()
    expect(resultado.som.parado).toBe(true)
  })

  it("a origem: o nome dado pela app, senão a etiqueta da imagem quando é um nome", async () => {
    const { deps } = montar([faixaFalsa("video", "Rádio - YouTube"), faixaFalsa("audio")])
    const resultado = await capturarSomDaFonte("separador", deps)
    if (!resultado.ok) throw new Error("devia ter capturado")
    expect(resultado.som.origem).toBe("Rádio - YouTube")
    const comNome = await capturarSomDaFonte("janela", montar([faixaFalsa("video", "window:12:0"), faixaFalsa("audio")]).deps, { origem: "Spotify" })
    if (!comNome.ok) throw new Error("devia ter capturado")
    expect(comNome.som.origem).toBe("Spotify")
  })
})

describe("o nome da origem", () => {
  it("um identificador do motor não é nome", () => {
    expect(nomeDaOrigem("screen:0:0")).toBeNull()
    expect(nomeDaOrigem("window:1234:0")).toBeNull()
    expect(nomeDaOrigem("web-contents-media-stream://12:3")).toBeNull()
    expect(nomeDaOrigem("  ")).toBeNull()
    // A track label for screen and other captures is a random identifier in base64.
    expect(nomeDaOrigem("j26FEknyA2p0N41L/x9t8aSSsehZjuxNGWS8jFkD8fXAZizpm1Ed6GcNRfZb2nFpMxA6bzJkiUr3qTDv98oRJQ==")).toBeNull()
    expect(nomeDaOrigem("3f1c2a9e-7b4d-4c1e-9a2b-0d5e6f7a8b9c")).toBeNull()
    expect(nomeDaOrigem("Spotify")).toBe("Spotify")
    expect(nomeDaOrigem("Spotify Premium")).toBe("Spotify Premium")
  })
})
