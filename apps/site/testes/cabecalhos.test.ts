import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The security headers on HTML pages (ORW-05, November 4, 2026).
 *
 * In production, the site and app pages go through the nginx gateway in front
 * (`infra/nginx-enclave.conf`) and only then through Caddy. nginx sets
 * `X-Frame-Options` and the CSP with `frame-ancestors`: a `<meta>` tag does not protect
 * from framing, because the browser ignores `frame-ancestors` inside it.
 *
 * The header CSP adds to the app's `<meta>` CSP: the browser applies both. Until 4/11/2026
 * the header had `script-src 'self'` without `'wasm-unsafe-eval'`, and the noise reduction
 * `gtcrn.wasm` would not compile in production, even though the `<meta>` allowed it.
 */
const nginx = readFileSync(fileURLToPath(new URL("../../../infra/nginx-enclave.conf", import.meta.url)), "utf8")
const caddyfile = readFileSync(fileURLToPath(new URL("../../../infra/Caddyfile", import.meta.url)), "utf8")
const indexDaApp = readFileSync(fileURLToPath(new URL("../../web/index.html", import.meta.url)), "utf8")

/** Lines without comments. */
const semComentarios = (texto: string): string =>
  texto
    .split("\n")
    .map((linha) => linha.replace(/#.*$/, ""))
    .join("\n")

/** The `server` block that serves orwell.pt over HTTPS (not just a 301). */
function blocoPrincipal(): string {
  const limpo = semComentarios(nginx)
  const blocos: string[] = []
  let i = limpo.indexOf("server {")
  while (i !== -1) {
    let fundo = 0
    let fim = i
    for (let j = limpo.indexOf("{", i); j < limpo.length; j++) {
      if (limpo[j] === "{") fundo++
      else if (limpo[j] === "}" && --fundo === 0) {
        fim = j
        break
      }
    }
    blocos.push(limpo.slice(i, fim + 1))
    i = limpo.indexOf("server {", fim)
  }
  const principal = blocos.filter((b) => /server_name\s+orwell\.pt;/.test(b) && /listen 443/.test(b))
  expect(principal).toHaveLength(1)
  return principal[0]!
}

function cabecalho(bloco: string, nome: string): string[] {
  const re = new RegExp(`add_header\\s+${nome}\\s+"([^"]*)"\\s+always;`, "g")
  return [...bloco.matchAll(re)].map((m) => m[1]!)
}

function directivas(politica: string): Map<string, string> {
  return new Map(
    politica
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [nome, ...valores] = d.split(/\s+/)
        return [nome!, valores.join(" ")] as const
      }),
  )
}

describe("os cabeçalhos das páginas HTML no nginx da frente", () => {
  const bloco = blocoPrincipal()

  it("X-Frame-Options: DENY, uma vez, sempre", () => {
    expect(cabecalho(bloco, "X-Frame-Options")).toEqual(["DENY"])
  })

  it("a CSP fecha a moldura e deixa compilar WebAssembly", () => {
    const politicas = cabecalho(bloco, "Content-Security-Policy")
    expect(politicas).toHaveLength(1)
    const csp = directivas(politicas[0]!)
    expect(csp.get("frame-ancestors")).toBe("'none'")
    expect(csp.get("script-src")).toBe("'self' 'wasm-unsafe-eval'")
    expect(csp.get("default-src")).toBe("'self'")
    expect(csp.get("object-src")).toBe("'none'")
    expect(csp.get("base-uri")).toBe("'none'")
  })

  it("o script-src do cabeçalho é o mesmo da <meta> da aplicação", () => {
    /*
      The browser applies both policies: what one cuts stays cut. If the
      <meta> gains a script source and the header does not, the app breaks
      only in production, as gtcrn.wasm did.
    */
    const meta = indexDaApp.match(/http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/)?.[1] ?? ""
    expect(directivas(meta).get("script-src")).toBe(directivas(cabecalho(bloco, "Content-Security-Policy")[0]!).get("script-src"))
  })

  it("nenhum location tem add_header próprio (perdia a herança destes)", () => {
    const locations = bloco.split(/\blocation\b/).slice(1)
    for (const location of locations) expect(location).not.toMatch(/\badd_header\b/)
  })

  it("o Caddyfile não os repete, para não irem em duplicado", () => {
    const limpo = semComentarios(caddyfile)
    expect(limpo).not.toMatch(/X-Frame-Options/i)
    expect(limpo).not.toMatch(/frame-ancestors/)
  })
})
