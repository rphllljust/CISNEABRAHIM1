import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { parseRequestPath } from '../test/request-url';
import { renderServiceOrderRoutes } from '../test/render-service-order-routes';
import type { PlannedResource } from './types/resource-planning.types';
import {
  SERVICE_ORDER_STATUSES,
  type ServiceOrderControlCenter,
  type ServiceOrderDetail,
  type ServiceOrderStatus,
} from './types/service-order.types';

/**
 * ORDEM DE SERVICO COMO OBJECT PAGE — comportamento vinculante da tela.
 *
 * Estes testes provam o que a object page AFIRMA:
 * - o operador le numero humano e nome de cliente, nunca identificador tecnico;
 * - o fluxo marca o estado REAL da maquina de estados;
 * - a proxima acao acompanha o status real e nao oferece transicao sem confirmacao do backend;
 * - relacao nao autorizada desaparece por INTEIRO (sem rotulo, sem contagem, sem "oculto");
 * - o historico mostra somente fato persistido, sem ator inventado.
 */

const SERVICE_ORDER_ID = 'a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1';
const CLIENT_ID = 'b2b2b2b2-2222-4222-8222-b2b2b2b2b2b2';
const ACTOR_ID = 'c3c3c3c3-3333-4333-8333-c3c3c3c3c3c3';
const PLANNED_RESOURCE_ID = 'd4d4d4d4-4444-4444-8444-d4d4d4d4d4d4';
const ORDER_NUMBER = 'OS-2026-0007';
const SERVICE_NAME = 'Manutenção preventiva de frota';
const CLIENT_NAME = 'Cliente Operacional';

configure({ asyncUtilTimeout: 3000 });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function orderError(code: string, status: number): Response {
  return jsonResponse({ code, message: 'error' }, status);
}

type MeasurementBlock = { count: number; status: string | null; createdAt: string | null };
type BillingBlock = MeasurementBlock & { totalAmount: string | null; currencyCode: string | null };

/**
 * Operations Control Center como o BACKEND devolve: bloco de medicao/faturamento mascarado
 * (count 0 e status nulo) quando o ator nao tem autorizacao no modulo dono.
 */
function controlCenter(options: {
  status: ServiceOrderStatus;
  executionEntries?: number;
  measurement?: MeasurementBlock;
  billing?: BillingBlock;
  availableTransitions?: string[];
}): ServiceOrderControlCenter {
  const measurement = options.measurement ?? { count: 0, status: null, createdAt: null };
  const billing = options.billing ?? {
    count: 0,
    status: null,
    createdAt: null,
    totalAmount: null,
    currencyCode: null,
  };

  return {
    progression: [
      {
        code: 'DEMAND',
        state: 'DONE',
        at: '2026-01-02T07:00:00.000Z',
        detail: 'Ordem criada diretamente',
        ownerStatus: options.status,
      },
      {
        code: 'PLANNING',
        state: 'DONE',
        at: '2026-01-02T08:00:00.000Z',
        detail: 'Nenhum recurso planejado',
        ownerStatus: options.status,
      },
      {
        code: 'RELEASE',
        state: 'DONE',
        at: '2026-01-02T09:00:00.000Z',
        detail: null,
        ownerStatus: options.status,
      },
      {
        code: 'EXECUTION',
        state: 'CURRENT',
        at: null,
        detail: 'Nenhum apontamento registrado',
        ownerStatus: options.status,
      },
      { code: 'COMPLETION', state: 'PENDING', at: null, detail: null, ownerStatus: options.status },
      { code: 'MEASUREMENT', state: 'PENDING', at: null, detail: null, ownerStatus: measurement.status },
      { code: 'BILLING', state: 'PENDING', at: null, detail: null, ownerStatus: billing.status },
    ],
    plannedVsActual: {
      plannedResources: 0,
      activeAllocations: 0,
      executionEntries: options.executionEntries ?? 0,
      executedQuantityTotal: null,
      divergences: [],
    },
    downstream: { measurement, billing },
    nextAction: {
      step: 'CLOSED',
      transition: null,
      availableTransitions: options.availableTransitions ?? [],
      blockers: [],
    },
  };
}

