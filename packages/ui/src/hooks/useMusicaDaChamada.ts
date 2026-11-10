import { useCallback, useEffect, useState } from "react"
import {
  capturarSomDaFonte,
  LeitorDeMusica,
  type EstadoDaMusica,
  type EstadoDoLeitor,
  type FicheiroDeAudio,
  type FonteCapturada,
  type PosicaoDoLeitor,
  type SomCapturado,
} from "@enclave/client-core"
import type { EnclaveBridge } from "../bridge.js"
import { appDoDj, largarPedidoDoDj, marcarPedidoDoDj } from "../lib/pedidoDoDj.js"
import { strings } from "../strings.js"
import { PREFS_EVENT, readPrefs, writePrefs } from "./usePrefs.js"

/**
 * The DJ's music: the player for this device connected to the call. Phase 9.
 *
 * **The player lives with the CALL, not with the panel.** The panel unmounts
 * on every channel change (the dock replaces it), and a player in `useState`
 * would silence the music mid-event. So there is one player per `Call` object,
 * stored in a `WeakMap`, and the link between them forms once at birth: the
 * track name goes to the announcement, and the call ending pauses the player.
 *
 * An engine without `partilharMusica` (a test double, an old bridge) has no
 * music: `disponivel` is false and the panel does not show the button.
 */

type ChamadaComMusica = EnclaveBridge["call"] & {
  musica?: EstadoDaMusica
  emSalaAfk?: boolean
  partilharMusica?: (faixa: MediaStreamTrack, aTocar?: string | null) => Promise<boolean>
  mudarATocar?: (aTocar: string | null) => void
  pararMusica?: () => Promise<void>
}

const leitores = new WeakMap<object, LeitorDeMusica>()

/** The name to announce: the track name, only while it plays. Nothing is said when paused. */
function nomeAAnunciar(leitor: LeitorDeMusica): string | null {
  return leitor.estado.aTocar ? leitor.nomeActual : null
}

/** The player for this call, created and linked on first query. */
export function leitorDaChamada(call: EnclaveBridge["call"], criar: () => LeitorDeMusica = () => new LeitorDeMusica()): LeitorDeMusica {
  const existente = leitores.get(call)
  if (existente) return existente
  const leitor = criar()
  // The output volume stored on this device takes effect on the first Play.
  leitor.volumeDaEmissao = readPrefs().volumeDaEmissao
  const chamada = call as ChamadaComMusica
  leitor.on("estado", () => {
    // Only if music is in the call: nothing to announce before the first Play. And only if the music on air is from the player: with a captured source on air, changing the list does not change the announcement.
    if (chamada.musica && !capturaDaChamada(call).som) chamada.mudarATocar?.(nomeAAnunciar(leitor))
  })
  if (typeof chamada.on === "function") {
    // The call dropped the music (left, Stop, server refused): the player stops
    // too, so the DJ does not hear themselves alone without knowing.
    chamada.on("music", (evento) => {
      if (evento.estado === null) leitor.pausar()
    })
  }
  leitores.set(call, leitor)
  return leitor
}

/**
 * The CAPTURED source on air (tab, system, window), per call, for the same
 * reason as the player: the panel unmounts on every channel change, and the
 * capture must not die with it. One stream at a time: either the player or the
 * capture.
 */
class CapturaDaChamada {
  som: SomCapturado | null = null
  readonly #ouvintes = new Set<() => void>()

