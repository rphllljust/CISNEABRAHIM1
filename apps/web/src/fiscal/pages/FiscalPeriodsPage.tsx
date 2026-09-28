import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState, Field, Input } from '../../ui';
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
import { CreateRecordForm, VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { PERIOD_STATUS_LABELS } from '../../financial-ui/labels';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import {
  closeFiscalPeriod,
  getFiscalPeriod,
  listFiscalPeriods,
  openFiscalPeriod,
  reopenFiscalPeriod,
} from '../api/fiscal-api';
import { mapFiscalErrorToMessage } from '../api/fiscal-error-messages';
import { useFiscalUnits } from '../hooks/useFiscalUnits';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import type { FiscalPeriod, FiscalPeriodListItem } from '../types/fiscal.types';

const PAGE_SIZE = 20;

/** Próxima ação derivada do status do período — fechamento/reabertura permanecem no backend. */
function NEXT_ACTION_FOR(status: string): string {
  switch (status) {
    case 'OPEN':
      return 'Fechar período';
    case 'CLOSED':
      return 'Reabrir período';
    default:
      return '—';
  }
}

type ListState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: FiscalPeriodListItem[]; total: number; page: number };

export function FiscalPeriodsPage() {
  const { periodId } = useParams();
  return periodId ? <FiscalPeriodDetail periodId={periodId} /> : <FiscalPeriodsList />;
}

