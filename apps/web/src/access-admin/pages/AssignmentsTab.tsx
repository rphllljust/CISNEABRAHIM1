import { useState, type FormEvent, type ReactNode } from 'react';
import {
  AccessAdminApiError,
  assignRole,
  getCatalog,
  listAssignments,
  listRoles,
  revokeAssignment,
  type AccessAdminCatalog,
} from '../api/access-admin-api';
import { mapAccessAdminErrorToMessage } from '../api/access-admin-error-messages';
import { useAsyncResource } from '../hooks/useAccessAdminData';
import type { AccessRole, RoleAssignment } from '../types';
import { Alert, Button, ConfirmAction, EmptyState, ErrorState, Field, Input, LoadingState, Select, worklistCellClass, worklistTableClass, worklistHeadCellClass, worklistRowClass, worklistTableCardClass } from '../../ui';

export function AssignmentsTab() {
  const assignmentsResource = useAsyncResource<RoleAssignment[]>(() => listAssignments());
  const rolesResource = useAsyncResource<AccessRole[]>(() => listRoles());
  const scopesResource = useAsyncResource<AccessAdminCatalog>(() => getCatalog());

  const [identityId, setIdentityId] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [scopeType, setScopeType] = useState('');
  const [scopeAnchor, setScopeAnchor] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [pendingRevoke, setPendingRevoke] = useState<RoleAssignment | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const roles = rolesResource.state.phase === 'ready' ? rolesResource.state.data : [];
  const scopes = scopesResource.state.phase === 'ready' ? scopesResource.state.data.scopes : [];
  const selectedScope = scopes.find((scope) => scope.code === scopeType);
  const anchorRequired = selectedScope?.anchored === true;

  async function handleAssign(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      await assignRole({
        roleCode,
        identityId: identityId.trim(),
        scopeType,
        scopeAnchor: scopeAnchor.trim() || undefined,
      });
      setIdentityId('');
      setRoleCode('');
      setScopeType('');
      setScopeAnchor('');
      assignmentsResource.refresh();
    } catch (error) {
      setSubmitError(
        error instanceof AccessAdminApiError
          ? mapAccessAdminErrorToMessage(error.code, error.status)
          : 'Não foi possível atribuir a role.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(): Promise<void> {
    if (!pendingRevoke) {
      return;
    }
    setRevoking(true);
    setRevokeError(null);
    try {
      await revokeAssignment(pendingRevoke.id);
      setPendingRevoke(null);
      assignmentsResource.refresh();
    } catch (error) {
      setRevokeError(
        error instanceof AccessAdminApiError
          ? mapAccessAdminErrorToMessage(error.code, error.status)
          : 'Não foi possível revogar a atribuição.',
      );
    } finally {
      setRevoking(false);
    }
  }

  function renderAssignments(): ReactNode {
    if (assignmentsResource.state.phase === 'loading') {
      return <LoadingState label="Carregando atribuições…" />;
    }
    if (assignmentsResource.state.phase === 'error') {
      const message =
        assignmentsResource.state.error instanceof AccessAdminApiError
          ? mapAccessAdminErrorToMessage(
              assignmentsResource.state.error.code,
              assignmentsResource.state.error.status,
            )
          : 'Não foi possível carregar as atribuições.';
      return <ErrorState title="Atribuições" message={message} onRetry={assignmentsResource.refresh} />;
    }

    const assignments = assignmentsResource.state.data;
    if (assignments.length === 0) {
      return <EmptyState title="Nenhuma atribuição" description="Atribua uma role a uma identidade." />;
    }

    return (
      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Atribuições de role">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>
                Identidade
              </th>
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
              <th scope="col" className={worklistHeadCellClass}>
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {assignments.map((assignment) => (
              <tr key={assignment.id} className={worklistRowClass}>
                <td className={worklistCellClass}>
                  {assignment.identityLogin ?? assignment.identityId}
                </td>
                <td className={worklistCellClass}>
                  <span className="font-mono text-xs text-gray-600">{assignment.roleCode}</span>
                </td>
                <td className={worklistCellClass}>
                  <span className="font-mono text-xs text-gray-600">{assignment.scopeType}</span>
                </td>
                <td className={worklistCellClass}>
                  {assignment.scopeAnchor ?? '—'}
                </td>
                <td className={worklistCellClass}>{assignment.version}</td>
                <td className={worklistCellClass}>{assignment.assignedAt.slice(0, 10)}</td>
                <td className={worklistCellClass}>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={assignment.revokedAt !== null}
                    onClick={() => {
                      setRevokeError(null);
                      setPendingRevoke(assignment);
                    }}
                  >
                    Revogar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <Alert tone="info">
          Roles ACTIVE com atribuições são ENFORCED pelo PDP: revogar uma atribuição remove
          o acesso imediatamente nas próximas decisões do PDP.
        </Alert>
      </div>

      <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
        <h2 className="text-sm font-semibold text-gray-900">Atribuir role</h2>
        <p className="mt-1 text-sm text-gray-500">
          O servidor valida a atribuição e impõe SoD e regras de escalação. O cliente envia
          exatamente o que foi preenchido.
        </p>
        <form onSubmit={(event) => void handleAssign(event)} className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Identidade (id)" htmlFor="assignment-identity" required>
            <Input
              id="assignment-identity"
              value={identityId}
              onChange={(event) => setIdentityId(event.target.value)}
              required
              disabled={submitting}
            />
          </Field>
          <Field label="Role" htmlFor="assignment-role" required>
            {rolesResource.state.phase === 'loading' ? (
              <LoadingState label="Carregando roles…" />
            ) : rolesResource.state.phase === 'error' ? (
              <p className="text-sm text-red-700" role="alert">
                Não foi possível carregar as roles.
              </p>
            ) : (
              <Select
                id="assignment-role"
                value={roleCode}
                onChange={(event) => setRoleCode(event.target.value)}
                required
                disabled={submitting}
              >
                <option value="">Selecione…</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.code}>
                    {role.code} — {role.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Escopo (tipo)" htmlFor="assignment-scope" required>
            {scopesResource.state.phase === 'loading' ? (
              <LoadingState label="Carregando escopos…" />
            ) : scopesResource.state.phase === 'error' ? (
              <p className="text-sm text-red-700" role="alert">
                Não foi possível carregar os escopos.
              </p>
            ) : (
              <Select
                id="assignment-scope"
                value={scopeType}
                onChange={(event) => setScopeType(event.target.value)}
                required
                disabled={submitting}
              >
                <option value="">Selecione…</option>
                {scopes.map((scope) => (
                  <option key={scope.code} value={scope.code}>
                    {scope.code}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {anchorRequired ? (
            <Field
              label="Âncora do escopo (id)"
              htmlFor="assignment-anchor"
              hint="Identificador livre validado pelo servidor; o cliente não sugere âncoras."
            >
              <Input
                id="assignment-anchor"
                value={scopeAnchor}
                onChange={(event) => setScopeAnchor(event.target.value)}
                disabled={submitting}
              />
            </Field>
          ) : null}

          {submitError ? (
            <p className="text-sm text-red-700 sm:col-span-2" role="alert">
              {submitError}
            </p>
          ) : null}

          <div className="sm:col-span-2">
            <Button type="submit" disabled={submitting} loading={submitting}>
              Atribuir
            </Button>
          </div>
        </form>
      </div>

      {renderAssignments()}

      <ConfirmAction
        open={pendingRevoke !== null}
        title="Revogar atribuição"
        description={`Revogar a atribuição da role ${pendingRevoke?.roleCode ?? ''} para ${
          pendingRevoke?.identityLogin ?? pendingRevoke?.identityId ?? ''
        }?`}
        confirmLabel="Revogar"
        confirmVariant="danger"
        loading={revoking}
        onConfirm={() => void handleRevoke()}
        onCancel={() => {
          setPendingRevoke(null);
          setRevokeError(null);
        }}
      >
        {revokeError ? (
          <p className="text-sm text-red-700" role="alert">
            {revokeError}
          </p>
        ) : null}
      </ConfirmAction>
    </div>
  );
}
