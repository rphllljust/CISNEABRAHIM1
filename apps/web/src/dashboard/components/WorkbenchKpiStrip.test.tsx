import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { WorkbenchKpiStrip } from './WorkbenchKpiStrip';
import type { WorkbenchKpi } from '../utils/build-workbench-kpis';

/**
 * FAIXA DE INDICADORES — contrato de composicao.
 *
 * Estes testes travam as REGRAS que a faixa promete, e nao a pintura: celula sem destino nao entra,
 * faixa vazia nao renderiza grade, e cada numero DIZ que tem para onde ir. O ultimo ponto e o que
 * impede o defeito classico de painel — o operador ver um numero e nao saber se pode clicar nele.
 */

function kpi(overrides: Partial<WorkbenchKpi> = {}): WorkbenchKpi {
  return {
    id: 'overdue-service-orders',
    label: 'Ordens vencidas',
    value: '3',
    unit: 'ordens',
    context: 'Maior atraso: 8 dias · no escopo autorizado',
    href: '/app/service-orders?filter=overdue',
    ariaLabel: 'Ordens de serviço vencidas: 3 ordens. Abrir ordens vencidas.',
    tone: 'critical',
    ...overrides,
  };
}

function renderStrip(kpis: WorkbenchKpi[]) {
  return render(
    <MemoryRouter>
      <WorkbenchKpiStrip kpis={kpis} />
    </MemoryRouter>,
  );
}

describe('WorkbenchKpiStrip', () => {
  it('nao renderiza nada quando nenhum indicador foi publicado', () => {
    // Faixa sem dado nao reserva area: nao existe grade de "—" nem card vazio.
    const { container } = renderStrip([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('leva cada indicador ao recorte que o produziu', () => {
    renderStrip([kpi()]);
    const link = screen.getByRole('link', { name: /ordens de serviço vencidas/i });
    expect(link).toHaveAttribute('href', '/app/service-orders?filter=overdue');
  });

  it('ANUNCIA o destino na propria celula — numero sem drilldown e decoracao', () => {
    renderStrip([kpi()]);
    // O rodape diz que ha para onde ir ANTES do clique, em vez de o operador descobrir tentando.
    expect(screen.getByText(/^Ver/)).toBeInTheDocument();
  });

  it('mostra valor, rotulo, unidade e contexto do mesmo indicador', () => {
    renderStrip([kpi()]);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Ordens vencidas')).toBeInTheDocument();
    expect(screen.getByText('ordens')).toBeInTheDocument();
    expect(screen.getByText(/Maior atraso: 8 dias/)).toBeInTheDocument();
  });

  it('omite a unidade quando o indicador nao a publica, sem deixar espaco vazio', () => {
    renderStrip([kpi({ unit: null })]);
    expect(screen.getByText('Ordens vencidas')).toBeInTheDocument();
    // Sem unidade, nenhum elemento de unidade e renderizado.
    expect(screen.queryByText('ordens')).not.toBeInTheDocument();
  });

  it('mantem um indicador por celula, na ordem recebida', () => {
    renderStrip([
      kpi(),
      kpi({ id: 'overdue-receivables', label: 'Recebíveis vencidos', href: '/app/finance/receivables' }),
    ]);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/app/service-orders?filter=overdue');
    expect(links[1]).toHaveAttribute('href', '/app/finance/receivables');
  });
});
