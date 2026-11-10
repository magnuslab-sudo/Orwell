import { useCallback, useEffect, useRef, useState } from "react"
import type { FonteCapturada } from "@enclave/client-core"
import type { EnclaveBridge, FonteDeEcra } from "../bridge.js"
import { nomearPedidoDoDj, pedidoDoDj, registarAppDoDj } from "../lib/pedidoDoDj.js"
import { ScreenPermission } from "../screens/call/ScreenPermission.js"
import { ScreenPicker } from "../screens/call/ScreenPicker.js"
import { strings } from "../strings.js"

/**
 * Screen sharing from the user's side, in the installed app.
 *
 * Joins the two halves that existed with no caller:
 *
 * 1. **The picker.** Where Electron's `useSystemPicker` does not exist (Windows,
 *    Linux, older macOS), `getDisplayMedia` falls into the main process's
 *    `setDisplayMediaRequestHandler`, which saves the request and announces it.
 *    If no one answers, the two-minute timeout denies, and at the page side
 *    that arrives as `NotAllowedError`, which the core reads as "user hit
 *    cancel" and handles silently. The button gave no error: it did nothing for
 *    two minutes, then kept doing nothing.
 *
 * 2. **macOS permission.** Read BEFORE touching `getDisplayMedia`, and order
 *    is everything: asking for a capture that the system already decided to
 *    refuse turns on the recording indicator and delivers not a single pixel.
 *
 * Returns what the shell needs and nothing else: what to do when someone taps
 * share, and the sheet open now. The caller does not know which of the two it
 * is, and does not need to.
 *
 * **Without `bridge.ecra` this is transparent**, which is the browser case:
 * Chrome brings its picker and handles permission itself, and `pedirPartilha` is
 * just `startScreenShare` as always.
 */
