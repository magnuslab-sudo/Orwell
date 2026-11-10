/**
 * YouTube thumbnail in a community with many members: counts the misses.
 *
 *   node scripts/e2e-miniaturas-relato.mjs      (requires `npm run build` first)
 *
 * Report from the owner on 1.1.0: "the app still has no YouTube thumbnails in
 * communities". The card appears, with the title and "play", but no image.
 *
 * The suspicion: a report (S4) carries the card WITHOUT the thumbnail, on
 * purpose (the thumbnail is not signed). If the report reaches a member before
 * the server event, the report's copy sticks, and the server's (with the
 * thumbnail) is lost. Only in communities: direct messages have no reports.
 *
 * Four members on Chromium (Ana, Bruno, Carla, Dina) and Eva on the desktop
 * app (`apps/client/out`). The steps:
 *
 *  1. Live: each member publishes videos, the others count the thumbnail as
 *     soon as they receive and again at the end of the round.
 *  2. Dina offline while the others publish; when she comes back.
 *  3. Carla, then Dina, close the page while the others publish; when they
 *     reopen.
 *  4. Everyone reloads: thumbnails on all messages.
 *
 * Room "conversa" stays under 40 messages: the vault stores media bytes from
 * the 40 most recent entries of each room (`foraDaJanelaDeMedia`), and a miss
 * outside that window is not the bug we are looking for.
 *
 * The script does not stop on a miss: it counts and writes the table at the
 * end. Exits with 1 if there are any misses.
 *
 * Disposable homeserver on ports 8486 and 8487, never production. The title
 * and thumbnail come from the homeserver, which needs Internet for oEmbed.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, ate, contasDoServidor, criarCanal, dentro, espera, portaoPronto, verificador } from "./fase7-comum.mjs"
import { abrirSecretaria } from "./secretaria.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const VIDEO = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
const ESCRITA = 'input[placeholder="Escreve uma mensagem"]'
const SALA = "conversa"
const CANAL = "adega"
const SEM_SECRETARIA = process.env.ORWELL_E2E_SEM_SECRETARIA === "1"
mkdirSync(join(RAIZ, ".verify-data"), { recursive: true })

const { check, resumo } = verificador()

/** The tallies: name, page, and where misses are read. */
const membros = []
/** All published video messages: the phrase and who said it. */
const publicadas = []
/** The measurements: step, who reads, phrase, and what was seen. */
const medidas = []

async function abrirSala(page, nome = SALA) {
  const sala = page
    .locator(".room-row button.room")
    .filter({ has: page.locator(".room-name", { hasText: nome }) })
    .first()
  await sala.waitFor({ timeout: 60_000 })
  await sala.click()
  await page.locator(ESCRITA).waitFor({ timeout: 30_000 })
  await espera(500)
}

/** Writes the video, waits for the thumbnail in the compose box, and sends. */
async function publicarVideo(quem, frase) {
  const escrita = quem.page.locator(ESCRITA)
  await escrita.click()
  await escrita.fill(`${frase} ${VIDEO}`)
  const naCaixa = await quem.page
    .locator(".link-attach .facade-thumb")
    .first()
    .waitFor({ timeout: 30_000 })
    .then(() => true, () => false)
  await escrita.press("Enter")
  publicadas.push({ frase, autor: quem.nome, naCaixa })
  return naCaixa
}

async function dizerTexto(quem, frase) {
  const escrita = quem.page.locator(ESCRITA)
  await escrita.fill(frase)
  await escrita.press("Enter")
}

/** What this page shows of this message: how many lines, and how many with thumbnail in bytes. */
async function vista(page, frase) {
  return page.evaluate((frase) => {
    const linhas = [...document.querySelectorAll(".message")].filter((linha) => linha.textContent?.includes(frase))
    const comMiniatura = linhas.filter((linha) => {
      const src = linha.querySelector(".video-facade .facade-thumb")?.getAttribute("src") ?? ""
      return src.startsWith("data:image/")
    }).length
    const comFachada = linhas.filter((linha) => linha.querySelector(".video-facade") !== null).length
    return { linhas: linhas.length, comMiniatura, comFachada }
  }, frase)
}

