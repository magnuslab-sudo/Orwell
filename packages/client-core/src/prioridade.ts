/**
 * The priority of each call stream at the WebRTC sender.
 *
 * Requested by the owner on November 2, 2026: "make voice the priority". Voice, video, and sound
 * share the same link for each person (one transport, with a 5 Mbit/s cap at the server) and the
 * same server output. Without priority, the spec gives "low" to all, and on a tight network the
 * browser splits what it has equally: voice could choke next to a 2.5 Mbit/s screen.
 *
 * With this, voice is "high", screen sound and music are "medium", and video
 * (camera and screen) stays at "low" per the spec. `priority` tells the browser
 * how to split bandwidth across streams; `networkPriority` asks the network for the
 * corresponding DSCP mark, where the network respects it.
 *
 * Applied with `setParameters` AFTER the sender is created, not in the
 * video encodings of `produce`: the server reads video encodings for the
 * cap (`#orcamentoExcedido` in `media.ts`), and priority is not its concern. A failure
 * is not fatal: the call continues, just without the priority.
 */
export type Prioridade = "very-low" | "low" | "medium" | "high"

export type FluxoComPrioridade = "microfone" | "musica" | "ecra-som" | "camara" | "ecra"

export function prioridadeDoFluxo(fluxo: FluxoComPrioridade): Prioridade {
  switch (fluxo) {
    case "microfone":
      return "high"
    case "musica":
    case "ecra-som":
      return "medium"
    default:
      return "low"
  }
}

/** Marks the priority at the sender. True when it was applied. */
export async function aplicarPrioridade(emissor: RTCRtpSender, prioridade: Prioridade): Promise<boolean> {
  try {
    const parametros = emissor.getParameters()
    const codificacoes = parametros.encodings ?? []
    if (codificacoes.length === 0) return false
    for (const codificacao of codificacoes) {
      const c = codificacao as RTCRtpEncodingParameters & { priority?: Prioridade; networkPriority?: Prioridade }
      c.priority = prioridade
      c.networkPriority = prioridade
    }
    await emissor.setParameters(parametros)
    return true
  } catch {
    return false
  }
}
