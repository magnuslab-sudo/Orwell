import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge } from "../../bridge.js"
import { ToastProvider } from "../../components/Toast.js"
import { strings } from "../../strings.js"
import { SettingsScreen } from "./SettingsScreen.js"

/**
 * The noise suppressor, which was not working.
 *
 * Owner complaint on August 13, 2026: "noise reduction is not working".
 * It was correct, for two independent reasons, one on each side.
 *
 * This side: toggling the switch wrote the preference to disk and nothing else.
 * What carried it to the engine was an effect tied to a SCREEN change, so the
 * choice only reached there when the person left Settings and came back, and
 * never in the middle of a call, which is exactly when you fiddle with a noise
 * suppressor.
 *
 * The other side, in `Call`, the options were read once on opening capture and
 * never again: see `aplicarSomAoVivo`.
 *
 * This test bites the first: without passing through the bridge, `applyMediaPrefs`
 * is never called and the assertion fails.
 */

afterEach(cleanup)
beforeEach(() => localStorage.clear())

function montar(applyMediaPrefs: EnclaveBridge["applyMediaPrefs"]): void {
  const bridge = { applyMediaPrefs } as unknown as EnclaveBridge
  render(
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <SettingsScreen
          address="@me:casa.pt"
          connection="online"
          connectionDetail={null}
          onLock={() => {}}
          micMuted={false}
          soundOff={false}
          onToggleMic={() => {}}
          onToggleSound={() => {}}
          seccao="media"
        />
      </ToastProvider>
    </BridgeContext.Provider>,
  )
}

describe("Configurações — o som chega ao motor", () => {
  it("desligar o cancelamento de eco avisa a ponte no mesmo gesto", async () => {
    // The browser suppressor left the screen in 0.9 (the noise reduction profile
    // does the same better); echo is the switch that stayed, and it is what proves
    // the path to the engine.
    const user = userEvent.setup()
    const applyMediaPrefs = vi.fn()
    montar(applyMediaPrefs)

    // It comes on by default; the gesture that matters is turning it off.
    await user.click(screen.getByRole("switch", { name: strings.settings.echoCancellation }))

    expect(applyMediaPrefs).toHaveBeenCalledTimes(1)
    expect(applyMediaPrefs.mock.calls[0]?.[0]).toMatchObject({ echoCancellation: false })
  })

  it("a escolha da qualidade de vídeo segue o mesmo caminho", async () => {
    const user = userEvent.setup()
    const applyMediaPrefs = vi.fn()
    montar(applyMediaPrefs)

    await user.click(screen.getByRole("button", { name: "720p" }))

    expect(applyMediaPrefs.mock.calls.at(-1)?.[0]).toMatchObject({ videoQuality: "720p" })
  })

  it("leva SEMPRE o conjunto todo, e não só o que mudou", async () => {
    // The bridge writes `call.audioSettings` whole on each call: sending only the
    // changed field would erase the other two and turning off echo would take the
    // suppressor with it. The two without a switch keep their stored value.
    const user = userEvent.setup()
    const applyMediaPrefs = vi.fn()
    montar(applyMediaPrefs)

    await user.click(screen.getByRole("switch", { name: strings.settings.echoCancellation }))

    expect(applyMediaPrefs.mock.calls[0]?.[0]).toMatchObject({
      noiseSuppression: true,
      echoCancellation: false,
      autoGainControl: true,
    })
  })
})