export function usePartilhaDeEcra(bridge: EnclaveBridge): {
  /** What to do when someone taps share screen. */
  pedirPartilha: () => void
  /** The sheet open now: the picker, the permission explanation, or nothing. */
  folha: React.JSX.Element | null
} {
  const [pedido, setPedido] = useState<string | null>(null)
  /** The sources from the open request. `null` means "the system is still looking". */
  const [fontes, setFontes] = useState<FonteDeEcra[] | null>(null)
  const [permissaoNegada, setPermissaoNegada] = useState(false)
  /** Whether the system gives system audio: without it, the audio line does not show. */
  const [somDisponivel, setSomDisponivel] = useState(false)
  /** The open request is from the DJ (tab or window): the picker opens in "audio only" mode. */
  const [soSom, setSoSom] = useState<Exclude<FonteCapturada, "sistema"> | null>(null)

  /**
   * The open request, also in a `ref`.
   *
   * State draws; the `ref` is for answering. Who answers are functions that live
   * inside a `useEffect` mounted once, the announcement listener and the call
   * end listener, and those would always see the first state value. A request
   * that no one answers is a `getDisplayMedia` that never resolves nor rejects,
   * and that does not risk reading stale.
   */
  const emAberto = useRef<string | null>(null)

  /**
   * Answer the open request, with a source or with nothing.
   *
   * One path only for the three exits, choose, give up, and call ends, because
   * the rule is the same in all three: the `callback` on the other side MUST be
   * called, and called once. Answering a request that already died is no error:
   * the main process returns `ok: false` and moves on.
   */
  const responder = useCallback(
    (fonte: FonteDeEcra | null): void => {
      const id = emAberto.current
      emAberto.current = null
      setPedido(null)
      setFontes(null)
      setSoSom(null)
      if (!id) return
      if (fonte && pedidoDoDj()) nomearPedidoDoDj(fonte.nome)
      void bridge.ecra?.escolher(id, fonte ? { id: fonte.id, nome: fonte.nome } : null).catch(() => {
        // The request died with the window, or the channel closed. Nothing to undo
        // on this side: what mattered was not leaving it hanging.
      })
    },
    [bridge],
  )

  /*
    The DJ asks the app, BEFORE opening the capture, whether the system gives
    system audio. See `appDoDj` in `lib/pedidoDoDj.ts`. In the browser there is
    no bridge, and no record.
  */
  useEffect(() => {
    const ecra = bridge.ecra
    if (!ecra) return
    registarAppDoDj({
      somDoSistema: async () => ((await ecra.som?.())?.disponivel ?? false) === true,
      gravacaoNegada: async () => (await ecra.permissao()).podeExplicar,
    })
    return () => registarAppDoDj(null)
  }, [bridge])

  useEffect(() => {
    const ecra = bridge.ecra
    if (!ecra) return

    const largarAnuncio = ecra.aoPedir((novo) => {
      /*
        A new request with another pending: the old one is answered with denial.

        Two can exist, the main process keeps them in a map for that reason. The
        UI shows one at a time, and what cannot happen is the second erasing the
        first from memory and leaving the first's `getDisplayMedia` waiting until
        timeout.
      */
      const velho = emAberto.current
      if (velho && velho !== novo.id) {
        void ecra.escolher(velho, null).catch(() => {})
      }
      /*
        The DJ's "System audio": no picker. Answer with the first full screen,
        and the core throws the image out right away (`somDoDj.ts`); only the
        `loopback` stays. With no screen, deny: the request never hangs.
      */
      const dj = pedidoDoDj()
      if (dj?.fonte === "sistema") {
        if (velho) {
          emAberto.current = null
          setPedido(null)
          setFontes(null)
        }
        const negar = (): void => void ecra.escolher(novo.id, null).catch(() => {})
        void ecra.fontes(strings.ecra.semNome).then((lista) => {
          const ecraInteiro = lista.find((cada) => cada.ecraInteiro)
          if (!ecraInteiro) return negar()
          void ecra.escolher(novo.id, { id: ecraInteiro.id, nome: ecraInteiro.nome }).catch(() => {})
        }, negar)
        return
      }
      setSoSom(dj ? dj.fonte : null)
      emAberto.current = novo.id
      setPedido(novo.id)
      setFontes(null)
      setSomDisponivel(false)
      // A question that fails is "does not exist": the line does not show. Who
      // decides if audio goes is the main process (`escolhaDoEcra`).
      void (ecra.som?.() ?? Promise.resolve({ disponivel: false })).then(
        (resposta) => setSomDisponivel(resposta.disponivel),
        () => setSomDisponivel(false),
      )
      void ecra.fontes(strings.ecra.semNome).then(
        (lista) => setFontes(lista),
        // A list that does not come is an empty list, and the picker says there is
        // nothing. Leaving it saying "searching" forever was the same button thinking
        // that this screen freed the app from.
        () => setFontes([]),
      )
    })

    /*
      The call ends with the picker open.

      The main process also closes requests at that moment, and it is good that
      it does, but whoever is looking at the picker is this window, and a share
      picker on top of a call that no longer exists is a choice that goes nowhere.
      Close it, and answer, without counting on the other side.
    */
    const largarFim = bridge.call.on("ended", () => responder(null))

    return () => {
      largarAnuncio()
      largarFim()
    }
  }, [bridge, responder])

  const pedirPartilha = useCallback((): void => {
    const ecra = bridge.ecra
    // The browser: the picker is the system's, and so is permission.
    if (!ecra) {
      void bridge.call.startScreenShare()
      return
    }
    void ecra.permissao().then(
      (estado) => {
        /*
          `podeExplicar`, not `estado !== "granted"`.

          In `not-determined` macOS still opens its dialog on the first try, and
          a sheet of ours on top would be the app explaining what the system is
          asking at the same time. The sheet is for the state where the system
          no longer asks. See `permissaoDeEcra`.
        */
        if (estado.podeExplicar) {
          setPermissaoNegada(true)
          return
        }
        void bridge.call.startScreenShare()
      },
      () => {
        /*
          The permission IPC broke: try anyway.

          Fail on the side of letting it try. A read that does not answer is not
          a system refusal, and locking sharing because of it would invent an
          obstacle no one declared, in the worst case the system refuses next,
          which is where things were before.
        */
        void bridge.call.startScreenShare()
      },
    )
  }, [bridge])

  const folha = permissaoNegada ? (
    <ScreenPermission
      onAbrirDefinicoes={() => {
        void bridge.ecra?.abrirDefinicoes().catch(() => {})
      }}
      onClose={() => setPermissaoNegada(false)}
    />
  ) : pedido !== null ? (
    <ScreenPicker
      fontes={fontes ?? []}
      aCarregar={fontes === null}
      somDisponivel={somDisponivel}
      soSom={soSom}
      onEscolher={(fonte) => responder(fonte)}
      onCancelar={() => responder(null)}
    />
  ) : null

  return { pedirPartilha, folha }
}
