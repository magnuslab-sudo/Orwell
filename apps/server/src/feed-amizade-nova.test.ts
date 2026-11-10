import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { ate, contasDeTeste, desligarContas, levantarServidor, type ContaDeTeste, type ServidorDeTeste } from "../testes/cliente-de-teste.js"

/**
 * The wall right after a new friendship (October 26, 2026).
 *
 * The script `retratar-midnight.mjs` saw, in about 2 of 8 runs, Kaori's posts
 * missing from Vesna's wall when Kaori posted right after accepting. The
 * suspect was feed delivery: Vesna's seat not yet settled, the post in an epoch
 * before the seat, or the wall resend (`republishPosts`) losing the race.
 *
 * These tests pin the order of each case, with no timeouts left to chance. All
 * pass: the post reaches Vesna in every order, in under a second. The script's
 * failure came from the script itself (see the note in `retratar-midnight.mjs`),
 * and this stays as proof that feed delivery loses nothing in this window.
 *
 * The orders, from Kaori's side (the one who accepts and posts):
 * 1. posts BEFORE giving the seat: the post goes in an epoch without Vesna, and
 *    only the wall resend when the feed grows brings it to her;
 * 2. posts at the same time as accepting: the channel queue decides the order;
 * 3. posts after giving the seat, with Vesna offline: Vesna gets the Welcome
 *    and the post only when she is back, through recovery;
 * 4. posts after giving the seat, before Vesna opens the Welcome;
 * 5. posts after Vesna is in the feed.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  await servidor?.fechar()
})

/** Vesna asks, and the request reaches Kaori. Returns the DM. */
async function pedido(vesna: ContaDeTeste, kaori: ContaDeTeste): Promise<string> {
  const dm = await vesna.session.openDirect(kaori.address)
  await ate(() => kaori.session.channels.includes(dm), "a Kaori entra na directa")
  await vesna.session.sendFriendRequest(dm)
  await ate(() => kaori.session.friendTies().get(vesna.address)?.link === "pedido-recebido", "o pedido chega à Kaori")
  return dm
}

function temPublicacao(conta: ContaDeTeste, feed: string, titulo: string): boolean {
  return conta.session
    .history(feed)
    .some((entrada) => entrada.payload.t === "post" && entrada.payload["title"] === titulo)
}

const ORDENS = [
  "antes do lugar",
  "ao mesmo tempo que o aceite",
  "com a Vesna desligada",
  "antes do Welcome",
  "depois do Welcome",
] as const

describe("o mural logo a seguir a uma amizade nova", () => {
  for (const ordem of ORDENS) {
    it(`a Kaori publica ${ordem}, e a publicação chega à Vesna com o título`, async () => {
      const [vesna, kaori] = await contasDeTeste(servidor, ["Vesna", "Kaori"])
      abertas.push(vesna!, kaori!)
      const dm = await pedido(vesna!, kaori!)
      const feed = kaori!.session.feedChannel
      const aceitar = (): Promise<void> => kaori!.session.acceptFriend(dm, vesna!.address)
      const publicar = (titulo: string): Promise<string> => kaori!.session.post(`legenda de ${titulo}`, [], { title: titulo })

      switch (ordem) {
        case "antes do lugar":
          await publicar("Chuva em Shibuya")
          await publicar("Néon e vidro")
          await aceitar()
          break
        case "ao mesmo tempo que o aceite":
          await Promise.all([aceitar(), publicar("Chuva em Shibuya").then(() => publicar("Néon e vidro"))])
          break
        case "com a Vesna desligada":
          vesna!.session.disconnect()
          await aceitar()
          await publicar("Chuva em Shibuya")
          await publicar("Néon e vidro")
          await vesna!.session.connect()
          break
        case "antes do Welcome":
          await aceitar()
          // Without waiting for anything: the Welcome left, Vesna has not opened it yet.
          expect(vesna!.session.channels).not.toContain(feed)
          await publicar("Chuva em Shibuya")
          await publicar("Néon e vidro")
          break
        case "depois do Welcome":
          await aceitar()
          await ate(() => vesna!.session.channels.includes(feed), "a Vesna entra no feed da Kaori")
          await publicar("Chuva em Shibuya")
          await publicar("Néon e vidro")
          break
      }

      for (const titulo of ["Chuva em Shibuya", "Néon e vidro"]) {
        await ate(() => temPublicacao(vesna!, feed, titulo), `«${titulo}» chega à Vesna (${ordem})`, 10_000)
      }
      // And the friendship completes on both sides, as in the script.
      await ate(() => vesna!.session.friendTies().get(kaori!.address)?.link === "amigos", "a Vesna vê a amizade")
    }, 60_000)
  }
})
