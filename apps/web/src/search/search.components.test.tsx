import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GlobalSearchBar } from './components/GlobalSearchBar';
import { SearchResultsPage } from './pages/SearchResultsPage';
import type { SearchResponse } from './types/search.types';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const { searchEntities } = vi.hoisted(() => ({
  searchEntities: vi.fn<typeof import('./api/search-api').searchEntities>(),
}));

vi.mock('./api/search-api', () => ({
  searchEntities,
  SearchApiError: class SearchApiError extends Error {},
}));

vi.mock('./hooks/useGlobalSearch', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useGlobalSearch')>('./hooks/useGlobalSearch');
  return {
    ...actual,
    readRecentSearches: () => [],
  };
});

describe('GlobalSearchBar', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('navigates to search page on submit', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GlobalSearchBar />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole('combobox', { name: /busca global/i }), 'SO-123');
    await user.click(screen.getByRole('button', { name: /buscar/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/app/search?q=SO-123');
  });

  it('supports keyboard submit with Enter', () => {
    render(
      <MemoryRouter>
        <GlobalSearchBar />
      </MemoryRouter>,
    );

    const input = screen.getByRole('combobox', { name: /busca global/i });
    fireEvent.change(input, { target: { value: 'Cliente Alfa' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockNavigate).toHaveBeenCalledWith('/app/search?q=Cliente%20Alfa');
  });
});

describe('SearchResultsPage', () => {
  beforeEach(() => {
    searchEntities.mockReset();
  });

  it('renders grouped results with safe highlight', async () => {
    searchEntities.mockResolvedValue({
      query: { raw: 'Alfa', kind: 'text' },
      groups: [
        {
          entityType: 'CLIENT',
          total: 1,
          items: [
            {
              entityType: 'CLIENT',
              entityId: 'client-1',
              title: 'Alfa Serviços',
              subtitle: 'Empresa Alfa',
              status: 'ACTIVE',
              occurredAt: '2026-08-29T12:00:00.000Z',
              entityHref: '/app/clients/client-1',
              highlights: ['Alfa Serviços'],
            },
          ],
        },
      ],
      pagination: { limit: 20, offset: 0, hasMore: false },
      allowedTypes: ['CLIENT'],
    });

    render(
      <MemoryRouter initialEntries={['/app/search?q=Alfa']}>
        <SearchResultsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /clientes/i })).toBeInTheDocument();
    });
    /*
      GRAMATICA ENTERPRISE: o resultado e uma LINHA de grade densa e o REGISTRO INTEIRO e o alvo de
      navegacao — o cartao com link "Abrir registro" saiu. O `<a>` continua sendo real, entao o
      destino e as propriedades de acessibilidade permanecem verificaveis.
    */
    expect(screen.getByRole('link', { name: /alfa serviços/i })).toHaveAttribute(
      'href',
      '/app/clients/client-1',
    );
    expect(screen.getAllByText('Alfa', { selector: 'mark' }).length).toBeGreaterThan(0);
  });

  it('ignores stale responses when rapid typing changes query', async () => {
    let resolveFirst: ((value: SearchResponse) => void) | undefined;
    const first = new Promise<SearchResponse>((resolve) => {
      resolveFirst = resolve;
    });

    searchEntities
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({
        query: { raw: 'Alfa', kind: 'text' },
        groups: [],
        pagination: { limit: 20, offset: 0, hasMore: false },
        allowedTypes: ['CLIENT'],
      });

    render(
      <MemoryRouter initialEntries={['/app/search?q=Al']}>
        <SearchResultsPage />
      </MemoryRouter>,
    );

    resolveFirst?.({
      query: { raw: 'Al', kind: 'text' },
      groups: [
        {
          entityType: 'CLIENT',
          total: 1,
          items: [
            {
              entityType: 'CLIENT',
              entityId: 'stale',
              title: 'Stale',
              subtitle: null,
              status: null,
              occurredAt: '2026-08-29T12:00:00.000Z',
              entityHref: '/app/clients/stale',
              highlights: [],
            },
          ],
        },
      ],
      pagination: { limit: 20, offset: 0, hasMore: false },
      allowedTypes: ['CLIENT'],
    });

    fireEvent.change(screen.getByLabelText(/consulta/i), { target: { value: 'Alfa' } });

    await waitFor(() => {
      expect(screen.queryByText('Stale')).not.toBeInTheDocument();
    });
  });
});