/**
 * Read a message: wait for it to arrive (up to `ms`), and give it 4 s for the
 * thumbnail to appear. Record the measurement. A miss means some line of this
 * message appears without the thumbnail: that is the card the owner sees.
 */
async function medir(passo, quem, frase, ms = 60_000) {
  const chegouEm = await ate(async () => (await vista(quem.page, frase)).linhas > 0, ms, 200)
  if (chegouEm >= 0) await ate(async () => { const v = await vista(quem.page, frase); return v.comMiniatura > 0 && v.comMiniatura === v.linhas }, 4000, 200)
  const v = chegouEm >= 0 ? await vista(quem.page, frase) : { linhas: 0, comMiniatura: 0, comFachada: 0 }
  const medida = { passo, quem: quem.nome, frase, ...v, falta: v.linhas === 0 || v.comMiniatura < v.linhas, repetida: v.linhas > 1 }
  medidas.push(medida)
  if (medida.falta || medida.repetida) console.log(`    ${passo}: ${quem.nome} lê "${frase}": ${JSON.stringify(v)}`)
  return medida
}

async function desbloquear(page) {
  // On the web the field has the placeholder; on desktop, only the label.
  const frase = page.locator('input[type="password"]').first()
  await frase.waitFor({ timeout: 30_000 }).catch(() => {})
  if (await frase.count()) {
    await frase.fill(FRASE)
    await page.getByRole("button", { name: "Entrar", exact: true }).click()
  }
  await dentro(page)
}

async function irParaASala(page) {
  await abrirCanal(page, CANAL)
  await abrirSala(page)
}

const srv = await levantarServidor({ frente: 8486, servidor: 8487, etiqueta: "miniaturas-relato" })
console.log(`servidor ${srv.NOME}`)
let browser
let sec
async function arrumar(codigo) {
  await sec?.fechar().catch(() => {})
  await browser?.close().catch(() => {})
  srv.fechar()
  process.exit(codigo)
}

