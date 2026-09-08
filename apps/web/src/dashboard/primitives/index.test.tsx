import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { DashboardKpi } from '../utils/build-dashboard-kpis';
import { AccessibleDataTable, ChartStateNotice, Kpi, chartCardClassName } from './index';

function sampleKpi(overrides: Partial<DashboardKpi> = {}): DashboardKpi {
  return {
    id: 'kpi-test',
    label: 'OS ativas',
    value: '3',
    unit: 'ordens',
    context: 'Período',
    href: null,
    ariaLabel: 'OS ativas: 3 ordens',
    variant: 'primary',
    ...overrides,
  };
}

describe('VISUALIZATION PRIMITIVES', () => {
  it('estados: loading, error (alert), denied, noData, empty, partial — nenhum vira zero falso', () => {
    const { rerender } = render(<ChartStateNotice status="loading" />);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando dados…');

    rerender(<ChartStateNotice status="error" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar os dados.');

    rerender(<ChartStateNotice status="error" errorMessage="Fonte indisponível." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Fonte indisponível.');

    rerender(<ChartStateNotice status="denied" />);
    const denied = screen.getByRole('status');
    expect(denied).toHaveTextContent('Sem acesso a estes dados.');
    expect(within(denied).queryByText('0')).not.toBeInTheDocument();

    rerender(<ChartStateNotice status="noData" />);
    expect(screen.getByRole('status')).toHaveTextContent('Sem dados para exibir.');
    expect(screen.queryByText('0')).not.toBeInTheDocument();

    rerender(<ChartStateNotice status="empty" />);
    expect(screen.getByRole('status')).toHaveTextContent('Sem dados no período.');

    rerender(<ChartStateNotice status="partial" />);
    expect(screen.getByRole('status')).toHaveTextContent(/Dados parciais/);
  });

  it('NO_DATA != 0: disponibilidade negada nao aparece como zero e texto nunca contem valor numerico fabricado', () => {
    render(<ChartStateNotice status="noData" />);
    const notice = screen.getByRole('status');
    expect(notice.textContent).not.toMatch(/\d/);
  });

  it('Kpi presentacional: valor vem resolvido; link e article com aria-label', () => {
    render(
      <MemoryRouter>
        <Kpi kpi={sampleKpi()} highlighted={false} />
        <Kpi kpi={sampleKpi({ href: '/app/service-orders', ariaLabel: 'OS ativas: link' })} highlighted />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('OS ativas: 3 ordens')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'OS ativas: link' });
    expect(link).toHaveAttribute('href', '/app/service-orders');
    expect(within(screen.getByLabelText('OS ativas: 3 ordens')).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByLabelText('OS ativas: 3 ordens')).getByText('ordens')).toBeInTheDocument();
  });

  it('AccessibleDataTable: caption, colunas e celulas com os mesmos dados', () => {
    render(
      <AccessibleDataTable
        caption="Dados de Teste"
        columns={[
          { key: 'label', header: 'Categoria' },
          { key: 'value', header: 'Quantidade' },
        ]}
        rows={[
          { key: 'a', label: 'Concluída', value: 2 },
          { key: 'b', label: 'Vencida', value: 1 },
        ]}
        rowKey={(row) => row.key}
        cell={(row, key) => (key === 'label' ? row.label : row.value)}
      />,
    );
    const table = screen.getByRole('table');
    expect(within(table).getByText('Dados de Teste')).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Categoria' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Quantidade' })).toBeInTheDocument();
    expect(within(table).getByText('Concluída')).toBeInTheDocument();
    expect(within(table).getByText('Vencida')).toBeInTheDocument();
    expect(within(table).getByText('2')).toBeInTheDocument();
    expect(within(table).getByText('1')).toBeInTheDocument();
  });

  it('chartCardClassName e a classe canonica estavel do card de grafico', () => {
    expect(chartCardClassName).toContain('rounded-xl');
    expect(chartCardClassName).toContain('shadow-sm');
  });
});
