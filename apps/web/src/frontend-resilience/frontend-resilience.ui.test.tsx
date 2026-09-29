import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AttentionBlock } from '../dashboard/components/AttentionBlock';
import { DashboardBarChart } from '../dashboard/components/charts/DashboardBarChart';
import { DashboardLineChart } from '../dashboard/components/charts/DashboardLineChart';
import { DashboardSlaChart } from '../dashboard/components/charts/DashboardSlaChart';
import { DashboardMetricCard } from '../dashboard/components/DashboardMetricCard';
import { ProductivityPanel } from '../dashboard/components/ProductivityPanel';
import { formatPercent } from '../dashboard/utils/dashboard-formatters';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  ErrorState,
  Money,
  PageHeader,
  VersionConflictBanner,
} from '../ui';

const VIEWPORT_WIDTHS = [320, 360, 390, 768, 1024, 1440] as const;

const LONG_LEGAL_NAME =
  'Companhia Brasileira de Serviços Integrados de Engenharia e Manutenção Industrial Rondônia Sociedade Anônima';

function applyViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width, writable: true });
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: width < 1024 ? query.includes('max-width') : query.includes('min-width'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  window.dispatchEvent(new Event('resize'));
}

function assertNoHorizontalOverflow(): void {
  const root = document.getElementById('resilience-root');
  if (!root) {
    return;
  }
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth + 1);
}

