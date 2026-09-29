import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AccessAdminApiError,
  createRole,
  getCatalog,
  getRole,
  listRoles,
  updateRole,
  type AccessAdminCatalog,
} from '../api/access-admin-api';
import { mapAccessAdminErrorToMessage } from '../api/access-admin-error-messages';
import { useAsyncResource } from '../hooks/useAccessAdminData';
import { AccessAdminErrorCodes, type AccessRole } from '../types';
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Input, LoadingState, Modal, Select, Textarea, VersionConflictBanner, worklistCellClass, worklistTableClass, worklistHeadCellClass, worklistRowClass, worklistTableCardClass } from '../../ui';

export function RolesTab() {
  const { state, refresh } = useAsyncResource<AccessRole[]>(() => listRoles());
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; code: string } | null>(
    null,
  );

  if (state.phase === 'loading') {
    return <LoadingState label="Carregando roles…" />;
  }

  if (state.phase === 'error') {
    const message =
      state.error instanceof AccessAdminApiError
        ? mapAccessAdminErrorToMessage(state.error.code, state.error.status)
        : 'Não foi possível carregar as roles.';
    return <ErrorState title="Roles" message={message} onRetry={refresh} />;
  }

  const roles = state.data;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-gray-500">
          O servidor impõe a segregação de funções (SoD) e valida as combinações de
          capacidades. O cliente não calcula autoridade: envia exatamente os códigos escolhidos.
        </p>
        <Button type="button" onClick={() => setModal({ mode: 'create' })}>
          Nova role
        </Button>
      </div>

      <div className="mb-4">
        <Alert tone="info">
          Roles ACTIVE com atribuições são ENFORCED pelo PDP: alterar uma role
          (capacidades ou status) altera a permissão em tempo de execução nas próximas
          decisões do PDP.
        </Alert>
      </div>

      {roles.length === 0 ? (
        <EmptyState
          title="Nenhuma role"
          description="Crie a primeira role de acesso para começar."
        />
      ) : (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Roles de acesso">
            <thead className={worklistHeadCellClass}>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  Código
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Label
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Status
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Versão
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Capacidades
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {roles.map((role) => (
                <tr key={role.id} className={worklistRowClass}>
                  <td className={worklistCellClass}>
                    <span className="font-mono text-gray-600">{role.code}</span>
                  </td>
                  <td className={worklistCellClass}>{role.label}</td>
                  <td className={worklistCellClass}>
                    <Badge tone={role.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {role.status === 'ACTIVE' ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </td>
                  <td className={worklistCellClass} data-testid={`role-version-${role.code}`}>
                    {role.version}
                  </td>
                  <td
                    className={worklistCellClass}
                    title={role.capabilities.join(', ') || undefined}
                  >
                    {role.capabilities.length === 0
                      ? '—'
                      : `${role.capabilities.length} capacidade(s)`}
                  </td>
                  <td className={worklistCellClass}>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setModal({ mode: 'edit', code: role.code })}
                    >
                      Editar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal ? (
        <RoleEditorModal
          mode={modal.mode}
          roleCode={modal.mode === 'edit' ? modal.code : undefined}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

type CapabilityGroup = {
  title: string;
  class?: 'ACCESS_ADMIN' | 'FINANCIAL_APPROVAL';
};

const CAPABILITY_GROUPS: CapabilityGroup[] = [
  { title: 'Administração de acesso', class: 'ACCESS_ADMIN' },
  { title: 'Aprovação financeira', class: 'FINANCIAL_APPROVAL' },
  { title: 'Sem classe', class: undefined },
];

function RoleEditorModal({
  mode,
  roleCode,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  roleCode?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = mode === 'edit';
  const catalogResource = useAsyncResource<AccessAdminCatalog>(() => getCatalog());

  const [loadingRole, setLoadingRole] = useState(isEdit);
  const [roleLoadError, setRoleLoadError] = useState<string | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);

  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [expectedVersion, setExpectedVersion] = useState(1);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadRole = useCallback(
    async (signal?: AbortSignal) => {
      if (!isEdit || !roleCode) {
        return;
      }
      setLoadingRole(true);
      setRoleLoadError(null);
      setVersionConflict(false);
      try {
        const loaded = await getRole(roleCode, signal);
        setCode(loaded.code);
        setLabel(loaded.label);
        setDescription(loaded.description);
        setStatus(loaded.status);
        setCapabilities([...loaded.capabilities]);
        setExpectedVersion(loaded.version);
      } catch (error) {
        setRoleLoadError(
          error instanceof AccessAdminApiError
            ? mapAccessAdminErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar a role.',
        );
      } finally {
        setLoadingRole(false);
      }
    },
    [isEdit, roleCode],
  );

  useEffect(() => {
    void loadRole();
  }, [loadRole]);

  const catalogCapabilities = useMemo(() => {
    if (catalogResource.state.phase !== 'ready') {
      return [];
    }
    return catalogResource.state.data.capabilities;
  }, [catalogResource.state]);

  function toggleCapability(capabilityCode: string): void {
    setCapabilities((current) =>
      current.includes(capabilityCode)
        ? current.filter((entry) => entry !== capabilityCode)
        : [...current, capabilityCode],
    );
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setVersionConflict(false);
    try {
      if (isEdit && roleCode) {
        await updateRole(roleCode, {
          label,
          description,
          status,
          capabilities,
          expectedVersion,
        });
      } else {
        await createRole({
          code,
          label,
          description: description.trim() || undefined,
          capabilities,
        });
      }
      onSaved();
    } catch (error) {
      if (
        error instanceof AccessAdminApiError &&
        error.code === AccessAdminErrorCodes.VERSION_CONFLICT
      ) {
        setVersionConflict(true);
      }
      setSubmitError(
        error instanceof AccessAdminApiError
          ? mapAccessAdminErrorToMessage(error.code, error.status)
          : 'Não foi possível salvar a role.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      title={isEdit ? `Editar role ${code || roleCode || ''}` : 'Nova role'}
      description="O servidor valida os códigos escolhidos e impõe SoD. O cliente não decide autoridade."
      onClose={onClose}
    >
      <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        {versionConflict ? (
          <VersionConflictBanner
            message="A role foi alterada por outra sessão. Recarregue para obter a versão atual antes de salvar."
            reloadLabel="Recarregar"
            onReload={() => void loadRole()}
          />
        ) : null}

        {submitError && !versionConflict ? (
          <p className="text-sm text-red-700" role="alert">
            {submitError}
          </p>
        ) : null}

        {roleLoadError ? (
          <p className="text-sm text-red-700" role="alert">
            {roleLoadError}
          </p>
        ) : null}

        {loadingRole ? (
          <LoadingState label="Carregando role…" />
        ) : (
          <>
            <Field label="Código" htmlFor="role-code" required>
              <Input
                id="role-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={isEdit || submitting}
                required
              />
            </Field>
            <Field label="Label" htmlFor="role-label" required>
              <Input
                id="role-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                disabled={submitting}
                required
              />
            </Field>
            <Field label="Descrição" htmlFor="role-description">
              <Textarea
                id="role-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={submitting}
              />
            </Field>
            {isEdit ? (
              <Field label="Status" htmlFor="role-status">
                <Select
                  id="role-status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as 'ACTIVE' | 'INACTIVE')}
                  disabled={submitting}
                >
                  <option value="ACTIVE">Ativa</option>
                  <option value="INACTIVE">Inativa</option>
                </Select>
              </Field>
            ) : null}

            <fieldset>
              <legend className="mb-1.5 block text-xs font-semibold text-gray-700">
                Capacidades
              </legend>
              {catalogResource.state.phase === 'loading' ? (
                <LoadingState label="Carregando catálogo…" />
              ) : catalogResource.state.phase === 'error' ? (
                <p className="text-sm text-red-700" role="alert">
                  Não foi possível carregar o catálogo de capacidades.
                </p>
              ) : (
                <div className="space-y-3">
                  {CAPABILITY_GROUPS.map((group) => {
                    const items = catalogCapabilities.filter((capability) =>
                      group.class
                        ? capability.class === group.class
                        : capability.class === undefined,
                    );
                    if (items.length === 0) {
                      return null;
                    }
                    return (
                      <div key={group.title}>
                        <p className="text-xs font-semibold text-gray-500">{group.title}</p>
                        <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                          {items.map((capability) => (
                            <label
                              key={capability.code}
                              className="flex items-center gap-2 text-sm text-gray-700"
                            >
                              <input
                                type="checkbox"
                                checked={capabilities.includes(capability.code)}
                                onChange={() => toggleCapability(capability.code)}
                                disabled={submitting}
                              />
                              <span className="font-mono text-xs">{capability.code}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </fieldset>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={submitting || loadingRole || versionConflict}
            loading={submitting}
          >
            Salvar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
