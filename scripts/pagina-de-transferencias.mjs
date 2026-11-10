/**
 * The downloads page, in both languages.
 *
 * Since 3 November 2026 the site is in English first: English lives at
 * `/transferencias/` and Portuguese at `/pt/transferencias/`, like the other
 * pages (see `docs/planos/site-ingles-relatorio.md`). The English path keeps
 * the Portuguese name because it's the one from before: the installed app
 * fetches `versao.json` and `actualizacao-windows.json` from that folder, and
 * there are shared links to it.
 *
 * Separate from `publicar-instaladores.mjs` so you can test it without installers,
 * without a key and without a VPS: this only writes text. Publishing is done
 * by that script, which reads the files and writes both pages.
 *
 * On the VPS disk both live in the same installer folder:
 * `index.html` (English) and `pt/index.html` (Portuguese). Caddy serves the
 * Portuguese one at `/pt/transferencias/` (see `infra/Caddyfile`).
 */

/** The public paths of both versions. */
export const CAMINHOS = { en: "/transferencias/", pt: "/pt/transferencias/" }

/** Where each version is written, inside the installer folder. */
export const FICHEIROS = { en: "index.html", pt: "pt/index.html" }

export function tamanhoHumano(bytes) {
  const mb = bytes / 1024 / 1024
  return `${mb.toFixed(0)} MB`
}

/**
 * The phrases in each language. The English one is a translation of the Portuguese:
 * the same facts, phrase by phrase. Internal links stay in the page language;
 * files and the app are the same for both.
 */
