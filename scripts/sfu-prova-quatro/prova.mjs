/**
 * FOUR in a voice call via SFU, with real browsers.
 *
 * The SFU path has never been exercised above TWO participants: the Phase 2 and
 * Phase 3 tests run with a pair, and the eight-person load measurement in
 * `scripts/carga-chamada.mjs` is from 6 August 2026, when it was still mesh and
 * the SFU did not exist. The production report-three hearing each other, the
 * fourth eternally "connecting" to them-falls exactly in that gap.
 *
 * This sets up the entire product, puts THREE speaking, lets the call settle,
 * and only then adds the fourth. It measures at each boundary:
 *
 *   1. each person's card on each other person's screen: "connected" or
 *      "connecting…", which is literally the reported symptom;
 *   2. how many streams each person receives (two with three in the room, three
 *      with four);
 *   3. encrypted and decrypted SFrame frames, per role-a card that says
 *      "connected" with zero decrypted frames is another failure, not the same one;
 *   4. the product's log, looking for lines it emits when the path breaks
 *      (`sfu-consumo-falhou`, `call-sfu-oferta-de-malha`, …).
 *
 * ```
 * node scripts/sfu-prova-quatro/prova.mjs
 * ```
 *
 * NEVER against production: the test bed spins up homeserver, SFU and vite on
 * their own ports, with a throwaway database.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  APP,
  FRASE,
  matarPorNome,
  matarTudo,
  registoDoServidor,
  levantarServidor,
  levantarWeb,
  PORTA_SFU,
  PORTA_WEB,
  SERVIDOR,
} from "./bancada.mjs"
import { LER_SFRAME } from "../sfu-prova-fase2/instrumento.mjs"
import { chromium } from "playwright"
import { comLingua } from "../ambiente.mjs"
import { criarContaEEntrar } from "../conta.mjs"
import { ARGS, abrirCanal, assentar, criarCanal, entrarNaChamada } from "../sfu-prova-fase2/montagem.mjs"
import { INSTRUMENTAR } from "../sfu-prova-fase2/instrumento.mjs"

/**
 * The `sfu.*` frames on the wire, from both sides.
 *
 * Ground truth: when a call does not come back up, the product says a sentence
 * for the person to read and stores the details in its log-which does not leave
 * the module where it lives. This reads the SERVER's refusal as it arrived.
 */
const GRAVAR_FRAMES = () => {
  window.__frames = []
  const Original = window.WebSocket
  const Espia = function (...args) {
    const socket = new Original(...args)
    socket.addEventListener("message", (evento) => {
      try {
        const frame = JSON.parse(evento.data)
        const tipo = String(frame.t ?? "")
        if (tipo.startsWith("sfu.") || tipo === "error") window.__frames.push({ lado: "recebido", ...frame })
      } catch {
        // Not JSON: not ours.
      }
    })
    const enviar = socket.send.bind(socket)
    socket.send = (dados) => {
      try {
        const frame = JSON.parse(dados)
        if (String(frame.t ?? "").startsWith("sfu.")) window.__frames.push({ lado: "enviado", t: frame.t, ref: frame.ref })
      } catch {
        // Idem.
      }
      return enviar(dados)
    }
    return socket
  }
  Espia.prototype = Original.prototype
  Object.assign(Espia, Original)
  window.WebSocket = Espia
}

const LER_FRAMES = () => (window.__frames ?? []).slice(-40)

