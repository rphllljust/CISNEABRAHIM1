import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import type { ServiceOrderEnterpriseWorkbench } from '../types/service-order-enterprise-workbench.types';
import { ServiceOrderEnterpriseWorkbenchPage, workbenchMoney } from './ServiceOrderEnterpriseWorkbenchPage';

const ID = 'a1a1a1a1-1111-4111-8111-a1a1a1a1a1a1';

function snapshot(version = 2): ServiceOrderEnterpriseWorkbench {
  return {
    asOf: '2026-11-04T13:00:00.000Z',
    actions: { canPlanResource: false, canRecordEstimatedCost: false, canRecordActualCost: false },
    serviceOrder: {
      id: ID, internalCode: 'OS-INT-22', orderNumber: 'OS-2026-22',
      unitId: 'unit-operacional', status: version === 2 ? 'DRAFT' : 'PREPARED',
      origin: 'AUTHORIZED_DIRECT', clientId: null, contractId: null,
      clientSnapshot: { legalName: 'Empresa Real' }, serviceDefinitionId: null,
      serviceDefinitionVersionId: null, description: 'Transporte',
      rowVersion: version, preparedAt: null, releasedAt: null, cancelledAt: null,
      historyEvents: [{ id: 'evt-1', eventType: 'CREATED', payload: {}, actorIdentityId: null, occurredAt: '2026-11-04T12:00:00Z' }],
      serviceSnapshot: {
        serviceCode: 'TR-01', serviceName: 'Transporte',
        requirements: {
          resources: [{ physicalResourceTypeCode: 'VEHICLE', requirementLevel: 'REQUIRED', minQuantity: '1', sortOrder: 0 }],
          labor: [], execution: [],
        },
      },
      controlCenter: {
        progression: [{ code: 'DEMAND', state: 'DONE', at: '2026-11-04T12:00:00Z', detail: null, ownerStatus: 'DRAFT' }],
        plannedVsActual: { plannedResources: 1, activeAllocations: 0, executionEntries: 0, executedQuantityTotal: null, divergences: [] },
        downstream: {
          measurement: { count: 0, status: null, createdAt: null },
          billing: { count: 0, status: null, createdAt: null, totalAmount: null, currencyCode: null },
        },
        nextAction: { step: version === 2 ? 'PREPARE' : 'RELEASE', transition: null, blockers: [], availableTransitions: version === 2 ? ['prepare'] : ['release'] },
      },
    },
    plannedResources: {
      state: 'ready',
      data: [{
        id: 'plan-1', serviceOrderId: ID, requirementKind: 'PHYSICAL_RESOURCE',
        resourceTypeCode: 'VEHICLE', laborTypeCode: null,
        plannedQuantity: '1', operationalStart: null, operationalEnd: null,
        notes: null, status: 'PLANNED', rowVersion: 1,
      }],
    },
    allocations: {
      state: 'ready',
      data: [{
        id: 'allocation-1', serviceOrderId: ID, plannedResourceId: 'plan-1',
        physicalAssetId: null, workforceMemberId: null, resourceTypeCode: 'VEHICLE',
        operationalStart: '2026-11-04T09:00:00.000Z', operationalEnd: '2026-11-04T11:00:00.000Z',
        status: 'ACTIVE', rowVersion: 1, allocatedAt: '2026-11-04T08:00:00.000Z', removedAt: null,
      }],
    },
    costs: {
      state: 'ready',
      data: {
        serviceOrderId: ID, rowVersion: version, entries: [],
        summary: {
          capturedAt: '2026-11-04T13:00:00.000Z', currencyCode: 'BRL',
          revenue: '1000.00', totalEstimatedCost: '400.00', totalActualCost: '300.00',
          estimatedMargin: '600.00', actualMargin: '700.00',
          estimatedToActualVariance: '100.00', estimatedToActualVariancePercent: '25.00',
          blockingReasons: [], disclaimer: 'Somente evidência autorizada', lines: [],
        },
      },
    },
    chain: {
      state: 'ready',
      data: {
        anchor: { kind: 'SERVICE_ORDER', id: ID },
        milestones: [],
        nodes: [{ kind: 'SERVICE_ORDER', id: ID, businessReference: 'OS-2026-22',
          status: 'DRAFT', occurredAt: '2026-11-04T12:00:00Z', route: '/app/service-orders/' + ID,
          relation: 'ROOT', summary: 'Transporte', unitId: 'unit-operacional', clientId: null }],
      },
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}


function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function requestJsonBody(init?: RequestInit): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
  const payload: unknown = JSON.parse(init.body);
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Expected a JSON object');
  }
  return payload as Record<string, unknown>;
}

