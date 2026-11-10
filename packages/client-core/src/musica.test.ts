import { beforeEach, describe, expect, it, vi } from "vitest"
import { eFicheiroDeAudio, LeitorDeMusica, nomeDaFaixa, type FicheiroDeAudio } from "./musica.js"

/**
 * The music player: the queue and the states, without sound.
 *
 * The audio graph is a mock, and what it measures is the SHAPE: a stereo
 * destination node for the call and a gain for the speakers, both connected to
 * the same source. Real sound is measured in `scripts/e2e-musica.mjs`.
 */

class ElementoFalso {
  currentTime = 0
  duration = Number.NaN
  src = ""
  preload = ""
  tocadas: string[] = []
  pausas = 0
  recusar: Error | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  async play(): Promise<void> {
    if (this.recusar) throw this.recusar
    this.tocadas.push(this.src)
  }
  pause(): void {
    this.pausas++
  }
  removeAttribute(nome: string): void {
    if (nome === "src") this.src = ""
  }
}

function contextoFalso() {
  const faixa = { kind: "audio", id: "faixa-da-musica", stop: vi.fn() }
  const ligacoes: string[] = []
  const no = (nome: string) => ({ connect: (destino: { nome: string }) => ligacoes.push(`${nome}→${destino.nome}`) })
  /* The gains, in the order the player creates them: the broadcast and the monitor. */
  const nomesDosGanhos = ["emissao", "monitor"]
  const ganhos: Record<string, { gain: { value: number } }> = {}
  const contexto = {
    state: "suspended",
    resume: vi.fn(async function (this: { state: string }) {
      this.state = "running"
    }),
    close: vi.fn(async () => {}),
    destination: { nome: "altifalantes" },
    createMediaElementSource: () => no("fonte"),
    createMediaStreamDestination: () => ({ nome: "chamada", channelCount: 1, stream: { getAudioTracks: () => [faixa], getTracks: () => [faixa] } }),
    createGain: () => {
      const nome = nomesDosGanhos.shift() ?? "ganho"
      const ganho = { ...no(nome), nome, gain: { value: 1 } }
      ganhos[nome] = ganho
      return ganho
    },
  }
  return { contexto, faixa, ligacoes, ganhos }
}

function ficheiro(nome: string, type = ""): FicheiroDeAudio {
  return Object.assign(new Blob(["x"], { type }), { name: nome })
}

let elemento: ElementoFalso
let grafo: ReturnType<typeof contextoFalso>
let urls: string[]
let largadas: string[]
let duracoes: Map<string, number>

function leitor(aleatorio = () => 0): LeitorDeMusica {
  return new LeitorDeMusica({
    criarContexto: () => grafo.contexto as unknown as AudioContext,
    criarElemento: () => elemento as unknown as HTMLAudioElement,
    criarUrl: () => {
      const url = `blob:${urls.length + 1}`
      urls.push(url)
      return url
    },
    largarUrl: (url) => largadas.push(url),
    aleatorio,
    lerDuracao: async (ficheiro) => duracoes.get((ficheiro as FicheiroDeAudio).name) ?? null,
  })
}

beforeEach(() => {
  elemento = new ElementoFalso()
  grafo = contextoFalso()
  urls = []
  largadas = []
  duracoes = new Map()
})

describe("os ficheiros", () => {
  it("aceita mp3, m4a, ogg, flac e wav pela extensão, e um audio/* sem extensão", () => {
    for (const nome of ["a.mp3", "b.M4A", "c.ogg", "d.flac", "e.wav"]) expect(eFicheiroDeAudio({ name: nome })).toBe(true)
    expect(eFicheiroDeAudio({ name: "sem-extensao", type: "audio/mpeg" })).toBe(true)
    expect(eFicheiroDeAudio({ name: "capa.jpg", type: "image/jpeg" })).toBe(false)
    expect(eFicheiroDeAudio({ name: "notas.txt", type: "audio/mpeg" })).toBe(false)
  })

  it("mostra o nome sem a pasta e sem a extensão", () => {
    expect(nomeDaFaixa("Disco/01 Abertura.flac")).toBe("01 Abertura")
    expect(nomeDaFaixa(".mp3")).toBe(".mp3")
  })

  it("acrescentar deixa de fora o que não é áudio e diz quantos entraram", () => {
    const musica = leitor()
    expect(musica.acrescentar([ficheiro("um.mp3"), ficheiro("capa.jpg"), ficheiro("dois.ogg")])).toBe(2)
    expect(musica.estado.fila.map((faixa) => faixa.nome)).toEqual(["um", "dois"])
    expect(musica.acrescentar([ficheiro("capa.png")])).toBe(0)
  })
})

