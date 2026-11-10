import { describe, expect, it } from "vitest"
import { NEAR_BOTTOM_PX, isNearBottom } from "./scroll.js"

describe("isNearBottom", () => {
  it("no fundo exacto conta como perto", () => {
    expect(isNearBottom({ scrollTop: 500, clientHeight: 500, scrollHeight: 1000 })).toBe(true)
  })

  it("dentro do limiar conta como perto", () => {
    expect(isNearBottom({ scrollTop: 500 - NEAR_BOTTOM_PX, clientHeight: 500, scrollHeight: 1000 })).toBe(true)
  })

  it("um pixel além do limiar já não conta", () => {
    expect(isNearBottom({ scrollTop: 500 - NEAR_BOTTOM_PX - 1, clientHeight: 500, scrollHeight: 1000 })).toBe(false)
  })

  it("conteúdo mais curto que a janela está sempre perto do fundo", () => {
    expect(isNearBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 300 })).toBe(true)
  })
})
