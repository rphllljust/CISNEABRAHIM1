import { screen, waitFor, within } from '@testing-library/react';
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
     * OPERATING HEADER + WORK QUEUE STRIP: o resumo deixou de ser uma faixa de cartoes
     * clicaveis (`ServiceRequestSummaryCards`) e passou a viver na faixa de TRABALHO que
     * abre a work area — trabalho aberto primeiro, resolvido depois. O que este teste
     * protege e o MESMO fato: as contagens do summary do servidor aparecem na tela e cada
     * uma APLICA o recorte correspondente.
     */
    expect(screen.getByRole('heading', { level: 1, name: /^solicitações$/i })).toBeInTheDocument();
    const strip = screen.getByRole('navigation', { name: /faixas de trabalho da fila/i });
    expect(strip).toBeInTheDocument();
    for (const label of ['Pendentes', 'Em análise', 'Convertidas', 'Canceladas']) {
      expect(within(strip).getByText(label)).toBeInTheDocument();
    }
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
    // Situação e próximo passo derivados do estado (mesma leitura do backend). Na linha de
    // processamento a situação é TEXTO (o badge saiu): identidade primeiro, decisão
    // segundo, metadado depois. A faixa de trabalho tambem rotula "Em análise" como
    // RECORTE — por isso a assercao e escopada a superficie de processamento.
    const surface = screen.getByRole('region', { name: /fila operacional de solicitações/i });
    expect(within(surface).getByText('Em análise')).toBeInTheDocument();
    expect(within(surface).getByText(/registrar decisão da análise/i)).toBeInTheDocument();
    // Fato derivável: a solicitação não tem janela desejada registrada.
    expect(screen.getAllByText(/período desejado não informado/i).length).toBeGreaterThanOrEqual(1);
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

    /*
     * PRIORIDADE, ORDENAÇÃO E SENTIDO vivem sob "Mais filtros" (progressive disclosure): a barra
     * de recorte abre com busca e situação, que são o recorte diário da fila de entrada. O
     * contrato testado é o MESMO — abrir o disclosure e escolher aplica o filtro no servidor.
     */
    await user.click(screen.getByRole('button', { name: 'Mais filtros' }));
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
     * O recorte rapido por "pendentes" era um cartao clicavel do resumo e hoje e uma celula
     * da faixa de trabalho que abre a work area. O contrato protegido e o MESMO: acionar o
     * recorte aplica o filtro e a consulta o envia ao servidor.
     */
    const strip = screen.getByRole('navigation', { name: /faixas de trabalho da fila/i });
    await user.click(within(strip).getByRole('button', { name: /pendentes/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('status=SUBMITTED'),
        expect.anything(),
      );
    });
    expect(screen.getByLabelText('Situação')).toHaveValue(SERVICE_REQUEST_STATUSES.Submitted);
  });
});