describe("a fila e os estados", () => {
  it("a primeira faixa fica pronta e não toca sozinha", () => {
    const musica = leitor()
    musica.acrescentar([ficheiro("um.mp3"), ficheiro("dois.mp3")])
    expect(musica.estado).toMatchObject({ actual: "f1", aTocar: false })
    expect(musica.nomeActual).toBe("um")
    // Without a gesture there's no context, and no track for the call.
    expect(musica.faixa).toBeNull()
  })

  it("tocar monta o grafo: a mesma fonte para a chamada (estéreo, pela emissão) e para os altifalantes", async () => {
    const musica = leitor()
    musica.acrescentar([ficheiro("um.mp3")])
    await musica.tocar()

    expect(musica.estado.aTocar).toBe(true)
    expect(grafo.contexto.resume).toHaveBeenCalled()
    expect(elemento.tocadas).toEqual(["blob:1"])
    expect(grafo.ligacoes.sort()).toEqual(["emissao→chamada", "fonte→emissao", "fonte→monitor", "monitor→altifalantes"])
    expect(musica.faixa).toBe(grafo.faixa)
  })

  it("pausar e tocar outra vez usam o mesmo ficheiro carregado", async () => {
    const musica = leitor()
    musica.acrescentar([ficheiro("um.mp3")])
    await musica.tocar()
    musica.pausar()
    expect(musica.estado.aTocar).toBe(false)
    expect(elemento.pausas).toBeGreaterThan(0)
    await musica.tocar()
    expect(urls).toEqual(["blob:1"])
    expect(musica.estado.aTocar).toBe(true)
  })

  it("saltar passa à seguinte, larga o blob da anterior, e mantém a MESMA faixa para a chamada", async () => {
    const musica = leitor()
    musica.acrescentar([ficheiro("um.mp3"), ficheiro("dois.mp3")])
    await musica.tocar()
    const faixa = musica.faixa
    await musica.saltar()

    expect(musica.nomeActual).toBe("dois")
    expect(elemento.tocadas).toEqual(["blob:1", "blob:2"])
    expect(largadas).toEqual(["blob:1"])
    expect(musica.faixa).toBe(faixa)
  })

  it("uma faixa que acaba toca a seguinte; a última pára a fila", async () => {
    const musica = leitor()
    musica.acrescentar([ficheiro("um.mp3"), ficheiro("dois.mp3")])
    await musica.tocar()
    elemento.onended?.()
    await vi.waitFor(() => expect(musica.nomeActual).toBe("dois"))
    elemento.onended?.()
    await vi.waitFor(() => expect(musica.estado).toMatchObject({ actual: null, aTocar: false }))
  })

  it("baralhar mexe só no que está por tocar", async () => {
    // With `aleatorio = 0`, Fisher-Yates runs the rest: [2,3,4] → [3,4,2].
    const musica = leitor(() => 0)
    musica.acrescentar(["a", "b", "c", "d"].map((nome) => ficheiro(`${nome}.mp3`)))
    await musica.tocar()
    musica.baralhar()
    expect(musica.estado.fila.map((faixa) => faixa.nome)).toEqual(["a", "c", "d", "b"])
    expect(musica.nomeActual).toBe("a")
  })

  it("remover outra faixa não interrompe; remover a que toca passa à seguinte", async () => {
    const musica = leitor()
    musica.acrescentar(["a", "b", "c"].map((nome) => ficheiro(`${nome}.mp3`)))
    await musica.tocar()
    await musica.remover("f3")
    expect(musica.estado.fila.map((faixa) => faixa.nome)).toEqual(["a", "b"])
    expect(musica.nomeActual).toBe("a")

    await musica.remover("f1")
    expect(musica.nomeActual).toBe("b")
    expect(musica.estado.aTocar).toBe(true)
    expect(elemento.tocadas.at(-1)).toBe("blob:2")
  })

  it("um ficheiro que o browser não lê diz-se, e a fila segue", async () => {
    const musica = leitor()
    const erros: string[] = []
    musica.on("erro", (evento) => erros.push(`${evento.detail}: ${evento.nome}`))
    musica.acrescentar([ficheiro("estragado.flac"), ficheiro("bom.mp3")])
    await musica.tocar()
    elemento.onerror?.()
    await vi.waitFor(() => expect(musica.nomeActual).toBe("bom"))
    expect(erros).toEqual(["could not read this audio file: estragado"])
  })

  it("uma reprodução recusada pelo browser não fica a dizer que toca", async () => {
    const musica = leitor()
    const erros: string[] = []
    musica.on("erro", (evento) => erros.push(evento.detail))
    musica.acrescentar([ficheiro("um.mp3")])
    elemento.recusar = Object.assign(new Error("não"), { name: "NotAllowedError" })
    await musica.tocar()
    expect(musica.estado.aTocar).toBe(false)
    expect(erros).toEqual(["could not play this audio file"])
  })

  it("cada mudança emite o estado", async () => {
    const musica = leitor()
    const estados: boolean[] = []
    musica.on("estado", (estado) => estados.push(estado.aTocar))
    musica.acrescentar([ficheiro("um.mp3")])
    await musica.tocar()
    musica.pausar()
    expect(estados).toEqual([false, true, false])
  })

  it("o volume local muda só o monitor, entre 0 e 1", async () => {
    const musica = leitor()
    musica.acrescentar([ficheiro("um.mp3")])
    await musica.tocar()
    musica.volumeLocal = 3
    expect(musica.volumeLocal).toBe(1)
    musica.volumeLocal = 0.25
    expect(musica.volumeLocal).toBe(0.25)
  })

  it('o volume da emissão muda só o que sai, entre 0 e 1, e vale já no primeiro "tocar"', async () => {
    const musica = leitor()
    // Before the graph: the value saved on the device loads right when you open the sheet.
    musica.volumeDaEmissao = 0.4
    musica.acrescentar([ficheiro("um.mp3")])
    await musica.tocar()
    expect(grafo.ganhos.emissao?.gain.value).toBe(0.4)
    expect(grafo.ganhos.monitor?.gain.value).toBe(1)
    musica.volumeDaEmissao = 7
    expect(musica.volumeDaEmissao).toBe(1)
    expect(grafo.ganhos.emissao?.gain.value).toBe(1)
    musica.volumeDaEmissao = Number.NaN
    expect(musica.volumeDaEmissao).toBe(1)
    musica.volumeDaEmissao = -2
    expect(grafo.ganhos.emissao?.gain.value).toBe(0)
    // The DJ keeps hearing it as they chose.
    expect(grafo.ganhos.monitor?.gain.value).toBe(1)
  })

  it("fechar larga o blob, pára a faixa e fecha o contexto", async () => {
    const musica = leitor()
    musica.acrescentar([ficheiro("um.mp3")])
    await musica.tocar()
    musica.fechar()
    expect(largadas).toEqual(["blob:1"])
    expect(grafo.faixa.stop).toHaveBeenCalled()
    expect(grafo.contexto.close).toHaveBeenCalled()
    expect(musica.estado).toEqual({ fila: [], actual: null, aTocar: false, repetir: false, aleatorio: false })
    expect(musica.acrescentar([ficheiro("dois.mp3")])).toBe(0)
  })
})

