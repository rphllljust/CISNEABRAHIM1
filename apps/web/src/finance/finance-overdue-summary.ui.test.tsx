import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { createFinanceFetchMock } from '../test/finance-fetch-mock';
import { renderWithProviders } from '../test/render-with-providers';
import { FinanceOverviewPage } from './pages/FinanceOverviewPage';

const SUMMARY = {
  total: 1501,
  openCount: 1501,
  overdueCount: 1501,
  dueCount: 0,
  paidCount: 0,
  amounts: [
    {
      currencyCode: 'BRL',
      openAmount: '9007199254740993.0001',
      overdueAmount: '9007199254740993.0001',
      dueAmount: '0.0000',
    },
  ],
};

function withSummaryFetch(summaryStatus = 200) {
  const backend = createFinanceFetchMock({ receivableCount: 2 });
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, 'http://localhost').pathname;
    if (path === '/api/v1/finance/receivables/summary') {
      return new Response(JSON.stringify(summaryStatus === 200 ? SUMMARY : { message: 'Unavailable' }), {
        status: summaryStatus,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return backend(input, init);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('Financeiro — ligação da posição vencida à API autoritativa', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('shows the 1,501-title SQL summary, not the 2 titles on the loaded list page', async () => {
    const fetch = withSummaryFetch();
    renderWithProviders(<FinanceOverviewPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Vencido a receber: 1501/i })).toBeInTheDocument();
    });
    expect(screen.getAllByText(/9\.007\.199\.254\.740\.993,0001/).length).toBeGreaterThan(0);
    expect(fetch.mock.calls.some(([request]) => {
      const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
      return url.includes('/api/v1/finance/receivables/summary');
    })).toBe(true);
  });

  it('preserves unknown status if the server summary fails instead of treating it as zero', async () => {
    withSummaryFetch(503);
    renderWithProviders(<FinanceOverviewPage />);

    await waitFor(() => {
      const strip = screen.getByLabelText('Situação financeira do recorte');
      const item = within(strip).getByText('Vencido a receber').closest('div');
      expect(item).not.toBeNull();
      expect(within(item as HTMLElement).getByText('Não publicado')).toBeInTheDocument();
      expect(within(item as HTMLElement).getByText('valor indisponível')).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /Vencido a receber: 0/i })).not.toBeInTheDocument();
  });
});
