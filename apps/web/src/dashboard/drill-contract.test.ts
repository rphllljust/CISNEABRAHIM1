import { describe, expect, it } from 'vitest';
import { frontendDrillHrefForMetric } from './drill-contract';

describe('FILTER + DRILL CONTRACT (frontend, espelho FDC-001)', () => {
  it('drill de OS usa rota canonica com filtro derivado (paridade com builder de listagem e FDC-001)', () => {
    expect(frontendDrillHrefForMetric('service_orders.overdue_count')).toBe('/app/service-orders?filter=overdue');
    expect(frontendDrillHrefForMetric('service_orders.approaching_due_count')).toBe(
      '/app/service-orders?filter=approaching-due',
    );
  });

  it('recebiveis vencidos: destino e a CARTEIRA com o recorte que ela interpreta (SPA de faturamento nao filtra)', () => {
    expect(frontendDrillHrefForMetric('receivables.overdue_count')).toBe(
      '/app/finance/receivables?status=OVERDUE',
    );
  });

  it('metrica sem drill ou inexistente => null (front nao inventa destino)', () => {
    expect(frontendDrillHrefForMetric('receivables.overdue_amount')).toBeNull();
    expect(frontendDrillHrefForMetric('nao.existe')).toBeNull();
  });
});
