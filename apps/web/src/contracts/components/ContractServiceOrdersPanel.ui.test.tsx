import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContractServiceOrdersPanel } from './ContractServiceOrdersPanel';
import {
  listServiceOrders,
  ServiceOrdersApiError,
  type ServiceOrderSummary,
} from '../../service-orders/api/service-orders-api';

vi.mock('../../service-orders/api/service-orders-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../service-orders/api/service-orders-api')>();
  return { ...real, listServiceOrders: vi.fn() };
});

const CONTRACT_A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const CONTRACT_A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const OS_A1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

function response(items: Array<Partial<ServiceOrderSummary>>, total?: number, hasMore?: boolean) {
  return {
    items: items as ServiceOrderSummary[],
    limit: 5,
    offset: 0,
    ...(total !== undefined ? { total } : {}),
    ...(hasMore !== undefined ? { hasMore } : {}),
  };
}

function renderPanel(id = CONTRACT_A1) {
  return render(
    <MemoryRouter>
      <ContractServiceOrdersPanel contractId={id} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('Contract 360 — OS vinculadas por contrato autoritativo', () => {
  it('exibe apenas os registros do endpoint filtrado e permite navegar para a OS e sua carteira', async () => {
    vi.mocked(listServiceOrders).mockResolvedValue(response([
      { id: OS_A1, orderNumber: 'OS-A1', internalCode: 'SO-INT-A1', unitId: 'UNIT-A', status: 'COMPLETED', deadlineAt: null },
    ], 1, false));
    renderPanel();
    const table = await screen.findByRole('table', { name: 'Ordens vinculadas ao contrato' });
    expect(within(table).getByRole('link', { name: 'OS-A1' })).toHaveAttribute('href', `/app/service-orders/${OS_A1}`);
    expect(await screen.findByText('1 ordem vinculada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver carteira deste contrato' })).toHaveAttribute(
      'href', `/app/service-orders?contractId=${CONTRACT_A1}`,
    );
    expect(listServiceOrders).toHaveBeenCalledWith(
      { contractId: CONTRACT_A1, limit: 5, offset: 0 },
      expect.any(AbortSignal),
    );
  });

  it('não inventa total para página parcial e não transforma página incompleta em zero', async () => {
    vi.mocked(listServiceOrders).mockResolvedValue(response([
      { id: OS_A1, orderNumber: 'OS-A1', internalCode: 'SO-INT-A1', unitId: 'UNIT-A', status: 'DRAFT', deadlineAt: null },
    ], undefined, true));
    renderPanel();
    await screen.findByRole('table', { name: 'Ordens vinculadas ao contrato' });
    expect(screen.getByText('Total não publicado pelo servidor.')).toBeInTheDocument();
    expect(screen.getByText('Há outras ordens nesta carteira.')).toBeInTheDocument();
    expect(screen.queryByText('1 ordem vinculada')).not.toBeInTheDocument();
  });

  it('distingue sem registro de acesso negado, sem sugerir que 403 significa zero', async () => {
    vi.mocked(listServiceOrders).mockResolvedValueOnce(response([], 0, false));
    const first = renderPanel();
    expect(await screen.findByText('Nenhuma ordem vinculada a este contrato no escopo autorizado.')).toBeInTheDocument();
    first.unmount();
    vi.mocked(listServiceOrders).mockRejectedValueOnce(new ServiceOrdersApiError(403, undefined, 'denied'));
    renderPanel();
    expect(await screen.findByText('Sem permissão para consultar as ordens vinculadas.')).toBeInTheDocument();
    expect(screen.queryByText(/0 ordens vinculadas/i)).not.toBeInTheDocument();
  });

  it('5xx apresenta falha recuperável, nunca uma carteira vazia', async () => {
    const user = userEvent.setup();
    vi.mocked(listServiceOrders)
      .mockRejectedValueOnce(new ServiceOrdersApiError(500, undefined, 'unknown'))
      .mockResolvedValueOnce(response([], 0, false));
    renderPanel();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível consultar as ordens vinculadas.');
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(listServiceOrders).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Nenhuma ordem vinculada a este contrato no escopo autorizado.')).toBeInTheDocument();
  });

  it('troca de contrato cancela leitura anterior e usa o novo ID sem herdar a carteira', async () => {
    let resolveOld: ((value: ReturnType<typeof response>) => void) | undefined;
    vi.mocked(listServiceOrders)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(response([], 0, false));
    const wrapper = renderPanel(CONTRACT_A1);
    wrapper.rerender(
      <MemoryRouter>
        <ContractServiceOrdersPanel contractId={CONTRACT_A2} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Nenhuma ordem vinculada a este contrato no escopo autorizado.')).toBeInTheDocument();
    resolveOld?.(response([{ id: OS_A1, orderNumber: 'OS-A1' }], 1, false));
    await waitFor(() => expect(screen.queryByText('OS-A1')).not.toBeInTheDocument());
    expect(listServiceOrders).toHaveBeenCalledWith(
      { contractId: CONTRACT_A2, limit: 5, offset: 0 }, expect.any(AbortSignal),
    );
  });
});
