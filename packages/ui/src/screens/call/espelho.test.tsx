import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import type { Profile } from "../../bridge.js"
import { CallChip } from "./CallChip.js"
import { VideoTile } from "./VideoTile.js"

/**
 * "Mirror my image" (phase 4): only our camera gets the `video-proprio` mark,
 * and the mirroring rule lives in the sheet and depends on the `data-espelho`
 * at the root. Other faces never mirror.
 */

vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
afterEach(cleanup)

const perfil = { displayName: "Ana" } as unknown as Profile
const fluxo = { getVideoTracks: () => [{}], getAudioTracks: () => [], getTracks: () => [] } as unknown as MediaStream
const ler = (relativo: string): string => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8")
const ecras = ler("../../styles/screens.css").replace(/\/\*[\s\S]*?\*\//g, "")

describe("o espelho da própria câmara", () => {
  it("a caixa e o cartão próprios levam a marca; os dos outros não", () => {
    render(<VideoTile stream={fluxo} muted label="Eu" connected proprio />)
    render(<VideoTile stream={fluxo} muted={false} label="Ana" connected />)
    render(<CallChip label="Eu" profile={perfil} texto="tu" camara={fluxo} proprio />)
    render(<CallChip label="Ana" profile={perfil} texto="ligada" camara={fluxo} />)
    expect(document.querySelectorAll("video.video-proprio")).toHaveLength(2)
    expect(document.querySelectorAll("video:not(.video-proprio)")).toHaveLength(2)
  })

  it("a folha só espelha com `data-espelho=\"sim\"` na raiz", () => {
    expect(ecras).toMatch(/:root\[data-espelho="sim"\] \.video-proprio\s*\{\s*transform:\s*scaleX\(-1\)/)
  })
})
