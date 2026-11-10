import { describe, expect, it } from "vitest"
import { assinarPedido } from "@enclave/client-core"
import {
  generateIdentity,
  parseServerName,
  ROTAS_DA_DENUNCIA,
  signWithDevice,
  toBase64,
  mensagemDoPedido,
  type AccountIdentity,
} from "@enclave/protocol"
import { openDatabase } from "./db.js"
import { NoncesVistos, verificarPedidoAssinado } from "./pedido-assinado.js"
import { Store } from "./store.js"

/**
 * The signed request: the header that authenticates the abuse report routes without
 * a gateway session. Real identities, signed by the client core.
 */

const SERVIDOR = "localhost:8999"

function preparar(): { store: Store; identidade: AccountIdentity; nonces: NoncesVistos } {
  const store = new Store(openDatabase(":memory:"))
  const identidade = generateIdentity(parseServerName(SERVIDOR))
  store.registerOrVerifyAccount(identidade.address, identidade.signingPublicKey)
  return { store, identidade, nonces: new NoncesVistos() }
}

describe("verificarPedidoAssinado", () => {
  it("um pedido assinado por um aparelho com cadeia válida passa, com endereço e aparelho", () => {
    const { store, identidade, nonces } = preparar()
    const corpo = { motivo: "spam" }
    const pedido = assinarPedido(identidade, ROTAS_DA_DENUNCIA.enviar, corpo)
    const resultado = verificarPedidoAssinado(pedido, ROTAS_DA_DENUNCIA.enviar, { store, serverName: SERVIDOR, nonces })
    expect(resultado).toEqual({
      ok: true,
      endereco: identidade.address,
      aparelho: toBase64(identidade.deviceSigningPublicKey),
      corpo,
      coube: true,
    })
  })

  it("o mesmo pedido duas vezes é recusado à segunda", () => {
    const { store, identidade, nonces } = preparar()
    const pedido = assinarPedido(identidade, ROTAS_DA_DENUNCIA.enviar, {})
    const deps = { store, serverName: SERVIDOR, nonces }
    expect(verificarPedidoAssinado(pedido, ROTAS_DA_DENUNCIA.enviar, deps).ok).toBe(true)
    expect(verificarPedidoAssinado(pedido, ROTAS_DA_DENUNCIA.enviar, deps)).toEqual({ ok: false, razao: "replayed" })
  })

  it("emitido há 20 minutos é recusado", () => {
    const { store, identidade, nonces } = preparar()
    const agora = Date.now()
    const pedido = assinarPedido(identidade, ROTAS_DA_DENUNCIA.enviar, {}, agora - 20 * 60_000)
    expect(verificarPedidoAssinado(pedido, ROTAS_DA_DENUNCIA.enviar, { store, serverName: SERVIDOR, nonces, agora })).toEqual({
      ok: false,
      razao: "stale-request",
    })
    // And from the future too.
    const futuro = assinarPedido(identidade, ROTAS_DA_DENUNCIA.enviar, {}, agora + 20 * 60_000)
    expect(verificarPedidoAssinado(futuro, ROTAS_DA_DENUNCIA.enviar, { store, serverName: SERVIDOR, nonces, agora })).toEqual({
      ok: false,
      razao: "stale-request",
    })
  })

  it("endereço de outro servidor é recusado", () => {
    const { store, nonces } = preparar()
    const outra = generateIdentity(parseServerName("orwell.pt"))
    const pedido = assinarPedido(outra, ROTAS_DA_DENUNCIA.enviar, {})
    expect(verificarPedidoAssinado(pedido, ROTAS_DA_DENUNCIA.enviar, { store, serverName: SERVIDOR, nonces })).toEqual({
      ok: false,
      razao: "wrong-homeserver",
    })
  })

  it("assinatura de outro aparelho, cadeia inválida e aparelho revogado são recusados", () => {
    const { store, identidade, nonces } = preparar()
    const deps = { store, serverName: SERVIDOR, nonces }
    const intrusa = generateIdentity(parseServerName(SERVIDOR))

    // Signature from another device: the right message, the wrong key.
    const pedido = assinarPedido(identidade, ROTAS_DA_DENUNCIA.enviar, {})
    const { as: _as, v: _v, ...semAssinatura } = pedido
    const forjado = { ...pedido, as: toBase64(signWithDevice(intrusa, mensagemDoPedido(semAssinatura))) }
    expect(verificarPedidoAssinado(forjado, ROTAS_DA_DENUNCIA.enviar, deps)).toEqual({ ok: false, razao: "bad-signature" })

    // Invalid chain: another device's certificate, with the right account key.
    const outroCertificado = assinarPedido(identidade, ROTAS_DA_DENUNCIA.enviar, {})
    const cadeiaTorta = { ...outroCertificado, cadeia: { ...outroCertificado.cadeia, x: toBase64(intrusa.credential.signature) } }
    expect(verificarPedidoAssinado(cadeiaTorta, ROTAS_DA_DENUNCIA.enviar, deps)).toEqual({ ok: false, razao: "bad-device-cert" })

    // Account key that is not the one for the address.
    const chaveAlheia = { ...outroCertificado, cadeia: { ...outroCertificado.cadeia, k: toBase64(intrusa.signingPublicKey) } }
    expect(verificarPedidoAssinado(chaveAlheia, ROTAS_DA_DENUNCIA.enviar, deps)).toEqual({ ok: false, razao: "key-mismatch" })

    // Revoked device.
    const db = openDatabase(":memory:")
    const storeRevogado = new Store(db)
    storeRevogado.registerOrVerifyAccount(identidade.address, identidade.signingPublicKey)
    db.prepare("INSERT INTO revoked_devices (address, device_key, revoked_minute) VALUES (?, ?, ?)").run(
      identidade.address,
      toBase64(identidade.deviceSigningPublicKey),
      0,
    )
    const revogado = assinarPedido(identidade, ROTAS_DA_DENUNCIA.enviar, {})
    expect(
      verificarPedidoAssinado(revogado, ROTAS_DA_DENUNCIA.enviar, { store: storeRevogado, serverName: SERVIDOR, nonces }),
    ).toEqual({ ok: false, razao: "device-revoked" })
  })

  it("a conta registada com outra chave é recusada", () => {
    const store = new Store(openDatabase(":memory:"))
    const identidade = generateIdentity(parseServerName(SERVIDOR))
    store.registerOrVerifyAccount(identidade.address, identidade.deviceSigningPublicKey)
    const pedido = assinarPedido(identidade, ROTAS_DA_DENUNCIA.enviar, {})
    expect(
      verificarPedidoAssinado(pedido, ROTAS_DA_DENUNCIA.enviar, { store, serverName: SERVIDOR, nonces: new NoncesVistos() }),
    ).toEqual({ ok: false, razao: "key-mismatch" })
  })

  it("um endereço que nunca entrou é recusado, e a verificação não cria a conta", () => {
    const db = openDatabase(":memory:")
    const store = new Store(db)
    const identidade = generateIdentity(parseServerName(SERVIDOR))
    const pedido = assinarPedido(identidade, ROTAS_DA_DENUNCIA.enviar, {})
    expect(
      verificarPedidoAssinado(pedido, ROTAS_DA_DENUNCIA.enviar, { store, serverName: SERVIDOR, nonces: new NoncesVistos() }),
    ).toEqual({ ok: false, razao: "key-mismatch" })
    expect(store.signingKeyOf(identidade.address)).toBeUndefined()
    expect(db.prepare("SELECT COUNT(*) AS n FROM accounts").get()).toEqual({ n: 0 })
  })

  it("um corpo que o JSON canónico não codifica é malformed, sem lançar", () => {
    const { store, identidade, nonces } = preparar()
    const pedido = assinarPedido(identidade, ROTAS_DA_DENUNCIA.enviar, {})
    const infinito = { ...pedido, corpo: Infinity }
    expect(verificarPedidoAssinado(infinito, ROTAS_DA_DENUNCIA.enviar, { store, serverName: SERVIDOR, nonces })).toEqual({
      ok: false,
      razao: "malformed",
    })
    // As it arrives over the wire: JSON with 1e400.
    const doFio = JSON.parse(JSON.stringify(pedido).replace('"corpo":{}', '"corpo":1e400'))
    expect(doFio.corpo).toBe(Infinity)
    expect(verificarPedidoAssinado(doFio, ROTAS_DA_DENUNCIA.enviar, { store, serverName: SERVIDOR, nonces })).toEqual({
      ok: false,
      razao: "malformed",
    })
  })

  it("a rota assinada tem de ser a rota pedida", () => {
    const { store, identidade, nonces } = preparar()
    const pedido = assinarPedido(identidade, ROTAS_DA_DENUNCIA.caixa, {})
    expect(verificarPedidoAssinado(pedido, ROTAS_DA_DENUNCIA.enviar, { store, serverName: SERVIDOR, nonces })).toEqual({
      ok: false,
      razao: "wrong-route",
    })
  })

  it("lixo é malformed", () => {
    const { store, nonces } = preparar()
    expect(verificarPedidoAssinado({ v: 1 }, ROTAS_DA_DENUNCIA.enviar, { store, serverName: SERVIDOR, nonces })).toEqual({
      ok: false,
      razao: "malformed",
    })
  })
})