const TEXTOS = {
  en: {
    lang: "en",
    locale: ["en_GB", "pt_PT"],
    rotuloLinguas: "Language",
    titulo: "Orwell · Download",
    descricao: "Download Orwell for macOS or Windows, and check each file with its SHA-256 checksum.",
    inicio: "/",
    entrar: "Sign in",
    apoiar: "Support us",
    selo: "Version",
    h1: "Download Orwell",
    lead: `The desktop app does everything the browser version does, and two more things. It tells you about
          new messages when the window is closed. And it keeps your keys outside the page that shows the
          conversations.`,
    instalar: { macOS: "Download for macOS", Windows: "Download for Windows" },
    movel: {
      sistema: "Android and iOS",
      meta: `In the phone browser, added to the Home screen. There is no app in the
            stores.`,
      passos: "See the steps",
    },
    browser: {
      sistema: "Browser",
      meta: "nothing to install",
      abrir: "Open in the browser",
      nota: "There is no file to check. The app comes from this same server, with its certificate.",
    },
    aviso: {
      titulo: "Your system will not trust these files, and that is normal",
      paragrafos: [
        `These files <strong>are not signed with a commercial certificate</strong>. That signature means
              paying two companies every year to distribute our own code.`,
        `<strong>On macOS:</strong> the system refuses to open the app the first time. Go to System Settings,
              Privacy &amp; Security, and choose to open it anyway.`,
        `<strong>On Windows:</strong> a blue SmartScreen screen appears. Choose "More info" and then
              "Run anyway".`,
      ],
    },
    confirmar: {
      titulo: "Check that the file really came from here",
      texto: `Because we do not have that signature, we publish the <span class="mono">SHA-256</span> checksum
          of each file, calculated when we publish it. The checksum that your computer calculates must be the
          same as the one under the download button, character by character. If it is not, do not install.`,
      passos: [
        ["macOS and Linux", "In the terminal, in the folder where the file is:", "shasum -a 256 FILE-NAME"],
        ["Windows", "In PowerShell:", "Get-FileHash FILE-NAME -Algorithm SHA256"],
      ],
      depois: [
        "Then",
        `Compare it with the checksum under the download button. If they are the same, install. If they are different,
            delete the file and write to us.`,
      ],
    },
    versao: (curta, nome) => `Orwell ${curta} "${nome}"`,
    rodape: [
      ["/", "Home"],
      [CAMINHOS.en, "Download"],
      ["/privacy.html", "Privacy"],
      ["/terms.html", "Terms"],
      ["/ambassadors.html", "Ambassadors"],
    ],
    apoiar: "Support",
    codigoFonte: "Source code",
    terceiros: "Third-party notices",
    nota: `This page runs a single script, from this origin, to put the file for your system first. It sets no
        cookies and asked nothing of any server but this one. Made in Portugal.`,
  },
  pt: {
    lang: "pt-PT",
    locale: ["pt_PT", "en_GB"],
    rotuloLinguas: "Língua",
    titulo: "Orwell · Descarregar",
    descricao: "Descarrega o Orwell para macOS ou Windows, e confirma cada ficheiro com a sua soma SHA-256.",
    inicio: "/pt/",
    entrar: "Entrar",
    apoiar: "Apoia-nos",
    selo: "Versão",
    h1: "Descarregar o Orwell",
    lead: `A aplicação para computador faz tudo o que a versão do browser faz, e mais duas coisas. Avisa-te de
          mensagens novas com a janela fechada. E guarda as tuas chaves fora da página que mostra as conversas.`,
    instalar: { macOS: "Descarregar para macOS", Windows: "Descarregar para Windows" },
    movel: {
      sistema: "Android e iOS",
      meta: `Pelo browser do telemóvel, posta no ecrã principal. Não há aplicação nas
            lojas.`,
      passos: "Ver os passos",
    },
    browser: {
      sistema: "Browser",
      meta: "sem instalares nada",
      abrir: "Abrir no browser",
      nota: "Não há ficheiro para confirmar. A aplicação vem deste mesmo servidor, com o certificado dele.",
    },
    aviso: {
      titulo: "O teu sistema vai desconfiar, e isso é normal",
      paragrafos: [
        `Estes ficheiros <strong>não têm assinatura com certificado comercial</strong>. Essa assinatura obriga
              a pagar todos os anos a duas empresas para distribuirmos o nosso próprio código.`,
        `<strong>No macOS:</strong> o sistema recusa a primeira abertura. Vai a Definições do Sistema,
              Privacidade e Segurança, e escolhe abrir mesmo assim.`,
        `<strong>No Windows:</strong> aparece um ecrã azul do SmartScreen. Escolhe "Mais informações" e depois
              "Executar mesmo assim".`,
      ],
    },
    confirmar: {
      titulo: "Confirma que o ficheiro veio mesmo daqui",
      texto: `Como não temos a assinatura, publicamos a soma <span class="mono">SHA-256</span> de cada ficheiro,
          calculada quando o publicamos. A soma que o teu computador calcular tem de ser igual à que está por baixo do
          botão, carácter a carácter. Se as somas não forem iguais, não instales.`,
      passos: [
        ["macOS e Linux", "No terminal, na pasta onde o ficheiro está:", "shasum -a 256 NOME-DO-FICHEIRO"],
        ["Windows", "No PowerShell:", "Get-FileHash NOME-DO-FICHEIRO -Algorithm SHA256"],
      ],
      depois: [
        "E depois",
        `Compara com a soma que está por baixo do botão. Se forem iguais, instala. Se forem diferentes, apaga o ficheiro e
            escreve-nos.`,
      ],
    },
    versao: (curta, nome) => `Orwell ${curta} "${nome}"`,
    rodape: [
      ["/pt/", "Início"],
      [CAMINHOS.pt, "Descarregar"],
      ["/pt/privacidade.html", "Privacidade"],
      ["/pt/termos.html", "Termos"],
      ["/pt/embaixadores.html", "Embaixadores"],
    ],
    apoiar: "Apoiar",
    codigoFonte: "Código-fonte",
    terceiros: "Avisos de terceiros",
    nota: `Esta página corre um só guião, desta origem, para pôr primeiro o ficheiro do teu sistema. Não põe
        cookies e não pediu nada a servidor nenhum além deste. Feita em Portugal.`,
  },
}

/** The "EN · PT" selector, same as the other pages: the page language gets
 *  `aria-current`, the other gets its `lang`. Footer only, like all pages
 *  since 3 November 2026 (owner request). */
