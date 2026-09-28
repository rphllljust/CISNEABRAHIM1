import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import {
  createServiceOrdersFetchMock,
  MOCK_SERVICE_ORDER_ID,
} from '../test/service-orders-fetch-mock';

describe('service order planning flow e2e (frontend)', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('loads planning page with requirements, planning and allocation sections', async () => {
    vi.stubGlobal('fetch', createServiceOrdersFetchMock());
    window.history.pushState({}, '', `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/planning`);
    render(<App />);

    // Object page canonica: numero humano da OS como referencia visivel.
    await waitFor(() => {
      expect(screen.getAllByText('OS-2026-DEMO01').length).toBeGreaterThan(0);
    });

    expect(screen.getByRole('heading', { name: /resumo operacional/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /requisitos do serviço/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /planejamento/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /disponibilidade de ativos/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /alocações confirmadas/i })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'TRUCK' })).toBeInTheDocument();
  }, 20000);

  it('denies route when service order list access is forbidden', async () => {
    vi.stubGlobal('fetch', createServiceOrdersFetchMock({ serviceOrderListAllowed: false }));
    window.history.pushState({}, '', `/app/service-orders/${MOCK_SERVICE_ORDER_ID}/planning`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /acesso negado/i })).toBeInTheDocument();
    });
  }, 20000);
});