function openPage() {
  return render(
    <MemoryRouter initialEntries={['/app/service-orders/' + ID + '/workbench']}>
      <Routes>
        <Route path="/app/service-orders/:serviceOrderId/workbench" element={<ServiceOrderEnterpriseWorkbenchPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Integrated Service Order Workbench — UI + NestJS contract', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('test-access-token', 'test-refresh-token');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders a real multi-step business workbench and authorized resource/cost/evidence zones', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(snapshot()));
    vi.stubGlobal('fetch', fetchMock);
    openPage();
    expect(await screen.findByRole('heading', { name: /Bancada empresarial.*OS-2026-22/ })).toBeInTheDocument();
    expect(screen.getByText('Empresa Real', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preparar OS' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Recursos e requisitos' }));
    expect(screen.getAllByText('VEHICLE').length).toBeGreaterThan(0);
    expect(screen.getByText('Alocações operacionais persistidas')).toBeInTheDocument();
    expect(screen.getByText('PLANNED')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Custos e faturamento' }));
    expect(screen.getAllByText(/R\$\s?300,00/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Documentos e auditoria' }));
    expect(screen.getByText('CREATED')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'OS-2026-22' }).length).toBeGreaterThan(0);
    expect(String(fetchMock.mock.calls.length)).toBe('1');
  });

  it('keeps denied or unavailable economic readers distinct from a false zero', async () => {
    const data = snapshot();
    data.costs = { state: 'denied' };
    data.chain = { state: 'unavailable' };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(data)));
    openPage();
    await screen.findByRole('heading', { name: /Bancada empresarial/ });
    expect(screen.getByText(/O domínio não autorizou esta leitura/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Documentos e auditoria' }));
    expect(screen.getAllByText(/O domínio não respondeu/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/R\$\s?0,00/)).not.toBeInTheDocument();
  });

  it('uses the authoritative rowVersion on prepare, then reloads the composite read', async () => {
    let reads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestUrl(input);
      if (path.endsWith('/prepare')) {
        expect(init?.method).toBe('POST');
        expect(requestJsonBody(init)).toEqual({ rowVersion: 2 });
        return jsonResponse({ status: 'PREPARED', rowVersion: 3 });
      }
      reads += 1;
      return jsonResponse(snapshot(reads === 1 ? 2 : 3));
    });
    vi.stubGlobal('fetch', fetchMock);
    openPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Preparar OS' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Liberar OS' })).toBeInTheDocument());
    expect(screen.getByText('Versão 3')).toBeInTheDocument();
    expect(reads).toBe(2);
  });

  it('does not execute a hidden transition when capabilities do not publish it', async () => {
    const data = snapshot();
    data.serviceOrder.controlCenter!.nextAction.availableTransitions = [];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(data)));
    openPage();
    await screen.findByRole('heading', { name: /Bancada empresarial/ });
    expect(screen.queryByRole('button', { name: 'Preparar OS' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Liberar OS' })).not.toBeInTheDocument();
  });

  it('sends a real planned resource to NestJS and reconsults the integrated workbench', async () => {
    const data = snapshot();
    data.serviceOrder.status = 'RELEASED';
    data.actions.canPlanResource = true;
    let plans = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestUrl(input);
      if (path.endsWith('/planned-resources') && init?.method === 'POST') {
        plans++;
        expect(requestJsonBody(init)).toMatchObject({
          requirementKind: 'PHYSICAL_RESOURCE', resourceTypeCode: 'VEHICLE',
          plannedQuantity: '2',
        });
        return jsonResponse({ id: 'new-plan', status: 'PLANNED' }, 201);
      }
      return jsonResponse(data);
    });
    vi.stubGlobal('fetch', fetchMock);
    openPage();
    await screen.findByRole('heading', { name: /Bancada empresarial/ });
    fireEvent.click(screen.getByRole('tab', { name: 'Recursos e requisitos' }));
    expect(screen.getByRole('button', { name: 'Salvar recurso planejado' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Requisito do serviço'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Quantidade planejada'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar recurso planejado' }));
    await waitFor(() => expect(plans).toBe(1));
    await screen.findByText(/Recurso planejado e registrado com auditoria/);
    expect(fetchMock.mock.calls.length).toBe(3);
  });

  it('records cost as real money with version + idempotency, then reloads economic position', async () => {
    const data = snapshot();
    data.serviceOrder.status = 'RELEASED';
    data.actions.canRecordEstimatedCost = true;
    let written = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestUrl(input);
      if (path.endsWith('/operational-costs') && init?.method === 'POST') {
        written++;
        const payload = requestJsonBody(init);
        expect(payload).toMatchObject({
          origin: 'SERVICE_ORDER', category: 'RESOURCE', costKind: 'ESTIMATED',
          amount: '125.50', currencyCode: 'BRL', rowVersion: 2,
          description: 'Combustível para execução',
        });
        expect(typeof payload.idempotencyKey).toBe('string');
        if (typeof payload.idempotencyKey !== 'string') throw new Error('Missing idempotency key');
        expect(payload.idempotencyKey.length).toBeGreaterThan(10);
        return jsonResponse({ rowVersion: 3 }, 201);
      }
      return jsonResponse(data);
    });
    vi.stubGlobal('fetch', fetchMock);
    openPage();
    await screen.findByRole('heading', { name: /Bancada empresarial/ });
    fireEvent.click(screen.getByRole('tab', { name: 'Custos e faturamento' }));
    fireEvent.change(screen.getByLabelText('Valor monetário'), { target: { value: '125,50' } });
    fireEvent.change(screen.getByLabelText('Descrição e origem do lançamento'), { target: { value: 'Combustível para execução' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar custo no livro operacional' }));
    await waitFor(() => expect(written).toBe(1));
    await screen.findByText(/Custo operacional registrado e posição econômica reconsultada/);
    expect(fetchMock.mock.calls.length).toBe(3);
  });

  it('does not mislabel invalid money/currency values as a legitimate zero', () => {
    expect(workbenchMoney(null, 'BRL')).toBe('Não publicado');
    expect(workbenchMoney('', 'BRL')).toBe('Não publicado');
    expect(workbenchMoney('   ', 'BRL')).toBe('Não publicado');
    expect(workbenchMoney('1e3', 'BRL')).toBe('Não publicado');
    expect(workbenchMoney('0x10', 'BRL')).toBe('Não publicado');
    expect(workbenchMoney('100.50', 'BRL')).toMatch(/100,50/);
    expect(workbenchMoney('0.0000', 'BRL')).toMatch(/0,00/);
    expect(workbenchMoney('invalid', 'BRL')).toBe('Não publicado');
  });
});