function selector(lingua, rotulo) {
  const en =
    lingua === "en"
      ? `<a href="${CAMINHOS.en}" hreflang="en" aria-current="page">EN</a>`
      : `<a href="${CAMINHOS.en}" hreflang="en" lang="en">EN</a>`
  const pt =
    lingua === "pt"
      ? `<a href="${CAMINHOS.pt}" hreflang="pt" aria-current="page">PT</a>`
      : `<a href="${CAMINHOS.pt}" hreflang="pt" lang="pt">PT</a>`
  return `<nav class="linguas" aria-label="${rotulo}">
        ${en}
        <span aria-hidden="true">·</span>
        ${pt}
      </nav>`
}

/**
 * The whole page, in one language.
 *
 * In the "02 Editorial" direction of the front page since 3 November 2026
 * (owner request: the downloads page had a different style from the rest of
 * the site). Same header, same typeface, thin lines and nothing in cards: the
 * `<body class="editorial">` triggers the rules in `src/estilo.css`.
 *
 * @param {"en" | "pt"} lingua
 * @param {{
 *   versao: string,
 *   versaoCurta: string,
 *   nomeDaVersao: string,
 *   folha: string,
 *   guiao: string,
 *   simbolos: string,
 *   ficheiros: { nome: string, sistema: string, bytes: number, soma: string }[],
 * }} dados
 */
