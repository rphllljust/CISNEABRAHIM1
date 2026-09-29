import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AccessAdminApiError,
  createGrant,
  getCatalog,
  listGrants,
  listIdentities,
  revokeGrant,
  type AccessAdminCatalog,
} from '../api/access-admin-api';
import { mapAccessAdminErrorToMessage } from '../api/access-admin-error-messages';
import { useAsyncResource } from '../hooks/useAccessAdminData';
import type { GrantInfo, IdentityInfo, ScopeEntry } from '../types';
import { Badge, Button, ConfirmAction, EmptyState, ErrorState, Field, FilterCard, Input, LoadingState, Modal, Select, Switch, filterControlClass, filterLabelClass, worklistCellClass, worklistTableClass, worklistHeadCellClass, worklistRowClass, worklistTableCardClass } from '../../ui';

/**
 * Opções de escopo de concessão oferecidas pelo console: GLOBAL (não ancorado)
 * e os escopos ancorados (UNIT/CLIENT/CONTRACT/DOCUMENT/FINANCIAL). O catálogo
 * do servidor continua sendo a fonte dos códigos.
 */
function grantScopeOptions(scopes: ScopeEntry[]): ScopeEntry[] {
  const options = scopes.filter(
    (scope) => scope.code === 'GLOBAL' || scope.anchored,
  );
  return [...options].sort((left, right) => {
    if (left.code === 'GLOBAL') {
      return -1;
    }
    if (right.code === 'GLOBAL') {
      return 1;
    }
    return left.code.localeCompare(right.code);
  });
}

