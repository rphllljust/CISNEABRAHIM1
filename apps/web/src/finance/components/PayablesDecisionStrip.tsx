import { Alert, Money, type AlertTone } from '../../ui';
import type { PayableDetail } from '../types/finance.types';

/**
 * Situação → Atenção → Próxima ação (hierarquia visível sobre dados já servidos).
 *
 * Deriva tudo do que o servidor já devolve por título (status, vencimento,
 * aging e saldo restante). Nenhum saldo é recalculado no navegador: as faixas
 * apenas somam e contam os valores informados pela listagem.
 */
export function PayablesDecisionStrip({ items }: { items: PayableDetail[] }) {
  const inFlight = items.filter((item) => !['PAID', 'CANCELLED'].includes(item.status));
  const overdue = inFlight.filter((item) => item.agingBucket !== 'CURRENT' && item.agingBucket !== 'SETTLED');
  const atRisk = inFlight.filter((item) => item.agingBucket === 'CURRENT');

  const overdueTotal = overdue.reduce((sum, item) => sum + Number(item.remainingBalance), 0);
  const atRiskTotal = atRisk.reduce((sum, item) => sum + Number(item.remainingBalance), 0);
  const overdueTotalString = overdueTotal.toFixed(2);

  let tone: AlertTone;
  let title: string;
  let action: string;
  if (overdue.length > 0) {
    tone = 'error';
    title = 'Atenção: títulos vencidos';
    action = 'Resolver os vencidos antes de iniciar novos pagamentos.';
  } else if (atRisk.length > 0) {
    tone = 'warning';
    title = 'Títulos a vencer no período corrente';
    action = 'Programar o caixa para honrar os vencimentos mais próximos.';
  } else {
    tone = 'success';
    title = 'Carteira em dia';
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
            : 'Aging sem faixas vencidas para o seu acesso.'}
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
