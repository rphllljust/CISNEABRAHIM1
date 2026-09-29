import { useState, type FormEvent } from 'react';
import {
  AccessAdminApiError,
  assignApprovalRole,
  getCatalog,
  listApprovalMatrices,
  listApprovalMatrixRules,
  listApprovalRoleAssignments,
  listIdentities,
  type AccessAdminCatalog,
} from '../api/access-admin-api';
import { mapAccessAdminErrorToMessage } from '../api/access-admin-error-messages';
import { useAsyncResource } from '../hooks/useAccessAdminData';
import type {
  ApprovalMatrixInfo,
  ApprovalMatrixRule,
  ApprovalRoleAssignment,
  IdentityInfo,
} from '../types';
import { Button, EmptyState, ErrorState, Field, Input, LoadingState, Select, filterControlClass, filterLabelClass, worklistCellClass, worklistTableClass, worklistHeadCellClass, worklistRowClass, worklistTableCardClass } from '../../ui';

export function MatricesTab() {
  const matricesResource = useAsyncResource<ApprovalMatrixInfo[]>(() => listApprovalMatrices());
  const catalogResource = useAsyncResource<AccessAdminCatalog>(() => getCatalog());
  const approvalsResource = useAsyncResource<ApprovalRoleAssignment[]>(() =>
    listApprovalRoleAssignments(),
  );

  const [selectedMatrix, setSelectedMatrix] = useState<ApprovalMatrixInfo | null>(null);

  // Formulário de atribuição de role de aprovação.
  const [identityQuery, setIdentityQuery] = useState('');
  const identitiesResource = useAsyncResource<IdentityInfo[]>(() =>
    listIdentities({ query: identityQuery.trim() || undefined, limit: 100 }),
  );
  const [identityId, setIdentityId] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [scopeType, setScopeType] = useState('');
  const [scopeAnchor, setScopeAnchor] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const identities = identitiesResource.state.phase === 'ready' ? identitiesResource.state.data : [];
  const scopes = catalogResource.state.phase === 'ready' ? catalogResource.state.data.scopes : [];
  const selectedScope = scopes.find((scope) => scope.code === scopeType);
  const anchorRequired = selectedScope?.anchored === true;

  function searchIdentities(): void {
    identitiesResource.refresh();
  }

  async function handleAssign(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      await assignApprovalRole({
        identityId,
        roleCode: roleCode.trim(),
        scopeType,
        scopeAnchor: scopeAnchor.trim() || undefined,
      });
      setIdentityId('');
      setRoleCode('');
      setScopeType('');
      setScopeAnchor('');
      approvalsResource.refresh();
    } catch (error) {
      setSubmitError(
        error instanceof AccessAdminApiError
          ? mapAccessAdminErrorToMessage(error.code, error.status)
          : 'Não foi possível atribuir a role de aprovação.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-gray-500">
        Matrizes de aprovação (RBAC financeiro) espelhadas do servidor. A edição completa de
        versões, regras e limites e a publicação pertencem ao fluxo financeiro existente;
        este console apenas espelha as matrizes e permite a atribuição de roles de aprovação.
      </p>

      {matricesResource.state.phase === 'loading' ? (
        <LoadingState label="Carregando matrizes de aprovação…" />
      ) : matricesResource.state.phase === 'error' ? (
        <ErrorState
          title="Matrizes de aprovação"
          message={
            matricesResource.state.error instanceof AccessAdminApiError
              ? mapAccessAdminErrorToMessage(
                  matricesResource.state.error.code,
                  matricesResource.state.error.status,
                )
              : 'Não foi possível carregar as matrizes de aprovação.'
          }
          onRetry={matricesResource.refresh}
        />
      ) : matricesResource.state.data.length === 0 ? (
        <EmptyState
          title="Nenhuma matriz de aprovação"
          description="O servidor não retornou matrizes de aprovação."
        />
      ) : (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Matrizes de aprovação">
            <thead className={worklistHeadCellClass}>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  Código
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Moeda
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Versão publicada
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Rascunho
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Versões publicadas
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Rascunhos
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {matricesResource.state.data.map((matrix) => {
                const isSelected = selectedMatrix?.id === matrix.id;
                return (
                  <tr
                    key={matrix.id}
                    className={
                      isSelected
                        ? 'cursor-pointer bg-brand-50/70 transition hover:bg-brand-50'
                        : 'cursor-pointer transition hover:bg-gray-50'
                    }
                    onClick={() =>
                      setSelectedMatrix((current) =>
                        current?.id === matrix.id ? null : matrix,
                      )
                    }
                    data-testid={`matrix-row-${matrix.code}`}
                  >
                    <td className={worklistCellClass}>
                      <span className="font-mono text-sm text-gray-600">{matrix.code}</span>
                    </td>
                    <td className={worklistCellClass}>{matrix.currencyCode}</td>
                    <td className={worklistCellClass}>
                      {matrix.publishedVersion ?? '—'}
                    </td>
                    <td className={worklistCellClass}>{matrix.draftVersion}</td>
                    <td className={worklistCellClass}>{matrix.publishedVersions}</td>
                    <td className={worklistCellClass}>{matrix.draftVersions}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedMatrix ? (
        <MatrixRulesSection key={selectedMatrix.id} matrix={selectedMatrix} />
      ) : null}

      <section aria-label="Atribuições de role de aprovação" className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
        <h2 className="text-sm font-semibold text-gray-900">
          Atribuições de role de aprovação
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Lista somente-leitura retornada pelo servidor.
        </p>
        <div className="mt-4">
          {approvalsResource.state.phase === 'loading' ? (
            <LoadingState label="Carregando atribuições de role de aprovação…" />
          ) : approvalsResource.state.phase === 'error' ? (
            <p className="text-sm text-red-700" role="alert">
              Não foi possível carregar as atribuições de role de aprovação.
            </p>
          ) : approvalsResource.state.data.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nenhuma atribuição de role de aprovação registrada.
            </p>
          ) : (
            <div className={worklistTableCardClass}>
              <table className={worklistTableClass} aria-label="Atribuições de role de aprovação">
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
                      Criada em
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {approvalsResource.state.data.map((assignment) => (
                    <tr key={assignment.id} className={worklistRowClass}>
                      <td className={worklistCellClass}>
                        {assignment.identityLogin ?? assignment.identityId}
                      </td>
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
        </div>
      </section>

      <section
        aria-label="Atribuir role de aprovação"
        className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5"
      >
        <h2 className="text-sm font-semibold text-gray-900">Atribuir role de aprovação</h2>
        <p className="mt-1 text-sm text-gray-500">
          O servidor valida a identidade, o código da role e o escopo. Atribuição
          duplicada retorna o registro existente — o servidor decide.
        </p>

        <form onSubmit={(event) => void handleAssign(event)} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className={filterLabelClass} htmlFor="approval-assign-identity-search">
                  Buscar identidade (login)
                </label>
                <input
                  id="approval-assign-identity-search"
                  type="search"
                  className={filterControlClass}
                  value={identityQuery}
                  onChange={(event) => setIdentityQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      searchIdentities();
                    }
                  }}
                  placeholder="Ex.: controller"
                />
              </div>
              <Button type="button" variant="secondary" onClick={searchIdentities} disabled={submitting}>
                Buscar
              </Button>
            </div>
          </div>

          <Field label="Identidade" htmlFor="approval-assign-identity" required>
            {identitiesResource.state.phase === 'loading' ? (
              <LoadingState label="Carregando identidades…" />
            ) : identitiesResource.state.phase === 'error' ? (
              <p className="text-sm text-red-700" role="alert">
                Não foi possível carregar as identidades.
              </p>
            ) : (
              <Select
                id="approval-assign-identity"
                value={identityId}
                onChange={(event) => setIdentityId(event.target.value)}
                required
                disabled={submitting}
              >
                <option value="">Selecione…</option>
                {identities.map((identity) => (
                  <option key={identity.id} value={identity.id}>
                    {identity.login ?? identity.id}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Role de aprovação"
            htmlFor="approval-assign-role"
            required
            hint="Código livre validado pelo servidor (ex.: FINANCIAL_CONTROLLER)."
          >
            <Input
              id="approval-assign-role"
              value={roleCode}
              onChange={(event) => setRoleCode(event.target.value)}
              placeholder="FINANCIAL_CONTROLLER"
              required
              disabled={submitting}
            />
          </Field>

          <Field label="Escopo (tipo)" htmlFor="approval-assign-scope" required>
            {catalogResource.state.phase === 'loading' ? (
              <LoadingState label="Carregando escopos…" />
            ) : catalogResource.state.phase === 'error' ? (
              <p className="text-sm text-red-700" role="alert">
                Não foi possível carregar os escopos.
              </p>
            ) : (
              <Select
                id="approval-assign-scope"
                value={scopeType}
                onChange={(event) => setScopeType(event.target.value)}
                required
                disabled={submitting}
              >
                <option value="">Selecione…</option>
                {scopes.map((scope) => (
                  <option key={scope.code} value={scope.code}>
                    {scope.code}
                    {scope.anchored ? ' (ancorado)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {anchorRequired ? (
            <Field
              label="Âncora do escopo (id)"
              htmlFor="approval-assign-anchor"
              hint="Identificador livre; o servidor decide como a âncora restringe a aprovação."
            >
              <Input
                id="approval-assign-anchor"
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
      </section>
    </div>
  );
}

function MatrixRulesSection({ matrix }: { matrix: ApprovalMatrixInfo }) {
  const [versionStatus, setVersionStatus] = useState<'PUBLISHED' | 'DRAFT'>('PUBLISHED');
  const rulesResource = useAsyncResource<ApprovalMatrixRule[]>(() =>
    listApprovalMatrixRules(matrix.id, versionStatus),
  );

  function selectVersion(status: 'PUBLISHED' | 'DRAFT'): void {
    setVersionStatus(status);
    rulesResource.refresh();
  }

  return (
    <section aria-label={`Regras da matriz ${matrix.code}`} className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Regras da matriz <span className="font-mono">{matrix.code}</span>
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Regras somente-leitura da versão selecionada, retornadas pelo servidor.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={versionStatus === 'PUBLISHED' ? 'primary' : 'secondary'}
            onClick={() => selectVersion('PUBLISHED')}
          >
            Publicada
          </Button>
          <Button
            type="button"
            variant={versionStatus === 'DRAFT' ? 'primary' : 'secondary'}
            onClick={() => selectVersion('DRAFT')}
          >
            Rascunho
          </Button>
        </div>
      </div>

      <div className="mt-4">
        {rulesResource.state.phase === 'loading' ? (
          <LoadingState label="Carregando regras…" />
        ) : rulesResource.state.phase === 'error' ? (
          <ErrorState
            title="Regras"
            message={
              rulesResource.state.error instanceof AccessAdminApiError
                ? mapAccessAdminErrorToMessage(
                    rulesResource.state.error.code,
                    rulesResource.state.error.status,
                  )
                : 'Não foi possível carregar as regras da matriz.'
            }
            onRetry={rulesResource.refresh}
          />
        ) : rulesResource.state.data.length === 0 ? (
          <p className="text-sm text-gray-500">
            Nenhuma regra nesta versão ({versionStatus === 'PUBLISHED' ? 'publicada' : 'rascunho'}).
          </p>
        ) : (
          <div className={worklistTableCardClass}>
            <table className={worklistTableClass} aria-label={`Regras da matriz ${matrix.code}`}>
              <thead className={worklistHeadCellClass}>
                <tr>
                  <th scope="col" className={worklistHeadCellClass}>
                    Linha
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Operação
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Role
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Capacidade
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Escopo
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Âncora
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Limite
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rulesResource.state.data.map((rule) => (
                  <tr key={rule.id} className={worklistRowClass}>
                    <td className={worklistCellClass}>{rule.lineNumber}</td>
                    <td className={worklistCellClass}>
                      <span className="font-mono text-xs text-gray-600">{rule.operation}</span>
                    </td>
                    <td className={worklistCellClass}>
                      <span className="font-mono text-xs text-gray-600">{rule.roleCode}</span>
                    </td>
                    <td className={worklistCellClass}>
                      <span className="font-mono text-xs text-gray-600">{rule.capability}</span>
                    </td>
                    <td className={worklistCellClass}>{rule.scopeType}</td>
                    <td className={worklistCellClass}>{rule.scopeAnchor ?? '—'}</td>
                    <td className={worklistCellClass}>
                      <span className="tabular-nums">{rule.amountLimit}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