/** Like the `abrirConta` from Phase 2, with frame recording on top. */
async function abrirConta(app, { nome, frase, indice, perfil }) {
  const ctx = await chromium.launchPersistentContext(`${perfil}/${indice}`, {
    headless: true,
    args: ARGS,
    permissions: ["microphone"],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.addInitScript(GRAVAR_FRAMES)
  await page.addInitScript(INSTRUMENTAR, "")
  /*
    The language is REQUESTED in the address, as in all scripts.
    
    Without this, this test rig only runs on a machine whose browser is already
    in Portuguese: Playwright's Chromium starts in English, the app detects
    language on its own since August 20, 2026, and `criarContaEEntrar` looks
    for "Como queres aparecer" on a screen that says "How do you want your name
    shown?". What you saw was a timeout pointing to `conta.mjs`, as if the app
    had not started.
    
    The `guioes.lingua.test.ts` exists precisely so this does not happen, and
    it missed this call because it only reads `scripts/*.mjs`, these test rigs
    live one folder deeper. See the report: the guard should go into
    subfolders.
    */
  await page.goto(comLingua(app), { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2000)
  await criarContaEEntrar(page, { nome, frase })
  return { ctx, page, nome, indice }
}

const SALA = `quatro ${Date.now().toString(36)}`
const QUANTOS = 4

const resultados = []
const verificar = (etiqueta, ok, detalhe = "") => {
  resultados.push({ etiqueta, ok })
  console.log(`${ok ? "PASS" : "FALHA"}  ${etiqueta}${detalhe ? ` -- ${detalhe}` : ""}`)
}

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The call cards as the person sees them: name, state, and whether pending. */
const LER_CARTOES = () =>
  [...document.querySelectorAll(".call-people .call-person")].map((pessoa) => {
    const cartao = pessoa.querySelector(".call-chip")
    return {
      nome: cartao?.querySelector(".call-chip-name")?.textContent ?? "",
      estado: cartao?.querySelector(".call-chip-state")?.textContent ?? "",
      pendente: cartao?.classList.contains("pending") ?? false,
    }
  })

/** The messages the product put on screen. This is how a failure reads. */
const LER_AVISOS = () => [...document.querySelectorAll(".toast")].map((t) => t.textContent ?? "")

/** The product's log, as Settings copies it. */
const LER_REGISTO = () => {
  const diario = window.__diagnostico ?? window.__registo ?? null
  if (Array.isArray(diario)) return diario.slice(-200)
  return null
}

const lerCartoes = (page) => page.evaluate(LER_CARTOES)
const lerSframe = (page) => page.evaluate(LER_SFRAME)
const lerRegisto = (page) => page.evaluate(LER_REGISTO)

/** How many voice streams this person is actually receiving. */
const LER_RECEPTORES = () => (window.__sframe ?? []).filter((r) => r.papel === "receptor").length

const dados = mkdtempSync(join(tmpdir(), "orwell-sfu-quatro-"))
const perfis = mkdtempSync(join(tmpdir(), "orwell-sfu-quatro-perfis-"))
let clientes = []

try {
  console.log("== Quatro numa chamada de voz, pelo SFU")

  if (!(await levantarServidor(dados, { comSfu: true }))) {
    console.error("FALHA  o homeserver não subiu")
    process.exit(1)
  }
  if (!(await levantarWeb())) {
    console.error("FALHA  o vite não subiu")
    process.exit(1)
  }
  console.log(`   homeserver ${SERVIDOR}  ·  sfu ${PORTA_SFU}  ·  app ${PORTA_WEB}`)

  // --------------------------------------------------------------- montagem

  for (let indice = 0; indice < QUANTOS; indice++) {
    clientes.push(await abrirConta(APP, { nome: `voz ${indice}`, frase: FRASE, indice, perfil: perfis }))
    console.log(`   conta ${indice} pronta`)
  }
  const [anfitriao, ...convidados] = clientes

  await criarCanal(anfitriao.page, SALA)
  for (const convidado of convidados) {
    const entrou = await assentar(anfitriao, convidado, SALA)
    if (!entrou) {
      console.error(`\nFALHA  a conta ${convidado.indice} ficou à porta do canal. Sem ela não há quarto a medir.`)
      process.exit(1)
    }
  }
  verificar("as quatro contas estão no canal", true, `${QUANTOS} no canal`)

  // ------------------------------------------------- 1. the THREE speaking

  const tres = clientes.slice(0, 3)
  for (const cliente of tres) {
    await abrirCanal(cliente.page, SALA)
    const entrou = await entrarNaChamada(cliente.page)
    if (!entrou) {
      console.error(`\nFALHA  a conta ${cliente.indice} não conseguiu entrar na sala de voz.`)
      process.exit(1)
    }
    await cliente.page.waitForTimeout(2000)
  }
  console.log("   três na chamada, a falar 12 s...")
  await dormir(12_000)

  const cartoesAosTres = []
  for (const cliente of tres) cartoesAosTres.push(await lerCartoes(cliente.page))
  // The cards include OURS, which is first: `CallPanel` draws us alongside
  // the others. Three in the call give three cards on each screen.
  const tresOk = cartoesAosTres.every((cartoes) => cartoes.length === 3 && cartoes.every((c) => !c.pendente))
  verificar(
    "com TRÊS, cada um vê os outros dois ligados",
    tresOk,
    cartoesAosTres.map((c, i) => `${i}:[${c.map((x) => `${x.nome}=${x.pendente ? "a ligar" : "ligado"}`).join(" ")}]`).join("  "),
  )
  if (!tresOk) {
    console.error("\nSe já parte a três, o quarto não é a pergunta. Pára aqui.")
    process.exit(1)
  }

  // ------------------------------------------------------- 2. o QUARTO entra

  const quarto = clientes[3]
  await abrirCanal(quarto.page, SALA)
  const entrouOQuarto = await entrarNaChamada(quarto.page)
  verificar("o quarto entra na sala de voz", entrouOQuarto)
  if (!entrouOQuarto) process.exit(1)

  console.log("   quatro na chamada, a falar 15 s...")
  await dormir(15_000)

  const cartoes = []
  for (const cliente of clientes) cartoes.push(await lerCartoes(cliente.page))

  for (const [indice, lista] of cartoes.entries()) {
    console.log(
      `   voz ${indice} vê: ${lista.map((c) => `${c.nome}=${c.pendente ? "A LIGAR" : "ligado"}`).join(", ") || "(ninguém)"}`,
    )
  }

  verificar(
    "cada uma das quatro vê as outras três, mais o seu próprio cartão",
    cartoes.every((lista) => lista.length === QUANTOS),
    cartoes.map((lista) => lista.length).join(", "),
  )

  const aLigar = cartoes.flatMap((lista, indice) =>
    lista.filter((c) => c.pendente).map((c) => `voz ${indice} vê ${c.nome} a ligar`),
  )
  verificar('ninguém fica eternamente em "a ligar…"', aLigar.length === 0, aLigar.join("; "))

  // ---------------------------------------------------- 3. streams arriving

  const receptores = []
  for (const cliente of clientes) receptores.push(await cliente.page.evaluate(LER_RECEPTORES))
  verificar(
    "cada uma recebe TRÊS fluxos de voz",
    receptores.every((quantos) => quantos === 3),
    receptores.join(", "),
  )

  // ------------------------------------------------------ 4. a cifra a abrir

  for (const [indice, cliente] of clientes.entries()) {
    const registos = await lerSframe(cliente.page)
    const emissores = registos.filter((r) => r.papel === "emissor")
    const recebe = registos.filter((r) => r.papel === "receptor")
    console.log(
      `   voz ${indice}: cifrados ${emissores.reduce((s, e) => s + e.saida, 0)}  ·  ` +
        recebe.map((r) => `recebidos ${r.entrada}/abertos ${r.saida}`).join(" · "),
    )
  }

  const abertos = []
  for (const cliente of clientes) {
    const registos = await lerSframe(cliente.page)
    abertos.push(registos.filter((r) => r.papel === "receptor").filter((r) => r.saida > 0).length)
  }
  verificar(
    "cada uma ABRE os três fluxos que recebe",
    abertos.every((quantos) => quantos === 3),
    abertos.join(", "),
  )

  // ------------------------------------- 5. o socket do quarto cai e volta

  /*
   * **The fourth's network hiccups, and it is the most mundane case there is.**
   *
   * Wi-Fi switching access points, a laptop going to sleep, nginx reloading,
   * mobile network changing cells. The socket drops and the session reconnects
   * on its own-but the server, when the socket dies, drops EVERYTHING that
   * connection had in the media engine (`#largarMedia`, from `#drop`): scope,
   * transports and producers.
   *
   * The question is whether anyone on the client side rebuilds that path. If no
   * one does, the encrypted roster brings the person back on everyone else's
   * screen-presence heartbeat knows nothing of media-and they reappear with no
   * stream at all, which is how we draw someone who joined and has not spoken yet.
   */
  console.log("   a matar o homeserver...")
  matarPorNome("homeserver")
  await dormir(4000)
  if (!(await levantarServidor(dados, { comSfu: true }))) {
    console.error("FALHA  o homeserver não voltou a subir")
    process.exit(1)
  }
  console.log("   homeserver de volta; a esperar pelo batimento (até 120 s)...")
  await dormir(3000)
  const disseOServidor = (registoDoServidor[0] ?? []).join("")
  if (disseOServidor.trim()) console.log(`   o homeserver escreveu: ${disseOServidor.trim().slice(0, 600)}`)

  /*
   * Playwright's `setOffline` does NOT work here, and it was measured: with it
   * the test passed on both sides of the fix, which is the definition of a
   * measurement that measures nothing. An already established connection survives
   * it. Killing the server breaks all four sockets at once, which is what a
   * deploy or an outage does.
   *
   * We wait for the presence heartbeat, which is what puts people back in each
   * other's roster: `PRESENCA_REAFIRMADA_MS` is 50 s, and reconnection has its
   * own backoff before that.
   */
  let cartoesDepois = []
  // Warnings are captured AS THEY HAPPEN: a message on screen lasts seconds, and
  // reading the screen only at the end is reading after the news has disappeared.
  const avisos = clientes.map(() => new Set())
  for (let volta = 0; volta < 24; volta++) {
    await dormir(2500)
    cartoesDepois = []
    for (const [indice, cliente] of clientes.entries()) {
      cartoesDepois.push(await lerCartoes(cliente.page))
      for (const frase of await cliente.page.evaluate(LER_AVISOS)) avisos[indice].add(frase)
    }
    if (cartoesDepois.every((lista) => lista.length === QUANTOS && lista.every((c) => !c.pendente))) break
  }

  for (const [indice, lista] of cartoesDepois.entries()) {
    console.log(
      `   voz ${indice} vê depois da reconexão: ${lista.map((c) => `${c.nome}=${c.pendente ? "A LIGAR" : "ligado"}`).join(", ") || "(ninguém)"}`,
    )
    if (avisos[indice].size > 0) console.log(`      avisos no ecrã: ${JSON.stringify([...avisos[indice]])}`)
    const frames = await clientes[indice].page.evaluate(LER_FRAMES)
    const recusas = frames.filter((f) => f.t === "sfu.error" || f.t === "error")
    console.log(`      frames sfu depois da queda: ${frames.map((f) => `${f.lado === "enviado" ? ">" : "<"}${f.t}`).join(" ")}`)
    if (recusas.length > 0) console.log(`      recusas: ${JSON.stringify(recusas)}`)
  }

  verificar(
    "depois da reconexão, cada uma continua a VER as outras três",
    cartoesDepois.every((lista) => lista.length === QUANTOS),
    cartoesDepois.map((lista) => lista.length).join(", "),
  )
  const aLigarDepois = cartoesDepois.flatMap((lista, indice) =>
    lista.filter((c) => c.pendente).map((c) => `voz ${indice} vê ${c.nome} a ligar`),
  )
  verificar(
    "e a OUVI-LAS: o caminho de media refez-se com o socket",
    aLigarDepois.length === 0,
    aLigarDepois.join("; "),
  )

  // ------------------------------------------------------------- 6. o registo

  for (const [indice, cliente] of clientes.entries()) {
    const registo = await lerRegisto(cliente.page)
    if (!registo) continue
    const maus = registo.filter((linha) =>
      /sfu-consumo-falhou|oferta-de-malha|sem-cifra|entrada-falhou|presenca-caducou/.test(JSON.stringify(linha)),
    )
    if (maus.length > 0) console.log(`   voz ${indice} registou: ${JSON.stringify(maus).slice(0, 400)}`)
  }

  const falhas = resultados.filter((r) => !r.ok).length
  console.log(`\n${falhas === 0 ? "TUDO A PASSAR" : `${falhas} FALHA(S)`}  (${resultados.length} verificações)`)
  process.exitCode = falhas === 0 ? 0 : 1
} finally {
  for (const cliente of clientes) await cliente.ctx.close().catch(() => {})
  matarTudo()
  rmSync(dados, { recursive: true, force: true })
  rmSync(perfis, { recursive: true, force: true })
}