function orderDetail(overrides: Partial<ServiceOrderDetail> = {}): ServiceOrderDetail {
  return {
    id: SERVICE_ORDER_ID,
    internalCode: 'OS-INT-0007',
    orderNumber: ORDER_NUMBER,
    unitId: 'e5e5e5e5-5555-4555-8555-e5e5e5e5e5e5',
    status: SERVICE_ORDER_STATUSES.Completed,
    origin: 'SERVICE_REQUEST',
    clientId: CLIENT_ID,
    clientSnapshot: { legalName: `${CLIENT_NAME} LTDA`, tradeName: CLIENT_NAME },
    serviceDefinitionId: null,
    serviceDefinitionVersionId: null,
    serviceSnapshot: {
      serviceCode: 'SVC-FROTA',
      serviceName: SERVICE_NAME,
      measurementModel: { mode: 'UNIT', basis: 'SERVICE', defaultUnitCode: 'SERVICE' },
      allowedUnits: [{ unitCode: 'SERVICE', isDefault: true, sortOrder: 0 }],
      requirements: {
        resources: [
          {
            physicalResourceTypeCode: 'TRUCK',
            requirementLevel: 'REQUIRED',
            minQuantity: '2',
            sortOrder: 1,
          },
        ],
        labor: [
          { laborTypeCode: 'OPERATOR', requirementLevel: 'REQUIRED', minQuantity: '1', sortOrder: 1 },
        ],
        execution: [
          { evidenceKind: 'OBSERVATION', requirementLevel: 'REQUIRED', config: null, sortOrder: 1 },
        ],
      },
    },
    description: 'Pátio central',
    rowVersion: 1,
    preparedAt: '2026-01-02T08:00:00.000Z',
    releasedAt: '2026-01-02T09:00:00.000Z',
    cancelledAt: null,
    historyEvents: [],
    controlCenter: controlCenter({ status: SERVICE_ORDER_STATUSES.Completed }),
    ...overrides,
  };
}

function plannedTruck(): PlannedResource {
  return {
    id: PLANNED_RESOURCE_ID,
    serviceOrderId: SERVICE_ORDER_ID,
    requirementKind: 'PHYSICAL_RESOURCE',
    resourceTypeCode: 'TRUCK',
    laborTypeCode: null,
    plannedQuantity: '1',
    operationalStart: null,
    operationalEnd: null,
    notes: null,
    status: 'ACTIVE',
    rowVersion: 1,
  };
}

type MockOptions = {
  planned?: PlannedResource[];
  /** Sondagem de alocacao do backend: `denied` (403) ou `allowed` (404 de recurso inexistente). */
  allocationProbe?: 'denied' | 'allowed';
  /**
   * Comandos válidos que o BACKEND devolveria em `available-actions` (B5).
   *
   * A "Próxima ação" desta página passou a ser derivada desta resposta, e não mais de um
   * mapa local de status. O caso declara explicitamente o que o backend ofereceria.
   */
  availableActions?: {
    service_order_id: string;
    status_atual: string;
    comandos_validos: Array<{
      comando: string;
      label: string;
      requer_permissao: string;
      usuario_tem_permissao: boolean;
    }>;
    comandos_invalidos_para_status: string[];
  };
};

/**
 * Mock de rede focado nesta tela: detalhe autorizado, planejamento controlado e sondagens de
 * capability respondidas como o backend responderia (negado = 403 SERVICE_ORDERS_DENIED).
 */
