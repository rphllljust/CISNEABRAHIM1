import { useState } from 'react';
import { PageHeader, Tabs } from '../../ui';
import { AssignmentsTab } from './AssignmentsTab';
import { CapabilitiesTab } from './CapabilitiesTab';
import { GrantsTab } from './GrantsTab';
import { MatricesTab } from './MatricesTab';
import { RolesTab } from './RolesTab';
import { ScopesTab } from './ScopesTab';
import { OperationalUnitsTab } from './OperationalUnitsTab';
import { SodConflictsTab } from './SodConflictsTab';
import { UsersTab } from './UsersTab';

const TAB_IDS = {
  roles: 'roles',
  assignments: 'assignments',
  grants: 'grants',
  users: 'users',
  approval: 'approval',
  capabilities: 'capabilities',
  scopes: 'scopes',
  units: 'units',
  conflicts: 'conflicts',
} as const;

export function AccessAdminPage() {
  const [activeId, setActiveId] = useState<string>(TAB_IDS.roles);

  const items = [
    { id: TAB_IDS.roles, label: 'Roles', panel: <RolesTab /> },
    { id: TAB_IDS.assignments, label: 'Atribuições', panel: <AssignmentsTab /> },
    { id: TAB_IDS.grants, label: 'Concessões', panel: <GrantsTab /> },
    { id: TAB_IDS.users, label: 'Usuários', panel: <UsersTab /> },
    { id: TAB_IDS.approval, label: 'Aprovações', panel: <MatricesTab /> },
    { id: TAB_IDS.capabilities, label: 'Capacidades', panel: <CapabilitiesTab /> },
    { id: TAB_IDS.scopes, label: 'Escopos', panel: <ScopesTab /> },
    { id: TAB_IDS.units, label: 'Unidades', panel: <OperationalUnitsTab /> },
    { id: TAB_IDS.conflicts, label: 'Conflitos SoD', panel: <SodConflictsTab /> },
  ];

  return (
    <div className="w-full">
      <PageHeader
        title="Administração de acesso"
        description="Gestão de roles, concessões, usuários, matrizes de aprovação e catálogos de autorização. O servidor é a única fonte de autoridade: o cliente envia exatamente o que o usuário escolheu e exibe o que o servidor retorna."
      />
      <Tabs
        items={items}
        activeId={activeId}
        onChange={setActiveId}
        label="Administração de acesso"
      />
    </div>
  );
}
