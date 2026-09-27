import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, DateTime, EmptyState, StatusBadge } from '../../ui';
import {
  FilterCard,
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
  ModuleTableCard,
  filterControlClass,
  filterLabelClass,
  moduleTableCellClass,
  moduleTableClass,
  moduleTableHeadClass,
  moduleTableHeaderCellClass,
  moduleTableRowClass,
} from '../../ui/module-layout';
import { useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import {
  BackofficeApiError,
  closePeriod,
  getClosingReadiness,
  listPeriodsByUnit,
  reopenPeriod,
} from '../api/accounting-api';
import { mapAccountingErrorToMessage } from '../api/accounting-error-messages';
import type { AccountingPeriod, ClosingException, ClosingReadiness } from '../types/accounting.types';

const JOURNAL_COUNT_LABELS: Record<string, string> = {
  DRAFT: 'Não postados',
  POSTED: 'Postados',
};

function periodLabel(period: AccountingPeriod): string {
  return `${period.code} · ${period.startsOn} — ${period.endsOn}`;
}

/**
 * Ordem visual do fechamento: bloqueadores → pendências → próximas ações → situação → detalhes.
 *
 * Nenhum percentual e nenhum "score": só o que o backend consegue provar.
 */
function ExceptionRow({ item }: { item: ClosingException }) {
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 py-3 last:border-b-0"
      data-severity={item.severity}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">
          {item.observedCount} · {item.detail}
        </p>
        <p className="text-xs text-gray-500">
          {item.area} · {item.kind}
        </p>
      </div>
      {item.drilldown ? (
        <Link
          className="text-sm font-semibold text-brand-600 hover:text-brand-700"
          to={item.drilldown.path}
          aria-label={`${item.drilldown.label}: ${item.detail}`}
        >
          {item.drilldown.label}
        </Link>
      ) : (
        <span className="text-xs text-gray-400">Sem recorte navegável para esta verificação.</span>
      )}
    </li>
  );
}

/**
 * CLOSING CENTER — superfície única de fechamento empresarial.
 *
 * Orienta-se por UNIDADE + PERÍODO humanos. Ao selecionar, mostra a leitura real do servidor
 * (`GET /closing/readiness`): bloqueadores, pendências, próximas ações e situação do período.
 * As ações de fechar/reabrir são as que o backend já expõe, com a mesma autorização, SoD,
 * concorrência otimista e idempotência — o front não inventa regra de fechamento.
 */
