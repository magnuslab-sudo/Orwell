import { strings, translateError } from "../strings.js"

/**
 * What the screen says about a call, and when it says it.
 *
 * This exists because of one word: **"connecting…"**. It was what showed below
 * everyone's name when they could not yet be heard, and it covered two facts
 * that have nothing in common.
 *
 * - **In a mesh call** there really is a connection forming between the two
 *   computers, and "connecting" describes it. It fails after some time, and the
 *   word stops being true without changing.
 * - **In an SFU call there is no connection forming with that person.** There is
 *   a connection to the server, nothing more. The `connected` that the core
 *   publishes is `fluxos.has(address)`, written in `#anunciarPorSfu`,
 *   in `call.ts`, that is, "I get their media". A person in the call whose
 *   audio has not yet arrived has `connected: false`, and drew "connecting"
 *   forever. They are not connecting to anything: they are there.
 *
 * The difference that matters to the viewer is different, and neither word gave
 * it: **is it still on the way, or is this broken?** A state that never changes
 * does not answer. So there is a timeout, and after it the phrase changes.
 *
 * Clean, and with the whole decision in one place. Before this the decision was
 * spread across two components AND was made by comparing with the translated
 * phrase, `state === strings.call.connecting`, literally, in `CallChip`.
 * That means changing the wording changed the layout silently, and two different
 * phrases for two different states were impossible by design: `pending` only
 * knew how to recognize one.
 */

/**
 * Where this call's media goes.
 *
 * `null` is the honest and common case: until the core says, we do not know. A
 * call with `null` behaves like mesh always has, which is the behavior this
 * file came to replace and the conservative reading of both.
 */
export type CaminhoDeMedia = "sfu" | "malha" | null

/** The tone of the state, so CSS stops depending on a translated string. */
export type TomDoEstado = "activo" | "aEsperar" | "parado"

export interface EstadoDaPessoa {
  texto: string
  tom: TomDoEstado
}

/**
 * How long a person with no audio still counts as "on the way".
 *
 * Twelve seconds, and the number has reasons from both sides. Below: joining an
 * SFU call means raising two transports, negotiating ICE with the server, and
 * waiting for the first `sfu.producer.new`, on a slow network that is seconds,
 * and cutting early would put "this is broken" over a call that was really being
 * set up. Above: after twelve seconds nobody believes an ellipsis anymore, and
 * the interface going silent becomes worse than a message admitting it does not know.
 *
 * The core's `PRESENCA_VALIDA_MS` does not serve here and the difference is worth
 * writing down: that one measures when you stop BELIEVING the person is in the
 * call, and it is quite a bit longer. This one measures when you stop believing
 * their audio is on the way, with them definitely there.
 */
export const PACIENCIA_MS = 12_000

/**
 * What appears under a person's name in a call.
 *
 * `esperaMs` is how long this person has had no stream. Zero for someone who just
 * appeared, and `useEsperaPorFluxo` counts it, never the age of the call,
 * which is different: someone joining at minute ten does not inherit ten minutes
 * of waiting.
 */
export function estadoDaPessoa({
  connected,
  caminho,
  esperaMs,
}: {
  connected: boolean
  caminho: CaminhoDeMedia
  esperaMs: number
}): EstadoDaPessoa {
  if (connected) return { texto: strings.call.connected, tom: "activo" }

  if (esperaMs >= PACIENCIA_MS) {
    // After the timeout, the two messages diverge because the two failures are
    // different: in one, someone who is there is not heard, in the other no
    // connection was ever set up. The reader must be able to tell which.
    return { texto: caminho === "sfu" ? strings.call.semSomHaMuito : strings.call.semLigacao, tom: "parado" }
  }

  // Within the timeout: "connecting" only where there really is something connecting.
  return {
    texto: caminho === "sfu" ? strings.call.naChamadaSemSom : strings.call.connecting,
    tom: "aEsperar",
  }
}

/**
 * What the core's `call-caminho` says, translated to what the interface uses.
 *
 * The detail is `"sfu"` or a string starting with `"malha"` (see the `emit` of
 * that code, in `call.ts`). Anything else is `null`, and `null` behaves like
 * mesh: a detail this file does not recognize cannot make the interface assert
 * a path.
 */
export function caminhoDoDetalhe(detalhe: string | undefined): CaminhoDeMedia {
  if (detalhe === "sfu") return "sfu"
  if (detalhe?.startsWith("malha")) return "malha"
  return null
}

