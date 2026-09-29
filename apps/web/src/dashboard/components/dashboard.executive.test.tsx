import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AttentionBlock } from './AttentionBlock';
import { DashboardBarChart } from './charts/DashboardBarChart';
import { DashboardAgingChart } from './charts/DashboardAgingChart';
import { ProductivityPanel } from './ProductivityPanel';

describe('AttentionBlock', () => {
  it('renders one compact decision row per exception with severity, reason, delay and action', () => {
    render(
      <MemoryRouter>
        <AttentionBlock
          items={[
            {
              id: 'overdue-service-orders',
              label: 'OS vencidas',
              count: 3,
              severity: 'critical',
              href: '/app/service-orders?filter=overdue',
              ariaLabel: 'OS vencidas: 3 itens. Maior atraso 8 dias.',
              maxDelayDays: 8,
              detail: 'Maior atraso: 8 dia(s)',
            },
          ]}
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: /OS vencidas: 3 itens/i });
    expect(link).toHaveAttribute('href', '/app/service-orders?filter=overdue');
    // Severidade e motivo em TEXTO (nunca apenas cor), prazo real e a proxima acao.
    expect(screen.getByText('Crítico')).toBeInTheDocument();
    expect(screen.getByText('Maior atraso: 8 dia(s)')).toBeInTheDocument();
    expect(screen.getByText('8 d')).toBeInTheDocument();
    expect(screen.getByText(/Ver OS vencidas/)).toBeInTheDocument();
  });

  it('renders an exception without a real filtered list as a row that declares the gap', () => {
    render(
      <MemoryRouter>
        <AttentionBlock
          items={[
            {
              id: 'divergences',
              label: 'Divergências comerciais',
              count: 2,
              severity: 'critical',
              href: null,
              ariaLabel: 'Divergências comerciais: 2 itens',
              maxDelayDays: null,
              detail: 'Medições rejeitadas ou faturamento anulado',
            },
          ]}
        />
      </MemoryRouter>,
    );

    // A excecao NAO desaparece e NAO ganha link generico de modulo.
    expect(screen.getByLabelText('Divergências comerciais: 2 itens')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(/sem lista filtrada para este recorte/i)).toBeInTheDocument();
  });

  it('shows a single compact line when there are zero attention items', () => {
    const { container } = render(
      <MemoryRouter>
        <AttentionBlock items={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/nenhuma pendência crítica/i)).toBeInTheDocument();
    // Estado vazio e UMA linha de status: sem banner verde gigante.
    expect(container.querySelectorAll('.dashboard-decision__list')).toHaveLength(0);
  });
});

describe('DashboardBarChart', () => {
  it('exposes textual summary and keyboard-focusable bars', () => {
    render(
      <DashboardBarChart
        chartId="status-chart"
        title="OS por status"
        description="Distribuição por status"
        summary="2 ordens ativas"
        items={[
          { key: 'IN_EXECUTION', label: 'Em execução', value: 2 },
          { key: 'RELEASED', label: 'Liberada', value: 1 },
        ]}
      />,
    );

    expect(screen.getByText('2 ordens ativas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Em execução: 2/i })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Em execução' })).toBeInTheDocument();
  });
});

describe('ProductivityPanel', () => {
  it('renders a dense strip of productivity metrics without composite score or false drill', () => {
    render(
      <MemoryRouter>
        <ProductivityPanel
          productivity={{
            completed: 10,
            onTimeRate: { value: 0.8, numerator: 8, denominator: 10, available: true },
            averageCycleTime: { valueHours: 24, sampleSize: 10, available: true },
            reworkRate: {
              value: 0.1,
              numerator: 1,
              denominator: 10,
              available: true,
              concept: 'measurement_rejection_rate',
            },
            utilization: {
              value: 0.5,
              numerator: 5,
              denominator: 10,
              available: true,
              concept: 'allocated_window_over_planned_window',
            },
            evidenceCompleteness: { value: 0.9, numerator: 9, denominator: 10, available: true },
            measurementAcceptance: { value: 0.85, numerator: 17, denominator: 20, available: true },
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('80,00%')).toBeInTheDocument();
    expect(screen.getByText('1.0 d')).toBeInTheDocument();
    expect(screen.getByText('10,00%')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /produtividade/i })).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    // Nenhuma metrica desta faixa promete lista filtrada: os recortes de taxa,
    // cycle time e janela nao existem na lista de OS. Zero link = zero promessa.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('DashboardAgingChart', () => {
  it('renders aging buckets with count and amount', async () => {
    const user = userEvent.setup();
    render(
      <DashboardAgingChart
        chartId="aging-chart"
        title="Aging financeiro"
        description="Recebíveis vencidos"
        summary="3 recebíveis vencidos"
        buckets={[
          { bandId: '0-7', label: '0–7 dias', count: 2, totalAmount: '1000.00' },
          { bandId: '8-15', label: '8–15 dias', count: 1, totalAmount: '500.00' },
        ]}
      />,
    );

    const bar = screen.getByRole('button', { name: /0–7 dias: 2 documentos/i });
    await user.click(bar);
    expect(screen.getByRole('status')).toHaveTextContent('R$');
  });
});
