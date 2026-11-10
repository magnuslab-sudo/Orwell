import { generateIdentity, parseServerName, safetyNumber, type Payload } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import {
  addMembers,
  createChannel,
  decodeKeyPackage,
  encryptPayload,
  exportKeyPackage,
  exportSession,
  generateKeyPackages,
  importKeyPackage,
  importSession,
  joinChannel,
  memberAccountKey,
  memberSigningKey,
  receive,
  removeMembers,
  rotateEpoch,
  type GroupSession,
} from "./group.js"
import { memberAddresses } from "./sender.js"

const HOME = parseServerName("enclave.test")
const OTHER = parseServerName("other.test")

function text(body: string, id = crypto.randomUUID()): Payload {
  return { t: "message", id, sentAt: 1_700_000_000_000, body, attachments: [], mentions: [], links: [] }
}

/** Everything a two-member channel needs, wired up the way the client does it. */
async function twoMemberChannel() {
  const alice = generateIdentity(HOME)
  // Bob lives on a different homeserver: this is the federated path, not the
  // easy same-server one.
  const bob = generateIdentity(OTHER)

  const [bobKeyPackage] = await generateKeyPackages(bob, 1)
  if (!bobKeyPackage) throw new Error("no key package")

  let aliceSession = await createChannel(alice, "!general:enclave.test")
  const invite = await addMembers(aliceSession, [decodeKeyPackage(bobKeyPackage.wire)])
  aliceSession = invite.session

  const bobSession = await joinChannel(
    "!general:enclave.test",
    invite.welcome,
    bobKeyPackage.publicPackage,
    bobKeyPackage.privatePackage,
  )

  return { alice, bob, aliceSession, bobSession, invite }
}

