import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertCenterPage } from './pages/AlertCenterPage';

const ITEM = {
  id: 'alert-1',
  alertType: 'SERVICE_ORDER_OVERDUE',
  severity: 'CRITICAL',
  status: 'ACTIVE',
  title: 'OS vencida',
  message: 'Ordem de serviço vencida há 2 dia(s).',
  entityHref: '/app/service-orders/so-1?filter=overdue',
  unitId: 'unit-a',
  triggeredAt: '2026-08-29T12:00:00.000Z',
  resolvedAt: null,
  lastSeenAt: '2026-08-29T12:00:00.000Z',
} as const;

let mockItems: unknown[] = [ITEM];

vi.mock('./hooks/useAlerts', () => ({
  useAlertsCenter: () => ({
    state: { phase: 'ready', items: mockItems },
    reload: vi.fn(),
    filters: { status: 'ACTIVE' as const },
    setFilters: vi.fn(),
  }),
  useAlertBadge: () => ({ activeCount: 1, loading: false }),
}));

describe('AlertCenterPage', () => {
  beforeEach(() => {
    mockItems = [ITEM];
  });

  it('renders the alert queue ordered by persisted severity, with reason, status and drilldown', () => {
    render(
      <MemoryRouter>
        <AlertCenterPage />
      </MemoryRouter>,
    );

    // A identidade da pagina continua, mas a superficie agora e uma FILA, nao um formulario.
    expect(screen.getByRole('heading', { name: /central de alertas/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Fila de alertas' })).toBeInTheDocument();

    // Resumo com o numero REAL do recorte (o servidor devolveu um alerta critico).
    const summary = screen.getByRole('region', { name: 'Resumo da fila' });
    expect(within(summary).getByText(/críticos/i).closest('div')).toHaveTextContent('1');

    // Anatomia do item: severidade -> motivo (titulo) -> motivo persistido -> situacao -> data -> acao.
    const item = screen.getByText('Ordem de serviço vencida há 2 dia(s).').closest('article');
    expect(item).not.toBeNull();
    expect(within(item as HTMLElement).getByText('OS vencida')).toBeInTheDocument();
    expect(within(item as HTMLElement).getByText('Crítico')).toBeInTheDocument();
    expect(within(item as HTMLElement).getByText('Ativo')).toBeInTheDocument();
    expect(within(item as HTMLElement).getByText(/Disparado em/)).toBeInTheDocument();
    expect(within(item as HTMLElement).getByText('Ordem de serviço vencida')).toBeInTheDocument();
    expect(
      within(item as HTMLElement).getByText(/abrir a os e decidir execução ou reprogramação/i),
    ).toBeInTheDocument();

    expect(
      within(item as HTMLElement).getByRole('link', { name: /abrir entidade relacionada/i }),
    ).toHaveAttribute('href', '/app/service-orders/so-1?filter=overdue');

    expect(screen.getByLabelText(/^status$/i).tagName).toBe('SELECT');
  });

  it('declara fila vazia com o estado compacto, sem inventar contagem', () => {
    mockItems = [];
    render(
      <MemoryRouter>
        <AlertCenterPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/nenhum alerta ativo persistido/i)).toBeInTheDocument();
    // Sem dado, nenhuma faixa de resumo e exibida: nenhum numero e inventado.
    expect(screen.queryByRole('region', { name: 'Resumo da fila' })).not.toBeInTheDocument();
  });
});
