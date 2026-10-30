import { screen, waitFor, within } from '@testing-library/react';
import * as operationalUnitHooks from '../../shell/hooks/useOperationalUnits';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render-with-providers';
import { OperationsDispatchWorkspacePage } from './OperationsDispatchWorkspacePage';
import { OperationsApiError, checkInServiceOrder, getServiceOrderOverview, listOperationUnitOptions } from '../api/operations-api';
import type { ServiceOrderOverview } from '../types/operations.types';

vi.mock('../api/operations-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api/operations-api')>();
  return { ...real, listOperationUnitOptions: vi.fn(), getServiceOrderOverview: vi.fn(), checkInServiceOrder: vi.fn() };
});
vi.mock('../components/OperationalUnitGovernance', () => ({
  OperationalUnitGovernance: () => null,
}));
vi.mock('./DispatchBoardPage', () => ({
  DispatchBoardPage: ({ unitId, onSelectOrder }: { unitId: string | null; onSelectOrder?: (id: string) => void }) =>
    <div data-testid="dispatch-active-unit">{unitId}<button type="button" onClick={() => onSelectOrder?.('os-1')}>Selecionar OS</button></div>,
}));
vi.mock('./ExecutionConsolePage', () => ({
  ExecutionConsolePage: ({ unitId }: { unitId: string | null }) =>
    <div data-testid="execution-active-unit">{unitId}</div>,
}));

vi.mock('./ServiceOrderPlanningPage', () => ({
  ServiceOrderPlanningPage: ({ embeddedServiceOrderId }: { embeddedServiceOrderId?: string }) => <div data-testid="station-planning">{embeddedServiceOrderId}</div>,
}));
vi.mock('./ServiceOrderExecutionPage', () => ({
  ServiceOrderExecutionPage: ({ embeddedServiceOrderId }: { embeddedServiceOrderId?: string }) => <div data-testid="station-execution">{embeddedServiceOrderId}</div>,
}));
vi.mock('./MeasurementWorkbenchPage', () => ({
  MeasurementWorkbenchPage: ({ embeddedServiceOrderId, embeddedUnitId }: { embeddedServiceOrderId?: string; embeddedUnitId?: string }) => <div data-testid="station-measurement">{embeddedUnitId}:{embeddedServiceOrderId}</div>,
}));
vi.mock('../../business-chain', () => ({
  BusinessChain: () => <div data-testid="station-chain" />,
  useBusinessChain: () => ({ chain: null, phase: 'idle', message: null, retry: vi.fn() }),
}));

function stationOverview(): ServiceOrderOverview {
  return {
    identity: {
      serviceOrderId: 'os-1', unitId: 'unit-a', orderNumber: 'OS-001',
      internalCode: null, serviceLabel: 'Serviço contratado', clientLabel: 'Cliente Alfa',
      description: null, rowVersion: 7,
    },
    businessContext: {
      origin: null, contractReference: 'CT-001',
      customerPurchaseOrderNumber: null, priority: null,
    },
    statuses: {
      operational: 'RELEASED', planning: 'READY', reservation: 'READY',
      dispatch: 'READY', execution: 'PENDING', actuals: 'PENDING',
      measurement: 'PENDING', billing: 'PENDING', accounting: 'PENDING',
    },
    process: [],
    currentStage: 'DISPATCH',
    planning: { plannedResourceCount: 1, activeAllocationCount: 1, activeResources: [] },
    dispatch: {
      dispatchedAt: null, checkedInAt: null, windowStart: null, windowEnd: null,
      readiness: {
        ready: true, status: 'READY', blockingReasons: [], warnings: [],
        dimensions: [], nextAction: null, summary: 'Pronta',
      },
    },
    execution: {
      startedAt: null, pausedAt: null, completedAt: null,
      executionClosedAt: null, measurementBasisPreparedAt: null,
    },
    actuals: {
      comparison: { lines: [], substitutions: [], recordCount: 0, hasActuals: false, summary: 'Sem apontamentos' },
      records: [], meters: [], fuel: [], evidence: [], signatures: [],
    },
    completionGate: {
      canComplete: false, blockingReasons: [], nextAction: null,
      nextActionLabel: null, consequences: [], summary: 'Não elegível',
    },
    economics: { plannedRevenue: null, plannedCost: null, currencyCode: null },
    situations: [],
    timeline: [],
    nextAction: { code: 'CHECK_IN', label: 'Check-in', explanation: null },
    availableCommands: [{
      code: 'CHECK_IN', label: 'Registrar chegada', enabled: true,
      reasons: [], reasonLabels: [], nextAction: null,
      requiredPermission: 'operations:check-in', route: '/app/operations',
    }],
    decisionExplanation: { completionSummary: '', onCompletion: [], dispatchSummary: '' },
    freshness: { readAt: '2026-10-29T20:00:00.000Z', authority: 'SERVER' },
  };
}