try {
  browser = await chromium.launch({ headless: true })
  const erros = []
  const novoMembro = async (nome) => {
    const ctx = await browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } })
    await ctx.route(/^https:\/\/(www\.)?youtube\.com\//, (rota) =>
      rota.fulfill({ status: 200, contentType: "text/html", body: "<title>YouTube (guião)</title>" }),
    )
    const page = await ctx.newPage()
    page.on("pageerror", (e) => erros.push(`${nome}: ${String(e)}`))
    await page.goto(srv.APP, { waitUntil: "domcontentloaded" })
    await criarConta(page, { nome, frase: FRASE, servidor: srv.NOME })
    await dentro(page)
    const membro = { nome, ctx, page, endereco: contasDoServidor(srv.base).at(-1) }
    membros.push(membro)
    return membro
  }

  const ana = await novoMembro("Ana")
  const bruno = await novoMembro("Bruno")
  const carla = await novoMembro("Carla")
  const dina = await novoMembro("Dina")
  let eva = null
  if (!SEM_SECRETARIA) {
    sec = await abrirSecretaria({ rotulo: "miniaturas-relato" })
    await portaoPronto(sec.page)
    await criarConta(sec.page, { nome: "Eva", frase: FRASE, servidor: srv.NOME })
    await dentro(sec.page)
    eva = { nome: "Eva", page: sec.page, endereco: contasDoServidor(srv.base).at(-1), secretaria: true }
    membros.push(eva)
  }

  await criarCanal(ana.page, CANAL)
  for (const membro of membros.slice(1)) {
    check(`a Ana convida ${membro.nome}`, await convidar(ana.page, CANAL, membro.endereco))
    check(`${membro.nome} aceita`, await aceitarConvite(membro.page, CANAL, { espera: 60_000 }))
  }
  for (const membro of membros) await irParaASala(membro.page)
  await espera(3000)

  // -------------------------------------------- 1. live
  const autores = membros.slice(1)
  for (let ronda = 0; ronda < 3; ronda++) {
    for (const autor of autores) {
      const frase = `vivo-${ronda}-${autor.nome.toLowerCase()}`
      await publicarVideo(autor, frase)
      // Some chatter around it, like in a room with people.
      await dizerTexto(ana, `texto-${ronda}-${autor.nome.toLowerCase()}`)
      await Promise.all(membros.filter((m) => m !== autor).map((leitor) => medir("1-ao-vivo", leitor, frase)))
    }
  }
  // At the end of the round: what changed after the anti-entropies talk.
  await espera(25_000)
  for (const { frase, autor } of publicadas.filter((p) => p.frase.startsWith("vivo-"))) {
    for (const leitor of membros.filter((m) => m.nome !== autor)) await medir("1b-fim-da-ronda", leitor, frase, 5000)
  }

  // -------------------------------------------- 2. Dina offline
  await dina.ctx.setOffline(true)
  await espera(3000)
  for (const autor of [bruno, carla, ...(eva ? [eva] : [])]) {
    await publicarVideo(autor, `fora-${autor.nome.toLowerCase()}`)
  }
  await espera(5000)
  await dina.ctx.setOffline(false)
  for (const { frase } of publicadas.filter((p) => p.frase.startsWith("fora-"))) await medir("2-ao-voltar", dina, frase, 120_000)

  // -------------------------------------------- 3. Carla then Dina close the page
  for (const quem of [carla, dina]) {
    await quem.page.goto("about:blank")
    await espera(2000)
    const prefixo = `fechada-${quem.nome.toLowerCase()}-`
    for (const autor of [bruno, carla, dina, ...(eva ? [eva] : [])].filter((m) => m !== quem)) {
      await publicarVideo(autor, `${prefixo}${autor.nome.toLowerCase()}`)
    }
    await espera(3000)
    await quem.page.goto(srv.APP, { waitUntil: "domcontentloaded" })
    await desbloquear(quem.page)
    await irParaASala(quem.page)
    for (const { frase } of publicadas.filter((p) => p.frase.startsWith(prefixo))) await medir("3-ao-reabrir", quem, frase, 120_000)
  }

  // -------------------------------------------- 4. everyone reloads
  await espera(25_000)
  const recarregados = []
  for (const membro of membros) {
    try {
      await membro.page.reload({ waitUntil: "domcontentloaded" })
      await desbloquear(membro.page)
      await irParaASala(membro.page)
      recarregados.push(membro)
    } catch (erro) {
      check(`${membro.nome} recarrega e entra`, false, String(erro).split("\n")[0])
      await membro.page.screenshot({ path: join(RAIZ, ".verify-data", `miniaturas-relato-recarga-${membro.nome}.png`) }).catch(() => {})
    }
  }
  for (const membro of recarregados) {
    for (const { frase, autor } of publicadas) {
      if (autor === membro.nome) continue
      await medir("4-recarregada", membro, frase, 30_000)
    }
  }

  // -------------------------------------------- a tabela
  const passos = [...new Set(medidas.map((m) => m.passo))]
  console.log("\npasso                lidas  sem-miniatura  repetidas")
  for (const passo of passos) {
    const doPasso = medidas.filter((m) => m.passo === passo)
    const faltas = doPasso.filter((m) => m.falta).length
    const repetidas = doPasso.filter((m) => m.repetida).length
    console.log(`${passo.padEnd(20)} ${String(doPasso.length).padStart(5)}  ${String(faltas).padStart(13)}  ${String(repetidas).padStart(9)}`)
    check(`${passo}: nenhuma mensagem sem miniatura`, faltas === 0, `${faltas} de ${doPasso.length}`)
    check(`${passo}: nenhuma mensagem repetida`, repetidas === 0, `${repetidas} de ${doPasso.length}`)
  }
  for (const membro of membros) {
    const doMembro = medidas.filter((m) => m.quem === membro.nome && m.falta).length
    console.log(`  ${membro.nome}${membro.secretaria ? " (secretária)" : ""}: ${doMembro} faltas`)
  }
  check("na caixa de quem publica, a miniatura chega sempre", publicadas.every((p) => p.naCaixa))
  check("sem erros nas páginas", erros.length === 0, erros.slice(0, 2).join(" | "))
  const ok = resumo()
  await arrumar(ok ? 0 : 1)
} catch (erro) {
  console.error(erro)
  for (const page of browser?.contexts().flatMap((c) => c.pages()) ?? []) {
    await page.screenshot({ path: join(RAIZ, ".verify-data", `miniaturas-relato-falha-${Date.now()}.png`) }).catch(() => {})
  }
  await arrumar(1)
}
