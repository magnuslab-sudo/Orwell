// A real call, between two browsers, against production, instrumented.
//
// Answers ONE question with evidence, instead of by elimination: the call
// stays stuck at "connecting..." because ICE never connects (NAT traversal,
// which only TURN solves) or because ICE connects but media does not open
// (asymmetric SFrame)? These are different faults with different fixes, and
// from outside they look the same.
//
// Each page carries an `RTCPeerConnection` wrapped before the app starts,
// which logs everything that matters: state transitions, local and remote
// candidates by type, the selected pair, and whether `ontrack` fired.
//
//   node scripts/e2e-call.mjs [url]
import { chromium } from "playwright"
import { alvo } from "./ambiente.mjs"
import { criarContaEEntrar } from "./conta.mjs"

const URL = process.argv[2] ?? alvo(undefined)
const STAMP = Date.now().toString(36)

const results = []
const check = (label, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
}

/**
 * The instrument. Runs before any app script, wraps the constructor and leaves
 * everything in `window.__rtc` to read at the end.
 */
const PROBE = () => {
  window.__relayOnly = true
  const log = []
  window.__rtc = log
  const Original = window.RTCPeerConnection
  window.RTCPeerConnection = function (config, ...rest) {
    // RELAY-ONLY: drops host and srflx candidates and forces media through TURN.
    // Without this, two browsers on the same machine connect over the local network
    // (host/udp <-> host/udp) and the test passes without proving anything about
    // NAT traversal, which is exactly the real-world case for someone behind CGNAT.
    if (window.__relayOnly) config = { ...(config ?? {}), iceTransportPolicy: "relay" }
    const pc = new Original(config, ...rest)
    const entry = {
      config: JSON.parse(JSON.stringify(config ?? {})),
      states: [],
      ice: [],
      local: [],
      remote: [],
      tracks: 0,
      errors: [],
      pc,
    }
    log.push(entry)
    const note = (what) => entry.states.push(`${what}@${Math.round(performance.now())}ms`)
    pc.addEventListener("iceconnectionstatechange", () => note(`ice:${pc.iceConnectionState}`))
    pc.addEventListener("connectionstatechange", () => note(`conn:${pc.connectionState}`))
    pc.addEventListener("icegatheringstatechange", () => note(`gather:${pc.iceGatheringState}`))
    pc.addEventListener("signalingstatechange", () => note(`sig:${pc.signalingState}`))
    pc.addEventListener("icecandidate", (event) => {
      if (event.candidate) entry.local.push(event.candidate.candidate)
    })
    pc.addEventListener("track", () => {
      entry.tracks += 1
      note("ontrack")
    })
    const add = pc.addIceCandidate.bind(pc)
    pc.addIceCandidate = (candidate, ...more) => {
      entry.remote.push(typeof candidate === "string" ? candidate : (candidate?.candidate ?? ""))
      return add(candidate, ...more).catch((error) => {
        entry.errors.push(`addIceCandidate: ${error.message}`)
        throw error
      })
    }
    return pc
  }
  window.RTCPeerConnection.prototype = Original.prototype
}

/** Reads the instrument, including the selected ICE pair via getStats(). */
const READ_PROBE = async () => {
  const out = []
  for (const entry of window.__rtc ?? []) {
    const pc = entry.pc
    let selected = null
    let bytes = { in: 0, out: 0 }
    try {
      const stats = await pc.getStats()
      const pairs = []
      stats.forEach((report) => {
        if (report.type === "candidate-pair") pairs.push(report)
        if (report.type === "inbound-rtp") {
          bytes.in += report.bytesReceived ?? 0
          // What separates "traffic arrived" from "sound arrived": packets received is
          // transport, samples produced is media that the decoder actually managed to
          // open. With asymmetric SFrame, the first grows and the second stays at zero:
          // the call is connected but silent.
          bytes.packets = (bytes.packets ?? 0) + (report.packetsReceived ?? 0)
          bytes.samples = (bytes.samples ?? 0) + (report.totalSamplesReceived ?? 0)
          bytes.concealed = (bytes.concealed ?? 0) + (report.concealedSamples ?? 0)
          bytes.framesDecoded = (bytes.framesDecoded ?? 0) + (report.framesDecoded ?? 0)
        }
        if (report.type === "outbound-rtp") bytes.out += report.bytesSent ?? 0
      })
      const winner = pairs.find((pair) => pair.selected || pair.state === "succeeded")
      if (winner) {
        const local = stats.get(winner.localCandidateId)
        const remote = stats.get(winner.remoteCandidateId)
        selected = `${local?.candidateType ?? "?"}/${local?.protocol ?? "?"} ↔ ${remote?.candidateType ?? "?"}/${remote?.protocol ?? "?"}`
      }
    } catch (error) {
      entry.errors.push(`getStats: ${error.message}`)
    }
    const typesOf = (list) =>
      [...new Set(list.map((candidate) => (candidate.split(" ")[7] ?? "?")))].sort().join(",") || "nenhum"
    out.push({
      iceConnectionState: pc.iceConnectionState,
      connectionState: pc.connectionState,
      signalingState: pc.signalingState,
      iceGatheringState: pc.iceGatheringState,
      encodedInsertableStreams: entry.config?.encodedInsertableStreams === true,
      localTypes: typesOf(entry.local),
      remoteTypes: typesOf(entry.remote),
      localCount: entry.local.length,
      remoteCount: entry.remote.length,
      tracks: entry.tracks,
      selected,
      bytes,
      states: entry.states,
      errors: entry.errors,
    })
  }
  return out
}

