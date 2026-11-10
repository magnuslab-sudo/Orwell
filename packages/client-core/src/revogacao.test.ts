import {
  generateIdentity,
  identityFromPrivateKey,
  parseServerName,
  toBase64,
  verifyDeviceManifest,
  type DeviceManifest,
  type DeviceManifestWire,
  type Payload,
} from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import {
  AVISOS_POR_REVOGADO,
  canaisAvisados,
  canaisComFalha,
  CONTAS_COM_REVOGADOS,
  esquecerRevogado,
  estaRevogado,
  lerRevogacao,
  notarAvisado,
  notarRevogado,
  payloadDeRevogacao,
  REVOGADOS_POR_CONTA,
  revogarAparelho,
  SEM_RESPOSTA,
  type CofreComAvisos,
  type CofreComRevogados,
  type SessaoParaRevogar,
} from "./revogacao.js"

/**
 * Revocation without relay: the session is a backdoor that records what gets asked of it.
 * What binds here is the ORDER and the REFUSALS: the manifest before channels,
 * the vault before channels, no channel forgotten by a failure in another, and the error
 * keys that the interface translates.
 *
 * What removing the leaf does to the epoch (the revoked device stops reading the next one,
 * the other continues) is proven with real MLS groups in
 * `packages/crypto/src/group.aparelhos.test.ts`, "Revogar um aparelho".
 */

const SERVIDOR = parseServerName("orwell.pt")
const computador = generateIdentity(SERVIDOR)
const telemovel = identityFromPrivateKey(computador.signingPrivateKey, SERVIDOR)
const outro = identityFromPrivateKey(computador.signingPrivateKey, SERVIDOR)
const TELEMOVEL = toBase64(telemovel.deviceSigningPublicKey)

function manifesto(version: number, aparelhos: { deviceSigningPublicKey: Uint8Array }[]): DeviceManifest {
  return {
    address: computador.address,
    version,
    devices: aparelhos.map((a, i) => ({ deviceKey: a.deviceSigningPublicKey, addedAt: i })),
    signedAt: version,
    accountKey: computador.signingPublicKey,
  }
}

class PortaFalsa implements SessaoParaRevogar {
  readonly address = computador.address
  chaveDeConta: Uint8Array | undefined = computador.signingPrivateKey
  readonly chaveDesteAparelho = computador.deviceSigningPublicKey
  servidorRevoga = true
  lido: { lido: true; manifesto: DeviceManifest | null } | { lido: false } = {
    lido: true,
    manifesto: manifesto(3, [computador, telemovel, outro]),
  }
  vista: number | undefined = 3
  veredicto: { ok: true } | { ok: false; reason: string } = { ok: true }
  canaisDaConta = ["!a:orwell.pt", "!b:orwell.pt", "!c:orwell.pt"]
  comFolha = new Set(["!a:orwell.pt", "!c:orwell.pt"])
  falhaAoTirar = new Set<string>()
  falhaAoEnviar = new Set<string>()
  readonly revogados = new Set<string>()
  readonly avisadosNoCofre = new Map<string, string[]>()
  /** Simulates the server accepting the manifest and the process dying before the response returns. */
  morrerDepoisDePublicar = false
  /** Everything that was requested, in order. */
  readonly passos: string[] = []
  readonly publicados: DeviceManifestWire[] = []
  /** The `revoke` list of each publication. */
  readonly revogacoesPedidas: (readonly string[])[] = []
  readonly enviados: { canal: string; payload: Payload }[] = []

  async lerManifestoProprio() {
    this.passos.push("ler")
    return this.lido
  }
  versaoVista() {
    return this.vista
  }
  async publicarManifesto(wire: DeviceManifestWire, revogar: readonly string[]) {
    this.passos.push(`publicar v${wire.version}`)
    this.publicados.push(wire)
    this.revogacoesPedidas.push(revogar)
    if (this.morrerDepoisDePublicar) {
      this.lido = { lido: true, manifesto: manifesto(wire.version, [computador, outro]) }
      throw new Error("o processo morreu")
    }
    return this.veredicto
  }
  canais() {
    return this.canaisDaConta
  }
  async tirarFolha(canal: string, aparelho: Uint8Array) {
    this.passos.push(`tirar ${canal}`)
    expect(toBase64(aparelho)).toBe(TELEMOVEL)
    if (this.falhaAoTirar.has(canal)) throw new Error("stale epoch")
    return this.comFolha.has(canal)
  }
  async enviar(canal: string, payload: Payload) {
    this.passos.push(`avisar ${canal}`)
    if (this.falhaAoEnviar.has(canal)) throw new Error("not a member of this channel")
    this.enviados.push({ canal, payload })
  }
  async lembrarRevogado(aparelho: string) {
    this.passos.push("cofre")
    this.revogados.add(aparelho)
  }
  async esquecerRevogado(aparelho: string) {
    this.passos.push("esquecer")
    this.revogados.delete(aparelho)
  }
  jaRevogado(aparelho: string) {
    return this.revogados.has(aparelho)
  }
  canaisAvisados(aparelho: string) {
    return this.avisadosNoCofre.get(aparelho) ?? []
  }
  async lembrarAvisado(aparelho: string, canal: string) {
    this.avisadosNoCofre.set(aparelho, [...(this.avisadosNoCofre.get(aparelho) ?? []), canal])
  }
}

