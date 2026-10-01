import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import {
  createServiceOrdersFetchMock,
  MOCK_SERVICE_ORDER_ID,
} from '../test/service-orders-fetch-mock';

describe('service orders list e2e (frontend)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', createServiceOrdersFetchMock());
  });

  /**
   * A lista passou a expor UMA próxima ação por linha (leitura da máquina de estados já
   * liberada pelo backend) no lugar de três links fixos de etapa. A asserção foi atualizada
   * para o contrato vigente: a linha da OS `RELEASED` do mock oferece a etapa de planejamento,
   * e a ação continua alcançável a partir da lista.
   */
  it('loads global list with the next operational action reachable', async () => {
    window.history.pushState({}, '', '/app/service-orders');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /ordens de serviço/i })).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'OS-2026-DEMO01' })).toBeInTheDocument();
    });

    // B5: o identificador abre a visão geral da OS, onde vivem ações e histórico.
    expect(screen.getByRole('link', { name: 'OS-2026-DEMO01' })).toHaveAttribute(
      'href',
      `/app/service-orders/${MOCK_SERVICE_ORDER_ID}`,
    );
    // OS liberada (mock): o BACKEND oferece "start" (iniciar execução) e "cancel".
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Iniciar execução' })).toBeInTheDocument();
    });
  }, 20000);

  it('preserves overdue filter from dashboard attention URL', async () => {
    window.history.pushState({}, '', '/app/service-orders?filter=overdue');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/prazo operacional vencido/i)).toBeInTheDocument();
    });
  }, 20000);

  it('preserves active status filter from dashboard KPI URL', async () => {
    window.history.pushState({}, '', '/app/service-orders?status=active');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText(/status: liberada/i)).toBeInTheDocument();
    });

    const statusFilter = screen.getByRole('combobox', { name: 'Status' });
    expect(statusFilter).toHaveValue('active');
  }, 20000);
});
