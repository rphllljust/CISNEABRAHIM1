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
    expect(screen.getByText('VEHICLE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Custos e faturamento' }));
    expect(screen.getAllByText(/R\$\s?300,00/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Documentos e auditoria' }));
    expect(screen.getByText('CREATED')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OS-2026-22' })).toBeInTheDocument();
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
    expect(screen.getByText(/O domínio não respondeu/)).toBeInTheDocument();
    expect(screen.queryByText(/R\$\s?0,00/)).not.toBeInTheDocument();
  });

  it('uses the authoritative rowVersion on prepare, then reloads the composite read', async () => {
    let reads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/prepare')) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ rowVersion: 2 });
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

  it('does not mislabel invalid money/currency values as a legitimate zero', () => {
    expect(workbenchMoney(null, 'BRL')).toBe('Não publicado');
    expect(workbenchMoney('100.50', 'BRL')).toMatch(/100,50/);
    expect(workbenchMoney('invalid', 'BRL')).toBe('Não publicado');
  });
});
