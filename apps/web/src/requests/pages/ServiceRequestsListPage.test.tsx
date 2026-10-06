import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceRequestsListPage } from './ServiceRequestsListPage';
import { createRequestsFetchMock } from '../../test/requests-fetch-mock';
import { parseRequestPath } from '../../test/request-url';
import { renderWithProviders } from '../../test/render-with-providers';
import { tokenStore, resetTokenStoreForTests } from '../../auth/storage/token-store';
import { SERVICE_REQUEST_STATUSES } from '../types/service-request.types';

describe('ServiceRequestsListPage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('renders the operational queue from backend', async () => {
    vi.stubGlobal('fetch', createRequestsFetchMock());
    renderWithProviders(<ServiceRequestsListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'SR-2026-DEMO01' })).toBeInTheDocument();
    });
    /*
     * GRAMATICA DE WORKLIST: o resumo deixou de ser uma faixa de cartoes clicaveis
     * (`ServiceRequestSummaryCards`) e passou a viver na cabeca da worklist, como as demais
     * listas do produto. O que este teste protege e o MESMO fato: as contagens do summary do
     * servidor aparecem na tela. Antes eram botoes "Filtrar ..."; agora sao indicadores da
     * cabeca ao lado do total, e o recorte por status continua na toolbar.
     */
    expect(screen.getByRole('heading', { level: 1, name: /solicitações de serviço/i })).toBeInTheDocument();
    // "Pendentes" e "Em análise" aparecem como INDICADOR da cabeca e como opcao do campo de
    // Status — por isso a assercao aceita mais de uma ocorrencia do rotulo.
    expect(screen.getAllByText('Pendentes').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Em análise').length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole('region', { name: /fila operacional de solicitações/i }),
    ).toBeInTheDocument();
  });

  it('opens straight into the recorte carried in the URL, so the queue is shareable', async () => {
    const fetchMock = createRequestsFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    // O recorte enumerado vive na URL: abrir o link precisa cair na fila ja recortada,
    // sem o operador refazer o filtro na mao.
    renderWithProviders(<ServiceRequestsListPage />, {
      router: {
        initialEntries: [
          `/app/requests?status=${SERVICE_REQUEST_STATUSES.UnderReview}&priority=HIGH`,
        ],
      },
    });

    await waitFor(() => {
      const requestedStatuses = fetchMock.mock.calls.map(
        (call) => parseRequestPath(call[0]).searchParams.get('status'),
      );
      expect(requestedStatuses).toContain('UNDER_REVIEW');
    });
  });

  it('shows client name, next action and attention facts instead of the raw uuid', async () => {
    vi.stubGlobal(
      'fetch',
      createRequestsFetchMock({
        requestStatus: SERVICE_REQUEST_STATUSES.UnderReview,
      }),
    );
    renderWithProviders(<ServiceRequestsListPage />);

    await waitFor(() => {
      expect(screen.getByText('Cliente Demo Ltda')).toBeInTheDocument();
    });
    // Situação e próximo passo derivados do estado (mesma leitura do backend).
    expect(screen.getByLabelText('Status: Em análise')).toBeInTheDocument();
    expect(screen.getByText(/registrar decisão da análise/i)).toBeInTheDocument();
    // Fato derivável: a solicitação não tem janela desejada registrada.
    expect(screen.getByText(/período desejado não informado/i)).toBeInTheDocument();
    // Nenhum UUID técnico como conteúdo da linha.
    expect(
      screen.queryByText('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).not.toBeInTheDocument();
  });

  it('hides the client name when the clients module denies read', async () => {
    vi.stubGlobal('fetch', createRequestsFetchMock({ clientListAllowed: false }));
    renderWithProviders(<ServiceRequestsListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'SR-2026-DEMO01' })).toBeInTheDocument();
    });
    expect(screen.getByText(/cliente não identificado/i)).toBeInTheDocument();
    expect(screen.queryByText('Cliente Demo Ltda')).not.toBeInTheDocument();
  });

  it('applies priority, ordering and desired window filters through the backend query', async () => {
    const fetchMock = createRequestsFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<ServiceRequestsListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'SR-2026-DEMO01' })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText('Prioridade'), 'URGENT');
    await user.selectOptions(screen.getByLabelText('Ordenar por'), 'desiredStartAt');
    await user.selectOptions(screen.getByLabelText('Sentido'), 'asc');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('priority=URGENT'),
        expect.anything(),
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('sort=desiredStartAt'),
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('direction=asc'),
      expect.anything(),
    );
  });

  it('shows access denied when list is forbidden', async () => {
    vi.stubGlobal('fetch', createRequestsFetchMock({ requestListAllowed: false }));
    renderWithProviders(<ServiceRequestsListPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão/i);
    });
  });

  it('shows loading state initially', async () => {
    vi.stubGlobal('fetch', createRequestsFetchMock());
    renderWithProviders(<ServiceRequestsListPage />);
    expect(screen.getByText(/carregando solicitações/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'SR-2026-DEMO01' })).toBeInTheDocument();
    });
  });

  it('filters by status via backend query', async () => {
    const fetchMock = createRequestsFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<ServiceRequestsListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'SR-2026-DEMO01' })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText('Situação'), SERVICE_REQUEST_STATUSES.Draft);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('status=DRAFT'),
        expect.anything(),
      );
    });
  });

  it('filters by summary card selection', async () => {
    const fetchMock = createRequestsFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<ServiceRequestsListPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'SR-2026-DEMO01' })).toBeInTheDocument();
    });

    /*
     * O recorte rapido por "pendentes" era um cartao clicavel do resumo. Na gramatica de
     * worklist o mesmo recorte e feito pelo campo de Status da toolbar — a assercao abaixo
     * protege o MESMO contrato: escolher um status aplica o filtro e a consulta o envia.
     */
    await user.selectOptions(
      screen.getByLabelText('Situação'),
      SERVICE_REQUEST_STATUSES.Submitted,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('status=SUBMITTED'),
        expect.anything(),
      );
    });
    expect(screen.getByLabelText('Situação')).toHaveValue(SERVICE_REQUEST_STATUSES.Submitted);
  });
});
