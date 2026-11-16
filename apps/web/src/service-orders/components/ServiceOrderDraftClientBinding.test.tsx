import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceOrdersApiError, linkClientToDraftOrder } from '../api/service-orders-api';
import { ServiceOrderDraftClientBinding } from './ServiceOrderDraftClientBinding';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';

vi.mock('../api/service-orders-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/service-orders-api')>()),
  linkClientToDraftOrder: vi.fn(),
}));
vi.mock('../utils/service-order-relation-lookup', () => ({
  searchClientsForLookup: vi.fn(async () => [
    { id: CLIENT_ID, label: 'Cliente autorizado', support: 'CNPJ válido' },
  ]),
}));

function setup() {
  const onUpdated = vi.fn(async () => {});
  render(
    <MemoryRouter>
      <ServiceOrderDraftClientBinding serviceOrderId={ORDER_ID} rowVersion={4} onUpdated={onUpdated} />
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), onUpdated };
}

async function selectClient(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Vincular cliente à OS' }));
  const select = screen.getByTestId<HTMLSelectElement>('so-draft-client-select');
  await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
  await user.selectOptions(select, CLIENT_ID);
}

beforeEach(() => vi.clearAllMocks());

describe('Vínculo de cliente na OS ainda em rascunho', () => {
  it('alerta sobre imutabilidade antes de PREPARE sem enviar qualquer comando', async () => {
    setup();
    expect(screen.getByText(/após preparar, esse vínculo não poderá mais ser alterado/i)).toBeInTheDocument();
    expect(linkClientToDraftOrder).not.toHaveBeenCalled();
  });

  it('não modifica a OS ao somente escolher o cliente', async () => {
    const { user } = setup();
    await selectClient(user);
    expect(linkClientToDraftOrder).not.toHaveBeenCalled();
  });

  it('executa PATCH versionado uma vez e relê o detalhe após êxito', async () => {
    vi.mocked(linkClientToDraftOrder).mockResolvedValue({} as Awaited<ReturnType<typeof linkClientToDraftOrder>>);
    const { user, onUpdated } = setup();
    await selectClient(user);
    await user.click(screen.getByRole('button', { name: /^Confirmar cliente$/ }));
    await waitFor(() => expect(linkClientToDraftOrder).toHaveBeenCalledWith(ORDER_ID, 4, CLIENT_ID));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
  });

  it('não mascara HTTP 409 nem emite retentativa silenciosa', async () => {
    vi.mocked(linkClientToDraftOrder).mockRejectedValue(
      new ServiceOrdersApiError(409, 'SERVICE_ORDERS_VERSION_CONFLICT', 'version_conflict'),
    );
    const { user, onUpdated } = setup();
    await selectClient(user);
    await user.click(screen.getByRole('button', { name: /^Confirmar cliente$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 409');
    expect(linkClientToDraftOrder).toHaveBeenCalledTimes(1);
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('não transforma acesso negado HTTP 403 em operação concluída', async () => {
    vi.mocked(linkClientToDraftOrder).mockRejectedValue(
      new ServiceOrdersApiError(403, 'SERVICE_ORDERS_DENIED', 'denied'),
    );
    const { user, onUpdated } = setup();
    await selectClient(user);
    await user.click(screen.getByRole('button', { name: /^Confirmar cliente$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem permissão');
    expect(onUpdated).not.toHaveBeenCalled();
  });
});
