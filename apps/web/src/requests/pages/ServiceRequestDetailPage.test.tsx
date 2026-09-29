import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useParams } from 'react-router-dom';
import { createRequestsFetchMock } from '../../test/requests-fetch-mock';
import { renderRequestRoutes } from '../../test/render-request-routes';
import { tokenStore, resetTokenStoreForTests } from '../../auth/storage/token-store';
import { ServiceRequestDetailPage } from './ServiceRequestDetailPage';
import { SERVICE_REQUEST_STATUSES } from '../types/service-request.types';

const REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONVERTED_SERVICE_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function PlanningStub() {
  const { serviceOrderId } = useParams();
  return <h1>Planejamento da OS {serviceOrderId}</h1>;
}

/**
 * A gramática de objeto empresarial (`EnterpriseObjectHeader`) expõe a transição PRIMÁRIA do
 * ciclo como botão e as demais em "Mais ações". As transições aceitas pelo servidor continuam
 * exatamente as mesmas, com os mesmos rótulos e as mesmas chamadas — muda apenas onde o
 * operador as encontra.
 */
async function clickTransition(
  user: ReturnType<typeof userEvent.setup>,
  name: string | RegExp,
) {
  const direct = screen.queryByRole('button', { name });
  if (direct) {
    await user.click(direct);
    return;
  }
  await user.click(screen.getByRole('button', { name: 'Mais ações' }));
  await user.click(await screen.findByRole('menuitem', { name }));
}

describe('ServiceRequestDetailPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('renders the workbench: operational summary, next step and lifecycle history', async () => {
    vi.stubGlobal('fetch', createRequestsFetchMock());
    renderRequestRoutes(`/app/requests/${REQUEST_ID}`);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /resumo operacional/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: /próximo passo/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /histórico do ciclo/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /cadeia relacionada/i })).toBeInTheDocument();
    // Nome humano do cliente (módulo CLIENTES autorizado) — nunca o UUID.
    expect(screen.getAllByText('Cliente Demo Ltda').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).not.toBeInTheDocument();
    // Próximo passo derivado do estado e fato temporal derivável.
    expect(screen.getByText(/completar e enviar para análise/i)).toBeInTheDocument();
    expect(screen.getByText(/período desejado não informado/i)).toBeInTheDocument();
    expect(screen.getByText(/solicitação registrada/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /converter em os/i })).not.toBeInTheDocument();
  });

  it('shows the authorized business chain and hides the links the actor cannot read', async () => {
    vi.stubGlobal(
      'fetch',
      createRequestsFetchMock({
        requestStatus: SERVICE_REQUEST_STATUSES.Converted,
        linkedChain: [
          {
            kind: 'SERVICE_ORDER',
            id: CONVERTED_SERVICE_ORDER_ID,
            label: 'OS-2026-0007',
            status: 'PREPARED',
            occurredAt: '2026-01-02T12:00:00.000Z',
          },
        ],
      }),
    );
    renderRequestRoutes(`/app/requests/${REQUEST_ID}`);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'OS-2026-0007' })).toBeInTheDocument();
    });
    expect(screen.getByText('Ordem de serviço')).toBeInTheDocument();
    expect(screen.queryByText('Proposta comercial')).not.toBeInTheDocument();
    expect(screen.queryByText('Pedido de compra')).not.toBeInTheDocument();
  });

  it('does not offer a transition the actor is not authorized to perform', async () => {
    vi.stubGlobal('fetch', createRequestsFetchMock({ requestSubmitAllowed: false }));
    renderRequestRoutes(`/app/requests/${REQUEST_ID}`);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /próximo passo/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /enviar para análise/i })).not.toBeInTheDocument();
    expect(screen.getByText(/nenhuma ação disponível para o seu perfil/i)).toBeInTheDocument();
  });

  it('submits, reviews, approves and cancels workflow', async () => {
    vi.stubGlobal('fetch', createRequestsFetchMock());
    const user = userEvent.setup();
    renderRequestRoutes(`/app/requests/${REQUEST_ID}`);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /enviar para análise/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /enviar para análise/i }));
    await waitFor(() => {
      expect(screen.getByLabelText('Status: Enviada')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /iniciar análise/i }));
    await waitFor(() => {
      expect(screen.getByLabelText('Status: Em análise')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /^aprovar$/i }));
    await user.click(screen.getByRole('button', { name: /confirmar aprovação/i }));
    await waitFor(() => {
      expect(screen.getByLabelText('Status: Aprovada')).toBeInTheDocument();
    });

    await clickTransition(user, /^cancelar$/i);
    await user.type(screen.getByLabelText(/motivo do cancelamento/i), 'Cliente desistiu');
    await user.click(screen.getByRole('button', { name: /confirmar cancelamento/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Cancelada')).toBeInTheDocument();
    });
  });

  it('rejects with reason', async () => {
    vi.stubGlobal('fetch', createRequestsFetchMock());
    const user = userEvent.setup();
    renderRequestRoutes(`/app/requests/${REQUEST_ID}`);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /enviar para análise/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /enviar para análise/i }));
    await user.click(screen.getByRole('button', { name: /iniciar análise/i }));

    // A transição primária de "em análise" é a decisão por aprovação; rejeitar é a alternativa.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^aprovar$/i })).toBeInTheDocument();
    });

    await clickTransition(user, /^rejeitar$/i);
    await user.type(screen.getByLabelText(/motivo da rejeição/i), 'Fora do escopo');
    await user.click(screen.getByRole('button', { name: /confirmar rejeição/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Status: Rejeitada')).toBeInTheDocument();
      expect(screen.getByText('Fora do escopo')).toBeInTheDocument();
    });
  });

  it('shows conversion on an approved request and navigates to planning after success', async () => {
    vi.stubGlobal(
      'fetch',
      createRequestsFetchMock({ requestStatus: SERVICE_REQUEST_STATUSES.Approved }),
    );
    const user = userEvent.setup();
    renderRequestRoutes(
      `/app/requests/${REQUEST_ID}`,
      <Routes>
        <Route path="/app/requests/:serviceRequestId" element={<ServiceRequestDetailPage />} />
        <Route
          path="/app/service-orders/:serviceOrderId/planning"
          element={<PlanningStub />}
        />
      </Routes>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /converter em os/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /converter em os/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: `Planejamento da OS ${CONVERTED_SERVICE_ORDER_ID}` }),
      ).toBeInTheDocument();
    });
  });
});