/** A call warning: what is said, and how heavy it is. */
export interface AvisoDaChamada {
  /** Stable, so the screen does not repeat the same warning and tests can name it. */
  code: string
  texto: string
  /** `grave` is what stops the call from working; `note` is everything else. */
  nivel: "grave" | "nota"
}

/**
 * The call diagnostics a person has the right to read, and those they do not.
 *
 * The core emits diagnostics with their own names and the shell was writing
 * ALL of them to the log and nothing else (`onCallDiagnostic` → `recordDiagnostic`).
 * For the mechanics that is right: nobody needs to know how many ICE servers came.
 * For three of them it is wrong, because they describe a call that will not work
 * and nobody on screen ever finds out.
 *
 * The worst of all, and it is documented in `call.ts` itself: **two people in
 * the same room can be on different media paths**, one through the SFU,
 * the other through mesh, and never hear each other. The comment there says
 * literally *"the person on the other end will see `connecting` until they give up
 * and someone will ask why"*. The mesh offer was ignored, a line stayed in the log,
 * and the screen said nothing.
 *
 * What does NOT go here is as decided as what does: `call-sfu-ligado`,
 * `call-caminho`, `call-sfu-sem-cifra-de-media` and the others stay only in the
 * log. One warning per line of mechanics is the popup column that `statusPolicy`
 * exists to avoid.
 */
export function avisoDaChamada(code: string, detalhe: string | undefined, nomeDe: (quem: string) => string): AvisoDaChamada | null {
  switch (code) {
    /*
      The failure all silent: someone talking to us on a path this client no
      longer handles. Neither side hears the other, and neither side can know why.
      */
    case "call-sfu-oferta-de-malha":
      return {
        code,
        nivel: "grave",
        texto: detalhe ? strings.call.avisoCaminhosDiferentesDe(nomeDe(detalhe)) : strings.call.avisoCaminhosDiferentes,
      }

    /*
      Joining the SFU failed and the call was dropped entirely. The core already
      throws a message to who CALLED, and that becomes the toast; this is for
      when the failure happens with nobody having pressed anything.
    */
    case "call-sfu-entrada-falhou":
      return { code, nivel: "grave", texto: strings.call.avisoEntradaFalhou }

    /*
      Someone disappeared from everyone's screen without pressing hang up.
      Note and not grave: the call goes on, and what this prevents is the person
      thinking the other ignored them.
    */
    case "call-presenca-caducou":
      return {
        code,
        nivel: "nota",
        texto: detalhe ? strings.call.avisoPresencaCaducouDe(nomeDe(detalhe)) : strings.call.avisoPresencaCaducou,
      }

    /*
      Someone is in the call and this device does not yet have their key: their
      audio is stuck, and the card says "no audio" instead of "connected". Note
      and not grave: the call works with the others, and their audio opens itself
      in the commit that brings the key (`sfu-receiver-protected-after` removes
      the warning). With code, because it is the message someone will say in a
      report.
      */
    case "sfu-receptor-sem-chave":
      return {
        code,
        nivel: "nota",
        texto: translateError("no media key for this person yet", detalhe ? { nome: nomeDe(detalhe) } : undefined),
      }

    /*
      One of our sources is not going out yet because its cipher is not ready,
      and the engine is retrying (4/11/2026). Note and not grave: the call is
      up, nothing goes out without a cipher, and the audio (or video) opens
      itself when the cipher is ready. The detail starts with the source
      ("microphone · 2/7 · 500 ms"). Exits with `sfu-emitter-cipher-recovered`,
      `-gave-up` or `-dropped` (see `App.tsx`); if it gives up, 448 tells
      the rest.
      */
    case "sfu-emissor-cifra-a-repetir":
      return {
        code,
        nivel: "nota",
        texto: translateError("your media is not going out yet", { fonte: (detalhe ?? "").split(" · ")[0] ?? "" }),
      }

    /*
      The call server rejected someone's audio for a state that already passed
      (the request arrived late), and the engine is asking again (4/11/2026,
      #984). Note and not grave: the call works, and the audio opens itself.
      Voice only: a missing camera is not "you can't hear me". The detail starts
      with the address ("@ana:s · microphone · p-…"). Exits with
      `sfu-consumption-recovered` for that person (see `App.tsx`).
    */
    case "sfu-consumo-em-falta": {
      const [quem, fonte] = (detalhe ?? "").split(" · ")
      if (fonte !== undefined && fonte !== "microfone" && fonte !== "?") return null
      return {
        code,
        nivel: "nota",
        texto: translateError("the sound of this person is not here yet", quem ? { nome: nomeDe(quem) } : undefined),
      }
    }

    default:
      return null
  }
}
