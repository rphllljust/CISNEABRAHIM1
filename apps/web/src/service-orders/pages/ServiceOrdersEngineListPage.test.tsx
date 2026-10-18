import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { renderWithProviders } from '../../test/render-with-providers';
import { createShellFetchMock } from '../../test/shell-fetch-mock';
import { parseRequestPath } from '../../test/request-url';
import { ServiceOrdersEngineListPage } from './ServiceOrdersEngineListPage';
import { serviceOrderEngineRows } from './service-order-engine-rows';
import type { ServiceOrderSummary } from '../api/service-orders-api';

/**
 * WORKLIST DE ORDENS DE SERVIÇO — RECORTE E PAGINAÇÃO SERVER-SIDE.
 *
 * Antes, a tela pedia 50 linhas fixas com `offset: 0` e parava ali: acima de 50 ordens a
 * carteira era truncada em SILÊNCIO, e não havia como alcançar o resto. Agora `q`, `status`,
 * `limit` e `offset` vão ao servidor.
 *
 * A lista publica o total do recorte autorizado; a suíte prova que a tela usa esse total e não
 * infere a existência de outra página pela quantidade de linhas retornada.
 */

const PAGE_SIZE = 20;

/** 25 ordens: a primeira página enche (25 > 20) e a segunda fica incompleta. */
const ORDERS = Array.from({ length: 25 }, (_, index) => {
  const number = String(index + 1).padStart(4, '0');
  return {
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    orderNumber: `OS-${number}`,
    internalCode: `SO-INT-${number}`,
    createdAt: '2026-10-17T12:00:00.000Z',
    updatedAt: '2026-10-18T12:00:00.000Z',
    origin: 'AUTHORIZED_DIRECT',
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
    metaField('client_snapshot', 'Cliente', { inList: false, listOrder: 20 }),
    metaField('internal_code', 'Código interno', { inList: true, listOrder: 40 }),
    metaField('created_at', 'Criada em', { inList: true, listOrder: 50, type: 'datetime' }),
    metaField('status', 'Situação', {
      inList: true,
      listOrder: 30,
      type: 'select',
      inFilter: true,
      options: {
        options: [
          { value: 'DRAFT', label: 'Rascunho' },
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
      layout: { columns: ['order_number', 'internal_code', 'status', 'created_at'] },
      isDefault: true,
    },
  ],
  workflow: { stateField: 'status', transitions: [] },
  permissions: [{ action: 'read', permLevel: 0, requiredPermission: null, allowed: true }],
  allowedPermLevels: [0],
};

/**
 * Dublê que respeita `q`, `status`, `limit` e `offset` COMO O BACKEND FAZ, e devolve o mesmo
 * formato do contrato: `{ items, limit, offset, total, hasMore }`.
 */
function createOrdersMock(dataset = ORDERS) {
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

      let items = dataset;
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

      const pageItems = items.slice(offset, offset + limit);
      return jsonResponse({
        items: pageItems,
        limit,
        offset,
        total: items.length,
        hasMore: offset + pageItems.length < items.length,
      });
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

  it('mantém a worklist na gramática visual Midnight & Champagne', async () => {
    vi.stubGlobal('fetch', createOrdersMock());

    await renderPage();

    expect(document.querySelector('.cisne-engine-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('dynamic-kpi-drilldown')).toHaveClass('cisne-kpi-strip');
    expect(document.querySelector('.cisne-query-deck')).toBeInTheDocument();
    expect(screen.getByTestId('dynamic-list').parentElement).toHaveClass(
      'cisne-worklist-table-surface',
    );
  });

  it('publica código humano, criação e cliente em colunas distintas, sem KPI duplicado', async () => {
    const fetchMock = createOrdersMock();
    vi.stubGlobal('fetch', fetchMock);
    await renderPage();
    const table = screen.getByTestId('dynamic-list');
    expect(within(table).getByText('SO-INT-0001')).toBeInTheDocument();
    expect(within(table).queryByText(ORDERS[0]!.id)).not.toBeInTheDocument();
    expect(within(table).getAllByText('17/10/2026, 08:00')).toHaveLength(PAGE_SIZE);
    expect(within(table).getByText('Cliente 0001')).toBeInTheDocument();
    expect(within(table).queryByText(/Sem responsável|`n/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('dynamic-list-owner')).not.toBeInTheDocument();
    expect(document.querySelector('.cisne-engine-signal-strip')).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method && init.method !== 'GET')).toBe(false);
  });

  it('não usa UUID, atualização ou responsável como reserva de campos ausentes', () => {
    const order: ServiceOrderSummary = {
      id: 'technical-id', orderNumber: 'OS-0001', unitId: 'CISNE-RO-PVH',
      status: 'DRAFT', clientId: null, clientSnapshot: null, description: null,
      rowVersion: 1, updatedAt: '2026-10-18T12:00:00.000Z', deadlineAt: null,
      assignedWorkforceMember: { id: 'person-id', memberCode: 'P-1', displayName: 'Operador' },
    };
    const [row] = serviceOrderEngineRows([order]);
    expect(row).toMatchObject({ id: 'technical-id', internal_code: null, created_at: null,
      origin: null, client_snapshot: null, assigned_workforce_name: 'Operador', status: 'DRAFT' });
  });

  it('drawer publica somente comandos autorizados pelo control center', async () => {
    const blockedOrder = { ...ORDERS[0]!, status: 'DRAFT' };
    const base = createOrdersMock([blockedOrder]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const { pathname } = parseRequestPath(input);

      if (pathname === `/api/v1/service-orders/${blockedOrder.id}` && method === 'GET') {
        return jsonResponse({
          id: blockedOrder.id,
          internalCode: 'OS-INT-0001',
          orderNumber: blockedOrder.orderNumber,
          unitId: 'unit-demo',
          status: 'DRAFT',
          origin: 'AUTHORIZED_DIRECT',
          clientId: null,
          clientSnapshot: blockedOrder.clientSnapshot,
          serviceDefinitionId: null,
          serviceDefinitionVersionId: null,
          serviceSnapshot: {
            serviceCode: '',
            serviceName: '',
            requirements: { resources: [], labor: [], execution: [] },
          },
          description: null,
          rowVersion: 1,
          createdAt: '2026-10-17T12:00:00.000Z',
          preparedAt: null,
          releasedAt: null,
          startedAt: null,
          pausedAt: null,
          completedAt: null,
          cancelledAt: null,
          statusBeforeCancel: null,
          updatedAt: '2026-10-17T12:00:00.000Z',
          historyEvents: [],
          controlCenter: {
            progression: [],
            plannedVsActual: {
              plannedResources: 0,
              activeAllocations: 0,
              executionEntries: 0,
              executedQuantityTotal: null,
              divergences: [],
            },
            downstream: {
              measurement: { count: 0, status: null, createdAt: null },
              billing: {
                count: 0,
                status: null,
                createdAt: null,
                totalAmount: null,
                currencyCode: null,
              },
            },
            nextAction: {
              step: 'Aguardar definição do serviço',
              transition: null,
              availableTransitions: ['cancel'],
              blockers: ['SERVICE_DEFINITION_REQUIRED'],
            },
          },
        });
      }

      return base(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Contexto' }));

    await waitFor(() => {
      expect(screen.getByText('OS-INT-0001')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Preparar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Liberar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reabrir' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.getByText('Autorizada diretamente')).toBeInTheDocument();
    expect(screen.queryByText('AUTHORIZED_DIRECT')).not.toBeInTheDocument();
    expect(screen.queryByText('DRAFT')).not.toBeInTheDocument();

  });

  it('não mostra paginação nem cockpit redundante quando o recorte está vazio', async () => {
    vi.stubGlobal('fetch', createOrdersMock([]));

    renderWithProviders(<ServiceOrdersEngineListPage />, { metadata: true });

    await waitFor(() => {
      expect(screen.getByText('Nenhuma ordem de serviço no seu escopo.')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Anterior' })).not.toBeInTheDocument();
    expect(screen.queryByText(/1–0 de 0/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('dynamic-list')).not.toBeInTheDocument();
    expect(screen.queryByText('0 registros')).not.toBeInTheDocument();
    expect(document.querySelector('.cisne-engine-signal-strip')).not.toBeInTheDocument();
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

  it('navega conforme o total autoritativo do recorte e volta', async () => {
    const fetchMock = createOrdersMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    await renderPage();

    expect(screen.getByText(/1–20 de 25 no recorte/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Próxima' }));

    await waitFor(() => {
      // A segunda página traz as 5 restantes e o intervalo acompanha. O rótulo do intervalo e o
      // sufixo "nesta página" são NÓS distintos na moldura, então a busca casa só o intervalo.
      expect(screen.getByText(/21–25 de 25 no recorte/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Anterior' }));

    await waitFor(() => {
      expect(screen.getByText(/1–20/)).toBeInTheDocument();
    });
    // O timeout padrão de 5s não cobre duas navegações de página com a árvore cheia; o teste
    // mede comportamento, não velocidade.
  }, 15000);

  it('não oferece página fantasma quando o recorte termina exatamente no limite', async () => {
    vi.stubGlobal('fetch', createOrdersMock(ORDERS.slice(0, PAGE_SIZE)));

    await renderPage();

    expect(screen.getByText(/1–20 de 20 no recorte/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
  });

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
