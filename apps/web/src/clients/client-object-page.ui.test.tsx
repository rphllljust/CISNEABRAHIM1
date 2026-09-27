import { configure, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientDetailPage } from './pages/ClientDetailPage';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import { buildClientStateFlow } from './utils/client-object-presentation';
import {
  CLIENT_STATUSES,
  CONTACT_PURPOSES,
  PURCHASE_ORDER_REQUIREMENTS,
  type Client,
  type ClientStatus,
} from './types/client.types';

/**
 * OBJECT PAGE DO CLIENTE — comportamento de apresentação.
 *
 * Estes testes provam o que a página AFIRMA na tela: os fatos reais do objeto, a ausência de
 * identificador técnico, o descarte integral de relação não autorizada, o fluxo com o estado
 * corrente real, o histórico apenas com fatos persistidos e a ação que só existe sob capability.
 */

const CLIENT_ID = '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const PROBE_CLIENT_ID = '00000000-0000-4000-8000-000000000001';

configure({ asyncUtilTimeout: 3000 });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientError(code: string, status: number): Response {
  return jsonResponse({ error: { code, message: code } }, status);
}

function clientFixture(overrides: Partial<Client> = {}): Client {
  return {
    id: CLIENT_ID,
    legalName: 'Amaggi Exportadora LTDA',
    tradeName: 'Amaggi',
    taxId: '11222333000181',
    externalErpId: null,
    status: CLIENT_STATUSES.Active,
    version: 1,
    createdAt: '2026-01-05T12:00:00.000Z',
    updatedAt: '2026-02-10T09:30:00.000Z',
    deactivatedAt: null,
    deactivationReason: null,
    purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.BeforeExecution,
    contacts: [
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        name: 'Operações',
        purpose: CONTACT_PURPOSES.Operational,
        email: 'ops@amaggi.invalid',
        phone: null,
      },
    ],
    addresses: [],
    ...overrides,
  };
}

function requestItem(index: number) {
  return {
    id: `${String(index).padStart(8, '0')}-0000-4000-8000-00000000000${index}`,
    requestCode: `SOL-2026-000${index}`,
    status: 'APPROVED',
    description: `Solicitação ${index}`,
    desiredStartAt: '2026-03-01T12:00:00.000Z',
  };
}

function proposalItem(index: number) {
  return {
    id: `${String(index).padStart(8, '0')}-1111-4111-8111-00000000000${index}`,
    proposalCode: `PROP-2026-000${index}`,
    title: `Proposta ${index}`,
    currentVersionNumber: 1,
  };
}

type ListFixture = 'complete' | 'unknown-total' | 'denied' | 'error';

type FetchFixtureOptions = {
  client?: Client;
  capabilities?: { update?: boolean; deactivate?: boolean; activate?: boolean };
  proposals?: ListFixture;
  requests?: ListFixture;
  /** Resposta do próprio cadastro — prova o mapeamento de loading/denied/error/empty. */
  detail?: 'denied' | 'not_found' | 'error';
};

/**
 * Mock do backend com as rotas REAIS que a página consome: cadastro, probes de capability e as
 * listagens dos módulos da cadeia comercial.
 *
 * `unknown-total` simula o caso em que o servidor devolve a página CHEIA: o conjunto pode ter mais
 * registros, então o total é desconhecido e a relação não pode ser declarada.
 */
