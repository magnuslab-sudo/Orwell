import type { SfuAviso } from "@enclave/client-core"
import type { FonteDeMedia } from "@enclave/protocol"

/**
 * The SFU bridge on the main process side.
 *
 * In the browser the bridge talks to the session directly: both live on the
 * same page, and `apps/web/src/bridge.ts` is a nine-line delegation. Not here.
 * The session lives in this process and the call lives in the renderer, because
 * WebRTC only exists where there is DOM. Between them is IPC, and this is it.
 *
 * This file is the bridge without Electron. Nothing here imports `electron`,
 * which is why it exists separate from `index.ts`-same reason as `ecra.ts`: the
 * main process talks to a library that does not run outside it, and while the
 * logic lived in there, there was no way to test it. Ports come in as
 * parameters; `index.ts` wires them to the real ones.
 *
 * **And testing this layer is the point.** It was in a bridge like this that
 * we discovered `applyMediaPrefs` was never implemented-noise suppression,
 * gain, microphone choice never worked in the installed app, ever, and there
 * was no way to tell. A `call-sfu.ts` with thousands of tests and a bridge
 * that doesn't pass it the path is exactly the same bug again: nothing breaks,
 * calls keep working anyway, and the whole phase does nothing.
 *
 * What does NOT cross this boundary stays off it: the identity key, the MLS
 * group state, the vault. What does pass are transport, producer, and consumer
 * parameters-ICE, DTLS, RTP. None of them open a single frame: media goes
 * encrypted with SFrame under all this, the key from the epoch exporter, and
 * the SFU never had it.
 */

/**
 * Channel names in one place, not duplicated on both sides.
 *
 * Same reason as `CAPACIDADE_SFU` in the protocol: **swapping one letter
 * between processes gives no compile error.** Written twice, a channel renamed
 * only on the `preload` side gives an `invoke` with no handler-what you see is
 * a call that crashes at entry with an Electron message about a name. Imported
 * on both sides, divergence becomes impossible instead of needing a test to
 * catch it.
 */
export const CANAIS_SFU = {
  suporta: "sfu:suporta",
  entrar: "sfu:entrar",
  sair: "sfu:sair",
  criarTransporte: "sfu:transporte-criar",
  ligarTransporte: "sfu:transporte-ligar",
  produzir: "sfu:produzir",
  fecharProdutor: "sfu:produtor-fechar",
  consumir: "sfu:consumir",
  retomar: "sfu:retomar",
  /** The counterpart to `retomar`: stop receiving without closing. See `sfu.pause`. */
  pausar: "sfu:pausar",
  /** Request a keyframe for a video consumer (Phase M2). See `sfu.keyframe`. */
  pedirFotogramaChave: "sfu:fotograma-chave",
  /** From main to renderer, one way only: what the SFU says on its own. */
  aviso: "event:sfu",
} as const

/**
 * The session interface this file needs.
 *
 * Written by hand and narrow on purpose, like the `mediasoup-client` interface
 * in `call-sfu.ts`: it makes explicit what parts of the session the SFU bridge
 * touches, and lets you test it without spinning up a full session.
 */
export interface SessaoSfu {
  /** Read on every request. See `CANAIS_SFU.suporta` and `Session.suportaSfu`. */
  readonly suportaSfu: boolean
  sfuEntrarNoAmbito(
    channel: string,
    scope: string,
  ): Promise<{ rtpCapabilities: unknown; producers: { id: string; kind: "audio" | "video"; address: string }[] }>
  sfuSairDoAmbito(channel: string, scope: string): void
  sfuCriarTransporte(
    channel: string,
    scope: string,
    direction: "envio" | "recepcao",
  ): Promise<{ id: string; iceParameters: unknown; iceCandidates: unknown; dtlsParameters: unknown }>
  sfuLigarTransporte(transport: string, dtlsParameters: unknown): Promise<void>
  sfuProduzir(transport: string, kind: "audio" | "video", rtpParameters: unknown, fonte?: FonteDeMedia): Promise<string>
  sfuFecharProdutor(producer: string): Promise<void>
  sfuConsumir(
    transport: string,
    producer: string,
    rtpCapabilities: unknown,
  ): Promise<{ id: string; producerId: string; kind: "audio" | "video"; rtpParameters: unknown }>
  sfuRetomar(transport: string, consumer: string): Promise<void>
  sfuPausar(transport: string, consumer: string): Promise<void>
  sfuPedirFotogramaChave(transport: string, consumer: string): void
  on(evento: "sfu", ouvinte: (aviso: SfuAviso) => void): () => void
}

/**
 * Register a request-response channel.
 *
 * Generic so each call below is written with the session method's actual types
 * instead of an `unknown` list that would let argument order swap without
 * warning. `index.ts` wires this to `ipcMain.handle` and discards the
 * event-which carries a `sender` the renderer shouldn't hold, same as `preload`.
 */
