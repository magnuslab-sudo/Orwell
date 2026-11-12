// Search in the conversation, live and in a real browser.
//
// What the suite cannot answer, and why this script exists: whether the message
// actually exists in the encrypted vault when we search for it (recording is
// deferred, and a test with a fake bridge never waits for it), whether the
// highlight shows on the screen, whether the jump really moves the view, and
// whether the sheet fits on a phone.
//
// One more thing no unit test pins down: a term with parentheses, typed by a
// person in a text box, against the real JavaScript engine.
//
//   node scripts/verificar-procura.mjs [url] [servidor]
import { chromium } from "playwright"
import { APP, SERVIDOR as SERVIDOR_POR_OMISSAO } from "./ambiente.mjs"
import { criarContaEEntrar } from "./conta.mjs"

const URL = process.argv[2] ?? APP
const SERVIDOR = process.argv[3] ?? SERVIDOR_POR_OMISSAO

const resultados = []
const check = (rotulo, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

/** Errors in the console are bugs, and a search cannot produce any. */
const erros = []
page.on("pageerror", (erro) => erros.push(String(erro)))

await page.goto(URL, { waitUntil: "networkidle" })
await criarContaEEntrar(page, { nome: "Régua da Procura", frase: "regua-da-procura-2026", servidor: SERVIDOR })
await page.locator(".chat-composer").waitFor({ timeout: 90_000 })

const escrita = page.locator(".chat-composer input:not([type=file])").first()
const enviar = async (texto) => {
  await escrita.fill(texto)
  await page.getByRole("button", { name: "Enviar" }).click()
  await page.waitForTimeout(350)
}

/*
  A conversation that does not fit on the screen, and that is what makes it a
proof.
  
  The first version of this script sent sixteen sentences: they all fit, the
  timeline had no scrolling at all, and checking the jump passed because there
  was nothing to jump to. The padding is here so `scrollTop` has different
  values before and after, which is the only way to say the view moved.

  The needle goes to the top, and the accents and the parenthesis to the bottom:
  what we search for must be far from where we are.
*/
await enviar("a agulha está aqui, no orçamento do estaleiro")
for (let i = 1; i <= 45; i++) await enviar(`conversa de enchimento número ${i}`)
await enviar("o valor (com IVA) são 300")

// The vault is recorded with a 1500 ms delay so we do not re-encrypt everything
// for each sentence. Waiting for it is the point: we want to search the real
// vault.
await page.waitForTimeout(2500)

const abrir = async () => {
  await page.getByRole("button", { name: "Procurar nesta conversa" }).click()
  await page.locator(".procura-panel").waitFor({ timeout: 10_000 })
}
const escrever = async (termo) => {
  await page.locator(".procura-caixa").fill(termo)
  await page.waitForTimeout(250)
}

// --------------------------------------------------- 1. find and highlight
await abrir()
await escrever("orçamento")

const primeiro = await page.evaluate(() => {
  const linha = document.querySelector(".procura-linha")
  if (!linha) return null
  return {
    texto: linha.textContent ?? "",
    marcas: [...linha.querySelectorAll("mark")].map((marca) => marca.textContent),
    quem: linha.querySelector(".procura-quem")?.textContent ?? "",
  }
})
check("encontra a mensagem pelo texto", (primeiro?.texto ?? "").includes("a agulha está aqui"), primeiro?.texto?.slice(0, 60))
check("realça o termo, e realça-o como nó", primeiro?.marcas?.length === 1 && primeiro?.marcas[0] === "orçamento", JSON.stringify(primeiro?.marcas))
check("diz quem escreveu", (primeiro?.quem ?? "").includes("Régua da Procura"), primeiro?.quem)

// Without accents or capitals, it must match the same.
await escrever("ORCAMENTO")
const semAcento = await page.locator(".procura-linha").count()
check("procura sem acentos e sem caixa encontra o mesmo", semAcento === 1, `${semAcento} linhas`)

// --------------------------------------- 2. the term is text, not a pattern
await escrever("(com IVA)")
const parenteses = await page.evaluate(() => document.querySelector(".procura-linha")?.textContent ?? "")
check("um termo com parênteses encontra a frase que os tem", parenteses.includes("(com IVA)"), parenteses.slice(0, 50))

await escrever("(a+)+")
const catastrofe = await page.locator(".procura-linha").count()
check("um termo que é uma expressão regular não encontra nada, e não rebenta", catastrofe === 0, `${catastrofe} linhas`)
check("nenhum erro na consola até aqui", erros.length === 0, erros.join(" | "))

// ------------------------------------------------------------- 3. the jump
await escrever("agulha")
// Before jumping: where is the conversation, and is there anywhere to go at
// all. Without this second measure, the jump check passed on a conversation that
// fits on the screen, which is exactly what happened the first time.
const antes = await page.evaluate(() => {
  const timeline = document.querySelector(".timeline")
  if (!timeline) return { scrollTop: 0, rolavel: false }
  return { scrollTop: timeline.scrollTop, rolavel: timeline.scrollHeight > timeline.clientHeight + 20 }
})
check("a conversa é mais comprida do que o ecrã, logo há para onde saltar", antes.rolavel === true, JSON.stringify(antes))
await page.locator(".procura-linha").first().click()
await page.waitForTimeout(900)

const salto = await page.evaluate(() => {
  const timeline = document.querySelector(".timeline")
  const acesa = document.querySelector(".message.destacada")
  if (!timeline || !acesa) return { acesa: false }
  const caixa = timeline.getBoundingClientRect()
  const linha = acesa.getBoundingClientRect()
  return {
    acesa: true,
    texto: acesa.textContent ?? "",
    dentroDaVista: linha.top >= caixa.top - 4 && linha.bottom <= caixa.bottom + 4,
    scrollTop: timeline.scrollTop,
    folhaAberta: document.querySelector(".procura-panel") !== null,
  }
})
check("a mensagem a que se saltou fica acesa", salto.acesa === true)
check("e o texto é o certo", (salto.texto ?? "").includes("a agulha está aqui"), (salto.texto ?? "").slice(0, 50))
check("a conversa moveu-se para lá", salto.scrollTop !== antes.scrollTop, `${antes.scrollTop} → ${salto.scrollTop}`)
check("a mensagem está dentro da vista", salto.dentroDaVista === true)
check("a folha sai da frente ao saltar", salto.folhaAberta === false)

// The highlight clears itself: it answers a gesture, not a state.
await page.waitForTimeout(3000)
const apagou = await page.locator(".message.destacada").count()
check("o destaque apaga-se sozinho", apagou === 0, `${apagou} acesas`)

// ------------------------------------------------------- 4. on a phone
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(400)
await abrir()
await escrever("conversa")

const noTelemovel = await page.evaluate(() => {
  const folha = document.querySelector(".procura-panel")
  if (!folha) return null
  const caixa = folha.getBoundingClientRect()
  return {
    esquerda: Math.round(caixa.left),
    direita: Math.round(caixa.right),
    largura: Math.round(caixa.width),
    janela: window.innerWidth,
    // The entire page cannot scroll horizontally because of the sheet.
    rolagemLateral: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    linhas: document.querySelectorAll(".procura-linha").length,
  }
})
check("a folha cabe no ecrã do telemóvel", noTelemovel !== null && noTelemovel.esquerda >= 0 && noTelemovel.direita <= noTelemovel.janela, JSON.stringify(noTelemovel))
check("e não empurra a página para o lado", noTelemovel?.rolagemLateral === false)
check("e continua a mostrar resultados", (noTelemovel?.linhas ?? 0) > 0, `${noTelemovel?.linhas} linhas`)

check("nenhum erro na consola, do princípio ao fim", erros.length === 0, erros.join(" | "))

await browser.close()

const falhas = resultados.filter((ok) => !ok).length
console.log("")
console.log(falhas === 0 ? `TUDO BEM — ${resultados.length} verificações` : `${falhas} FALHAS em ${resultados.length}`)
process.exit(falhas === 0 ? 0 : 1)
