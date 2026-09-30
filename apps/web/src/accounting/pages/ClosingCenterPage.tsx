import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, DateTime, EmptyState, StatusBadge, worklistTableCardClass } from '../../ui';
import { ModuleDeniedState, ModuleErrorState, ModuleLoadingState, ModulePage, ModulePageHeader, filterLabelClass } from '../../ui/module-layout';
import { worklistCellClass, worklistTableClass, worklistHeadCellClass, worklistRowClass } from '../../ui/enterprise-list';
import { WorklistException, WorklistField, WorklistFilterBar, worklistSelectClass } from '../../ui/enterprise-list';
import {
  WorkbenchMetric,
  WorkbenchQueue,
  WorkbenchQueueItem,
  WorkbenchSummaryStrip,
  workbenchPrimaryActionClass,
} from '../../ui/workbench';
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
 * EXCECAO DO FECHAMENTO — a mesma anatomia de item de fila das demais mesas de trabalho:
 * SEVERIDADE (o fato persistido que bloqueia) -> MOTIVO (o que o servidor observou) -> QUANTIDADE
 * REAL observada -> RECORTE de area/verificacao -> DRILL-DOWN para onde se resolve.
 *
 * Nenhum percentual e nenhum "score": so o que o backend consegue provar.
 */
function ExceptionItem({ item }: { item: ClosingException }) {
  const blocking = item.severity === 'BLOCKING';
  return (
    <li className="list-none" data-severity={item.severity}>
      <WorkbenchQueueItem
        severity={
          <WorklistException tone={blocking ? 'critical' : 'warning'}>
            {blocking ? 'Bloqueia o fechamento' : 'Informativa'}
          </WorklistException>
        }
        severityTone={blocking ? 'critical' : 'warning'}
        title={item.detail}
        reason={`${item.observedCount} observado(s) nesta verificação`}
        context={
          <>
            {item.area} · {item.kind}
          </>
        }
        action={
          item.drilldown ? (
            <Link
              className={workbenchPrimaryActionClass}
              to={item.drilldown.path}
              aria-label={`${item.drilldown.label}: ${item.detail}`}
            >
              {item.drilldown.label}
            </Link>
          ) : (
            <span className="text-xs text-gray-400">
              Sem recorte navegável para esta verificação.
            </span>
          )
        }
      />
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
 *
 * A tela deixou de ser um cartão de filtro seguido de espaço: abre por uma FAIXA DE RESUMO com as
 * contagens reais da prontidão e por uma FILA de passos pendentes (bloqueadores e pendências),
 * ordenada pela severidade persistida. Os filtros continuam sendo os mesmos selects, agora numa
 * barra compacta — nenhum recorte, permissão ou chamada mudou.
 */
export function ClosingCenterPage() {
  const { units, unitId, setUnitId } = useOperationalUnits();
  const [periodId, setPeriodId] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'OPEN' | 'CLOSED'>('OPEN');
  const [error, setError] = useState<string | null>(null);

  /**
   * LOOP DE REQUISICAO NA CENTRAL DE FECHAMENTO — corrigido aqui.
   *
   * Os `loader` estavam escritos em linha. `useBackofficeQuery` observa a identidade do
   * `loader` para saber que a CONSULTA mudou (é assim que filtro e escopo disparam recarga),
   * então um `loader` recriado a cada render faz o efeito disparar a cada render. Cada
   * resposta chama `setState`, que re-renderiza, que recria o `loader`, que busca de novo: a
   * pagina nunca silencia a rede.
   *
   * Medido no HML real: `/app/closing` nunca atingia `networkidle` e era a ÚNICA rota que
   * falhava por loop — as demais respondiam. O `useMemo` sobre as entradas reais (unidade,
   * filtro de status, período) devolve identidade ESTÁVEL enquanto a pergunta não muda, e
   * identidade NOVA quando muda — que é exatamente o contrato que o hook espera.
   */
  const periodsLoader = useMemo(
    () => (signal: AbortSignal | undefined) =>
      listPeriodsByUnit({ unitId, status: statusFilter === '' ? undefined : statusFilter }, signal),
    [unitId, statusFilter],
  );

  const periodsQuery = useBackofficeQuery<{ unitId: string; items: AccountingPeriod[] }>({
    enabled: unitId !== '',
    autoLoad: unitId !== '',
    loader: periodsLoader,
    mapError: mapAccountingErrorToMessage,
  });

  // Trocar de unidade zera o período: contexto novo, nunca id órfão de outra unidade.
  useEffect(() => {
    setPeriodId('');
    setError(null);
  }, [unitId]);

  const readinessLoader = useMemo(
    () => (signal: AbortSignal | undefined) => getClosingReadiness({ unitId, periodId }, signal),
    [unitId, periodId],
  );

  const readinessQuery = useBackofficeQuery<ClosingReadiness>({
    enabled: unitId !== '' && periodId !== '',
    autoLoad: unitId !== '' && periodId !== '',
    loader: readinessLoader,
    mapError: mapAccountingErrorToMessage,
  });

  const periods = periodsQuery.state.phase === 'ready' ? periodsQuery.state.data.items : [];
  const readiness = readinessQuery.state.phase === 'ready' ? readinessQuery.state.data : null;

  /**
   * PRÉ-SELEÇÃO SOMENTE PARA LEITURA.
   *
   * A central abria sem competência escolhida, obrigando o operador a descobrir sozinho por
   * onde começar. Quando o servidor já devolve competências para a unidade atual, a mais
   * recente passa a vir selecionada — sem executar nenhuma ação, sem fechar nada e sem
   * esconder o seletor: o operador continua podendo trocar.
   */
  useEffect(() => {
    if (periodId !== '' || periods.length === 0) {
      return;
    }
    const mostRecent = [...periods].sort((left, right) =>
      String(right.code).localeCompare(String(left.code)),
    )[0];
    if (mostRecent) {
      setPeriodId(mostRecent.id);
    }
  }, [periods, periodId]);

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

  const blockerCount = readiness ? readiness.blockers.length : 0;
  const pendingCount = readiness ? readiness.pending.length : 0;
  const draftJournals = readiness ? readiness.accounting.journalCounts.DRAFT : undefined;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Central de fechamento"
        description="Período, pendências e bloqueadores do fechamento contábil e fiscal, lidos do servidor."
      />

      {/* BARRA COMPACTA: os mesmos três recortes humanos, com o mesmo valor enviado ao servidor. */}
      <WorklistFilterBar>
        <WorklistField label="Unidade" htmlFor="closing-unit">
          <select
            id="closing-unit"
            className={worklistSelectClass}
            value={unitId}
            onChange={(event) => setUnitId(event.target.value)}
          >
            {/*
              ESCOPO, NAO SLUG: `unitId` e identificador interno
              (`unit-synthetic-homolog`) e nao vai para a superficie. O `value` continua
              carregando o recorte REAL enviado a API; muda so o texto lido pelo operador.
            */}
            {units.map((unit, index) => (
              <option key={unit} value={unit}>
                Unidade {index + 1}
              </option>
            ))}
          </select>
        </WorklistField>

        <WorklistField label="Situação do período" htmlFor="closing-period-status">
          <select
            id="closing-period-status"
            className={worklistSelectClass}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as '' | 'OPEN' | 'CLOSED')}
          >
            <option value="OPEN">Abertos</option>
            <option value="CLOSED">Fechados</option>
            <option value="">Todos</option>
          </select>
        </WorklistField>

        <WorklistField label="Competência" htmlFor="closing-period" grow>
          {periodsQuery.state.phase === 'ready' && periods.length === 0 ? (
            /**
             * ZERO COMPETÊNCIAS: um select vazio não informa nada e ainda faz o operador
             * clicar para descobrir que não há o que escolher. Aqui o estado é explicado e
             * a única ação oferecida é real: ampliar o recorte de situação para conferir se
             * existe competência fora do filtro atual.
             */
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-gray-700">
                {statusFilter === ''
                  ? 'Nenhuma competência cadastrada para esta unidade.'
                  : `Nenhuma competência ${statusFilter === 'OPEN' ? 'aberta' : 'fechada'} nesta unidade.`}
              </span>
              {statusFilter === '' ? (
                <span className="text-[11px] text-gray-500">
                  O fechamento age sobre uma competência existente; nada é criado aqui.
                </span>
              ) : (
                <button
                  type="button"
                  className="text-xs font-semibold text-brand-700 hover:text-brand-800"
                  onClick={() => setStatusFilter('')}
                >
                  Ver todas as competências
                </button>
              )}
            </span>
          ) : (
            <select
              id="closing-period"
              className={worklistSelectClass}
              value={periodId}
              onChange={(event) => setPeriodId(event.target.value)}
            >
              <option value="">
                {periodsQuery.state.phase === 'loading'
                  ? 'Carregando competências…'
                  : 'Selecione a competência…'}
              </option>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {periodLabel(period)}
                </option>
              ))}
            </select>
          )}
        </WorklistField>
      </WorklistFilterBar>

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
          {/*
            RESUMO DO FECHAMENTO — contagens reais da leitura de prontidão. Métrica sem lastro é
            omitida: sem seção fiscal autorizada, nenhum número fiscal é afirmado.
          */}
          <WorkbenchSummaryStrip>
            <WorkbenchMetric
              value={blockerCount}
              label="bloqueadores"
              tone={blockerCount > 0 ? 'critical' : 'success'}
            />
            <WorkbenchMetric
              value={pendingCount}
              label="pendências"
              tone={pendingCount > 0 ? 'warning' : 'neutral'}
            />
            {typeof draftJournals === 'number' ? (
              <WorkbenchMetric
                value={draftJournals}
                label="lançamentos não postados"
                tone={draftJournals > 0 ? 'warning' : 'success'}
              />
            ) : null}
            {readiness.fiscal ? (
              <WorkbenchMetric
                value={readiness.fiscal.rejected}
                label="documentos fiscais rejeitados"
                tone={readiness.fiscal.rejected > 0 ? 'critical' : 'neutral'}
              />
            ) : null}
          </WorkbenchSummaryStrip>

          {/* 1. BLOQUEADORES — a fila que trava o fechamento, ordenada pela severidade persistida. */}
          <WorkbenchQueue
            title="Bloqueadores do fechamento"
            count={blockerCount}
            description={
              blockerCount > 0
                ? `Fechamento bloqueado: ${blockerCount} verificação(ões) com pendência. As verificações são as mesmas que o fechamento executa no servidor.`
                : readiness.closeReady === true
                  ? 'Nenhum bloqueador: período pronto para fechar. As verificações são as mesmas que o fechamento executa no servidor.'
                  : 'Bloqueadores não avaliados por completo. As verificações são as mesmas que o fechamento executa no servidor.'
            }
            emptyTitle={
              readiness.closeReady === true
                ? 'Nenhum bloqueador persistido'
                : 'Prontidão não afirmada'
            }
            emptyDescription={
              readiness.closeReady === true
                ? 'O servidor não encontrou bloqueio persistido para este período.'
                : 'Não é possível afirmar que o período está pronto: há verificação sem avaliação por autorização.'
            }
          >
            <ul aria-label="Bloqueadores do fechamento">
              {readiness.blockers.map((item) => (
                <ExceptionItem key={`${item.kind}-${item.area}`} item={item} />
              ))}
            </ul>
          </WorkbenchQueue>

          {/* 2. PENDÊNCIAS (informativas: não bloqueiam pela política vigente) */}
          {pendingCount > 0 ? (
            <WorkbenchQueue
              title="Pendências observadas"
              count={pendingCount}
              description="Verificações que não bloqueiam o fechamento pela política vigente."
            >
              <ul aria-label="Pendências do fechamento">
                {readiness.pending.map((item) => (
                  <ExceptionItem key={`${item.kind}-${item.area}`} item={item} />
                ))}
              </ul>
            </WorkbenchQueue>
          ) : null}

          {/* 3. PRÓXIMAS AÇÕES */}
          <section className="mb-3 rounded-md border border-gray-200 bg-white px-3 py-2">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Próximas ações</h2>
            <ul className="mb-3 space-y-1" aria-label="Próximas ações do fechamento">
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
          </section>

          {/* 4. SITUAÇÃO DO PERÍODO */}
          <section className="mb-3 rounded-md border border-gray-200 bg-white px-3 py-2">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">Situação do período</h2>
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
              <ul className="mt-3" aria-label="Seções omitidas por autorização">
                {readiness.withheld.map((entry) => (
                  <li key={entry.area} className="text-sm text-gray-500">
                    {entry.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* 5. DETALHES */}
          <div className={worklistTableCardClass}>
            <table className={worklistTableClass} aria-label="Lançamentos por situação no período">
              <thead className={worklistHeadCellClass}>
                <tr>
                  <th scope="col" className={worklistHeadCellClass}>
                    Lançamentos
                  </th>
                  <th scope="col" className={`${worklistHeadCellClass} text-right`}>
                    Quantidade
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(readiness.accounting.journalCounts).map(([status, count]) => (
                  <tr key={status} className={worklistRowClass}>
                    <td className={worklistCellClass}>
                      {JOURNAL_COUNT_LABELS[status] ?? status}
                    </td>
                    <td className={`${worklistCellClass} text-right`}>{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </ModulePage>
  );
}
