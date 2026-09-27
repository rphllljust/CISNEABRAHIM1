import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { createExpensesFetchMock, EXPENSES_TEST_DATA } from '../../test/expenses-fetch-mock';
import { renderWithProviders } from '../../test/render-with-providers';
import { ExpensesListPage } from './ExpensesListPage';

describe('ExpensesListPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('lists expenses by description and cost center instead of an identifier', async () => {
    vi.stubGlobal('fetch', createExpensesFetchMock());
    renderWithProviders(<ExpensesListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Combustível da frota' })).toHaveAttribute(
        'href',
        `/app/finance/expenses/${EXPENSES_TEST_DATA.EXPENSES[0]!.id}`,
      );
    });

    expect(screen.getByRole('table', { name: 'Lista de Despesas' })).toBeInTheDocument();
    expect(screen.getByText('CC-MANUT')).toBeInTheDocument();
    expect(screen.getByText(/2 despesa\(s\) no total/)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/identificador da despesa/i),
    ).not.toBeInTheDocument();
  });

  it('sends search and status filter to the server', async () => {
    const fetchMock = createExpensesFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderWithProviders(<ExpensesListPage />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Combustível da frota' })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Buscar'), 'CC-MANUT');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => (typeof call[0] === 'string' ? call[0] : ''));
      expect(urls.some((url) => url.includes('/finance/expenses') && url.includes('q=CC-MANUT'))).toBe(true);
    });

    await user.selectOptions(screen.getByLabelText('Status'), 'DRAFT');
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => (typeof call[0] === 'string' ? call[0] : ''));
      expect(urls.some((url) => url.includes('status=DRAFT'))).toBe(true);
    });
  });

  it('shows the denied state when the server refuses the list grant', async () => {
    vi.stubGlobal('fetch', createExpensesFetchMock({ denied: true }));
    renderWithProviders(<ExpensesListPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão/i);
    });
  });
});
