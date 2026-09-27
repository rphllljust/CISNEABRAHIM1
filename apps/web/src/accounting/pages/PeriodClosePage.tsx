import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, EmptyState, Field, Select } from '../../ui';
import {
  FilterCard,
  ModulePage,
  ModulePageHeader,
  ModuleTableCard,
  moduleTableCellClass,
  moduleTableClass,
  moduleTableHeadClass,
  moduleTableHeaderCellClass,
  moduleTableRowClass,
} from '../../ui/module-layout';
import { ClosedPeriodBanner } from '../../financial-ui/ClosedPeriodBanner';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { PERIOD_STATUS_LABELS } from '../../financial-ui/labels';
import { MoneyActionForm } from '../../financial-ui/MoneyActionForm';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import {
  closePeriod,
  getPeriodCloseRuns,
  listCharts,
  listPeriods,
  reopenPeriod,
} from '../api/accounting-api';
import { mapAccountingErrorToMessage } from '../api/accounting-error-messages';
import type { ChartsList, CloseRuns, PeriodsList } from '../types/accounting.types';

const RUN_STATUS_LABELS: Record<string, string> = {
  SUCCEEDED: 'Concluído',
  BLOCKED: 'Bloqueado',
};

export function PeriodClosePage() {
  // A unidade operacional vem do contexto do shell (mesma fonte única dos outros módulos de
  // backoffice): o operador escolhe na lista de unidades autorizadas e nunca digita
  // identificador. Escolhida a unidade, os planos dela são carregados e o período vem por
  // plano. Fechar/reabrir continua enviando versão e justificativa ao servidor, sem mudança.
  const { units, unitId, setUnitId } = useOperationalUnits();
  const [chartId, setChartId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const chartsQuery = useBackofficeQuery<ChartsList>({
    enabled: unitId !== '',
    autoLoad: false,
    loader: (signal) => listCharts(unitId, signal),
    mapError: mapAccountingErrorToMessage,
  });
  const periodsQuery = useBackofficeQuery<PeriodsList>({
    enabled: Boolean(chartId),
    autoLoad: false,
    loader: (signal) => listPeriods(chartId, undefined, signal),
    mapError: mapAccountingErrorToMessage,
  });
  const runsQuery = useBackofficeQuery<CloseRuns>({
    enabled: Boolean(periodId),
    autoLoad: false,
    loader: (signal) => getPeriodCloseRuns(periodId, signal),
    mapError: mapAccountingErrorToMessage,
  });

  const charts = chartsQuery.state.phase === 'ready' ? chartsQuery.state.data.items : [];
  const periods = periodsQuery.state.phase === 'ready' ? periodsQuery.state.data.items : [];
  const period = useMemo(
    () => periods.find((candidate) => candidate.id === periodId) ?? null,
    [periods, periodId],
  );
  const runs = runsQuery.state.phase === 'ready' ? runsQuery.state.data.runs : [];

  const { reload: reloadCharts, reset: resetCharts } = chartsQuery;
  const { reload: reloadPeriods, reset: resetPeriods } = periodsQuery;
  const { reload: reloadRuns, reset: resetRuns } = runsQuery;

  // Trocar a unidade limpa plano e período (evita uuid órfão de outra unidade) e carrega os
  // planos da unidade escolhida; o conteúdo anterior é descartado antes da nova consulta.
  useEffect(() => {
    setChartId('');
    resetCharts();
    if (unitId === '') {
      return;
    }
    void reloadCharts();
  }, [reloadCharts, resetCharts, unitId]);

  // Trocar o plano limpa o período e recarrega os períodos do plano escolhido.
  useEffect(() => {
    setPeriodId('');
    resetPeriods();
    if (!chartId) {
      return;
    }
    void reloadPeriods();
  }, [chartId, reloadPeriods, resetPeriods]);

  // Trocar o período recarrega o histórico de fechamentos dele.
  useEffect(() => {
    resetRuns();
    if (periodId === '') {
      return;
    }
    void reloadRuns();
  }, [periodId, reloadRuns, resetRuns]);

  const reloadPeriodsAndRuns = useCallback(async () => {
    await periodsQuery.reload();
    if (periodId) {
      await runsQuery.reload();
    }
    setNotice(null);
  }, [periodId, periodsQuery, runsQuery]);

  return (
    <ModulePage>
      <ModulePageHeader
        title="Fechamentos"
        description="Períodos e fechamentos são lidos do servidor. Fechar ou reabrir envia a versão atual e a justificativa; o navegador não decide o close."
      />
      <FilterCard>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Unidade operacional" htmlFor="close-unit">
            <Select
              id="close-unit"
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
              disabled={units.length === 0}
            >
              {units.length === 0 ? <option value="">Nenhuma unidade disponível</option> : null}
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Plano de contas" htmlFor="close-chart">
            <Select
              id="close-chart"
              value={chartId}
              onChange={(event) => setChartId(event.target.value)}
              disabled={charts.length === 0}
            >
              <option value="">Selecione…</option>
              {charts.map((chart) => (
                <option key={chart.id} value={chart.id}>
                  {chart.code} — {chart.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Período contábil" htmlFor="close-period">
            <Select
              id="close-period"
              value={periodId}
              onChange={(event) => setPeriodId(event.target.value)}
              disabled={periods.length === 0}
            >
              <option value="">Selecione o período…</option>
              {periods.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.code} — {candidate.startsOn} a {candidate.endsOn} (
                  {PERIOD_STATUS_LABELS[candidate.status] ?? candidate.status})
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </FilterCard>

      {chartsQuery.state.phase === 'denied' || periodsQuery.state.phase === 'denied' ? (
        <div className="mb-4">
          <Alert tone="error">Sem permissão para consultar períodos contábeis desta unidade.</Alert>
        </div>
      ) : null}
      {units.length === 0 ? (
        <EmptyState
          title="Nenhuma unidade operacional disponível"
          description="Sua sessão não tem unidade operacional autorizada, então não há período contábil para fechar ou reabrir. A unidade é escolhida em lista; esta tela não aceita identificador digitado."
        />
      ) : null}
      {units.length > 0 && !period ? (
        <EmptyState
          title="Nenhum período selecionado"
          description="Escolha o plano de contas da unidade e o período contábil; versão e histórico vêm da API."
        />
      ) : null}
      {period ? (
        <>
          {period.status === 'CLOSED' ? (
            <div className="mb-4">
              <ClosedPeriodBanner />
            </div>
          ) : null}
          {notice ? (
            <div className="mb-4">
              <Alert tone="info">{notice}</Alert>
            </div>
          ) : null}
          <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
            <DefinitionList
              items={[
                {
                  label: 'Status',
                  value: (
                    <FinanceStatusBadge status={period.status} labels={PERIOD_STATUS_LABELS} />
                  ),
                },
                { label: 'Código', value: period.code },
                { label: 'Início', value: period.startsOn },
                { label: 'Fim', value: period.endsOn },
                { label: 'Versão atual', value: String(period.rowVersion) },
                { label: 'Reaberturas', value: String(period.reopenCount) },
              ]}
            />
          </div>

          {runs.length > 0 ? (
            <>
              <h2 className="mb-3 text-base font-semibold text-gray-900">Histórico de fechamentos</h2>
              <ModuleTableCard>
                <table className={moduleTableClass} aria-label="Execuções de fechamento do período">
                  <thead className={moduleTableHeadClass}>
                    <tr>
                      <th scope="col" className={moduleTableHeaderCellClass}>
                        Status
                      </th>
                      <th scope="col" className={moduleTableHeaderCellClass}>
                        Quando
                      </th>
                      <th scope="col" className={moduleTableHeaderCellClass}>
                        Checagens
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.id} className={moduleTableRowClass}>
                        <td className={moduleTableCellClass}>
                          {RUN_STATUS_LABELS[run.status] ?? run.status}
                        </td>
                        <td className={moduleTableCellClass}>
                          {new Date(run.createdAt).toLocaleString('pt-BR')}
                        </td>
                        <td className={moduleTableCellClass}>
                          <ul className="list-none space-y-1">
                            {run.checks.map((check) => (
                              <li key={`${run.id}-${check.kind}`}>
                                <span className="font-mono text-xs">{check.kind}</span>:{' '}
                                {check.result}
                                {check.blocking ? ' (bloqueia)' : ''} — {check.detail}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ModuleTableCard>
            </>
          ) : null}

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <MoneyActionForm
              title="Fechar período"
              description="O servidor avalia o checklist configurável e bloqueia lançamentos concorrentes."
              confirmTitle="Fechar período"
              confirmDescription="O close ocorre em transação única sob bloqueio do período."
              confirmLabel="Fechar"
              reasonLabel="Justificativa"
              disabled={period.status !== 'OPEN'}
              mapError={mapAccountingErrorToMessage}
              onReload={() => void reloadPeriodsAndRuns()}
              onSubmit={async ({ reason }) => {
                await closePeriod(period.id, {
                  rowVersion: period.rowVersion,
                  reason: reason ?? '',
                });
                await reloadPeriodsAndRuns();
              }}
            />
            <MoneyActionForm
              title="Reabrir período"
              description="Reabertura exige capability específica e justificativa no servidor."
              confirmTitle="Reabrir período"
              confirmDescription="Somente o backend autoriza a reabertura e registra o histórico."
              confirmLabel="Reabrir"
              reasonLabel="Justificativa"
              disabled={period.status !== 'CLOSED'}
              mapError={mapAccountingErrorToMessage}
              onReload={() => void reloadPeriodsAndRuns()}
              onSubmit={async ({ reason }) => {
                await reopenPeriod(period.id, {
                  rowVersion: period.rowVersion,
                  reason: reason ?? '',
                });
                await reloadPeriodsAndRuns();
              }}
            />
          </div>
        </>
      ) : null}
    </ModulePage>
  );
}
