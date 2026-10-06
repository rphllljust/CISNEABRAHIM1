import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { renderWithProviders } from '../../test/render-with-providers';
import { createShellFetchMock } from '../../test/shell-fetch-mock';
import { parseRequestPath } from '../../test/request-url';
import { ServiceOrdersEngineListPage } from './ServiceOrdersEngineListPage';

/**
 * WORKLIST DE ORDENS DE SERVIÇO — RECORTE E PAGINAÇÃO SERVER-SIDE.
 *
 * Antes, a tela pedia 50 linhas fixas com `offset: 0` e parava ali: acima de 50 ordens a
 * carteira era truncada em SILÊNCIO, e não havia como alcançar o resto. Agora `q`, `status`,
 * `limit` e `offset` vão ao servidor.
 *
 * REGRA CRÍTICA QUE ESTA SUÍTE PROTEGE: a listagem NÃO publica `total`. Nenhuma asserção aqui
 * aceita "de N", "página X de Y" ou qualquer quantidade global — página paginada não é dataset.
 */

const PAGE_SIZE = 20;

/** 25 ordens: a primeira página enche (25 > 20) e a segunda fica incompleta. */
const ORDERS = Array.from({ length: 25 }, (_, index) => {
  const number = String(index + 1).padStart(4, '0');
  return {
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    orderNumber: `OS-${number}`,
    // Metade liberada, metade em execução: dá recorte real de situação.
    status: index % 2 === 0 ? 'RELEASED' : 'IN_EXECUTION',
    clientSnapshot: { legalName: `Cliente ${number}` },
  };
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function metaField(name: string, label: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    label,
    type: 'text',
    required: false,
    readOnly: false,
    inList: false,
    inForm: true,
    inFilter: false,
    listOrder: 0,
    fieldOrder: 0,
    permLevel: 0,
    options: null,
    ...extra,
  };
}

const SERVICE_ORDERS_META = {
  name: 'service-orders',
  label: 'Ordens de serviço',
  description: null,
  dataSchema: 'svc',
  dataTable: 'service_orders',
  labelField: 'order_number',
  fields: [
    metaField('order_number', 'Número da OS', { inList: true, listOrder: 10 }),
    metaField('client_snapshot', 'Cliente', { inList: true, listOrder: 20 }),
    metaField('status', 'Situação', {
      inList: true,
      listOrder: 30,
      type: 'select',
      inFilter: true,
      options: {
        options: [
          { value: 'RELEASED', label: 'Liberada' },
          { value: 'IN_EXECUTION', label: 'Em execução' },
        ],
      },
    }),
  ],
  views: [
    {
      viewType: 'list',
      label: 'Lista de ordens de serviço',
      layout: { columns: ['order_number', 'client_snapshot', 'status'] },
      isDefault: true,
    },
  ],
  workflow: { stateField: 'status', transitions: [] },
  permissions: [{ action: 'read', permLevel: 0, requiredPermission: null, allowed: true }],
  allowedPermLevels: [0],
};

/**
 * Dublê que respeita `q`, `status`, `limit` e `offset` COMO O BACKEND FAZ, e devolve o mesmo
 * formato do contrato: `{ items, limit, offset }` — sem `total`.
 */
function createOrdersMock() {
  const shell = createShellFetchMock();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const { pathname, searchParams } = parseRequestPath(input);

    if (pathname === '/api/v1/meta/service-orders' && method === 'GET') {
      return jsonResponse(SERVICE_ORDERS_META);
    }

    if (pathname === '/api/v1/service-orders' && method === 'GET') {
      const limit = Number(searchParams.get('limit') ?? String(PAGE_SIZE));
      const offset = Number(searchParams.get('offset') ?? '0');
      const status = searchParams.get('status');
      const q = searchParams.get('q')?.trim().toLowerCase() ?? '';

      let items = ORDERS;
      if (status) {
        items = items.filter((order) => order.status === status);
      }
      if (q) {
        items = items.filter(
          (order) =>
            order.orderNumber.toLowerCase().includes(q) ||
            order.clientSnapshot.legalName.toLowerCase().includes(q),
        );
      }

      return jsonResponse({ items: items.slice(offset, offset + limit), limit, offset });
    }

    return shell(input, init);
  });
}

