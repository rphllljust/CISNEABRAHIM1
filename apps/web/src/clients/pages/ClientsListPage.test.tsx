import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientsListPage } from './ClientsListPage';
import { createClientsFetchMock } from '../../test/clients-fetch-mock';
import { renderWithProviders } from '../../test/render-with-providers';
import { tokenStore, resetTokenStoreForTests } from '../../auth/storage/token-store';
import {
  CLIENT_STATUSES,
  CONTACT_PURPOSES,
  PURCHASE_ORDER_REQUIREMENTS,
  type Client,
  type PurchaseOrderRequirement,
} from '../types/client.types';

function makeClient(
  index: number,
  overrides: Partial<Client> & { purchaseOrderRequirement?: PurchaseOrderRequirement } = {},
): Client {
  const taxId = String(11_222_333_000_000 + index * 811).slice(0, 14).padStart(14, '0');
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
    legalName: `Cliente ${String(index).padStart(2, '0')} LTDA`,
    tradeName: null,
    taxId,
    externalErpId: null,
    status: CLIENT_STATUSES.Active,
    version: 1,
    createdAt: `2026-0${(index % 9) + 1}-01T12:00:00.000Z`,
    updatedAt: `2026-0${(index % 9) + 1}-01T12:00:00.000Z`,
    deactivatedAt: null,
    deactivationReason: null,
    purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.NotRequired,
    contacts: [
      {
        id: `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, '0')}`,
        name: 'Operações',
        purpose: CONTACT_PURPOSES.Operational,
        email: `ops${index}@demo.invalid`,
        phone: null,
      },
    ],
    addresses: [],
    ...overrides,
  };
}

