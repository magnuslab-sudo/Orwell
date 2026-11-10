import { describe, expect, it } from "vitest"
import { isPublicAddress, REDIRECT_MAX, urlPermitida } from "./link-preview.js"

/**
 * Preview finder rejections.
 *
 * This file exists because an endpoint that fetches addresses chosen by the
 * caller is a textbook SSRF: without guards, anyone with an account uses our
 * server to reach where they cannot go, the machine's `localhost`, the private
 * network around it, and `169.254.169.254` where cloud credentials come from.
 * The machine is shared with another site in production, so none of this is
 * hypothetical.
 *
 * It is a defense that gets written once and breaks at the first careless change,
 * which is why each rejection has a named line here.
 */

describe("isPublicAddress — IPv4", () => {
  it("recusa o loopback inteiro, e não só o 127.0.0.1", () => {
    expect(isPublicAddress("127.0.0.1")).toBe(false)
    expect(isPublicAddress("127.1.2.3")).toBe(false)
    expect(isPublicAddress("127.255.255.254")).toBe(false)
  })

  it("recusa as três redes privadas", () => {
    expect(isPublicAddress("10.0.0.1")).toBe(false)
    expect(isPublicAddress("172.16.0.1")).toBe(false)
    expect(isPublicAddress("172.31.255.254")).toBe(false)
    expect(isPublicAddress("192.168.1.1")).toBe(false)
  })

  it("aceita o que está mesmo fora do 172.16/12, que é onde estas contas se enganam", () => {
    expect(isPublicAddress("172.15.0.1")).toBe(true)
    expect(isPublicAddress("172.32.0.1")).toBe(true)
  })

  it("recusa a ligação-local, onde vivem as credenciais de nuvem", () => {
    expect(isPublicAddress("169.254.169.254")).toBe(false)
    expect(isPublicAddress("169.254.0.1")).toBe(false)
  })

  it("recusa o CGNAT, que é rede de operador e não Internet", () => {
    expect(isPublicAddress("100.64.0.1")).toBe(false)
    expect(isPublicAddress("100.127.255.254")).toBe(false)
    expect(isPublicAddress("100.128.0.1")).toBe(true)
  })

  it("recusa «esta rede», multicast e o espaço reservado", () => {
    expect(isPublicAddress("0.0.0.0")).toBe(false)
    expect(isPublicAddress("0.1.2.3")).toBe(false)
    expect(isPublicAddress("224.0.0.1")).toBe(false)
    expect(isPublicAddress("239.255.255.255")).toBe(false)
    expect(isPublicAddress("240.0.0.1")).toBe(false)
    expect(isPublicAddress("255.255.255.255")).toBe(false)
  })

  it("recusa os intervalos de documentação e de teste", () => {
    expect(isPublicAddress("192.0.0.1")).toBe(false)
    expect(isPublicAddress("192.0.2.1")).toBe(false)
    expect(isPublicAddress("198.18.0.1")).toBe(false)
    expect(isPublicAddress("198.51.100.1")).toBe(false)
    expect(isPublicAddress("203.0.113.1")).toBe(false)
  })

  it("aceita endereços verdadeiramente públicos", () => {
    expect(isPublicAddress("1.1.1.1")).toBe(true)
    expect(isPublicAddress("8.8.8.8")).toBe(true)
    expect(isPublicAddress("93.184.216.34")).toBe(true)
  })
})

describe("isPublicAddress — IPv6", () => {
  it("recusa o loopback e o não-especificado", () => {
    expect(isPublicAddress("::1")).toBe(false)
    expect(isPublicAddress("::")).toBe(false)
  })

  it("recusa o local-único e a ligação-local", () => {
    expect(isPublicAddress("fc00::1")).toBe(false)
    expect(isPublicAddress("fd12:3456::1")).toBe(false)
    expect(isPublicAddress("fe80::1")).toBe(false)
    expect(isPublicAddress("febf::1")).toBe(false)
  })

  it("recusa multicast", () => {
    expect(isPublicAddress("ff02::1")).toBe(false)
  })

  it("recusa um IPv4 privado disfarçado de IPv6", () => {
    // The classic trap: the same machine, written another way. A guard that only
    // looked at text form would let all of these through.
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false)
    expect(isPublicAddress("::ffff:7f00:1")).toBe(false)
    expect(isPublicAddress("::ffff:169.254.169.254")).toBe(false)
    expect(isPublicAddress("::ffff:10.0.0.1")).toBe(false)
    // NAT64 and 6to4 wrap an IPv4 in other parts of the address.
    expect(isPublicAddress("64:ff9b::127.0.0.1")).toBe(false)
    expect(isPublicAddress("2002:7f00:0001::")).toBe(false)
  })

  it("recusa o intervalo de documentação", () => {
    expect(isPublicAddress("2001:db8::1")).toBe(false)
  })

  it("aceita um IPv6 público", () => {
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true)
  })

  it("recusa o que nem endereço é", () => {
    expect(isPublicAddress("")).toBe(false)
    expect(isPublicAddress("nao-e-um-ip")).toBe(false)
    expect(isPublicAddress("999.999.999.999")).toBe(false)
  })
})

describe("urlPermitida — o esquema e a forma", () => {
  it("aceita http e https, e mais nada", () => {
    expect(urlPermitida("https://exemplo.pt/artigo")).toBeTruthy()
    expect(urlPermitida("http://exemplo.pt")).toBeTruthy()
  })

  it("recusa os esquemas que servem para ler a máquina em vez da web", () => {
    expect(urlPermitida("file:///etc/passwd")).toBeNull()
    expect(urlPermitida("gopher://exemplo.pt/_algo")).toBeNull()
    expect(urlPermitida("data:text/html,<h1>ola</h1>")).toBeNull()
    expect(urlPermitida("ftp://exemplo.pt/f")).toBeNull()
    expect(urlPermitida("ws://exemplo.pt")).toBeNull()
  })

  it("recusa um endereço literal já proibido, sem sequer resolver nome nenhum", () => {
    expect(urlPermitida("http://127.0.0.1/admin")).toBeNull()
    expect(urlPermitida("http://[::1]/admin")).toBeNull()
    expect(urlPermitida("http://169.254.169.254/latest/meta-data/")).toBeNull()
    expect(urlPermitida("http://192.168.1.1/")).toBeNull()
    expect(urlPermitida("http://[::ffff:127.0.0.1]/")).toBeNull()
  })

  it("recusa o que não é sequer uma URL", () => {
    expect(urlPermitida("")).toBeNull()
    expect(urlPermitida("nem por sombras")).toBeNull()
  })

  it("segue redireccionamentos, mas não para sempre", () => {
    // A site that answers 302 to itself would lock the server in a loop.
    expect(REDIRECT_MAX).toBeGreaterThan(0)
    expect(REDIRECT_MAX).toBeLessThanOrEqual(5)
  })
})
