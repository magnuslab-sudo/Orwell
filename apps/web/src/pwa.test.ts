// @vitest-environment node
//
// `node` and not the `jsdom` used elsewhere in the package: here we only read
// files, and under jsdom `import.meta.url` stops being a `file:` path to start from.
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The installable app, and especially what its Service Worker does NOT do.
 *
 * Orwell is an end-to-end encrypted chat served by a browser: the server
 * decides what code runs on each load, and `version-watch.ts` warns when that
 * code changed. A Service Worker is the only piece of the web platform able to
 * sit between the user and the server and stay there: it holds code, responds
 * with it, and survives a deploy. This repo's Service Worker exists for one
 * reason only (alerts on Android) and does none of that. **This file is what
 * prevents someone from adding more caching later without it being a
 * deliberate choice**: whoever needs to do it will have to remove an assertion
 * here, and that discussion belongs in `docs/THREAT-MODEL.md`.
 *
 * Reads sources and builds nothing, like `apps/site/testes/pagina.test.ts`. What
 * you only see with `dist` served (the real registration, `index.html` from the
 * network) is measured in `scripts/verificar-pwa.mjs`.
 */
const raiz = fileURLToPath(new URL("../../../", import.meta.url))
const ler = (caminho: string): string => readFileSync(`${raiz}${caminho}`, "utf8")
const PUBLICO = "apps/web/public"

const html = ler("apps/web/index.html")
const sw = ler(`${PUBLICO}/sw.js`)
const caddy = ler("infra/Caddyfile")
const arranque = ler("apps/web/src/main.tsx")

interface Icone {
  src: string
  sizes: string
  type: string
  purpose: string
}
const manifesto = JSON.parse(ler(`${PUBLICO}/manifest.webmanifest`)) as {
  name: string
  short_name: string
  lang: string
  id: string
  start_url: string
  scope: string
  display: string
  background_color: string
  theme_color: string
  icons: Icone[]
}

/** PNG width and height, read from IHDR and not trusted to the filename. */
function dimensoes(caminho: string): { largura: number; altura: number } {
  const png = readFileSync(`${raiz}${caminho}`)
  expect(png.subarray(0, 8).toString("hex"), `${caminho} não é um PNG`).toBe("89504e470d0a1a0a")
  expect(png.subarray(12, 16).toString("latin1")).toBe("IHDR")
  return { largura: png.readUInt32BE(16), altura: png.readUInt32BE(20) }
}

function impressao(caminho: string): string {
  return createHash("sha256").update(readFileSync(`${raiz}${caminho}`)).digest("hex").slice(0, 8)
}

describe("o manifesto", () => {
  it("chama-se Orwell, em português, e abre como aplicação", () => {
    expect(manifesto.name).toBe("Orwell")
    expect(manifesto.short_name).toBe("Orwell")
    expect(manifesto.lang).toBe("pt")
    expect(manifesto.display).toBe("standalone")
  })

  it("vive em /app/, que é onde o Vite põe a aplicação", () => {
    // A scope wider than `/app/` would put the public page, which has no JavaScript, inside the installed app.
    const base = /base:\s*"([^"]+)"/.exec(ler("apps/web/vite.config.ts"))?.[1]
    expect(base).toBe("/app/")
    expect(manifesto.start_url).toBe(base)
    expect(manifesto.scope).toBe(base)
    expect(manifesto.id).toBe(base)
  })

  it("tem as cores da aplicação, e a da barra é a mesma da meta", () => {
    const meta = /<meta name="theme-color" content="([^"]+)"/.exec(html)?.[1]
    expect(meta).toBe("#080c1a")
    expect(manifesto.theme_color).toBe(meta)
    // `--bg-deep`: the startup screen must not flash in another color.
    expect(manifesto.background_color).toBe("#080c1a")
    expect(ler("packages/ui/src/styles/tokens.css")).toMatch(/--fundo:\s*#080c1a/)
  })

  it("traz os três ícones que a instalação pede", () => {
    expect(manifesto.icons.map((icone) => `${icone.sizes} ${icone.purpose}`).sort()).toEqual([
      "192x192 any",
      "512x512 any",
      "512x512 maskable",
    ])
  })

  it.each(manifesto.icons)("$src existe, mede o que diz, e o nome traz a impressão", (icone) => {
    expect(icone.type).toBe("image/png")
    // Relative to the manifest, which lives in `/app/`: no leading slash.
    expect(icone.src).toMatch(/^icone-(maskable-)?\d+\.[0-9a-f]{8}\.png$/)
    const { largura, altura } = dimensoes(`${PUBLICO}/${icone.src}`)
    expect(`${largura}x${altura}`).toBe(icone.sizes)
    expect(icone.src).toContain(`.${impressao(`${PUBLICO}/${icone.src}`)}.png`)
  })
})

