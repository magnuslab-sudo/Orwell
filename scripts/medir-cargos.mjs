/**
 * The role editor, measured in a real layout engine, at 1280 and 390 px.
 *
 * Since 27 October 2026 the editor arranges a role like Discord (owner request:
 * "reorganize the menu, exactly like Discord"): closed, it shows the card list;
 * open a role, the list moves left (up on mobile) and the role opens in three
 * tabs, "Appearance", "Permissions" and "Members". This script replaces the
 * previous one, which measured the scrolling form.
 *
 * Why this exists instead of another test: these screen tests run in jsdom, and
 * **jsdom does not apply any stylesheets.** It says the tabs exist; it does not
 * know if the list and the role sit side by side, if each permission phrase
 * aligns with the name, or if at 390 px a tab falls off the edge.
 *
 * Mounts the real `RoleEditor`, with the real stylesheet, inside the property
 * panel template, with example roles and members and no server. Saves screenshots
 * to `scripts/.saida-cargos/`.
 *
 *   node scripts/medir-cargos.mjs
 *
 * What it does NOT prove: that toggling a switch or removing a member reaches
 * the core. That is network, and is measured in `scripts/verificar-papeis-do-membro.mjs`.
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-cargos")
const RAIZ = join(AQUI, "..")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

mkdirSync(SAIDA, { recursive: true })

/**
 * Four roles covering the three kinds and the empty one, plus the built-in role
 * the editor adds at the top.
 *
 * `Guardian` has `kick`, the only one encryption guarantees. `Archivist` has
 * `delete`, which is convention and has no undo anyway. `Host` has the mild ones.
 * `Guest` has none, which is a valid state.
 */
const CARGOS = [
  { role: "guarda", name: "Guarda", powers: ["expulsar", "convidar"], colour: "coral" },
  { role: "arquivista", name: "Arquivista", powers: ["eliminar", "renomear"], colour: "ambar" },
  { role: "anfitriao", name: "Anfitrião", powers: ["convidar", "mover", "fixar", "atender"], colour: "menta" },
  { role: "convidado", name: "Convidado", powers: [] },
]

const MEMBROS = [
  { address: "@ana:orwell.test", name: "Ana Marques", roles: ["guarda"] },
  { address: "@rui:orwell.test", name: "Rui", roles: ["guarda", "anfitriao"] },
  { address: "@eva:orwell.test", name: "Eva com um nome muito comprido de propósito", roles: [] },
]

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { RoleEditor } from ${UI("screens/chat/RoleEditor.js")}
import ${UI("styles.css")}

const p = new URLSearchParams(location.search)

function Demo() {
  return (
    <div className="app">
      <div className="modal-backdrop" style={{ position: "static" }}>
        <div className="sheet">
          <header className="sheet-header"><h2>Propriedades do canal</h2></header>
          <div className="sheet-body">
            <div className="sheet-grupo">
              <RoleEditor
                roles={${JSON.stringify(CARGOS)}}
                souFundador
                membros={${JSON.stringify(MEMBROS)}}
                onSetMemberRole={() => {}}
                onCreateRole={() => {}}
                onEditRole={() => {}}
                onDeleteRole={() => {}}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById("raiz")).render(<Demo />)
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

async function abrir(largura, altura) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(`file://${join(SAIDA, "index.html")}`)
  await page.waitForSelector(".role-card", { timeout: 10_000 })
  return { ctx, page, erros }
}

/** What overflows the sheet or the open role panel. */
const TRANSBORDA = `
  (() => {
    const folha = document.querySelector(".sheet").getBoundingClientRect()
    const painel = document.querySelector(".cargos-folha")?.getBoundingClientRect()
    const fora = []
    for (const el of document.querySelectorAll(".role-editor button, .role-editor input, .role-editor .role-card, .cargo-poder, .cargos-amostra-lista, .cargos-membro")) {
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      // Os itens da lista no telemóvel rolam de lado dentro dela: medem-se pela lista.
      if (el.closest(".cargos-lista")) continue
      const limite = painel && el.closest(".cargos-folha") ? painel : folha
      if (r.left < limite.left - 0.5 || r.right > limite.right + 0.5) fora.push((el.textContent || el.className).trim().slice(0, 30))
    }
    const lista = document.querySelector(".cargos-lista")?.getBoundingClientRect()
    if (lista && (lista.left < folha.left - 0.5 || lista.right > folha.right + 0.5)) fora.push("a lista dos cargos")
    return { fora, documento: document.documentElement.scrollWidth, janela: window.innerWidth }
  })()
`