function planningFetchMock(detail: ServiceOrderDetail, options: MockOptions = {}) {
  const planned = options.planned ?? [];
  const allocationProbe = options.allocationProbe ?? 'denied';

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname, searchParams } = parseRequestPath(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const isProbeOrder = pathname.includes('00000000-0000-4000-8000-000000000010');

    if (pathname === '/api/v1/auth/session' && method === 'GET') {
      return jsonResponse({
        identityId: ACTOR_ID,
        session: { id: 'sid', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
      });
    }
    if (pathname === '/api/v1/service-orders' && method === 'GET') {
      return jsonResponse({
        items: [],
        limit: Number(searchParams.get('limit') ?? 20),
        offset: 0,
      });
    }
    if (pathname === `/api/v1/service-orders/${SERVICE_ORDER_ID}` && method === 'GET') {
      return jsonResponse(detail);
    }
    if (
      pathname === `/api/v1/service-orders/${SERVICE_ORDER_ID}/planned-resources` &&
      method === 'GET'
    ) {
      return jsonResponse(planned);
    }
    if (pathname === `/api/v1/service-orders/${SERVICE_ORDER_ID}/allocations` && method === 'GET') {
      return jsonResponse([]);
    }
    /*
     * ENDPOINTS META (B5) — a "Próxima ação" desta página deixou de ser derivada de um mapa
     * local de status e passou a vir de `available-actions`. Sem estas rotas o fetch cairia
     * no 403 genérico abaixo e a seção desapareceria.
     */
    if (pathname === '/api/v1/me' && method === 'GET') {
      return jsonResponse({
        usuario: { id: ACTOR_ID, nome: null, email: null, identity_id: ACTOR_ID },
        permissoes_efetivas: ['service-orders:service-order:read'],
        escopo_ativo: null,
        escopos_disponiveis: [],
      });
    }
    if (pathname === '/api/v1/service-orders/command-catalog' && method === 'GET') {
      return jsonResponse({
        comandos: [
          { nome: 'prepare', label: 'Preparar', status_origem: ['DRAFT'], status_destino: 'PREPARED', requer_justificativa: false },
          { nome: 'release', label: 'Liberar', status_origem: ['PREPARED'], status_destino: 'RELEASED', requer_justificativa: false },
          { nome: 'cancel', label: 'Cancelar', status_origem: ['DRAFT', 'PREPARED', 'RELEASED'], status_destino: 'CANCELLED', requer_justificativa: false },
          { nome: 'start', label: 'Iniciar execução', status_origem: ['RELEASED'], status_destino: 'IN_EXECUTION', requer_justificativa: false },
          { nome: 'pause', label: 'Pausar', status_origem: ['IN_EXECUTION'], status_destino: 'PAUSED', requer_justificativa: false },
          { nome: 'resume', label: 'Retomar', status_origem: ['PAUSED'], status_destino: 'IN_EXECUTION', requer_justificativa: false },
          { nome: 'complete', label: 'Concluir', status_origem: ['IN_EXECUTION'], status_destino: 'COMPLETED', requer_justificativa: false },
        ],
      });
    }
    if (pathname === `/api/v1/service-orders/${SERVICE_ORDER_ID}/available-actions` && method === 'GET') {
      return jsonResponse(options.availableActions ?? { service_order_id: SERVICE_ORDER_ID, status_atual: detail.status, comandos_validos: [], comandos_invalidos_para_status: [] });
    }
    if (pathname === `/api/v1/service-orders/${SERVICE_ORDER_ID}/audit-timeline` && method === 'GET') {
      return jsonResponse({ service_order_id: SERVICE_ORDER_ID, eventos: [], total: 0 });
    }
    if (isProbeOrder && pathname.endsWith('/allocations') && method === 'POST') {
      return allocationProbe === 'allowed'
        ? orderError('SERVICE_ORDERS_ASSET_NOT_FOUND', 404)
        : orderError('SERVICE_ORDERS_DENIED', 403);
    }
    if (pathname.startsWith('/api/v1/service-orders/')) {
      return orderError('SERVICE_ORDERS_DENIED', 403);
    }
    return orderError('SERVICE_ORDERS_NOT_FOUND', 404);
  });
}

function renderObjectPage(detail: ServiceOrderDetail, options: MockOptions = {}) {
  vi.stubGlobal('fetch', planningFetchMock(detail, options));
  return renderServiceOrderRoutes(`/app/service-orders/${SERVICE_ORDER_ID}/planning`);
}

/**
 * Referencia humana do cabecalho (chip mono) somada ao item final do breadcrumb; ambos
 * mostram o numero real da OS.
 */
async function findHeaderReference(): Promise<HTMLElement> {
  const references = await screen.findAllByText(ORDER_NUMBER);
  return references[0]!;
}

