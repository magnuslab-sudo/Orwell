/**
 * Live proof of the owner's requests from 27 October 2026 about the profile:
 * "Absent" in the card menu, "Channels I created", ids out of view and the
 * "Back" button in view on the person's page.
 *
 * jsdom doesn't apply stylesheets: it doesn't know if "Back" is a pill with
 * the word visible, if the copy button ends up on the name row, or if the
 * "Absent" dot is yellow. This mounts the components in headless Chromium with
 * the house stylesheets, on wide screen and mobile, measures and takes
 * screenshots to `scripts/.saida-perfil-estado-id/`.
 *
 * No server: components receive data through props and an empty bridge, like in
 * tests.
 *
 *   node scripts/medir-perfil-estado-id.mjs
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-perfil-estado-id")
const RAIZ = join(AQUI, "..")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

mkdirSync(SAIDA, { recursive: true })

const ENDERECO = "@garbicis-xapsensis-giprete-birmyris:exemplo.pt"

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { BridgeContext } from ${UI("App.js")}
import { ToastProvider } from ${UI("components/Toast.js")}
import { ConfirmarProvider } from ${UI("hooks/useConfirmar.js")}
import { CartaoDaConta } from ${UI("screens/profile/CartaoDaConta.js")}
import { ActivityMenu } from ${UI("screens/profile/ActivityMenu.js")}
import { PersonProfile } from ${UI("screens/profile/PersonProfile.js")}
import { ProfileScreen } from ${UI("screens/profile/ProfileScreen.js")}
import ${UI("styles.css")}

const vista = new URLSearchParams(location.search).get("vista")
const ponte = { social: {}, channels: {}, profile: {} }
const vazio = () => {}

function Pagina() {
  if (vista === "pessoa") {
    return (
      <PersonProfile
        address=${JSON.stringify(ENDERECO)}
        name="Ana"
        profile={{ displayName: "Ana", donations: [], bio: "faz fotografia", statusText: "por aí" }}
        posts={[]}
        messages={[]}
        me="@eu:exemplo.pt"
        directory={new Map()}
        nameFor={(quem) => quem}
        onMessage={vazio}
        onBack={vazio}
        aberta={null}
        onAbrirPublicacao={vazio}
        presenca="away"
      />
    )
  }
  if (vista === "perfil") {
    return (
      <ProfileScreen
        profile={{ displayName: "Duarte", donations: [] }}
        address=${JSON.stringify(ENDERECO)}
        posts={[]}
        messages={[]}
        directory={new Map()}
        nameFor={(quem) => quem}
        onCompose={vazio}
        onEdit={vazio}
        connection="online"
        connectionDetail={null}
        canaisFundados={[
          { canal: "!fotografia:exemplo.pt", nome: "Fotografia" },
          { canal: "!livros:exemplo.pt", nome: "Livros do Alentejo" },
        ]}
        onAbrirCanal={(canal) => { window.__aberto = canal }}
      />
    )
  }
  return (
    <aside className="sidebar open">
      <div className="sidebar-header">Comunidades</div>
      <div className="sidebar-body" />
      <CartaoDaConta
        profile={{ displayName: "Duarte", donations: [] }}
        address=${JSON.stringify(ENDERECO)}
        activity="ausente"
        onActivityMenu={vazio}
        onEditProfile={vazio}
        onSaveStatus={vazio}
      />
      <ActivityMenu activity="ausente" at={{ x: 16, y: 600 }} onChoose={vazio} onEditStatus={vazio} onClose={vazio} />
    </aside>
  )
}

createRoot(document.getElementById("raiz")).render(
  <BridgeContext.Provider value={ponte}>
    <ToastProvider>
      <ConfirmarProvider>
        {/* A grelha da concha, como no produto: carril, coluna e área principal. */}
        <div className="app">
          <div className="rail" />
          {vista === "cartao" ? <Pagina /> : <aside className="sidebar"><div className="sidebar-body" /></aside>}
          {vista === "cartao" ? <main className="main" /> : <Pagina />}
        </div>
      </ConfirmarProvider>
    </ToastProvider>
  </BridgeContext.Provider>,
)
`,
  "utf8",
)

await build({
  entryPoints: [ENTRADA],
  bundle: true,
  outfile: join(SAIDA, "pagina.js"),
  jsx: "automatic",
  loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts", ".json": "json", ".woff2": "file" },
  external: ["@sapphi-red/*"],
  format: "iife",
  logLevel: "error",
})

writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="pagina.css"><body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

const browser = await chromium.launch()
const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? ` — ${detalhe}` : ""}`)
}

