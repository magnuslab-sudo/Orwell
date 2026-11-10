import type { Power } from "@enclave/protocol"
import type { ChannelRole } from "../../bridge.js"
import { type MembroDoCanal, RoleEditor } from "../chat/RoleEditor.js"

/**
 * What the "Roles" section of channel properties receives.
 *
 * This is the section boundary (3/11/2026): item #7 of the parity plan
 * (`docs/planos/paridade-discord-plano.md` §4, the roles and permissions model)
 * will swap or extend this tab's content. Whoever changes it gets these
 * properties and nothing else, and the panel does not know what is inside.
 */
export interface PropsDaSeccaoCargos {
  roles: readonly ChannelRole[]
  onCreateRole: (name: string, powers: Power[], colour: string | undefined) => void
  onEditRole: (role: string, name: string, powers: Power[], colour: string | undefined) => void
  onDeleteRole: (role: string) => void
  /** Change the role order. Missing: the list shows the order but does not change it. */
  onReorderRoles?: ((ordem: string[]) => Promise<unknown> | void) | undefined
  souFundador?: boolean | undefined
  cargoAdmin?: { name: string; colour?: string } | null | undefined
  membros?: readonly MembroDoCanal[] | undefined
  onSetMemberRole?: ((address: string, role: string, ter: boolean) => void) | undefined
  /**
   * The 1.2 permissions model, already wired (`CargosEPermissoesLigado`): the
   * role order, what everyone can do, and permissions per room. Below the usual
   * editor, which keeps creating roles and assigning them. Missing on a host
   * without the model.
   */
  permissoes?: React.ReactNode
}

/**
 * The "Roles" section: today, the `RoleEditor` as it was in the scrolling panel.
 *
 * Only mounts for those who can manage roles (`mayManageRoles`, from the core).
 * Those who cannot do not see the tab, and do not see it grayed out: the rule
 * for all menus.
 */
export function SeccaoCargos({
  roles,
  onCreateRole,
  onEditRole,
  onDeleteRole,
  onReorderRoles,
  souFundador,
  cargoAdmin,
  membros,
  onSetMemberRole,
  permissoes,
}: PropsDaSeccaoCargos): React.JSX.Element {
  return (
    <div className="sheet-grupo">
      <RoleEditor
        roles={[...roles]}
        onCreateRole={onCreateRole}
        onEditRole={onEditRole}
        onDeleteRole={onDeleteRole}
        onReorder={onReorderRoles}
        souFundador={souFundador}
        admin={cargoAdmin ?? null}
        membros={membros}
        onSetMemberRole={onSetMemberRole}
      />
      {permissoes}
    </div>
  )
}
