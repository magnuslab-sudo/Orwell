import { useEffect, useRef, useState } from "react"
import { useBridge } from "../../App.js"
import type { ConnectionState, EnclaveBridge } from "../../bridge.js"
import { Button } from "../../components/Button.js"
import { TextoDeErro } from "../../components/TextoDeErro.js"
import { strings, traduzirErro } from "../../strings.js"

/**
 * How long to wait before reporting what opened.
 *
 * `resyncWelcomes` clears the marks and asks the server for invites; Welcomes
 * arrive after, one by one, and each must be opened. Counting right after
 * always gave zero to open (marks just got cleared), which meant saying
 * "it is repaired" before knowing. Eight seconds is enough for the server
 * to reply and the device to open what needs opening.
 */
export const ESPERA_DA_REPARACAO_MS = 8000

/**
 * Channels that won't open on this device at all.
 *
 * `deadWelcomes` also brings burnt Welcomes from channels where the user
 * already is (another place arrived after), and counting them meant saying
 * "2 to open" with both open in the bar.
 */
export async function canaisPorAbrir(bridge: Pick<EnclaveBridge, "social" | "channels">): Promise<string[]> {
  const [mortos, canaisAgora] = await Promise.all([bridge.social.deadWelcomes(), bridge.channels.list()])
  return mortos.filter((canal) => !canaisAgora.includes(canal))
}

type Estado =
  | { fase: "parado" }
  | { fase: "a-sincronizar" }
  /** `canais` null: there was nothing to open. `amizades`: the bridge knew how to check them. */
  | { fase: "feito"; canais: { antes: number; depois: number } | null; amizades: boolean }
  | { fase: "erro"; frase: string }

/**
 * "Sync account", in Help and diagnostics.
 *
 * There were two buttons, "Repair channels that won't open" and "Repair
 * friendships", with two status messages. Someone with a problem does not know
 * which one it is, and tapped both. Now it is one gesture: first ask again for
 * the invites of channels that won't open, then run the friendship
 * reconciliation (`social.sincronizarAgora`), and only at the end count the
 * channels. One status message only, with both answers.
 *
 * It destroys nothing: forgets the marks of failed invites and asks for them
 * again, and reconciliation is what the session already runs at each
 * connection. A host without `sincronizarAgora` does only the channels part,
 * and the message does not mention friendships.
 */
export function SincronizarConta({ connection }: { connection: ConnectionState }): React.JSX.Element {
  const bridge = useBridge()
  const [estado, setEstado] = useState<Estado>({ fase: "parado" })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const ligada = connection === "online"

  const sincronizar = async (): Promise<void> => {
    setEstado({ fase: "a-sincronizar" })
    try {
      const antes = await canaisPorAbrir(bridge)
      if (antes.length > 0) await bridge.social.resyncWelcomes()
      // `?.` because there are hosts (and tests) without the gate: only channels there.
      const verificar = bridge.social.sincronizarAgora
      if (verificar) await verificar()
      const amizades = verificar !== undefined
      if (antes.length === 0) {
        setEstado({ fase: "feito", canais: null, amizades })
        return
      }
      await new Promise<void>((resolve) => {
        timer.current = setTimeout(resolve, ESPERA_DA_REPARACAO_MS)
      })
      timer.current = null
      // To open is what did not make it to the channel list. New marks alone do not
      // make it: a Welcome that is still on the way has no mark and has not opened
      // either.
      const canais = await bridge.channels.list()
      const depois = antes.filter((canal) => !canais.includes(canal)).length
      setEstado({ fase: "feito", canais: { antes: antes.length, depois }, amizades })
    } catch (error) {
      setEstado({ fase: "erro", frase: traduzirErro(error) })
    }
  }

  // The message is written here, in the drawing, not in the state: it changes
  // with the language. An error with a code draws in two lines through
  // `TextoDeErro`; the rest passes through it unchanged.
  const frase = !ligada
    ? strings.settings.repararSemLigacao
    : estado.fase === "a-sincronizar"
      ? strings.settings.aSincronizar
      : estado.fase === "feito"
        ? [
            estado.canais
              ? strings.settings.repararFeito(estado.canais.antes, estado.canais.depois)
              : strings.settings.repararNada,
            ...(estado.amizades ? [strings.settings.repararAmizadesFeito] : []),
          ].join(" ")
        : estado.fase === "erro"
          ? estado.frase
          : ""

  return (
    <div className="reparacao">
      <Button
        variant="primary"
        disabled={!ligada || estado.fase === "a-sincronizar"}
        onClick={() => void sincronizar()}
      >
        {strings.settings.sincronizar}
      </Button>
      <p className="field-note">{strings.settings.sincronizarNota}</p>
      <p className="field-note" role="status">
        <TextoDeErro texto={frase} />
      </p>
    </div>
  )
}