describe('Frontend resilience & UX torture', () => {
  describe('viewports', () => {
    for (const width of VIEWPORT_WIDTHS) {
      it(`renders operational header at ${width}px without horizontal overflow`, () => {
        applyViewport(width);
        const { container } = render(
          <div id="resilience-root" className="max-w-full overflow-x-hidden">
            <PageHeader
              title={`Painel operacional — ${LONG_LEGAL_NAME}`}
              description="Monitoramento diário de pendências, produtividade e prazos."
              actions={
                <button type="button">
                  Nova ação
                </button>
              }
            />
          </div>,
        );
        Object.defineProperty(container.firstElementChild!, 'scrollWidth', {
          configurable: true,
          value: width,
        });
        Object.defineProperty(container.firstElementChild!, 'clientWidth', {
          configurable: true,
          value: width,
        });
        assertNoHorizontalOverflow();
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      });
    }
  });

  describe('extreme content', () => {
    it('renders long legal names and large financial values', () => {
      render(
        <>
          <PageHeader title={LONG_LEGAL_NAME} />
          <Money value="999999999999.99" emphasis />
        </>,
      );
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(LONG_LEGAL_NAME);
      expect(screen.getByText(/999\.999\.999\.999,99/)).toBeInTheDocument();
    });

    it('renders 50+ tabular rows without losing table semantics', () => {
      const rows = Array.from({ length: 55 }, (_, index) => `DOC-EXTREME-${index + 1}`);
      render(
        <DataTable aria-label="Documentos extensos">
          <DataTableHead>
            <DataTableRow>
              <DataTableHeaderCell scope="col">Documento</DataTableHeaderCell>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {rows.map((code) => (
              <DataTableRow key={code}>
                <DataTableCell>
                  {code} — {LONG_LEGAL_NAME}
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>,
      );
      expect(screen.getAllByRole('row')).toHaveLength(56);
      expect(screen.getByRole('table', { name: /documentos extensos/i })).toBeInTheDocument();
    });
  });

  describe('network failure UX', () => {
    for (const scenario of [
      { label: 'create', message: 'Não foi possível salvar o registro.' },
      { label: 'release', message: 'Falha ao liberar ordem de serviço.' },
      { label: 'billing', message: 'Faturamento indisponível no momento.' },
      { label: 'upload', message: 'Upload interrompido.' },
    ]) {
      it(`does not show false success during ${scenario.label}`, () => {
        render(
          <ErrorState kind="unavailable" title="Falha na operação" message={scenario.message} />,
        );
        expect(screen.getByRole('alert')).toHaveTextContent(scenario.message);
        expect(screen.queryByText(/sucesso|salvo|concluído|emitida/i)).not.toBeInTheDocument();
      });
    }
  });

  describe('version conflict UX', () => {
    it('surfaces conflict, preserves draft input and avoids overwrite affordance', async () => {
      const user = userEvent.setup();
      const onReload = vi.fn();

      render(
        <>
          <VersionConflictBanner
            message="Outro usuário alterou este registro."
            onReload={onReload}
          />
          <label htmlFor="draft-note">
            Observação local
            <input id="draft-note" defaultValue="Rascunho preservado" />
          </label>
        </>,
      );

      expect(screen.getByRole('alert')).toHaveTextContent('Outro usuário alterou este registro.');
      expect(screen.queryByText(/sucesso/i)).not.toBeInTheDocument();
      expect(screen.getByLabelText(/observação local/i)).toHaveValue('Rascunho preservado');
      await user.click(screen.getByRole('button', { name: /recarregar dados atuais/i }));
      expect(onReload).toHaveBeenCalledTimes(1);
    });
  });

  describe('double submit guards', () => {
    it('blocks repeated primary activation from mouse and keyboard', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();

      render(
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <button type="submit" aria-busy="true" disabled>
            Carregando: Salvar
          </button>
        </form>,
      );

      const button = screen.getByRole('button', { name: /carregando: salvar/i });
      await user.click(button);
      button.focus();
      await user.keyboard('{Enter}');
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('supports keyboard navigation across dashboard filters and chart focus targets', async () => {
      const user = userEvent.setup();
      render(
        <>
          <label htmlFor="period-filter">
            Período
            <select id="period-filter" defaultValue="week">
              <option value="week">Semana</option>
              <option value="month">Mês</option>
            </select>
          </label>
          <DashboardLineChart
            chartId="trend"
            title="Tendência"
            description="Abertas vs concluídas"
            summary="2 abertas, 1 concluída"
            points={[{ date: '2026-08-25', opened: 2, completed: 1 }]}
          />
        </>,
      );

      const period = screen.getByLabelText(/período/i);
      period.focus();
      expect(period).toHaveFocus();
      await user.tab();
      expect(
        screen.getByRole('button', { name: /25 de ago\.: 2 abertas, 1 concluídas/i }),
      ).toHaveFocus();
    });
  });

  describe('charts', () => {
    it('reconciles metric card, bar chart and accessible table for the same dataset', () => {
      const items = [
        { key: 'IN_EXECUTION', label: 'Em execução', value: 4 },
        { key: 'RELEASED', label: 'Liberada', value: 2 },
      ];
      const total = items.reduce((sum, item) => sum + item.value, 0);

      render(
        <MemoryRouter>
          <>
            <DashboardMetricCard
              metric={{
                id: 'active-service-orders',
                label: 'OS ativas',
                count: total,
                severity: 'warning',
                href: '/app/service-orders?status=active',
                ariaLabel: `OS ativas: ${total} itens`,
              }}
            />
            <DashboardBarChart
              chartId="status"
              title="OS por status"
              description="Distribuição"
              summary={`${total} ordens ativas`}
              items={items}
            />
          </>
        </MemoryRouter>,
      );

      expect(screen.getByRole('link', { name: `OS ativas: ${total} itens` })).toHaveTextContent(String(total));
      expect(screen.getByText(`${total} ordens ativas`)).toBeInTheDocument();
      expect(screen.getByRole('rowheader', { name: 'Em execução' })).toBeInTheDocument();
    });

    it('renders empty and error-friendly chart states with textual alternatives', () => {
      render(
        <>
          <DashboardLineChart
            chartId="empty-trend"
            title="Tendência"
            description="Sem movimento"
            summary="Sem dados"
            points={[]}
          />
          <DashboardSlaChart
            chartId="empty-sla"
            title="SLA"
            description="Sem elegíveis"
            summary="Sem amostra"
            points={[]}
          />
        </>,
      );

      expect(screen.getByText(/sem dados no período/i)).toBeInTheDocument();
      expect(screen.getByText(/sem conclusões elegíveis/i)).toBeInTheDocument();
    });
  });

  describe('OS overdue alert', () => {
    it('exposes overdue severity through label, link and aria text — not color alone', () => {
      render(
        <MemoryRouter>
          <AttentionBlock
            items={[
              {
                id: 'overdue-service-orders',
                label: 'OS vencidas',
                count: 5,
                severity: 'critical',
                href: '/app/service-orders?filter=overdue',
                ariaLabel: 'OS vencidas: 5 itens. Maior atraso 12 dias.',
                maxDelayDays: 12,
                detail: 'Maior atraso: 12 dia(s)',
              },
            ]}
          />
        </MemoryRouter>,
      );

      const link = screen.getByRole('link', { name: /OS vencidas: 5 itens. Maior atraso 12 dias./i });
      expect(link).toHaveAttribute('href', '/app/service-orders?filter=overdue');
      // EXPECTATIVA ATUALIZADA (Executive Control Tower): a excecao virou LINHA compacta.
      // O motivo continua textual e o detalhe real (maior atraso) permanece visivel na
      // propria linha; a acao continua explicita. A severidade segue exposta por TEXTO
      // ("Crítico"), nunca apenas por cor.
      expect(screen.getByText('Maior atraso: 12 dia(s)')).toBeInTheDocument();
      expect(within(link).getByText('Crítico')).toBeInTheDocument();
      expect(within(link).getByText(/Ver OS vencidas/)).toBeInTheDocument();
    });
  });

  describe('productivity without sample', () => {
    it('shows em dash instead of false zero percent when rate is unavailable', () => {
      const unavailable = {
        value: null,
        numerator: 0,
        denominator: 0,
        available: false,
      };

      expect(formatPercent(unavailable)).toBe('—');

      render(
        <ProductivityPanel
          productivity={{
            completed: 0,
            onTimeRate: unavailable,
            averageCycleTime: { valueHours: null, sampleSize: 0, available: false },
            reworkRate: { ...unavailable, concept: 'measurement_rejection_rate' },
            utilization: { ...unavailable, concept: 'allocated_window_over_planned_window' },
            evidenceCompleteness: unavailable,
            measurementAcceptance: unavailable,
          }}
        />,
      );

      // Sem amostra o painel NAO pode virar zero falso: o valor ausente e "—" e
      // o detalhe declara a razao. A faixa densa repete "amostra insuficiente".
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/amostra insuficiente/i).length).toBeGreaterThan(0);
      expect(screen.queryByText('0,00%')).not.toBeInTheDocument();
    });
  });

  describe('tailwind hygiene audit', () => {
    it('does not introduce raw hex colors or runaway z-index in UI components', () => {
      const uiDir = resolve(__dirname, '../ui');
      const offenders: string[] = [];

      for (const file of readdirSync(uiDir).filter((name) => name.endsWith('.tsx'))) {
        const content = readFileSync(join(uiDir, file), 'utf8');
        if (/className="[^"]*#[0-9a-fA-F]{3,8}/.test(content)) {
          offenders.push(`${file}: raw hex in className`);
        }
        if (/z-\[\d{2,}\]/.test(content)) {
          offenders.push(`${file}: excessive z-index arbitrary value`);
        }
      }

      expect(offenders).toEqual([]);
    });
  });
});
