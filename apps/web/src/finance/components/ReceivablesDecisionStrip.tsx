import { Alert, Money, type AlertTone } from '../../ui';
import type { ReceivableDetail } from '../types/finance.types';

/**
 * Situação → Atenção → Próxima ação para contas a receber (dados já servidos).
 * Deriva tudo de status e saldo restante informados pelo servidor; não recalcula.
 */
export function ReceivablesDecisionStrip({ items }: { items: ReceivableDetail[] }) {
  const inFlight = items.filter((item) => !['PAID', 'CANCELLED'].includes(item.status));
  const overdue = inFlight.filter((item) => item.status === 'OVERDUE');
  const atRisk = inFlight.filter((item) => item.status === 'OPEN' || item.status === 'PARTIALLY_PAID');

  const overdueTotal = overdue.reduce((sum, item) => sum + Number(item.remainingBalance), 0);
  const atRiskTotal = atRisk.reduce((sum, item) => sum + Number(item.remainingBalance), 0);
  const overdueTotalString = overdueTotal.toFixed(2);

  let tone: AlertTone;
  let title: string;
  let action: string;
  if (overdue.length > 0) {
    tone = 'error';
    title = 'Atenção: recebimentos vencidos';
    action = 'Cobrar os vencidos antes de liberar novas faturas.';
  } else if (atRisk.length > 0) {
    tone = 'warning';
    title = 'Títulos a vencer';
    action = 'Acompanhar os vencimentos próximos para honrar o fluxo de caixa.';
  } else {
    tone = 'success';
    title = 'Carteira de recebíveis em dia';
    action = 'Nenhum título vencido. Acompanhe os vencimentos a seguir.';
  }

  return (
    <Alert tone={tone} title={title} className="mb-4">
      <p className="mb-2">
        <strong>Situação:</strong>{' '}
        {overdue.length > 0
          ? `${overdue.length} vencido(s) somando ${moneyText(overdueTotal)}.`
          : atRisk.length > 0
            ? `${atRisk.length} a vencer somando ${moneyText(atRiskTotal)}.`
            : 'Sem títulos vencidos ou a vencer para o seu acesso.'}
      </p>
      {overdue.length > 0 ? (
        <p className="mb-2">
          <strong>Exposição vencida:</strong> <Money value={overdueTotalString} emphasis />
        </p>
      ) : null}
      <p>
        <strong>Próxima ação:</strong> {action}
      </p>
    </Alert>
  );
}

function moneyText(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}
