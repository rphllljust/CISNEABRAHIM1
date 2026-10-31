import { useCallback } from 'react';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { getReceivableIntegrity } from '../api/finance-api';
import { FinanceSituationStrip } from './FinanceSituation';

/**
 * Superfície operacional do Incremento 03.
 *
 * Esta faixa é deliberadamente visível na Central Financeira, mas não inventa
 * uma leitura quando o operador não possui `platform:diagnostics:read`: acesso
 * negado é comunicado como tal, e não convertido em "0 falhas".
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
        Integridade Billing → Recebíveis: acesso de diagnóstico não autorizado para este perfil.
      </p>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--color-divider)] py-2" role="alert">
        <span className="text-xs text-red-700">{state.message}</span>
        {state.retryable ? <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => void reload()}>Tentar novamente</button> : null}
      </div>
    );
  }

  const backlog = state.phase === 'ready' ? state.data.technical.backlog : null;
  const critical = (backlog?.receivableHandoffDead ?? 0) > 0 || (backlog?.billingReceivableOrphans ?? 0) > 0;

  return (
    <section aria-label="Integridade do faturamento e recebíveis" className="pt-2">
      <FinanceSituationStrip
        items={[
          {
            id: 'receivable-handoff-dead',
            label: 'Handoffs financeiros falhos',
            value: backlog ? String(backlog.receivableHandoffDead) : null,
            note: 'jobs DEAD/FAILED',
            tone: (backlog?.receivableHandoffDead ?? 0) > 0 ? 'critical' : 'success',
          },
          {
            id: 'billing-receivable-orphans',
            label: 'Faturas sem recebível',
            value: backlog ? String(backlog.billingReceivableOrphans) : null,
            note: 'FINALIZED há mais de 5 min',
            tone: (backlog?.billingReceivableOrphans ?? 0) > 0 ? 'critical' : 'success',
          },
          {
            id: 'receivable-handoff-pending',
            label: 'Handoffs em processamento',
            value: backlog ? String(backlog.receivableHandoffPending) : null,
            note: critical ? 'investigar antes de novo faturamento' : refreshing ? 'atualizando' : 'monitoramento PostgreSQL',
            tone: critical ? 'warning' : 'info',
          },
        ]}
      />
    </section>
  );
}