async function erroDe(promessa: Promise<unknown>): Promise<Error> {
  try {
    await promessa
  } catch (erro) {
    return erro as Error
  }
  throw new Error("não lançou")
}

describe("revogarAparelho: o gesto, por ordem", () => {
  it("o cofre, depois o manifesto sem o aparelho, depois cada canal: folha e aviso", async () => {
    const porta = new PortaFalsa()
    const relatorio = await revogarAparelho(porta, TELEMOVEL, 1_790_000_000_000)

    // The vault BEFORE the manifest (I3): the mark that lets the retry resume.
    expect(porta.passos).toEqual([
      "ler",
      "cofre",
      "publicar v4",
      "tirar !a:orwell.pt",
      "avisar !a:orwell.pt",
      "tirar !b:orwell.pt",
      "avisar !b:orwell.pt",
      "tirar !c:orwell.pt",
      "avisar !c:orwell.pt",
    ])
    expect(relatorio).toEqual({
      versao: 4,
      tirada: ["!a:orwell.pt", "!c:orwell.pt"],
      avisados: ["!a:orwell.pt", "!b:orwell.pt", "!c:orwell.pt"],
      falhas: [],
    })
  })

  it("o manifesto publicado é da conta, sobe a versão, e leva os outros todos menos o revogado", async () => {
    const porta = new PortaFalsa()
    await revogarAparelho(porta, TELEMOVEL, 1_790_000_000_000)
    const lido = verifyDeviceManifest(porta.publicados[0])
    expect(lido.ok).toBe(true)
    if (!lido.ok) return
    expect(lido.manifest.address).toBe(computador.address)
    expect(lido.manifest.version).toBe(4)
    expect(lido.manifest.signedAt).toBe(1_790_000_000)
    expect(lido.manifest.devices.map((d) => toBase64(d.deviceKey))).toEqual([
      toBase64(computador.deviceSigningPublicKey),
      toBase64(outro.deviceSigningPublicKey),
    ])
    // And tells the server that it REVOKES, not just removes (I2): without this, the server
    // treats the exit as a cap cut on a 0.5.7.
    expect(porta.revogacoesPedidas).toEqual([[TELEMOVEL]])
  })

  it("a versão é a mais alta entre a vista no cofre e a do servidor, mais um", async () => {
    const porta = new PortaFalsa()
    porta.vista = 9
    await revogarAparelho(porta, TELEMOVEL)
    expect(porta.publicados[0]?.version).toBe(10)
    const outra = new PortaFalsa()
    outra.vista = undefined
    await revogarAparelho(outra, TELEMOVEL)
    expect(outra.publicados[0]?.version).toBe(4)
  })

  it("o aviso em cada canal é um device.revoke que os outros verificam contra a conta", async () => {
    const porta = new PortaFalsa()
    await revogarAparelho(porta, TELEMOVEL)
    const payload = porta.enviados[0]?.payload
    expect(payload?.t).toBe("device.revoke")
    if (payload?.t !== "device.revoke") return
    expect(payload.device).toBe(TELEMOVEL)
    expect(lerRevogacao(payload, computador.address, computador.signingPublicKey)).toEqual({ ok: true, aparelho: TELEMOVEL })
  })

  it("uma falha num canal não impede os outros, e fica no relatório", async () => {
    const porta = new PortaFalsa()
    porta.falhaAoTirar.add("!a:orwell.pt")
    porta.falhaAoEnviar.add("!b:orwell.pt")
    const relatorio = await revogarAparelho(porta, TELEMOVEL)
    expect(relatorio.tirada).toEqual(["!c:orwell.pt"])
    expect(relatorio.avisados).toEqual(["!a:orwell.pt", "!c:orwell.pt"])
    expect(relatorio.falhas).toEqual([
      { canal: "!a:orwell.pt", erro: "stale epoch" },
      { canal: "!b:orwell.pt", erro: "not a member of this channel" },
    ])
  })

  it("um canal que falha na folha e no aviso conta uma vez para a frase do 747", async () => {
    const porta = new PortaFalsa()
    porta.falhaAoTirar.add("!a:orwell.pt")
    porta.falhaAoEnviar.add("!a:orwell.pt")
    porta.falhaAoEnviar.add("!b:orwell.pt")
    const relatorio = await revogarAparelho(porta, TELEMOVEL)
    expect(relatorio.falhas).toHaveLength(3)
    expect(canaisComFalha(relatorio)).toEqual(["!a:orwell.pt", "!b:orwell.pt"])
  })

  it("retoma: já fora do manifesto e no cofre, não publica outra vez e segue para os canais", async () => {
    const porta = new PortaFalsa()
    porta.lido = { lido: true, manifesto: manifesto(4, [computador, outro]) }
    porta.revogados.add(TELEMOVEL)
    const relatorio = await revogarAparelho(porta, TELEMOVEL)
    expect(porta.publicados).toEqual([])
    expect(relatorio.versao).toBeNull()
    expect(relatorio.avisados).toHaveLength(3)
  })
})

