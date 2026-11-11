import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceOrdersApiError, linkPublishedServiceToDraftOrder } from '../api/service-orders-api';
import { ServiceOrderDraftServiceBinding } from './ServiceOrderDraftServiceBinding';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const DEFINITION_ID = '22222222-2222-4222-8222-222222222222';

vi.mock('../api/service-orders-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/service-orders-api')>()),
  linkPublishedServiceToDraftOrder: vi.fn(),
}));
vi.mock('../utils/service-order-relation-lookup', () => ({
  searchPublishedServicesForLookup: vi.fn(async () => [
    { id: DEFINITION_ID, label: 'Manutenção publicada', support: 'SVC-001 · versão 1' },
  ]),
}));

function setup() {
  const onUpdated = vi.fn(async () => {});
  render(
    <MemoryRouter>
      <ServiceOrderDraftServiceBinding serviceOrderId={ORDER_ID} rowVersion={4} onUpdated={onUpdated} />
    </MemoryRouter>,
  );
  return { user: userEvent.setup(), onUpdated };
}

async function selectPublishedService(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Vincular serviço do catálogo' }));
  const select = screen.getByTestId<HTMLSelectElement>('so-draft-service-select');
  await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
  await user.selectOptions(select, DEFINITION_ID);
}

beforeEach(() => vi.clearAllMocks());

describe('DRAFT OS — recuperar vínculo autoritativo do serviço', () => {
  it('não modifica OS ao abrir busca ou selecionar serviço', async () => {
    const { user } = setup();
    await selectPublishedService(user);
    expect(linkPublishedServiceToDraftOrder).not.toHaveBeenCalled();
  });

  it('envia rowVersion e serviço escolhido somente após confirmação e relê capabilities', async () => {
    vi.mocked(linkPublishedServiceToDraftOrder).mockResolvedValue({} as Awaited<ReturnType<typeof linkPublishedServiceToDraftOrder>>);
    const { user, onUpdated } = setup();
    await selectPublishedService(user);
    await user.click(screen.getByRole('button', { name: /^Vincular serviço$/ }));
    await waitFor(() => expect(linkPublishedServiceToDraftOrder).toHaveBeenCalledWith(
      ORDER_ID, 4, DEFINITION_ID,
    ));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
  });

  it('mantém erro HTTP 409 e não presume sucesso nem reenvia mutação', async () => {
    vi.mocked(linkPublishedServiceToDraftOrder).mockRejectedValue(
      new ServiceOrdersApiError(409, 'SERVICE_ORDERS_VERSION_CONFLICT', 'version_conflict'),
    );
    const { user, onUpdated } = setup();
    await selectPublishedService(user);
    await user.click(screen.getByRole('button', { name: /^Vincular serviço$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 409');
    expect(onUpdated).not.toHaveBeenCalled();
    expect(linkPublishedServiceToDraftOrder).toHaveBeenCalledTimes(1);
  });

  it('não mascara a negativa HTTP 403 do servidor', async () => {
    vi.mocked(linkPublishedServiceToDraftOrder).mockRejectedValue(
      new ServiceOrdersApiError(403, 'SERVICE_ORDERS_DENIED', 'denied'),
    );
    const { user, onUpdated } = setup();
    await selectPublishedService(user);
    await user.click(screen.getByRole('button', { name: /^Vincular serviço$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem permissão');
    expect(onUpdated).not.toHaveBeenCalled();
  });
});