export interface RegistarPedido {
  <A extends unknown[], R>(canal: string, ouvinte: (...argumentos: A) => R): void
}

export interface PortasDoSfu {
  registar: RegistarPedido
  /** Send a notification to the renderer. `window.webContents.send` for real. */
  enviar: (canal: string, carga: unknown) => void
  sessao: SessaoSfu
}

/**
 * Wire the whole path: the eight requests and the notification that arrives on
 * its own.
 *
 * Order doesn't matter here; what matters is nothing goes missing. Each fails
 * differently, none fail loudly:
 *
 *  - without `suporta` the gate stays shut and the installed app hangs against
 *    a server with SFU. **Nothing breaks**, which is why this is the costliest
 *    bug this layer can produce;
 *  - without `entrar` there are no `rtpCapabilities` and `device.load()` never
 *    runs;
 *  - without `retomar` the consumer stalls forever-sound reaches the computer,
 *    decodes, never plays;
 *  - without `aviso` the call starts, you hear who was there, and **no one
 *    joining after is heard, ever, no error anywhere.**
 */
export function ligarSfu({ registar, enviar, sessao }: PortasDoSfu): void {
  /*
    Read on every request, never cached.
    
    A boolean captured here is read before `hello.ok` and is false forever-and
    even after wiring, a server can ROLL BACK: a production rollback, an old
    container coming up, a dead media worker. The next call must fall back on
    its own, no one remembers to close anything, and this getter ensures it.
    */
  registar(CANAIS_SFU.suporta, () => sessao.suportaSfu)

  registar(CANAIS_SFU.entrar, (channel: string, scope: string) => sessao.sfuEntrarNoAmbito(channel, scope))

  /*
    Leave returns nothing and expects nothing: the gateway doesn't respond to
    `sfu.scope.leave`. It stays a `handle` not a `send` so the renderer knows
    it landed-and so there aren't two styles of channel in this list, which is
    how one gets forgotten.
  */
  registar(CANAIS_SFU.sair, (channel: string, scope: string) => {
    sessao.sfuSairDoAmbito(channel, scope)
    return { ok: true }
  })

  registar(CANAIS_SFU.criarTransporte, (channel: string, scope: string, direction: "envio" | "recepcao") =>
    sessao.sfuCriarTransporte(channel, scope, direction),
  )

  registar(CANAIS_SFU.ligarTransporte, (transport: string, dtlsParameters: unknown) =>
    sessao.sfuLigarTransporte(transport, dtlsParameters).then(() => ({ ok: true })),
  )

  registar(CANAIS_SFU.produzir, (transport: string, kind: "audio" | "video", rtpParameters: unknown, fonte?: FonteDeMedia) =>
    sessao.sfuProduzir(transport, kind, rtpParameters, fonte),
  )

  /*
    Stop screen sharing, not the same as leaving the call.

    Without this channel, the renderer closes its producer and the server never
    knows: it keeps announcing a stream that no longer exists, and whoever was
    watching gets the last frame frozen forever. Nothing breaks-the hallmark of
    missing things in this layer.
  */
  registar(CANAIS_SFU.fecharProdutor, (producer: string) =>
    sessao.sfuFecharProdutor(producer).then(() => ({ ok: true })),
  )

  registar(CANAIS_SFU.consumir, (transport: string, producer: string, rtpCapabilities: unknown) =>
    sessao.sfuConsumir(transport, producer, rtpCapabilities),
  )

  registar(CANAIS_SFU.retomar, (transport: string, consumer: string) =>
    sessao.sfuRetomar(transport, consumer).then(() => ({ ok: true })),
  )

  /*
    And the counterpart, which is what makes "Stop watching" a screen save
    server bandwidth instead of just saving decode on this side. See `sfu.pause`
    in the protocol.
  */
  registar(CANAIS_SFU.pausar, (transport: string, consumer: string) =>
    sessao.sfuPausar(transport, consumer).then(() => ({ ok: true })),
  )

  // Phase M2: viewers request a keyframe. No server response; `ok` is IPC only.
  registar(CANAIS_SFU.pedirFotogramaChave, (transport: string, consumer: string) => {
    sessao.sfuPedirFotogramaChave(transport, consumer)
    return Promise.resolve({ ok: true })
  })

  /*
    What the server says without being asked.

    This is the only part of the call that comes from the SERVER instead of the
    encrypted roster, and it has to be: whoever sees a new stream appear in the
    router is routing it. It goes by `send` not `handle` because it answers no
    request-the same path `voice` already takes.
  */
  sessao.on("sfu", (aviso) => enviar(CANAIS_SFU.aviso, aviso))
}
