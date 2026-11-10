#!/usr/bin/env node
/**
 * The cost of ONE vault write, by vault size (slow-after-login, 4/11/2026).
 *
 * `Vault.update` serializes the whole content (JSON), encrypts it all (XChaCha20-Poly1305
 * in JS) and passes it to the backend. The session calls it once per live event (`#rememberSeq`).
 * Here we measure only the CPU (backend in memory): Windows disk and IndexedDB add to this.
 *
 *   node scripts/medir-cofre-por-evento.mjs
 */
import { Vault } from "@enclave/client-core"

class Memoria {
  supportsOsProtection = true
  bytes = null
  escritas = 0
  async read() {
    return this.bytes
  }
  async write(bytes) {
    this.bytes = bytes
    this.escritas++
  }
  async clear() {
    this.bytes = null
  }
  async wrapKey(k) {
    return k
  }
  async unwrapKey(k) {
    return k
  }
}

const enchimento = (bytes) => "A".repeat(bytes)

for (const mb of [1, 3, 6, 10, 20]) {
  const vault = new Vault(new Memoria())
  await vault.create(null)
  // Weight lives in `groups` and in the directory, as in a real vault (MLS state and avatars in base64).
  await vault.update((c) => {
    c.groups["!984:orwell.test"] = enchimento(Math.round(mb * 0.25 * 1e6))
    for (let i = 0; i < 150; i++) c.directory[`@conta${i}:orwell.test`] = { at: 1, payload: { avatar: enchimento(Math.round((mb * 0.75 * 1e6) / 150)) } }
  })
  const tempos = []
  for (let i = 0; i < 15; i++) {
    const t0 = performance.now()
    await vault.update((c) => {
      c.lastSeq["!984:orwell.test"] = i
    })
    tempos.push(performance.now() - t0)
  }
  tempos.sort((a, b) => a - b)
  const med = tempos[7]
  console.log(`cofre de ${String(mb).padStart(2)} MB: uma gravação ${med.toFixed(1).padStart(6)} ms (máx ${tempos.at(-1).toFixed(1)}); 160 gravações (uma entrada no !984) = ${((med * 160) / 1000).toFixed(1)} s de CPU`)
}
