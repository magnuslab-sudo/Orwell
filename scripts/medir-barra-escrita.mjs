// The input bar, measured box by box, and the nudge with two accounts.
//
// Why this exists instead of a test: "disproportionate" is a complaint about
// RENDERED PIXELS, and neither jsdom nor reading the CSS knows them. A button
// without declared `height` gets the height its text inside gives it, and that
// height only appears when a layout engine calculates it. That is how the emoji
// button ended up 38 wide by 22 high next to a square neighbor of 34 without
// anyone noticing by eye.
//
// The nudge takes two windows for the same reason as `e2e-escrita-buzz.mjs`:
// whoever gives it does not shake: whoever gets it does. One window only
// proves half and it is the half that deceives.
//
//   node apps/server/dist/main.js
//   npm run preview -w @enclave/web -- --port 4191
//   node scripts/medir-barra-escrita.mjs [url]
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const URL = comLingua(process.argv[2] ?? "http://127.0.0.1:4191")

const browser = await chromium.launch()
const results = []
const check = (label, ok, detail = "") => {
  results.push([label, ok])
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function conta(nome, viewport) {
  const ctx = await browser.newContext(viewport ? { viewport } : {})
  const page = await ctx.newPage()
  const erros = []
  page.on("console", (m) => {
    if (m.type() === "error") erros.push(m.text())
  })
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(URL, { waitUntil: "networkidle" })
  await criarConta(page, { nome, frase: `frase-de-teste-${nome}` })
  await page.getByRole("button", { name: "Amigos" }).waitFor({ timeout: 60_000 })
  await wait(2500)
  const texto = await page.evaluate(() => document.body.innerText)
  const addr = texto.match(/@[a-z-]+:[^\s]+/)?.[0] ?? null
  console.log(`   [${nome}] ${addr}`)
  return { ctx, page, nome, addr, erros }
}

/**
 * The boxes of the input line, from the first child to the last.
 *
 * `getBoundingClientRect` and not the declared CSS: what matters is what the
 * engine drew, including height inherited from not being declared.
 */
const medirLinha = (page) =>
  page.evaluate(() => {
    const linha = document.querySelector(".composer-line")
    if (!linha) return null
    return [...linha.children].map((n) => {
      const r = n.getBoundingClientRect()
      return {
        tag: n.tagName.toLowerCase(),
        classe: n.className || "(sem classe)",
        largura: Math.round(r.width * 10) / 10,
        altura: Math.round(r.height * 10) / 10,
        texto: (n.textContent ?? "").trim().slice(0, 14),
        svgs: n.querySelectorAll("svg").length,
      }
    })
  })

const mostrar = (caixas) => {
  for (const c of caixas) {
    console.log(
      `      ${String(c.largura).padStart(6)} × ${String(c.altura).padStart(5)}  ` +
        `${c.classe.padEnd(22)} svg:${c.svgs}  ${c.texto ? `"${c.texto}"` : ""}`,
    )
  }
}

const ana = await conta("Ana")
const bruno = await conta("Bruno")

// ------------------------------------------------------- a shared channel
const SALA = `barra-${Date.now().toString(36)}`
await ana.page.getByRole("button", { name: "Criar canal", exact: true }).first().click()
await ana.page.locator('input[placeholder="geral"]').fill(SALA)
await ana.page.getByRole("button", { name: "Confirmar" }).click()
await wait(5000)

await ana.page.getByRole("button", { name: "Convidar" }).first().click()
await ana.page.locator('input[placeholder="@abc…:servidor"]').fill(bruno.addr)
await ana.page.getByRole("button", { name: "Confirmar" }).click()
await wait(12_000)

await bruno.page.getByRole("button", { name: new RegExp(SALA) }).first().click()
await wait(2500)

// ----------------------------------------------------- the measurements, in a channel
console.log("\n   ── linha de escrita num canal de grupo (1280px) ──")
const canal = await medirLinha(ana.page)
check("a linha de escrita existe e tem filhos", (canal?.length ?? 0) > 0, `${canal?.length ?? 0} caixas`)
if (canal) mostrar(canal)

/** The square buttons in the line: everything that is not the text box or Send. */
const quadrados = (caixas) => caixas.filter((c) => c.classe !== "primary" && c.tag !== "input")

if (canal) {
  const q = quadrados(canal)
  const alturas = [...new Set(q.map((c) => c.altura))]
  const larguras = [...new Set(q.map((c) => c.largura))]
  check(
    "os botões de ícone da linha têm todos a MESMA altura",
    alturas.length === 1,
    `alturas: ${alturas.join(", ")}`,
  )
  check("e a mesma largura", larguras.length === 1, `larguras: ${larguras.join(", ")}`)
  check(
    "e são quadrados, não achatados",
    q.every((c) => Math.abs(c.largura - c.altura) <= 1),
    q.map((c) => `${c.classe}=${c.largura}×${c.altura}`).join("  "),
  )
  check(
    "nenhum botão da linha mostra um símbolo emprestado em vez de um ícone",
    q.every((c) => c.svgs >= 1),
    q.map((c) => `${c.classe}:svg${c.svgs}`).join("  "),
  )
  // An emoji or glyph left by mistake appears as visible text inside a button
  // that should only have an SVG and a hidden label.
  const comEmoji = q.filter((c) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(c.texto))
  check(
    "nenhum emoji sobrou na linha de escrita",
    comEmoji.length === 0,
    comEmoji.map((c) => `${c.classe}="${c.texto}"`).join("  "),
  )
}

// -------------------------------------------------- a cotovelada, numa DM
const noCanal = await ana.page.getByRole("button", { name: /Cotovelada/ }).count()
check("num canal de grupo não há cotovelada nenhuma", noCanal === 0, `${noCanal} botões`)

await ana.page.locator(`button:has-text("${bruno.addr.slice(1, 7)}")`).first().click()
await wait(1500)
await ana.page.getByRole("button", { name: "Mensagem" }).click()
await wait(9000)

const naDm = await ana.page.getByRole("button", { name: /Cotovelada/ }).count()
check("numa conversa directa a cotovelada aparece", naDm === 1, `${naDm} botões`)

console.log("\n   ── linha de escrita numa conversa directa (1280px) ──")
const dm = await medirLinha(ana.page)
if (dm) mostrar(dm)

if (dm) {
  const q = quadrados(dm)
  const alturas = [...new Set(q.map((c) => c.altura))]
  check("com a cotovelada dentro, as alturas continuam iguais", alturas.length === 1, `alturas: ${alturas.join(", ")}`)
  check(
    "e são quadrados",
    q.every((c) => Math.abs(c.largura - c.altura) <= 1),
    q.map((c) => `${c.classe}=${c.largura}×${c.altura}`).join("  "),
  )
  // The owner's request: the nudge next to the emoji button.
  const iEmoji = dm.findIndex((c) => c.classe.includes("composer-emoji"))
  const iBuzz = dm.findIndex((c) => c.classe.includes("composer-buzz"))
  check("a cotovelada vive na barra de escrita", iBuzz !== -1, `índice ${iBuzz}`)
  check(
    "e está encostada ao botão dos emojis",
    iEmoji !== -1 && iBuzz !== -1 && Math.abs(iEmoji - iBuzz) === 1,
    `emoji@${iEmoji} buzz@${iBuzz}`,
  )
  // And it is no longer in the header: that is where it had to leave.
  const noTopo = await ana.page.evaluate(
    () => document.querySelectorAll('.topbar button[title^="Abanar o ecrã"]').length,
  )
  check("e saiu do cabeçalho do chat", noTopo === 0, `${noTopo} no topo`)
}

// ------------------------------------------------- the shake, with two windows
//
// Bruno has to be IN the conversation to feel it: a nudge in another
// conversation arrives as an unread message and shakes no screen.
//
// He opens it from Ana's profile in the channel member list, not from a line in
// the sidebar. The reason is not convenience: the identifier of a direct
// conversation is derived from both addresses in alphabetical order (see
// `openDirect`), so both sides opening it land on the SAME channel, his
// already exists, made by her invite. Looking for the line in the sidebar was
// what the old script did, and it stopped working when direct conversations
// moved to the Friends page.
const primeiraPalavraDaAna = ana.addr.slice(1).split(/[-:]/)[0]
const cotoveladaDoBruno = () => bruno.page.locator('button[title^="Abanar o ecrã"]')

if ((await cotoveladaDoBruno().count()) === 0) {
  await bruno.page.locator(`button[title*="${primeiraPalavraDaAna}"]`).first().click()
  await wait(2000)
  await bruno.page.getByRole("button", { name: "Mensagem" }).click()
  await wait(9000)
}
check("o Bruno consegue abrir a mesma conversa directa", (await cotoveladaDoBruno().count()) === 1)

const abanar = (page) => page.evaluate(() => document.querySelector(".main")?.classList.contains("buzzing") ?? null)

check("antes da cotovelada, o ecrã do Bruno está quieto", (await abanar(bruno.page)) === false)

await ana.page.locator('button[title^="Abanar o ecrã"]').click()

// Who RECEIVES shakes. Checked quickly: the shake lasts 820 ms on purpose.
let abanouBruno = false
for (let i = 0; i < 60 && !abanouBruno; i++) {
  abanouBruno = (await abanar(bruno.page)) === true
  if (!abanouBruno) await wait(50)
}
check("a cotovelada da Ana abana o ecrã do Bruno", abanouBruno)

// And who GIVES also sees something: without this the button looks like it did
// nothing but make a sound, the exact complaint from the owner.
let ecoNaAna = false
for (let i = 0; i < 40 && !ecoNaAna; i++) {
  ecoNaAna = await ana.page.evaluate(
    () => document.querySelector(".composer-buzz")?.classList.contains("buzzed") ?? false,
  )
  if (!ecoNaAna) await wait(50)
}
check("e quem a deu vê um eco no próprio botão, não só um som", ecoNaAna)

const rotulo = await ana.page.evaluate(() => {
  const b = document.querySelector('button[title^="Podes dar outra dentro de"]')
  return b ? { texto: b.textContent.trim(), fechado: b.disabled } : null
})
check(
  "o botão fecha-se e diz quantos segundos faltam",
  rotulo?.fechado === true && /\d+s/.test(rotulo.texto),
  rotulo ? rotulo.texto : "sem contador",
)

await wait(2500)
check("o abanão passa sozinho", (await abanar(bruno.page)) === false)

// ------------------------------------- 390px with the nudge inside the line
//
// The tight case is this one, not the channel: five boxes, and four of them
// do not shrink. The CSS of the text box already has a warning written about
// this, at 390px the line minimum is decided by the BUTTONS, and one more
// button is 34 pixels plus 8 of gap that go straight to that minimum. The
// center column already became 2px wider than the screen because of it once.
//
// Ana's window is reused instead of creating a third account: she is already
// INSIDE the direct conversation, which is the only place this button exists.
await ana.page.setViewportSize({ width: 390, height: 844 })
await wait(2000)
console.log("\n   ── linha de escrita a 390px, numa conversa directa ──")
const dmEstreita = await medirLinha(ana.page)
if (dmEstreita) mostrar(dmEstreita)
check(
  "a cotovelada continua na linha a 390px",
  (dmEstreita ?? []).some((c) => c.classe.includes("composer-buzz")),
)
const apertado = await ana.page.evaluate(() => {
  const l = document.querySelector(".composer-line")
  return {
    documento: document.documentElement.scrollWidth,
    linha: l ? { scroll: l.scrollWidth, cliente: l.clientWidth } : null,
  }
})
check(
  "a 390px, com cinco caixas, nada transborda na horizontal",
  apertado.documento <= 390,
  `scrollWidth do documento = ${apertado.documento}`,
)
check(
  "e a linha das cinco caixas cabe na largura que tem",
  apertado.linha !== null && apertado.linha.scroll <= apertado.linha.cliente + 1,
  apertado.linha ? `${apertado.linha.scroll} dentro de ${apertado.linha.cliente}` : "sem linha",
)
await ana.page.screenshot({ path: "scripts/_saida-barra-390-dm.png" })
await ana.page.setViewportSize({ width: 1280, height: 720 })
await wait(1000)

await ana.page.screenshot({ path: "scripts/_saida-barra-ana.png" })
await bruno.page.screenshot({ path: "scripts/_saida-barra-bruno.png" })

// ------------------------------------------------------------ 390 px wide
//
// The phone is where the input line breaks first: five boxes in a width that
// is not enough for them overflow off the screen, and who does not measure does
// not see. The `scrollWidth` of the document is the judge, if it goes over
// 390, something is showing at the side.
const mini = await browser.newContext({ viewport: { width: 390, height: 844 } })
const paginaMini = await mini.newPage()
await paginaMini.goto(URL, { waitUntil: "networkidle" })
await criarConta(paginaMini, { nome: "Telefone", frase: "frase-de-teste-telefone" })
await paginaMini.getByRole("button", { name: "Amigos" }).waitFor({ timeout: 60_000 })
await wait(3000)

const SALA_MINI = `mini-${Date.now().toString(36)}`
await paginaMini.getByRole("button", { name: "Criar canal", exact: true }).first().click()
await paginaMini.locator('input[placeholder="geral"]').fill(SALA_MINI)
await paginaMini.getByRole("button", { name: "Confirmar" }).click()
await wait(6000)

console.log("\n   ── linha de escrita a 390px ──")
const estreito = await medirLinha(paginaMini)
if (estreito) mostrar(estreito)

const transborda = await paginaMini.evaluate(() => ({
  documento: document.documentElement.scrollWidth,
  linha: (() => {
    const l = document.querySelector(".composer-line")
    return l ? { scroll: l.scrollWidth, cliente: l.clientWidth } : null
  })(),
}))
check(
  "a 390px nada transborda na horizontal",
  transborda.documento <= 390,
  `scrollWidth do documento = ${transborda.documento}`,
)
check(
  "e a própria linha de escrita cabe na largura que tem",
  transborda.linha !== null && transborda.linha.scroll <= transborda.linha.cliente + 1,
  transborda.linha ? `${transborda.linha.scroll} dentro de ${transborda.linha.cliente}` : "sem linha",
)
await paginaMini.screenshot({ path: "scripts/_saida-barra-390.png" })

check("nenhum erro de consola na Ana", ana.erros.length === 0, ana.erros.slice(0, 3).join(" | "))
check("nenhum erro de consola no Bruno", bruno.erros.length === 0, bruno.erros.slice(0, 3).join(" | "))

await browser.close()
console.log("")
const falhas = results.filter(([, ok]) => !ok)
console.log(falhas.length === 0 ? "TUDO PASSOU" : `${falhas.length} FALHAS`)
process.exit(falhas.length === 0 ? 0 : 1)
