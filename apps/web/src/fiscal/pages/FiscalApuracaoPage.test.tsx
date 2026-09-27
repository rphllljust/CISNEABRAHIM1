import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { parseRequestPath } from '../../test/request-url';
import { createShellFetchMock } from '../../test/shell-fetch-mock';
import { renderWithProviders } from '../../test/render-with-providers';
import { FiscalApuracaoPage } from './FiscalApuracaoPage';

const CALCULATIONS = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    unitId: 'unit-1',
    ruleCode: 'ISS-05',
    ruleName: 'ISS Serviços Gerais',
    versionNumber: 2,
    baseAmount: '1000',
    rate: '0.05',
    resultAmount: '50',
    calculatedAt: '2026-09-20T12:00:00.000Z',
    sourceKind: 'FISCAL_ASSESSMENT',
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createFiscalFetchMock(options: { denied?: boolean } = {}) {
  const shellMock = createShellFetchMock();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const { pathname } = parseRequestPath(input);

    if (pathname === '/api/v1/fiscal/tax/calculations' && method === 'GET') {
      if (options.denied) {
        return jsonResponse({ error: { code: 'FISCAL_DENIED' } }, 403);
      }
      return jsonResponse({ items: CALCULATIONS, limit: 20, offset: 0, total: 1, totalPages: 1 });
    }

    if (pathname.startsWith('/api/v1/fiscal')) {
      return jsonResponse({ error: { code: 'FISCAL_NOT_FOUND' } }, 404);
    }

    return shellMock(input, init);
  });
}

describe('FiscalApuracaoPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('lists apurações by rule instead of asking for an identifier', async () => {
    vi.stubGlobal('fetch', createFiscalFetchMock());
    const user = userEvent.setup();
    renderWithProviders(<FiscalApuracaoPage />);

    await user.type(screen.getByLabelText('Unidade'), 'unit-1');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'ISS Serviços Gerais' })).toBeInTheDocument();
    });
    expect(screen.getByRole('table', { name: 'Lista de Apurações' })).toBeInTheDocument();
    expect(screen.getByText('ISS-05')).toBeInTheDocument();
    expect(screen.queryByLabelText(/identificador da apuração/i)).not.toBeInTheDocument();
  });

  it('declares refusal when the server denies the list', async () => {
    vi.stubGlobal('fetch', createFiscalFetchMock({ denied: true }));
    const user = userEvent.setup();
    renderWithProviders(<FiscalApuracaoPage />);

    await user.type(screen.getByLabelText('Unidade'), 'unit-1');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão/i);
    });
  });
});
