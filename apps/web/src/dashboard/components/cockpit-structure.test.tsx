import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { WorkbenchKpiStrip } from './WorkbenchKpiStrip';
import { buildWorkbenchKpis } from '../utils/build-workbench-kpis';
import { buildBusinessFlow } from '../utils/dashboard-semantics';
import { EXECUTIVE_DASHBOARD_SNAPSHOT } from '../../test/dashboard-fetch-mock';
import type { ExecutiveDashboardSnapshot } from '../types/dashboard.types';

/**
 * ESTRUTURA ESTAVEL DO COCKPIT — contrato explicito.
 *
 * A regra que este arquivo trava, e que substituiu deliberadamente a anterior:
 *
 *   ANTES  metrica nao publicada no recorte -> a celula NAO EXISTIA (a faixa encolhia);
 *   AGORA  metrica nao publicada no recorte -> a celula EXISTE, com `—` e estado declarado.
 *
 * AUSENCIA != ZERO continua valendo — mas ausencia tambem nao desmonta o workspace. O que estes
 * testes provam e o par: (a) nenhum numero inventado, (b) estrutura preservada.
 */

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
  /*
   * O CONTRATO DA FAIXA E FIXO. A ordem e a identidade das celulas nao mudam com o recorte — o que
   * muda e o ESTADO de cada uma. Sem isso, o operador que troca de dominio ve uma faixa com outro
   * numero de celulas e nao reconhece mais o proprio painel.
   */
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

  /*
   * KPI CONHECIDO SEM PUBLICACAO CONTINUA RENDERIZADO — o caso central desta wave.
   *
   * `approaching-due-service-orders` nao vem no snapshot. A celula permanece, e o que ela afirma e
   * exatamente "não publicado neste recorte".
   */
  it('renders a known KPI without publication instead of dropping the cell', () => {
    const snapshot = withoutAttention('approaching-due-service-orders');
    renderStrip(snapshot, null);

    const cell = screen.getByLabelText(/Ordens de serviço vencendo: não publicado neste recorte/i);
    expect(cell).toBeInTheDocument();
    expect(cell).toHaveTextContent('Ordens vencendo');
  });

  /* VALOR AUSENTE E `—`, NUNCA `0`. */
  it('shows an em dash — never zero — for an unpublished value', () => {
    const snapshot = withoutAttention('approaching-due-service-orders');
    renderStrip(snapshot, null);

    const cell = screen.getByLabelText(/Ordens de serviço vencendo: não publicado neste recorte/i);
    expect(cell).toHaveTextContent('—');
    expect(cell).not.toHaveTextContent(/\b0\b/);
  });

  /* O ESTADO "NAO PUBLICADO" E VISIVEL NA TELA, nao apenas no `aria-label`. */
  it('makes the unpublished state visible in the cell, not only in the accessible name', () => {
    const snapshot = withoutAttention('approaching-due-service-orders');
    renderStrip(snapshot, null);

    const cell = screen.getByLabelText(/Ordens de serviço vencendo: não publicado neste recorte/i);
    expect(within(cell).getByText(/não publicado neste recorte/i)).toBeInTheDocument();
  });

  /* FORA DO RECORTE tambem e um estado declarado — nao um numero emprestado de outro dominio. */
  it('declares out-of-scope metrics without borrowing a number from another domain', () => {
    renderStrip(EXECUTIVE_DASHBOARD_SNAPSHOT, 'FISCAL');

    const cells = screen.getAllByRole('link');
    expect(cells.length).toBeGreaterThanOrEqual(5);
    for (const cell of cells) {
      expect(cell).toHaveTextContent('—');
      expect(within(cell).getByText(/fora do recorte ativo/i)).toBeInTheDocument();
    }
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
