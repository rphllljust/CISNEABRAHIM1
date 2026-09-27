import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from './auth/storage/token-store';
import { ExpensesPage } from './finance/pages/ExpensesPage';
import { InventoryPage } from './inventory/pages/InventoryPage';
import { ProcurementHubPage } from './procurement/pages/ProcurementPages';
import { SuppliersPage } from './suppliers/pages/SuppliersPage';
import { SuppliersListPage } from './suppliers/pages/SuppliersListPage';
import { parseRequestPath } from './test/request-url';
import { renderWithProviders } from './test/render-with-providers';

const VIEWPORTS = [360, 768, 1024, 1440] as const;
const EXPENSE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const SUPPLIER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

function applyViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width, writable: true });
  window.dispatchEvent(new Event('resize'));
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function denied(code: string) {
  return jsonResponse({ error: { code, message: 'Forbidden.' } }, 403);
}

type CatchUpMockOptions = {
  networkError?: boolean;
  expenseDenied?: boolean;
  expenseConflict?: boolean;
  createCalls?: { count: number };
  submitCalls?: { count: number };
};

function createCatchUpFetchMock(options: CatchUpMockOptions = {}) {
  const createCalls = options.createCalls ?? { count: 0 };
  const submitCalls = options.submitCalls ?? { count: 0 };
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (options.networkError) {
      throw new TypeError('Failed to fetch');
    }
    const { pathname } = parseRequestPath(input);
    const method = init?.method ?? 'GET';

    if (pathname === '/api/v1/auth/session' && method === 'GET') {
      return jsonResponse({
        identityId: '11111111-1111-4111-8111-111111111111',
        session: {
          id: '22222222-2222-4222-8222-222222222222',
          expiresAt: new Date().toISOString(),
          status: 'active',
        },
      });
    }

    if (pathname === `/api/v1/finance/expenses/${EXPENSE_ID}` && method === 'GET') {
      if (options.expenseDenied) {
        return denied('FINANCE_DENIED');
      }
      return jsonResponse({
        id: EXPENSE_ID,
        unitId: 'unit-1',
        status: 'DRAFT',
        version: 1,
        currencyCode: 'BRL',
        totalAmount: '100.0000',
        dueDate: '2026-09-10',
        costCenterCode: 'CC-1',
        reimbursement: null,
        items: [{ id: 'item-1', description: 'Combustivel', amount: '100.0000' }],
      });
    }

    if (pathname.endsWith('/submit') && method === 'POST') {
      submitCalls.count += 1;
      if (options.expenseConflict) {
        return jsonResponse({ error: { code: 'FINANCE_VERSION_CONFLICT' } }, 409);
      }
      return jsonResponse({ id: EXPENSE_ID, status: 'SUBMITTED', version: 2, items: [] });
    }

    if (pathname.endsWith('/finance/expenses') && method === 'POST') {
      createCalls.count += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return jsonResponse({ id: EXPENSE_ID, status: 'DRAFT', version: 1, items: [] }, 201);
    }

    if (pathname.includes('/suppliers/') && pathname.endsWith('/history') && method === 'GET') {
      return jsonResponse([]);
    }

    if (pathname.includes('/suppliers/') && pathname.endsWith('/activate') && method === 'POST') {
      return jsonResponse({ error: { code: 'SUPPLIER_VERSION_CONFLICT' } }, 409);
    }

    if (pathname.endsWith('/suppliers') && method === 'GET') {
      return jsonResponse({ items: [], limit: 20, offset: 0, total: 0, totalPages: 0 });
    }

    if (pathname.endsWith('/procurement/requests') && method === 'GET') {
      return jsonResponse({ items: [], limit: 20, offset: 0, total: 0, totalPages: 0 });
    }

    if (pathname.endsWith('/procurement/orders') && method === 'GET') {
      return jsonResponse({ items: [], limit: 20, offset: 0, total: 0, totalPages: 0 });
    }

    if (pathname.endsWith('/supplier-invoices') && method === 'GET') {
      return jsonResponse({ items: [], limit: 20, offset: 0, total: 0, totalPages: 0 });
    }

    if (pathname.includes('/suppliers/') && method === 'GET') {
      return jsonResponse({
        id: SUPPLIER_ID,
        legalName: 'Fornecedor Alfa',
        taxId: '11222333000181',
        status: 'INACTIVE',
        version: 1,
        contacts: [],
      });
    }

    return jsonResponse({ error: { code: 'NOT_FOUND' } }, 404);
  });
}