describe('ordem de serviço — object page canônica', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('mostra o número humano da OS e o nome do cliente, nunca um identificador técnico', async () => {
    renderObjectPage(orderDetail());

    expect(await findHeaderReference()).toBeInTheDocument();
    // Titulo do objeto e o SERVICO; o cliente aparece pelo nome do snapshot persistido.
    expect(screen.getByRole('heading', { name: SERVICE_NAME })).toBeInTheDocument();
    expect(screen.getAllByText(CLIENT_NAME).length).toBeGreaterThan(0);
    expect(screen.queryByText(CLIENT_ID)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Status: Concluída/)).toBeInTheDocument();

    // Breadcrumb real: lista de OS -> cliente -> numero da OS.
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByRole('link', { name: 'Ordens de serviço' })).toHaveAttribute(
      'href',
      '/app/service-orders',
    );
    expect(within(breadcrumb).getByText(CLIENT_NAME)).toBeInTheDocument();
    expect(within(breadcrumb).getByText(ORDER_NUMBER)).toHaveAttribute('aria-current', 'page');

    // Nenhum identificador tecnico em NENHUM texto da tela.
    const visibleText = document.body.textContent ?? '';
    expect(visibleText).not.toContain(SERVICE_ORDER_ID);
    expect(visibleText).not.toContain(CLIENT_ID);
    expect(visibleText).not.toContain(ACTOR_ID);
    expect(visibleText).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });

  it('marca no fluxo o estado REAL corrente da ordem de serviço', async () => {
    renderObjectPage(
      orderDetail({
        status: SERVICE_ORDER_STATUSES.InExecution,
        controlCenter: controlCenter({
          status: SERVICE_ORDER_STATUSES.InExecution,
          availableTransitions: ['complete', 'pause'],
        }),
      }),
    );

    await findHeaderReference();

    const flow = screen.getByRole('region', { name: 'Fluxo' });
    // Os sete estados reais da maquina de estados, sem etapa inventada.
    for (const label of [
      'Rascunho',
      'Preparada',
      'Liberada',
      'Em execução',
      'Pausada',
      'Concluída',
      'Cancelada',
    ]) {
      expect(within(flow).getByText(label)).toBeInTheDocument();
    }

    expect(within(flow).getByText('Em execução')).toHaveAttribute('aria-current', 'step');
    expect(within(flow).getByText('Rascunho')).not.toHaveAttribute('aria-current');
    expect(within(flow).getByText('Liberada')).not.toHaveAttribute('aria-current');
    expect(within(flow).getByText('Pausada')).not.toHaveAttribute('aria-current');
  });

  it('representa a próxima ação vinda do backend, com destino real', async () => {
    /*
     * B5: a próxima ação deixou de ser derivada de um mapa local de status. O caso declara
     * o que o BACKEND oferece para a OS concluída: medir (etapa) e reabrir (ciclo de vida).
     * A ordem da resposta é a prioridade — `complete`/etapa vem antes de `reopen`.
     */
    renderObjectPage(orderDetail(), {
      availableActions: {
        service_order_id: SERVICE_ORDER_ID,
        status_atual: SERVICE_ORDER_STATUSES.Completed,
        comandos_validos: [
          {
            comando: 'complete',
            label: 'Registrar medição',
            requer_permissao: 'service-orders:execution:complete',
            usuario_tem_permissao: true,
          },
        ],
        comandos_invalidos_para_status: ['prepare', 'release'],
      },
    });

    await findHeaderReference();

    const panel = screen.getByRole('region', { name: 'Próxima ação' });
    expect(within(panel).getAllByText('Registrar medição').length).toBeGreaterThan(0);
    expect(within(panel).getByRole('link', { name: 'Registrar medição' })).toHaveAttribute(
      'href',
      `/app/service-orders/${SERVICE_ORDER_ID}/measurement`,
    );

    // O cabecalho oferece a MESMA acao como primaria — e a acao respeita a capability real.
    expect(screen.getByRole('button', { name: 'Registrar medição' })).toBeEnabled();
  });

  it('abre a alocação real (fluxo existente) quando o backend oferece comando de etapa', async () => {
    const user = userEvent.setup();
    renderObjectPage(
      orderDetail({
        status: SERVICE_ORDER_STATUSES.Released,
        controlCenter: controlCenter({
          status: SERVICE_ORDER_STATUSES.Released,
          availableTransitions: ['start', 'cancel'],
        }),
      }),
      {
        planned: [plannedTruck()],
        allocationProbe: 'allowed',
        availableActions: {
          service_order_id: SERVICE_ORDER_ID,
          status_atual: SERVICE_ORDER_STATUSES.Released,
          comandos_validos: [
            // `pause`/`resume`/`complete` são comandos de etapa: a página nomeia o passo
            // (sem link), porque o destino é a própria superfície de execução/medição.
            {
              comando: 'plan',
              label: 'Alocar recursos',
              requer_permissao: 'service-orders:planned-resource:plan',
              usuario_tem_permissao: true,
            },
          ],
          comandos_invalidos_para_status: ['prepare', 'release'],
        },
      },
    );

    await findHeaderReference();

    // Comando de etapa que acontece NESTA página: o painel nomeia sem oferecer link.
    const panel = screen.getByRole('region', { name: 'Próxima ação' });
    expect(within(panel).getAllByText('Alocar recursos').length).toBeGreaterThan(0);
    expect(within(panel).queryByRole('link')).not.toBeInTheDocument();

    const primary = screen.getByRole('button', { name: 'Alocar recursos' });
    await user.click(primary);

    // O mesmo dialogo do fluxo de alocacao ja existente (nenhum fluxo paralelo).
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Alocar recurso físico')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/início operacional/i)).toBeInTheDocument();
  });

  it('não oferece transição de ciclo de vida quando o backend não devolve comando válido', async () => {
    renderObjectPage(
      orderDetail({
        status: SERVICE_ORDER_STATUSES.Draft,
        preparedAt: null,
        releasedAt: null,
        controlCenter: controlCenter({ status: SERVICE_ORDER_STATUSES.Draft }),
      }),
      // O backend não oferece nenhum comando neste estado (ex.: ator sem permissão).
      // A seção "Próxima ação" simplesmente não aparece — o front não inventa um passo.
    );

    await findHeaderReference();

    expect(screen.queryByRole('region', { name: 'Próxima ação' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preparar OS' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preparar' })).not.toBeInTheDocument();
  });

  it('leva a transição de ciclo de vida confirmada para o recorte REAL da lista', async () => {
    renderObjectPage(
      orderDetail({
        status: SERVICE_ORDER_STATUSES.Prepared,
        releasedAt: null,
        controlCenter: controlCenter({
          status: SERVICE_ORDER_STATUSES.Prepared,
          availableTransitions: ['release', 'cancel'],
        }),
      }),
      {
        // B5: o comando e o rótulo vêm do backend; o front só escolhe a superfície.
        availableActions: {
          service_order_id: SERVICE_ORDER_ID,
          status_atual: SERVICE_ORDER_STATUSES.Prepared,
          comandos_validos: [
            {
              comando: 'release',
              label: 'Liberar',
              requer_permissao: 'service-orders:service-order:release',
              usuario_tem_permissao: true,
            },
          ],
          comandos_invalidos_para_status: ['prepare', 'start'],
        },
      },
    );

    await findHeaderReference();

    const panel = screen.getByRole('region', { name: 'Próxima ação' });
    expect(within(panel).getByRole('link', { name: 'Liberar' })).toHaveAttribute(
      'href',
      `/app/service-orders?q=${ORDER_NUMBER}`,
    );
  });

  it('omite por inteiro a relação não autorizada e mantém a autorizada com contagem real', async () => {
    renderObjectPage(
      orderDetail({
        // Backend mascarou medicao e faturamento: sem autorizacao no modulo dono.
        controlCenter: controlCenter({
          status: SERVICE_ORDER_STATUSES.Completed,
          executionEntries: 2,
        }),
      }),
    );

    await findHeaderReference();

    const relations = await screen.findByRole('region', { name: 'Relações' });
    await waitFor(() => {
      expect(within(relations).getByRole('link', { name: /Execuções/ })).toBeInTheDocument();
    });

    // Execucoes: contagem real e destino real.
    const executions = within(relations).getByRole('link', { name: /Execuções/ });
    expect(executions).toHaveAttribute(
      'href',
      `/app/service-orders/${SERVICE_ORDER_ID}/execution`,
    );
    expect(executions.textContent).toContain('2');

    // Medições/Faturamento: NADA — nem rotulo, nem contagem, nem "oculto".
    expect(within(relations).getAllByRole('link')).toHaveLength(1);
    expect(within(relations).queryByText('Medições')).not.toBeInTheDocument();
    expect(within(relations).queryByText('Medição')).not.toBeInTheDocument();
    expect(within(relations).queryByText('Faturamento')).not.toBeInTheDocument();
    expect(screen.queryByText(/oculto/i)).not.toBeInTheDocument();
  });

  it('mostra medição e faturamento quando o backend autoriza os blocos, com a contagem real', async () => {
    renderObjectPage(
      orderDetail({
        controlCenter: controlCenter({
          status: SERVICE_ORDER_STATUSES.Completed,
          executionEntries: 2,
          measurement: { count: 1, status: 'APPROVED', createdAt: '2026-01-03T09:00:00.000Z' },
          billing: {
            count: 1,
            status: 'PREPARED',
            createdAt: '2026-01-04T09:00:00.000Z',
            totalAmount: '15000.0000',
            currencyCode: 'BRL',
          },
        }),
      }),
    );

    await findHeaderReference();

    const relations = await screen.findByRole('region', { name: 'Relações' });
    await waitFor(() => {
      expect(within(relations).getByRole('link', { name: /Medições/ })).toBeInTheDocument();
    });

    const measurements = within(relations).getByRole('link', { name: /Medições/ });
    expect(measurements).toHaveAttribute(
      'href',
      `/app/service-orders/${SERVICE_ORDER_ID}/measurement`,
    );
    expect(measurements.textContent).toContain('1');

    const billing = within(relations).getByRole('link', { name: /Faturamento/ });
    expect(billing).toHaveAttribute('href', `/app/service-orders/${SERVICE_ORDER_ID}/billing`);
    expect(billing.textContent).toContain('1');
  });

  it('mostra no histórico somente fato persistido, com estado anterior e novo reais', async () => {
    renderObjectPage(
      orderDetail({
        historyEvents: [
          {
            id: 'ev-1',
            eventType: 'CREATED',
            payload: { origin: 'SERVICE_REQUEST' },
            actorIdentityId: ACTOR_ID,
            occurredAt: '2026-01-02T07:00:00.000Z',
          },
          {
            id: 'ev-2',
            eventType: 'RELEASED',
            payload: { fromStatus: 'PREPARED', toStatus: 'RELEASED' },
            actorIdentityId: ACTOR_ID,
            occurredAt: '2026-01-02T09:00:00.000Z',
          },
          {
            id: 'ev-3',
            eventType: 'RESOURCE_ALLOCATED',
            payload: {
              resourceTypeCode: 'TRUCK',
              operationalStart: '2026-01-05T08:00:00.000Z',
              operationalEnd: '2026-01-05T12:00:00.000Z',
            },
            actorIdentityId: ACTOR_ID,
            occurredAt: '2026-01-03T09:00:00.000Z',
          },
        ],
      }),
    );

    await findHeaderReference();

    const history = await screen.findByRole('region', { name: 'Histórico' });
    await waitFor(() => {
      expect(within(history).getByText('OS criada')).toBeInTheDocument();
    });

    expect(within(history).getByText('OS liberada')).toBeInTheDocument();
    expect(within(history).getByText('Recurso alocado')).toBeInTheDocument();
    // Transicao persistida: estado anterior -> novo, ambos reais.
    expect(within(history).getByText('Preparada')).toBeInTheDocument();
    expect(within(history).getByText('Liberada')).toBeInTheDocument();

    // Fato mais recente primeiro, pela trilha persistida.
    const items = within(history).getAllByRole('listitem');
    expect(items[0]?.textContent).toContain('Recurso alocado');
    expect(items[2]?.textContent).toContain('OS criada');

    // Nenhum evento inventado e nenhum ator tecnico virando "autor".
    expect(within(history).queryByText(/execução iniciada/i)).not.toBeInTheDocument();
    expect(history.textContent).not.toContain(ACTOR_ID);
    expect(within(history).queryByText(/sistema/i)).not.toBeInTheDocument();
  });
});
