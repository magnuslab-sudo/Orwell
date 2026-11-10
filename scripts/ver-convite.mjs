// The invite as seen by the receiver, with two real accounts in two real browsers.
//
// The `client-core` scripts prove encryption; this one proves the path a person
// takes: send an invite on one screen, see it arrive on the other, click enter,
// and end up inside the room reading what is there.
//
//   npm run dev:web  (127.0.0.1:5173)  +  sh scripts/dev-reiniciar-servidor.sh
//   node scripts/ver-convite.mjs
import { chromium } from "playwright"
import { rmSync } from "node:fs"
import { criarConta } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const APP = comLingua("http://127.0.0.1:5173")
const SERVIDOR = "localhost:8452"
const FRASE = "frase-de-teste"

const resultados = []
const check = (label, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detalhe ? ` — ${detalhe}` : ""}`)
}

/** A new account, in its own browser profile. */
async function abrirConta(nome) {
  const dir = `/tmp/orwell-convite/${nome}-${Date.now()}`
  rmSync(dir, { recursive: true, force: true })
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, viewport: { width: 1280, height: 900 } })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  page.on("pageerror", (erro) => console.log(`  [${nome}] erro de página: ${erro.message}`))
  await page.goto(APP, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1500)

  // The creation screen: one question at a time, and the server in advanced settings.
  await criarConta(page, { nome, frase: FRASE, servidor: SERVIDOR })
  await page.waitForTimeout(6000)

  const endereco = await page.evaluate(() => {
    const texto = document.body.innerText
    const achado = texto.match(/@[a-z0-9-]+:[a-z0-9.:]+/i)
    return achado ? achado[0] : null
  })
  console.log(`[${nome}] ${endereco ?? "(endereço não lido do ecrã)"}`)
  return { nome, ctx, page, endereco }
}

/** The account address, read from settings when not visible. */
async function enderecoDe(conta) {
  if (conta.endereco) return conta.endereco
  await conta.page.getByRole("button", { name: /configura|definiç/i }).first().click()
  await conta.page.waitForTimeout(1500)
  const texto = await conta.page.locator("body").innerText()
  const achado = texto.match(/@[a-z0-9-]+:[a-z0-9.:]+/i)
  await conta.page.keyboard.press("Escape")
  await conta.page.waitForTimeout(500)
  conta.endereco = achado ? achado[0] : null
  console.log(`[${conta.nome}] ${conta.endereco}`)
  return conta.endereco
}

const a = await abrirConta("Ana")
const b = await abrirConta("Bruno")
await enderecoDe(a)
const enderecoB = await enderecoDe(b)
if (!enderecoB) {
  console.log("FALHA: não consegui ler o endereço do Bruno. Nada mais faz sentido.")
  process.exit(1)
}

console.log("\n--- Ana cria uma sala e convida o Bruno ---")

/** All the text on the screen, to search for phrases without guessing selectors. */
const ecra = (page) => page.locator("body").innerText()

// A new room, for the invite to point to.
const SALA = `Lagar ${Date.now().toString().slice(-5)}`
/** What the sidebar shows: the identifier without the server. See `shortName`. */
const ETIQUETA = SALA.toLowerCase().replace(/\s+/g, "-")
await a.page.getByRole("button", { name: /criar canal/i }).first().click()
await a.page.waitForTimeout(1200)
const campoSala = a.page.locator("input:not([type=password]):not([type=checkbox]):not([type=search])").first()
await campoSala.fill(SALA)
await a.page.keyboard.press("Enter")
await a.page.waitForTimeout(6000)
check("a sala nova abre-se do lado de quem a cria", (await ecra(a.page)).includes(ETIQUETA), ETIQUETA)

// Invite by address.
await a.page.getByRole("button", { name: /^convidar$/i }).first().click()
await a.page.waitForTimeout(1000)
const campoConvite = a.page.locator('input[placeholder*="@"]').first()
await campoConvite.fill(enderecoB)
await a.page.keyboard.press("Enter")
// Short on purpose: the warning is a toast and disappears. Now or never.
await a.page.waitForTimeout(1500)
await a.page.screenshot({ path: "/tmp/orwell-convite/2-ana-convidou.png" })

const textoA = await ecra(a.page)
check("quem convida é avisado de que o convite foi enviado, não de que a pessoa entrou", /entra se aceitar/i.test(textoA), textoA.split("\n").find((l) => /convite/i.test(l)) ?? "")

// The room member list, from Ana's side: still just one person.
await a.page.waitForTimeout(4000)
const membrosAntes = await a.page.locator(".member-list .member-row").count()
check("a sala continua com uma pessoa só enquanto o convite não for aceite", membrosAntes === 1, `linhas de membro: ${membrosAntes}`)

// --- From Bruno's side: the invite lands in Friends -------------------------
console.log("\n--- o Bruno vai a Amigos ---")
await b.page.waitForTimeout(3000)
await b.page.getByRole("button", { name: /amigos/i }).first().click()
await b.page.waitForTimeout(2500)
await b.page.screenshot({ path: "/tmp/orwell-convite/3-bruno-amigos.png" })
const textoAmigos = await ecra(b.page)
check("o convite aparece na lista de conversas de Amigos", /Convido-te para/i.test(textoAmigos), textoAmigos.split("\n").find((l) => /Convido-te/i.test(l)) ?? "")

// Open the conversation and reply there.
// By the conversation line, not by name: the profile may not have arrived yet,
// and then the line shows the raw address, which does not make it any less clickable.
await b.page.locator(".direct-open").first().click()
await b.page.waitForTimeout(2500)
await b.page.screenshot({ path: "/tmp/orwell-convite/4-bruno-conversa.png" })
const textoConversa = await ecra(b.page)
check("a conversa mostra o cartão do convite", /Convite para/i.test(textoConversa), textoConversa.split("\n").find((l) => /Convite para/i.test(l)) ?? "")

const botaoEntrar = b.page.getByRole("button", { name: /^entrar$/i }).first()
check("e o botão de entrar está lá", await botaoEntrar.isVisible().catch(() => false))
await botaoEntrar.click()
await b.page.waitForTimeout(7000)
await b.page.screenshot({ path: "/tmp/orwell-convite/5-bruno-aceitou.png" })

// --- And Bruno actually enters ------------------------------------------------
await b.page.getByRole("button", { name: /conversas|canais/i }).first().click()
await b.page.waitForTimeout(3000)
const textoCanais = await ecra(b.page)
check("depois de aceitar, a sala aparece nos canais do Bruno", textoCanais.includes(ETIQUETA), ETIQUETA)

// The final proof: Ana speaks in the room and Bruno reads.
const DITO = `dito no lagar ${Date.now().toString().slice(-4)}`
const caixa = a.page.locator(".composer-line input:not([type=file])").last()
await caixa.fill(DITO)
await a.page.keyboard.press("Enter")
await a.page.waitForTimeout(4000)

await b.page.getByText(ETIQUETA, { exact: false }).first().click().catch(() => {})
await b.page.waitForTimeout(3000)
await b.page.screenshot({ path: "/tmp/orwell-convite/6-bruno-na-sala.png" })
check("e lê o que lá se diz", (await ecra(b.page)).includes(DITO), DITO)

// And Ana sees the room with two people.
await a.page.waitForTimeout(2000)
const membrosDepois = await a.page.locator(".member-list .member-row").count()
check("do lado da Ana a sala passa a ter duas pessoas", membrosDepois >= 2, `linhas de membro: ${membrosDepois}`)


await a.ctx.close()
await b.ctx.close()
console.log("")
const passaram = resultados.filter(Boolean).length
console.log(`${passaram}/${resultados.length} verificações passaram`)
process.exit(passaram === resultados.length ? 0 : 1)