describe("revogarAparelho: as recusas, antes de qualquer escrita", () => {
  async function recusa(mexer: (porta: PortaFalsa) => void, aparelho = TELEMOVEL) {
    const porta = new PortaFalsa()
    mexer(porta)
    const erro = await erroDe(revogarAparelho(porta, aparelho))
    // Nada saiu: nem manifesto, nem cofre, nem canais.
    expect(porta.publicados).toEqual([])
    expect(porta.revogados.size).toBe(0)
    expect(porta.enviados).toEqual([])
    return erro
  }

  it("sem a chave de conta (aparelho emparelhado)", async () => {
    expect((await recusa((p) => (p.chaveDeConta = undefined))).message).toBe("device-revoke-no-account-key")
  })

  it("contra um servidor que não anuncia a revogação", async () => {
    expect((await recusa((p) => (p.servidorRevoga = false))).message).toBe("device-revoke-unsupported")
  })

  it("uma chave que não é uma chave", async () => {
    const erro = await recusa(() => {}, "isto-nao")
    expect(erro.message).toBe("device-key-invalid")
    expect(erro.cause).toEqual({ device: "isto-nao" })
  })

  it("o próprio aparelho", async () => {
    const erro = await recusa(() => {}, toBase64(computador.deviceSigningPublicKey))
    expect(erro.message).toBe("device-revoke-self")
  })

  it("sem leitura do manifesto: não li não é não há", async () => {
    expect((await recusa((p) => (p.lido = { lido: false }))).message).toBe("device-revoke-manifest-unread")
  })

  it("um aparelho que não está no manifesto nem no cofre", async () => {
    const erro = await recusa((p) => (p.lido = { lido: true, manifesto: manifesto(3, [computador, outro]) }))
    expect(erro.message).toBe("device-not-in-manifest")
    expect(erro.cause).toEqual({ device: TELEMOVEL })
  })

  it("uma conta sem manifesto", async () => {
    expect((await recusa((p) => (p.lido = { lido: true, manifesto: null }))).message).toBe("device-not-in-manifest")
  })

  it("o servidor recusa o manifesto: a marca do cofre sai, e nada vai aos canais", async () => {
    const porta = new PortaFalsa()
    porta.veredicto = { ok: false, reason: "stale-version" }
    const erro = await erroDe(revogarAparelho(porta, TELEMOVEL))
    expect(erro.message).toBe("device-revoke-manifest-refused")
    expect(erro.cause).toEqual({ reason: "stale-version", version: 4 })
    expect(porta.passos).toEqual(["ler", "cofre", "publicar v4", "esquecer"])
    expect(porta.revogados.size).toBe(0)
    expect(porta.enviados).toEqual([])
  })
})

/**
 * I3 and M6 from the revision of slot 1: an interrupted revocation resumes.
 *
 * Before, the vault was saved only after the server accepted the manifest. A crash between
 * the two left the device out of the manifest and out of the vault: retry threw
 * `device-not-in-manifest`, and the leaves stayed in all channels, reading.
 */
