import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { useState } from "react"
import type { ChatMessage } from "../types.js"
import { usePorLer } from "./usePorLer.js"
import { esquecerMarcasDeEntrada, LAST_READ_KEY, markRead, readLastRead, useUnreads, writeLastRead } from "./useUnreads.js"

beforeEach(() => {
  localStorage.clear()
  // Each test is a fresh visit to the app, and the entry mark is per visit.
  esquecerMarcasDeEntrada()
})
afterEach(cleanup)

const CANAL = "!sala:s"

function msg(seq: number, sentAt: number, sender = "@outro:s", channel = CANAL): ChatMessage {
  return { channel, seq, sender, payload: { t: "message", id: `id-${seq}`, sentAt, body: `m${seq}` } }
}

/**
 * The harness mimics the shell: `useUnreads` advances the active channel mark in
 * a passive effect, and that's the race that `usePorLer` has to win.
 */
function Sonda({
  channel,
  messages,
  me = "@eu:s",
  avancarComoAConcha = true,
}: {
  channel: string
  messages: ChatMessage[]
  me?: string | null
  avancarComoAConcha?: boolean
}): React.JSX.Element {
  const porLer = usePorLer(channel, messages, me)
  // Exactly what the shell does, and doing it during render-even earlier than a
  // passive effect. If the freeze survives this, it survives the real shell.
  const [feito] = useState(() => {
    // From what IS stored, the way the shell does it: `markRead({} …)` wiped the
    // mark from all other channels and the channel-switch test failed because of the
    // harness, not what it was measuring.
    if (avancarComoAConcha) writeLastRead(markRead(readLastRead(), channel, messages))
    return true
  })
  return (
    <p>
      {String(feito)}|{porLer.quantas}|{porLer.primeira ?? "nenhuma"}|{porLer.marca ?? "sem-marca"}
    </p>
  )
}

const lido = (): string[] => (screen.getByText(/\|/).textContent ?? "").split("|")

describe("usePorLer", () => {
  it("não marca nada numa conversa onde nunca se esteve", () => {
    // A line above the very first message marks nothing: there's no "where you were"
    // when you were never there.
    render(<Sonda channel={CANAL} messages={[msg(1, 100), msg(2, 200)]} />)
    const [, quantas, primeira] = lido()
    expect(quantas).toBe("0")
    expect(primeira).toBe("nenhuma")
  })

  it("congela a marca da visita anterior, mesmo com a concha a avançá-la", () => {
    // The whole trap: the shell marks the channel read the instant it opens. Without
    // the freeze, the mark had already moved past the line and it never showed up.
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ [CANAL]: 150 }))
    render(<Sonda channel={CANAL} messages={[msg(1, 100), msg(2, 200), msg(3, 300)]} />)
    const [, quantas, primeira, marca] = lido()
    expect(marca).toBe("150")
    expect(quantas).toBe("2")
    expect(primeira).toBe(`${CANAL}:id-2`)
  })

  it("a marca NÃO se mexe quando chegam mensagens novas com a conversa aberta", () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ [CANAL]: 150 }))
    const { rerender } = render(<Sonda channel={CANAL} messages={[msg(1, 100), msg(2, 200)]} />)
    expect(lido()[2]).toBe(`${CANAL}:id-2`)

    // Another one arrives. The line stays where it was-if it jumped forward with
    // each message, it would stop doing anything useful.
    rerender(<Sonda channel={CANAL} messages={[msg(1, 100), msg(2, 200), msg(3, 300)]} />)
    const [, quantas, primeira, marca] = lido()
    expect(marca).toBe("150")
    expect(primeira).toBe(`${CANAL}:id-2`)
    // The COUNT goes up-two unread now, against one before. What doesn't move is
    // the PLACE: the line stays above the same message.
    expect(quantas).toBe("2")
  })

  it("as nossas próprias mensagens não contam por ler", () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ [CANAL]: 150 }))
    render(<Sonda channel={CANAL} messages={[msg(2, 200, "@eu:s"), msg(3, 300)]} />)
    const [, quantas, primeira] = lido()
    expect(quantas).toBe("1")
    expect(primeira).toBe(`${CANAL}:id-3`)
  })

  it("mensagens de outros canais não entram na conta", () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ [CANAL]: 150, "!outra:s": 150 }))
    render(<Sonda channel={CANAL} messages={[msg(2, 200, "@outro:s", "!outra:s"), msg(3, 300)]} />)
    expect(lido()[1]).toBe("1")
  })

  it("sem nada por ler não há marca nenhuma", () => {
    // House rule: what you can't use doesn't appear.
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ [CANAL]: 500 }))
    render(<Sonda channel={CANAL} messages={[msg(1, 100), msg(2, 200)]} />)
    const [, quantas, primeira] = lido()
    expect(quantas).toBe("0")
    expect(primeira).toBe("nenhuma")
  })

  /**
   * The bug that only showed up LIVE, and these tests didn't catch.
   *
   * The shell activates the channel long before the conversation screen exists:
   * the count has already run and already advanced the mark when the timeline
   * finally mounts. All the tests above mount both things at the same time-and
   * at the same time it worked. This one mounts them in the real order.
   */
  it("a marca sobrevive à contagem ter corrido ANTES de a conversa aparecer", () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ [CANAL]: 150 }))
    const mensagens = [msg(1, 100), msg(2, 200), msg(3, 300)]

    // First just the count, the way the shell does while the screen hasn't drawn yet.
    // This advances the stored mark to now.
    function SoAContagem(): React.JSX.Element {
      useUnreads(mensagens, CANAL, "@eu:s")
      return <span />
    }
    const { unmount } = render(<SoAContagem />)
    // Confirm the trap is armed: storage has already moved past the messages.
    // Without the entry mark, what comes next gives zero.
    expect(readLastRead()[CANAL]).toBeGreaterThan(300)
    unmount()

    // Only now does the conversation appear.
    render(<Sonda channel={CANAL} messages={mensagens} avancarComoAConcha={false} />)
    const [, quantas, primeira, marca] = lido()
    expect(marca).toBe("150")
    expect(quantas).toBe("2")
    expect(primeira).toBe(`${CANAL}:id-2`)
  })

  it("mudar de canal volta a congelar, agora do canal novo", () => {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify({ [CANAL]: 150, "!outra:s": 250 }))
    const mensagens = [msg(1, 100), msg(2, 200), msg(3, 300, "@outro:s", "!outra:s")]
    const { rerender } = render(<Sonda channel={CANAL} messages={mensagens} />)
    expect(lido()[3]).toBe("150")

    rerender(<Sonda channel="!outra:s" messages={mensagens} />)
    const [, quantas, primeira, marca] = lido()
    expect(marca).toBe("250")
    expect(quantas).toBe("1")
    expect(primeira).toBe("!outra:s:id-3")
  })
})
