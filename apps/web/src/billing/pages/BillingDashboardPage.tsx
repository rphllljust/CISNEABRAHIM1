import { Link } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { mapBillingErrorToMessage } from '../api/billing-error-messages';
import { useBillingCapabilities } from '../hooks/useBillingCapabilities';
import { BillingProcessBoard } from '../components/BillingProcessBoard';
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
import { EnterpriseMetric, WorklistClearFilters, WorklistField, WorklistFilterBar, WorklistHeader, worklistSelectClass } from '../../ui/enterprise-list';
import { WorkbenchQueue } from '../../ui/workbench';

type PageState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: BillingWorkQueueItem[] };

/**
 * FATURAMENTO INTERNO — MESA DE TRABALHO, NAO PAINEL DE CONSULTA.
 *
 * A tela abria por um cabecalho de apresentacao e uma cadeia de processo: nada dizia, na primeira
 * dobra, QUANTO trabalho existe nem por onde o operador comeca. Agora ela tem a mesma moldura das
 * demais filas — faixa de resumo com as contagens REAIS dos estagios, a fila de trabalho no topo e
 * a cadeia do processo como CONTEXTO abaixo dela.
 *
 * Nenhuma contagem e inventada: os numeros vem do mesmo agrupamento que a propria fila exibe
 * (`groupWorkQueueByBucket`, derivado do estado persistido da medicao e da preparacao). Nenhuma
 * regra, chamada, rota ou capability mudou.
 */
export function BillingDashboardPage() {
  const { capabilities, loading: capabilitiesLoading } = useBillingCapabilities();
  const [state, setState] = useState<PageState>({ phase: 'loading' });
  /** Recorte por estagio do processo — vazio = fila completa. */
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

  const grouped = groupWorkQueueByBucket(state.items);
  const divergenceCount = grouped[BILLING_PROCESS_BUCKETS.Divergence].length;
  const readyCount = grouped[BILLING_PROCESS_BUCKETS.Ready].length;
  const preparedCount = grouped[BILLING_PROCESS_BUCKETS.Prepared].length;

  /**
   * FILTRO POR ESTAGIO — o workbench nao tinha barra de filtros porque NAO HAVIA O QUE FILTRAR
   * no servidor: `loadBillingWorkQueue` nao aceita parametro, e os estagios sao derivados no
   * cliente por `groupWorkQueueByBucket`.
   *
   * O ESTAGIO, porem, e um recorte real e util: sao exatamente os tres baldes que a tela ja
   * publica como indicadores. Filtrar por ele usa dado que JA esta carregado — nenhuma consulta
   * nova, nenhum contrato novo, nenhuma regra nova.
   *
   * A barra usa o mesmo primitivo das demais worklists (`WorklistFilterBar` / `WorklistField`),
   * com o rotulo humano de cada estagio. Sem filtro ativo a fila mostra tudo, como antes.
   */
  const stageItems =
    stage === '' ? state.items : groupWorkQueueByBucket(state.items)[stage];

  return (
    <ModulePage>
      {/*
        GRAMATICA DE WORKLIST — `WorklistHeader` no lugar de `ModulePageHeader`, para o operador
        reconhecer a mesa de trabalho pelo mesmo desenho das demais listas. O resumo continua
        vindo do MESMO agrupamento da fila (`groupWorkQueueByBucket`), agora na faixa de
        indicadores da cabeca em vez de uma segunda faixa logo abaixo dela.
      */}
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
            <EnterpriseMetric
              value={preparedCount}
              label="em preparação"
            />
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
        <BillingProcessBoard items={stageItems} />
      </WorkbenchQueue>

      {/*
        CADEIA REAL DO PROCESSO — CONTEXTO da fila acima. O que o produto EXECUTA hoje. Cada etapa
        leva ao objeto que a representa. Antes esta area declarava "Contas a receber" como
        indisponivel, o que era falso: o recebivel e criado a partir do documento interno e tem
        tela propria.
      */}
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
