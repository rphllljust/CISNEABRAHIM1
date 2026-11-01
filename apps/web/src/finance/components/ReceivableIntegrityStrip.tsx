import { useCallback } from 'react';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { getReceivableIntegrity } from '../api/finance-api';
import { FinanceSituationStrip } from './FinanceSituation';

/**
 * MASTER 001-05 — monitoramento visível de integridade sem falsificar dados ou acesso.
 * Não publica detalhes globais para quem não tem platform:diagnostics:read: 403 é fail-closed.
 * Não há drilldown neste corte: a API publica contagens globais, não listas autorizadas.
 */
export function ReceivableIntegrityStrip() {
  const loader = useCallback((signal?: AbortSignal) => getReceivableIntegrity(signal), []);
  const { state, reload, refreshing } = useBackofficeQuery({
    loader,
    mapError: () => 'Diagnóstico de integridade indisponível. Tente novamente.',
  });

  if (state.phase === 'denied') {
    return (
      <p role="status" className="m-0 border-b border-[color:var(--color-divider)] py-2 text-xs text-[color:var(--color-text-muted)]">
        Integridade Billing → Recebíveis: diagnóstico não autorizado para este perfil.
      </p>
    );
  }

  if (state.phase === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--color-divider)] py-2">
        <span className="text-xs text-red-700">{state.message}</span>
        {state.retryable ? (
          <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => void reload()}>
            Tentar novamente
          </button>
        ) : null}
      </div>
    );
  }

  const snapshot = state.phase === 'ready' ? state.data : null;
  const backlog = snapshot?.technical.backlog ?? null;
  const critical = backlog !== null &&
    (backlog.receivableHandoffDead > 0 || backlog.billingReceivableOrphans > 0);
  const collectedAt = snapshot
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
        .format(new Date(snapshot.collectedAt))
    : null;

  return (
    <section aria-label="Monitoramento de integridade Billing e recebíveis" className="min-w-0 pt-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
          <strong className="font-semibold text-[color:var(--color-text-primary)]">Integridade Billing → Recebíveis</strong>
          <span role="status" className="text-[color:var(--color-text-muted)]">
            {collectedAt ? 'Coleta: ' + collectedAt : 'Aguardando diagnóstico autorizado…'}
          </span>
        </div>
        {snapshot ? (
          <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => void reload()}>
            {refreshing ? 'Atualizando…' : 'Atualizar indicadores'}
          </button>
        ) : null}
      </div>
      <FinanceSituationStrip
        ariaLabel="Indicadores de integridade Billing e recebíveis"
        items={[
          {
            id: 'receivable-handoff-dead',
            label: 'Handoffs financeiros falhos',
            value: backlog ? String(backlog.receivableHandoffDead) : null,
            note: 'Jobs DEAD/FAILED',
            tone: backlog === null ? 'neutral' : backlog.receivableHandoffDead > 0 ? 'critical' : 'success',
          },
          {
            id: 'billing-receivable-orphans',
            label: 'Faturas sem recebível',
            value: backlog ? String(backlog.billingReceivableOrphans) : null,
            note: 'FINALIZED há mais de 5 min',
            tone: backlog === null ? 'neutral' : backlog.billingReceivableOrphans > 0 ? 'critical' : 'success',
          },
          {
            id: 'receivable-handoff-pending',
            label: 'Handoffs em processamento',
            value: backlog ? String(backlog.receivableHandoffPending) : null,
            note: critical ? 'Investigar falhas antes de novo faturamento' : 'Contagem autoritativa do PostgreSQL',
            tone: backlog === null ? 'neutral' : critical ? 'warning' : 'info',
          },
        ]}
      />
    </section>
  );
}
