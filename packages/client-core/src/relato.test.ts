import { describe, expect, it, vi } from "vitest"
import { enviarRelato, origemDoServidorDe } from "./relato.js"

describe("enviarRelato", () => {
  const pedido = { endereco: "@ana:orwell.pt", versao: "0.9.2", texto: "registo" }

  it("manda o corpo para a rota do servidor da conta", async () => {
    const buscar = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await expect(enviarRelato(origemDoServidorDe(pedido.endereco), pedido, buscar)).resolves.toEqual({ ok: true })
    expect(buscar).toHaveBeenCalledWith(
      "https://orwell.pt/_enclave/relato",
      expect.objectContaining({ method: "POST", body: JSON.stringify(pedido), credentials: "omit" }),
    )
  })

  it("http só no loopback", () => {
    expect(origemDoServidorDe("@a:localhost:8448")).toBe("http://localhost:8448")
    expect(origemDoServidorDe("@a:127.0.0.1:8448")).toBe("http://127.0.0.1:8448")
    expect(origemDoServidorDe("@a:orwell.pt")).toBe("https://orwell.pt")
  })

  it("cada falha tem a sua chave: sem rede, tecto, recusa", async () => {
    await expect(enviarRelato("https://x", pedido, vi.fn(async () => Promise.reject(new TypeError("offline"))))).rejects.toThrow(
      "could not reach the homeserver",
    )
    await expect(enviarRelato("https://x", pedido, vi.fn(async () => new Response("", { status: 429 })))).rejects.toThrow(
      "too many logs sent",
    )
    await expect(enviarRelato("https://x", pedido, vi.fn(async () => new Response("", { status: 400 })))).rejects.toThrow(
      "the server did not take the log",
    )
  })
})