for (const [largura, altura] of [
  [1280, 1000],
  [390, 844],
]) {
  const { ctx, page, erros } = await abrir(largura, altura)
  const em = `${largura}`

  // ------------------------------------------------ the closed list
  const fechada = await page.evaluate(() => {
    const numero = (v) => Math.round(parseFloat(v) * 10) / 10
    const cartoes = [...document.querySelectorAll(".role-card")]
    const nomes = cartoes.map((c) => c.querySelector(".role-name")?.textContent?.trim())
    const guarda = cartoes.find((c) => c.querySelector(".role-name")?.textContent === "Guarda")
    const linhaCifra = guarda?.querySelector(".role-line.role-sealed")
    const linhaLeve = guarda?.querySelector(".role-line:not(.role-sealed):not(.role-final)")
    const e = (no) => (no ? getComputedStyle(no) : null)
    return {
      nomes,
      tamanhoDoNome: numero(e(guarda?.querySelector(".role-name"))?.fontSize ?? "0"),
      tamanhoDaLinha: numero(e(linhaCifra)?.fontSize ?? "0"),
      cifra: { cor: e(linhaCifra)?.color, risca: numero(e(linhaCifra)?.borderLeftWidth ?? "0") },
      leve: { cor: e(linhaLeve)?.color, risca: numero(e(linhaLeve)?.borderLeftWidth ?? "0") },
      aviso: document.querySelector(".role-card .cargos-aviso")?.textContent ?? "",
      larguraDaFolha: Math.round(document.querySelector(".sheet").getBoundingClientRect().width),
    }
  })
  check(`${em} fechada: sem erros de página`, erros.length === 0, erros[0] ?? "")
  check(
    `${em} fechada: o administrador à cabeça, e os quatro cargos a seguir`,
    fechada.nomes.length === 5 && fechada.nomes[0] === "Administrador",
    fechada.nomes.join(", "),
  )
  check(
    `${em} fechada: o nome do cargo lê-se antes do que ele dá`,
    fechada.tamanhoDoNome >= fechada.tamanhoDaLinha + 2,
    `nome ${fechada.tamanhoDoNome}px, linha ${fechada.tamanhoDaLinha}px`,
  )
  check(
    `${em} fechada: o que a cifra garante não se lê igual ao que os clientes combinam`,
    fechada.cifra.risca >= 2 && (fechada.cifra.cor !== fechada.leve.cor || fechada.cifra.risca !== fechada.leve.risca),
    `cifra ${fechada.cifra.cor} / ${fechada.cifra.risca}px, leve ${fechada.leve.cor} / ${fechada.leve.risca}px`,
  )
  check(`${em} fechada: o fundador lê o aviso do administrador`, /Este cargo tem tudo/.test(fechada.aviso))
  const t0 = await page.evaluate(TRANSBORDA)
  check(`${em} fechada: nada sai da folha`, t0.fora.length === 0 && t0.documento <= t0.janela, t0.fora.join(", "))
  await page.locator(".sheet").screenshot({ path: join(SAIDA, `fechada-${em}.png`) })

  // ------------------------------------------------ the open role
  await page.getByTitle("Editar o cargo Guarda").click()
  await page.waitForSelector(".cargos-folha")
  await page.waitForTimeout(100)

  const aberto = await page.evaluate(() => {
    const caixa = (sel) => document.querySelector(sel)?.getBoundingClientRect()
    const folha = document.querySelector(".cargos-folha")
    const e = getComputedStyle(folha)
    return {
      larguraDaFolha: Math.round(caixa(".sheet").width),
      lista: caixa(".cargos-lista"),
      cargo: caixa(".cargos-folha"),
      raio: e.borderTopLeftRadius,
      fundo: e.backgroundColor,
      separadores: [...document.querySelectorAll(".cargos-separador")].map((s) => ({
        texto: s.textContent,
        escolhido: s.getAttribute("aria-selected"),
        risca: getComputedStyle(s).borderBottomColor,
        altura: Math.round(s.getBoundingClientRect().height),
        direita: Math.round(s.getBoundingClientRect().right),
      })),
    }
  })
  if (largura > 640) {
    check(
      `${em} aberto: a folha alarga para as duas colunas`,
      aberto.larguraDaFolha > fechada.larguraDaFolha + 200,
      `${fechada.larguraDaFolha}px fechada, ${aberto.larguraDaFolha}px aberta`,
    )
    check(
      `${em} aberto: a lista à esquerda, o cargo à direita`,
      aberto.lista.right <= aberto.cargo.left && Math.abs(aberto.lista.top - aberto.cargo.top) < 2,
      `lista até ${Math.round(aberto.lista.right)}, cargo desde ${Math.round(aberto.cargo.left)}`,
    )
  } else {
    check(
      `${em} aberto: a lista em cima, o cargo por baixo`,
      aberto.lista.bottom <= aberto.cargo.top,
      `lista até ${Math.round(aberto.lista.bottom)}, cargo desde ${Math.round(aberto.cargo.top)}`,
    )
  }
  check(`${em} aberto: o cargo é um painel com 14 px de canto`, aberto.raio === "14px", aberto.raio)
  check(`${em} aberto: e com tinta, não transparente`, aberto.fundo !== "rgba(0, 0, 0, 0)", aberto.fundo)
  const [aparencia, ...outros] = aberto.separadores
  check(
    `${em} aberto: três separadores, e a Aparência escolhida com a risca`,
    aberto.separadores.length === 3 && aparencia.escolhido === "true" && outros.every((s) => s.risca !== aparencia.risca),
    aberto.separadores.map((s) => `${s.texto}:${s.escolhido}`).join(" "),
  )
  check(
    `${em} aberto: cada separador tem um alvo de 24 px ou mais, dentro do cargo`,
    aberto.separadores.every((s) => s.altura >= 24 && s.direita <= aberto.cargo.right + 0.5),
    aberto.separadores.map((s) => `${s.altura}px até ${s.direita}`).join(", "),
  )

  // Appearance: the preview paints itself with the role color (coral, #ff9a76).
  const amostra = await page.evaluate(() => {
    const sub = document.querySelector(".cargos-amostra-lista .member-sub.member-role")
    const cabeca = document.querySelector(".cargos-amostra-lista .member-group-head")
    return { sub: sub && getComputedStyle(sub).color, cabeca: cabeca && getComputedStyle(cabeca).color, texto: sub?.textContent }
  })
  check(
    `${em} aparência: o nome pinta-se como na lista de membros`,
    amostra.sub === "rgb(255, 154, 118)" && amostra.cabeca === "rgb(255, 154, 118)" && amostra.texto === "Guarda",
    `sub-linha ${amostra.sub}, cabeçalho ${amostra.cabeca}`,
  )
  const t1 = await page.evaluate(TRANSBORDA)
  check(`${em} aparência: nada sai da folha nem do cargo`, t1.fora.length === 0 && t1.documento <= t1.janela, t1.fora.join(", "))
  await page.locator(".sheet").screenshot({ path: join(SAIDA, `aparencia-${em}.png`) })

  // Permissions.
  await page.getByRole("tab", { name: "Permissões" }).click()
  await page.waitForSelector(".cargo-poder")
  const permissoes = await page.evaluate(() => {
    const numero = (v) => Math.round(parseFloat(v) * 10) / 10
    const grupos = [...document.querySelectorAll(".cargos-grupo")].map((g) => ({
      titulo: g.querySelector("legend")?.textContent,
      moldura: numero(getComputedStyle(g).borderTopWidth),
      cor: getComputedStyle(g).borderTopColor,
    }))
    const linhas = [...document.querySelectorAll(".cargo-poder")].map((l) => {
      const rotulo = l.querySelector(".interruptor-rotulo").getBoundingClientRect()
      // Where the TEXT of the phrase starts: the box starts at the line edge, and the indent is the margin.
      const noDaFrase = l.querySelector(".cargo-poder-frase")
      const frase = { left: noDaFrase.getBoundingClientRect().left + parseFloat(getComputedStyle(noDaFrase).paddingLeft) }
      const alvo = l.querySelector(".interruptor").getBoundingClientRect()
      return {
        poder: l.getAttribute("data-poder"),
        risca: numero(getComputedStyle(l).borderLeftWidth),
        corDaRisca: getComputedStyle(l).borderLeftColor,
        desvio: Math.round(Math.abs(frase.left - rotulo.left)),
        alvo: Math.round(alvo.height),
      }
    })
    return { grupos, linhas }
  })
  check(
    `${em} permissões: a cifra à cabeça e os grupos do Discord`,
    permissoes.grupos.map((g) => g.titulo).join("|") === "Garantido|Gerir canal|Membros|Mensagens|Voz",
    permissoes.grupos.map((g) => g.titulo).join(", "),
  )
  check(
    `${em} permissões: só o grupo da cifra tem moldura`,
    permissoes.grupos[0].moldura >= 1 && permissoes.grupos.slice(1).every((g) => g.moldura === 0),
    permissoes.grupos.map((g) => `${g.titulo} ${g.moldura}px`).join(", "),
  )
  const eliminar = permissoes.linhas.find((l) => l.poder === "eliminar")
  const renomear = permissoes.linhas.find((l) => l.poder === "renomear")
  check(
    `${em} permissões: acabar com o canal tem a risca de aviso, mudar o nome não`,
    eliminar.risca >= 2 && eliminar.corDaRisca !== renomear.corDaRisca,
    `eliminar ${eliminar.risca}px ${eliminar.corDaRisca}, renomear ${renomear.corDaRisca}`,
  )
  check(
    `${em} permissões: a frase de cada responsabilidade alinha com o nome`,
    permissoes.linhas.length === 7 && permissoes.linhas.every((l) => l.desvio <= 2),
    permissoes.linhas.map((l) => `${l.poder} ${l.desvio}px`).join(", "),
  )
  check(
    `${em} permissões: cada interruptor tem um alvo de 24 px ou mais`,
    permissoes.linhas.every((l) => l.alvo >= 24),
    permissoes.linhas.map((l) => `${l.alvo}`).join(" "),
  )
  const t2 = await page.evaluate(TRANSBORDA)
  check(`${em} permissões: nada sai da folha nem do cargo`, t2.fora.length === 0 && t2.documento <= t2.janela, t2.fora.join(", "))
  await page.locator(".sheet").screenshot({ path: join(SAIDA, `permissoes-${em}.png`) })

  // Members, with the list of who can receive it open: the worst case.
  await page.getByRole("tab", { name: "Membros" }).click()
  await page.getByRole("button", { name: "Adicionar membros" }).click()
  const membros = await page.evaluate(() => ({
    linhas: [...document.querySelectorAll(".cargos-membro")].map((l) => ({
      nome: l.querySelector(".cargos-membro-nome")?.textContent,
      altura: Math.round(l.getBoundingClientRect().height),
    })),
    conta: document.querySelector(".cargos-membros-conta")?.textContent,
  }))
  check(
    `${em} membros: quem tem o cargo e quem o pode receber, uma linha por pessoa`,
    membros.conta === "2 membros" && membros.linhas.length === 3 && membros.linhas.every((l) => l.altura >= 40),
    `${membros.conta}: ${membros.linhas.map((l) => `${l.nome?.slice(0, 12)} ${l.altura}px`).join(", ")}`,
  )
  const t3 = await page.evaluate(TRANSBORDA)
  check(`${em} membros: um nome comprido corta e não empurra o botão para fora`, t3.fora.length === 0 && t3.documento <= t3.janela, t3.fora.join(", "))
  await page.locator(".sheet").screenshot({ path: join(SAIDA, `membros-${em}.png`) })

  // The built-in role, open by the owner.
  await page.locator(".cargos-lista").getByText("Administrador").click()
  await page.getByRole("tab", { name: "Permissões" }).click()
  const admin = await page.evaluate(() => ({
    aviso: document.querySelector(".cargos-painel .cargos-aviso")?.textContent ?? "",
    desligados: [...document.querySelectorAll(".cargos-painel [role=switch]")].every(
      (s) => s.disabled && s.getAttribute("aria-checked") === "true",
    ),
  }))
  check(`${em} administrador: tudo ligado, nada se muda, e o aviso ao fundador`, admin.desligados && /tem tudo/.test(admin.aviso))
  await page.locator(".sheet").screenshot({ path: join(SAIDA, `administrador-${em}.png`) })

  await ctx.close()
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)
