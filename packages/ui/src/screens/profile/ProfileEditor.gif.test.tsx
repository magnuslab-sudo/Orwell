import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { ConfirmarProvider } from "../../hooks/useConfirmar.js"
import { strings } from "../../strings.js"
import type { CompressedImage } from "../../lib/images.js"
import { ProfileEditor } from "./ProfileEditor.js"

/**
 * The GIF that stopped moving is said in the sheet (phase 1c).
 *
 * The compressor is fake: jsdom does not decode images, and what is proved
 * in `lib/images.test.ts` (when a GIF stops moving) is not repeated here. Here
 * we only prove the path to the sheet: the warning appears when animation is
 * lost, does not appear when it is not lost, and goes away when you remove
 * the image.
 */
const resultado: { atual: CompressedImage } = {
  atual: { dataUrl: "data:image/gif;base64,AAAA", bytes: 3, width: 1, height: 1, recoded: false },
}

vi.mock("../../lib/images.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/images.js")>()
  return { ...original, compressImage: vi.fn(async () => resultado.atual) }
})

afterEach(cleanup)

function montar(): void {
  const inicial: Profile = { displayName: "Ana", donations: [], updatedAt: 1 }
  render(
    <BridgeContext.Provider value={{} as EnclaveBridge}>
      <ConfirmarProvider>
        <ProfileEditor initial={inicial} address="@ana:casa.pt" onSaved={vi.fn()} onClose={vi.fn()} />
      </ConfirmarProvider>
    </BridgeContext.Provider>,
  )
}

function escolher(bytes: number): void {
  const entrada = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!entrada) throw new Error("sem campo de ficheiro")
  const ficheiro = new File([new Uint8Array(bytes)], "cara.gif", { type: "image/gif" })
  fireEvent.change(entrada, { target: { files: [ficheiro] } })
}

const FRASE = "O GIF tem 400 kB. Para ficar animado, o máximo é 160 kB. Ficou parado."

describe("ProfileEditor: o GIF que ficou parado", () => {
  it("diz o peso e o máximo, e o aviso sai ao tirar a imagem", async () => {
    resultado.atual = {
      dataUrl: "data:image/webp;base64,AAAA",
      bytes: 3,
      width: 256,
      height: 256,
      recoded: true,
      animacaoPerdida: true,
    }
    montar()
    escolher(400_000)
    expect(await screen.findByText(FRASE)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: strings.profileEditor.remove }))
    expect(screen.queryByText(FRASE)).toBeNull()
  })

  it("um GIF que passou animado não tem aviso", async () => {
    resultado.atual = { dataUrl: "data:image/gif;base64,AAAA", bytes: 3, width: 480, height: 480, recoded: false }
    montar()
    escolher(150 * 1024)
    // The new face is already in the preview: the compressor's promise ended.
    await waitFor(() => expect(document.querySelector(".avatar-preview img")).toBeTruthy())
    expect(screen.queryByText(/Ficou parado/)).toBeNull()
  })
})
