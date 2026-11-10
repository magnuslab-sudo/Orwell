import type { EnclaveBridge, FonteDeEcra, PermissaoDeEcra } from "../bridge.js"

/**
 * An Electron pretending, failing the way Electron fails.
 *
 * It exists for screen sharing tests and this is where all the care goes: **a double
 * that fails differently hides exactly the class of defect this phase was written
 * to catch**. The finding that justified it was that, without `setDisplayMediaRequestHandler`,
 * the renderer's `getDisplayMedia` rejects with `NotAllowedError`, the same name
 * the core reads as "clicked cancel" and handles silently. The button, in the
 * installed application, gave no error. It did nothing.
 *
 * That is why this double has two layers, like reality does:
 *
 * 1. `#getDisplayMedia`, which is Chromium. It responds to what the main process
 *    gives it: a source becomes a stream; a `{}` becomes `NotAllowedError`; and
 *    **with no one answering it hangs forever**, which is the state the application
 *    was in until there was a selector.
 * 2. `startScreenShare`, which is the core. It catches `NotAllowedError` by NAME,
 *    emits `call-ecra-cancelado` and returns false without a complaint, copied
 *    from `Call.startScreenShare`, not an interpretation of it.
 *
 * What is left out on purpose: the `PedidosDeEcra.fecharTodos` that the main process
 * runs when the call ends. Here the call only emits `ended`, which is what the
 * renderer sees, so the test can measure whether it is the INTERFACE responding to
 * the request instead of relying on the safety net on the other side.
 */

/** A stream with a video track, which is what a shared screen is. */
export function fluxoDeEcra(id: string): MediaStream {
  const faixa = { kind: "video", enabled: true, stop: () => {}, contentHint: "" }
  return {
    id,
    getTracks: () => [faixa],
    getVideoTracks: () => [faixa],
    getAudioTracks: () => [],
  } as unknown as MediaStream
}

export interface ElectronFalso {
  bridge: EnclaveBridge
  /** How many times Chromium was actually called to open a capture. */
  capturas: () => number
  /** How many requests are waiting for a response. Zero is the healthy state. */
  pendentes: () => number
  /** How many times the Settings panel was opened. */
  definicoes: () => number
  /** The call ended. Just what the renderer sees: the event. */
  acabarChamada: () => void
  /** The sound requested in the last choice: `true` only with the box checked. */
  somEscolhido: () => boolean | undefined
  /**
   * A `getDisplayMedia` from somewhere other than the screen button: the DJ's
   * (`capturarSomDaFonte`). Resolves with the identifier of the chosen source.
   */
  getDisplayMedia: () => Promise<MediaStream>
}

