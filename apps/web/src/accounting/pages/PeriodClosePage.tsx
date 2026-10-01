import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StatusBadge } from '../../ui';
import { ModulePage } from '../../ui/module-layout';
import {
  EnterpriseMetric,
  WorklistField,
  WorklistFilterBar,
  WorklistHeader,
  WorklistStatePanel,
  worklistCellClass,
  worklistHeadCellClass,
  worklistRowClass,
  worklistSelectClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { ClosedPeriodBanner } from '../../financial-ui/ClosedPeriodBanner';
import { PERIOD_STATUS_LABELS } from '../../financial-ui/labels';
import { MoneyActionForm } from '../../financial-ui/MoneyActionForm';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { OperationalUnitOptions, useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
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
  const { units, options: unitOptions, unitId, setUnitId } = useOperationalUnits();
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

  /*
   * WORKBENCH DE FECHAMENTO — a tela deixa de ser "título + selects + vazio" e passa a ser uma
   * mesa de trabalho: cabeçalho com o ESTADO real do período, barra de contexto, faixa do
   * checklist persistido do servidor e as AÇÕES que já existiam (fechar/reabrir com versão e
   * justificativa). Nenhuma regra de fechamento, transição, concorrência ou autorização mudou.
   */
  const failedChecks = period
    ? period.closeChecks.filter((check) => check.result === 'FAIL')
    : [];
  const lastRun = runs.length > 0 ? runs[0] : null;

  /*
   * PRÉ-REQUISITO — quando os `<select>` de plano/período estão vazios, o operador via campos
   * desabilitados sem saber o que faltava. O estado passa a ser declarado na MESMA moldura,
   * dentro da página, no lugar da área de trabalho.
   */
  const scopeNotice = (() => {
    if (units.length === 0) {
      return {
        title: 'Nenhuma unidade operacional disponível',
        description:
          'Sua sessão não tem unidade operacional autorizada, então não há período contábil para fechar ou reabrir. A unidade é escolhida em lista; esta tela não aceita identificador digitado.',
      };
    }
    if (chartId && charts.length === 0 && chartsQuery.state.phase === 'ready') {
      return {
        title: 'Nenhum plano de contas nesta unidade',
        description:
          'A unidade selecionada não tem plano de contas publicado, então não existe período contábil para fechar. Escolha outra unidade operacional.',
      };
    }
    if (chartId && periods.length === 0 && periodsQuery.state.phase === 'ready') {
      return {
        title: 'Nenhum período contábil neste plano',
        description:
          'O plano selecionado não tem competência publicada. O fechamento age sobre um período existente; nada é criado aqui.',
      };
    }
    return null;
  })();

  return (
    <ModulePage>
      <WorklistHeader
        title="Fechamentos"
        context="Períodos e fechamentos são lidos do servidor. Fechar ou reabrir envia a versão atual e a justificativa; o navegador não decide o close."
        metrics={
          period ? (
            <>
              <EnterpriseMetric
                label="Situação"
                value={PERIOD_STATUS_LABELS[period.status] ?? period.status}
                tone={period.status === 'OPEN' ? 'warning' : 'neutral'}
              />
              <EnterpriseMetric label="Competência" value={period.code} />
              <EnterpriseMetric label="Versão" value={period.rowVersion} />
              <EnterpriseMetric
                label="Reaberturas"
                value={period.reopenCount}
                tone={period.reopenCount > 0 ? 'warning' : 'neutral'}
              />
              {lastRun ? (
                <EnterpriseMetric
                  label="Última execução"
                  value={RUN_STATUS_LABELS[lastRun.status] ?? lastRun.status}
                  tone={lastRun.status === 'BLOCKED' ? 'critical' : 'neutral'}
                />
              ) : null}
            </>
          ) : null
        }
      />

      {/* BARRA DE CONTEXTO: unidade -> plano -> período, na mesma densidade das demais superfícies. */}
      <WorklistFilterBar>
        <WorklistField label="Unidade" htmlFor="close-unit">
          <select
            id="close-unit"
            className={worklistSelectClass}
            value={unitId}
            onChange={(event) => setUnitId(event.target.value)}
            disabled={units.length === 0}
          >
            {/*
              ESCOPO DE UNIDADE pelo primitivo compartilhado — mesmo tratamento de Lancamentos
              e Diario. A tela montava as opcoes a mao com um ordinal `Unidade {index + 1}`, que
              nao diz QUAL unidade esta selecionada.
            */}
            <OperationalUnitOptions options={unitOptions} />
          </select>
        </WorklistField>
        <WorklistField label="Plano de contas" htmlFor="close-chart">
          <select
            id="close-chart"
            className={worklistSelectClass}
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
          </select>
        </WorklistField>
        <WorklistField label="Período contábil" htmlFor="close-period">
          {/*
            LARGURA LIMITADA — o rótulo da competência é longo por natureza
            (`2026-09 — 2026-09-01 a 2026-09-28 (Aberto)`), e um `<select>` que cresce pelo
            conteúdo estoura o container flex e dá scroll horizontal à página inteira. Aqui o
            controle tem teto de largura e o texto excedente é cortado pelo próprio select, sem
            perder nenhuma opção nem alterar o valor enviado ao servidor.
          */}
          <select
            id="close-period"
            className={`${worklistSelectClass} w-full max-w-[22rem]`}
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
          </select>
        </WorklistField>
      </WorklistFilterBar>

      {chartsQuery.state.phase === 'denied' || periodsQuery.state.phase === 'denied' ? (
        <WorklistStatePanel
          tone="critical"
          title="Sem permissão para consultar períodos contábeis desta unidade"
          description="A consulta foi recusada pelo servidor. A unidade escolhida não está no seu escopo de fechamento."
        />
      ) : null}
      {scopeNotice ? (
        <WorklistStatePanel title={scopeNotice.title} description={scopeNotice.description} />
      ) : null}
      {!scopeNotice && units.length > 0 && !period ? (
        <WorklistStatePanel
          title="Nenhum período selecionado"
          description="Escolha o plano de contas da unidade e o período contábil; versão e histórico vêm da API."
        />
      ) : null}
      {period ? (
        <>
          {period.status === 'CLOSED' ? (
            <div className="mb-2">
              <ClosedPeriodBanner />
            </div>
          ) : null}
          {notice ? (
            <div className="mb-2">
              <Alert tone="info">{notice}</Alert>
            </div>
          ) : null}

          {/* ESTADO DO PERÍODO — faixa densa, não cartão de respiro. */}
          <section className="mb-2 rounded-md border border-gray-200 bg-white" aria-label="Estado do período">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3 py-2">
              <StatusBadge
                tone={period.status === 'OPEN' ? 'warning' : 'success'}
                label={PERIOD_STATUS_LABELS[period.status] ?? period.status}
              />
              <span className="text-[13px] font-semibold text-gray-900">{period.code}</span>
              <span className="text-xs text-gray-500">
                {period.startsOn} a {period.endsOn}
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-x-4 text-xs text-gray-600 tabular-nums">
                <span>
                  Versão atual <strong>{period.rowVersion}</strong>
                </span>
                <span>
                  Reaberturas <strong>{period.reopenCount}</strong>
                </span>
              </span>
            </div>
          </section>

          {period.closeChecks.length > 0 ? (
            <section className="mb-2 rounded-md border border-gray-200 bg-white" aria-label="Checklist do período">
              <div className="border-b border-gray-200 px-3 py-2">
                <h2 className="text-[13px] font-semibold text-gray-900">
                  Checklist registrado no período
                </h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  As mesmas verificações que o servidor executa ao fechar. O navegador não avalia
                  nenhuma delas.
                </p>
              </div>
              <ul className="divide-y divide-gray-100">
                {period.closeChecks.map((check) => (
                  <li
                    key={check.kind}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                  >
                    <span className="font-mono text-xs text-gray-600">{check.kind}</span>
                    <StatusBadge
                      tone={
                        check.result === 'PASS'
                          ? 'success'
                          : check.result === 'FAIL'
                            ? 'error'
                            : 'neutral'
                      }
                      label={
                        check.result === 'PASS'
                          ? 'Aprovada'
                          : check.result === 'FAIL'
                            ? 'Reprovada'
                            : 'Informativa'
                      }
                    />
                    {check.blocking ? (
                      <span className="text-[11px] font-medium text-red-700">bloqueia o fechamento</span>
                    ) : null}
                    <span className="min-w-0 text-xs text-gray-600">{check.detail}</span>
                    <span className="ml-auto text-[11px] text-gray-500 tabular-nums">
                      {check.observedCount} observado(s)
                    </span>
                  </li>
                ))}
              </ul>
              {failedChecks.length > 0 ? (
                <p className="border-t border-gray-200 px-3 py-2 text-xs text-red-700">
                  {failedChecks.length} verificação(ões) reprovada(s). O fechamento é decidido pelo
                  servidor; nada é corrigido nesta tela.
                </p>
              ) : null}
            </section>
          ) : null}

          {/* HISTÓRICO — cada execução com o resultado persistido das checagens. */}
          <section className="mb-2" aria-label="Histórico de fechamentos">
            <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Histórico de fechamentos</h2>
              {runsQuery.state.phase === 'ready' ? (
                <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600 tabular-nums">
                  {runs.length}
                </span>
              ) : null}
            </div>
            {runs.length === 0 ? (
              <WorklistStatePanel
                title="Nenhuma execução de fechamento registrada"
                description="O período selecionado ainda não foi fechado. Ao fechar, cada verificação executada pelo servidor fica registrada aqui."
              />
            ) : (
              <div className={worklistTableCardClass}>
                <table className={worklistTableClass} aria-label="Execuções de fechamento do período">
                  <thead>
                    <tr>
                      <th scope="col" className={worklistHeadCellClass}>
                        Status
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Quando
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Checagens
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run) => (
                      <tr key={run.id} className={worklistRowClass}>
                        <td className={worklistCellClass}>
                          <StatusBadge
                            tone={run.status === 'BLOCKED' ? 'error' : 'success'}
                            label={RUN_STATUS_LABELS[run.status] ?? run.status}
                          />
                        </td>
                        <td className={worklistCellClass}>
                          {new Date(run.createdAt).toLocaleString('pt-BR')}
                        </td>
                        {/*
                          A coluna de checagens carrega o `detail` persistido pelo servidor, que é
                          texto longo. `whitespace-normal` é obrigatório: sem ele a célula não
                          quebra linha, a grade cresce além do viewport e a página inteira ganha
                          scroll horizontal — exatamente o que a prova de browser mede.
                        */}
                        <td className={`${worklistCellClass} max-w-md whitespace-normal`}>
                          <ul className="list-none space-y-0.5">
                            {run.checks.map((check) => (
                              <li key={`${run.id}-${check.kind}`} className="text-xs text-gray-600">
                                <span className="font-mono">{check.kind}</span>: {check.result}
                                {check.blocking ? ' (bloqueia)' : ''} — {check.detail}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* AÇÕES REAIS — fechar e reabrir continuam enviando versão e justificativa ao servidor. */}
          <section className="mb-3 rounded-md border border-gray-200 bg-white" aria-label="Ações do período">
            <div className="border-b border-gray-200 px-3 py-2">
              <h2 className="text-[13px] font-semibold text-gray-900">Ações do período</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Fechar e reabrir são decididos pelo backend, com bloqueio do período e registro
                histórico.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 px-3 py-2 lg:grid-cols-2">
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
          </section>
        </>
      ) : null}
    </ModulePage>
  );
}