describe("NoncesVistos", () => {
  it("aceita um nonce uma vez, e esquece-o depois de duas janelas", () => {
    const nonces = new NoncesVistos(1000)
    expect(nonces.tentar("a", 0)).toBe(true)
    expect(nonces.tentar("a", 1500)).toBe(false)
    nonces.limpar(2001)
    expect(nonces.tentar("a", 2001)).toBe(true)
  })
})

describe("NoncesVistos: o tecto de tamanho", () => {
  it("cheio, recusa um nonce novo; depois de os expirados saírem, volta a aceitar", () => {
    const nonces = new NoncesVistos(1000, 3)
    expect(nonces.consumir("a", 0)).toBe(true)
    expect(nonces.consumir("b", 0)).toBe(true)
    expect(nonces.consumir("c", 500)).toBe(true)
    expect(nonces.tamanho).toBe(3)
    // Full, and nothing expired: refuse, like a replay.
    expect(nonces.livre("d", 1000)).toBe(false)
    expect(nonces.consumir("d", 1000)).toBe(false)
    expect(nonces.tamanho).toBe(3)
    // "a" and "b" expire after two windows; "c" does not yet.
    expect(nonces.consumir("d", 2001)).toBe(true)
    expect(nonces.tamanho).toBe(2)
    expect(nonces.consumir("c", 2001)).toBe(false)
  })

  it("verificarPedidoAssinado recusa como replayed com o mapa cheio, sem razão nova", () => {
    const { store, identidade } = preparar()
    const nonces = new NoncesVistos(undefined, 1)
    const deps = { store, serverName: SERVIDOR, nonces }
    expect(verificarPedidoAssinado(assinarPedido(identidade, ROTAS_DA_DENUNCIA.enviar, {}), ROTAS_DA_DENUNCIA.enviar, deps).ok).toBe(true)
    expect(verificarPedidoAssinado(assinarPedido(identidade, ROTAS_DA_DENUNCIA.enviar, {}), ROTAS_DA_DENUNCIA.enviar, deps)).toEqual({
      ok: false,
      razao: "replayed",
    })
  })

  it("o tecto da rota corre antes do consumo: recusado pelo tecto, o nonce não fica", () => {
    const { store, identidade, nonces } = preparar()
    const pedido = assinarPedido(identidade, ROTAS_DA_DENUNCIA.enviar, {})
    const recusado = verificarPedidoAssinado(pedido, ROTAS_DA_DENUNCIA.enviar, { store, serverName: SERVIDOR, nonces, tecto: () => false })
    expect(recusado).toMatchObject({ ok: true, coube: false })
    expect(nonces.tamanho).toBe(0)
    const aceite = verificarPedidoAssinado(pedido, ROTAS_DA_DENUNCIA.enviar, { store, serverName: SERVIDOR, nonces, tecto: () => true })
    expect(aceite).toMatchObject({ ok: true, coube: true })
    expect(nonces.tamanho).toBe(1)
    expect(verificarPedidoAssinado(pedido, ROTAS_DA_DENUNCIA.enviar, { store, serverName: SERVIDOR, nonces })).toEqual({
      ok: false,
      razao: "replayed",
    })
  })
})
