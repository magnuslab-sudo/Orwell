/**
 * The new alerts (3 November 2026), in a real layout engine: the friend card
 * like MSN and the bell in the timeline.
 *
 * The component tests run in jsdom, without stylesheets. This sets up the real
 * `ToastProvider` (where the card stack lives) and the real
 * `NotificationPanel`, with the real stylesheet, and measures what you see:
 * the card fits on screen, the timeline exists and stops on hover, the bell
 * window fits, and on mobile it is a full-width sheet.
 *
 * Captures, in `capturas/`:
 * - `card-amigo-online-{1280,390}.png`: one card, "Ana is online";
 * - `avisos-amigos-pilha-{1280,390}.png`: the stack with different types and "+N";
 * - `notificacoes-{1280,390}.png`: the bell.
 *
 *   node scripts/retratar-avisos-novos.mjs
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, "..")
const SAIDA = join(AQUI, ".saida-avisos-novos")
const CAPTURAS = join(RAIZ, "capturas")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

mkdirSync(SAIDA, { recursive: true })
mkdirSync(CAPTURAS, { recursive: true })

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { ToastProvider } from ${UI("components/Toast.js")}
import { useAvisoDeAmigo } from ${UI("components/AvisosDeAmigos.js")}
import { NotificationPanel } from ${UI("screens/overlays/NotificationPanel.js")}
import { strings } from ${UI("strings.js")}
import ${UI("styles.css")}

// Uma cara desenhada, para não pôr a cara de ninguém numa captura.
const CARA = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e070a8"/><stop offset="1" stop-color="#8b93e0"/></linearGradient></defs>' +
  '<rect width="96" height="96" fill="url(#g)"/>' +
  '<circle cx="48" cy="38" r="17" fill="#f3d7c4"/>' +
  '<path d="M14 96a34 30 0 0 1 68 0z" fill="#f3d7c4"/>' +
  '<path d="M29 36c0-16 9-24 19-24s21 7 19 26c-4-9-12-12-19-12s-15 3-19 10z" fill="#3a2218"/>' +
  '</svg>'
)

const cena = new URLSearchParams(location.search).get("cena")
window.__feito = 0

function Cards() {
  const empurrar = useAvisoDeAmigo()
  useEffect(() => {
    const fazer = () => { window.__feito += 1 }
    const online = (nome, cara) => ({
      tipo: "online",
      texto: strings.notifications.amigoOnline(nome),
      cara,
      iniciais: nome[0],
      rotulo: strings.notifications.abrirConversa,
      fazer,
    })
    if (cena === "card") {
      empurrar(online("Ana", CARA))
      return
    }
    empurrar(online("Bruno"))
    empurrar(online("Carla"))
    empurrar({
      tipo: "voz",
      texto: strings.notifications.amigoNaVoz("Rui", "Lounge"),
      onde: "Oficina",
      iniciais: "R",
      rotulo: strings.notifications.juntarMe,
      fazer,
    })
    empurrar({
      tipo: "ecra",
      texto: strings.notifications.amigoNoEcra("Ana", "Lounge"),
      onde: "Oficina",
      cara: CARA,
      iniciais: "A",
      rotulo: strings.notifications.ver,
      fazer,
    })
    empurrar({
      tipo: "comunidade",
      texto: strings.notifications.amigoNaComunidade("Tiago", "Oficina"),
      onde: "Oficina",
      iniciais: "T",
      rotulo: strings.notifications.abrir,
      fazer,
    })
  }, [empurrar])
  return null
}

const ANA = "@ana:casa.test"
const TIAGO = "@tiago:casa.test"
const MARIANA = "@mariana:casa.test"
const LAGAR = "!oficina:casa.test"
const DM = "!directa:casa.test"
const agora = Date.now()
// Hoje, a minutos de agora, para a hora ser verdadeira a qualquer hora do dia.
const hoje = (minutos) => agora - minutos * 60_000
const ontem = (h, m) => { const d = new Date(agora); d.setDate(d.getDate() - 1); d.setHours(h, m, 0, 0); return d.getTime() }
const notificacoes = [
  { id: "1", kind: "mention", at: hoje(4), actor: ANA, channel: LAGAR, read: false },
  { id: "2", kind: "friend-accept", at: hoje(51), actor: TIAGO, read: false },
  { id: "3", kind: "missed-call", at: hoje(98), actor: MARIANA, channel: DM, read: true },
  { id: "4", kind: "room-added", at: hoje(141), channel: LAGAR, read: true },
  { id: "5", kind: "dm-message", at: ontem(22, 10), actor: ANA, channel: DM, read: true },
  { id: "6", kind: "channel-join", at: ontem(18, 2), actor: TIAGO, channel: LAGAR, read: true },
]
const nomes = { [ANA]: "Inês Silva", [TIAGO]: "Tiago Martins", [MARIANA]: "Mariana Costa" }
const directorio = new Map([[ANA, { displayName: "Inês Silva", avatarDataUrl: CARA, donations: [] }]])

function Sino() {
  const [aberto, setAberto] = useState(true)
  return aberto ? (
    <NotificationPanel
      notifications={notificacoes}
      nameFor={(quem) => nomes[quem] ?? quem}
      labelFor={() => "design"}
      directory={directorio}
      onOpen={() => { window.__feito += 1 }}
      onMarkAllRead={() => {}}
      onClose={() => setAberto(false)}
    />
  ) : null
}

function Demo() {
  return (
    <ToastProvider>
      <div className="app" style={{ minHeight: "100vh", background: "var(--fundo)" }} />
      {cena === "sino" ? <Sino /> : <Cards />}
    </ToastProvider>
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? `: ${detalhe}` : ""}`)
}

async function abrir(largura, altura, cena, opcoes = {}) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura }, deviceScaleFactor: 2, ...opcoes })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(`file://${join(SAIDA, "index.html")}?cena=${cena}`)
  await page.evaluate(() => document.fonts.ready)
  return { ctx, page, erros }
}

for (const [largura, altura] of [
  [1280, 800],
  [390, 844],
]) {
  const id = String(largura)

  // 1. One card. The mouse lands on it around 1.1 s: the clock stops, and the line stops halfway.
  {
    const { ctx, page, erros } = await abrir(largura, altura, "card")
    await page.waitForSelector(".aviso-amigo", { timeout: 10_000 })
    await page.waitForTimeout(1100)
    await page.hover(".aviso-amigo")
    // One step for React to put the `parado` class, which is what stops the line.
    await page.waitForTimeout(150)
    const antes = await page.evaluate(() => document.querySelector(".aviso-amigo-vida > span").getBoundingClientRect().width)
    await page.waitForTimeout(2500)
    const m = await page.evaluate(() => {
      const card = document.querySelector(".aviso-amigo")
      const caixa = card?.getBoundingClientRect()
      return {
        existe: Boolean(card),
        titulo: card?.querySelector(".aviso-amigo-titulo")?.textContent ?? "",
        botao: card?.querySelector("button")?.textContent ?? "",
        estado: document.querySelector('[role="status"]')?.textContent ?? "",
        dentro: caixa ? caixa.left >= 0 && caixa.right <= innerWidth && caixa.bottom <= innerHeight : false,
        linha: document.querySelector(".aviso-amigo-vida > span")?.getBoundingClientRect().width ?? 0,
        anel: getComputedStyle(document.querySelector(".aviso-amigo-cara")).boxShadow,
        pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    check(`${id} card: sem erros`, erros.length === 0, erros.join(" | "))
    check(`${id} card: com o rato por cima, passados 3,6 s, continua lá`, m.existe)
    check(`${id} card: "Ana está online" e "Abrir conversa"`, m.titulo === "Ana está online" && m.botao === "Abrir conversa", `${m.titulo} / ${m.botao}`)
    check(`${id} card: o leitor de ecrã lê a frase`, m.estado === "Ana está online", m.estado)
    check(`${id} card: a linha parou a meio`, m.linha > 0 && Math.abs(m.linha - antes) < 1, `${antes.toFixed(1)} → ${m.linha.toFixed(1)}`)
    check(`${id} card: o anel é verde`, m.anel.includes("rgb(80, 250, 123)"), m.anel)
    check(`${id} card: cabe no ecrã, sem rolar de lado`, m.dentro && m.pagina <= 0, `página ${m.pagina}`)
    await page.screenshot({ path: join(CAPTURAS, `card-amigo-online-${id}.png`) })
    await page.mouse.move(5, 5)
    await page.waitForTimeout(1200)
    check(`${id} card: ao sair o rato, retoma e sai`, (await page.$(".aviso-amigo")) === null)
    await ctx.close()
  }

  // 2. The stack, with different types and "+N".
  {
    const { ctx, page, erros } = await abrir(largura, altura, "pilha")
    await page.waitForSelector(".aviso-amigo", { timeout: 10_000 })
    // Stop all three for the photo.
    for (const card of await page.$$(".aviso-amigo")) await card.dispatchEvent("mouseenter")
    await page.waitForTimeout(450)
    const m = await page.evaluate(() => ({
      cards: document.querySelectorAll(".aviso-amigo").length,
      mais: document.querySelector(".avisos-amigos-mais")?.textContent ?? "",
      tipos: [...document.querySelectorAll(".aviso-amigo")].map((c) => c.getAttribute("data-tipo")),
      topo: document.querySelector(".avisos-amigos")?.getBoundingClientRect().top ?? -1,
    }))
    check(`${id} pilha: sem erros`, erros.length === 0, erros.join(" | "))
    check(`${id} pilha: 3 à vista e "+2 amigos online"`, m.cards === 3 && m.mais === "+2 amigos online", `${m.cards} / ${m.mais}`)
    check(`${id} pilha: voz, ecrã e canal`, m.tipos.join(",") === "voz,ecra,comunidade", m.tipos.join(","))
    check(`${id} pilha: cabe na altura`, m.topo >= 0, String(m.topo))
    await page.screenshot({ path: join(CAPTURAS, `avisos-amigos-pilha-${id}.png`) })
    await ctx.close()
  }

  // 3. The bell.
  {
    const { ctx, page, erros } = await abrir(largura, altura, "sino")
    await page.waitForSelector(".notif-janela", { timeout: 10_000 })
    await page.waitForTimeout(400)
    const m = await page.evaluate(() => {
      const janela = document.querySelector(".notif-janela").getBoundingClientRect()
      return {
        largura: janela.width,
        esquerda: janela.left,
        fundo: innerHeight - janela.bottom,
        pilulas: [...document.querySelectorAll(".notif-filtro")].map((b) => b.textContent),
        dias: [...document.querySelectorAll(".notif-dia-titulo")].map((h) => h.textContent),
        pontos: document.querySelectorAll(".notif-ponto").length,
        foco: document.querySelector(".notif-janela").contains(document.activeElement),
        pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    check(`${id} sino: sem erros`, erros.length === 0, erros.join(" | "))
    check(`${id} sino: as cinco pílulas`, m.pilulas.join(",") === "Tudo,Menções,Chamadas,Convites,Amigos", m.pilulas.join(","))
    check(`${id} sino: Hoje e Ontem`, m.dias.join(",") === "Hoje,Ontem", m.dias.join(","))
    check(`${id} sino: um ponto por acontecimento`, m.pontos === 6, String(m.pontos))
    check(`${id} sino: o foco está na janela`, m.foco)
    if (largura < 640) {
      check(`${id} sino: folha a toda a largura, presa ao fundo`, m.largura === largura && m.esquerda === 0 && Math.abs(m.fundo) < 1, `${m.largura}px, fundo ${m.fundo}`)
    } else {
      check(`${id} sino: janela ao centro`, Math.abs(m.esquerda - (largura - m.largura) / 2) < 2, `esquerda ${m.esquerda}`)
    }
    check(`${id} sino: a página não rola de lado`, m.pagina <= 0, String(m.pagina))
    await page.screenshot({ path: join(CAPTURAS, `notificacoes-${id}.png`) })
    await page.keyboard.press("Escape")
    check(`${id} sino: Esc fecha`, (await page.$(".notif-janela")) === null)
    await ctx.close()
  }
}

// 4. Reduced motion: the card enters anyway, and the line empties anyway.
{
  const { ctx, page } = await abrir(1280, 800, "card", { reducedMotion: "reduce" })
  await page.waitForSelector(".aviso-amigo")
  await page.waitForTimeout(700)
  const m = await page.evaluate(() => {
    const vida = getComputedStyle(document.querySelector(".aviso-amigo-vida > span"))
    const card = getComputedStyle(document.querySelector(".aviso-amigo"))
    return {
      vida: vida.animationDuration,
      entrada: card.animationName,
      largura: document.querySelector(".aviso-amigo-vida > span").getBoundingClientRect().width,
      total: document.querySelector(".aviso-amigo-vida").getBoundingClientRect().width,
    }
  })
  check("movimento reduzido: a entrada esvanece", m.entrada === "aviso-amigo-esvanece", m.entrada)
  check("movimento reduzido: a linha dura 2 s e está a meio", m.vida === "2s" && m.largura > 0 && m.largura < m.total, `${m.vida}, ${m.largura.toFixed(0)}/${m.total.toFixed(0)}`)
  await ctx.close()
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)
