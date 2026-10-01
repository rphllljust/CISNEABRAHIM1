import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Field, Input, StatusBadge } from '../../ui';
import {
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePagination,
  UnitScopeLabel,
} from '../../ui/module-layout';
import {
  EnterpriseMetric,
  WorklistClearFilters,
  WorklistException,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  WorklistStatePanel,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistRowClass,
  worklistSelectClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { CreateRecordForm, VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { cn } from '../../ui/utils/cn';
import { PERIOD_STATUS_LABELS } from '../../financial-ui/labels';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { OperationalUnitOptions } from '../../shell/hooks/useOperationalUnits';
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

/**
 * ESTADO OPERACIONAL DO PERÍODO — a leitura que a linha precisa entregar antes da situação.
 *
 * Cada frase é uma condição booleana sobre campos que a LISTAGEM já publica (`status`,
 * `closedAt`, `reopenedAt`). O ciclo real do domínio é abrir → fechar → reabrir: um período
 * ABERTO que já foi reaberto é um fato persistido (`reopenedAt`) e precisa ser distinguível de
 * um período que nunca fechou. Sem fato, a célula não afirma nada.
 */
function PERIOD_NOTICE(item: { status: string; reopenedAt: string | null }): string | null {
  if (item.status === 'CLOSED') {
    return 'Fechado — novas transições fiscais desta competência estão bloqueadas no servidor.';
  }
  if (item.reopenedAt) {
    return 'Reaberto — o período voltou a aceitar transições nesta competência.';
  }
  return null;
}

/** Referência humana da competência: `AAAA-MM` (periodKey do servidor) → `MM/AAAA`. */
function formatPeriodKey(periodKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey.trim());
  return match ? `${match[2]}/${match[1]}` : periodKey;
}

/** Data do fato persistido sem arrastar fuso: a listagem publica ISO; a tela mostra o dia. */
function formatInstant(value: string | null): string {
  return value ? value.slice(0, 10) : '—';
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
  const { options: unitOptions, unitId, setUnitId } = useFiscalUnits();
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
  const items = state.phase === 'ready' ? state.items : [];
  const total = state.phase === 'ready' ? state.total : null;
  const currentPage = state.phase === 'ready' ? state.page : 0;
  /**
   * CONTAGEM DE CADASTRO sobre as linhas devolvidas — nunca competência ou valor calculado.
   * `reopenedCount` usa `reopenedAt`, que a listagem publica: períodos que voltaram a aceitar
   * transições são o caso que mais exige atenção do operador.
   */
  const openOnPage = items.filter((item) => item.status === 'OPEN').length;
  const reopenedOnPage = items.filter((item) => item.reopenedAt !== null).length;
  const awaitingClosure = items.filter(
    (item) => item.status === 'OPEN' && item.reopenedAt === null,
  ).length;

  return (
    <ModulePage>
      <WorklistHeader
        title="Períodos fiscais"
        count={total}
        context="Abertura, fechamento e reabertura são decididos pelo backend."
        action={
          /*
            ABRIR PERÍODO é AÇÃO de entrada, não identidade da página: fica no cabeçalho como
            acao primaria e a secao de formulario sai da primeira dobra. O mesmo endpoint, o
            mesmo contrato e a mesma idempotencia — so muda onde a acao mora.
          */
          <span className="flex items-center gap-2">
            {/*
              Unidade do formulário de abertura: o operador precisa ver PARA QUAL unidade vai
              abrir a competência antes de enviar. O valor continua sendo a unidade autorizada.
            */}
            <label
              htmlFor="fiscal-period-unit"
              className="text-[10px] font-semibold tracking-wide text-gray-500 uppercase"
            >
              Unidade
            </label>
            <input
              id="fiscal-period-unit"
              value={unitId}
              readOnly
              className={`${worklistSelectClass} w-40 bg-gray-50`}
            />
          </span>
        }
        metrics={
          items.length > 0 ? (
            <>
              <EnterpriseMetric label="Abertos nesta página" value={openOnPage} />
              <EnterpriseMetric
                label="Aguardando fechamento"
                value={awaitingClosure}
                tone={awaitingClosure > 0 ? 'warning' : 'neutral'}
              />
              {reopenedOnPage > 0 ? (
                <EnterpriseMetric label="Já reabertos" value={reopenedOnPage} tone="info" />
              ) : null}
              <EnterpriseMetric label="Fechados nesta página" value={items.length - openOnPage} />
            </>
          ) : null
        }
      />

      {/* BARRA OPERACIONAL: unidade e situação na mesma linha densa das demais worklists. */}
      <WorklistFilterBar meta={total !== null ? `${total} período(s) no recorte` : undefined}>
        <WorklistField label="Unidade" htmlFor="fiscal-period-unit-filter">
          <select
            id="fiscal-period-unit-filter"
            className={worklistSelectClass}
            value={unitId}
            onChange={(event) => {
              setUnitId(event.target.value);
              setPage(0);
            }}
          >
            {/*
              ESCOPO DE UNIDADE pelo primitivo compartilhado — mesmo tratamento das demais
              famílias. O valor enviado à API continua sendo a unidade autorizada.
            */}
            <OperationalUnitOptions options={unitOptions} />
          </select>
        </WorklistField>
        <WorklistField label="Situação" htmlFor="fiscal-period-status-filter">
          <select
            id="fiscal-period-status-filter"
            className={worklistSelectClass}
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
        </WorklistField>
        <WorklistClearFilters
          visible={status !== ''}
          onClick={() => {
            setStatus('');
            setPage(0);
          }}
          label="Limpar situação"
        />
      </WorklistFilterBar>

      {/*
        ABRIR PERÍODO — ação de ENTRADA, depois da fila. A tabela É a página; o formulário de
        abertura não pode ocupar a primeira dobra de quem veio fechar o mês. Continua sendo o
        mesmo `CreateRecordForm` (contrato, idempotência e tratamento de erro idênticos).
      */}
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

      {/* ESTADO VAZIO DENTRO DA ESTRUTURA — cabeçalho e barra seguem montados. */}
      {state.phase === 'ready' && items.length === 0 ? (
        <WorklistStatePanel
          title={
            status === ''
              ? 'Nenhum período fiscal'
              : `Nenhum período ${status === 'OPEN' ? 'aberto' : 'fechado'} nesta unidade`
          }
          description="Não há períodos fiscais persistidos para a unidade e a situação selecionadas. Abra a competência na seção acima para começar."
          action={
            <WorklistClearFilters
              visible={status !== ''}
              onClick={() => {
                setStatus('');
                setPage(0);
              }}
              label="Ver todas as situações"
            />
          }
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <div className={worklistTableCardClass}>
            <table className={worklistTableClass} aria-label="Lista de períodos fiscais">
              <thead>
                <tr>
                  <th scope="col" className={worklistHeadCellClass}>
                    Competência
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Situação
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Estado do período
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Fechado em
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Reaberto em
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Próxima ação
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const notice = PERIOD_NOTICE(item);
                  return (
                    <tr key={item.id} className={worklistRowClass}>
                      {/*
                        COLUNA PRINCIPAL = competência em MM/AAAA (a referência que o operador
                        usa), com a chave do servidor abaixo. O `id` do registro nao e a
                        referencia primaria da linha.
                      */}
                      <td className={worklistCellClass}>
                        <WorklistRowLink href={`/app/fiscal/periods/${item.id}`}>
                          <span className="block">{formatPeriodKey(item.periodKey)}</span>
                        </WorklistRowLink>
                        <span className="font-mono text-[11px] text-gray-500">{item.periodKey}</span>
                      </td>
                      <td className={worklistCellRaisedClass}>
                        <FinanceStatusBadge status={item.status} labels={PERIOD_STATUS_LABELS} />
                        {item.reopenedAt ? (
                          <span className="mt-0.5 block text-[11px] text-gray-500">
                            Reaberto {formatInstant(item.reopenedAt)}
                          </span>
                        ) : null}
                      </td>
                      {/*
                        ESTADO DO PERÍODO — o que a situação significa para o trabalho de hoje.
                        Fechado bloqueia novas transições; reaberto voltou a aceitá-las. Sem
                        fato persistido que sustente a frase, a célula não afirma nada.
                      */}
                      <td className={cn(worklistCellRaisedClass, 'whitespace-normal')}>
                        {notice ? (
                          <WorklistException tone={item.status === 'CLOSED' ? 'info' : 'warning'}>
                            {notice}
                          </WorklistException>
                        ) : (
                          <span className="text-[11px] text-gray-500">
                            Aberto e nunca fechado — aceita transições.
                          </span>
                        )}
                      </td>
                      <td className={worklistCellRaisedClass}>
                        {formatInstant(item.closedAt)}
                      </td>
                      <td className={worklistCellRaisedClass}>
                        {formatInstant(item.reopenedAt)}
                      </td>
                      <td className={worklistCellRaisedClass}>
                        <span
                          className={
                            item.status === 'OPEN'
                              ? 'text-[12px] font-medium text-gray-800'
                              : 'text-[12px] text-gray-500'
                          }
                        >
                          {NEXT_ACTION_FOR(item.status)}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-gray-500">
                          <UnitScopeLabel unitId={item.unitId} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <WorklistFooter
            rangeLabel={
              <span aria-live="polite">
                Página {currentPage + 1} · {total} período(s) no recorte
              </span>
            }
            extra={status === '' ? null : `situação: ${status === 'OPEN' ? 'Aberto' : 'Fechado'}`}
          >
            <ModulePagination
              pageNumber={currentPage + 1}
              previousDisabled={currentPage === 0}
              nextDisabled={!hasMore}
              onPrevious={() => setPage((current) => Math.max(0, current - 1))}
              onNext={() => setPage((current) => current + 1)}
            />
          </WorklistFooter>
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
      <WorklistHeader
        title="Período fiscal"
        context="Abertura, fechamento e reabertura são decididos pelo backend, com SOD e justificativa."
        action={
          <Link
            to="/app/fiscal/periods"
            className="text-[13px] font-semibold text-brand-700 no-underline hover:text-brand-800"
          >
            ← Voltar para períodos
          </Link>
        }
        metrics={
          state.phase === 'ready' ? (
            <>
              <EnterpriseMetric label="Competência" value={state.data.periodKey} />
              <EnterpriseMetric
                label="Situação"
                value={PERIOD_STATUS_LABELS[state.data.status] ?? state.data.status}
                tone={state.data.status === 'OPEN' ? 'warning' : 'neutral'}
              />
              <EnterpriseMetric label="Versão" value={state.data.rowVersion} />
            </>
          ) : null
        }
      />
      {gate}
      {state.phase === 'ready' ? (
        <>
          {/*
            ESTADO DO PERÍODO — faixa densa com o fato persistido, não cartão `rounded-xl p-6`.
            Competência, versão e motivo da reabertura continuam sendo exatamente os do servidor.
          */}
          <section
            className="mb-2 rounded-md border border-gray-200 bg-white"
            aria-label="Estado do período fiscal"
          >
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-3 py-2">
              <StatusBadge
                tone={state.data.status === 'OPEN' ? 'warning' : 'success'}
                label={PERIOD_STATUS_LABELS[state.data.status] ?? state.data.status}
              />
              <span className="text-[13px] font-semibold text-gray-900">
                {formatPeriodKey(state.data.periodKey)}
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-x-4 text-xs text-gray-600 tabular-nums">
                <span>
                  Versão <strong>{state.data.rowVersion}</strong>
                </span>
                <span>
                  Fechado em <strong>{formatInstant(state.data.closedAt)}</strong>
                </span>
                <span>
                  Reaberto em <strong>{formatInstant(state.data.reopenedAt)}</strong>
                </span>
              </span>
            </div>
            {PERIOD_NOTICE(state.data) ? (
              <div className="border-t border-gray-100 px-3 py-1.5">
                <WorklistException tone={state.data.status === 'CLOSED' ? 'info' : 'warning'}>
                  {PERIOD_NOTICE(state.data)!}
                </WorklistException>
              </div>
            ) : null}
          </section>

          {/*
            CHECAGENS DE FECHAMENTO — o dado que decide o fechamento, publicado pelo detalhe
            (`closeChecks`). Antes ele existia no contrato e não era lido em lugar nenhum: o
            operador apertava "Fechar" sem saber o que o servidor ia avaliar. Cada linha é o
            resultado que o próprio backend calculou, inclusive as não bloqueantes.
          */}
          <section
            className="mb-2 rounded-md border border-gray-200 bg-white"
            aria-label="Checagens de fechamento do período"
          >
            <div className="border-b border-gray-200 px-3 py-2">
              <h2 className="text-[13px] font-semibold text-gray-900">Checagens de fechamento</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Resultado calculado pelo servidor. Checagem bloqueante impedida é o que trava o
                fechamento; nada aqui é reavaliado no frontend.
              </p>
            </div>
            {state.data.closeChecks.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-500">
                O servidor não publicou checagens para este período.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className={worklistTableClass} aria-label="Checagens de fechamento">
                  <thead>
                    <tr>
                      <th scope="col" className={worklistHeadCellClass}>
                        Checagem
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Resultado
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Bloqueante
                      </th>
                      <th scope="col" className={worklistHeadCellClass}>
                        Detalhe
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.closeChecks.map((check, index) => (
                      <tr key={`${check.kind}-${index}`} className={worklistRowClass}>
                        <td className={worklistCellRaisedClass}>{check.kind}</td>
                        <td className={worklistCellRaisedClass}>{check.result}</td>
                        <td className={worklistCellRaisedClass}>
                          {check.blocking ? 'Sim' : 'Não'}
                        </td>
                        <td className={cn(worklistCellRaisedClass, 'whitespace-normal')}>
                          {check.detail}
                          {check.observedCount > 0 ? ` · ${check.observedCount} ocorrência(s)` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/*
            AÇÕES DO PERÍODO — fechar e reabrir eram dois formulários empilhados que faziam a tela
            parecer backoffice antigo. Continuam sendo exatamente as mesmas ações (mesma versão,
            mesma justificativa, mesma decisão do backend), agora numa seção declarada como AÇÕES.
          */}
          <section
            className="mb-3 rounded-md border border-gray-200 bg-white"
            aria-label="Ações do período fiscal"
          >
            <div className="border-b border-gray-200 px-3 py-2">
              <h2 className="text-[13px] font-semibold text-gray-900">Ações do período</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                As checagens de fechamento correm no servidor; a reabertura exige justificativa e
                checker distinto (SOD).
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 px-3 py-2 lg:grid-cols-2">
              <VersionedActionForm
                title="Fechar"
                description="Checagens de fechamento correm no servidor."
                confirmTitle="Fechar período fiscal"
                confirmDescription="O período só fecha se as checagens do backend passarem."
                confirmLabel="Fechar"
                disabled={state.data.status !== 'OPEN'}
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
                disabled={state.data.status !== 'CLOSED'}
                mapError={mapFiscalErrorToMessage}
                onReload={() => void reload()}
                onSubmit={async ({ reason }) =>
                  setReady(await reopenFiscalPeriod(state.data.id, { reason: reason ?? '' }))
                }
              />
            </div>
            {state.data.reopenReason ? (
              <p className="border-t border-gray-200 px-3 py-2 text-xs text-gray-600">
                Motivo registrado da última reabertura:{' '}
                <strong className="font-medium text-gray-900">{state.data.reopenReason}</strong>
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </ModulePage>
  );
}
