import { Link, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { mapBillingErrorToMessage } from '../api/billing-error-messages';
import { useBillingCapabilities } from '../hooks/useBillingCapabilities';
import {
  BILLING_FUTURE_PROCESS_STEPS,
  BILLING_PROCESS_STEPS,
  BILLING_RECEIVABLE_HREF,
  groupWorkQueueByBucket,
} from '../utils/billing-process';
import { loadBillingWorkQueue } from '../utils/billing-work-queue';
import {
  BILLING_PROCESS_BUCKETS,
  type BillingProcessBucket,
  type BillingWorkQueueItem,
} from '../types/billing.types';
import { ServiceOrdersApiError } from '../../service-orders/api/service-orders-api';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
} from '../../ui/module-layout';
import {
  EnterpriseMetric,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistHeader,
  worklistSelectClass,
} from '../../ui/enterprise-list';
import { DynamicKanban, useEntitySchema, type DynamicKanbanColumn } from '../../engine';
import {
  WorkbenchQueue,
} from '../../ui/workbench';
import {
  billingCardBadges,
  billingEngineRows,
  BILLING_QUEUE_CARD_FIELDS,
  type BillingEngineRow,
} from './billing-engine-rows';

type PageState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: BillingWorkQueueItem[] };

/**
 * FATURAMENTO INTERNO — MESA DE TRABALHO, RENDERIZADA PELA ENGINE.
 *
 * O quadro deixou de ser `BillingProcessBoard` (JSX com as três colunas escritas à mão) e
 * passou a ser `DynamicKanban` alimentado com COLUNAS DERIVADAS. As colunas continuam sendo os
 * três estágios reais do processo — nada foi perdido — mas a engine é quem desenha.
 *
 * POR QUE DERIVADAS, E NÃO PELO WORKFLOW: o eixo deste quadro é uma classificação CALCULADA
 * ("pronto para faturar" = medição aprovada; "com divergência" = condições comerciais
 * conflitantes), não o `status` persistido do registro, que só tem PREPARED e VOIDED. O
 * metadata store não sabe expressar agrupamento derivado — GAP_DE_CONTRATO declarado. Até ele
 * saber, a tela fornece as colunas e a engine as desenha.
 *
 * `groupWorkQueueByBucket` continua sendo a fonte do agrupamento: as contagens do cabeçalho e
 * as colunas do quadro saem do MESMO cálculo, em vez de duas lógicas que podem divergir.
 */