/** Superficie de fechamento fiscal: lista paginada por unidade e situacao. */
function FiscalPeriodsList() {
  const { units, unitId, setUnitId } = useFiscalUnits();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [state, setState] = useState<ListState>({ phase: 'loading' });
  const [newPeriodKey, setNewPeriodKey] = useState('');

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!unitId) {
        setState({ phase: 'ready', items: [], total: 0, page: 0 });
        return;
      }
      setState({ phase: 'loading' });
      try {
        const response = await listFiscalPeriods(
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
        title="Períodos fiscais"
        description="Abertura, fechamento e reabertura são decididos pelo backend."
      />

      <FilterCard>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={filterLabelClass} htmlFor="fiscal-period-unit-filter">
              Unidade
            </label>
            <select
              id="fiscal-period-unit-filter"
              className={filterControlClass}
              value={unitId}
              onChange={(event) => {
                setUnitId(event.target.value);
                setPage(0);
              }}
            >
              {units.length === 0 ? <option value="">Nenhuma unidade disponível</option> : null}
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="fiscal-period-status-filter">
              Situação
            </label>
            <select
              id="fiscal-period-status-filter"
              className={filterControlClass}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            >
              <option value="">Todas</option>
              <option value="OPEN">Aberto</option>
              <option value="CLOSED">Fechado</option>
            </select>
          </div>
        </div>
      </FilterCard>

      <CreateRecordForm
        title="Abrir período"
        description="A competência usa o formato AAAA-MM exigido pela API."
        submitLabel="Abrir período"
        mapError={mapFiscalErrorToMessage}
        onSubmit={async () => {
          await openFiscalPeriod({ unitId, periodKey: newPeriodKey.trim() });
          setNewPeriodKey('');
          await load();
        }}
      >
        <Field label="Unidade" htmlFor="fiscal-period-unit" required>
          <Input id="fiscal-period-unit" value={unitId} readOnly required />
        </Field>
        <Field label="Competência" htmlFor="fiscal-period-key" required>
          <Input
            id="fiscal-period-key"
            placeholder="AAAA-MM"
            value={newPeriodKey}
            onChange={(event) => setNewPeriodKey(event.target.value)}
            required
          />
        </Field>
      </CreateRecordForm>

      {state.phase === 'loading' ? (
        <ModuleLoadingState title="Períodos fiscais" message="Carregando períodos…" />
      ) : null}

      {state.phase === 'error' ? (
        <ModuleErrorState
          title="Períodos fiscais"
          message={state.message}
          retryable={state.retryable}
          onRetry={() => void load()}
        />
      ) : null}

      {state.phase === 'ready' && state.items.length === 0 ? (
        <EmptyState
          title="Nenhum período fiscal"
          description="Não há períodos fiscais para a unidade e a situação selecionadas."
        />
      ) : null}

      {state.phase === 'ready' && state.items.length > 0 ? (
        <>
          <ModuleTableCard>
            <table className={moduleTableClass} aria-label="Lista de períodos fiscais">
              <thead className={moduleTableHeadClass}>
                <tr>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Competência
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Situação
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Próxima ação
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Fechado em
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Reaberto em
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Unidade
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.items.map((item) => (
                  <tr key={item.id} className={moduleTableRowClass}>
                    <td className={moduleTableCellClass}>
                      <ModuleTableLink to={`/app/fiscal/periods/${item.id}`}>{item.periodKey}</ModuleTableLink>
                    </td>
                    <td className={moduleTableCellClass}>
                      <FinanceStatusBadge status={item.status} labels={PERIOD_STATUS_LABELS} />
                    </td>
                    <td className={moduleTableCellClass}>{NEXT_ACTION_FOR(item.status)}</td>
                    <td className={moduleTableCellClass}>{item.closedAt ? item.closedAt.slice(0, 10) : '—'}</td>
                    <td className={moduleTableCellClass}>{item.reopenedAt ? item.reopenedAt.slice(0, 10) : '—'}</td>
                    <td className={moduleTableCellClass}>{item.unitId}</td>
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

function FiscalPeriodDetail({ periodId }: { periodId: string }) {
  const loader = useCallback((signal?: AbortSignal) => getFiscalPeriod(periodId, signal), [periodId]);
  const { state, reload, setReady } = useBackofficeQuery<FiscalPeriod>({
    loader,
    mapError: mapFiscalErrorToMessage,
    enabled: true,
    autoLoad: true,
  });
  const gate = renderQueryGate(
    'Período fiscal',
    'Carregando período fiscal…',
    'Você não tem permissão para ver períodos fiscais.',
    state,
    () => void reload(),
  );

  return (
    <ModulePage>
      <ModulePageHeader
        title="Período fiscal"
        description="Abertura, fechamento e reabertura são decididos pelo backend."
      />
      <p className="mb-6">
        <Link to="/app/fiscal/periods" className="text-sm font-medium text-brand-600 no-underline">
          ← Voltar para a lista
        </Link>
      </p>
      {gate}
      {state.phase === 'ready' ? (
        <>
          <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
            <DefinitionList
              items={[
                {
                  label: 'Status',
                  value: <FinanceStatusBadge status={state.data.status} labels={PERIOD_STATUS_LABELS} />,
                },
                { label: 'Competência', value: state.data.periodKey },
                { label: 'Versão', value: String(state.data.rowVersion) },
                { label: 'Motivo da reabertura', value: state.data.reopenReason ?? '—' },
              ]}
            />
          </div>
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <VersionedActionForm
              title="Fechar"
              description="Checagens de fechamento correm no servidor."
              confirmTitle="Fechar período fiscal"
              confirmDescription="O período só fecha se as checagens do backend passarem."
              confirmLabel="Fechar"
              mapError={mapFiscalErrorToMessage}
              onReload={() => void reload()}
              onSubmit={async () => setReady(await closeFiscalPeriod(state.data.id))}
            />
            <VersionedActionForm
              title="Reabrir"
              description="Reabertura exige justificativa e checker distinto."
              confirmTitle="Reabrir período fiscal"
              confirmDescription="O servidor aplica SOD e registra o motivo."
              confirmLabel="Reabrir"
              reasonLabel="Justificativa"
              mapError={mapFiscalErrorToMessage}
              onReload={() => void reload()}
              onSubmit={async ({ reason }) =>
                setReady(await reopenFiscalPeriod(state.data.id, { reason: reason ?? '' }))
              }
            />
          </div>
        </>
      ) : null}
    </ModulePage>
  );
}