export function GrantsTab() {
  const [identitySearch, setIdentitySearch] = useState('');
  const [identityFilter, setIdentityFilter] = useState('');
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const [pendingRevoke, setPendingRevoke] = useState<GrantInfo | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const identitiesResource = useAsyncResource<IdentityInfo[]>(() =>
    listIdentities({ query: identitySearch.trim() || undefined, limit: 100 }),
  );
  const grantsResource = useAsyncResource<GrantInfo[]>(() =>
    listGrants({
      identityId: identityFilter.trim() || undefined,
      includeRevoked,
    }),
  );

  const filterKey = `${identityFilter}|${includeRevoked ? '1' : '0'}`;
  const appliedFilterKeyRef = useRef(filterKey);

  useEffect(() => {
    if (appliedFilterKeyRef.current === filterKey) {
      return;
    }
    appliedFilterKeyRef.current = filterKey;
    grantsResource.refresh();
  }, [filterKey, grantsResource]);

  const identities = identitiesResource.state.phase === 'ready' ? identitiesResource.state.data : [];

  function searchIdentities(event: FormEvent): void {
    event.preventDefault();
    identitiesResource.refresh();
  }

  async function handleRevoke(): Promise<void> {
    if (!pendingRevoke) {
      return;
    }
    setRevoking(true);
    setRevokeError(null);
    try {
      await revokeGrant(pendingRevoke.id);
      setPendingRevoke(null);
      grantsResource.refresh();
    } catch (error) {
      setRevokeError(
        error instanceof AccessAdminApiError
          ? mapAccessAdminErrorToMessage(error.code, error.status)
          : 'Não foi possível revogar a concessão.',
      );
    } finally {
      setRevoking(false);
    }
  }

  function renderGrants(): React.ReactNode {
    if (grantsResource.state.phase === 'loading') {
      return <LoadingState label="Carregando concessões…" />;
    }
    if (grantsResource.state.phase === 'error') {
      const message =
        grantsResource.state.error instanceof AccessAdminApiError
          ? mapAccessAdminErrorToMessage(
              grantsResource.state.error.code,
              grantsResource.state.error.status,
            )
          : 'Não foi possível carregar as concessões.';
      return (
        <ErrorState title="Concessões" message={message} onRetry={grantsResource.refresh} />
      );
    }

    const grants = grantsResource.state.data;
    if (grants.length === 0) {
      return (
        <EmptyState
          title="Nenhuma concessão"
          description={
            identityFilter
              ? 'Esta identidade não possui concessões com os filtros selecionados.'
              : 'Crie a primeira concessão direta para começar.'
          }
        />
      );
    }

    return (
      <div className={worklistTableCardClass}>
        <table className={worklistTableClass} aria-label="Concessões diretas">
          <thead className={worklistHeadCellClass}>
            <tr>
              <th scope="col" className={worklistHeadCellClass}>
                Identidade
              </th>
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
                Versão
              </th>
              <th scope="col" className={worklistHeadCellClass}>
                Válida até
              </th>
              <th scope="col" className={worklistHeadCellClass}>
                Status
              </th>
              <th scope="col" className={worklistHeadCellClass}>
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {grants.map((grant) => {
              const revoked = grant.revokedAt !== null;
              return (
                <tr key={grant.id} className={worklistRowClass}>
                  <td className={worklistCellClass}>
                    <span className="font-mono text-xs text-gray-600">{grant.identityId}</span>
                  </td>
                  <td className={worklistCellClass}>
                    <span className="font-mono text-xs text-gray-600">{grant.action}</span>
                  </td>
                  <td className={worklistCellClass}>
                    <span className="font-mono text-xs text-gray-600">{grant.resourceType}</span>
                  </td>
                  <td className={worklistCellClass}>
                    <span className="font-mono text-xs text-gray-600">{grant.scopeType}</span>
                  </td>
                  <td className={worklistCellClass} title={grant.resourceId ?? undefined}>
                    {grant.resourceId ?? '—'}
                  </td>
                  <td className={worklistCellClass}>{grant.version}</td>
                  <td className={worklistCellClass}>
                    {grant.validUntil ? grant.validUntil.slice(0, 10) : '—'}
                  </td>
                  <td className={worklistCellClass}>
                    {revoked ? <Badge tone="neutral">Revogada</Badge> : <Badge tone="success">Ativa</Badge>}
                  </td>
                  <td className={worklistCellClass}>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={revoked}
                      onClick={() => {
                        setRevokeError(null);
                        setPendingRevoke(grant);
                      }}
                    >
                      Revogar
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-gray-500">
          Concessões diretas avaliadas pelo PDP. O servidor valida ação, recurso,
          escopo, auto-escalonamento e referências — o cliente não decide autoridade.
        </p>
        <Button type="button" onClick={() => setModalOpen(true)}>
          Nova concessão
        </Button>
      </div>

      <FilterCard>
        <form
          onSubmit={searchIdentities}
          className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div>
            <label className={filterLabelClass} htmlFor="grant-identity-search">
              Buscar identidade (login)
            </label>
            <input
              id="grant-identity-search"
              type="search"
              className={filterControlClass}
              value={identitySearch}
              onChange={(event) => setIdentitySearch(event.target.value)}
              placeholder="Ex.: admin"
            />
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="grant-identity-filter">
              Identidade
            </label>
            <select
              id="grant-identity-filter"
              className={filterControlClass}
              value={identityFilter}
              onChange={(event) => setIdentityFilter(event.target.value)}
            >
              <option value="">Todas as identidades</option>
              {identities.map((identity) => (
                <option key={identity.id} value={identity.id}>
                  {identity.login ?? identity.id}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" variant="secondary">
              Buscar
            </Button>
          </div>
          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
            <Switch
              id="grant-include-revoked"
              checked={includeRevoked}
              onChange={(event) => setIncludeRevoked(event.target.checked)}
            />
            <label htmlFor="grant-include-revoked" className="text-sm text-gray-700">
              Incluir revogadas
            </label>
          </div>
        </form>
      </FilterCard>

      {renderGrants()}

      {modalOpen ? (
        <NewGrantModal
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            grantsResource.refresh();
          }}
        />
      ) : null}

      <ConfirmAction
        open={pendingRevoke !== null}
        title="Revogar concessão"
        description={`Revogar a concessão ${pendingRevoke?.action ?? ''} (${
          pendingRevoke?.scopeType ?? ''
        }) da identidade ${pendingRevoke?.identityId ?? ''}?`}
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

function NewGrantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const catalogResource = useAsyncResource<AccessAdminCatalog>(() => getCatalog());

  const [identitySearch, setIdentitySearch] = useState('');
  const identitiesResource = useAsyncResource<IdentityInfo[]>(() =>
    listIdentities({ query: identitySearch.trim() || undefined, limit: 100 }),
  );

  const [identityId, setIdentityId] = useState('');
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [scopeType, setScopeType] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [validUntil, setValidUntil] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const catalog = catalogResource.state.phase === 'ready' ? catalogResource.state.data : null;
  const identities = identitiesResource.state.phase === 'ready' ? identitiesResource.state.data : [];
  const selectedScope = catalog?.scopes.find((scope) => scope.code === scopeType);
  const anchorRequired = selectedScope?.anchored === true;

  function searchIdentities(): void {
    identitiesResource.refresh();
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createGrant({
        identityId,
        action,
        resourceType,
        scopeType,
        resourceId:
          scopeType !== 'GLOBAL' && resourceId.trim() ? resourceId.trim() : undefined,
        validUntil: validUntil || undefined,
      });
      onCreated();
    } catch (error) {
      setSubmitError(
        error instanceof AccessAdminApiError
          ? mapAccessAdminErrorToMessage(error.code, error.status)
          : 'Não foi possível criar a concessão.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const actionCapabilities =
    catalog?.capabilities.filter(
      (capability) => capability.kind === 'action' || capability.kind === 'access-admin',
    ) ?? [];

  return (
    <Modal
      open
      title="Nova concessão"
      description="O servidor valida ação, recurso, escopo e referências antes de conceder. O cliente envia exatamente o que foi escolhido."
      onClose={onClose}
    >
      <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        {submitError ? (
          <p className="text-sm text-red-700" role="alert">
            {submitError}
          </p>
        ) : null}

        <div className="rounded-md bg-gray-50 p-3 ring-1 ring-gray-200 ring-inset">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className={filterLabelClass} htmlFor="grant-modal-identity-search">
                Buscar identidade (login)
              </label>
              <input
                id="grant-modal-identity-search"
                type="search"
                className={filterControlClass}
                value={identitySearch}
                onChange={(event) => setIdentitySearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    searchIdentities();
                  }
                }}
                placeholder="Ex.: compras"
              />
            </div>
            <Button type="button" variant="secondary" onClick={searchIdentities} disabled={submitting}>
              Buscar
            </Button>
          </div>
        </div>

        <Field label="Identidade" htmlFor="grant-modal-identity" required>
          {identitiesResource.state.phase === 'loading' ? (
            <LoadingState label="Carregando identidades…" />
          ) : identitiesResource.state.phase === 'error' ? (
            <p className="text-sm text-red-700" role="alert">
              Não foi possível carregar as identidades.
            </p>
          ) : (
            <Select
              id="grant-modal-identity"
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

        <Field label="Ação" htmlFor="grant-modal-action" required>
          {catalogResource.state.phase === 'loading' ? (
            <LoadingState label="Carregando catálogo…" />
          ) : catalogResource.state.phase === 'error' ? (
            <p className="text-sm text-red-700" role="alert">
              Não foi possível carregar o catálogo de capacidades.
            </p>
          ) : (
            <Select
              id="grant-modal-action"
              value={action}
              onChange={(event) => setAction(event.target.value)}
              required
              disabled={submitting}
            >
              <option value="">Selecione…</option>
              {actionCapabilities.map((capability) => (
                <option key={capability.code} value={capability.code}>
                  {capability.code}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Recurso (tipo)" htmlFor="grant-modal-resource" required>
          {catalogResource.state.phase === 'ready' ? (
            <Select
              id="grant-modal-resource"
              value={resourceType}
              onChange={(event) => setResourceType(event.target.value)}
              required
              disabled={submitting}
            >
              <option value="">Selecione…</option>
              {catalogResource.state.data.resources.map((resource) => (
                <option key={resource.code} value={resource.code}>
                  {resource.code}
                </option>
              ))}
            </Select>
          ) : (
            <LoadingState label="Carregando recursos…" />
          )}
        </Field>

        <Field label="Escopo (tipo)" htmlFor="grant-modal-scope" required>
          {catalogResource.state.phase === 'ready' ? (
            <Select
              id="grant-modal-scope"
              value={scopeType}
              onChange={(event) => setScopeType(event.target.value)}
              required
              disabled={submitting}
            >
              <option value="">Selecione…</option>
              {grantScopeOptions(catalogResource.state.data.scopes).map((scope) => (
                <option key={scope.code} value={scope.code}>
                  {scope.code}
                  {scope.anchored ? ' (ancorado)' : ''}
                </option>
              ))}
            </Select>
          ) : (
            <LoadingState label="Carregando escopos…" />
          )}
        </Field>

        {anchorRequired ? (
          <Field
            label="Âncora do escopo (recurso id)"
            htmlFor="grant-modal-anchor"
            required
            hint="Identificador livre; o servidor valida a referência de escopo antes de conceder."
          >
            <Input
              id="grant-modal-anchor"
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
              disabled={submitting}
              required
            />
          </Field>
        ) : null}

        <Field
          label="Válida até (opcional)"
          htmlFor="grant-modal-valid-until"
          hint="Vazio significa sem expiração; a data é validada pelo servidor."
        >
          <Input
            id="grant-modal-valid-until"
            type="date"
            value={validUntil}
            onChange={(event) => setValidUntil(event.target.value)}
            disabled={submitting}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={submitting} loading={submitting}>
            Conceder
          </Button>
        </div>
      </form>
    </Modal>
  );
}