export function BillingDashboardPage() {
  const navigate = useNavigate();
  const { capabilities, loading: capabilitiesLoading } = useBillingCapabilities();
  const { schema } = useEntitySchema('billing-records');
  const [state, setState] = useState<PageState>({ phase: 'loading' });
  /** Recorte por estágio do processo — vazio = fila completa. */
  const [stage, setStage] = useState<BillingProcessBucket | ''>('');

  const reload = useCallback(async (signal?: AbortSignal) => {
    setState({ phase: 'loading' });
    try {
      const items = await loadBillingWorkQueue(signal);
      setState({ phase: 'ready', items });
    } catch (error) {
      if (error instanceof ServiceOrdersApiError && error.kind === 'denied') {
        setState({ phase: 'denied' });
        return;
      }
      setState({
        phase: 'error',
        message:
          error instanceof ServiceOrdersApiError
            ? mapBillingErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar o painel de faturamento.',
        retryable: true,
      });
    }
  }, []);

  useEffect(() => {
    if (capabilitiesLoading) {
      return;
    }
    if (!capabilities.canRead) {
      setState({ phase: 'denied' });
      return;
    }
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [capabilities.canRead, capabilitiesLoading, reload]);

  const grouped = useMemo(
    () => (state.phase === 'ready' ? groupWorkQueueByBucket(state.items) : null),
    [state],
  );

  /**
   * Colunas derivadas do quadro, na ordem de PRECEDÊNCIA do processo.
   *
   * Divergência vem primeiro porque o item divergente precisa de atenção antes de ser
   * preparado; a engine coloca cada linha na primeira coluna que a reivindica.
   *
   * COR E TEXTO VEM DAQUI: a borda de topo de cada estágio e o texto de coluna vazia são os
   * mesmos do quadro artesanal que esta tela substituiu (`.billing-board__column--ready`,
   * `--prepared`, `--divergence` em index.css). A engine recebe a cor e desenha — ela não
   * conhece a paleta de faturamento.
   */
  const derivedColumns = useMemo<DynamicKanbanColumn[]>(
    () => [
      {
        key: BILLING_PROCESS_BUCKETS.Divergence,
        title: 'Com divergência',
        description: 'Condições comerciais conflitantes exigem alinhamento.',
        accent: '#b45309',
        emptyText: 'Nenhum item nesta etapa.',
        match: (row: Record<string, unknown>) =>
          row['__bucket'] === BILLING_PROCESS_BUCKETS.Divergence,
      },
      {
        key: BILLING_PROCESS_BUCKETS.Ready,
        title: 'Pronto para faturar',
        description: 'Medição aprovada aguardando preparação.',
        accent: '#0f766e',
        emptyText: 'Nenhum item nesta etapa.',
        match: (row: Record<string, unknown>) =>
          row['__bucket'] === BILLING_PROCESS_BUCKETS.Ready,
      },
      {
        key: BILLING_PROCESS_BUCKETS.Prepared,
        title: 'Em preparação',
        description: 'Preparação concluída e candidata a documento externo.',
        accent: '#1d4ed8',
        emptyText: 'Nenhum item nesta etapa.',
        match: (row: Record<string, unknown>) =>
          row['__bucket'] === BILLING_PROCESS_BUCKETS.Prepared,
      },
    ],
    [],
  );

  if (capabilitiesLoading || state.phase === 'loading') {
    return (
      <ModuleStatePage title="Faturamento interno">
        <ModuleLoadingState message="Carregando painel…" />
      </ModuleStatePage>
    );
  }

  if (state.phase === 'denied') {
    return (
      <ModuleStatePage title="Faturamento interno">
        <ModuleDeniedState message="Você não tem permissão para acessar o faturamento interno." />
      </ModuleStatePage>
    );
  }

  if (state.phase === 'error') {
    return (
      <ModuleStatePage title="Faturamento interno">
        <ModuleErrorState
          message={state.message}
          retryable={state.retryable}
          onRetry={() => void reload()}
        />
      </ModuleStatePage>
    );
  }

  const divergenceCount = grouped?.[BILLING_PROCESS_BUCKETS.Divergence].length ?? 0;
  const readyCount = grouped?.[BILLING_PROCESS_BUCKETS.Ready].length ?? 0;
  const preparedCount = grouped?.[BILLING_PROCESS_BUCKETS.Prepared].length ?? 0;

  const stageItems =
    stage === '' ? state.items : (grouped?.[stage] ?? []);

  return (
    <ModulePage>
      <WorklistHeader
        title="Faturamento interno"
        count={stageItems.length}
        context="Cobrança operacional interna: preparação a partir de medições aprovadas. A Nota Fatura é documento interno e não constitui NF-e, NFS-e nem emissão fiscal oficial."
        metrics={
          <>
            <EnterpriseMetric
              value={divergenceCount}
              label="com divergência"
              tone={divergenceCount > 0 ? 'warning' : 'neutral'}
            />
            <EnterpriseMetric
              value={readyCount}
              label="prontos para faturar"
              tone={readyCount > 0 ? 'info' : 'neutral'}
            />
            <EnterpriseMetric value={preparedCount} label="em preparação" />
          </>
        }
      />

      <WorklistFilterBar meta={`${stageItems.length} nesta página`}>
        <WorklistField label="Estágio" htmlFor="billing-stage-filter">
          <select
            id="billing-stage-filter"
            className={worklistSelectClass}
            value={stage}
            onChange={(event) => setStage(event.target.value as BillingProcessBucket | '')}
          >
            <option value="">Todos os estágios</option>
            <option value={BILLING_PROCESS_BUCKETS.Divergence}>
              Com divergência ({divergenceCount})
            </option>
            <option value={BILLING_PROCESS_BUCKETS.Ready}>
              Prontos para faturar ({readyCount})
            </option>
            <option value={BILLING_PROCESS_BUCKETS.Prepared}>
              Em preparação ({preparedCount})
            </option>
          </select>
        </WorklistField>
        <WorklistClearFilters visible={stage !== ''} onClick={() => setStage('')} />
      </WorklistFilterBar>

      <WorkbenchQueue
        title="Fila de trabalho do faturamento"
        count={stageItems.length}
        description="Cada coluna é um estágio real do processo; o cartão leva a ordem de serviço e mostra a divergência quando existe."
        emptyTitle="Nenhum trabalho de faturamento na fila"
        emptyDescription="Não há medição aprovada aguardando preparação nem preparação pendente no seu escopo."
      >
        <DynamicKanban
          schema={schema}
          rows={billingEngineRows(stageItems)}
          derivedColumns={derivedColumns}
          ownerField="client_id"
          cardFields={BILLING_QUEUE_CARD_FIELDS}
          renderCardHeader={(row) => {
            const serviceOrderId = row['__serviceOrderId'];
            const orderNumber = row['service_order_id'];
            if (typeof serviceOrderId !== 'string' || typeof orderNumber !== 'string') {
              return null;
            }
            // LINK REAL: preserva histórico, abrir-em-nova-aba e o botão do meio do mouse.
            return (
              <h3 className="text-xs font-semibold">
                <Link to={`/app/service-orders/${serviceOrderId}/billing`}>{orderNumber}</Link>
              </h3>
            );
          }}
          renderCardFlag={(row) =>
            row['__hasDivergence'] === true
              ? {
                  // Mesma cor de `.billing-process-card__flag` (--billing-divergence).
                  content: 'Divergência de condições',
                  accent: '#b45309',
                }
              : null
          }
          badges={(row) => billingCardBadges(row as BillingEngineRow)}
        />
      </WorkbenchQueue>

      <nav className="billing-process-chain" aria-label="Etapas do processo de faturamento">
        <ol className="billing-process-chain__list">
          {BILLING_PROCESS_STEPS.map((step, index) => (
            <li key={step.id} className="billing-process-chain__item">
              <span className="billing-process-chain__index" aria-hidden>
                {index + 1}
              </span>
              {step.id === 'receivable' ? (
                <Link to={BILLING_RECEIVABLE_HREF}>{step.label}</Link>
              ) : (
                <span>{step.label}</span>
              )}
              {index < BILLING_PROCESS_STEPS.length - 1 ? (
                <span className="billing-process-chain__arrow" aria-hidden>
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </nav>

      <section className="billing-future-steps" aria-label="Etapas fora deste fluxo">
        <h2 className="billing-future-steps__title">Fora deste fluxo</h2>
        <ul className="billing-future-steps__list">
          {BILLING_FUTURE_PROCESS_STEPS.map((step) => (
            <li key={step.id} className="billing-future-steps__item" aria-disabled="true">
              {step.label}
            </li>
          ))}
        </ul>
      </section>
    </ModulePage>
  );
}
