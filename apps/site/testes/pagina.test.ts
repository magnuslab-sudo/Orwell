import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { abrirGaveta, idDoFragmento } from "../src/gaveta.js"
import { reconhecerSistema } from "../src/sistema.js"
import { desenharTributo, desenharTributoEmLinha, FRASE_DO_VAZIO, lerNomes } from "../src/tributo.js"

/**
 * The site's promises, verified.
 *
 * The footer says the page has no JavaScript, sets no cookies and made no
 * server requests. All three are verifiable, and a verifiable promise that
 * nobody verifies lasts until the day someone adds a font "just this once".
 *
 * The guarantees apply to ALL pages, not just the entry point: the footer
 * is the same everywhere, and a promise that is only true on the first page
 * is a false promise on the others. That is why the file scans the folder:
 * whoever adds a page gets it verified without having to remember to do so.
 *
 * Since November 3, 2026 the site is English first (at the root) and Portuguese
 * under `pt/`. Text checks run in both languages, each with its own phrases
 * (`VERSOES`, below). What belongs only to languages (`hreflang`, selector,
 * redirects, untranslated text) lives in `linguas.test.ts`.
 *
 * Weight is measured elsewhere (`scripts/medir-homepage.mjs`), because it
 * requires a build and a unit test does not build anything. Here we verify
 * what exists in the source file.
 */
const pasta = fileURLToPath(new URL("..", import.meta.url))
const raizDoRepositorio = fileURLToPath(new URL("../../../", import.meta.url))
const htmlDe = (dir: string): string[] =>
  readdirSync(`${pasta}${dir}`)
    .filter((nome) => nome.endsWith(".html"))
    .map((nome) => `${dir}${nome}`)
const nomes = [...htmlDe(""), ...htmlDe("pt/")]
const paginas = nomes.map((nome) => [nome, readFileSync(`${pasta}${nome}`, "utf8")] as const)
const ler = (nome: string): string => paginas.find(([n]) => n === nome)?.[1] ?? ""
const configVite = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8")
const raiz = JSON.parse(readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8")) as {
  version: string
  nomeDaVersao: string
}

/**
 * The phrases that the tests pin down, in both languages. The English version
 * is a translation of the Portuguese: the facts are the same, phrase by phrase.
 */
const VERSOES = [
  {
    lingua: "en",
    entrada: "index.html",
    embaixadores: "ambassadors.html",
    esquema: "privacy.webp",
    transferencias: "/transferencias/",
    semJavaScript: "This page runs no JavaScript at all",
    umGuiao: "This page runs a single script, from this origin",
    hierarquia: { tem: [/\bchannels\b/i, /\bcategories\b/i, /\brooms\b/i], naoTem: /\bservers\b/i },
    alternativa: "A European alternative to Discord and social media",
    beneficio: "Everything is\n            end-to-end encrypted",
    perguntaTecnica: "Want to know how?",
    gavetaMovel: "Use it on your phone, no app store",
    cifra: [
      "Whoever leaves can no longer read what comes next.",
      "Whoever joins cannot read the messages from before they joined.",
      "They get the channel's board, posts, rooms and roles.",
    ],
    abrir: "Open in the browser",
    windows: "Download for Windows",
    macos: "Download for macOS",
    movel: {
      chrome: "in Chrome",
      safari: "in Safari",
      rotulos: [/"Add to Home screen"/i, 2],
      limites: [
        "No notifications while the app is closed.",
        "You add your phone to your computer account from the computer.",
        '"Add device"',
        '"Yes, pair this device"',
        "six words",
        "does not have the account key",
        "breaks the channel encryption",
        ".enclave",
        "iOS 15.4",
        "Lockdown Mode",
      ],
      promessas: /coming soon|soon|on the way|offline|without a connection/i,
    },
    emb: {
      etiqueta: "Ambassadors",
      titulo: "Bring your community.",
      origens: ["Discord", "TeamSpeak", "Root", "your own server", "another app"],
      recebe: [
        "What the community gets",
        "Direct contact with the people who make Orwell",
        "A channel of your own",
        "tribute section",
        "ambassador badge",
        "What we ask",
        "for one month",
        "without a filter",
      ],
      candidatar: "Apply with my community",
      como: 'go to the Orwell channel and write "I want to be an ambassador"',
      responde: "We answer there.",
      versao: "Orwell is at version %VERSAO%. There are still things to do",
    },
  },
  {
    lingua: "pt",
    entrada: "pt/index.html",
    embaixadores: "pt/embaixadores.html",
    esquema: "privacidade.webp",
    transferencias: "/pt/transferencias/",
    semJavaScript: "Esta página não corre JavaScript nenhum",
    umGuiao: "Esta página corre um só guião, desta origem",
    hierarquia: { tem: [/\bcanais\b/i, /\bcategorias\b/i, /\bsalas\b/i], naoTem: /\bservidores\b/i },
    alternativa: "Alternativa europeia ao Discord e redes sociais",
    beneficio: "Tudo vai\n            cifrado de ponta a ponta",
    perguntaTecnica: "Queres saber como?",
    gavetaMovel: "Usar no telemóvel, sem loja de apps",
    cifra: [
      "Quem sai deixa de ler o que vier a seguir.",
      // October 21, 2026: the old phrase ("Whoever enters does not disenchant what
      // was already said") now states only the true part.
      "Quem entra não lê as mensagens de antes de entrar.",
      "Recebe o mural, as publicações, as salas e os cargos do canal.",
    ],
    abrir: "Abrir no browser",
    windows: "Descarregar para Windows",
    macos: "Descarregar para macOS",
    movel: {
      chrome: "no Chrome",
      safari: "no Safari",
      rotulos: [/"Adicionar ao ecrã principal"/, 2],
      limites: [
        "Sem notificações com a aplicação fechada.",
        "A conta do computador junta-se ao telemóvel a partir do computador.",
        '"Acrescentar aparelho"',
        // November 3, 2026: the app label (`outroAparelhoSim` in
        // `packages/ui/src/linguas/pt.ts`). It used to say "Add this device to
        // an account", which the app no longer shows.
        '"Sim, emparelhar este aparelho"',
        "seis palavras",
        "não tem a chave da conta",
        "parte a cifra dos canais",
        ".enclave",
        "iOS 15.4",
        "Modo de Segurança Extrema",
      ],
      promessas: /em breve|brevemente|está a chegar|para breve|\boffline\b|sem ligação/i,
    },
    emb: {
      etiqueta: "Embaixadores",
      titulo: "Traz a tua comunidade.",
      origens: ["Discord", "TeamSpeak", "Root", "servidor próprio", "noutra app"],
      recebe: [
        "O que a comunidade recebe",
        "Contacto directo com quem faz o Orwell",
        "Um canal próprio",
        "zona de tributo",
        "distintivo de embaixador",
        "O que pedimos",
        "durante um mês",
        "sem filtro",
      ],
      candidatar: "Candidatar a minha comunidade",
      como: 'entra no canal Orwell e escreve "quero ser embaixador"',
      responde: "Respondemos lá.",
      versao: "O Orwell está na versão %VERSAO%. Ainda há coisas por fazer",
    },
  },
] as const

