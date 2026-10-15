import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { WorkbenchKpiStrip } from './WorkbenchKpiStrip';
import { buildWorkbenchKpis } from '../utils/build-workbench-kpis';
import { buildBusinessFlow } from '../utils/dashboard-semantics';
import { EXECUTIVE_DASHBOARD_SNAPSHOT } from '../../test/dashboard-fetch-mock';
import type { ExecutiveDashboardSnapshot } from '../types/dashboard.types';

/** Indicadores sem dado ficam em uma linha compacta e não reservam células vazias. */

function renderStrip(snapshot: ExecutiveDashboardSnapshot, domain: string | null) {
  return render(
    <MemoryRouter>
      <WorkbenchKpiStrip kpis={buildWorkbenchKpis(snapshot, domain)} />
    </MemoryRouter>,
  );
}

function withoutAttention(id: string): ExecutiveDashboardSnapshot {
  return {
    ...EXECUTIVE_DASHBOARD_SNAPSHOT,
    attention: EXECUTIVE_DASHBOARD_SNAPSHOT.attention.filter((item) => item.id !== id),
  };
}

describe('faixa de KPIs — estrutura estavel, valor honesto', () => {
  it('keeps the same KPI cells in every recorte', () => {
    const all = buildWorkbenchKpis(EXECUTIVE_DASHBOARD_SNAPSHOT, null).map((kpi) => kpi.id);
    const operational = buildWorkbenchKpis(EXECUTIVE_DASHBOARD_SNAPSHOT, 'OPERACOES').map(
      (kpi) => kpi.id,
    );
    const fiscal = buildWorkbenchKpis(EXECUTIVE_DASHBOARD_SNAPSHOT, 'FISCAL').map((kpi) => kpi.id);

    expect(operational).toEqual(all);
    expect(fiscal).toEqual(all);
    expect(all.length).toBeGreaterThanOrEqual(5);
  });

  it('keeps an unpublished KPI available as a compact queue link', () => {
    const snapshot = withoutAttention('approaching-due-service-orders');
    renderStrip(snapshot, null);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Não publicado neste recorte');
    expect(within(status).getByRole('link', { name: 'Ordens vencendo' })).toHaveAttribute(
      'href',
      '/app/service-orders?filter=approaching-due',
    );
  });

  it('does not reserve a value cell for an unpublished KPI', () => {
    const snapshot = withoutAttention('approaching-due-service-orders');
    renderStrip(snapshot, null);

    const status = screen.getByRole('status');
    expect(status).not.toHaveTextContent('—');
    expect(status).not.toHaveTextContent(/\b0\b/);
    expect(screen.queryByRole('link', { name: /Ordens de serviço vencendo:/i })).not.toBeInTheDocument();
  });

  it('makes the unpublished state visible without an empty KPI card', () => {
    const snapshot = withoutAttention('approaching-due-service-orders');
    renderStrip(snapshot, null);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/não publicado neste recorte/i);
    expect(status.querySelector('.dashboard-kpi-cell')).toBeNull();
  });

  it('does not borrow figures when the active recorte has no published indicators', () => {
    renderStrip(EXECUTIVE_DASHBOARD_SNAPSHOT, 'FISCAL');

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Nenhum indicador publicado neste recorte');
    expect(within(status).getByRole('link', { name: 'Recebíveis vencidos' })).toBeInTheDocument();
    expect(within(status).getByRole('link', { name: 'Ordens vencidas' })).toBeInTheDocument();
    expect(within(status).getByRole('link', { name: 'Ordens em andamento' })).toBeInTheDocument();
    expect(status).not.toHaveTextContent(/\b[0-9]+\b/);
  });

  /* CELULA COM VALOR PUBLICADO CONTINUA AFIRMANDO O NUMERO REAL E O DESTINO. */
  it('still affirms the real number when the server published it', () => {
    renderStrip(EXECUTIVE_DASHBOARD_SNAPSHOT, null);

    const overdue = screen.getByLabelText(/Ordens de serviço vencidas: 3 ordens/i);
    expect(overdue).toHaveAttribute('href', '/app/service-orders?filter=overdue');
    expect(overdue).toHaveTextContent('3');
    expect(overdue).not.toHaveTextContent('—');
  });
});

describe('trilha de processo — o processo inteiro, sempre', () => {
  const PROCESS = [
    'request',
    'proposal',
    'contract',
    'operation',
    'measurement',
    'billing',
    'receivement',
  ];

  /*
   * A TRILHA NAO ENCOLHE. As sete etapas reais do CISNE aparecem em qualquer recorte, porque o
   * fluxo descreve PROCESSO — e o processo nao depende de qual chip esta ativo.
   */
  it('publishes all real stages in every recorte', () => {
    for (const domain of [null, 'OPERACOES', 'FINANCEIRO', 'COMERCIAL', 'FISCAL', 'SUPRIMENTOS']) {
      expect(buildBusinessFlow(EXECUTIVE_DASHBOARD_SNAPSHOT, domain).map((stage) => stage.id)).toEqual(
        PROCESS,
      );
    }
  });

  /* ETAPA SEM CONTADOR CONTINUA NA TRILHA e nunca afirma zero. */
  it('keeps stages without a published count and never asserts zero', () => {
    const stages = buildBusinessFlow(EXECUTIVE_DASHBOARD_SNAPSHOT, null);

    const unmeasured = stages.filter((stage) => stage.count === null);
    expect(unmeasured.length).toBeGreaterThan(0);
    for (const stage of unmeasured) {
      expect(stage.unmeasured).toBe(true);
      expect(stage.count).toBeNull();
      expect(stage.situationLabel).not.toMatch(/^0\b/);
    }
  });
});
