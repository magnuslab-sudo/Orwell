# Patches to dependencies

`patch-package` applies these in `postinstall`. Both `npm install` and `npm ci`
apply them, as long as `postinstall` runs and this folder is present. Without
the folder, `patch-package` prints "No patch files found" and still succeeds,
so a build can silently ship without them.

`node patches/verificar.mjs` fails if any patch is missing. `infra/Dockerfile`
runs it after `npm ci`. When you add a patch, add it to that check too.

The `ts-mls` version is pinned exactly, because `packages/crypto/src/sender.ts`
uses some of its internals.

## `ts-mls+1.6.2.patch`

The file carries two fixes.

### 1. A single removal needs an UpdatePath

**The bug.** `clientState.js` decided whether a commit needs an UpdatePath with
`grouped.update.length > 1 || grouped.remove.length > 1`. RFC 9420 (table in
section 12.1) marks `update` and `remove` as "path required" on their own: one
removal is enough. The patch changes both `> 1` to `>= 1`.

**Why it matters.** Without a path, the commit secret is zero and the new
epoch's secret derives from the old one, which the removed person has. A
removal without a path does not stop that person from reading. Every removal in
Orwell is a single removal, and so is every unfriending.

**Why not upgrade.** The correct code only exists in `2.0.0-rc.*`:

1. Version 2 changes the group state encoding, so every stored channel session
   in existing vaults would fail to import.
2. It is a release candidate, and this is the cryptographic core.
3. Eight of the thirty-four symbols Orwell uses were removed or renamed.

A one-character patch on a pinned version is the smaller risk. It goes away
when version 2 is stable and someone writes the vault migration.

**If the patch is lost**, `removeMembers` refuses to remove anyone and says why
(see the leaf key check in `packages/crypto/src/group.ts`). Failing visibly is
intended. Removing without a path is not.

### 2. Unmerged leaves in the tree of someone joining

**The bug.** `validateRatchetTree` runs when someone joins through a Welcome or
through `joinGroupExternal`. For each leaf in a parent's `unmerged_leaves`,
1.6.2 required every non-blank node on the whole path to the root to list it,
including nodes above that parent. RFC 9420, section 12.4.3.1, asks for less:
the entry must be a non-blank leaf that descends from the parent, and only the
nodes between the leaf and that parent must list it. The patch implements
exactly those two rules. The rest of the function is unchanged. This matches
`2.0.0-rc.16`; 1.6.4, the latest stable release, still has the defect.

**Why it matters.** A valid tree reaches this shape in normal use: a member
leaves, another takes the free leaf without a path, then someone on the other
side updates. From then on nobody new could join the group: the Welcome failed
validation and the client kept asking to be let in. Members already inside
never revalidate the tree and saw nothing wrong. Tests:
`packages/crypto/src/group.unmerged.test.ts` and `scripts/verificar-cartao.mjs`.

This should be reported upstream to `LukaJCB/ts-mls`: the fix exists in 2.0
but not in 1.6.x.

## Upgrading clients

A patched client refuses a removal commit without a path, as the RFC requires.
Older clients still send them, so a removal made by an old client cannot be
applied by new ones. Update everyone before the next removal.