export function ClosingCenterPage() {
  const { units, unitId, setUnitId } = useOperationalUnits();
  const [periodId, setPeriodId] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'OPEN' | 'CLOSED'>('OPEN');
  const [error, setError] = useState<string | null>(null);

  const periodsQuery = useBackofficeQuery<{ unitId: string; items: AccountingPeriod[] }>({
    enabled: unitId !== '',
    autoLoad: unitId !== '',
    loader: (signal) =>
      listPeriodsByUnit(
        { unitId, status: statusFilter === '' ? undefined : statusFilter },
        signal,
      ),
    mapError: mapAccountingErrorToMessage,
  });

  // Trocar de unidade zera o período: contexto novo, nunca id órfão de outra unidade.
  useEffect(() => {
    setPeriodId('');
    setError(null);
  }, [unitId]);

  const readinessQuery = useBackofficeQuery<ClosingReadiness>({
    enabled: unitId !== '' && periodId !== '',
    autoLoad: unitId !== '' && periodId !== '',
    loader: (signal) => getClosingReadiness({ unitId, periodId }, signal),
    mapError: mapAccountingErrorToMessage,
  });

  const periods = periodsQuery.state.phase === 'ready' ? periodsQuery.state.data.items : [];
  const readiness = readinessQuery.state.phase === 'ready' ? readinessQuery.state.data : null;

  const reload = useCallback(async () => {
    await periodsQuery.reload();
    await readinessQuery.reload();
  }, [periodsQuery, readinessQuery]);

  async function runAction(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await reload();
    } catch (failure) {
      setError(
        failure instanceof BackofficeApiError
          ? mapAccountingErrorToMessage(failure.code, failure.status)
          : mapAccountingErrorToMessage(undefined, 0),
      );
    }
  }

  if (units.length === 0) {
    return (
      <ModulePage>
        <ModulePageHeader title="Central de fechamento" />
        <EmptyState
          title="Nenhuma unidade operacional disponível"
          description="Esta área trabalha por unidade e período; sem unidade autorizada não há fechamento a acompanhar."
        />
      </ModulePage>
    );
  }

  return (
    <ModulePage>
      <ModulePageHeader
        title="Central de fechamento"
        description="Período, pendências e bloqueadores do fechamento contábil e fiscal, lidos do servidor."
      />

      <FilterCard>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className={filterLabelClass} htmlFor="closing-unit">
              Unidade
            </label>
            <select
              id="closing-unit"
              className={filterControlClass}
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
            >
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="closing-period-status">
              Situação do período
            </label>
            <select
              id="closing-period-status"
              className={filterControlClass}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as '' | 'OPEN' | 'CLOSED')}
            >
              <option value="OPEN">Abertos</option>
              <option value="CLOSED">Fechados</option>
              <option value="">Todos</option>
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="closing-period">
              Competência
            </label>
            <select
              id="closing-period"
              className={filterControlClass}
              value={periodId}
              onChange={(event) => setPeriodId(event.target.value)}
              disabled={periods.length === 0}
            >
              <option value="">
                {periods.length === 0 ? 'Nenhum período nesta unidade' : 'Selecione a competência…'}
              </option>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {periodLabel(period)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </FilterCard>

      {renderQueryGate(
        'Central de fechamento',
        'Carregando períodos…',
        'Você não tem permissão para consultar os períodos desta unidade.',
        periodsQuery.state,
        () => void periodsQuery.reload(),
      )}

      {error ? (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      {!periodId ? (
        <EmptyState
          title="Nenhum período selecionado"
          description="Escolha a competência para ver bloqueadores, pendências e o estado real do fechamento."
        />
      ) : null}

      {periodId && readinessQuery.state.phase === 'loading' ? (
        <ModuleLoadingState title="Central de fechamento" message="Lendo o estado do fechamento…" />
      ) : null}

      {periodId && readinessQuery.state.phase === 'denied' ? (
        <ModuleDeniedState
          title="Central de fechamento"
          message="Você não tem permissão para ler o fechamento deste período."
        />
      ) : null}

      {periodId && readinessQuery.state.phase === 'error' ? (
        <ModuleErrorState
          title="Central de fechamento"
          message={readinessQuery.state.message}
          retryable={readinessQuery.state.retryable}
          onRetry={() => void readinessQuery.reload()}
        />
      ) : null}

      {readiness ? (
        <>
          {/* 1. BLOQUEADORES */}
          <FilterCard>
            <h2 className="mb-1 text-sm font-semibold text-gray-900">
              {readiness.blockers.length > 0
                ? `Fechamento bloqueado: ${readiness.blockers.length} verificação(ões) com pendência`
                : readiness.closeReady === true
                  ? 'Nenhum bloqueador: período pronto para fechar'
                  : 'Bloqueadores não avaliados por completo'}
            </h2>
            <p className="mb-3 text-sm text-gray-500">
              Verificações são as mesmas que o fechamento executa no servidor.
            </p>
            {readiness.blockers.length === 0 ? (
              <p className="text-sm text-gray-600" role="status">
                {readiness.closeReady === true
                  ? 'O servidor não encontrou bloqueio persistido para este período.'
                  : 'Não é possível afirmar que o período está pronto: há verificação sem avaliação por autorização.'}
              </p>
            ) : (
              <ul aria-label="Bloqueadores do fechamento">
                {readiness.blockers.map((item) => (
                  <ExceptionRow key={`${item.kind}-${item.area}`} item={item} />
                ))}
              </ul>
            )}
          </FilterCard>

          {/* 2. PENDÊNCIAS (informativas: não bloqueiam pela política vigente) */}
          {readiness.pending.length > 0 ? (
            <FilterCard>
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Pendências observadas</h2>
              <ul aria-label="Pendências do fechamento">
                {readiness.pending.map((item) => (
                  <ExceptionRow key={`${item.kind}-${item.area}`} item={item} />
                ))}
              </ul>
            </FilterCard>
          ) : null}

          {/* 3. PRÓXIMAS AÇÕES */}
          <FilterCard>
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Próximas ações</h2>
            <ul className="mb-4 space-y-1" aria-label="Próximas ações do fechamento">
              {readiness.nextActions.map((action) => (
                <li key={action.kind} className="text-sm text-gray-700">
                  {action.label}
                  {action.enabled ? '' : ` — indisponível: ${action.reason ?? 'sem autorização'}`}
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <VersionedActionForm
                title="Fechar período"
                description="O backend reavalia todas as verificações e recusa o fechamento com bloqueador."
                confirmTitle="Fechar período"
                confirmDescription="Período fechado só volta por reabertura autorizada."
                confirmLabel="Fechar período"
                reasonLabel="Motivo"
                disabled={readiness.closeReady !== true}
                mapError={mapAccountingErrorToMessage}
                onReload={() => void reload()}
                onSubmit={async ({ reason }) =>
                  runAction(() =>
                    closePeriod(readiness.period.id, {
                      rowVersion: readiness.period.rowVersion,
                      reason: reason ?? '',
                    }),
                  )
                }
              />
              <VersionedActionForm
                title="Reabrir período"
                description="Reabertura é registrada e exige motivo; o backend valida que o período está fechado."
                confirmTitle="Reabrir período"
                confirmDescription="A reabertura é auditada e incrementa a contagem de reaberturas."
                confirmLabel="Reabrir período"
                variant="danger"
                reasonLabel="Motivo"
                disabled={readiness.period.status !== 'CLOSED'}
                mapError={mapAccountingErrorToMessage}
                onReload={() => void reload()}
                onSubmit={async ({ reason }) =>
                  runAction(() =>
                    reopenPeriod(readiness.period.id, {
                      rowVersion: readiness.period.rowVersion,
                      reason: reason ?? '',
                    }),
                  )
                }
              />
            </div>
          </FilterCard>

          {/* 4. SITUAÇÃO DO PERÍODO */}
          <FilterCard>
            <h2 className="mb-3 text-sm font-semibold text-gray-900">Situação do período</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div>
                <p className={filterLabelClass}>Competência</p>
                <p className="text-sm text-gray-900">{readiness.period.code}</p>
              </div>
              <div>
                <p className={filterLabelClass}>Intervalo</p>
                <p className="text-sm text-gray-900">
                  <DateTime value={readiness.period.startsOn} mode="date" /> —{' '}
                  <DateTime value={readiness.period.endsOn} mode="date" />
                </p>
              </div>
              <div>
                <p className={filterLabelClass}>Contábil</p>
                <StatusBadge
                  tone={readiness.accounting.periodStatus === 'OPEN' ? 'warning' : 'success'}
                  label={readiness.accounting.periodStatus === 'OPEN' ? 'Aberto' : 'Fechado'}
                />
              </div>
              <div>
                <p className={filterLabelClass}>Fiscal</p>
                {readiness.fiscal ? (
                  <p className="text-sm text-gray-900">
                    {readiness.fiscal.rejected} rejeitado(s) · {readiness.fiscal.pendingAuthorization} aguardando
                    autorização · {readiness.fiscal.draft} rascunho(s)
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">Omitido por autorização</p>
                )}
              </div>
            </div>
            {readiness.withheld.length > 0 ? (
              <ul className="mt-4" aria-label="Seções omitidas por autorização">
                {readiness.withheld.map((entry) => (
                  <li key={entry.area} className="text-sm text-gray-500">
                    {entry.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </FilterCard>

          {/* 5. DETALHES */}
          <ModuleTableCard>
            <table className={moduleTableClass} aria-label="Lançamentos por situação no período">
              <thead className={moduleTableHeadClass}>
                <tr>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Lançamentos
                  </th>
                  <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                    Quantidade
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(readiness.accounting.journalCounts).map(([status, count]) => (
                  <tr key={status} className={moduleTableRowClass}>
                    <td className={moduleTableCellClass}>
                      {JOURNAL_COUNT_LABELS[status] ?? status}
                    </td>
                    <td className={`${moduleTableCellClass} text-right`}>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ModuleTableCard>
        </>
      ) : null}
    </ModulePage>
  );
}
