import { useCallback, useEffect, useState } from 'react';
import { listProposals, ProposalsApiError } from '../api/proposals-api';
import { mapProposalErrorToMessage } from '../api/proposal-error-messages';
import { useProposalCapabilities } from '../hooks/useProposalCapabilities';
import type { Proposal } from '../types/proposal.types';
import { ProposalStatusBadge } from '../components/ProposalStatusBadge';
import {
  PROPOSAL_NO_VERSION_LABEL,
  formatProposalValidity,
  proposalNextAction,
} from '../utils/proposal-list-presentation';
import { formatMoneyBrl } from '../../ui/format/money';
import { Button } from '../../ui/Button';
import { Link } from 'react-router-dom';
import {
  EnterpriseField,
  EnterpriseListHeader,
  EnterpriseMetric,
  EnterpriseToolbar,
  PrimaryRecordCell,
  RecordStatusCell,
  RowActionMenu,
  enterpriseCellClass,
  enterpriseControlClass,
  enterpriseNumericCellClass,
  enterpriseNumericHeadCellClass,
  enterpriseRowClass,
  enterpriseTableCardClass,
  enterpriseTableClass,
  enterpriseHeadCellClass,
  rowPrimaryActionClass,
  rowSecondaryActionClass,
} from '../../ui/enterprise-list';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePagination,
  ModulePrimaryLink,
} from '../../ui/module-layout';

const PAGE_SIZE = 20;

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: Proposal[]; offset: number; hasMore: boolean };

