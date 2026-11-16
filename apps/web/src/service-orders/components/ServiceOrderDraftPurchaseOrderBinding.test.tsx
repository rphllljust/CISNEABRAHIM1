import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceOrdersApiError, linkPurchaseOrderToDraftOrder } from '../api/service-orders-api';
import { ServiceOrderDraftPurchaseOrderBinding } from './ServiceOrderDraftPurchaseOrderBinding';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const PO_ID = '55555555-5555-4555-8555-555555555555';

vi.mock('../api/service-orders-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/service-orders-api')>()),
  linkPurchaseOrderToDraftOrder: vi.fn(),
}));
vi.mock('../utils/service-order-relation-lookup', () => ({
  searchPurchaseOrdersForLookup: vi.fn(async () => [
    { id: PO_ID, label: 'PO-2026-0088', support: 'RC 0012' },
  ]),
}));

function setup(requiredByCatalog = true) {
  const onUpdated = vi.fn(async () => {});
  render(
    <MemoryRouter>
      <ServiceOrderDraftPurchaseOrderBinding serviceOrderId={ORDER_ID}
        rowVersion={7} requiredByCatalog={requiredByCatalog} onUpdated={onUpdated} />
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), onUpdated };
}
async function selectOrder(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Vincular pedido de compra' }));
  const select = screen.getByTestId<HTMLSelectElement>('so-draft-purchase-order-select');
  await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
  await user.selectOptions(select, PO_ID);
}
beforeEach(() => vi.clearAllMocks());

describe('PO vinculável apenas por ação explícita em OS DRAFT', () => {
  it('declara a exigência do catálogo sem modificar registro', () => {
    setup();
    expect(screen.getByText(/serviço publicado exige pedido de compra/i)).toBeInTheDocument();
    expect(linkPurchaseOrderToDraftOrder).not.toHaveBeenCalled();
  });
  it('não cria pedido fictício ao selecionar uma opção', async () => {
    const { user } = setup(false);
    await selectOrder(user);
    expect(linkPurchaseOrderToDraftOrder).not.toHaveBeenCalled();
  });
  it('confirma PO existente com versão e relê a OS', async () => {
    vi.mocked(linkPurchaseOrderToDraftOrder).mockResolvedValue({} as Awaited<ReturnType<typeof linkPurchaseOrderToDraftOrder>>);
    const { user, onUpdated } = setup();
    await selectOrder(user);
    await user.click(screen.getByRole('button', { name: /^Confirmar pedido$/ }));
    await waitFor(() => expect(linkPurchaseOrderToDraftOrder).toHaveBeenCalledWith(ORDER_ID, 7, PO_ID));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
  });
  it('propaga 409 sem retentar nem informar sucesso', async () => {
    vi.mocked(linkPurchaseOrderToDraftOrder).mockRejectedValue(
      new ServiceOrdersApiError(409, 'SERVICE_ORDERS_VERSION_CONFLICT', 'version_conflict'),
    );
    const { user, onUpdated } = setup();
    await selectOrder(user);
    await user.click(screen.getByRole('button', { name: /^Confirmar pedido$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 409');
    expect(onUpdated).not.toHaveBeenCalled();
    expect(linkPurchaseOrderToDraftOrder).toHaveBeenCalledTimes(1);
  });
  it('propaga 403 do backend em vez de tornar cadastro visível', async () => {
    vi.mocked(linkPurchaseOrderToDraftOrder).mockRejectedValue(
      new ServiceOrdersApiError(403, 'SERVICE_ORDERS_DENIED', 'denied'),
    );
    const { user, onUpdated } = setup();
    await selectOrder(user);
    await user.click(screen.getByRole('button', { name: /^Confirmar pedido$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem permissão');
    expect(onUpdated).not.toHaveBeenCalled();
  });
});