describe('Enterprise UI catch-up', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('shows empty expense lookup without inventing a list', () => {
    vi.stubGlobal('fetch', createCatchUpFetchMock());
    renderWithProviders(<ExpensesPage />);
    expect(screen.getByRole('heading', { name: 'Nenhuma despesa carregada' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Despesas' })).toBeInTheDocument();
  });

  it('shows loading then expense fields from the backend', async () => {
    vi.stubGlobal('fetch', createCatchUpFetchMock());
    renderWithProviders(
      <Routes>
        <Route path="/app/finance/expenses/:expenseId" element={<ExpensesPage />} />
      </Routes>,
      { router: { initialEntries: [`/app/finance/expenses/${EXPENSE_ID}`] } },
    );
    expect(screen.getByText(/carregando despesa/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('table', { name: /itens da despesa/i })).toBeInTheDocument();
    });
    expect(screen.getByText('Combustivel')).toBeInTheDocument();
  });

  it('shows permission denied from the expense API', async () => {
    vi.stubGlobal('fetch', createCatchUpFetchMock({ expenseDenied: true }));
    renderWithProviders(
      <Routes>
        <Route path="/app/finance/expenses/:expenseId" element={<ExpensesPage />} />
      </Routes>,
      { router: { initialEntries: [`/app/finance/expenses/${EXPENSE_ID}`] } },
    );
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão/i);
    });
  });

  it('shows network failure with retry on expense lookup', async () => {
    vi.stubGlobal('fetch', createCatchUpFetchMock({ networkError: true }));
    renderWithProviders(
      <Routes>
        <Route path="/app/finance/expenses/:expenseId" element={<ExpensesPage />} />
      </Routes>,
      { router: { initialEntries: [`/app/finance/expenses/${EXPENSE_ID}`] } },
    );
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/conectar ao servidor/i);
    });
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });

  it('blocks double submit and surfaces version conflict', async () => {
    const submitCalls = { count: 0 };
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createCatchUpFetchMock({ expenseConflict: true, submitCalls }));
    renderWithProviders(
      <Routes>
        <Route path="/app/finance/expenses/:expenseId" element={<ExpensesPage />} />
      </Routes>,
      { router: { initialEntries: [`/app/finance/expenses/${EXPENSE_ID}`] } },
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Enviar' });
    await Promise.all([user.click(confirm), user.click(confirm)]);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Conflito de versão' })).toBeInTheDocument();
    });
    expect(submitCalls.count).toBe(1);
  });

  it('protects create expense against double submit', async () => {
    const createCalls = { count: 0 };
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createCatchUpFetchMock({ createCalls }));
    renderWithProviders(<ExpensesPage />);
    await user.type(screen.getByLabelText(/^unidade/i), 'unit-1');
    await user.type(screen.getByLabelText(/^categoria/i), 'cat-1');
    await user.type(screen.getByLabelText(/centro de custo \(id\)/i), 'cc-1');
    await user.type(screen.getByLabelText(/centro de custo \(código\)/i), 'CC-1');
    await user.type(screen.getByLabelText(/^vencimento/i), '2026-09-10');
    await user.type(screen.getByLabelText(/condição de pagamento/i), '30d');
    await user.type(screen.getByLabelText(/^descrição/i), 'Despesa operacional');
    await user.type(document.getElementById('expense-item') as HTMLInputElement, 'Combustivel');
    await user.type(document.getElementById('expense-amount') as HTMLInputElement, '100.0000');
    const submit = screen.getByRole('button', { name: 'Criar despesa' });
    await Promise.all([user.click(submit), user.click(submit)]);
    await waitFor(() => {
      expect(createCalls.count).toBe(1);
    });
  });

  it('shows empty states for suppliers, purchases and inventory', async () => {
    vi.stubGlobal('fetch', createCatchUpFetchMock());
    const { unmount: unmountSuppliers } = renderWithProviders(<SuppliersListPage />);
    await waitFor(() => {
      expect(
        screen.getByText('Nenhum fornecedor encontrado para os filtros selecionados.'),
      ).toBeInTheDocument();
    });
    unmountSuppliers();
    const { unmount: unmountProcurement } = renderWithProviders(<ProcurementHubPage />);
    // As três entidades do fluxo de compras têm lista real; nada exige identificador digitado.
    await waitFor(() => {
      expect(screen.getByRole('table', { name: 'Solicitações de compra' })).toBeInTheDocument();
    });
    expect(screen.getByRole('table', { name: 'Pedidos ao fornecedor' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Notas de fornecedor' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/identificador da solicitação/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/identificador do pedido/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fornecedores' })).toHaveAttribute('href', '/app/suppliers');
    unmountProcurement();
    renderWithProviders(<InventoryPage />);
    expect(screen.getByRole('heading', { name: 'Nenhum saldo carregado' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Liberar' })).toBeInTheDocument();
  });

  it('surfaces supplier version conflict on activate', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', createCatchUpFetchMock());
    renderWithProviders(
      <Routes>
        <Route path="/app/suppliers/:supplierId" element={<SuppliersPage />} />
      </Routes>,
      { router: { initialEntries: [`/app/suppliers/${SUPPLIER_ID}`] } },
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ativar' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Ativar' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Ativar' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Conflito de versão' })).toBeInTheDocument();
    });
  });

  it('keeps catch-up surfaces usable at 360, 768, 1024 and 1440', async () => {
    vi.stubGlobal('fetch', createCatchUpFetchMock());
    const { container, unmount } = renderWithProviders(
      <Routes>
        <Route path="/app/finance/expenses/:expenseId" element={<ExpensesPage />} />
      </Routes>,
      { router: { initialEntries: [`/app/finance/expenses/${EXPENSE_ID}`] } },
    );
    await waitFor(() => {
      expect(screen.getByRole('table', { name: /itens da despesa/i })).toBeInTheDocument();
    });
    for (const width of VIEWPORTS) {
      applyViewport(width);
      expect(container.querySelector('table')).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Despesas' })).toBeInTheDocument();
    }
    unmount();
    const inventory = renderWithProviders(<InventoryPage />);
    for (const width of VIEWPORTS) {
      applyViewport(width);
      expect(screen.getByRole('heading', { name: 'Estoque' })).toBeInTheDocument();
      expect(inventory.container.querySelector('form')).toBeTruthy();
    }
  });
});
