import { useState, type FormEvent, type ReactNode } from 'react';
import {
  AccessAdminApiError,
  listApprovalRoleAssignments,
  listAssignments,
  listGrants,
  listIdentities,
} from '../api/access-admin-api';
import { mapAccessAdminErrorToMessage } from '../api/access-admin-error-messages';
import { useAsyncResource } from '../hooks/useAccessAdminData';
import type { ApprovalRoleAssignment, GrantInfo, IdentityInfo, RoleAssignment } from '../types';
import { Badge, Button, EmptyState, ErrorState, LoadingState, filterControlClass, filterLabelClass, worklistCellClass, worklistTableClass, worklistHeadCellClass, worklistRowClass, worklistTableCardClass } from '../../ui';

function identityStatusTone(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'active':
      return 'success';
    case 'disabled':
      return 'warning';
    case 'locked':
      return 'error';
    default:
      return 'neutral';
  }
}

function identityStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Ativa';
    case 'disabled':
      return 'Desativada';
    case 'locked':
      return 'Bloqueada';
    default:
      return status;
  }
}

export function UsersTab() {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<IdentityInfo | null>(null);

  const identitiesResource = useAsyncResource<IdentityInfo[]>(() =>
    listIdentities({
      query: query.trim() || undefined,
      status: statusFilter || undefined,
      limit: 100,
    }),
  );

  function search(event: FormEvent): void {
    event.preventDefault();
    identitiesResource.refresh();
  }

  const { state, refresh } = identitiesResource;

  return (
    <div>
      <p className="mb-4 max-w-3xl text-sm text-gray-500">
        Catálogo de identidades retornado pelo servidor. Selecione uma linha para
        ver a visão consolidada do usuário (concessões e atribuições de role).
      </p>

      <form onSubmit={search} className="mb-6 grid items-end gap-4 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className={filterLabelClass} htmlFor="users-search">
            Buscar por login
          </label>
          <input
            id="users-search"
            type="search"
            className={filterControlClass}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ex.: ana.silva"
          />
        </div>
        <div>
          <label className={filterLabelClass} htmlFor="users-status-filter">
            Status
          </label>
          <select
            id="users-status-filter"
            className={filterControlClass}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="">Todos</option>
            <option value="active">Ativas</option>
            <option value="disabled">Desativadas</option>
            <option value="locked">Bloqueadas</option>
          </select>
        </div>
        <div className="flex items-end">
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
        </div>
        <div className="flex items-end justify-end">
          {selected ? (
            <Button type="button" variant="ghost" onClick={() => setSelected(null)}>
              Fechar visão do usuário
            </Button>
          ) : null}
        </div>
      </form>

      {state.phase === 'loading' ? (
        <LoadingState label="Carregando usuários…" />
      ) : state.phase === 'error' ? (
        <ErrorState
          title="Usuários"
          message={
            state.error instanceof AccessAdminApiError
              ? mapAccessAdminErrorToMessage(state.error.code, state.error.status)
              : 'Não foi possível carregar os usuários.'
          }
          onRetry={refresh}
        />
      ) : state.data.length === 0 ? (
        <EmptyState
          title="Nenhum usuário"
          description="Nenhuma identidade corresponde aos filtros informados."
        />
      ) : (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Usuários (identidades)">
            <thead className={worklistHeadCellClass}>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  Login
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Status
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Desativada em
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Criada em
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Identidade (id)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {state.data.map((identity) => {
                const isSelected = selected?.id === identity.id;
                return (
                  <tr
                    key={identity.id}
                    className={
                      isSelected
                        ? 'cursor-pointer bg-brand-50/70 transition hover:bg-brand-50'
                        : 'cursor-pointer transition hover:bg-gray-50'
                    }
                    onClick={() => setSelected(identity)}
                    data-testid={`user-row-${identity.id}`}
                  >
                    <td className={worklistCellClass}>
                      <span className="font-medium text-gray-900">{identity.login ?? '—'}</span>
                    </td>
                    <td className={worklistCellClass}>
                      <Badge tone={identityStatusTone(identity.status)}>
                        {identityStatusLabel(identity.status)}
                      </Badge>
                    </td>
                    <td className={worklistCellClass}>
                      {identity.disabledAt ? identity.disabledAt.slice(0, 10) : '—'}
                    </td>
                    <td className={worklistCellClass}>{identity.createdAt.slice(0, 10)}</td>
                    <td className={worklistCellClass}>
                      <span className="font-mono text-xs text-gray-600">{identity.id}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <UserDetailPanel key={selected.id} identity={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

function UserDetailPanel({
  identity,
  onClose,
}: {
  identity: IdentityInfo;
  onClose: () => void;
}) {
  const grantsResource = useAsyncResource<GrantInfo[]>(() =>
    listGrants({ identityId: identity.id }),
  );
  const accessAssignmentsResource = useAsyncResource<RoleAssignment[]>(() =>
    listAssignments(identity.id),
  );
  const approvalAssignmentsResource = useAsyncResource<ApprovalRoleAssignment[]>(() =>
    listApprovalRoleAssignments(identity.id),
  );

  return (
    <section
      aria-label={`Visão do usuário ${identity.login ?? identity.id}`}
      className="mt-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Visão do usuário</h2>
          <p className="mt-1 text-sm text-gray-500">
            {identity.login ?? 'Sem login'} —{' '}
            <span className="font-mono text-xs">{identity.id}</span>
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      </div>

      <div className="space-y-6">
        <UserDetailBlock
          title="Concessões ativas (PDP)"
          emptyText="Nenhuma concessão ativa para esta identidade."
          state={grantsResource.state}
          renderTable={(grants) => (
            <div className={worklistTableCardClass}>
              <table className={worklistTableClass} aria-label="Concessões ativas do usuário">
                <thead className={worklistHeadCellClass}>
                  <tr>
                    <th scope="col" className={worklistHeadCellClass}>
                      Ação
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Recurso
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Escopo
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Âncora
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Válida até
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {grants.map((grant) => (
                    <tr key={grant.id} className={worklistRowClass}>
                      <td className={worklistCellClass}>
                        <span className="font-mono text-xs text-gray-600">{grant.action}</span>
                      </td>
                      <td className={worklistCellClass}>
                        <span className="font-mono text-xs text-gray-600">
                          {grant.resourceType}
                        </span>
                      </td>
                      <td className={worklistCellClass}>{grant.scopeType}</td>
                      <td className={worklistCellClass}>{grant.resourceId ?? '—'}</td>
                      <td className={worklistCellClass}>
                        {grant.validUntil ? grant.validUntil.slice(0, 10) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        />

        <UserDetailBlock
          title="Atribuições de role de acesso"
          emptyText="Nenhuma atribuição de role de acesso para esta identidade."
          state={accessAssignmentsResource.state}
          renderTable={(assignments) => (
            <div className={worklistTableCardClass}>
              <table className={worklistTableClass} aria-label="Atribuições de role de acesso do usuário">
                <thead className={worklistHeadCellClass}>
                  <tr>
                    <th scope="col" className={worklistHeadCellClass}>
                      Role
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Escopo
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Âncora
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Versão
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Atribuída em
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {assignments.map((assignment) => (
                    <tr key={assignment.id} className={worklistRowClass}>
                      <td className={worklistCellClass}>
                        <span className="font-mono text-xs text-gray-600">
                          {assignment.roleCode}
                        </span>
                      </td>
                      <td className={worklistCellClass}>{assignment.scopeType}</td>
                      <td className={worklistCellClass}>{assignment.scopeAnchor ?? '—'}</td>
                      <td className={worklistCellClass}>{assignment.version}</td>
                      <td className={worklistCellClass}>
                        {assignment.assignedAt.slice(0, 10)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        />

        <UserDetailBlock
          title="Atribuições de role de aprovação"
          emptyText="Nenhuma atribuição de role de aprovação para esta identidade."
          state={approvalAssignmentsResource.state}
          renderTable={(assignments) => (
            <div className={worklistTableCardClass}>
              <table className={worklistTableClass} aria-label="Atribuições de role de aprovação do usuário">
                <thead className={worklistHeadCellClass}>
                  <tr>
                    <th scope="col" className={worklistHeadCellClass}>
                      Role
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Escopo
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Âncora
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Versão
                    </th>
                    <th scope="col" className={worklistHeadCellClass}>
                      Criada em
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {assignments.map((assignment) => (
                    <tr key={assignment.id} className={worklistRowClass}>
                      <td className={worklistCellClass}>
                        <span className="font-mono text-xs text-gray-600">
                          {assignment.roleCode}
                        </span>
                      </td>
                      <td className={worklistCellClass}>{assignment.scopeType}</td>
                      <td className={worklistCellClass}>{assignment.scopeAnchor ?? '—'}</td>
                      <td className={worklistCellClass}>{assignment.version}</td>
                      <td className={worklistCellClass}>
                        {assignment.createdAt.slice(0, 10)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        />
      </div>
    </section>
  );
}

function UserDetailBlock<T>({
  title,
  emptyText,
  state,
  renderTable,
}: {
  title: string;
  emptyText: string;
  state:
    | { phase: 'loading' }
    | { phase: 'error'; error: unknown }
    | { phase: 'ready'; data: T[] };
  renderTable: (items: T[]) => ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h3>
      {state.phase === 'loading' ? (
        <LoadingState label={`Carregando ${title.toLowerCase()}…`} />
      ) : state.phase === 'error' ? (
        <p className="text-sm text-red-700" role="alert">
          Não foi possível carregar os dados desta seção.
        </p>
      ) : state.data.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyText}</p>
      ) : (
        renderTable(state.data)
      )}
    </div>
  );
}