/** URLs de listagem já chamadas, para inspecionar o que a TELA mandou ao SERVIDOR. */
function listCalls(fetchMock: ReturnType<typeof createOrdersMock>): string[] {
  return fetchMock.mock.calls
    .map((call) => (typeof call[0] === 'string' ? call[0] : ''))
    .filter((url) => url.includes('/api/v1/service-orders?'));
}

async function renderPage() {
  renderWithProviders(<ServiceOrdersEngineListPage />, { metadata: true });
  await waitFor(() => {
    expect(screen.getByTestId('dynamic-list')).toBeInTheDocument();
  });
  await waitFor(() => {
    expect(screen.getByText('OS-0001')).toBeInTheDocument();
  });
}

describe('ServiceOrdersEngineListPage — recorte e paginação server-side', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    sessionStorage.clear();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('pede a primeira página com limit e offset explícitos', async () => {
    const fetchMock = createOrdersMock();
    vi.stubGlobal('fetch', fetchMock);

    await renderPage();

    const first = listCalls(fetchMock)[0] ?? '';
    expect(first).toContain(`limit=${PAGE_SIZE}`);
    expect(first).toContain('offset=0');
  });

  it('envia a busca ao SERVIDOR e reinicia o offset', async () => {
    const fetchMock = createOrdersMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    await renderPage();

    // Vai para a segunda página primeiro, para provar que a busca RESETA o offset.
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    await waitFor(() => {
      expect(listCalls(fetchMock).some((url) => url.includes(`offset=${PAGE_SIZE}`))).toBe(true);
    });

    await user.type(screen.getByLabelText('Buscar'), 'OS-0012');

    await waitFor(() => {
      const urls = listCalls(fetchMock);
      const searchCall = urls.find((url) => url.includes('q=OS-0012'));
      expect(searchCall).toBeDefined();
      // RESET DO OFFSET: a busca sempre recomeça na primeira página.
      expect(searchCall).toContain('offset=0');
      expect(searchCall).not.toContain(`offset=${PAGE_SIZE}`);
    });
  });

  it('envia o filtro de situação ao SERVIDOR e reinicia o offset', async () => {
    const fetchMock = createOrdersMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    await waitFor(() => {
      expect(listCalls(fetchMock).some((url) => url.includes(`offset=${PAGE_SIZE}`))).toBe(true);
    });

    // O filtro de situação vive na `DynamicFilterBar` (dirigida por `in_filter` do metadado) e
    // escreve `status` na URL — que `loadRows` manda à CONSULTA. Há UM só controle por recorte.
    await user.selectOptions(screen.getByLabelText('Situação'), 'RELEASED');

    await waitFor(() => {
      const urls = listCalls(fetchMock);
      const filtered = urls.find((url) => url.includes('status=RELEASED'));
      expect(filtered).toBeDefined();
      expect(filtered).toContain('offset=0');
    });
  });

  it('navega para a próxima página e volta, sem afirmar total', async () => {
    const fetchMock = createOrdersMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    await renderPage();

    // Primeira página: 20 linhas, e o rodapé fala só do INTERVALO da página.
    expect(screen.getByText(/1–20 nesta página/)).toBeInTheDocument();
    // A listagem não publica total: a tela NÃO pode afirmar quantidade global.
    expect(screen.queryByText(/de 25/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Página 1 de/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Próxima' }));

    await waitFor(() => {
      // A segunda página traz as 5 restantes e o intervalo acompanha. O rótulo do intervalo e o
      // sufixo "nesta página" são NÓS distintos na moldura, então a busca casa só o intervalo.
      expect(screen.getByText(/21–25/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Anterior' }));

    await waitFor(() => {
      expect(screen.getByText(/1–20/)).toBeInTheDocument();
    });
    // O timeout padrão de 5s não cobre duas navegações de página com a árvore cheia; o teste
    // mede comportamento, não velocidade.
  }, 15000);

  it('desabilita "Anterior" na primeira página', async () => {
    vi.stubGlobal('fetch', createOrdersMock());

    await renderPage();

    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  });

  it('mostra o estado vazio do recorte, distinguível do vazio de origem', async () => {
    vi.stubGlobal('fetch', createOrdersMock());
    const user = userEvent.setup();

    await renderPage();

    await user.type(screen.getByLabelText('Buscar'), 'OS-9999');

    await waitFor(() => {
      expect(
        screen.getByText('Nenhuma ordem de serviço corresponde aos filtros aplicados.'),
      ).toBeInTheDocument();
    });
  });
});