export function paginaDeTransferencias(lingua, { versao, versaoCurta, nomeDaVersao, folha, guiao, simbolos, ficheiros }) {
  const t = TEXTOS[lingua]
  if (!t) throw new Error(`Língua desconhecida: ${lingua}`)
  if (!guiao) throw new Error("Falta o guião do site (o `sistema-*.js` de apps/site/dist/assets).")

  /*
    One button per installer, and below it the version, size, filename and
    checksum (owner request on 3 November 2026).
    
    The button is a wide line, with the OS and the arrow, like the questions on
    the front page: large, and no box. The text says the OS ("Download for Windows"),
    like the hero. The `instalador-<sistema>` class is what the stylesheet uses
    to put first the one for the visitor's OS (`:root[data-sistema]`, written by
    `src/sistema.ts`). Without the script it stays in the order of `ficheiros`.
    */
  const linhas = ficheiros
    .map((f) => {
      const rotulo = t.instalar[f.sistema]
      if (!rotulo) throw new Error(`Sistema sem botão: ${f.sistema}`)
      return `          <li class="instalador instalador-${f.sistema.toLowerCase()}">
            <a class="botao botao-forte botao-instalador" href="${CAMINHOS.en}${f.nome}">${rotulo} <span aria-hidden="true">→</span></a>
            <p class="instalador-meta">${t.selo} ${versao} · ${tamanhoHumano(f.bytes)} · <span class="mono">${f.nome}</span></p>
            <code class="descarga-soma">
              <span class="descarga-rotulo">SHA-256</span>${f.soma}</code>
          </li>`
    })
    .join("\n")

  /*
    Two file-less paths: mobile and browser. Android and iOS labeled as they are,
    the browser app on the home screen, no store. The steps are on the entry page,
    in the drawer `#telemovel`, which opens when the link arrives there (`src/gaveta.ts`).
    */
  const caminhos = `        <ul class="caminhos">
          <li>
            <h3>${t.movel.sistema}</h3>
            <p>${t.movel.meta}</p>
            <p class="caminho-ligacao"><a href="${t.inicio}#telemovel">${t.movel.passos} <span aria-hidden="true">→</span></a></p>
          </li>
          <li>
            <h3>${t.browser.sistema} <span class="caminho-meta">${t.browser.meta}</span></h3>
            <p>${t.browser.nota}</p>
            <p class="caminho-ligacao"><a href="/app/">${t.browser.abrir} <span aria-hidden="true">→</span></a></p>
          </li>
        </ul>`

  /* The steps of the sum, in lines without numbers: the system on the left,
     the command on the right. */
  const passos = t.confirmar.passos
    .map(
      ([titulo, texto, comando]) => `          <li>
            <h3>${titulo}</h3>
            <div>
              <p>${texto}</p>
              <code class="descarga-soma">${comando}</code>
            </div>
          </li>`,
    )
    .join("\n")

  const rodape = t.rodape.map(([href, nome]) => `        <a href="${href}">${nome}</a>`).join("\n")

  return `<!doctype html>
<html lang="${t.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    />
    <title>${t.titulo}</title>
    <meta name="description" content="${t.descricao}" />
    <link rel="icon" href="/marca.04656517.svg" type="image/svg+xml" />
    <link rel="canonical" href="https://orwell.pt${CAMINHOS[lingua]}" />
    <link rel="alternate" hreflang="en" href="https://orwell.pt${CAMINHOS.en}" />
    <link rel="alternate" hreflang="pt" href="https://orwell.pt${CAMINHOS.pt}" />
    <link rel="alternate" hreflang="x-default" href="https://orwell.pt${CAMINHOS.en}" />
    <meta property="og:locale" content="${t.locale[0]}" />
    <meta property="og:locale:alternate" content="${t.locale[1]}" />
    <link rel="stylesheet" href="/assets/${folha}" />
    <script type="module" src="/assets/${guiao}"></script>
  </head>
  <body class="editorial">
    <!-- Escrito por scripts/pagina-de-transferencias.mjs. Editar lá, não aqui. -->
    <svg class="desenhos" aria-hidden="true">
      <defs>
        ${simbolos}
      </defs>
    </svg>

    <!-- O MESMO topo das outras páginas: a marca, o "Apoia-nos" e o "Entrar". -->
    <header class="topo">
      <a class="marca" href="${t.inicio}">
        <svg class="marca-desenho" aria-hidden="true"><use href="#i-marca" /></svg>
        <span>Orwell</span>
      </a>
      <a class="topo-apoio" href="https://ko-fi.com/orwell_eu" target="_blank" rel="noopener noreferrer">${t.apoiar}</a>
      <a class="topo-entrar" href="/app/">${t.entrar}</a>
    </header>

    <main>
      <section class="cabeca">
        <p class="etiqueta">${t.selo} ${versao}</p>
        <h1>${t.h1}</h1>
        <p class="cabeca-lead">
          ${t.lead}
        </p>
      </section>

      <section class="seccao transferir">
        <ul class="instaladores">
${linhas}
        </ul>

${caminhos}

        <div class="aviso">
          <h2>${t.aviso.titulo}</h2>
${t.aviso.paragrafos.map((p) => `          <p>\n            ${p}\n          </p>`).join("\n")}
        </div>
      </section>

      <section class="seccao confirmar">
        <h2>${t.confirmar.titulo}</h2>
        <p class="seccao-texto">
          ${t.confirmar.texto}
        </p>
        <ul class="confirmar-passos">
${passos}
          <li>
            <h3>${t.confirmar.depois[0]}</h3>
            <div>
              <p>${t.confirmar.depois[1]}</p>
            </div>
          </li>
        </ul>
      </section>
    </main>

    <footer class="rodape">
      <!-- O MESMO rodapé das outras páginas, na língua desta. -->
      <div class="rodape-marca">
        <svg class="marca-desenho" aria-hidden="true"><use href="#i-marca" /></svg>
        <span>${t.versao(versaoCurta, nomeDaVersao)}</span>
      </div>
      <nav class="rodape-links">
${rodape}
        <a href="https://ko-fi.com/orwell_eu" target="_blank" rel="noopener noreferrer">${t.apoiar}</a>
        <a href="mailto:orwell.eu@proton.me">orwell.eu@proton.me</a>
      </nav>
      ${selector(lingua, t.rotuloLinguas)}
      <p class="rodape-nota">
        ${t.nota}
      </p>
      <p class="rodape-nota"><a href="https://github.com/magnuslab-sudo/orwell" target="_blank" rel="noopener noreferrer">${t.codigoFonte}</a></p>
      <p class="rodape-nota"><a href="/terceiros.txt">${t.terceiros}</a></p>
    </footer>
  </body>
</html>
`
}
