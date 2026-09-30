import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientsListPage } from './ClientsListPage';
import { applyClientListQuery, createClientsFetchMock } from '../../test/clients-fetch-mock';
import { parseRequestPath, requestUrl } from '../../test/request-url';
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

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

/** Requisição que o teste segura na mão, para provar o que acontece com o que chega fora de hora. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function jsonResponseFor(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

/**
 * Cancela como o `fetch` real: abortar REJEITA a promessa com `AbortError` (o mock da plataforma
 * ignora o sinal, então o caminho de cancelamento só é exercitado por este auxiliar).
 */
function abortable(pending: Promise<Response>, signal?: AbortSignal | null): Promise<Response> {
  if (!signal) {
    return pending;
  }
  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort);
    pending.then(resolve, reject);
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
    // Existe saída explícita do estado sem resultado. Sao DUAS saidas legitimas — a da toolbar
    // (sempre que ha filtro ativo) e a do painel de estado vazio — entao a assercao exige a do
    // PAINEL, que e a que aparece junto da mensagem. Antes bastava uma; a migracao para a
    // gramatica de worklist acrescentou a da toolbar e o seletor ficou ambiguo.
    expect(
      screen.getAllByRole('button', { name: /limpar filtros/i }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole('button', { name: 'Limpar filtros da toolbar' }),
    ).toBeInTheDocument();
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

  it('does not ask the backend for a term below the published minimum', async () => {
    // `q=a` responde 400 por contrato: enviar o rascunho trocaria a lista por uma tela de erro no
    // meio da digitação. O piso é o mesmo da busca global da plataforma (2 caracteres).
    const fetchMock = createClientsFetchMock({ clients: [makeClient(1)] });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderList();
    await awaitFirstRow();

    const searchBox = screen.getByRole('searchbox', { name: 'Buscar' });
    await user.type(searchBox, 'B');

    expect(await screen.findByText(/pelo menos 2 caracteres/i)).toBeInTheDocument();
    expect(searchBox).toHaveAttribute('aria-describedby');

    // Espera o debounce vencer de fato (300 ms + folga): sem isso a asserção abaixo passaria
    // apenas porque o temporizador ainda não tinha disparado.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    // A lista continua a que já estava carregada, e nenhuma requisição de busca foi feita.
    expect(screen.getByRole('link', { name: 'Cliente 01 LTDA' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).not.toHaveTextContent('q=');
    expect(
      fetchMock.mock.calls.some(([input]) => requestUrl(input).includes('q=B')),
      'nenhuma requisição pode carregar um termo abaixo do piso',
    ).toBe(false);

    // A partir do piso o termo é uma busca de verdade e volta a viajar para o servidor.
    await user.type(searchBox, 'eta');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('q=Beta'), expect.anything());
    });
  });

  it('keeps the list and the search field when a superseded request is aborted', async () => {
    // Dois defeitos de uma vez. Trocar a página inteira pelo estado de carregamento desmontava o
    // campo de busca no meio da digitação; e o cancelamento do próprio efeito, ao virar erro,
    // substituía a lista por uma tela de falha enquanto a nova requisição não respondia.
    const clients = [
      makeClient(1, { legalName: 'Alfa Madeira LTDA' }),
      makeClient(2, { legalName: 'Beta Logistica LTDA' }),
    ];
    const base = createClientsFetchMock({ clients });
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname, searchParams } = parseRequestPath(input);
      // limit=20 identifica a requisição da PÁGINA: os probes de capability usam limit=1.
      if ((init?.method ?? 'GET') === 'GET' && pathname === '/api/v1/clients') {
        if (searchParams.get('limit') === '20') {
          if (searchParams.get('q') === 'Beta Log') {
            return abortable(second.promise, init?.signal);
          }
          if (searchParams.get('q') === 'Beta') {
            return abortable(first.promise, init?.signal);
          }
        }
      }
      return base(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderList();
    await awaitFirstRow();

    const searchBox = screen.getByRole('searchbox', { name: 'Buscar' });
    await user.type(searchBox, 'Beta');
    await waitFor(() => {
      expect(screen.getByText(/atualizando/i)).toBeInTheDocument();
    });

    // Em curso: sem tela de erro, campo de busca no lugar, resultado anterior preservado.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Buscar' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alfa Madeira LTDA' })).toBeInTheDocument();

    // Segunda busca com a primeira AINDA em voo: o efeito aborta a anterior (AbortError real do
    // fetch). Isso não pode virar erro nem apagar o campo de busca.
    await user.type(screen.getByRole('searchbox', { name: 'Buscar' }), ' Log');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('q=Beta+Log'),
        expect.anything(),
      );
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Buscar' })).toBeInTheDocument();
    expect(screen.getByText(/atualizando/i)).toBeInTheDocument();

    second.resolve(
      jsonResponseFor(applyClientListQuery(clients, new URLSearchParams('q=Beta Log'))),
    );
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Beta Logistica LTDA' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // A lista reflete a ÚLTIMA busca: o termo anterior não sobrevive na tabela.
    expect(screen.queryByRole('link', { name: 'Alfa Madeira LTDA' })).not.toBeInTheDocument();

    // A resposta superada, que ainda estava a caminho, chega por último: não vira erro nem
    // ressuscita o termo anterior.
    await act(async () => {
      first.resolve(jsonResponseFor(applyClientListQuery(clients, new URLSearchParams('q=Beta'))));
    });
    expect(screen.getByRole('link', { name: 'Beta Logistica LTDA' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never lets a late response overwrite a newer filter', async () => {
    // Com latência real a resposta de uma consulta superada pode chegar depois da mais nova. Ela
    // não pode escrever no estado: a tabela passaria a mostrar o resultado de um filtro que não é
    // mais o aplicado (aqui, o Cliente ativo reapareceria sob o filtro "Inativos").
    const clients = [
      makeClient(1, { legalName: 'Alfa Madeira LTDA' }),
      makeClient(2, { legalName: 'Beta Logistica LTDA', status: CLIENT_STATUSES.Inactive }),
    ];
    const base = createClientsFetchMock({ clients });
    const late = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname, searchParams } = parseRequestPath(input);
      if (
        (init?.method ?? 'GET') === 'GET' &&
        pathname === '/api/v1/clients' &&
        searchParams.get('limit') === '20' &&
        searchParams.get('q') === 'LTDA' &&
        !searchParams.has('status')
      ) {
        // Ignora o cancelamento de propósito: simula a resposta que já estava a caminho.
        return late.promise;
      }
      return base(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderList();
    await awaitFirstRow();

    await user.type(screen.getByRole('searchbox', { name: 'Buscar' }), 'LTDA');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('q=LTDA'), expect.anything());
    });

    // Novo filtro assume a consulta: agora só o Cliente inativo.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'INACTIVE');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Beta Logistica LTDA' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: 'Alfa Madeira LTDA' })).not.toBeInTheDocument();

    // A resposta antiga (sem filtro de status, com o Cliente ativo dentro) chega por último.
    // `act` garante que a atualização de estado — se ela acontecer — já esteja aplicada ao DOM
    // antes da asserção, em vez de a asserção passar por ler um DOM ainda não atualizado.
    await act(async () => {
      late.resolve(jsonResponseFor(applyClientListQuery(clients, new URLSearchParams('q=LTDA'))));
    });

    expect(screen.getByRole('link', { name: 'Beta Logistica LTDA' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Alfa Madeira LTDA' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // A faixa de paginação segue a consulta aplicada, não a resposta superada.
    expect(screen.getByText(/1–1 de 1/)).toBeInTheDocument();
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