describe("o index.html", () => {
  it("aponta para o manifesto pela raiz, a que o Vite põe /app/ à frente", () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
  })

  it("o ícone do iOS existe, tem 180 px e a impressão no nome", () => {
    const href = /<link rel="apple-touch-icon" href="\/([^"]+)"/.exec(html)?.[1] ?? ""
    expect(href).toMatch(/^apple-touch-icon\.[0-9a-f]{8}\.png$/)
    expect(dimensoes(`${PUBLICO}/${href}`)).toEqual({ largura: 180, altura: 180 })
    expect(href).toBe(`apple-touch-icon.${impressao(`${PUBLICO}/${href}`)}.png`)
  })

  it("não ficam ícones órfãos em public/, que o servidor servia para sempre", () => {
    const referidos = [
      ...manifesto.icons.map((icone) => icone.src),
      /<link rel="apple-touch-icon" href="\/([^"]+)"/.exec(html)?.[1],
    ].sort()
    const emDisco = readdirSync(`${raiz}${PUBLICO}`)
      .filter((nome) => nome.endsWith(".png"))
      .sort()
    expect(emDisco).toEqual(referidos)
  })

  it("diz ao iOS que é uma aplicação, e ocupa o ecrã até às bordas", () => {
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />')
    expect(html).toMatch(/<meta name="apple-mobile-web-app-status-bar-style" content="[a-z-]+" \/>/)
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*" \/>/)
  })

  /**
   * With the keyboard open, the page shrinks.
   *
   * The app prevents the page from scrolling (`base.css`: `overflow: hidden`,
   * `100dvh`), so the usual fix, the page scrolls and the input bar rises with it,    * does not exist here: without this viewport directive, the keyboard covers
   * the input bar and there is no gesture to bring it back.
   *
   * It lives here with the rest of what `index.html` promises to the phone because it is
   * a line that vanishes in a careless `git revert` and whose symptom only shows
   * with a virtual keyboard open, which no test suite covers.
   */
  it("e diz ao browser que o teclado virtual encolhe a página em vez de a tapar", () => {
    expect(html).toMatch(/<meta name="viewport" content="[^"]*interactive-widget=resizes-content[^"]*" \/>/)
  })

  it("a política ganhou manifest-src 'self' e nenhuma origem", () => {
    const politica = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? ""
    const directivas = new Map(
      politica.split(";").map((d) => {
        const [nome, ...fontes] = d.trim().split(/\s+/)
        return [nome as string, fontes] as const
      }),
    )
    expect(directivas.get("manifest-src")).toEqual(["'self'"])
    // Nothing embeds: the YouTube video opens in a new tab (2/11/2026).
    expect(directivas.get("frame-src")).toEqual(["'none'"])

    // Everything that is not a keyword in quotes: schemes and hosts. The
    // list is closed: whoever adds an origin must come here and declare it.
    const origens = [...directivas.values()].flat().filter((fonte) => !fonte.startsWith("'"))
    expect(origens.sort()).toEqual(
      [
        "blob:", // img-src
        "blob:", // media-src
        "blob:", // worker-src
        "data:", // img-src
        "ws://127.0.0.1:*",
        "ws://localhost:*",
        "wss://orwell.pt",
      ].sort(),
    )
  })
})