export function electronFalso({
  fontes = [] as FonteDeEcra[],
  permissao = { estado: "granted", podeExplicar: false } as PermissaoDeEcra,
  /** False is the browser host: there is no `ecra` in the bridge. */
  comEcra = true,
  /** The IPC for permission breaks. Happens with a `preload` in the middle of reloading. */
  permissaoRebenta = false,
  /** The system gives the system sound (`ecra:som`). */
  somDoSistema = false,
}: {
  fontes?: FonteDeEcra[]
  permissao?: PermissaoDeEcra
  comEcra?: boolean
  permissaoRebenta?: boolean
  somDoSistema?: boolean
} = {}): ElectronFalso {
  const ouvintes = new Map<string, ((carga: unknown) => void)[]>()
  const emitir = (evento: string, carga: unknown): void => {
    for (const ouvinte of ouvintes.get(evento) ?? []) ouvinte(carga)
  }

  /** What the main process stores: requests waiting for a response. See `PedidosDeEcra`. */
  const pendentes = new Map<string, (fonte: { id: string; nome: string } | null) => void>()
  let proximo = 0
  let anunciar: ((pedido: { id: string }) => void) | null = null
  let capturas = 0
  let definicoes = 0
  let somEscolhido: boolean | undefined

  /**
   * Chromium: a request that only resolves when someone answers.
   *
   * A `{}` from the main process side is the way to deny without leaving the request
   * hanging, and on the page side that arrives as `NotAllowedError`, the same as
   * when someone clicks cancel in the system's selector.
   */
  const getDisplayMedia = (): Promise<MediaStream> =>
    new Promise((resolver, rejeitar) => {
      /*
        The browser host, and macOS with `useSystemPicker`: the selector is from the
        SYSTEM and answers on its own. Our handler does not even get called, and that
        is why sharing works in those places without a line of our interface. Modeled
        here so the same test can measure both worlds, which is where a simplified
        double would hide the difference.
      */
      if (!comEcra) {
        resolver(fluxoDeEcra("ecra-do-sistema"))
        return
      }
      const id = `ecra-${(proximo += 1)}`
      pendentes.set(id, (fonte) => {
        if (!fonte) {
          const erro = new Error("Permission denied by system")
          erro.name = "NotAllowedError"
          rejeitar(erro)
          return
        }
        resolver(fluxoDeEcra(fonte.id))
      })
      anunciar?.({ id })
    })

  const call = {
    podePartilharEcra: true,
    /*
      The cap on people, which the panel reads from the core and not from a constant.

      Six is from the mesh, which is the core by default. Without this field the panel
      reads `undefined`, the comparison with it is always false, and the share button
      vanishes, which is a way for this entire shell to stop being measurable without
      a single line complaining.
    */
    tectoDePartilha: 6,
    /*
      The rest of the engine, reduced to what the shell needs for a call.

      Entering and leaving do nothing: the panel is drawn by the state of `App`, and
      this file models screen sharing, not signaling.
      `setMuted` exists because the shell calls it on startup, before there is any
      call, that is how someone who reloaded the page silent does not enter
      the next call speaking.
    */
    join: async (): Promise<void> => {},
    leave: async (): Promise<void> => {},
    setMuted: (): void => {},
    setCameraOff: (): void => {},
    on: (evento: string, ouvinte: (carga: never) => void): (() => void) => {
      ouvintes.set(evento, [...(ouvintes.get(evento) ?? []), ouvinte as (carga: unknown) => void])
      return () => {
        ouvintes.set(
          evento,
          (ouvintes.get(evento) ?? []).filter((outro) => outro !== (ouvinte as (carga: unknown) => void)),
        )
      }
    },
    /** Copied from `Call.startScreenShare`: the point is what it does with the error. */
    startScreenShare: async (): Promise<boolean> => {
      capturas += 1
      try {
        const fluxo = await getDisplayMedia()
        emitir("screen", { stream: fluxo })
        return true
      } catch (erro) {
        const nome = (erro as { name?: string }).name ?? ""
        if (nome === "NotAllowedError" || nome === "AbortError") {
          emitir("diagnostic", { code: "call-ecra-cancelado", detail: nome })
          return false
        }
        emitir("error", { detail: "Não foi possível partilhar o ecrã." })
        return false
      }
    },
    stopScreenShare: async (): Promise<void> => {
      emitir("screen", { stream: null })
    },
  }

  const ecra = {
    fontes: async (semNome: string): Promise<FonteDeEcra[]> =>
      fontes.map((fonte) => ({ ...fonte, nome: fonte.nome || semNome })),
    escolher: async (id: string, fonte: { id: string; nome: string; som?: boolean } | null): Promise<{ ok: boolean }> => {
      if (fonte) somEscolhido = fonte.som
      // Same semantics as `PedidosDeEcra.responder`: delete first, and an
      // unknown identifier is not an error, it happens every time the
      // window reloads with a selector open.
      const responder = pendentes.get(id)
      if (!responder) return { ok: false }
      pendentes.delete(id)
      responder(fonte)
      return { ok: true }
    },
    permissao: async (): Promise<PermissaoDeEcra> => {
      if (permissaoRebenta) throw new Error("o canal de IPC morreu")
      return permissao
    },
    som: async (): Promise<{ disponivel: boolean }> => ({ disponivel: somDoSistema }),
    abrirDefinicoes: async (): Promise<{ ok: boolean }> => {
      definicoes += 1
      return { ok: true }
    },
    aoPedir: (handler: (pedido: { id: string }) => void): (() => void) => {
      anunciar = handler
      return () => {
        anunciar = null
      }
    },
  }

  const bridge = {
    call,
    ...(comEcra ? { ecra } : {}),
    // The session subscriptions that `App` sets up and that this does not exercise.
    on: new Proxy({}, { get: () => () => () => {} }),
  } as unknown as EnclaveBridge

  return {
    bridge,
    capturas: () => capturas,
    pendentes: () => pendentes.size,
    definicoes: () => definicoes,
    acabarChamada: () => emitir("ended", {}),
    somEscolhido: () => somEscolhido,
    getDisplayMedia,
  }
}
