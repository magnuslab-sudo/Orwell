import { ed25519 } from "@noble/curves/ed25519.js"
import { z } from "zod"
import { canonicalBytes, fromBase64, toBase64 } from "./canonical.js"
import { APARELHOS_POR_CONTA, verify } from "./identity.js"
import { accountIdFromSigningKey, parseAddress, type UserAddress } from "./ids.js"

/**
 * The device manifest: the list, signed by the ACCOUNT key, of device keys
 * that speak for it.
 *
 * It's the new security piece of multi-device (docs/PLANO_MULTIDISPOSITIVO.md,
 * §2.2). The server stores it and serves the most recent one it has, but does
 * not sign it: it can't add a device, remove one, or invent one from scratch.
 * What it can do is serve an OLD one, before a revocation, to someone who never
 * saw the new one. That's why the version is monotonic and whoever reads stores
 * the highest one they've seen per address, in the vault, and refuses anything
 * that goes back. The rest of that weakness is laid out in
 * docs/THREAT-MODEL.md, not here.
 *
 * **It works outside any group, on purpose.** Channel roles (`role.define`)
 * travel inside MLS, authenticated by the credential of whoever sends them; the
 * manifest is read by someone who doesn't yet share any group with the account,
 * when they're about to invite them and need to know which devices to admit. It
 * has to stand alone: account signature, and the address is the hash of that
 * key, like in `verifyDeviceChain`.
 *
 * **It does not carry device certificates.** The manifest signature is the
 * account saying "these keys are mine", which is exactly what a per-device
 * certificate would say, with the same key. The certificate is still needed
 * where the device key appears alone, which is in the MLS leaf, and that's where
 * it gets verified: the key package brings the credential with the full chain
 * (`decodeDeviceCredential` + `verifyDeviceChain`), and whoever invites checks
 * that the `deviceKey` of that credential is in this manifest. Two signatures
 * from the same key over the same fact wouldn't give more guarantee than one.
 *
 * **The wire form is JSON with bytes in base64url**, and the signature covers
 * the canonical form (`canonicalBytes`) of the unsigned fields, with a context
 * at the start so no other account signature can be replayed as a manifest.
 * It's the `signEnvelope` pattern, in the federation, plus the context from
 * `deviceCertMessage`.
 */

/** Ed25519 public keys of 32 bytes: 43 base64url characters without padding. */
const Chave = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "expected a 32-byte key in base64url")
/** Ed25519 signatures of 64 bytes: 86 characters. */
const Assinatura = z.string().regex(/^[A-Za-z0-9_-]{86}$/, "expected a 64-byte signature in base64url")

/**
 * The wire form: `manifest.publish`, `manifest.result`, and the row in the
 * `device_manifests` table. Zod, so the server and client refuse the malformed
 * BEFORE verifying it, and the refusal is the same both ways.
 */
/**
 * The highest version a manifest can have.
 *
 * Without a cap, `Number.MAX_SAFE_INTEGER` would be a valid version: once
 * published (the account can, it's signing), the server would never take another
 * and each reader who saw it would store it as an anchor and refuse everything
 * else forever. An account would lock itself for good. A million is a thousand
 * pairings and revocations a day for almost three years; a server or client that
 * receives more than this refuses on shape, before the signature, and both
 * refuse the same.
 */
export const VERSAO_MAXIMA = 1_000_000