for (const [largura, altura] of [
  [1280, 860],
  [390, 844],
]) {
  for (const vista of ["pessoa", "perfil", "cartao"]) {
    const ctx = await browser.newContext({ viewport: { width: largura, height: altura } })
    const page = await ctx.newPage()
    const erros = []
    page.on("pageerror", (e) => erros.push(String(e)))
    await page.goto(`file://${join(SAIDA, "index.html")}?vista=${vista}`)
    await page.waitForTimeout(400)
    const id = `${vista}-${largura}`
    await page.screenshot({ path: join(SAIDA, `${id}.png`) })

    const m = await page.evaluate((endereco) => {
      const caixa = (el) => (el ? el.getBoundingClientRect() : null)
      const voltar = document.querySelector(".pessoa-voltar")
      const nome = document.querySelector(".pessoa-nome-linha h1, .profile-name-row h2")
      const copiar = document.querySelector(".pessoa-nome-linha .copiar-id, .profile-name-row .copiar-id")
      const ausente = document.querySelector(".me-avatar > .dot")
      const opcaoAusente = [...document.querySelectorAll(".activity-option")].find((b) => b.textContent.includes("Ausente"))
      return {
        textoVisivel: document.body.innerText,
        /* Account region address is for screen readers and scripts (\`.me-address\`, hidden from
           view): it says what you SEE. */
        enderecoNoTexto: [...document.querySelectorAll("body *")].some(
          (el) =>
            el.childElementCount === 0 &&
            el.textContent.includes(endereco) &&
            el.getBoundingClientRect().width > 1 &&
            el.getBoundingClientRect().height > 1,
        ),
        scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        voltar: voltar ? { caixa: caixa(voltar), texto: voltar.innerText.trim(), aria: voltar.getAttribute("aria-label"), fundo: getComputedStyle(voltar).backgroundColor } : null,
        nome: caixa(nome),
        copiar: copiar ? { caixa: caixa(copiar), aria: copiar.getAttribute("aria-label") } : null,
        fundados: [...document.querySelectorAll(".profile-fundado")].map((b) => ({ texto: b.innerText.trim(), h: caixa(b).height })),
        pontoAusente: ausente ? { classe: ausente.className, cor: getComputedStyle(ausente).backgroundColor } : null,
        anel: document.querySelector(".me-avatar")?.dataset.anel ?? null,
        opcaoAusente: opcaoAusente ? getComputedStyle(opcaoAusente.querySelector(".dot")).backgroundColor : null,
      }
    }, ENDERECO)

    check(`${id}: sem erros na página`, erros.length === 0, erros.join(" | "))
    check(`${id}: sem rolar para o lado`, m.scroll <= 0, `${m.scroll}px`)
    check(`${id}: o id não se lê`, !m.enderecoNoTexto)
    if (vista === "pessoa") {
      check(`${id}: "Voltar" à vista, na pastilha`, m.voltar?.texto === "Voltar" && m.voltar.caixa.width > 60 && m.voltar.caixa.height >= 32, JSON.stringify({ t: m.voltar?.texto, w: m.voltar?.caixa.width, h: m.voltar?.caixa.height }))
      check(`${id}: o nome acessível continua "Voltar"`, m.voltar?.aria === "Voltar")
      check(`${id}: a pastilha tem fundo`, m.voltar?.fundo !== "rgba(0, 0, 0, 0)", m.voltar?.fundo)
    }
    if (vista === "pessoa" || vista === "perfil") {
      const mesmaLinha = m.copiar && m.nome && Math.abs((m.copiar.caixa.top + m.copiar.caixa.bottom) / 2 - (m.nome.top + m.nome.bottom) / 2) < 12
      check(`${id}: "Copiar id" na linha do nome`, Boolean(mesmaLinha), JSON.stringify({ copiar: m.copiar?.caixa.top, nome: m.nome?.top }))
      check(`${id}: o botão tem 24 px`, m.copiar?.caixa.width === 24 && m.copiar.caixa.height === 24, `${m.copiar?.caixa.width}×${m.copiar?.caixa.height}`)
    }
    if (vista === "perfil") {
      check(`${id}: "Canais que fundei" com os dois canais`, m.textoVisivel.includes("Canais que fundei") && m.fundados.length === 2, JSON.stringify(m.fundados))
      check(`${id}: linhas de 44 px para o dedo`, m.fundados.every((f) => f.h >= 44), JSON.stringify(m.fundados.map((f) => f.h)))
      await page.click(".profile-fundado >> nth=1")
      check(`${id}: o clique abre o canal`, (await page.evaluate(() => window.__aberto)) === "!livros:exemplo.pt")
    }
    if (vista === "cartao") {
      const amarelo = "rgb(245, 200, 76)"
      check(`${id}: o ponto de "Ausente" é amarelo`, m.pontoAusente?.cor === amarelo, JSON.stringify(m.pontoAusente))
      check(`${id}: o anel da cara é "ausente"`, m.anel === "ausente", String(m.anel))
      check(`${id}: "Ausente" no menu, com o ponto amarelo`, m.opcaoAusente === amarelo, String(m.opcaoAusente))
    }
    await ctx.close()
  }
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações passaram. Fotografias em ${SAIDA}`)
process.exit(falhas === 0 ? 0 : 1)