export function ProposalsListPage() {
  const { capabilities } = useProposalCapabilities();
  const [clientFilter, setClientFilter] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  const loadPage = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listProposals(
          {
            limit: PAGE_SIZE,
            offset,
            clientId: clientFilter.trim() || undefined,
            unitId: unitFilter.trim() || undefined,
          },
          signal,
        );
        setListState({
          phase: 'ready',
          items: response.items,
          offset: response.offset,
          hasMore: response.items.length === response.limit,
        });
      } catch (error) {
        if (error instanceof ProposalsApiError) {
          if (error.kind === 'denied') {
            setListState({ phase: 'denied' });
            return;
          }
          setListState({
            phase: 'error',
            message: mapProposalErrorToMessage(error.code, error.status),
            retryable: error.kind === 'network' || error.kind === 'unknown',
          });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar as propostas.',
          retryable: true,
        });
      }
    },
    [clientFilter, unitFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(0, controller.signal);
    return () => controller.abort();
  }, [loadPage]);

  if (listState.phase === 'loading') {
    return (
      <ModulePage>
        <ModuleLoadingState title="Propostas comerciais" message="Carregando propostas…" />
      </ModulePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModulePage>
        <ModuleDeniedState
        title="Propostas comerciais"
        message="Você não tem permissão para listar propostas."
      />
      </ModulePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
        title="Propostas comerciais"
        message={listState.message}
        retryable={listState.retryable}
        onRetry={() => void loadPage(0)}
      />
      </ModulePage>
    );
  }

  const { items, offset, hasMore } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const hasActiveFilters = Boolean(clientFilter.trim() || unitFilter.trim());
  // Contagens derivadas das linhas JA carregadas nesta pagina — rotuladas como tal para nao
  // sugerir um total global que a listagem nao recebe do backend.
  const openCount = items.filter(
    (item) => item.currentVersionStatus === 'ISSUED' || item.currentVersionStatus === 'DRAFT',
  ).length;
  const expiredCount = items.filter((item) => item.currentVersionStatus === 'EXPIRED').length;

  return (
    <ModulePage>
      <EnterpriseListHeader
        title="Propostas comerciais"
        description="Pipeline comercial no seu escopo autorizado."
        metrics={
          <>
            <EnterpriseMetric value={items.length} label="nesta página" />
            <EnterpriseMetric value={openCount} label="em aberto" tone="info" />
            <EnterpriseMetric
              value={expiredCount}
              label="expiradas"
              tone={expiredCount > 0 ? 'critical' : 'neutral'}
            />
          </>
        }
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/proposals/new">Nova proposta</ModulePrimaryLink>
          ) : null
        }
      />

      <div className={enterpriseTableCardClass}>
        <EnterpriseToolbar>
          <EnterpriseField label="Cliente" htmlFor="proposal-client-filter" className="w-56">
            <input
              id="proposal-client-filter"
              type="search"
              className={enterpriseControlClass}
              value={clientFilter}
              onChange={(event) => setClientFilter(event.target.value)}
              placeholder="UUID do cliente"
            />
          </EnterpriseField>
          <EnterpriseField label="Unidade" htmlFor="proposal-unit-filter" className="w-44">
            <input
              id="proposal-unit-filter"
              type="search"
              className={enterpriseControlClass}
              value={unitFilter}
              onChange={(event) => setUnitFilter(event.target.value)}
              placeholder="Filtrar por unidade"
            />
          </EnterpriseField>
          {hasActiveFilters ? (
            <Button
              type="button"
              variant="secondary"
              className="px-2.5 py-1.5 text-xs"
              onClick={() => {
                setClientFilter('');
                setUnitFilter('');
              }}
            >
              Limpar
            </Button>
          ) : null}
        </EnterpriseToolbar>

        {items.length === 0 ? (
          <p className="px-3 py-6 text-sm text-gray-500" role="status">
            Nenhuma proposta encontrada.
          </p>
        ) : (
          <table className={enterpriseTableClass} aria-label="Lista de propostas comerciais">
            <thead>
              <tr>
                <th scope="col" className={enterpriseHeadCellClass}>
                  Proposta
                </th>
                <th scope="col" className={enterpriseHeadCellClass}>
                  Situação
                </th>
                <th scope="col" className={enterpriseNumericHeadCellClass}>
                  Valor
                </th>
                <th scope="col" className={enterpriseNumericHeadCellClass}>
                  Próxima ação
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={enterpriseRowClass}>
                  <td className={enterpriseCellClass}>
                    <PrimaryRecordCell
                      href={`/app/proposals/${item.id}`}
                      identifier={item.proposalCode}
                      context={item.title}
                      meta={
                        item.currentVersionNumber === null
                          ? null
                          : `Revisão ${item.currentVersionNumber}`
                      }
                    />
                  </td>
                  <td className={enterpriseCellClass}>
                    {/* Status REAL da versao corrente, vindo do backend. Sem versao nao ha
                        estado: a ausencia e declarada, nunca suposta. */}
                    <RecordStatusCell
                      accent={
                        item.currentVersionStatus === 'EXPIRED'
                          ? 'critical'
                          : item.currentVersionStatus === 'DRAFT'
                            ? 'warning'
                            : 'none'
                      }
                      badge={
                        item.currentVersionStatus ? (
                          <ProposalStatusBadge status={item.currentVersionStatus} />
                        ) : (
                          <span className="text-[13px] text-gray-600">
                            {PROPOSAL_NO_VERSION_LABEL}
                          </span>
                        )
                      }
                      context={
                        item.validUntil
                          ? `Válida até ${formatProposalValidity(item.validUntil)}`
                          : 'Sem validade definida'
                      }
                    />
                  </td>
                  <td className={enterpriseNumericCellClass}>
                    {/* Valor com hierarquia: numero forte, contexto em linha secundaria. */}
                    <span className="cisne-type-money text-sm font-semibold text-gray-900">
                      {item.saleTotal
                        ? formatMoneyBrl(item.saleTotal, item.currencyCode ?? 'BRL')
                        : '—'}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-gray-500">
                      {item.currentVersionStatus === 'ACCEPTED' ? 'Aceita' : 'Venda prevista'}
                    </span>
                  </td>
                  <td className={enterpriseNumericCellClass}>
                    <RowActionMenu
                      label={item.proposalCode}
                      primary={
                        <Link
                          to={`/app/proposals/${item.id}`}
                          className={rowPrimaryActionClass}
                        >
                          {proposalNextAction(item.currentVersionStatus)}
                        </Link>
                      }
                      secondary={
                        <>
                          <Link
                            to={`/app/proposals/${item.id}`}
                            className={rowSecondaryActionClass}
                          >
                            Abrir proposta
                          </Link>
                          <Link
                            to={`/app/proposals/${item.id}`}
                            className={rowSecondaryActionClass}
                          >
                            Ver versões
                          </Link>
                        </>
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ModulePagination
        pageNumber={pageNumber}
        previousDisabled={offset === 0}
        nextDisabled={!hasMore}
        onPrevious={() => void loadPage(Math.max(0, offset - PAGE_SIZE))}
        onNext={() => void loadPage(offset + PAGE_SIZE)}
      />
    </ModulePage>
  );
}