describe("revogarAparelho: interrompida, retoma", () => {
  it("o servidor aceitou e o processo morreu antes da resposta: a repetição segue para os canais", async () => {
    const porta = new PortaFalsa()
    porta.morrerDepoisDePublicar = true
    expect((await erroDe(revogarAparelho(porta, TELEMOVEL))).message).toBe("o processo morreu")
    // Out of the manifest on the server, and in the vault: the mark that was missing.
    expect(porta.revogados.has(TELEMOVEL)).toBe(true)
    expect(porta.enviados).toEqual([])

    porta.morrerDepoisDePublicar = false
    const relatorio = await revogarAparelho(porta, TELEMOVEL)
    expect(porta.publicados).toHaveLength(1)
    expect(relatorio.versao).toBeNull()
    expect(relatorio.tirada).toEqual(["!a:orwell.pt", "!c:orwell.pt"])
    expect(relatorio.avisados).toEqual(["!a:orwell.pt", "!b:orwell.pt", "!c:orwell.pt"])
  })

  it("sem resposta do servidor: a marca fica, e a repetição decide pelo manifesto que ler", async () => {
    const porta = new PortaFalsa()
    porta.veredicto = { ok: false, reason: SEM_RESPOSTA }
    const erro = await erroDe(revogarAparelho(porta, TELEMOVEL))
    expect(erro.cause).toEqual({ reason: SEM_RESPOSTA, version: 4 })
    expect(porta.revogados.has(TELEMOVEL)).toBe(true)
    // The server had not accepted it: retry still reads it in the list and publishes.
    porta.veredicto = { ok: true }
    const relatorio = await revogarAparelho(porta, TELEMOVEL)
    expect(relatorio.versao).toBe(4)
    expect(porta.passos.filter((passo) => passo === "cofre")).toHaveLength(1)
    expect(relatorio.avisados).toHaveLength(3)
  })

  it("os canais já avisados não recebem outro device.revoke (M6), e a folha tenta-se em todos", async () => {
    const porta = new PortaFalsa()
    porta.falhaAoEnviar.add("!b:orwell.pt")
    porta.falhaAoTirar.add("!c:orwell.pt")
    const primeira = await revogarAparelho(porta, TELEMOVEL)
    expect(primeira.avisados).toEqual(["!a:orwell.pt", "!c:orwell.pt"])
    expect(porta.canaisAvisados(TELEMOVEL)).toEqual(["!a:orwell.pt", "!c:orwell.pt"])

    // The server already has the manifest without the mobile device.
    porta.lido = { lido: true, manifesto: manifesto(4, [computador, outro]) }
    porta.falhaAoEnviar.clear()
    porta.falhaAoTirar.clear()
    porta.comFolha.delete("!a:orwell.pt")
    porta.passos.length = 0
    const segunda = await revogarAparelho(porta, TELEMOVEL)
    expect(segunda.versao).toBeNull()
    expect(segunda.avisados).toEqual(["!b:orwell.pt"])
    expect(segunda.tirada).toEqual(["!c:orwell.pt"])
    expect(porta.passos.filter((passo) => passo.startsWith("avisar"))).toEqual(["avisar !b:orwell.pt"])
    expect(porta.passos.filter((passo) => passo.startsWith("tirar"))).toHaveLength(3)
  })
})

describe("lerRevogacao: quem recebe julga pela chave de conta", () => {
  const payload = payloadDeRevogacao(computador.signingPrivateKey, computador.address, telemovel.deviceSigningPublicKey, 1)

  it("assinada pela conta do remetente, vale", () => {
    expect(lerRevogacao(payload, computador.address, computador.signingPublicKey)).toEqual({ ok: true, aparelho: TELEMOVEL })
  })

  it("sem a chave de conta do remetente, não vale", () => {
    expect(lerRevogacao(payload, computador.address, undefined)).toEqual({ ok: false, razao: "no-account-key" })
  })

  it("assinada pelo APARELHO e não pela conta, não vale: um aparelho não revoga os irmãos", () => {
    const doAparelho = payloadDeRevogacao(
      telemovel.deviceSigningPrivateKey,
      computador.address,
      computador.deviceSigningPublicKey,
      1,
    )
    expect(lerRevogacao(doAparelho, computador.address, computador.signingPublicKey)).toEqual({
      ok: false,
      razao: "bad-signature",
    })
  })

  it("posta na boca de outra conta, não vale", () => {
    const bento = generateIdentity(SERVIDOR)
    expect(lerRevogacao(payload, bento.address, bento.signingPublicKey).ok).toBe(false)
    // Not even with the right key and swapped address: the address is in the signature.
    expect(lerRevogacao(payload, bento.address, computador.signingPublicKey)).toEqual({ ok: false, razao: "bad-signature" })
  })

  it("uma chave de aparelho mal formada não lança", () => {
    expect(lerRevogacao({ ...payload, device: "x" }, computador.address, computador.signingPublicKey)).toEqual({
      ok: false,
      razao: "bad-device-key",
    })
  })
})

