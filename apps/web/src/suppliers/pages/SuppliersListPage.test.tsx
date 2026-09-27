import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { parseRequestPath } from '../../test/request-url';
import { createShellFetchMock } from '../../test/shell-fetch-mock';
import { renderWithProviders } from '../../test/render-with-providers';
import { SuppliersListPage } from './SuppliersListPage';

const ACTIVE_SUPPLIER = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  legalName: 'Fornecedor Alfa LTDA',
  tradeName: 'Alfa',
  taxId: '11222333000181',
  paymentTerms: '30 DDL',
  currencyCode: 'BRL',
  status: 'ACTIVE',
  version: 2,
  updatedAt: '2026-09-25T10:00:00.000Z',
};

const INACTIVE_SUPPLIER = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  legalName: 'Fornecedor Beta LTDA',
  tradeName: null,
  taxId: '33444555000103',
  paymentTerms: null,
  currencyCode: 'BRL',
  status: 'INACTIVE',
  version: 1,
  updatedAt: '2026-09-24T10:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** URLs efetivamente pedidas ao servidor — prova que o filtro foi para o backend. */
function calledUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

function createSuppliersFetchMock(options?: { denied?: boolean }) {
  // A sessão é servida pelo mock de shell: sem ela o AuthProvider expira a sessão e nenhuma
  // consulta seguinte chega ao servidor — um falso "sem dados".
  const shellMock = createShellFetchMock();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const { pathname, searchParams } = parseRequestPath(input);

    if (pathname.endsWith('/suppliers') && method === 'GET') {
      if (options?.denied) {
        return jsonResponse({ error: { code: 'SUPPLIER_DENIED' } }, 403);
      }
      const status = searchParams.get('status');
      const q = searchParams.get('q');
      let items = [ACTIVE_SUPPLIER, INACTIVE_SUPPLIER];
      if (status) {
        items = items.filter((item) => item.status === status);
      }
      if (q) {
        items = items.filter((item) => item.legalName.toLowerCase().includes(q.toLowerCase()));
      }
      return jsonResponse({
        items,
        limit: 20,
        offset: 0,
        total: items.length,
        totalPages: items.length > 0 ? 1 : 0,
      });
    }

    if (pathname.includes('/suppliers')) {
      return jsonResponse({ error: { code: 'NOT_FOUND' } }, 404);
    }

    return shellMock(input, init);
  });
}

describe('SuppliersListPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('lists suppliers by human reference instead of asking for an identifier', async () => {
    vi.stubGlobal('fetch', createSuppliersFetchMock());
    renderWithProviders(<SuppliersListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Alfa' })).toHaveAttribute(
        'href',
        `/app/suppliers/${ACTIVE_SUPPLIER.id}`,
      );
    });

    expect(screen.getByRole('table', { name: /lista de fornecedores/i })).toBeInTheDocument();
    // A linha mostra CNPJ e razão social; o identificador técnico nunca é o conteúdo da célula.
    expect(screen.getByText('11.222.333/0001-81')).toBeInTheDocument();
    expect(screen.getByText('Fornecedor Beta LTDA')).toBeInTheDocument();
    expect(screen.queryByText(ACTIVE_SUPPLIER.id)).not.toBeInTheDocument();
    // Não existe mais campo de identificador do fornecedor no caminho de entrada.
    expect(screen.queryByLabelText(/identificador do fornecedor/i)).not.toBeInTheDocument();
  });

  it('searches through the backend query instead of filtering a local pile', async () => {
    const fetchMock = createSuppliersFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderWithProviders(<SuppliersListPage />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Alfa' })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Buscar'), 'Beta');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() => {
      expect(calledUrls(fetchMock).some((url) => url.includes('q=Beta'))).toBe(true);
    });
  });

  it('filters by status through the backend query', async () => {
    const fetchMock = createSuppliersFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderWithProviders(<SuppliersListPage />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Alfa' })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText('Status'), 'INACTIVE');

    await waitFor(() => {
      expect(calledUrls(fetchMock).some((url) => url.includes('status=INACTIVE'))).toBe(true);
    });
  });

  it('shows the denied state when the server refuses the list', async () => {
    vi.stubGlobal('fetch', createSuppliersFetchMock({ denied: true }));
    renderWithProviders(<SuppliersListPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão/i);
    });
  });
});

