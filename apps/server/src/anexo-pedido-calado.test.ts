import { Session, Vault } from "@enclave/client-core"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  CofreEmMemoria,
  contasDeTeste,
  desligarContas,
  emparelharAparelho,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * Asking for an image from someone who has it and is connected (1.3.7).
 *
 * The report: «Nenhum membro com esta imagem está ligado agora», with the person
 * connected. The ability to answer was only learned from a device signal IN
 * THIS channel, and only in memory: whoever asked after reloading, of someone
 * who had the image and was quiet in the channel, had no candidate at all and
 * heard "nobody" at once.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []
const sessoes: Session[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
  for (const sessao of sessoes.splice(0)) sessao.disconnect()
})

afterAll(async () => {
  await servidor?.fechar()
})

const IMAGEM = `data:image/png;base64,${"iVBORw0KGgoAAAANSUhEUg".repeat(200)}`
const publicacao = (id: string) =>
  ({
    t: "post",
    id,
    postedAt: Date.now(),
    caption: "com fotografia",
    media: [{ name: "foto.png", mediaType: "image/png", byteLength: 3300, inline: IMAGEM }],
    links: [],
    tags: [],
  }) as never

const tem = (session: Session, canal: string, id: string): boolean => session.history(canal).some((e) => e.payload["id"] === id)

/** The same account, reopened from the vault: the memory of capabilities starts empty. */
async function recarregar(conta: ContaDeTeste): Promise<Session> {
  conta.session.disconnect()
  const backend = new CofreEmMemoria()
  backend.bytes = conta.backend.bytes
  const vault = new Vault(backend)
  await vault.unlock("frase-passe-de-teste")
  const session = new Session(vault)
  session.loadIdentity()
  await session.connect()
  sessoes.push(session)
  return session
}

/** Ana posts an image and leaves; Bruno seats Carla, who receives it without bytes. */
async function cenario(): Promise<{ canal: string; id: string; bruno: ContaDeTeste; carla: ContaDeTeste; ana: ContaDeTeste }> {
  const [ana, bruno, carla] = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"])
  abertas.push(ana!, bruno!, carla!)
  const canal = await canalComTodos(servidor, ana!, [bruno!])
  const id = crypto.randomUUID()
  await ana!.session.send(canal, publicacao(id))
  await ate(() => tem(bruno!.session, canal, id), "o Bruno tem a imagem")
  ana!.session.disconnect()
  await bruno!.session.seat(canal, carla!.address)
  await ate(() => tem(carla!.session, canal, id), "a publicação chega à Carla, sem bytes", 30_000)
  return { canal, id, ana: ana!, bruno: bruno!, carla: carla! }
}

describe("pedir uma imagem a quem a tem e está ligado", () => {
  it("quem pede acabou de recarregar, e quem a tem está calado no canal: a imagem chega", async () => {
    const { canal, id, carla } = await cenario()
    const recarregada = await recarregar(carla)
    await ate(() => recarregada.connection === "online" && tem(recarregada, canal, id), "a Carla recarregada vê a publicação")
    const desfecho = await recarregada.pedirAnexo(canal, id, 0)
    expect(desfecho).toMatchObject({ ok: true })
    if (desfecho.ok) expect(desfecho.anexo["inline"]).toBe(IMAGEM)
  }, 180_000)

  it("quem a tem é o telemóvel do Bruno: chega por ele, e depois de ele voltar ao primeiro plano também", async () => {
    const [ana, bruno, carla] = await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"])
    abertas.push(ana!, bruno!, carla!)
    const telemovel = await emparelharAparelho(bruno!)
    abertas.push(telemovel)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    await ate(() => telemovel.session.channels.includes(canal), "o telemóvel do Bruno está no canal", 60_000)
    const id = crypto.randomUUID()
    await ana!.session.send(canal, publicacao(id))
    await ate(() => tem(telemovel.session, canal, id), "o telemóvel tem a imagem", 30_000)
    ana!.session.disconnect()
    await bruno!.session.seat(canal, carla!.address)
    await ate(() => tem(carla!.session, canal, id), "a publicação chega à Carla", 30_000)
    bruno!.session.disconnect()
    const recarregada = await recarregar(carla!)
    await ate(() => tem(recarregada, canal, id), "a Carla recarregada vê a publicação")

    // The phone away (the page suspended): nobody has it, and the answer is honest.
    telemovel.session.disconnect()
    await ate(() => telemovel.session.connection === "offline", "o telemóvel desligado")
    expect(await recarregada.pedirAnexo(canal, id, 0)).toMatchObject({ ok: false, motivo: "ninguem" })

    // The phone comes back (the page wakes up and connects), and the image arrives through it.
    await telemovel.session.connect()
    await ate(() => telemovel.session.connection === "online", "o telemóvel ligado outra vez")
    const desfecho = await recarregada.pedirAnexo(canal, id, 0)
    expect(desfecho).toMatchObject({ ok: true })
  }, 240_000)
})
