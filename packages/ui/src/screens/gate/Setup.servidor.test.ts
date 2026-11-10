import { describe, expect, it } from "vitest"
import { defaultServer, SERVIDOR_DA_APP_DE_SECRETARIA } from "./Setup.js"

const local = (url: string): Pick<Location, "search" | "hostname" | "port" | "protocol"> => {
  const u = new URL(url)
  return { search: u.search, hostname: u.hostname, port: u.port, protocol: u.protocol }
}

describe("o servidor onde a conta nasce", () => {
  it("na app de secretária empacotada (file://) é o servidor público, e não localhost (Erro 201, 29/10/2026)", () => {
    expect(defaultServer(local("file:///Applications/Orwell.app/Contents/Resources/app.asar/out/renderer/index.html"))).toBe(
      SERVIDOR_DA_APP_DE_SECRETARIA,
    )
    expect(SERVIDOR_DA_APP_DE_SECRETARIA).toBe("orwell.pt")
  })

  it("no browser é o sítio de onde a página abriu", () => {
    expect(defaultServer(local("https://orwell.pt/app/"))).toBe("orwell.pt")
    expect(defaultServer(local("https://exemplo.pt:8443/app/"))).toBe("exemplo.pt:8443")
  })

  it("em desenvolvimento é o servidor local, e ?servidor= ganha a tudo", () => {
    expect(defaultServer(local("http://localhost:5173/"))).toBe("localhost:8448")
    expect(defaultServer(local("file:///x/index.html?servidor=casa.pt"))).toBe("casa.pt")
  })
})
