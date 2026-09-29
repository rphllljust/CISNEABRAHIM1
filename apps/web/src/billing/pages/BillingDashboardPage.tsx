import { Link } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { mapBillingErrorToMessage } from '../api/billing-error-messages';
import { useBillingCapabilities } from '../hooks/useBillingCapabilities';
import { BillingProcessBoard } from '../components/BillingProcessBoard';
import { BILLING_FUTURE_PROCESS_STEPS, BILLING_PROCESS_STEPS, BILLING_RECEIVABLE_HREF } from '../utils/billing-process';
import { loadBillingWorkQueue } from '../utils/billing-work-queue';
import type { BillingWorkQueueItem } from '../types/billing.types';
import { ServiceOrdersApiError } from '../../service-orders/api/service-orders-api';

type PageState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: BillingWorkQueueItem[] };

export function BillingDashboardPage() {
  const { capabilities, loading: capabilitiesLoading } = useBillingCapabilities();
  const [state, setState] = useState<PageState>({ phase: 'loading' });

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
      <main id="main-content" className="shell-page billing-page">
        <h1>Faturamento interno</h1>
        <p aria-busy="true" aria-live="polite">
          Carregando painel…
        </p>
      </main>
    );
  }

  if (state.phase === 'denied') {
    return (
      <main id="main-content" className="shell-page billing-page">
        <h1>Faturamento interno</h1>
        <p role="alert">Você não tem permissão para acessar o faturamento interno.</p>
        <Link to="/app">Voltar ao início</Link>
      </main>
    );
  }

  if (state.phase === 'error') {
    return (
      <main id="main-content" className="shell-page billing-page">
        <h1>Faturamento interno</h1>
        <p role="alert">{state.message}</p>
        {state.retryable ? (
          <button type="button" className="billing-button" onClick={() => void reload()}>
            Tentar novamente
          </button>
        ) : null}
      </main>
    );
  }

  return (
    <main id="main-content" className="shell-page billing-page">
      <header className="billing-page__header">
        <p className="billing-page__eyebrow">Cobrança operacional interna</p>
        <h1>Faturamento interno</h1>
        <p className="billing-page__lead">
          Preparação de cobrança a partir de medições aprovadas. A Nota Fatura é documento interno
          e não constitui NF-e, NFS-e nem emissão fiscal oficial.
        </p>
      </header>

      {/*
        CADEIA REAL DO PROCESSO — o que o produto EXECUTA hoje. Cada etapa leva ao
        objeto que a representa. Antes esta area declarava "Contas a receber" como
        indisponivel, o que era falso: o recebivel e criado a partir do documento
        interno e tem tela propria.
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

      <BillingProcessBoard items={state.items} />
    </main>
  );
}