  mudar(som: SomCapturado | null): void {
    this.som = som
    for (const ouvinte of [...this.#ouvintes]) ouvinte()
  }

  ouvir(ouvinte: () => void): () => void {
    this.#ouvintes.add(ouvinte)
    return () => this.#ouvintes.delete(ouvinte)
  }

  /** Stop capturing: the browser capture stops (the recording indicator disappears). Does not affect the call. */
  largar(): void {
    const som = this.som
    if (!som) return
    this.mudar(null)
    som.parar()
  }
}

const capturas = new WeakMap<object, CapturaDaChamada>()

function capturaDaChamada(call: EnclaveBridge["call"]): CapturaDaChamada {
  const existente = capturas.get(call)
  if (existente) return existente
  const captura = new CapturaDaChamada()
  const chamada = call as ChamadaComMusica
  if (typeof chamada.on === "function") {
    // The call dropped the music (left, server refused): the capture stops too.
    chamada.on("music", (evento) => {
      if (evento.estado === null) captura.largar()
    })
  }
  capturas.set(call, captura)
  return captura
}

/** What the UI shows about the captured source on air. */
export interface FonteNoAr {
  fonte: FonteCapturada
  /** The tab or window name, or the source name when it is unknown. */
  origem: string
}

export interface MusicaDaChamada {
  /** This engine can share music. */
  disponivel: boolean
  estado: EstadoDoLeitor
  /** Our music in the call. See `EstadoDaMusica`. */
  musica: EstadoDaMusica
  /** The player's last error, with key and detail. Clears on the next gesture. */
  erro: { detail: string; nome: string } | null
  volumeLocal: number
  /**
   * The track the player puts in the call, in a stable `MediaStream`, for the
   * visualizer and spectrum. `null` before the first Play.
   */
  faixa: MediaStream | null
  /** How much of the music GOES to the call, from 0 to 1. See `LeitorDeMusica.volumeDaEmissao`. */
  volumeDaEmissao: number
  acrescentar: (ficheiros: Iterable<FicheiroDeAudio>) => number
  tocar: (id?: string) => Promise<void>
  pausar: () => void
  saltar: () => Promise<void>
  baralhar: () => void
  remover: (id: string) => Promise<void>
  parar: () => Promise<void>
  definirVolumeLocal: (valor: number) => void
  /** Where the loaded track is played from. Read when queried (the display queries every frame). */
  posicao: () => PosicaoDoLeitor
  procurar: (segundos: number) => void
  anterior: () => Promise<void>
  definirRepetir: (ligado: boolean) => void
  definirAleatorio: (ligado: boolean) => void
  mover: (id: string, indice: number) => void
  /** Change what goes out and save it to the device (`Prefs.volumeDaEmissao`). */
  definirVolumeDaEmissao: (valor: number) => void
  /** The captured source on air, or nothing (files, or silence). */
  captura: FonteNoAr | null
  /**
   * Open the source selector and put its audio in the call. Call from inside
   * the click handler. Removes whatever is on air (files, another capture).
   */
  partilharFonte: (fonte: FonteCapturada) => Promise<void>
}

/** The name for the announcement and card: the tab or window name, or the source name. */
function origemDe(som: SomCapturado, nomeDaApp: string | null): string {
  return (nomeDaApp ?? "").trim() || som.origem || strings.musica.origem(som.fonte)
}

export function useMusicaDaChamada(call: EnclaveBridge["call"]): MusicaDaChamada {
  const chamada = call as ChamadaComMusica
  const disponivel = typeof chamada.partilharMusica === "function"
  const leitor = disponivel ? leitorDaChamada(call) : null
  const [estado, setEstado] = useState<EstadoDoLeitor>(() => leitor?.estado ?? { fila: [], actual: null, aTocar: false, repetir: false, aleatorio: false })
  const [musica, setMusica] = useState<EstadoDaMusica>(() => chamada.musica ?? null)
  const [erro, setErro] = useState<{ detail: string; nome: string } | null>(null)
  const [volumeLocal, setVolumeLocal] = useState(() => leitor?.volumeLocal ?? 1)
  const [volumeDaEmissao, setVolumeDaEmissao] = useState(() => leitor?.volumeDaEmissao ?? 1)
  const captura = disponivel ? capturaDaChamada(call) : null
  const [somNoAr, setSomNoAr] = useState<{ som: SomCapturado; origem: string } | null>(null)
  /** The name given by the app selector lives here, next to the capture. */
  const [origens] = useState(() => new WeakMap<SomCapturado, string>())

  useEffect(() => {
    if (!captura) return
    const ler = (): void => {
      const som = captura.som
      setSomNoAr(som ? { som, origem: origens.get(som) ?? origemDe(som, null) } : null)
    }
    ler()
    return captura.ouvir(ler)
  }, [captura, origens])

  useEffect(() => {
    if (!leitor) return
    setEstado(leitor.estado)
    const largarEstado = leitor.on("estado", setEstado)
    const largarErro = leitor.on("erro", setErro)
    return () => {
      largarEstado()
      largarErro()
    }
  }, [leitor])

  useEffect(() => {
    setMusica(chamada.musica ?? null)
    if (!disponivel || typeof chamada.on !== "function") return
    return chamada.on("music", (evento) => setMusica(evento.estado))
  }, [chamada, disponivel])

  const tocar = useCallback(
    async (id?: string) => {
      if (!leitor) return
      setErro(null)
      // One stream at a time: the capture comes off air before files go on.
      if (captura?.som) {
        captura.largar()
        await chamada.pararMusica?.()
      }
      // Play first, inside the click: that is the gesture that wakes the context.
      await leitor.tocar(id)
      const faixa = leitor.faixa
      if (!faixa || !leitor.estado.aTocar || chamada.musica) return
      const saiu = (await chamada.partilharMusica?.(faixa, nomeAAnunciar(leitor))) ?? false
      // The call did not take it, and said why via `error`: the DJ does not hear
      // themselves alone thinking the room is listening with them.
      if (!saiu) leitor.pausar()
    },
    [leitor, chamada, captura],
  )

  const parar = useCallback(async () => {
    leitor?.pausar()
    captura?.largar()
    await chamada.pararMusica?.()
  }, [leitor, chamada, captura])

  const partilharFonte = useCallback(
    async (fonte: FonteCapturada) => {
      if (!leitor || !captura) return
      setErro(null)
      // An AFK room does not take music: the refusal comes BEFORE the selector, which would light the recording indicator for nothing.
      if (chamada.emSalaAfk === true) {
        setErro({ detail: "the afk room has no voice and no text", nome: "" })
        return
      }
      const app = appDoDj()
      if (app) {
        const haSom = await app.somDoSistema().catch(() => false)
        if (!haSom) {
          setErro({ detail: "this device does not give the system sound", nome: "" })
          return
        }
        if (await app.gravacaoNegada().catch(() => false)) {
          setErro({ detail: "the system does not allow recording the sound", nome: "" })
          return
        }
        marcarPedidoDoDj(fonte)
      }
      const resultado = await capturarSomDaFonte(fonte, {}, { volumeDaEmissao: leitor.volumeDaEmissao })
      // The name the app selector gave the window. No marked request in the browser.
      const pedido = app ? largarPedidoDoDj() : null
      if (!resultado.ok) {
        if (!resultado.cancelado) setErro({ detail: resultado.detail, nome: resultado.nome ?? "" })
        return
      }
      const som = resultado.som
      const origem = origemDe(som, pedido?.nome ?? null)
      origens.set(som, origem)

      // Whatever was on air comes off: files or another capture.
      leitor.pausar()
      captura.largar()
      if (chamada.musica) await chamada.pararMusica?.()

      captura.mudar(som)
      // The browser "Stop sharing" or the window closed: the music leaves the call, cleared.
      som.on("fim", () => {
        if (captura.som !== som) return
        captura.mudar(null)
        void chamada.pararMusica?.()
      })
      const saiu = (await chamada.partilharMusica?.(som.faixa, origem)) ?? false
      // The call did not take it, and said why via `error`: the capture closes.
      if (!saiu && captura.som === som) captura.largar()
    },
    [leitor, captura, chamada, origens],
  )

  return {
    disponivel,
    estado,
    musica,
    erro,
    faixa: somNoAr ? fluxoDaFaixa(somNoAr.som.faixa) : leitor ? fluxoDaFaixa(leitor.faixa) : null,
    volumeLocal,
    volumeDaEmissao,
    acrescentar: (ficheiros) => {
      setErro(null)
      return leitor?.acrescentar(ficheiros) ?? 0
    },
    tocar,
    pausar: () => leitor?.pausar(),
    saltar: async () => {
      await leitor?.saltar()
    },
    baralhar: () => leitor?.baralhar(),
    remover: async (id) => {
      await leitor?.remover(id)
    },
    parar,
    definirVolumeLocal: (valor) => {
      if (!leitor) return
      leitor.volumeLocal = valor
      setVolumeLocal(leitor.volumeLocal)
    },
    posicao: () => leitor?.posicao ?? { tempo: 0, duracao: null },
    procurar: (segundos) => leitor?.procurar(segundos),
    anterior: async () => {
      await leitor?.anterior()
    },
    definirRepetir: (ligado) => {
      if (leitor) leitor.repetir = ligado
    },
    definirAleatorio: (ligado) => {
      if (leitor) leitor.aleatorio = ligado
    },
    mover: (id, indice) => leitor?.mover(id, indice),
    captura: somNoAr ? { fonte: somNoAr.som.fonte, origem: somNoAr.origem } : null,
    partilharFonte,
    definirVolumeDaEmissao: (valor) => {
      if (!leitor) return
      leitor.volumeDaEmissao = valor
      // The same cursor works for the captured source on air.
      if (captura?.som) captura.som.volumeDaEmissao = leitor.volumeDaEmissao
      setVolumeDaEmissao(leitor.volumeDaEmissao)
      // Read from disk at gesture time, like `choose` in `usePrefs`: a choice made
      // on another screen in the meantime does not disappear.
      writePrefs({ ...readPrefs(), volumeDaEmissao: leitor.volumeDaEmissao })
    },
  }
}

/** One `MediaStream` per track, the same on every render: the analyzer does not rebuild. */
const fluxos = new WeakMap<MediaStreamTrack, MediaStream>()
function fluxoDaFaixa(faixa: MediaStreamTrack | null): MediaStream | null {
  if (!faixa || typeof MediaStream === "undefined") return null
  let fluxo = fluxos.get(faixa)
  if (!fluxo) {
    fluxo = new MediaStream([faixa])
    fluxos.set(faixa, fluxo)
  }
  return fluxo
}

/**
 * The volume key for someone's MUSIC, in the volumes record.
 *
 * Same record as voice volume (`useVolumes`), with its cap and pruning, but a
 * different key: voice and music from the same person are two choices. The
 * prefix does not collide with an address, which always starts with `@`.
 */
export function chaveDoVolumeDaMusica(endereco: string): string {
  return `musica:${endereco}`
}

/**
 * Music muted from this device for someone who is not silent ("Mute music",
 * owner October 27, 2026). Mutes only the person's music track; voice stays.
 * The music volume cursor does not change, to return to the same level when
 * listening again.
 *
 * Read from `Prefs` and re-read on each `PREFS_EVENT`: the panel and dock
 * mount in turn, and both must mute the same music.
 */
export function useMusicasCaladas(): {
  calada: (endereco: string) => boolean
  alternar: (endereco: string) => void
} {
  const [caladas, setCaladas] = useState<readonly string[]>(() => readPrefs().musicasCaladas)
  useEffect(() => {
    if (typeof window === "undefined") return
    const reler = (): void => setCaladas(readPrefs().musicasCaladas)
    window.addEventListener(PREFS_EVENT, reler)
    return () => window.removeEventListener(PREFS_EVENT, reler)
  }, [])
  const alternar = useCallback((endereco: string) => {
    // Read from disk at gesture time, like `choose` in `usePrefs`.
    const agora = readPrefs()
    const musicasCaladas = agora.musicasCaladas.includes(endereco)
      ? agora.musicasCaladas.filter((quem) => quem !== endereco)
      : [...agora.musicasCaladas, endereco]
    writePrefs({ ...agora, musicasCaladas })
    setCaladas(readPrefs().musicasCaladas)
  }, [])
  return { calada: (endereco) => caladas.includes(endereco), alternar }
}
