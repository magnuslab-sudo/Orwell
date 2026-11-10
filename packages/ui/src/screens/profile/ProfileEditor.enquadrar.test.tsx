import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { BridgeContext } from "../../App.js"
import type { EnclaveBridge, Profile } from "../../bridge.js"
import { ConfirmarProvider } from "../../hooks/useConfirmar.js"
import { strings } from "../../strings.js"
import { ProfileEditor } from "./ProfileEditor.js"

/**
 * The path from the profile editor to the frame sheet, and back.
 *
 * The crop is fake (jsdom does not render): it proves that choosing opens the
 * sheet, that "Cancel" leaves the face as it was, and that "Save" changes it.
 * The crop account is in `lib/enquadrar.test.ts` and the gestures in
 * `components/Enquadrar.test.tsx`.
 */
const cortar = vi.hoisted(() => vi.fn())

vi.mock("../../lib/enquadrar.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/enquadrar.js")>()
  return { ...original, cortarImagem: cortar }
})

beforeEach(() => {
  // A device that knows how to crop: that is what opens the sheet (`podeEnquadrar`).
  vi.stubGlobal("createImageBitmap", vi.fn())
  URL.createObjectURL = vi.fn(() => "blob:cara")
  URL.revokeObjectURL = vi.fn()
  cortar.mockReset()
  cortar.mockResolvedValue({ dataUrl: "data:image/webp;base64,Q09SVA==", bytes: 4, width: 256, height: 256, recoded: true })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function montar(): void {
  const inicial: Profile = { displayName: "Ana", donations: [], updatedAt: 1, avatarDataUrl: "data:image/png;base64,QU5USUdB" }
  render(
    <BridgeContext.Provider value={{} as EnclaveBridge}>
      <ConfirmarProvider>
        <ProfileEditor initial={inicial} address="@ana:casa.pt" onSaved={vi.fn()} onClose={vi.fn()} />
      </ConfirmarProvider>
    </BridgeContext.Provider>,
  )
}

function escolherECarregar(): void {
  const entrada = document.querySelector<HTMLInputElement>('input[type="file"]')
  if (!entrada) throw new Error("sem campo de ficheiro")
  fireEvent.change(entrada, { target: { files: [new File([new Uint8Array(10)], "cara.jpg", { type: "image/jpeg" })] } })
  const img = document.querySelector<HTMLImageElement>(".enquadrar-moldura img")
  if (!img) throw new Error("a folha não abriu")
  Object.defineProperty(img, "naturalWidth", { value: 800 })
  Object.defineProperty(img, "naturalHeight", { value: 600 })
  fireEvent.load(img)
}

const caraActual = (): string | null => document.querySelector<HTMLImageElement>(".avatar-preview img")?.getAttribute("src") ?? null

describe("ProfileEditor: enquadrar a fotografia", () => {
  it('escolher abre a folha do círculo; "Cancelar" deixa a cara como estava', () => {
    montar()
    escolherECarregar()
    expect(screen.getByRole("heading", { name: strings.enquadrar.titulo.circulo })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: strings.common.cancel }))
    expect(document.querySelector(".enquadrar-moldura")).toBeNull()
    expect(caraActual()).toBe("data:image/png;base64,QU5USUdB")
    expect(cortar).not.toHaveBeenCalled()
  })

  it('"Guardar" troca a cara pelo recorte, com o orçamento do avatar', async () => {
    montar()
    escolherECarregar()
    // Inside the sheet above: the editor below also has a "Save".
    const folha = screen.getByRole("dialog", { name: strings.enquadrar.titulo.circulo })
    fireEvent.click(within(folha).getByRole("button", { name: strings.enquadrar.guardar }))
    await vi.waitFor(() => expect(caraActual()).toBe("data:image/webp;base64,Q09SVA=="))
    expect(document.querySelector(".enquadrar-moldura")).toBeNull()
    const [, recorte, forma, budget] = cortar.mock.calls[0]!
    expect(recorte).toEqual({ sx: 100, sy: 0, sw: 600, sh: 600 })
    expect(forma).toBe("circulo")
    expect(budget).toMatchObject({ maxSide: 256, maxBytes: 96 * 1024 })
  })
})