function mount(initialPath = '/app/operations/dispatch') {
  return renderWithProviders(
    <Routes>
      <Route path="/app/operations/dispatch" element={<OperationsDispatchWorkspacePage />} />
    </Routes>,
    { router: { initialEntries: [initialPath] } },
  );
}

describe('Enterprise dispatch unit discovery', () => {
  beforeEach(() => { vi.mocked(listOperationUnitOptions).mockReset(); vi.mocked(getServiceOrderOverview).mockReset(); vi.mocked(checkInServiceOrder).mockReset(); });

  it('shows authorized names/codes without service orders and preserves the internal contract value', async () => {
    vi.mocked(listOperationUnitOptions).mockResolvedValue({
      items: ['unit-a', 'unit-b'],
      details: [
        { id: 'unit-a', code: 'PVH', name: 'Porto Velho', configured: true },
        { id: 'unit-b', code: 'GUA', name: 'Guajará-Mirim', configured: true },
      ],
    });
    mount();
    const select = await screen.findByRole('combobox', { name: 'Unidade operacional' });
    const choices = within(select).getAllByRole('option');
    expect(choices.map(option => option.textContent)).toEqual(['Porto Velho · PVH', 'Guajará-Mirim · GUA']);
    expect(choices.map(option => (option as HTMLOptionElement).value)).toEqual(['unit-a', 'unit-b']);
    expect(screen.getByTestId('dispatch-active-unit')).toHaveTextContent('unit-a');
    await userEvent.setup().selectOptions(select, 'unit-b');
    expect(screen.getByTestId('dispatch-active-unit')).toHaveTextContent('unit-b');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Execução' }));
    expect(screen.getByTestId('execution-active-unit')).toHaveTextContent('unit-b');
  });


  it('restores authorized unit and selected OS after deep link navigation', async () => {
    vi.mocked(listOperationUnitOptions).mockResolvedValue({
      items: ['unit-a', 'unit-b'],
      details: [
        { id: 'unit-a', code: 'PVH', name: 'Porto Velho', configured: true },
        { id: 'unit-b', code: 'GUA', name: 'Guajará-Mirim', configured: true },
      ],
    });
    const base = stationOverview();
    vi.mocked(getServiceOrderOverview).mockResolvedValue({ ...base, identity: { ...base.identity, unitId: 'unit-b' } });
    mount('/app/operations/dispatch?unitId=unit-b&serviceOrderId=os-1&focus=planning');
    expect(await screen.findByTestId('station-planning')).toHaveTextContent('os-1');
    expect(screen.getByRole('combobox', { name: 'Unidade operacional' })).toHaveValue('unit-b');
    expect(screen.getByTestId('dispatch-active-unit')).toHaveTextContent('unit-b');
    expect(getServiceOrderOverview).toHaveBeenCalledWith('os-1', expect.any(AbortSignal));
  });

  it('fails closed for a unit outside the authenticated directory before loading the OS', async () => {
    vi.mocked(listOperationUnitOptions).mockResolvedValue({
      items: ['unit-a'],
      details: [{ id: 'unit-a', code: 'PVH', name: 'Porto Velho', configured: true }],
    });
    mount('/app/operations/dispatch?unitId=unit-foreign&serviceOrderId=os-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('fora do escopo autorizado');
    expect(getServiceOrderOverview).not.toHaveBeenCalled();
    expect(screen.queryByTestId('station-planning')).not.toBeInTheDocument();
  });

  it('keeps the authorized OS and unit while switching between real processing surfaces', async () => {
    vi.mocked(listOperationUnitOptions).mockResolvedValue({
      items: ['unit-a'],
      details: [{ id: 'unit-a', code: 'PVH', name: 'Porto Velho', configured: true }],
    });
    vi.mocked(getServiceOrderOverview).mockResolvedValue(stationOverview());
    mount();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Selecionar OS' }));
    expect(await screen.findByTestId('station-planning')).toHaveTextContent('os-1');
    expect(screen.getByTestId('dispatch-active-unit')).toHaveTextContent('unit-a');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Executar e apontar' }));
    expect(screen.getByTestId('station-execution')).toHaveTextContent('os-1');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Medir e aceitar' }));
    expect(screen.getByTestId('station-measurement')).toHaveTextContent('unit-a:os-1');
    expect(screen.getByTestId('dispatch-active-unit')).toHaveTextContent('unit-a');
    expect(screen.getByTestId('station-chain')).toBeInTheDocument();
  });

  it('does not change the idempotency key or rowVersion when retrying uncertain check-in', async () => {
    vi.mocked(listOperationUnitOptions).mockResolvedValue({
      items: ['unit-a'],
      details: [{ id: 'unit-a', code: 'PVH', name: 'Porto Velho', configured: true }],
    });
    const overview = stationOverview();
    vi.mocked(getServiceOrderOverview).mockResolvedValue(overview);
    vi.mocked(checkInServiceOrder).mockRejectedValueOnce(new OperationsApiError(0, undefined, 'network')).mockResolvedValueOnce(overview);
    mount();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Selecionar OS' }));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Registrar chegada' }));
    const retry = await screen.findByRole('button', { name: 'Reenviar check-in com a mesma intenção' });
    await waitFor(() => expect(retry).not.toBeDisabled());
    await userEvent.setup().click(retry);
    await waitFor(() => expect(checkInServiceOrder).toHaveBeenCalledTimes(2));
    expect(vi.mocked(checkInServiceOrder).mock.calls[0]?.[1]).toEqual(vi.mocked(checkInServiceOrder).mock.calls[1]?.[1]);
  });

  it('reports HTTP 409 and reloads without silently repeating the mutation', async () => {
    vi.mocked(listOperationUnitOptions).mockResolvedValue({
      items: ['unit-a'],
      details: [{ id: 'unit-a', code: 'PVH', name: 'Porto Velho', configured: true }],
    });
    vi.mocked(getServiceOrderOverview).mockResolvedValue(stationOverview());
    vi.mocked(checkInServiceOrder).mockRejectedValueOnce(new OperationsApiError(409, 'SERVICE_ORDERS_VERSION_CONFLICT', 'version_conflict'));
    mount();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Selecionar OS' }));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Registrar chegada' }));
    await screen.findByText(/Conflito de versão/);
    expect(checkInServiceOrder).toHaveBeenCalledTimes(1);
  });

  it('separates absence of authorization from absence of operational orders', async () => {
    vi.mocked(listOperationUnitOptions).mockResolvedValue({ items: [], details: [] });
    mount();
    expect(await screen.findByText('Nenhuma unidade autorizada para consulta')).toBeInTheDocument();
    expect(screen.queryByTestId('dispatch-active-unit')).not.toBeInTheDocument();
  });

  it('never maps access denied into a blank worklist', async () => {
    // The page must render denied distinctly from an empty authorized scope.
    // Test the presentation state directly; async loader failures are covered by
    // the operational-unit hook tests, avoiding an unhandled rejection in harness.
    const hook = vi.spyOn(operationalUnitHooks, 'useOperationalUnits').mockReturnValue({
      units: [], options: [], unitId: '', setUnitId: vi.fn(),
      status: 'error',
      error: new OperationsApiError(403, 'SERVICE_ORDERS_DENIED', 'denied'),
      reload: vi.fn(),
    });
    try {
      mount();
      expect(await screen.findByRole('alert')).toHaveTextContent('Acesso negado');
      expect(screen.queryByText('Nenhuma unidade autorizada para consulta')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
    } finally {
      hook.mockRestore();
    }
  });

  it('distinguishes offline failure and allows retry without dropping capabilities on a narrow viewport', async () => {
    vi.mocked(listOperationUnitOptions)
      .mockRejectedValueOnce(new OperationsApiError(0, undefined, 'network'))
      .mockResolvedValueOnce({
        items: ['unit-a'],
        details: [{ id: 'unit-a', code: 'PVH', name: 'Porto Velho', configured: true }],
      });
    const oldWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    try {
      mount();
      expect(await screen.findByRole('alert')).toHaveTextContent('indisponível');
      await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar novamente' }));
      await waitFor(() => expect(screen.getByTestId('dispatch-active-unit')).toHaveTextContent('unit-a'));
      expect(screen.getByRole('combobox', { name: 'Unidade operacional' })).toHaveValue('unit-a');
      expect(screen.getByRole('button', { name: 'Execução' })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: oldWidth });
    }
  });
});
