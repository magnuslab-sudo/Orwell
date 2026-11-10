import { describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import type { Profile } from "../bridge.js"
import { profileFromPayload, useDirectory } from "./useDirectory.js"

describe("profileFromPayload", () => {
  it("traduz o avatar do formato de rede (avatar.inline) para avatarDataUrl", () => {
    const profile = profileFromPayload({
      t: "profile",
      displayName: "Ana",
      avatar: { inline: "data:image/png;base64,AAAA", url: "" },
      donations: [],
      updatedAt: 5,
    })
    expect(profile.avatarDataUrl).toBe("data:image/png;base64,AAAA")
    expect(profile.displayName).toBe("Ana")
    expect(profile.updatedAt).toBe(5)
  })

  it("aceita o formato do vault (avatarDataUrl directo) sem o perder", () => {
    expect(profileFromPayload({ displayName: "Rui", avatarDataUrl: "data:image/png;base64,BBBB" }).avatarDataUrl).toBe(
      "data:image/png;base64,BBBB",
    )
  })

  it("sem imagem nenhuma, o campo simplesmente não existe", () => {
    const profile = profileFromPayload({ displayName: "Zoé" })
    expect("avatarDataUrl" in profile).toBe(false)
    expect(profile.donations).toEqual([])
  })
})

describe("o próprio no directory", () => {
  it("a própria conta entra no directory, com a foto do cofre", () => {
    const { result } = renderHook(() =>
      useDirectory([], new Map(), {
        address: "@me:s",
        profile: { displayName: "Ana Bento", donations: [], avatarDataUrl: "data:image/png;base64,EU" },
      }),
    )
    // Without this, the user saw the first letter of their address where they should see themselves.
    expect(result.current.directory.get("@me:s")?.avatarDataUrl).toBe("data:image/png;base64,EU")
    expect(result.current.nameFor("@me:s")).toBe("Ana Bento")
  })

  it("guardar o perfil atualiza a entrada própria sem esperar pela rede", () => {
    const { result, rerender } = renderHook(
      ({ profile }: { profile: Profile }) => useDirectory([], new Map(), { address: "@me:s", profile }),
      { initialProps: { profile: { displayName: "Antes", donations: [] } as Profile } },
    )
    expect(result.current.nameFor("@me:s")).toBe("Antes")
    rerender({ profile: { displayName: "Depois", donations: [], avatarDataUrl: "data:image/png;base64,X" } })
    expect(result.current.nameFor("@me:s")).toBe("Depois")
    expect(result.current.directory.get("@me:s")?.avatarDataUrl).toBe("data:image/png;base64,X")
  })
})