describe("MLS channel", () => {
  it("carries a message between members on different homeservers", async () => {
    const { alice, aliceSession, bobSession } = await twoMemberChannel()

    const sent = await encryptPayload(aliceSession, text("olá do outro lado"))
    const received = await receive(bobSession, sent.ciphertext)

    expect(received.kind).toBe("payload")
    if (received.kind !== "payload") return
    expect(received.payload).toMatchObject({ t: "message", body: "olá do outro lado" })
    // Attribution comes from the ratchet tree, not from anything the sender wrote.
    expect(received.sender).toBe(alice.address)
  })

  it("attributes each direction to the right author", async () => {
    const { alice, bob, aliceSession, bobSession } = await twoMemberChannel()

    const fromAlice = await encryptPayload(aliceSession, text("primeira"))
    const atBob = await receive(bobSession, fromAlice.ciphertext)
    expect(atBob.kind).toBe("payload")
    if (atBob.kind !== "payload") return
    expect(atBob.sender).toBe(alice.address)

    const fromBob = await encryptPayload(atBob.session, text("segunda"))
    const atAlice = await receive(fromAlice.session, fromBob.ciphertext)
    expect(atAlice.kind).toBe("payload")
    if (atAlice.kind !== "payload") return
    expect(atAlice.sender).toBe(bob.address)
  })

  it("leaks neither plaintext nor member addresses to whoever relays the bytes", async () => {
    const { alice, bob, aliceSession } = await twoMemberChannel()

    const secret = "coordenadas do encontro: 38.7223 N, 9.1393 W"
    const sent = await encryptPayload(aliceSession, text(secret))

    // This is exactly the byte string a homeserver stores and forwards.
    const onTheWire = new TextDecoder("latin1").decode(sent.ciphertext)

    expect(onTheWire).not.toContain(secret)
    expect(onTheWire).not.toContain("coordenadas")
    expect(onTheWire).not.toContain(alice.address)
    expect(onTheWire).not.toContain(bob.address)
    expect(onTheWire).not.toContain(alice.accountId)
    expect(onTheWire).not.toContain("message")
  })

  it("hides message length behind padding", async () => {
    const { aliceSession } = await twoMemberChannel()

    const short = await encryptPayload(aliceSession, text("ok"))
    const long = await encryptPayload(short.session, text("não".repeat(60)))

    // Both land in the same 512-byte bucket, so an observer cannot tell a
    // one-word reply from a paragraph.
    expect(short.ciphertext.length).toBe(long.ciphertext.length)
  })

  it("stops a removed member from reading the next epoch", async () => {
    const { aliceSession, bobSession } = await twoMemberChannel()

    // Bob is leaf 1; alice founded the group at leaf 0.
    const removal = await removeMembers(aliceSession, [1])
    const afterRemoval = await encryptPayload(removal.session, text("assunto interno"))

    const attempt = await receive(bobSession, afterRemoval.ciphertext)
    expect(attempt.kind).toBe("ignored")
  })

  /**
   * The same, but with Bob doing what Bob actually does: he gets the commit.
   *
   * The test above never delivers the removal commit to the removed member, and
   * that is why it does not prove what it seems to: Bob fails to decrypt because he is
   * one epoch behind, not because he was removed. But the commit is broadcast to the channel
   * and Bob stays subscribed: he always gets it.
   *
   * And there, with a single removal, RFC 9420 §12.4 requires an UpdatePath, which
   * is what stops the removed member from deriving the next epoch. Without it the new secret comes
   * from the old one, which the removed member has, and so they keep reading
   * everything, forever, with the tree saying they are no longer a member. Measured
   * with two real accounts before being written here.
   */
  it("e continua a impedi-lo quando ele processa o próprio commit que o remove", async () => {
    const { aliceSession, bobSession } = await twoMemberChannel()

    const removal = await removeMembers(aliceSession, [1])
    // The commit reaches Bob like it reaches everyone.
    let bobDepois = bobSession
    for (const commit of removal.commits) {
      const applied = await receive(bobDepois, commit)
      if (applied.kind === "epoch") bobDepois = applied.session
    }

    const afterRemoval = await encryptPayload(removal.session, text("assunto interno"))
    expect((await receive(bobDepois, afterRemoval.ciphertext)).kind).toBe("ignored")
  })

  /**
   * The hole we had missed: an honest witness encrypting between commits.
   *
   * The two tests above deliver the whole removal and then measure. Neither exercises
   * what a hostile server can do for free: deliver part and hold back the rest. While removal
   * needed two commits, a member who applied only the first stayed in an epoch derived from
   * the previous one, which the kicked member has: anything that member wrote
   * there was readable by the banned one, and they had no symptom (they decrypted
   * perfectly, so the deafness detector never woke up).
   *
   * The invariant is therefore stronger than "at the end they do not read": NO
   * prefix of the commits can leave an epoch readable to both sides. The test
   * walks all prefixes on purpose, to keep working if removal ever needs more than
   * one commit again.
   */
  it("não abre nenhuma epoch ao expulso, nem quando o servidor retém parte da remoção", async () => {
    // A fresh scene per prefix: applying commits consumes ratchets, and reusing
    // sessions between passes would measure stale state instead of what we want to measure.
    async function cena() {
      const alice = generateIdentity(HOME)
      const bob = generateIdentity(OTHER)
      const carol = generateIdentity(OTHER)
      const [bobKp] = await generateKeyPackages(bob, 1)
      const [carolKp] = await generateKeyPackages(carol, 1)
      if (!bobKp || !carolKp) throw new Error("no key package")

      let sala = await createChannel(alice, "!prefixos:enclave.test")
      const convite = await addMembers(sala, [decodeKeyPackage(bobKp.wire), decodeKeyPackage(carolKp.wire)])
      sala = convite.session
      const bobSession = await joinChannel("!prefixos:enclave.test", convite.welcome, bobKp.publicPackage, bobKp.privatePackage)
      const carolSession = await joinChannel(
        "!prefixos:enclave.test",
        convite.welcome,
        carolKp.publicPackage,
        carolKp.privatePackage,
      )
      // Out: Bob, leaf 1. Carol, leaf 2, stays and is the witness.
      return { removal: await removeMembers(sala, [1]), bobSession, carolSession }
    }

    const { removal: sonda } = await cena()
    for (let entregues = 1; entregues <= sonda.commits.length; entregues++) {
      const { removal, bobSession, carolSession } = await cena()
      let bobDepois = bobSession
      let carolDepois = carolSession
      for (const commit of removal.commits.slice(0, entregues)) {
        const noBob = await receive(bobDepois, commit)
        if (noBob.kind === "epoch") bobDepois = noBob.session
        const naCarol = await receive(carolDepois, commit)
        expect(naCarol.kind).toBe("epoch")
        if (naCarol.kind === "epoch") carolDepois = naCarol.session
      }

      // Carol writes in the epoch where the server left her. She has no way to know
      // she got stuck there, so she writes freely.
      const daCarol = await encryptPayload(carolDepois, text(`segredo no prefixo ${entregues}`))
      expect((await receive(bobDepois, daCarol.ciphertext)).kind).toBe("ignored")
    }
  })

  it("quem fica no canal continua a ler através da remoção", async () => {
    // The removal rekeys the group, and that must not cost the remaining members the channel.
    const alice = generateIdentity(HOME)
    const carol = generateIdentity(OTHER)
    const dave = generateIdentity(OTHER)
    const [carolKp] = await generateKeyPackages(carol, 1)
    const [daveKp] = await generateKeyPackages(dave, 1)
    if (!carolKp || !daveKp) throw new Error("no key package")

    let sala = await createChannel(alice, "!sala:enclave.test")
    const convite = await addMembers(sala, [decodeKeyPackage(carolKp.wire), decodeKeyPackage(daveKp.wire)])
    sala = convite.session
    let carolSession = await joinChannel("!sala:enclave.test", convite.welcome, carolKp.publicPackage, carolKp.privatePackage)
    let daveSession = await joinChannel("!sala:enclave.test", convite.welcome, daveKp.publicPackage, daveKp.privatePackage)

    // Out: Dave (leaf 2). Carol stays, and must keep up.
    const removal = await removeMembers(sala, [2])
    for (const commit of removal.commits) {
      const applied = await receive(carolSession, commit)
      expect(applied.kind).toBe("epoch")
      if (applied.kind === "epoch") carolSession = applied.session
      const doDave = await receive(daveSession, commit)
      if (doDave.kind === "epoch") daveSession = doDave.session
    }

    const depois = await encryptPayload(removal.session, text("só para quem ficou"))
    expect((await receive(carolSession, depois.ciphertext)).kind).toBe("payload")
    expect((await receive(daveSession, depois.ciphertext)).kind).toBe("ignored")
  })

  /**
   * The risk the fix brings, not the hole it closes.
   *
   * A removal commit now carries an UpdatePath, and an UpdatePath is the only
   * part of MLS that speaks differently to each branch of the tree: it encrypts a
   * secret for each node in the copath resolution, and the removed leaf sits blank
   * in the middle. With two or three members the tree is too shallow for that to show:
   * whoever stayed had just one node to open. Five members give subtrees
   * on both sides and a blank in the middle, which is where a badly calculated
   * resolution would leave someone out.
   *
   * "No regression" has to mean read AND write: whoever only decrypts may be
   * living off the old key without integrating the new path.
   */
  it("mantém toda a gente que fica a ler e a escrever, numa árvore funda", async () => {
    const alice = generateIdentity(HOME)
    const nomes = ["bea", "carlos", "dora", "eva"] as const
    const membros = await Promise.all(
      nomes.map(async (nome) => {
        const identidade = generateIdentity(OTHER)
        const [kp] = await generateKeyPackages(identidade, 1)
        if (!kp) throw new Error(`no key package para ${nome}`)
        return { nome, identidade, kp }
      }),
    )

    let sala = await createChannel(alice, "!funda:enclave.test")
    const convite = await addMembers(
      sala,
      membros.map((membro) => decodeKeyPackage(membro.kp.wire)),
    )
    sala = convite.session
    const sessoes = new Map<string, GroupSession>()
    for (const membro of membros) {
      sessoes.set(membro.nome, await joinChannel("!funda:enclave.test", convite.welcome, membro.kp.publicPackage, membro.kp.privatePackage))
    }

    // Out: Carlos, leaf 2: in the middle of the tree, not at an edge, so the blank
    // falls inside the resolution of the remaining members and not at its edge.
    const removal = await removeMembers(sala, [2])
    sala = removal.session
    for (const [nome, sessao] of sessoes) {
      let actual = sessao
      for (const commit of removal.commits) {
        const aplicado = await receive(actual, commit)
        // Carlos also receives: it is broadcast, and he stays subscribed.
        if (nome !== "carlos") expect(aplicado.kind).toBe("epoch")
        if (aplicado.kind === "epoch") actual = aplicado.session
      }
      sessoes.set(nome, actual)
    }

    const ficaram = ["bea", "dora", "eva"] as const
    // Each remaining member writes, and all the others have to read it. Writing is
    // what proves the path was integrated, not just tolerated.
    for (const autor of ficaram) {
      const sessaoAutor = sessoes.get(autor)
      if (!sessaoAutor) throw new Error(`sem sessão para ${autor}`)
      const enviado = await encryptPayload(sessaoAutor, text(`palavra da ${autor}`))
      sessoes.set(autor, enviado.session)

      for (const leitor of ficaram) {
        if (leitor === autor) continue
        const sessaoLeitor = sessoes.get(leitor)
        if (!sessaoLeitor) throw new Error(`sem sessão para ${leitor}`)
        const lido = await receive(sessaoLeitor, enviado.ciphertext)
        expect(lido.kind).toBe("payload")
        if (lido.kind === "payload") sessoes.set(leitor, lido.session)
      }

      const naAlice = await receive(sala, enviado.ciphertext)
      expect(naAlice.kind).toBe("payload")
      if (naAlice.kind === "payload") sala = naAlice.session

      const noCarlos = sessoes.get("carlos")
      if (!noCarlos) throw new Error("sem sessão para carlos")
      expect((await receive(noCarlos, enviado.ciphertext)).kind).toBe("ignored")
    }

    // And the tree with one blank still accepts a second removal by the same
    // path: it is the state any later kick will find the channel in, and where
    // a wrong resolution would only show up on the second one.
    const segunda = await removeMembers(sala, [4])
    sala = segunda.session
    for (const nome of ["bea", "dora"] as const) {
      let actual = sessoes.get(nome)
      if (!actual) throw new Error(`sem sessão para ${nome}`)
      for (const commit of segunda.commits) {
        const aplicado = await receive(actual, commit)
        expect(aplicado.kind).toBe("epoch")
        if (aplicado.kind === "epoch") actual = aplicado.session
      }
      sessoes.set(nome, actual)
    }
    const depois = await encryptPayload(sala, text("depois da segunda"))
    const naBea = sessoes.get("bea")
    const naEva = sessoes.get("eva")
    if (!naBea || !naEva) throw new Error("sem sessões")
    expect((await receive(naBea, depois.ciphertext)).kind).toBe("payload")
    expect((await receive(naEva, depois.ciphertext)).kind).toBe("ignored")
  })

  it("heals after a compromise once the epoch rotates", async () => {
    const { aliceSession, bobSession } = await twoMemberChannel()

    const rotated = await rotateEpoch(aliceSession)
    const [rotation] = rotated.commits
    if (!rotation) throw new Error("uma rotação tem de produzir um commit")
    const bobAfterCommit = await receive(bobSession, rotation)
    expect(bobAfterCommit.kind).toBe("epoch")
    if (bobAfterCommit.kind !== "epoch") return

    // The old session object still holds pre-rotation keys. A device image taken
    // at that point must not decrypt anything sent afterwards.
    const post = await encryptPayload(rotated.session, text("depois da rotação"))
    const withStaleKeys: GroupSession = bobSession
    const stale = await receive(withStaleKeys, post.ciphertext)
    expect(stale.kind).toBe("ignored")

    const fresh = await receive(bobAfterCommit.session, post.ciphertext)
    expect(fresh.kind).toBe("payload")
  })

  it("drops garbage from a hostile relay without breaking the session", async () => {
    const { aliceSession, bobSession } = await twoMemberChannel()

    const garbage = await receive(bobSession, crypto.getRandomValues(new Uint8Array(400)))
    expect(garbage.kind).toBe("ignored")

    // The session must still work: a server that can DoS a channel by sending
    // junk is a server that can censor it.
    const sent = await encryptPayload(aliceSession, text("ainda cá estamos"))
    const after = await receive(garbage.session, sent.ciphertext)
    expect(after.kind).toBe("payload")
  })

  it("diz de que epoch vinha o frame que recusou, e cala-se quando não sabe", async () => {
    /*
      A refusal alone does not tell apart two things that are not the same: what was
      said before we joined (it will never open, and it is the normal past of any
      channel) and what was said after the channel moved on without us (that is deafness).
      Code that counts ignored messages to declare a channel dead needs to separate them:
      see `anteriorAoNossoLugar` in the client.
    */
    const alice = generateIdentity(HOME)
    const bob = generateIdentity(OTHER)
    let aliceSession = await createChannel(alice, "!antes:enclave.test")

    // Said at epoch 0, before Bob existed on this channel.
    const antesDoLugar = await encryptPayload(aliceSession, text("isto foi antes de tu chegares"))
    aliceSession = antesDoLugar.session

    const [bobKeyPackage] = await generateKeyPackages(bob, 1)
    if (!bobKeyPackage) throw new Error("no key package")
    const invite = await addMembers(aliceSession, [decodeKeyPackage(bobKeyPackage.wire)])
    const bobSession = await joinChannel(
      "!antes:enclave.test",
      invite.welcome,
      bobKeyPackage.publicPackage,
      bobKeyPackage.privatePackage,
    )

    const recusado = await receive(bobSession, antesDoLugar.ciphertext)
    expect(recusado.kind).toBe("ignored")
    if (recusado.kind !== "ignored") throw new Error("devia ter sido ignorado")
    expect(recusado.epochDoFrame).toBe(0n)
    // And ours is this one: that comparison decides, not the error text.
    expect(bobSession.state.groupContext.epoch).toBe(1n)

    // Garbage has no header to read, and we do not invent one.
    const lixo = await receive(bobSession, crypto.getRandomValues(new Uint8Array(400)))
    if (lixo.kind !== "ignored") throw new Error("devia ter sido ignorado")
    expect(lixo.epochDoFrame).toBeUndefined()
  })

  it("survives a restart with its epoch and ratchet intact", async () => {
    const { alice, aliceSession, bobSession } = await twoMemberChannel()

    // Traffic before the restart, so the secret tree is not at generation zero.
    const before = await encryptPayload(aliceSession, text("antes de fechar"))
    const seen = await receive(bobSession, before.ciphertext)
    expect(seen.kind).toBe("payload")
    if (seen.kind !== "payload") return

    // Round-trip Bob's session through the vault representation.
    const blob = exportSession(seen.session)
    const restored = await importSession("!general:enclave.test", blob)

    expect(restored.state.groupContext.epoch).toBe(seen.session.state.groupContext.epoch)

    const after = await encryptPayload(before.session, text("depois de reabrir"))
    const result = await receive(restored, after.ciphertext)

    expect(result.kind).toBe("payload")
    if (result.kind !== "payload") return
    expect(result.payload).toMatchObject({ body: "depois de reabrir" })
    // Attribution must survive too — it comes from the restored ratchet tree.
    expect(result.sender).toBe(alice.address)
  })

  it("keeps a restored session able to send", async () => {
    const { bob, aliceSession, bobSession } = await twoMemberChannel()

    const restored = await importSession("!general:enclave.test", exportSession(bobSession))
    const sent = await encryptPayload(restored, text("envio depois de restaurar"))

    const atAlice = await receive(aliceSession, sent.ciphertext)
    expect(atAlice.kind).toBe("payload")
    if (atAlice.kind !== "payload") return
    expect(atAlice.sender).toBe(bob.address)
  })

  it("round-trips a key package so a welcome can be accepted after a restart", async () => {
    const bob = generateIdentity(OTHER)
    const [generated] = await generateKeyPackages(bob, 1)
    if (!generated) throw new Error("no key package")

    // Publish, shut down, come back: the private half has to be recoverable or
    // the invitation is simply undeliverable.
    const revived = importKeyPackage(exportKeyPackage(generated))

    const alice = generateIdentity(HOME)
    let aliceSession = await createChannel(alice, "!later:enclave.test")
    const invite = await addMembers(aliceSession, [decodeKeyPackage(generated.wire)])
    aliceSession = invite.session

    const joined = await joinChannel(
      "!later:enclave.test",
      invite.welcome,
      revived.publicPackage,
      revived.privatePackage,
    )

    const sent = await encryptPayload(aliceSession, text("bem-vindo de volta"))
    const received = await receive(joined, sent.ciphertext)
    expect(received.kind).toBe("payload")
  })

  it("rejects a replayed ciphertext", async () => {
    const { aliceSession, bobSession } = await twoMemberChannel()

    const sent = await encryptPayload(aliceSession, text("uma vez só"))
    const first = await receive(bobSession, sent.ciphertext)
    expect(first.kind).toBe("payload")
    if (first.kind !== "payload") return

    const replay = await receive(first.session, sent.ciphertext)
    expect(replay.kind).toBe("ignored")
  })

  /**
   * The leaf belongs to the device; the person is the address.
   *
   * Everything that decides authority (founders, roles, friendships, admin lists)
   * hangs on the address, and the address must stay the digest of the ACCOUNT
   * key now that the leaf is signed by another key. If this ever fails, an account ends up with two names.
   */
  it("a árvore diz o endereço da conta, e a chave da folha é a do aparelho", async () => {
    const { alice, bob, aliceSession, bobSession } = await twoMemberChannel()

    expect(memberAddresses(aliceSession.state.ratchetTree)).toEqual(
      new Map([
        [0, alice.address],
        [1, bob.address],
      ]),
    )

    // The key that signs Bob's leaf is his device key, not his account key.
    expect(memberSigningKey(aliceSession, bob.address)).toEqual(bob.deviceSigningPublicKey)
    expect(memberSigningKey(aliceSession, bob.address)).not.toEqual(bob.signingPublicKey)

    // And the chain inside returns the account, which is what the address digests.
    expect(memberAccountKey(aliceSession, bob.address)).toEqual(bob.signingPublicKey)
    expect(memberAccountKey(bobSession, alice.address)).toEqual(alice.signingPublicKey)
  })

  /**
   * The safety number must be the SAME on both sides.
   *
   * It is read aloud and compared; a number that disagrees by construction is
   * worse than none, because it teaches you to ignore it. With account keys both
   * sides compute over the same pair. With leaf keys, each side would see the other's
   * account and their own device, and the numbers would never match even with no one in the middle.
   */
  it("o safety number calcula-se sobre as mesmas duas chaves nas duas pontas", async () => {
    const { alice, bob, aliceSession, bobSession } = await twoMemberChannel()

    const naAlice = memberAccountKey(aliceSession, bob.address)
    const noBob = memberAccountKey(bobSession, alice.address)
    expect(naAlice).not.toBeNull()
    expect(noBob).not.toBeNull()

    expect(safetyNumber(alice.signingPublicKey, naAlice as Uint8Array)).toBe(
      safetyNumber(bob.signingPublicKey, noBob as Uint8Array),
    )
    // And comparing with the leaf keys would give a different number: that is the
    // exact regression that this test exists to catch.
    expect(safetyNumber(alice.signingPublicKey, bob.deviceSigningPublicKey)).not.toBe(
      safetyNumber(alice.signingPublicKey, bob.signingPublicKey),
    )
  })
})