function createClientObjectFetchMock(options: FetchFixtureOptions = {}) {
  const client = options.client ?? clientFixture();
  const capabilities = {
    update: true,
    deactivate: true,
    activate: true,
    ...options.capabilities,
  };
  const proposals = options.proposals ?? 'complete';
  const requests = options.requests ?? 'complete';

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const pathname = new URL(raw, 'http://127.0.0.1').pathname;
    const method = (init?.method ?? 'GET').toUpperCase();

    if (pathname === '/api/v1/auth/session' && method === 'GET') {
      return jsonResponse({
        identityId: '11111111-1111-4111-8111-111111111111',
        session: { id: 'sid', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
      });
    }

    if (pathname === '/api/v1/clients' && method === 'GET') {
      return jsonResponse({ items: [], limit: 1, offset: 0, total: 0, totalPages: 0 });
    }
    if (pathname === '/api/v1/clients' && method === 'POST') {
      return clientError('CLIENT_VALIDATION_FAILED', 400);
    }
    if (pathname === `/api/v1/clients/${PROBE_CLIENT_ID}`) {
      if (method === 'PATCH') {
        return capabilities.update
          ? clientError('CLIENT_NOT_FOUND', 404)
          : clientError('CLIENT_DENIED', 403);
      }
      return clientError('CLIENT_NOT_FOUND', 404);
    }
    if (pathname === `/api/v1/clients/${PROBE_CLIENT_ID}/deactivate`) {
      return capabilities.deactivate
        ? clientError('CLIENT_NOT_FOUND', 404)
        : clientError('CLIENT_DENIED', 403);
    }
    if (pathname === `/api/v1/clients/${PROBE_CLIENT_ID}/activate`) {
      return capabilities.activate
        ? clientError('CLIENT_NOT_FOUND', 404)
        : clientError('CLIENT_DENIED', 403);
    }

    if (pathname === `/api/v1/clients/${client.id}` && method === 'GET') {
      if (options.detail === 'denied') {
        return clientError('CLIENT_DENIED', 403);
      }
      if (options.detail === 'not_found') {
        return clientError('CLIENT_NOT_FOUND', 404);
      }
      if (options.detail === 'error') {
        return clientError('CLIENT_INTERNAL', 500);
      }
      return jsonResponse(client);
    }

    if (pathname === '/api/v1/requests/service-requests/summary') {
      return requests === 'denied' || requests === 'error'
        ? clientError('REQUEST_DENIED', requests === 'denied' ? 403 : 500)
        : jsonResponse({ total: 3, pending: 0, underReview: 0, converted: 3, cancelled: 0 });
    }
    if (pathname === '/api/v1/requests/service-requests') {
      if (requests === 'denied') {
        return clientError('REQUEST_DENIED', 403);
      }
      if (requests === 'error') {
        return clientError('REQUEST_INTERNAL', 500);
      }
      return jsonResponse({ items: [requestItem(1), requestItem(2), requestItem(3)], limit: 20, offset: 0 });
    }

    if (pathname === '/api/v1/commercial/proposals') {
      if (proposals === 'denied') {
        return clientError('COMMERCIAL_DENIED', 403);
      }
      if (proposals === 'error') {
        return clientError('COMMERCIAL_INTERNAL', 500);
      }
      if (proposals === 'unknown-total') {
        return jsonResponse({
          items: Array.from({ length: 20 }, (_, index) => proposalItem(index + 1)),
          limit: 20,
          offset: 0,
        });
      }
      return jsonResponse({ items: [proposalItem(1), proposalItem(2)], limit: 20, offset: 0 });
    }

    if (pathname === '/api/v1/commercial/purchase-orders') {
      return jsonResponse({ items: [], limit: 20, offset: 0 });
    }

    if (pathname === '/api/v1/service-orders') {
      return jsonResponse({ items: [], limit: 20, offset: 0 });
    }

    return clientError('UNKNOWN', 404);
  });
}

function renderClientPage(initialPath = `/app/clients/${CLIENT_ID}`) {
  return renderWithProviders(
    <Routes>
      <Route path="/app/clients/:clientId" element={<ClientDetailPage />} />
      <Route path="/app/clients/:clientId/edit" element={<div>Formulário de edição</div>} />
    </Routes>,
    { router: { initialEntries: [initialPath] } },
  );
}

async function awaitHeader(name = 'Amaggi Exportadora LTDA'): Promise<HTMLElement> {
  return screen.findByRole('heading', { name });
}