describe("o leitor, à maneira do Winamp", () => {
  it("a duração de cada faixa chega dos metadados e entra no estado", async () => {
    duracoes.set("um.mp3", 222)
    const musica = leitor()
    musica.acrescentar([ficheiro("um.mp3"), ficheiro("dois.mp3")])
    await Promise.resolve()
    await Promise.resolve()
    expect(musica.estado.fila).toEqual([
      { id: "f1", nome: "um", duracao: 222 },
      { id: "f2", nome: "dois" },
    ])
  })

  it("a posição e o procurar seguem o elemento; antes de tocar, zero", async () => {
    const musica = leitor()
    musica.acrescentar([ficheiro("um.mp3")])
    expect(musica.posicao).toEqual({ tempo: 0, duracao: null })
    await musica.tocar()
    elemento.duration = 200
    musica.procurar(50)
    expect(musica.posicao).toEqual({ tempo: 50, duracao: 200 })
    musica.procurar(999)
    expect(musica.posicao.tempo).toBe(200)
  })

  it("anterior: passados 3 s recomeça a actual; antes disso, recua uma faixa", async () => {
    const musica = leitor()
    musica.acrescentar([ficheiro("um.mp3"), ficheiro("dois.mp3")])
    await musica.tocar("f2")
    elemento.currentTime = 10
    await musica.anterior()
    expect(musica.estado.actual).toBe("f2")
    expect(elemento.currentTime).toBe(0)
    await musica.anterior()
    expect(musica.estado.actual).toBe("f1")
  })

  it("repetir: depois da última vem a primeira", async () => {
    const musica = leitor()
    musica.acrescentar([ficheiro("um.mp3"), ficheiro("dois.mp3")])
    musica.repetir = true
    await musica.tocar("f2")
    await musica.saltar()
    expect(musica.estado).toMatchObject({ actual: "f1", aTocar: true, repetir: true })
  })

  it("baralhar ligado mistura o que falta e o que entra; desligar não desfaz", async () => {
    const musica = leitor(() => 0)
    musica.acrescentar([ficheiro("a.mp3"), ficheiro("b.mp3"), ficheiro("c.mp3")])
    musica.aleatorio = true
    expect(musica.estado.aleatorio).toBe(true)
    expect(musica.estado.fila.map((faixa) => faixa.nome)).toEqual(["a", "c", "b"])
    musica.aleatorio = false
    expect(musica.estado.fila.map((faixa) => faixa.nome)).toEqual(["a", "c", "b"])
  })

  it("mover põe a faixa no sítio pedido, e a actual continua a mesma", async () => {
    const musica = leitor()
    musica.acrescentar([ficheiro("a.mp3"), ficheiro("b.mp3"), ficheiro("c.mp3")])
    await musica.tocar("f1")
    musica.mover("f3", 0)
    expect(musica.estado.fila.map((faixa) => faixa.nome)).toEqual(["c", "a", "b"])
    expect(musica.estado.actual).toBe("f1")
    musica.mover("f3", 99)
    expect(musica.estado.fila.map((faixa) => faixa.nome)).toEqual(["a", "b", "c"])
  })
})