describe("o cofre: revokedDevices", () => {
  it("guarda por conta, e repetir não muda nada", () => {
    const cofre: CofreComRevogados = {}
    expect(notarRevogado(cofre, "@a:x", "K1")).toBe(true)
    expect(notarRevogado(cofre, "@a:x", "K1")).toBe(false)
    expect(estaRevogado(cofre, "@a:x", "K1")).toBe(true)
    expect(estaRevogado(cofre, "@b:x", "K1")).toBe(false)
    expect(estaRevogado({}, "@a:x", "K1")).toBe(false)
  })

  it("sobrevive a uma volta por JSON, que é como o cofre grava", () => {
    const cofre: CofreComRevogados = {}
    notarRevogado(cofre, "@a:x", "K1")
    expect(estaRevogado(JSON.parse(JSON.stringify(cofre)) as CofreComRevogados, "@a:x", "K1")).toBe(true)
  })

  it("tem tecto por conta e por número de contas, e corta as mais antigas", () => {
    const cofre: CofreComRevogados = {}
    for (let i = 0; i < REVOGADOS_POR_CONTA + 3; i++) notarRevogado(cofre, "@a:x", `K${i}`)
    expect(cofre.revokedDevices?.["@a:x"]).toHaveLength(REVOGADOS_POR_CONTA)
    expect(estaRevogado(cofre, "@a:x", "K0")).toBe(false)
    expect(estaRevogado(cofre, "@a:x", `K${REVOGADOS_POR_CONTA + 2}`)).toBe(true)
    for (let i = 0; i < CONTAS_COM_REVOGADOS + 1; i++) notarRevogado(cofre, `@c${i}:x`, "K")
    expect(Object.keys(cofre.revokedDevices ?? {})).toHaveLength(CONTAS_COM_REVOGADOS)
    expect(estaRevogado(cofre, "@a:x", `K${REVOGADOS_POR_CONTA + 2}`)).toBe(false)
  })
})

describe("o cofre: desfazer a marca e lembrar os canais avisados (I3, M6)", () => {
  it("esquecerRevogado tira só aquele aparelho, e a conta sem nenhum sai do mapa", () => {
    const cofre: CofreComRevogados = {}
    notarRevogado(cofre, "@a:x", "K1")
    notarRevogado(cofre, "@a:x", "K2")
    expect(esquecerRevogado(cofre, "@a:x", "K1")).toBe(true)
    expect(estaRevogado(cofre, "@a:x", "K1")).toBe(false)
    expect(estaRevogado(cofre, "@a:x", "K2")).toBe(true)
    expect(esquecerRevogado(cofre, "@a:x", "K1")).toBe(false)
    esquecerRevogado(cofre, "@a:x", "K2")
    expect(cofre.revokedDevices).toEqual({})
    expect(esquecerRevogado({}, "@a:x", "K1")).toBe(false)
  })

  it("os canais avisados guardam-se por aparelho, sem repetir, com tecto", () => {
    const cofre: CofreComAvisos = {}
    expect(notarAvisado(cofre, "K1", "!a:x")).toBe(true)
    expect(notarAvisado(cofre, "K1", "!a:x")).toBe(false)
    notarAvisado(cofre, "K1", "!b:x")
    expect(canaisAvisados(cofre, "K1")).toEqual(["!a:x", "!b:x"])
    expect(canaisAvisados(cofre, "K2")).toEqual([])
    for (let i = 0; i < AVISOS_POR_REVOGADO + 2; i++) notarAvisado(cofre, "K3", `!c${i}:x`)
    expect(canaisAvisados(cofre, "K3")).toHaveLength(AVISOS_POR_REVOGADO)
    expect(canaisAvisados(JSON.parse(JSON.stringify(cofre)) as CofreComAvisos, "K1")).toEqual(["!a:x", "!b:x"])
  })
})