/** Expõe o endereço corrente para provar que busca/filtro/ordenação/página vivem na URL. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderList(initialEntry = '/app/clients') {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/clients"
        element={
          <>
            <ClientsListPage />
            <LocationProbe />
          </>
        }
      />
      <Route path="/app/clients/new" element={<div>Cadastro de Cliente</div>} />
      <Route path="/app/clients/:clientId" element={<div>Detalhe do Cliente</div>} />
    </Routes>,
    { router: { initialEntries: [initialEntry] } },
  );
}

async function awaitFirstRow(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('table', { name: /lista de clientes/i })).toBeInTheDocument();
  });
}

describe('ClientsListPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('renders paginated list from backend', async () => {
    vi.stubGlobal('fetch', createClientsFetchMock());
    renderList();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Cliente Demo LTDA' })).toBeInTheDocument();
    });
    expect(screen.getByRole('table', { name: /lista de clientes/i })).toBeInTheDocument();
  });

  it('shows access denied when list is forbidden', async () => {
    vi.stubGlobal('fetch', createClientsFetchMock({ clientListAllowed: false }));
    renderList();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão/i);
    });
  });

  it('filters by status via backend query', async () => {
    const fetchMock = createClientsFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderList();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Cliente Demo LTDA' })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'INACTIVE');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('status=INACTIVE'),
        expect.anything(),
      );
    });
  });

  it('offers search next to the list and sends it server-side', async () => {
    const fetchMock = createClientsFetchMock({
      clients: [
        makeClient(1, { legalName: 'Alfa Madeira LTDA', tradeName: 'Alfa' }),
        makeClient(2, { legalName: 'Beta Logistica LTDA' }),
      ],
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderList();
    await awaitFirstRow();

    const searchBox = screen.getByRole('searchbox', { name: 'Buscar' });
    await user.type(searchBox, 'Beta');

    // A busca é resolvida no servidor: o termo viaja na query, a lista não é filtrada no browser.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('q=Beta'),
        expect.anything(),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Beta Logistica LTDA' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: 'Alfa Madeira LTDA' })).not.toBeInTheDocument();
  });

  it('distinguishes an empty catalogue from a search without results', async () => {
    // Catálogo vazio: explica o cadastro e oferece a ação de cadastrar.
    vi.stubGlobal('fetch', createClientsFetchMock({ clients: [] }));
    const empty = renderList();

    await waitFor(() => {
      expect(screen.getByText(/nenhum cliente cadastrado ainda/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/corresponde aos filtros/i)).not.toBeInTheDocument();
    // A ação de cadastrar depende do probe de capability, que resolve depois da listagem.
    expect(await screen.findByRole('link', { name: /cadastrar cliente/i })).toBeInTheDocument();
    empty.unmount();

    // Busca sem resultado NÃO repete o estado de cadastro vazio.
    const user = userEvent.setup();
    const fetchMock = createClientsFetchMock({ clients: [makeClient(1)] });
    vi.stubGlobal('fetch', fetchMock);
    renderList();
    await awaitFirstRow();

    await user.type(screen.getByRole('searchbox', { name: 'Buscar' }), 'Zinco');
    await waitFor(() => {
      expect(screen.getByText(/nenhum cliente corresponde aos filtros aplicados/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/nenhum cliente cadastrado ainda/i)).not.toBeInTheDocument();
    // Existe saída explícita do estado sem resultado.
    expect(screen.getByRole('button', { name: /limpar filtros/i })).toBeInTheDocument();
  });

  it('shows a retryable error state when the list request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderList();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });

  it('uses the reported total to disable the next page instead of guessing from a full page', async () => {
    // 20 Clientes com páginas de 20: a heurística "veio cheio logo há mais" ofereceria uma página
    // fantasma. O total informado pelo backend diz que esta é a última página.
    const clients = Array.from({ length: 20 }, (_, index) => makeClient(index + 1));
    vi.stubGlobal('fetch', createClientsFetchMock({ clients }));
    renderList();
    await awaitFirstRow();

    expect(screen.getByRole('button', { name: /próxima/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /anterior/i })).toBeDisabled();
    expect(screen.getByText(/1–20 de 20/i)).toBeInTheDocument();
  });

  it('navigates to the next page through the URL and reflects the range', async () => {
    const clients = Array.from({ length: 25 }, (_, index) => makeClient(index + 1));
    vi.stubGlobal('fetch', createClientsFetchMock({ clients }));
    const user = userEvent.setup();

    renderList();
    await awaitFirstRow();

    expect(screen.getByRole('button', { name: /anterior/i })).toBeDisabled();
    expect(screen.getByText(/1–20 de 25/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /próxima/i }));

    await waitFor(() => {
      expect(screen.getByText(/21–25 de 25/i)).toBeInTheDocument();
    });
    // A página vive na URL, então recarregar/compartilhar preserva o contexto.
    expect(screen.getByTestId('location')).toHaveTextContent('offset=20');
    expect(screen.getByRole('button', { name: /próxima/i })).toBeDisabled();
  });

  it('restores search, filter and page from the URL on first render', async () => {
    const fetchMock = createClientsFetchMock({
      clients: [
        makeClient(1, { legalName: 'Alfa Madeira LTDA' }),
        makeClient(2, { legalName: 'Beta Madeira LTDA', status: CLIENT_STATUSES.Inactive }),
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    renderList('/app/clients?q=Madeira&status=ACTIVE&sort=updatedAt&direction=desc&offset=0');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/q=Madeira.*status=ACTIVE.*sort=updatedAt.*direction=desc/),
        expect.anything(),
      );
    });

    // Os controles refletem o estado que veio da URL.
    expect(screen.getByRole('searchbox', { name: 'Buscar' })).toHaveValue('Madeira');
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('ACTIVE');
  });

  it('sorts by clicking the column header and records it in the URL', async () => {
    const fetchMock = createClientsFetchMock({
      clients: [makeClient(1), makeClient(2)],
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderList();
    await awaitFirstRow();

    const updatedHeader = screen.getByRole('columnheader', { name: /última atualização/i });
    expect(updatedHeader).toHaveAttribute('aria-sort', 'none');

    await user.click(within(updatedHeader).getByRole('button'));

    // "Última atualização" abre descendente: o interesse imediato é o mais recente.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('sort=updatedAt&direction=desc'),
        expect.anything(),
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /última atualização/i })).toHaveAttribute(
        'aria-sort',
        'descending',
      );
    });

    // Clicar de novo inverte.
    await user.click(
      within(screen.getByRole('columnheader', { name: /última atualização/i })).getByRole('button'),
    );
    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /última atualização/i })).toHaveAttribute(
        'aria-sort',
        'ascending',
      );
    });
  });

  it('keeps secondary filters behind "Mais filtros"', async () => {
    vi.stubGlobal('fetch', createClientsFetchMock({ clients: [makeClient(1)] }));
    const user = userEvent.setup();

    renderList();
    await awaitFirstRow();

    // O filtro secundário não ocupa a primeira dobra.
    expect(
      screen.queryByRole('combobox', { name: /exigência de pedido de compra/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /mais filtros/i }));

    const requirement = await screen.findByRole('combobox', {
      name: /exigência de pedido de compra/i,
    });
    await user.selectOptions(requirement, PURCHASE_ORDER_REQUIREMENTS.BeforeBilling);

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        'purchaseOrderRequirement=BEFORE_BILLING',
      );
    });
  });

  it('opens the client when the row is clicked, not only the name link', async () => {
    vi.stubGlobal(
      'fetch',
      createClientsFetchMock({
        clients: [makeClient(1, { taxId: '11222333000181' })],
      }),
    );
    const user = userEvent.setup();

    renderList();
    await awaitFirstRow();

    // A célula do documento não é interativa: o clique nela só pode navegar se a LINHA for
    // navegável, que é exatamente o comportamento em teste.
    await user.click(screen.getByText('11.222.333/0001-81'));

    await waitFor(() => {
      expect(screen.getByText('Detalhe do Cliente')).toBeInTheDocument();
    });
  });

  it('shows the client document formatted and its status', async () => {
    vi.stubGlobal(
      'fetch',
      createClientsFetchMock({
        clients: [
          makeClient(1, {
            legalName: 'Alfa Madeira LTDA',
            tradeName: 'Alfa',
            taxId: '11222333000181',
          }),
        ],
      }),
    );

    renderList();
    await awaitFirstRow();

    // O documento é armazenado normalizado e apresentado formatado.
    expect(screen.getByText('11.222.333/0001-81')).toBeInTheDocument();
    expect(screen.getByLabelText(/status: ativo/i)).toBeInTheDocument();
    // Nome fantasia aparece como apoio da razão social, sem virar uma segunda coluna.
    expect(screen.getByText('Alfa')).toBeInTheDocument();
  });
});