describe("o Service Worker", () => {
  /*
    The bans read the ENTIRE SOURCE, comments included, and that is on purpose:
    removing comments before searching would need a JavaScript parser, and
    a broken parser is a door. The cost is that `sw.js` cannot write
    these words even to say it does not use them, and it does not write.
  */
  it.each([
    ["interceptar pedidos", /fetch/i],
    ["guardar cópias", /caches?\b/i],
    ["avisos remotos", /push/i],
    ["carregar outros guiões", /importScripts/i],
    ["sincronização em segundo plano", /\bsync\b|periodicsync/i],
    ["falar com a rede por outro lado", /XMLHttpRequest|WebSocket|EventSource|sendBeacon/],
    ["guardar estado", /indexedDB|localStorage/i],
    ["código a partir de texto", /\beval\b|new Function/],
  ])("não tem como %s", (_o_que, proibido) => {
    expect(sw).not.toMatch(proibido)
  })

  /*
    What the Service Worker may open, and what it may read from a notification,
stated as a WHITELIST.
    
    There was once a ban here ("no URL whatsoever"), and a ban only catches
    the forms whoever wrote it remembered. The review of 21 September 2026
    missed two of them, proved by fuzzing: `openWindow("//evil.example")`,
    which has no scheme, and `openWindow(event.notification.data.url)`, which
    has no URL written and opens whatever the notification holds. A whitelist
    of what is allowed has no gaps for imagination: anything not on it is forbidden.
  */
  it("a única coisa que abre é o próprio âmbito do registo", () => {
    const abertos = [...sw.matchAll(/openWindow\(([^)]*)\)/g)].map((m) => (m[1] as string).trim())
    expect(abertos).toEqual(["ambito"])
    // And `ambito` is the scope, assigned once and never again.
    const atribuicoes = [...sw.matchAll(/\bambito\s*=(?!=)\s*([^\n]+)/g)].map((m) => (m[1] as string).trim())
    expect(atribuicoes).toEqual(["self.registration.scope"])
    expect(sw).toMatch(/const ambito = self\.registration\.scope\n/)
    // And it does not navigate existing windows to a different URL.
    expect(sw).not.toMatch(/\.navigate\(/)
  })

  it("a única coisa que lê de um aviso é o símbolo", () => {
    // Everything that follows `event.notification`, in full. The symbol is
    // chosen by the page and means nothing; a `data.url` or a `data.channel`
    // would be the notification telling the Service Worker what to do.
    const leituras = [...sw.matchAll(/event\.notification\b([^\n]*)/g)].map((m) => (m[1] as string).trim())
    expect(leituras).toEqual([".close()", ".data && event.notification.data.id"])
    // No other path to the same object: no other name, no destructuring.
    expect([...sw.matchAll(/\bnotification\b(?!click)/g)]).toHaveLength(3)
    expect([...sw.matchAll(/\.data\b/g)]).toHaveLength(2)
    expect(sw).not.toMatch(/\}\s*=\s*event\b/)
  })

  it("e não escreve URL nenhum: nem com esquema, nem sem ele, nem caminho à mão", () => {
    expect(sw).not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i)
    expect(sw).not.toMatch(/["'`]\/{1,2}[a-z0-9_]/i)
  })

  it("ouve três acontecimentos, e são estes", () => {
    const ouvidos = [...sw.matchAll(/addEventListener\(\s*["']([a-z]+)["']/g)].map((m) => m[1])
    expect(ouvidos.sort()).toEqual(["activate", "install", "notificationclick"])
    // And there are no listeners through the other side (`self.onmessage = ...`).
    expect(sw).not.toMatch(/\bon[a-z]+\s*=/)
  })

  it("a mensagem do toque é a que a página espera", () => {
    const daPagina = /NOTICE_CLICK_MESSAGE = "([^"]+)"/.exec(ler("packages/ui/src/lib/notifications.ts"))?.[1]
    expect(daPagina).toBe("enclave.notice-click")
    expect(sw).toContain(`type: "${daPagina}"`)
  })

  it("regista-se só em produção, com o âmbito da aplicação, e uma vez", () => {
    const registos = [...arranque.matchAll(/serviceWorker\s*\.register\(([^)]*)\)/g)].map((m) => m[1] as string)
    expect(registos).toHaveLength(1)
    expect(registos[0]).toContain("${import.meta.env.BASE_URL}sw.js")
    expect(registos[0]).toContain("scope: import.meta.env.BASE_URL")
    expect(arranque).toMatch(/if \(import\.meta\.env\.PROD && "serviceWorker" in navigator\) \{\s*navigator\.serviceWorker\s*\.register/)
    // No one else registers anything: not the bridge, not the package shared
    // with the desktop app.
    expect(ler("apps/web/src/bridge.ts")).not.toMatch(/serviceWorker/)
    expect(ler("packages/ui/src/lib/notifications.ts")).not.toMatch(/\.register\(/)
  })

  it("e o aviso de versão nova continua a ir à rede, sem cópia pelo meio", () => {
    const vigia = ler("apps/web/src/version-watch.ts")
    expect(vigia).toContain('fetch(import.meta.env.BASE_URL, { cache: "no-store" })')
    expect(vigia).not.toMatch(/serviceWorker|caches/)
    expect(arranque).toContain("watchForNewVersion(")
  })
})

describe("o Caddyfile", () => {
  const app = /handle \/app\/\* \{([\s\S]*?)\n\t\}/.exec(caddy)?.[1] ?? ""

  it("só os assets com hash se guardam; o resto de /app/ revalida sempre", () => {
    // The `sw.js` and manifest live outside `/app/assets/`, with a fixed name: an
    // `immutable` cache tag that caught them would trap the Service Worker forever.
    expect(app).toMatch(/@hashed path \/app\/assets\/\*\n\t\theader @hashed Cache-Control "public, max-age=31536000, immutable"/)
    expect(app).toMatch(/@entry not path \/app\/assets\/\*\n\t\theader @entry Cache-Control "no-cache"/)
    expect([...app.matchAll(/immutable/g)]).toHaveLength(1)
  })

  it("o sw.js é servido com a política mais apertada que há", () => {
    expect(app).toMatch(/@sw path \/app\/sw\.js\n\t\theader @sw Content-Security-Policy "default-src 'none'"/)
  })

  it("e o manifesto com o tipo certo", () => {
    expect(app).toMatch(/@manifesto path \/app\/manifest\.webmanifest\n\t\theader @manifesto Content-Type "application\/manifest\+json"/)
  })
})