export const DeviceManifestWire = z.object({
  address: z.string().min(3).max(255),
  /** Starts at 1, only goes up, never exceeds `VERSAO_MAXIMA`. */
  version: z.number().int().positive().max(VERSAO_MAXIMA),
  devices: z
    .array(
      z.object({
        deviceKey: Chave,
        /** Unix seconds when the account added this device. Informational. */
        addedAt: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(APARELHOS_POR_CONTA),
  /** Unix seconds. Informational: order is by `version`, not the clock. */
  signedAt: z.number().int().nonnegative(),
  /** The account key that signed, so the verifier doesn't have to fetch it. */
  accountKey: Chave,
  /** Ed25519 from the account over `deviceManifestMessage` of the fields above, minus `accountKey`. */
  signature: Assinatura,
})
export type DeviceManifestWire = z.infer<typeof DeviceManifestWire>

/** The verified manifest, with keys in bytes. */
export interface DeviceManifest {
  readonly address: UserAddress
  readonly version: number
  readonly devices: readonly { readonly deviceKey: Uint8Array; readonly addedAt: number }[]
  readonly signedAt: number
  readonly accountKey: Uint8Array
}

/** What gets signed: everything except the signature and the key that made it. */
interface SemAssinatura {
  address: string
  version: number
  devices: { deviceKey: string; addedAt: number }[]
  signedAt: number
}

/**
 * What the account signs to publish a manifest.
 *
 * Its own context, for the same reason as the certificate and revocation: a
 * certificate, a revocation, and a manifest are three different things that
 * the same key signs, and none can be read as another. Canonical JSON starts
 * with `{` and the other two start with a 32-byte key, so they already don't
 * collide; context is what makes that a rule instead of luck.
 */
export function deviceManifestMessage(unsigned: SemAssinatura): Uint8Array {
  const context = new TextEncoder().encode("orwell:device-manifest:v1\0")
  const body = canonicalBytes(unsigned)
  const message = new Uint8Array(context.length + body.length)
  message.set(context, 0)
  message.set(body, context.length)
  return message
}

function semAssinatura(wire: Omit<DeviceManifestWire, "accountKey" | "signature">): SemAssinatura {
  return {
    address: wire.address,
    version: wire.version,
    devices: wire.devices.map((device) => ({ deviceKey: device.deviceKey, addedAt: device.addedAt })),
    signedAt: wire.signedAt,
  }
}

/**
 * The next manifest's list: what was there, plus the new keys, capped at the
 * limit, **and this device itself never leaves the cap**.
 *
 * Publishing a manifest without the key of whoever signed it is the account
 * hiding from itself: the inviter stops admitting this device, it stops being
 * added to new channels, and on the next connection it gets added back and
 * kicks out another. If the kicked one is a paired device, it has no account
 * key to recover with and no revocation can bring it back: the account loses a
 * device by ordering mistake.
 *
 * That's why the cap applies to OTHERS: this device steps aside, the others
 * order by oldest and the newest ones stay until the cap is hit. The final
 * order is always by `addedAt`, which is what the manifest shows.
 *
 * This is the last resort, not where the cap is enforced: whoever adds a device
 * refuses BEFORE signing anything when the account is full (`emparelhar.ts`,
 * `confirmarEspaco`). Removing a device is revocation (`aparelhosSemORevogado`),
 * and the server treats what this cap leaves out as revoked: a device cut here
 * never gets back in.
 */
export function aparelhosDoManifestoSeguinte(
  existentes: readonly { readonly deviceKey: Uint8Array; readonly addedAt: number }[],
  novas: readonly Uint8Array[],
  proprio: Uint8Array,
  agora: number,
): { deviceKey: Uint8Array; addedAt: number }[] {
  const jaLa = new Set(existentes.map((device) => toBase64(device.deviceKey)))
  const todos = [
    ...existentes.map((device) => ({ deviceKey: device.deviceKey, addedAt: device.addedAt })),
    ...novas.filter((chave) => !jaLa.has(toBase64(chave))).map((deviceKey) => ({ deviceKey, addedAt: agora })),
  ]
  const meu = toBase64(proprio)
  const outros = todos.filter((device) => toBase64(device.deviceKey) !== meu)
  // `slice(-0)` would return the whole list, not none: zero needs special handling.
  const lugares = Math.max(0, APARELHOS_POR_CONTA - (todos.length - outros.length))
  const ficam = new Set(
    (lugares === 0 ? [] : [...outros].sort((a, b) => a.addedAt - b.addedAt).slice(-lugares)).map((device) =>
      toBase64(device.deviceKey),
    ),
  )
  // Filter `todos` (don't concatenate two lists) so tied order stays the same:
  // what was there before what comes now. Two devices added in the same second
  // have the same `addedAt`, and a stable sort on a different starting order
  // would give a different manifest.
  return todos
    .filter((device) => {
      const chave = toBase64(device.deviceKey)
      return chave === meu || ficam.has(chave)
    })
    .sort((a, b) => a.addedAt - b.addedAt)
}

/**
 * The server refuses login, claim, and packet publishing from a device the
 * account removed from the manifest, and refuses a manifest that puts it back.
 *
 * Absent is NO, like other capabilities: against a server that doesn't announce
 * it, revocation takes the leaf out of channels and publishes the manifest
 * anyway, but the revoked device can still connect and add itself again (if it
 * has the account key). Whoever revokes must say so.
 *
 * Lives here, not in `wire.ts`, because it's the rule the manifest announces.
 */
export const CAPACIDADE_REVOGACAO = "device-revocation"

/**
 * The device keys that were in `anterior` and are not in `seguinte`.
 *
 * Leaving the manifest is NOT being revoked, and the difference is backward
 * compatibility: a 0.5.7 client with the account key and a full manifest cuts
 * the oldest device by the cap (`aparelhosDoManifestoSeguinte`), with no intent
 * to revoke anyone. See `aparelhosRevogados`, which is what the server records.
 *
 * Without `anterior` (the account's first manifest), nothing leaves.
 */
export function aparelhosRetirados(
  anterior: Pick<DeviceManifestWire, "devices"> | null,
  seguinte: Pick<DeviceManifestWire, "devices">,
): string[] {
  if (anterior === null) return []
  const ficam = new Set(seguinte.devices.map((device) => device.deviceKey))
  return anterior.devices.map((device) => device.deviceKey).filter((chave) => !ficam.has(chave))
}

/**
 * The `revoke` list of a `manifest.publish`: the keys the publisher says it
 * revokes. Optional on the wire; a 0.5.7 client doesn't send it.
 */
export const RevogadosNoManifesto = z.array(Chave).max(APARELHOS_POR_CONTA)

/**
 * What a new manifest revokes: what left (`aparelhosRetirados`) AND what the
 * publisher says it revokes (`pedidos`, the `revoke` list of `manifest.publish`).
 *
 * Both halves count. Without the first, a request could revoke a device the new
 * manifest still lists. Without the second, a 0.5.7 client's cap cut would
 * become permanent revocation: the cut device would stay locked out of the
 * account, when before it only left the manifest and came back on the next
 * connection (revision of wave 1 of phase 5, I2).
 *
 * `pedidos` doesn't go signed, and doesn't need to: it only reaches the server
 * in a frame with a new manifest signed by the account, which only whoever has
 * the account key does.
 */
export function aparelhosRevogados(
  anterior: Pick<DeviceManifestWire, "devices"> | null,
  seguinte: Pick<DeviceManifestWire, "devices">,
  pedidos: readonly string[] | undefined,
): string[] {
  if (pedidos === undefined || pedidos.length === 0) return []
  const pedidas = new Set(pedidos)
  return aparelhosRetirados(anterior, seguinte).filter((chave) => pedidas.has(chave))
}

/**
 * The next manifest's list after revocation: what there was, without `revogado`.
 *
 * Throws, doesn't return empty, in both cases where revoking makes no sense:
 * `revogado` is the device itself that signs (a device doesn't remove itself:
 * that leaves an account hiding from itself, see `aparelhosDoManifestoSeguinte`),
 * or `revogado` is not in the list (already left, or never was there). Error
 * keys are stable and in English; the interface translates.
 */
export function aparelhosSemORevogado(
  existentes: readonly { readonly deviceKey: Uint8Array; readonly addedAt: number }[],
  revogado: Uint8Array,
  proprio: Uint8Array,
): { deviceKey: Uint8Array; addedAt: number }[] {
  const chave = toBase64(revogado)
  if (chave === toBase64(proprio)) throw new Error("device-revoke-self", { cause: { device: chave } })
  if (!existentes.some((device) => toBase64(device.deviceKey) === chave)) {
    throw new Error("device-not-in-manifest", { cause: { device: chave } })
  }
  return existentes
    .filter((device) => toBase64(device.deviceKey) !== chave)
    .map((device) => ({ deviceKey: device.deviceKey, addedAt: device.addedAt }))
}

/**
 * Sign a manifest with the ACCOUNT key.
 *
 * The caller already picked the version: they have the previous one in the
 * vault, and the rule is "the last I saw, plus one". Here we bind only what
 * doesn't depend on context: the list can't be empty (an account with no
 * devices publishes nothing), can't exceed the cap, and can't repeat keys.
 */
export function signDeviceManifest(
  accountPrivateKey: Uint8Array,
  fields: {
    address: UserAddress
    version: number
    devices: { deviceKey: Uint8Array; addedAt: number }[]
    signedAt: number
  },
): DeviceManifestWire {
  const accountKey = ed25519.getPublicKey(accountPrivateKey)
  const unsigned = semAssinatura({
    address: fields.address,
    version: fields.version,
    devices: fields.devices.map((device) => ({ deviceKey: toBase64(device.deviceKey), addedAt: device.addedAt })),
    signedAt: fields.signedAt,
  })
  // The shape is checked on the way out by the same template that checks it on
  // the way in: a manifest this side wouldn't accept shouldn't leave here signed.
  const conferido = DeviceManifestWire.omit({ accountKey: true, signature: true }).parse(unsigned)
  if (new Set(conferido.devices.map((device) => device.deviceKey)).size !== conferido.devices.length) {
    throw new Error("manifesto com a mesma chave de aparelho duas vezes")
  }
  const signature = ed25519.sign(deviceManifestMessage(conferido), accountPrivateKey)
  return { ...conferido, accountKey: toBase64(accountKey), signature: toBase64(signature) }
}

/**
 * Why a manifest was refused. Each reason is a different gate, and whoever gets
 * the refusal (the client that published, a test) needs to know which.
 *
 * - `bad-shape`: not a manifest: field missing, device extra, version is zero.
 *   Refused before verifying anything.
 * - `duplicate-device`: the same device key twice.
 * - `key-mismatch`: the address is not the hash of the account key that signed.
 *   It's the gate of `verifyDeviceChain`, and it stops an account from
 *   publishing a manifest in another account's name.
 * - `bad-signature`: the signature doesn't close over the fields.
 */
export type ManifestoRecusado = {
  ok: false
  reason: "bad-shape" | "duplicate-device" | "key-mismatch" | "bad-signature"
}

export type ManifestoVerificado = { ok: true; manifest: DeviceManifest; wire: DeviceManifestWire } | ManifestoRecusado

/**
 * Verify a manifest from the wire: **returns, never throws**, by the
 * `verifyDeviceChain` rule. The caller is deciding whether to store or admit,
 * and the promised refusal is a reason, not an exception to bubble up.
 *
 * What's proven when it returns `ok`: the shape is ours; the address is an
 * account (`@`) and is the hash of `accountKey`; and `accountKey` signed
 * exactly these fields. What is NOT proven, and on purpose: that the version is
 * the latest. That depends on who asks (the server compares with what it stored;
 * the client with what it saw), and the comparison is theirs.
 */
export function verifyDeviceManifest(raw: unknown): ManifestoVerificado {
  const parsed = DeviceManifestWire.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: "bad-shape" }
  const wire = parsed.data

  if (new Set(wire.devices.map((device) => device.deviceKey)).size !== wire.devices.length) {
    return { ok: false, reason: "duplicate-device" }
  }

  let endereco
  try {
    endereco = parseAddress(wire.address)
  } catch {
    return { ok: false, reason: "bad-shape" }
  }
  if (endereco.sigil !== "@") return { ok: false, reason: "bad-shape" }

  let accountKey: Uint8Array
  let signature: Uint8Array
  let devices: { deviceKey: Uint8Array; addedAt: number }[]
  try {
    accountKey = fromBase64(wire.accountKey)
    signature = fromBase64(wire.signature)
    devices = wire.devices.map((device) => ({ deviceKey: fromBase64(device.deviceKey), addedAt: device.addedAt }))
  } catch {
    return { ok: false, reason: "bad-shape" }
  }
  // The template already measures length in base64url; this is length in bytes,
  // which is what `verify` needs and what a tolerant `fromBase64` doesn't
  // guarantee.
  if (accountKey.length !== 32 || signature.length !== 64 || devices.some((device) => device.deviceKey.length !== 32)) {
    return { ok: false, reason: "bad-shape" }
  }

  if (endereco.localPart !== accountIdFromSigningKey(accountKey)) return { ok: false, reason: "key-mismatch" }

  if (!verify(accountKey, deviceManifestMessage(semAssinatura(wire)), signature)) {
    return { ok: false, reason: "bad-signature" }
  }

  return {
    ok: true,
    wire,
    manifest: {
      address: wire.address as UserAddress,
      version: wire.version,
      devices,
      signedAt: wire.signedAt,
      accountKey,
    },
  }
}
