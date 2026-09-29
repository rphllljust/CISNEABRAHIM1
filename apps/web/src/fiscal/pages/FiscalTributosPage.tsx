import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, Money } from '../../ui';
import {
  FilterCard,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
  ModulePagination,
  ModuleTableCard,
  ModuleTableLink,
  filterControlClass,
  filterLabelClass,
  moduleTableCellClass,
  moduleTableClass,
  moduleTableHeadClass,
  moduleTableHeaderCellClass,
  moduleTableRowClass,
} from '../../ui/module-layout';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { getTaxRule, listTaxRules } from '../api/fiscal-api';
import { mapFiscalErrorToMessage } from '../api/fiscal-error-messages';
import { useFiscalUnits } from '../hooks/useFiscalUnits';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import type { TaxRule, TaxRuleListItem } from '../types/fiscal.types';

const PAGE_SIZE = 20;

type ListState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: TaxRuleListItem[]; total: number; page: number };

export function FiscalTributosPage() {
  const { taxRuleId } = useParams();
  return taxRuleId ? <TaxRuleDetail taxRuleId={taxRuleId} /> : <TaxRulesList />;
}

/** Superficie de tributos: lista paginada de regras com a versao publicada vigente. */
function TaxRulesList() {
  const { units, unitId, setUnitId } = useFiscalUnits();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [state, setState] = useState<ListState>({ phase: 'loading' });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!unitId) {
        setState({ phase: 'ready', items: [], total: 0, page: 0 });
        return;
      }
      setState({ phase: 'loading' });
      try {
        const response = await listTaxRules(
          { unitId, status: status || undefined, page, pageSize: PAGE_SIZE },
          signal,
        );
        setState({ phase: 'ready', items: response.items, total: response.total, page: response.page });
      } catch (error) {
        setState({
          phase: 'error',
          message: mapFiscalErrorToMessage(
            (error as { code?: string }).code,
            (error as { status?: number }).status ?? 0,
          ),
          retryable: true,
        });
      }
    },
    [page, status, unitId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const hasMore = state.phase === 'ready' && (state.page + 1) * PAGE_SIZE < state.total;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Tributos"
        description="Consulta regras versionadas já persistidas. Alíquotas oficiais não são inventadas nesta interface."
      />

      <FilterCard>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={filterLabelClass} htmlFor="tax-rule-unit-filter">
              Unidade
            </label>
            <select
              id="tax-rule-unit-filter"
              className={filterControlClass}
              value={unitId}
              onChange={(event) => {
                setUnitId(event.target.value);
                setPage(0);
              }}
            >
              {units.length === 0 ? <option value="">Nenhuma unidade disponível</option> : null}

              {units.map((unit, index) => (

                <option key={unit} value={unit}>

                  Unidade {index + 1}

                </option>

              ))}
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="tax-rule-status-filter">
              Situação
            </label>
            <select
              id="tax-rule-status-filter"
              className={filterControlClass}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            >
              <option value="">Todas</option>
              <option value="ACTIVE">Ativa</option>
              <option value="INACTIVE">Inativa</option>
            </select>
          </div>
        </div>
      </FilterCard>

      {state.phase === 'loading' ? <ModuleLoadingState title="Tributos" message="Carregando regras…" /> : null}

      {state.phase === 'error' ? (
        <ModuleErrorState
          title="Tributos"
          message={state.message}
          retryable={state.retryable}
          onRetry={() => void load()}
        />
      ) : null}

      {state.phase === 'ready' && state.items.length === 0 ? (
        <EmptyState
          title="Nenhuma regra tributária"
          description="Não há regras tributárias cadastradas para a unidade selecionada."
        />
      ) : null}

      {state.phase === 'ready' && state.items.length > 0 ? (
        <>
          <ModuleTableCard>
            <table className={moduleTableClass} aria-label="Lista de regras tributárias">
              <thead className={moduleTableHeadClass}>
                <tr>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Código
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Nome
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Situação
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Versão publicada
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Vigência
                  </th>
                  <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                    Alíquota / valor
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Fonte
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.items.map((item) => (
                  <tr key={item.id} className={moduleTableRowClass}>
                    <td className={moduleTableCellClass}>
                      <ModuleTableLink to={`/app/fiscal/tributos/${item.id}`}>{item.code}</ModuleTableLink>
                    </td>
                    <td className={`${moduleTableCellClass} whitespace-normal`}>{item.name}</td>
                    <td className={moduleTableCellClass}>
                      <FinanceStatusBadge status={item.status} labels={{ ACTIVE: 'Ativa', INACTIVE: 'Inativa' }} />
                    </td>
                    <td className={moduleTableCellClass}>
                      {item.publishedVersion
                        ? `v${item.publishedVersion.versionNumber} · ${item.publishedVersion.calculationMethod}`
                        : `— (${item.versionCount} versões)`}
                    </td>
                    <td className={moduleTableCellClass}>
                      {item.publishedVersion
                        ? `${item.publishedVersion.effectiveFrom} → ${item.publishedVersion.effectiveTo ?? 'aberta'}`
                        : '—'}
                    </td>
                    <td className={`${moduleTableCellClass} text-right`}>
                      {item.publishedVersion?.rate ? (
                        <Money value={item.publishedVersion.rate} currencyCode="BRL" />
                      ) : (
                        (item.publishedVersion?.fixedAmount ?? '—')
                      )}
                    </td>
                    <td className={`${moduleTableCellClass} whitespace-normal`}>
                      {item.publishedVersion?.sourceReference ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ModuleTableCard>

          <ModulePagination
            pageNumber={state.page + 1}
            previousDisabled={state.page === 0}
            nextDisabled={!hasMore}
            onPrevious={() => setPage((current) => Math.max(0, current - 1))}
            onNext={() => setPage((current) => current + 1)}
          />
        </>
      ) : null}
    </ModulePage>
  );
}

function TaxRuleDetail({ taxRuleId }: { taxRuleId: string }) {
  const loader = useCallback((signal?: AbortSignal) => getTaxRule(taxRuleId, signal), [taxRuleId]);
  const { state, reload } = useBackofficeQuery<TaxRule>({
    loader,
    mapError: mapFiscalErrorToMessage,
    enabled: true,
    autoLoad: true,
  });
  const gate = renderQueryGate(
    'Regra tributária',
    'Carregando regra tributária…',
    'Você não tem permissão para consultar regras tributárias.',
    state,
    () => void reload(),
  );

  return (
    <ModulePage>
      <ModulePageHeader
        title="Regra tributária"
        description="Consulta regras versionadas já persistidas. Alíquotas oficiais não são inventadas nesta interface."
      />
      <p className="mb-6">
        <Link to="/app/fiscal/tributos" className="text-sm font-medium text-brand-600 no-underline">
          ← Voltar para a lista
        </Link>
      </p>
      {gate}
      {state.phase === 'ready' ? (
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
          <DefinitionList
            items={[
              { label: 'Código', value: state.data.code },
              { label: 'Nome', value: state.data.name },
              {
                label: 'Status',
                value: <FinanceStatusBadge status={state.data.status} labels={{ ACTIVE: 'Ativa', DRAFT: 'Rascunho' }} />,
              },
              { label: 'Unidade', value: state.data.unitId },
            ]}
          />
        </div>
      ) : null}
    </ModulePage>
  );
}
