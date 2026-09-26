import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { renderServiceOrderRoutes } from '../../test/render-service-order-routes';
import {
  createServiceOrdersFetchMock,
  MOCK_SERVICE_ORDER_ID,
} from '../../test/service-orders-fetch-mock';

const measurementPath = `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/measurement`;

describe('ServiceOrderMeasurementPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('renders aligned comparison without divergence badges', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'draft-aligned',
      }),
    );
    renderServiceOrderRoutes(measurementPath);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /OS-2026-DEMO01/i })).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: /planejado · realizado · medido/i })).toBeInTheDocument();
    expect(screen.getAllByText(/conferido/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/quantidade divergente/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/R\$\s*1\.000,00/).length).toBeGreaterThan(0);
  });

  it('highlights quantity divergence semantically', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'draft-divergent',
      }),
    );
    renderServiceOrderRoutes(measurementPath);

    await waitFor(() => {
      expect(screen.getAllByText(/quantidade divergente/i).length).toBeGreaterThan(0);
    });
  });

  it('shows the measurement decision trail from the registered history', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'rejected',
      }),
    );
    renderServiceOrderRoutes(measurementPath);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /trilha da medição/i })).toBeInTheDocument();
    });

    expect(screen.getByText('Medição gerada')).toBeInTheDocument();
    expect(screen.getByText('Medição rejeitada')).toBeInTheDocument();
    expect(
      screen.getByText(/Motivo: Divergência de quantidade não justificada/i),
    ).toBeInTheDocument();
  });

  it('navigates forward to billing only after approval', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'draft-aligned',
      }),
    );
    renderServiceOrderRoutes(measurementPath);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Faturamento' })).toHaveAttribute(
        'href',
        `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/billing`,
      );
    });
    // Antes da aprovacao nao ha atalho de preparacao de faturamento.
    expect(screen.queryByRole('heading', { name: /preparação de faturamento/i })).not.toBeInTheDocument();
  });

  it('exposes the billing preparation step once the measurement is approved', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'approved',
      }),
    );
    renderServiceOrderRoutes(measurementPath);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /preparação de faturamento/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /abrir faturamento/i })).toHaveAttribute(
      'href',
      `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/billing`,
    );
  });

  it('submits a draft measurement', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'draft-aligned',
      }),
    );
    renderServiceOrderRoutes(measurementPath);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /submeter medição/i })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: /submeter medição/i }));

    await waitFor(() => {
      expect(screen.getByText(/medição submetida para análise/i)).toBeInTheDocument();
    });
    expect(document.querySelector('.measurement-status--submitted')).toHaveTextContent('Submetida');
  });

  it('requires acknowledgement before approving', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'under_review',
      }),
    );
    renderServiceOrderRoutes(measurementPath);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /aprovar medição/i })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: /aprovar medição/i }));

    const dialog = await screen.findByRole('dialog');
    const approveButton = within(dialog).getByRole('button', { name: /aprovar medição/i });
    expect(approveButton).toBeDisabled();

    await user.click(within(dialog).getByRole('checkbox'));
    expect(approveButton).toBeEnabled();

    await user.click(approveButton);

    await waitFor(() => {
      expect(screen.getByText(/medição aprovada/i)).toBeInTheDocument();
    });
    expect(document.querySelector('.measurement-status--approved')).toHaveTextContent('Aprovada');
  });

  it('rejects a measurement with reason', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'under_review',
      }),
    );
    renderServiceOrderRoutes(measurementPath);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /rejeitar/i })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: /rejeitar/i }));

    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/motivo da rejeição/i), 'Divergência não justificada.');
    await user.click(within(dialog).getByRole('button', { name: /confirmar rejeição/i }));

    await waitFor(() => {
      expect(screen.getByText(/medição rejeitada/i)).toBeInTheDocument();
    });
    expect(document.querySelector('.measurement-status--rejected')).toHaveTextContent('Rejeitada');
  });

  it('blocks critical actions and shows stale banner on version conflict', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'draft-aligned',
        measurementVersionConflict: true,
      }),
    );
    renderServiceOrderRoutes(measurementPath);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /submeter medição/i })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: /submeter medição/i }));

    await waitFor(() => {
      expect(screen.getByText(/medição desatualizada/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /submeter medição/i })).toBeDisabled();
    });
  });

  it('shows forbidden state when measurement access is denied', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        measurementAllowed: false,
      }),
    );
    renderServiceOrderRoutes(measurementPath);

    await waitFor(() => {
      expect(
        screen.getByText(/você não tem permissão para conferir medições/i),
      ).toBeInTheDocument();
    });
  });

  it('exposes desktop table and mobile cards for responsive comparison', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'draft-aligned',
      }),
    );
    const { container } = renderServiceOrderRoutes(measurementPath);

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    expect(container.querySelector('.measurement-compare--desktop')).toBeTruthy();
    expect(container.querySelector('.measurement-compare--mobile')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /planejado/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /medido/i })).toBeInTheDocument();
  });

  it('uses accessible landmarks and live regions', async () => {
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'draft-aligned',
      }),
    );
    renderServiceOrderRoutes(measurementPath);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /OS-2026-DEMO01/i })).toBeInTheDocument();
    });

    expect(screen.getByRole('navigation', { name: /atalhos da ordem de serviço/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /resumo da conferência/i })).toBeInTheDocument();
  });

  it('reenvia medição rejeitada para rascunho via resubmit', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      createServiceOrdersFetchMock({
        orderCompleted: true,
        seedMeasurement: 'rejected',
      }),
    );
    renderServiceOrderRoutes(measurementPath);

    await waitFor(() => {
      expect(document.querySelector('.measurement-status--rejected')).toHaveTextContent('Rejeitada');
    });

    const resubmitButton = screen.getByRole('button', { name: /reenviar medição/i });
    expect(resubmitButton).toBeEnabled();
    await user.click(resubmitButton);

    await waitFor(() => {
      expect(screen.getByText(/medição reenviada/i)).toBeInTheDocument();
    });
    expect(document.querySelector('.measurement-status--draft')).toHaveTextContent('Rascunho');
    expect(screen.getByRole('button', { name: /submeter medição/i })).toBeEnabled();
  });
});