const textoDe = (markup: string): string => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

describe("todas as páginas", () => {
  it("são oito, quatro em cada língua, e as de entrada estão entre elas", () => {
    // A page that disappears without anyone noticing would take with it all
    // the checks in this file, silently.
    expect([...nomes].sort()).toEqual(
      [
        "ambassadors.html",
        "index.html",
        "privacy.html",
        "terms.html",
        "pt/embaixadores.html",
        "pt/index.html",
        "pt/privacidade.html",
        "pt/termos.html",
      ].sort(),
    )
  })

  it.each(paginas)("%s não pede nada a terceiros", (_nome, pagina) => {
    /*
      A page that sells privacy and calls Google to fetch a font is
      contradicting itself before the first sentence.

      What matters is WHO decides to make the request. A `src` is the browser
      fetching by itself; an `href` on an `<a>` is a person choosing to follow a
      link, and a link was never a request. So the dividing line is the attribute,
      not the domain.

      `orwell.pt` is the site itself: it appears in the `canonical`, in the
      language `alternate` links and in share meta tags, which are not even
      fetched by visitors.
    */
    const buscados = [...pagina.matchAll(/\bsrc\s*=\s*"(https?:\/\/[^"]+)"/g)].map((m) => m[1] as string)
    const importados = [...pagina.matchAll(/<link\b[^>]*\bhref\s*=\s*"(https?:\/\/[^"]+)"/g)]
      .map((m) => m[1] as string)
      .filter((url) => !url.startsWith("https://orwell.pt/"))

    expect([...buscados, ...importados]).toEqual([])
  })

  const entradas = VERSOES.map((v) => v.entrada as string)
  const semGuiao = paginas.filter(([nome]) => !entradas.includes(nome))

  it.each(semGuiao)("%s não tem JavaScript nenhum, que é a política mais forte que se pode ter", (nome, pagina) => {
    // The footer says this in words, in the page's language.
    const versao = nome.startsWith("pt/") ? VERSOES[1] : VERSOES[0]
    expect(pagina).not.toMatch(/<script/i)
    expect(pagina).not.toMatch(/\son[a-z]+\s*=/i)
    expect(pagina).toContain(versao.semJavaScript)
  })

  it.each(VERSOES)("a de entrada ($lingua) tem um só guião, desta origem, e nada em linha", (versao) => {
    /*
      November 2, 2026: the owner asked for the main button to match the
      visitor's system (Windows, macOS, mobile). It is the only thing that needs
      JavaScript, and it enters with a minimum: one file from this origin
      (`src/sistema.ts`), no `<script>` with content, no `on…=`.
    */
    const html = ler(versao.entrada)
    const guioes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    expect(guioes.map((m) => m[0])).toEqual(['<script type="module" src="/src/sistema.ts"></script>'])
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
    expect(html).toContain(versao.umGuiao)
    expect(html).not.toContain(versao.semJavaScript)
  })

  it.each(paginas)("%s não tem estilo em linha, que a política também recusa", (_nome, pagina) => {
    // `style-src 'self'` blocks a `style="..."` as silently as it would block
    // an external stylesheet.
    expect(pagina).not.toMatch(/\sstyle\s*=\s*"/i)
  })

  it.each(paginas)("%s não tem formulários, que a política bloquearia", (_nome, pagina) => {
    /*
      `form-action 'none'` makes a `<form>` rejected by the browser at submit time,
      without a word to whoever clicked the button. Contact is by `mailto:`.
      Comments are removed before processing.
    */
    const markup = pagina.replace(/<!--[\s\S]*?-->/g, "")
    expect(markup).not.toMatch(/<form\b/i)
    expect(markup).not.toMatch(/<input\b/i)
    expect(markup).not.toMatch(/<textarea\b/i)
  })

  it.each(paginas)("%s fecha tudo por omissão na política de segurança", (_nome, pagina) => {
    const politica = pagina.match(/http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/)?.[1] ?? ""
    expect(politica).toContain("default-src 'none'")
    expect(politica).toContain("base-uri 'none'")
    expect(politica).toContain("form-action 'none'")
    expect(politica).not.toMatch(/https?:\/\//)
  })

  it.each(paginas)("%s só aponta para o GitHub no link do código-fonte", (_nome, pagina) => {
    // The repository went private on August 14, 2026. On November 9, 2026
    // Orwell switched to AGPL-3.0 and code is public: the footer links to the
    // repository (section 13), and it is the only place GitHub appears.
    const semCodigoFonte = pagina.replace(/<a href="https:\/\/github\.com\/magnuslab-sudo\/orwell" target="_blank" rel="noopener noreferrer">(Source code|Código-fonte)<\/a>/g, "")
    expect(semCodigoFonte).not.toMatch(/github\.com/i)
    expect(semCodigoFonte).not.toMatch(/\bno GitHub\b|\bon GitHub\b/i)
  })

  it.each(paginas)("%s não identifica quem a faz", (_nome, pagina) => {
    // Owner's decision, October 16, 2026: the site has no name, photo, email,
    // phone, IBAN or address of whoever makes Orwell. The only exception is the
    // data controller statement in the privacy policy (GDPR, article 13), by owner's
    // decision on November 4, 2026: the name, without tax ID or address. Outside
    // that statement, the name stays forbidden. The public repository address
    // (9/11/2026, owner's order) includes the GitHub account name, and is the
    // other exception.
    const semResponsavel = pagina
      .replace(/O responsável pelo tratamento dos teus dados é Duarte Bivar\.|The controller of your data is Duarte Bivar\./g, "")
      .replace(/href="https:\/\/github\.com\/magnuslab-sudo\/orwell"/g, "")
    for (const cadeia of [/duarte/i, /bivar/i, /magnuslab/i, /portalegre/i, /\+351/, /\bPT50\b/]) {
      expect(semResponsavel).not.toMatch(cadeia)
    }
  })

  it.each(paginas)("%s é construída pelo Vite", (nome, pagina) => {
    // A page that exists in the repository but is not in the `input` of
    // `vite.config.ts` does not go to `dist`: the link to it exists, and in
    // production it gives 404.
    expect(pagina.length).toBeGreaterThan(0)
    expect(configVite).toContain(`resolve(__dirname, "${nome}")`)
  })

  it.each(paginas)("%s traz a versão da raiz e não escrita à mão", (_nome, pagina) => {
    expect(pagina).toContain("%VERSAO%")
    expect(pagina).toContain("%NOME_DA_VERSAO%")
  })
})

describe("a versão", () => {
  it("vem da raiz", () => {
    expect(raiz.nomeDaVersao).toBeTruthy()
    expect(raiz.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it("e a raiz manda em todos os `package.json` do repositório", () => {
    /*
      The version number in `apps/client` is what goes into the installer name
      and the one at the root is what the homepage announces. Diverging means the
      page says one version and the downloaded file is another.
    */
    const pastas = [
      ...readdirSync(`${raizDoRepositorio}apps`).map((nome) => `apps/${nome}`),
      ...readdirSync(`${raizDoRepositorio}packages`).map((nome) => `packages/${nome}`),
    ]
    const versoes = pastas.map((pasta) => {
      const manifesto = JSON.parse(readFileSync(`${raizDoRepositorio}${pasta}/package.json`, "utf8")) as { version: string }
      return [pasta, manifesto.version] as const
    })
    expect(versoes.length).toBeGreaterThan(4)
    for (const [pasta, versao] of versoes) expect(`${pasta}@${versao}`).toBe(`${pasta}@${raiz.version}`)
  })
})

describe.each(VERSOES)("a homepage ($lingua)", (versao) => {
  const html = ler(versao.entrada)

  it('acaba no "Apoiar", sem os quatro pontos e sem a frase de fecho', () => {
    // Owner's request on November 3, 2026: the last section is support.
    const main = /<main[\s\S]*?<\/main>/.exec(html)?.[0] ?? ""
    const seccoes = [...main.matchAll(/<section\b[^>]*>/g)].map((m) => m[0])
    expect(seccoes.at(-1)).toContain('id="apoiar"')
    expect(html).not.toContain('<ol class="pontos">')
    expect(html).not.toContain('class="fecho"')
  })

  it("diz canal, categoria e sala, a hierarquia que a aplicação usa", () => {
    // The terminology is the same as in the app. A homepage that calls
    // "server" what the app calls a channel teaches the wrong word to whoever opens the app.
    for (const palavra of versao.hierarquia.tem) expect(html).toMatch(palavra)
    expect(html).not.toMatch(versao.hierarquia.naoTem)
  })

  it("abre com a alternativa europeia e não com criptografia", () => {
    /*
      Benefit on top, technology on the bottom. Owner's decision on August 14, 2026.
      We check the POSITION: MLS and ML-KEM stay on the page, they just cannot
      become the first thing someone reads again.
    */
    const alternativa = html.indexOf(versao.alternativa)
    const beneficio = html.indexOf(versao.beneficio)
    const tecnologia = html.indexOf("RFC 9420")

    expect(alternativa).toBeGreaterThan(-1)
    expect(beneficio).toBeGreaterThan(alternativa)
    expect(tecnologia).toBeGreaterThan(beneficio)
  })

  it("esconde a camada técnica atrás de uma pergunta, e sem JavaScript", () => {
    expect(html).toMatch(/<details\b/)
    expect(html).toContain(versao.perguntaTecnica)
  })

  /**
   * The site's two encryption promises, pinned to the letter, in both
   * languages.
   *
   * **The second sentence has an expiration date.** Multi-device with epoch
   * key sharing (`docs/PLANO_MULTIDISPOSITIVO.md`, §3) makes a new device open
   * exactly what it says nobody opens. **When that work lands, this test FAILS,
   * and it is meant to fail.** Update the site's phrase (in both languages) and
   * this test at the same time; do not delete the test.
   */
  it("as duas promessas de cifra estão lá, à letra", () => {
    const semQuebras = html.replace(/\s+/g, " ")
    for (const frase of versao.cifra) expect(semQuebras).toContain(frase)
    expect(semQuebras).not.toContain("desencanta")
  })

  it("compara com o Discord pelo nome, e sem lhe usar o logótipo", () => {
    expect(html).toContain("Orwell vs Discord")
    expect(html).not.toMatch(/discord[^"]*\.(svg|png|webp|jpg)/i)
  })

  it("as capturas têm texto alternativo e dimensões", () => {
    const imagens = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0])
    expect(imagens.length).toBeGreaterThan(0)
    for (const img of imagens) {
      expect(img).toMatch(/alt="[^"]+"/)
      expect(img).toMatch(/width="\d+"/)
      expect(img).toMatch(/height="\d+"/)
    }
  })

  // As of November 9, 2026, this section links to Ko-fi, not GoFundMe (owner decision).
  it("leva ao Ko-fi, com a primeira meta", () => {
    const apoio = /<section class="seccao seccao-apoio" id="apoiar">[\s\S]*?<\/section>/.exec(html)?.[0] ?? ""
    expect(apoio).toContain('href="https://ko-fi.com/orwell_eu"')
    expect(textoDe(apoio)).toMatch(versao.lingua === "en" ? /€2,200/ : /2 200 €/)
  })
})

/**
 * Mobile section: what it promises, pricing, in both languages.
 *
 * No app store. Users access it through the browser app pinned to the home
 * screen, and this section explains the steps and limitations before install.
 * Since November 3, 2026 it is a drawer, like the other two (owner request).
 */
describe.each(VERSOES)("a secção do telemóvel ($lingua)", (versao) => {
  const html = ler(versao.entrada)
  const seccao = /<details id="telemovel"[\s\S]*?<\/details>/.exec(html)?.[0] ?? ""
  // The comment explaining it comes right before and counts toward the dash rule.
  const comentario = /<!--(?:(?!-->)[\s\S])*?-->\s*<details id="telemovel"/.exec(html)?.[0] ?? ""
  const texto = textoDe(seccao)

  it("existe, e leva à aplicação", () => {
    expect(seccao).not.toBe("")
    expect(seccao).toMatch(/<a\b[^>]*href="\/app\/"/)
  })

  it("é uma gaveta como as outras duas, fechada, com o título novo", () => {
    expect(seccao).toMatch(new RegExp(`^<details id="telemovel" class="mais">\\s*<summary>${versao.gavetaMovel}</summary>\\s*<div class="mais-corpo">`))
    // Closed by default, in the same section as the other two, first.
    expect(seccao).not.toMatch(/^<details[^>]*\bopen\b/)
    const mais = /<section class="seccao seccao-mais">[\s\S]*?<\/section>/.exec(html)?.[0] ?? ""
    const gavetas = [...mais.matchAll(/<details\b[^>]*>\s*<summary>([^<]+)<\/summary>/g)].map((m) => m[1])
    expect(gavetas).toEqual([versao.gavetaMovel, expect.stringContaining("Orwell vs Discord"), versao.perguntaTecnica])
    expect(html).not.toContain('<section id="telemovel"')
  })

  it("tem os dois sistemas à vista, cada um com os seus passos", () => {
    expect(seccao.match(/<ol class="movel-passos">/g)).toHaveLength(2)
    expect(texto).toContain(versao.movel.chrome)
    expect(texto).toContain(versao.movel.safari)
    const [rotulo, vezes] = versao.movel.rotulos
    expect(texto.match(new RegExp(rotulo.source, "gi"))?.length).toBeGreaterThanOrEqual(vezes)
  })

  it("chega-se a ela pelo herói, e o link abre-a", () => {
    const heroi = /<section class="heroi">[\s\S]*?<\/section>/.exec(html)?.[0] ?? ""
    expect(heroi).toContain('href="#telemovel"')
    // The `id` is the drawer's, and there is only one.
    expect(html.replace(/<!--[\s\S]*?-->/g, "").match(/\bid="telemovel"/g)).toHaveLength(1)
    // Opening it calls `src/gaveta.ts`, which lives inside the only script.
    expect(readFileSync(fileURLToPath(new URL("../src/sistema.ts", import.meta.url)), "utf8")).toContain('import "./gaveta.js"')
  })

  it("não tem travessões, nem no texto nem no comentário que a explica", () => {
    expect(comentario).not.toBe("")
    expect(seccao).not.toMatch(/[—–]/)
    expect(comentario).not.toMatch(/[—–]/)
  })

  it("não aponta para loja nenhuma, nem lhes usa o nome como destino", () => {
    expect(html).not.toMatch(/apps\.apple\.com|itunes\.apple\.com|play\.google\.com|testflight\.apple\.com/i)
    expect(html).not.toMatch(/App\s*Store|Google\s*Play|Play\s*Store/)
    expect(html).not.toMatch(/<symbol id="i-(apple|android|google|chrome|safari)\b/i)
  })

  it("diz os limites antes de a pessoa instalar", () => {
    expect(seccao).toContain('class="aviso')
    for (const frase of versao.movel.limites) expect(texto).toContain(frase)
  })

  it("não promete o que não existe", () => {
    expect(texto).not.toMatch(versao.movel.promessas)
  })

  it("e a política de segurança ficou exactamente como estava", () => {
    /*
      Literally, not via directives. November 3, 2026: added
      `connect-src 'self'`, only for the meter in the "Support" section
      (`src/apoio.ts`, which requests `/_enclave/apoiar.json` from this origin).
      November 2, 2026: added `script-src 'self'`, only for `src/sistema.ts`.
      October 20, 2026: added `font-src 'self'`, for the midnight theme fonts.
      
      The `frame-ancestors 'none'` in this <meta> does not protect against
      framing: the browser ignores it inside a <meta>. Protection comes from the
      headers (`X-Frame-Options: DENY` and CSP with `frame-ancestors 'none'`)
      that the front nginx sets in infra/nginx-enclave.conf, verified in
      testes/cabecalhos.test.ts.
      */
    const politica = html.match(/http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/)?.[1] ?? ""
    expect(politica).toBe(
      "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    )
  })
})

/**
 * The main button for the visitor system. Owner request on November 2, 2026.
 */
describe("o botão principal", () => {
  const folha = readFileSync(fileURLToPath(new URL("../src/estilo.css", import.meta.url)), "utf8")

  it.each([
    ["Windows", { agente: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", plataforma: "Win32", toques: 0 }, "windows"],
    ["Mac", { agente: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", plataforma: "MacIntel", toques: 0 }, "macos"],
    ["iPhone", { agente: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", plataforma: "iPhone", toques: 5 }, "telemovel"],
    ["iPad em modo de secretária", { agente: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", plataforma: "MacIntel", toques: 5 }, "telemovel"],
    ["Android", { agente: "Mozilla/5.0 (Linux; Android 15; Pixel 7) Mobile", plataforma: "Linux armv8l", toques: 5 }, "telemovel"],
    ["Chrome com userAgentData", { agente: "", plataforma: "Windows", movel: false, toques: 0 }, "windows"],
    ["Linux", { agente: "Mozilla/5.0 (X11; Linux x86_64)", plataforma: "Linux x86_64", toques: 0 }, undefined],
  ] as const)("reconhece %s", (_caso, pistas, esperado) => {
    expect(reconhecerSistema(pistas)).toBe(esperado)
  })

  it.each(VERSOES)("sem o guião ($lingua), o principal é abrir no browser e os outros caminhos ficam por baixo", (versao) => {
    const html = ler(versao.entrada)
    for (const seccao of ["heroi"]) {
      const markup = new RegExp(`<section class="${seccao}">[\\s\\S]*?<\\/section>`).exec(html)?.[0] ?? ""
      expect(markup, seccao).toContain(`<a class="para-browser" href="/app/">${versao.abrir}`)
      // The downloads page in the same language (Portuguese since November 3, 2026,
      // at /pt/transferencias/).
      expect(markup, seccao).toContain(`<a class="para-windows" href="${versao.transferencias}">${versao.windows}`)
      expect(markup, seccao).toContain(`<a class="para-macos" href="${versao.transferencias}">${versao.macos}`)
      expect(markup, seccao).toContain(`<a class="outro-macos" href="${versao.transferencias}">`)
      expect(markup, seccao).toContain(`<a class="outro-windows" href="${versao.transferencias}">`)
    }
  })

  it("o que se esconde por omissão é só o que duplicava o principal", () => {
    expect(folha).toMatch(/\.para-windows,\s*\.para-macos,\s*\.outro-browser\s*\{\s*display: none;/)
  })

  it("na página de entrada só a faixa dos embaixadores e o medidor do apoio animam", () => {
    // November 3, 2026: the banner was the only thing animating. That same day we
    // added the meter fill for the "Support" section (owner request). This test
    // ensures nothing else starts animating without notice.
    const bloco = folha.slice(folha.indexOf("/* ----------------------------------------------------- página de entrada */"))
    const semMovimentoReduzido = bloco.slice(0, bloco.indexOf("@media (prefers-reduced-motion")).replace(/\/\*[\s\S]*?\*\//g, "")
    const regras = [...semMovimentoReduzido.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    const animadas = regras.filter(([, , corpo]) => /(?:^|[;{\s])(?:animation|transition)(?:-name|-duration)?\s*:/.test(corpo ?? "")).map(([, seletor]) => seletor?.trim())
    expect(animadas).toEqual([".faixa-pista", ".apoio-enchimento"])
    expect([...semMovimentoReduzido.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1])).toEqual(["faixa-andar"])
  })
})

/**
 * The drawer that the link points to opens (`src/gaveta.ts`, November 3,
 * 2026). No DOM traversal: a test `getElementById` is enough.
 */
describe("a gaveta do link", () => {
  const raizDeEnsaio = (elementos: Record<string, { tagName: string; open?: boolean }>) => ({
    getElementById: (id: string) => (elementos[id] ?? null) as unknown as HTMLElement | null,
  })

  it("lê o id do fragmento", () => {
    expect(idDoFragmento("#telemovel")).toBe("telemovel")
    expect(idDoFragmento("#vers%C3%A3o")).toBe("versão")
    expect(idDoFragmento("")).toBe("")
    expect(idDoFragmento("telemovel")).toBe("")
    expect(idDoFragmento("#%E0%A4%A")).toBe("")
  })

  it("abre a gaveta, e só se for uma gaveta", () => {
    const gaveta = { tagName: "DETAILS", open: false }
    const seccao = { tagName: "SECTION" }
    const raiz = raizDeEnsaio({ telemovel: gaveta, apoiar: seccao })
    expect(abrirGaveta("telemovel", raiz)).toBe(true)
    expect(gaveta.open).toBe(true)
    expect(abrirGaveta("apoiar", raiz)).toBe(false)
    expect(seccao).not.toHaveProperty("open")
    expect(abrirGaveta("nada", raiz)).toBe(false)
    expect(abrirGaveta("", raiz)).toBe(false)
  })
})

/**
 * The favicon: the name must change when the design changes.
 *
 * Chrome caches favicons in its own database, indexed by the icon URL, and
 * only revisits it after days. The fix is to include a content hash in the
 * name (`marca/gerar-marca.py`), which this test checks on all pages, in the
 * app and on the downloads page.
 */
describe("o favicon", () => {
  const referencias: (readonly [string, string])[] = [
    ...nomes.map((nome) => [`apps/site/${nome}`, "apps/site/public"] as const),
    ["apps/web/index.html", "apps/web/public"] as const,
    // The downloads page is generated by this script (since November 3, 2026;
    // before it lived inside `publicar-instaladores.mjs`).
    ["scripts/pagina-de-transferencias.mjs", "apps/site/public"] as const,
  ]

  it.each(referencias)("%s aponta para um ficheiro que existe, com a impressão no nome", (ficheiro, publico) => {
    const fonte = readFileSync(`${raizDoRepositorio}${ficheiro}`, "utf8")
    const href = /<link rel="icon" href="\.?\/([^"]+)"/.exec(fonte)?.[1]
    expect(href, `${ficheiro} não declara favicon nenhum`).toBeTruthy()

    const svg = readFileSync(`${raizDoRepositorio}${publico}/${href}`, "utf8")
    const impressao = createHash("sha256").update(svg, "utf8").digest("hex").slice(0, 8)
    expect(href, "o nome do favicon não traz a impressão do conteúdo").toBe(`marca.${impressao}.svg`)
  })

  it("é um só desenho, e não uma cópia por pasta que possa divergir", () => {
    const desenhos = ["apps/site/public", "apps/web/public"].map((publico) => {
      const svgs = readdirSync(`${raizDoRepositorio}${publico}`).filter((nome) => nome.startsWith("marca"))
      expect(svgs, `${publico} tem mais do que um favicon`).toHaveLength(1)
      return readFileSync(`${raizDoRepositorio}${publico}/${svgs[0]}`, "utf8")
    })
    expect(desenhos[0]).toBe(desenhos[1])
  })

  it("o desenho da marca é o mesmo em todas as páginas", () => {
    // `marca/gerar-marca.py` writes it; all eight copies must match.
    const marcas = paginas.map(([, pagina]) => /<symbol id="i-marca"[\s\S]*?<\/symbol>/.exec(pagina)?.[0] ?? "")
    expect(marcas[0]).not.toBe("")
    for (const marca of marcas) expect(marca).toBe(marcas[0])
  })
})

/**
 * We seek ambassadors: the section on the landing page, the dedicated page,
 * and the tribute zone, in both languages. Owner request on October 27, 2026.
 */
describe.each(VERSOES)("os embaixadores ($lingua)", (versao) => {
  const html = ler(versao.entrada)
  const embaixadores = ler(versao.embaixadores)
  const prefixo = versao.lingua === "pt" ? "/pt/" : "/"
  const seccao = /<section id="embaixadores"[\s\S]*?<\/section>/.exec(html)?.[0] ?? ""
  const comentario = /<!--(?:(?!-->)[\s\S])*?-->\s*<section id="embaixadores"/.exec(html)?.[0] ?? ""
  const texto = textoDe(seccao)
  const textoDaPagina = textoDe(embaixadores.replace(/<!--[\s\S]*?-->/g, ""))
  const nomeDaPagina = versao.embaixadores.replace(/^pt\//, "")

  it("a secção existe na página de entrada, num bloco próprio, com a âncora", () => {
    expect(seccao).not.toBe("")
    expect(texto).toContain(versao.emb.etiqueta)
    expect(texto).toContain(versao.emb.titulo)
    expect(html.indexOf('<section id="embaixadores"')).toBeGreaterThan(html.indexOf('<section class="heroi">'))
    expect(html.indexOf('<section id="embaixadores"')).toBeLessThan(html.indexOf('id="apoiar"'))
  })

  it("os nomes entram na página de entrada numa linha", () => {
    expect(seccao).toContain("%TRIBUTO_LINHA%")
  })

  it("diz de onde vem a comunidade, o que recebe e o que pedimos", () => {
    for (const origem of versao.emb.origens) expect(texto).toContain(origem)
    for (const frase of versao.emb.recebe) expect(texto).toContain(frase)
  })

  it("a candidatura faz-se na app, no canal Orwell, e não por email", () => {
    for (const [onde, markup, corrido] of [
      ["a secção", seccao, texto],
      ["a página", /<main>[\s\S]*?<\/main>/.exec(embaixadores)?.[0] ?? "", textoDaPagina],
    ] as const) {
      const botao = new RegExp(`<a\\b[^>]*href="([^"]+)"[^>]*>${versao.emb.candidatar}<\\/a>`).exec(markup)
      expect(botao?.[1], onde).toBe("/app/")
      expect(corrido, onde).toContain(versao.emb.como)
      expect(corrido, onde).toContain(versao.emb.responde)
      expect(markup, onde).not.toMatch(/mailto:|embaixadores@|ambassadors@/)
    }
  })

  it("diz a versão pelo marcador, e diz que ainda falta coisa", () => {
    for (const markup of [seccao, embaixadores]) expect(textoDe(markup)).toContain(versao.emb.versao)
  })

  it("a página própria tem a zona de tributo, escrita no build", () => {
    expect(embaixadores).toMatch(/<section id="tributo"[\s\S]*%TRIBUTO%[\s\S]*?<\/section>/)
    expect(seccao).toContain(`href="${prefixo}${nomeDaPagina}"`)
    expect(configVite).toContain("injectarTributo()")
  })

  it("não tem travessões, nem no texto nem nos comentários", () => {
    expect(comentario).not.toBe("")
    for (const markup of [seccao, comentario, embaixadores]) expect(markup).not.toMatch(/[—–]/)
  })

  it("está no rodapé de todas as páginas da mesma língua", () => {
    for (const [nome, pagina] of paginas.filter(([n]) => n.startsWith("pt/") === (versao.lingua === "pt"))) {
      const rodape = /<nav class="rodape-links">[\s\S]*?<\/nav>/.exec(pagina)?.[0] ?? ""
      expect(rodape, nome).toContain(`href="${prefixo}${nomeDaPagina}"`)
    }
  })
})

/**
 * The ambassador banner in the stylesheet. Owner request on November 3, 2026:
 * names in a loop with highlights, respecting his rule for reduced motion:
 * the banner does NOT pause, it just moves slower.
 */
describe("a faixa dos embaixadores", () => {
  const folha = readFileSync(fileURLToPath(new URL("../src/estilo.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  const regra = (seletor: string, onde = folha): string =>
    new RegExp(`(?:^|\\})\\s*${seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(onde)?.[1] ?? ""
  const segundos = (corpo: string): number => Number(/(\d+(?:\.\d+)?)s\b/.exec(corpo)?.[1] ?? Number.NaN)
  const reduzido = folha.slice(folha.lastIndexOf("@media (prefers-reduced-motion: reduce)"))

  it("anda em loop, sem parar, metade da pista de cada vez", () => {
    expect(regra(".faixa-pista")).toMatch(/animation: faixa-andar \d+s linear infinite;/)
    expect(regra(".faixa-pista")).toContain("width: max-content;")
    expect(folha).toMatch(/@keyframes faixa-andar \{\s*to \{\s*transform: translateX\(-50%\);\s*\}\s*\}/)
  })

  it("com movimento reduzido NÃO pára: anda mais devagar", () => {
    const lento = regra(".faixa-pista", reduzido)
    expect(lento).toMatch(/animation-iteration-count: infinite !important;/)
    expect(segundos(lento)).toBeGreaterThan(segundos(regra(".faixa-pista")))
    // The general rule there sets everything to 0.01 ms; the banner must beat it.
    expect(lento).toMatch(/animation-duration: \d+s !important;/)
    expect(reduzido).not.toMatch(/\.faixa[\w-]*[^{]*\{[^}]*animation(?:-play-state)?: (?:none|paused)/)
  })

  it("pára com o rato por cima e com o foco", () => {
    expect(folha).toMatch(/\.faixa:hover \.faixa-pista,\s*\.faixa:focus-within \.faixa-pista \{\s*animation-play-state: paused;/)
    expect(regra(".faixa:focus-visible")).toContain("outline: 2px solid var(--acento);")
  })

  it("não faz a página rolar de lado", () => {
    expect(regra(".faixa")).toContain("overflow: hidden;")
  })
})

describe("o tributo", () => {
  const dados = JSON.parse(readFileSync(fileURLToPath(new URL("../src/embaixadores.json", import.meta.url)), "utf8"))

  it("a faixa da página de entrada, vazia, não diz nada, e escapa os nomes nas duas línguas", () => {
    expect(desenharTributoEmLinha({ nomes: [] })).toBe("")
    expect(desenharTributoEmLinha({ nomes: [] }, "en")).toBe("")
    const lista = "<li>Oficina &lt;b&gt;</li><li>Inês &amp; Rui</li>"
    expect(desenharTributoEmLinha({ nomes: ["Oficina <b>", "Inês & Rui"] })).toBe(
      '<div class="tributo-linha"><p class="tributo-frase" id="tributo-frase">Já testam connosco:</p>' +
        '<div class="faixa" tabindex="0" role="group" aria-labelledby="tributo-frase"><div class="faixa-pista">' +
        `<ul class="faixa-nomes">${lista}</ul><ul class="faixa-nomes" aria-hidden="true">${lista}</ul>` +
        "</div></div></div>",
    )
    expect(desenharTributoEmLinha({ nomes: ["Oficina <b>"] }, "en")).toContain(
      '<p class="tributo-frase" id="tributo-frase">Already testing with us:</p>',
    )
    // All names come from the owner, in his order, in both languages.
    for (const lingua of ["pt", "en"] as const) {
      expect(desenharTributoEmLinha(dados, lingua)).toContain("<li>Lucky 7</li>")
      expect(desenharTributoEmLinha(dados, lingua)).toContain("<li>YFF</li>")
    }
    expect(configVite).toContain('replaceAll("%TRIBUTO_LINHA%"')
  })

  it("o leitor de ecrã lê a lista uma vez: a cópia do loop leva aria-hidden", () => {
    const faixa = desenharTributoEmLinha(dados, "en")
    const listas = [...faixa.matchAll(/<ul class="faixa-nomes"([^>]*)>([\s\S]*?)<\/ul>/g)]
    expect(listas).toHaveLength(2)
    // The two copies are identical, name for name, and each has all 26.
    expect(listas[0]?.[2]).toBe(listas[1]?.[2])
    expect(listas[0]?.[2]?.match(/<li>/g)).toHaveLength(26)
    expect(listas[0]?.[1]).toBe("")
    expect(listas[1]?.[1]).toBe(' aria-hidden="true"')
    // A mix of names, without saying who is community and who is ambassador.
    expect(faixa).not.toMatch(/comunidade|community|embaixador|ambassador/i)
  })

  it("a língua da frase sai do `<html lang>` da página", () => {
    expect(configVite).toContain('/<html lang="en"/.test(html) ? "en" : "pt"')
  })

  it("o ficheiro de dados tem os nomes do dono, e vazio a zona diz que o lugar existe", () => {
    // Names come from the owner (list from November 2, 2026). None are made up.
    const nomes = lerNomes(dados)
    expect(nomes).toHaveLength(26)
    expect(nomes[0]).toBe("Lucky 7")
    expect(nomes).toContain("MaggiedoAço")
    expect(desenharTributo({ nomes: [] })).toBe(`<p class="tributo-vazio">${FRASE_DO_VAZIO}</p>`)
    expect(desenharTributo({ nomes: [] }, "en")).toBe('<p class="tributo-vazio">The first names go here.</p>')
    expect(FRASE_DO_VAZIO).toBe("Os primeiros nomes ficam aqui.")
  })

  it("com nomes, escreve-os como texto e nunca como markup, em qualquer língua", () => {
    const esperado =
      '<ul class="mural-nomes tributo"><li><strong>Oficina &lt;b&gt;</strong></li><li><strong>Inês &amp; Rui</strong></li></ul>'
    expect(desenharTributo({ nomes: ["Oficina <b>", "Inês & Rui"] })).toBe(esperado)
    expect(desenharTributo({ nomes: ["Oficina <b>", "Inês & Rui"] }, "en")).toBe(esperado)
  })

  it("um ficheiro mal escrito faz falhar o build, em vez de publicar a zona vazia", () => {
    expect(() => desenharTributo({})).toThrow(/nomes/)
    expect(() => desenharTributo({ nomes: [" "] })).toThrow(/nome 1/)
    expect(() => desenharTributo({ nomes: ["Oficina", 7] })).toThrow(/nome 2/)
  })
})