const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
})

async function newPeer(name) {
  const context = await browser.newContext({ permissions: ["microphone", "camera"] })
  const page = await context.newPage()
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      console.log(`   [${name}] console: ${message.text().slice(0, 300)}`)
    }
  })
  page.on("pageerror", (error) => console.log(`   [${name}] pageerror: ${error.message.slice(0, 300)}`))
  await page.addInitScript(PROBE)
  await page.goto(URL, { waitUntil: "domcontentloaded" })
  await criarContaEEntrar(page, { nome: name, frase: "frase-de-teste-chamada", entrada: 60_000 })
  // The address lives in the profile, which is also where the app shows it to the user.
  await page.getByRole("button", { name: "Eu" }).click()
  const address = ((await page.locator(".me-address").first().getAttribute("title")) ?? "").trim()
  return { name, context, page, address }
}

const a = await newPeer(`Sonda A ${STAMP}`)
const b = await newPeer(`Sonda B ${STAMP}`)
console.log(`A = ${a.address}\nB = ${b.address}\n`)

// --- a shared room -----------------------------------------------
const room = `sala-${STAMP}`
await a.page.getByRole("button", { name: "Comunidades" }).click()
await a.page.getByRole("button", { name: "Criar canal" }).first().click()
await a.page.getByPlaceholder("geral").fill(room)
await a.page.getByRole("button", { name: "Confirmar" }).click()
await a.page.getByRole("heading", { name: room }).waitFor({ timeout: 30_000 })
check("A criou a sala", true, room)

await a.page.getByRole("button", { name: "Convidar" }).first().click()
await a.page.getByPlaceholder("@abc…:servidor").fill(b.address)
await a.page.getByRole("button", { name: "Confirmar" }).click()

await b.page.getByRole("button", { name: "Comunidades" }).click()
const joined = await b.page
  .getByRole("button", { name: new RegExp(room) })
  .first()
  .waitFor({ timeout: 60_000 })
  .then(() => true)
  .catch(() => false)
check("B recebeu o convite e vê a sala", joined)
if (!joined) {
  await browser.close()
  process.exit(1)
}
await b.page.getByRole("button", { name: new RegExp(room) }).first().click()
await b.page.getByRole("heading", { name: room }).waitFor({ timeout: 30_000 })

// A message first: proof that the channel is alive in both directions before
// blaming the call for anything.
await a.page.getByPlaceholder("Escreve uma mensagem").fill("olá da sonda A")
await a.page.getByPlaceholder("Escreve uma mensagem").press("Enter")
const heard = await b.page
  .getByText("olá da sonda A")
  .waitFor({ timeout: 45_000 })
  .then(() => true)
  .catch(() => false)
check("o canal entrega mensagens (a sala não está forkada)", heard)

// --- a chamada ---------------------------------------------------------------
const snapshot = async (peer, when) => {
  const info = await peer.page.evaluate(() => ({
    hasCall: !!document.querySelector("section.call"),
    toasts: [...document.querySelectorAll(".toast")].map((t) => (t.textContent ?? "").slice(0, 200)),
    rtc: (window.__rtc ?? []).length,
  }))
  console.log(`   [${peer.name}] ${when}: ${JSON.stringify(info)}`)
  return info
}

/**
 * The first to join decides whether the call works, and that is the bug.
 *
 * The `voice.join` that announces "I can do SFrame" is only heard by who is
 * already in the call. Who arrives later announces themselves and is heard;
 * who was already there only announces again if they have the HIGHER address
 * (this rule stops both from offering at once). So when the LOWER address joins
 * first, they never announce to the other: they offer immediately, encrypt the
 * media, and the other connects without even knowing they should decrypt.
 *
 * `ORDER=low-first` reproduces this case. `high-first` is the working case.
 */
const lowFirst = (process.env.ORDER ?? "low-first") !== "high-first"
const [first, second] = a.address < b.address === lowFirst ? [a, b] : [b, a]
console.log(
  `\nOrdem de entrada: ${first.name} (${first.address < second.address ? "endereço menor" : "endereço maior"}) primeiro\n`,
)

const enterCall = async (peer) => {
  await peer.page.getByRole("button", { name: "Chamada", exact: true }).first().click()
  await peer.page.waitForTimeout(800)
  await snapshot(peer, "800ms após clicar")
  await peer.page.waitForTimeout(3_000)
  check(`${peer.name} entrou na chamada`, (await snapshot(peer, "3,8s após clicar")).hasCall)
}

await enterCall(first)
await enterCall(second)

// Plenty of time: ICE for a connection that will actually connect closes in seconds.
await a.page.waitForTimeout(30_000)

const state = async (page) =>
  page
    .locator(".tile-state")
    .allInnerTexts()
    .catch(() => [])
console.log(`\nA vê: ${JSON.stringify(await state(a.page))}`)
console.log(`B vê: ${JSON.stringify(await state(b.page))}`)

for (const peer of [a, b]) {
  const probes = await peer.page.evaluate(READ_PROBE)
  console.log(`\n--- ${peer.name} — ${probes.length} RTCPeerConnection(s)`)
  for (const probe of probes) {
    console.log(JSON.stringify(probe, null, 2))
  }
  const live = probes.some((probe) => probe.connectionState === "connected")
  check(`${peer.name}: o ICE chegou a ligar`, live)
  const media = probes.some((probe) => probe.bytes.in > 0)
  check(`${peer.name}: chegou media do outro lado`, media)
}

await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} verificações passaram`)
process.exit(failed === 0 ? 0 : 1)