describe('Object page do Cliente', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('apresenta os fatos reais do objeto no cabeçalho e no contexto', async () => {
    vi.stubGlobal('fetch', createClientObjectFetchMock());
    const { container } = renderClientPage();
    await awaitHeader();

    // Referência humana: o CNPJ formatado — nunca o identificador interno.
    expect(screen.getByText('11.222.333/0001-81')).toBeInTheDocument();
    // Contexto humano do objeto.
    expect(screen.getByText('Amaggi')).toBeInTheDocument();
    // Estado real do cadastro.
    expect(screen.getByLabelText('Status: Ativo')).toBeInTheDocument();

    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    // Metadado real do cabeçalho: data de cadastro persistida.
    expect(within(header as HTMLElement).getByText('Cadastro')).toBeInTheDocument();
    expect(within(header as HTMLElement).getByText(/05\/01\/2026/)).toBeInTheDocument();
    // Fatos que qualificam o objeto: configuração de pedido de compra e contato principal.
    expect(screen.getByText('Pedido de compra')).toBeInTheDocument();
    expect(screen.getByText('Antes da execução')).toBeInTheDocument();
    expect(screen.getByText('Contato operacional')).toBeInTheDocument();
    expect(screen.getByText('Operações · ops@amaggi.invalid')).toBeInTheDocument();
  });

  it('não renderiza identificador técnico nem nome de capability em nenhum texto', async () => {
    vi.stubGlobal('fetch', createClientObjectFetchMock());
    renderClientPage();
    await awaitHeader();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /solicitações/i })).toBeInTheDocument();
    });

    const text = document.body.textContent ?? '';
    expect(text).not.toContain(CLIENT_ID);
    expect(text).not.toContain(PROBE_CLIENT_ID);
    // Nenhum nome de capability do tipo `dominio:recurso:acao` chega ao operador.
    expect(text).not.toMatch(/[a-z-]+:[a-z-]+:[a-z-]+/);
  });

  it('declara cada relação com contagem persistida e destino filtrado real', async () => {
    vi.stubGlobal('fetch', createClientObjectFetchMock());
    renderClientPage();
    await awaitHeader();

    // Solicitações: total publicado pelo resumo do backend (3), não o tamanho da lista visível.
    const requests = await screen.findByRole('link', { name: /solicitações/i });
    expect(within(requests).getByText('3')).toBeInTheDocument();
    expect(requests).toHaveAttribute('href', `/app/requests?clientId=${CLIENT_ID}`);

    // Propostas: página devolvida sem enchimento — o conjunto está comprovado (2).
    const proposals = screen.getByRole('link', { name: /propostas/i });
    expect(within(proposals).getByText('2')).toBeInTheDocument();
    expect(proposals).toHaveAttribute('href', `/app/proposals?clientId=${CLIENT_ID}`);

    // Zero comprovado é um número honesto: nenhum registro persistido.
    const purchaseOrders = screen.getByRole('link', { name: /pedidos de compra/i });
    expect(within(purchaseOrders).getByText('0')).toBeInTheDocument();
    expect(purchaseOrders).toHaveAttribute('href', `/app/purchase-orders?clientId=${CLIENT_ID}`);

    // Ordens de serviço usam o montador de href do próprio módulo, que lê o filtro na tela.
    const serviceOrders = screen.getByRole('link', { name: /ordens de serviço/i });
    expect(within(serviceOrders).getByText('0')).toBeInTheDocument();
    expect(serviceOrders).toHaveAttribute('href', `/app/service-orders?clientId=${CLIENT_ID}`);
  });

  it('não declara relação sem contagem comprovada pelo backend', async () => {
    // Página cheia (20 de 20): pode haver mais registros, então o total é desconhecido.
    vi.stubGlobal('fetch', createClientObjectFetchMock({ proposals: 'unknown-total' }));
    renderClientPage();
    await awaitHeader();

    // Espera a leitura dos módulos terminar: solicitações resolvidas e registros de proposta na tela.
    const relations = await screen.findByLabelText('Relações');
    expect(within(relations).getByRole('link', { name: /solicitações/i })).toBeInTheDocument();
    await screen.findByRole('link', { name: 'PROP-2026-0001' });

    // Sem número confiável, a relação não é declarada — nem rótulo, nem destino.
    expect(within(relations).queryByRole('link', { name: /propostas/i })).not.toBeInTheDocument();
    expect(within(relations).queryByText('Propostas')).not.toBeInTheDocument();
    // O painel de registros relacionados continua mostrando os registros reais do módulo.
    expect(screen.getAllByText('Propostas').length).toBeGreaterThan(0);
  });

  it('descarta por inteiro a relação não autorizada, sem rótulo, contagem ou "oculto"', async () => {
    vi.stubGlobal('fetch', createClientObjectFetchMock({ proposals: 'denied' }));
    renderClientPage();
    await awaitHeader();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /solicitações/i })).toBeInTheDocument();
    });

    // Leitura negada não vira rótulo, contagem nem aviso de item oculto.
    expect(screen.queryByText('Propostas')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /propostas/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/oculto/i)).not.toBeInTheDocument();
    // A relação autorizada permanece intocada.
    expect(screen.getByRole('link', { name: /solicitações/i })).toBeInTheDocument();
  });

  it('marca o estado corrente real no fluxo e não desenha fluxo fora do vocabulário', async () => {
    vi.stubGlobal('fetch', createClientObjectFetchMock());
    const active = renderClientPage();
    await awaitHeader();

    const flow = screen.getByLabelText('Ciclo de vida');
    expect(within(flow).getByText('Ativo')).toHaveAttribute('aria-current', 'step');
    expect(within(flow).getByText('Inativo')).not.toHaveAttribute('aria-current');
    active.unmount();

    vi.stubGlobal(
      'fetch',
      createClientObjectFetchMock({
        client: clientFixture({
          status: CLIENT_STATUSES.Inactive,
          deactivatedAt: '2026-03-02T18:00:00.000Z',
          deactivationReason: 'Encerramento contratual',
        }),
      }),
    );
    renderClientPage();
    await awaitHeader();
    const inactiveFlow = screen.getByLabelText('Ciclo de vida');
    expect(within(inactiveFlow).getByText('Inativo')).toHaveAttribute('aria-current', 'step');

    // Estado fora do vocabulário publicado não vira etapa inventada.
    expect(buildClientStateFlow('SEM_ESTADO' as ClientStatus)).toBeNull();
  });

  it('mostra no histórico apenas os fatos persistidos, sem ator inventado', async () => {
    vi.stubGlobal(
      'fetch',
      createClientObjectFetchMock({
        client: clientFixture({ deactivatedAt: null }),
      }),
    );
    renderClientPage();
    await awaitHeader();

    const history = screen.getByLabelText('Histórico');
    expect(within(history).getByText('Cadastro criado')).toBeInTheDocument();
    expect(within(history).getByText('Cadastro atualizado')).toBeInTheDocument();
    // Exatamente os dois fatos persistidos: nenhum evento de negócio ou ator inventado.
    expect(within(history).getAllByRole('listitem')).toHaveLength(2);
    expect(history.textContent).not.toMatch(/sistema|usuário|auditoria/i);
  });

  it('registra a desativação como fato persistido e oferece a reativação quando autorizada', async () => {
    vi.stubGlobal(
      'fetch',
      createClientObjectFetchMock({
        client: clientFixture({
          status: CLIENT_STATUSES.Inactive,
          updatedAt: '2026-03-02T18:00:00.000Z',
          deactivatedAt: '2026-03-02T18:00:00.000Z',
          deactivationReason: 'Encerramento contratual',
        }),
      }),
    );
    renderClientPage();
    await awaitHeader();

    expect(screen.getByLabelText('Status: Inativo')).toBeInTheDocument();
    const history = screen.getByLabelText('Histórico');
    expect(within(history).getByText('Cliente desativado')).toBeInTheDocument();
    // A atualização do timestamp de desativação não é repetida como segundo fato.
    expect(within(history).queryByText('Cadastro atualizado')).not.toBeInTheDocument();
    expect(within(history).getAllByRole('listitem')).toHaveLength(2);

    // Próxima ação derivada de estado + capability.
    expect(await screen.findByRole('button', { name: 'Reativar Cliente' })).toBeInTheDocument();
  });

  it('só oferece a ação primária quando a capability autoriza', async () => {
    vi.stubGlobal('fetch', createClientObjectFetchMock());
    const allowed = renderClientPage();
    await awaitHeader();
    expect(await screen.findByRole('button', { name: 'Editar' })).toBeInTheDocument();
    // A operação destrutiva não fica exposta ao lado da ação primária.
    expect(screen.queryByRole('button', { name: /^desativar$/i })).not.toBeInTheDocument();
    allowed.unmount();

    vi.stubGlobal(
      'fetch',
      createClientObjectFetchMock({
        capabilities: { update: false, deactivate: false, activate: false },
      }),
    );
    renderClientPage();
    await awaitHeader();

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /mais ações/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /desativar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reativar/i })).not.toBeInTheDocument();
  });

  it('mantém a navegação real no breadcrumb do objeto', async () => {
    vi.stubGlobal('fetch', createClientObjectFetchMock());
    renderClientPage();
    await awaitHeader();

    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(breadcrumb).getByRole('link', { name: 'Clientes' })).toHaveAttribute(
      'href',
      '/app/clients',
    );
    expect(within(breadcrumb).getByText('Amaggi Exportadora LTDA')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('mapeia negação para o estado de permissão e não a confunde com registro vazio', async () => {
    vi.stubGlobal('fetch', createClientObjectFetchMock({ detail: 'denied' }));
    renderClientPage();

    const denied = await screen.findByRole('alert');
    expect(denied).toHaveTextContent('Você não tem permissão para consultar este Cliente.');
    expect(screen.queryByText(/não está mais disponível/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Relações')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });

  it('não encontra o cadastro sem oferecer ação sobre um objeto inexistente', async () => {
    vi.stubGlobal('fetch', createClientObjectFetchMock({ detail: 'not_found' }));
    renderClientPage();

    expect(await screen.findByText('Cliente não encontrado.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clientes' })).toHaveAttribute('href', '/app/clients');
  });
});
