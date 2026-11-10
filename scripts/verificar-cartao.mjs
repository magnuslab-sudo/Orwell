/**
 * Can a new account open this card (GroupInfo) from the public room?
 *
 * Local calculation only: generates a throwaway identity, validates the card tree
 * the way ts-mls validates an incoming member, and says which leaf makes it fail. Sends
 * nothing anywhere. The card is public to any server account (it is the gate to
 * the public room), and is read from the server database in hexadecimal:
 *
 *   sqlite3 -readonly enclave.sqlite "select hex(info) from group_infos where channel='!984:orwell.pt'" > cartao.hex
 *   node scripts/verificar-cartao.mjs cartao.hex '!984:orwell.pt'
 */
import { readFileSync } from "node:fs"
import { generateIdentity, parseServerName } from "@enclave/protocol"
import { generateKeyPackages, joinChannelExternally } from "@enclave/crypto"
import { decodeMlsMessage } from "ts-mls"
import { webcrypto } from "node:crypto"
if (!globalThis.crypto) globalThis.crypto = webcrypto

const [ficheiro, canal] = process.argv.slice(2)
const bytes = Buffer.from(readFileSync(ficheiro, "utf8").trim(), "hex")
const servidor = canal.split(":").slice(1).join(":")
const identidade = generateIdentity(parseServerName(servidor))
const [kp] = await generateKeyPackages(identidade, 1)

try {
  const r = await joinChannelExternally(canal, new Uint8Array(bytes), kp.publicPackage, kp.privatePackage)
  console.log(`ENTRA: a conta nova abre o cartão (resync=${r.resync})`)
} catch (erro) {
  console.log(`NAO ENTRA: ${erro?.constructor?.name}: ${erro?.message}`)
}

// The tree, node by node: RFC 9420 rule (§12.4.3.1) against ts-mls 1.6.2.
const { ratchetTreeFromExtension } = await import("ts-mls/groupInfo.js")
const { directPath, leafToNodeIndex, leafWidth, toLeafIndex } = await import("ts-mls/treemath.js")
const [mensagem] = decodeMlsMessage(new Uint8Array(bytes), 0)
const arvore = ratchetTreeFromExtension(mensagem.groupInfo)
const largura = leafWidth(arvore.length)
const folhas = arvore.filter((n) => n?.nodeType === "leaf").length
console.log(`epoch ${mensagem.groupInfo.groupContext.epoch}, ${folhas} folhas, ${arvore.length} nós`)
let rfc = 0
let tsmls = 0
for (const [i, n] of arvore.entries()) {
  if (n?.nodeType !== "parent") continue
  for (const l of n.parent.unmergedLeaves) {
    const caminho = directPath(leafToNodeIndex(toLeafIndex(l)), largura)
    // RFC: the input is a non-empty leaf, descendant of this node.
    if (arvore[leafToNodeIndex(toLeafIndex(l))]?.nodeType !== "leaf" || !caminho.includes(i)) {
      rfc++
      console.log(`  RFC: a folha ${l} listada no nó ${i} está vazia ou não é descendente`)
    }
    // RFC: and each non-empty node BETWEEN the leaf and this parent has the leaf in its unmerged_leaves.
    for (const j of caminho) {
      if (j === i) break
      const m = arvore[j]
      if (m && !(m.nodeType === "parent" && m.parent.unmergedLeaves.includes(l))) {
        rfc++
        console.log(`  RFC: nó ${j} entre a folha ${l} e o nó ${i} não a lista`)
      }
    }
    // ts-mls 1.6.2: ALL non-empty nodes in the whole path (also above this parent)
    // with the list EQUAL to this parent's.
    for (const j of caminho) {
      const m = arvore[j]
      if (m && m.nodeType === "parent" && JSON.stringify(m.parent.unmergedLeaves) !== JSON.stringify(n.parent.unmergedLeaves)) {
        tsmls++
        if (tsmls <= 5) console.log(`  ts-mls recusa: folha ${l} no nó ${i} [${n.parent.unmergedLeaves}] vs nó ${j} [${m.parent.unmergedLeaves}]`)
      }
    }
  }
}
console.log(`violações do RFC: ${rfc}; recusas do ts-mls 1.6.2 sem remendo: ${tsmls}`)
