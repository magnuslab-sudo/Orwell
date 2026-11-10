import { describe, expect, it } from "vitest"
import { podeSair } from "./egresso.js"

/**
 * Nothing leaves the desktop app.
 *
 * Between August 12 and November 2, 2026 there was a gate for the embedded
 * YouTube player. The player is gone and the gate is too. These tests exist
 * to keep it from coming back by accident, when someone needs "just one more
 * domain".
 */
describe("o que sai da aplicação de secretária", () => {
  it("já não deixa passar o YouTube: o leitor embebido saiu", () => {
    // Since November 2, 2026 video opens in the system browser, and the app has
    // no reason to talk to Google.
    expect(podeSair("https://www.youtube-nocookie.com/embed/abc123")).toBe(false)
    expect(podeSair("https://i.ytimg.com/vi/abc123/hqdefault.jpg")).toBe(false)
    expect(podeSair("https://r1---sn-4g5edne7.googlevideo.com/videoplayback?x=1")).toBe(false)
  })

  it("recusa o resto da internet", () => {
    expect(podeSair("https://exemplo.pt/")).toBe(false)
    expect(podeSair("https://google.com/")).toBe(false)
    // And YouTube with cookies, which is another domain and not what was opened.
    expect(podeSair("https://www.youtube.com/watch?v=abc123")).toBe(false)
    // An address that is not even read.
    expect(podeSair("isto não é um endereço")).toBe(false)
  })

  it("não se engana com um domínio que tem o nosso à frente", () => {
    /*
      Domains from other people with the name of an old one in front. They stay
      here so the gate, if it ever comes back, has to refuse them the same way:
      the decision must be by the hostname NAME, never by `startsWith` on the
      entire URL.
      */
    expect(podeSair("https://www.youtube-nocookie.com.exemplo.pt/")).toBe(false)
    expect(podeSair("https://malgooglevideo.com/")).toBe(false)
    expect(podeSair("https://youtube-nocookie.com.mau.pt/embed/x")).toBe(false)
    expect(podeSair("https://ytimg.com.mau.pt/x.jpg")).toBe(false)
  })

  it("recusa http, mesmo para os domínios do antigo leitor", () => {
    // Plain text on the network of whoever is watching, and none of them need that.
    expect(podeSair("http://www.youtube-nocookie.com/embed/abc")).toBe(false)
  })

  it("deixa passar as ferramentas de desenvolvimento", () => {
    expect(podeSair("devtools://devtools/bundled/inspector.html")).toBe(true)
    // But only the host `devtools`, and never with another scheme in front.
    expect(podeSair("devtools://exemplo.pt/x")).toBe(false)
    expect(podeSair("http://devtools/x")).toBe(false)
  })
})

/**
 * The local Vite server, development only.
 *
 * Until November 2, 2026 the rule was `url.startsWith("http://localhost:")`,
 * with that value by default, also in the packaged app. A text prefix is not an
 * origin: in `http://localhost:@exemplo.pt/` the `localhost:` is the user name
 * and the real host is `exemplo.pt`. Now we compare the origin read by
 * `new URL()` (scheme, host and port), and with no development origin no
 * `localhost` passes.
 */
describe("o servidor de desenvolvimento", () => {
  const DEV = "http://localhost:5173"

  it("passa em desenvolvimento, com a origem exacta", () => {
    expect(podeSair("http://localhost:5173/index.html", DEV)).toBe(true)
    expect(podeSair("http://localhost:5173/", DEV)).toBe(true)
    expect(podeSair("http://localhost:5173/src/main.tsx?t=1", DEV)).toBe(true)
    // Electron delivers the canonical address, but uppercase and backslashes
    // that give the SAME host are the same origin.
    expect(podeSair("HTTP://LOCALHOST:5173/x", DEV)).toBe(true)
    expect(podeSair("http:\\\\localhost:5173\\x", DEV)).toBe(true)
    // And the electron-vite variable with a trailing slash counts as the same origin.
    expect(podeSair("http://localhost:5173/x", "http://localhost:5173/")).toBe(true)
  })

  it("sem origem de desenvolvimento, nenhum localhost passa (a app empacotada)", () => {
    expect(podeSair("http://localhost:5173/index.html")).toBe(false)
    expect(podeSair("http://localhost/")).toBe(false)
    expect(podeSair("http://localhost:80/")).toBe(false)
    expect(podeSair("http://127.0.0.1:5173/")).toBe(false)
    expect(podeSair("http://[::1]:5173/")).toBe(false)
  })

  it("recusa o anfitrião verdadeiro escondido atrás de credenciais", () => {
    for (const url of [
      "http://localhost:@exemplo.pt/",
      "http://localhost:80@exemplo.pt/",
      "http://localhost:5173@exemplo.pt/",
      "http://localhost:5173:x@exemplo.pt/",
      "http://localhost:5173 @exemplo.pt/",
      "http://127.0.0.1@exemplo.pt/",
      "http://[::1]@exemplo.pt/",
      "http://utilizador:senha@localhost:5173/",
      "http://localhost:5173@localhost:5173/",
    ]) {
      expect(podeSair(url, DEV), url).toBe(false)
      expect(podeSair(url), url).toBe(false)
    }
  })

  it("recusa domínios que começam por localhost", () => {
    for (const url of [
      "http://localhost.exemplo.pt/",
      "http://localhost.exemplo.pt:5173/",
      "http://localhost%2eexemplo.pt:5173/",
      "http://localhostexemplo.pt:5173/",
      "http://LOCALHOST.EXEMPLO.PT:5173/",
      "http:\\\\exemplo.pt\\localhost:5173",
    ]) {
      expect(podeSair(url, DEV), url).toBe(false)
    }
  })

  it("recusa outro porto, outro esquema e outro nome para a mesma máquina", () => {
    for (const url of [
      "http://localhost:5174/",
      "http://localhost/",
      "https://localhost:5173/",
      "ws://localhost:5173/",
      "http://127.0.0.1:5173/",
      "http://[::1]:5173/",
      "http://[::ffff:127.0.0.1]:5173/",
      "http://0.0.0.0:5173/",
      " http://localhost:5173/",
      "",
    ]) {
      expect(podeSair(url, DEV), url).toBe(false)
    }
  })

  it("só aceita como origem de desenvolvimento um servidor http nesta máquina", () => {
    // A badly set environment variable does not open the gate to the internet.
    expect(podeSair("http://exemplo.pt/", "http://exemplo.pt")).toBe(false)
    expect(podeSair("https://exemplo.pt/", "https://exemplo.pt")).toBe(false)
    expect(podeSair("http://localhost:5173/", "http://utilizador@localhost:5173")).toBe(false)
    expect(podeSair("http://localhost:5173/", "isto não é uma origem")).toBe(false)
    expect(podeSair("http://localhost:5173/", "")).toBe(false)
    // 127.0.0.1 and [::1] are from this machine: they pass if they are the given origin.
    expect(podeSair("http://127.0.0.1:5173/x", "http://127.0.0.1:5173")).toBe(true)
    expect(podeSair("http://[::1]:5173/x", "http://[::1]:5173")).toBe(true)
  })
})
