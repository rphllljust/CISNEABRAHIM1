import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  type ClientAuditTrailEntry,
  type ClientDataQuality,
  type ClientHierarchyNode,
  type ClientStatus,
} from './types/client.types';

/**
 * OBJECT PAGE DO CLIENTE — comportamento de apresentação.
 *
 * Estes testes provam o que a página AFIRMA na tela: os fatos reais do objeto, a ausência de
 * identificador técnico, o descarte integral de relação não autorizada, o fluxo com o estado
 * corrente real, a TRILHA DE AUDITORIA apenas com o que o servidor publicou e a ação que só
 * existe sob capability.
 *
 * A seção de histórico mudou de natureza nesta onda: ela deixou de derivar fatos de timestamps
 * (`buildClientHistoryFacts`) e passou a ler o canal AUDIT_TRAIL, que publica o par (antes,
 * depois). Os testes abaixo afirmam a trilha REAL, inclusive o caso em que o servidor NEGA a
 * leitura — que não pode ser confundido com "não há alterações".
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
    /*
     * HIERARQUIA — vínculo DECLARADO. O fixture declara grupo e matriz porque é o caso que prova a
     * ordenação da cadeia (raiz -> pai -> este Cliente); os testes que precisam do caso SEM
     * estrutura passam `groupName: null` explicitamente.
     */
    groupId: '99999999-9999-4999-8999-999999999999',
    groupName: 'Grupo Amaggi',
    parentClientId: null,
    parentClientName: null,
    childCount: 0,
    contacts: [
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        name: 'Operações',
        purpose: CONTACT_PURPOSES.Operational,
        role: null,
        isPrimary: true,
        deactivatedAt: null,
        email: 'ops@amaggi.invalid',
        phone: null,
      },
    ],
    addresses: [],
    units: [],
    ...overrides,
  };
}

/** Entrada da trilha de auditoria: o par (antes, depois) por alteração. */
function auditEntryFixture(
  index: number,
  overrides: Partial<ClientAuditTrailEntry> = {},
): ClientAuditTrailEntry {
  return {
    id: `${String(index).padStart(8, '0')}-2222-4222-8222-00000000000${index}`,
    action: 'UPDATE',
    actorIdentityId: '11111111-1111-4111-8111-111111111111',
    correlationId: `${String(index).padStart(8, '0')}-3333-4333-8333-00000000000${index}`,
    occurredAt: `2026-02-0${index}T12:00:00.000Z`,
    before: { tradeName: null },
    after: { tradeName: 'Amaggi' },
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
  contracts?: ListFixture;
  requests?: ListFixture;
  /** Resposta do próprio cadastro — prova o mapeamento de loading/denied/error/empty. */
  detail?: 'denied' | 'not_found' | 'error';
  /** Entradas da trilha de auditoria devolvidas pelo servidor. */
  auditTrail?: ClientAuditTrailEntry[];
  /** `denied` prova que a seção de histórico distingue NEGADO de VAZIO. */
  auditTrailAccess?: 'allowed' | 'denied' | 'error';
  /** Apontamentos de qualidade devolvidos pelo servidor. */
  quality?: ClientDataQuality;
  /** Nós da árvore de hierarquia devolvidos pelo servidor. */
  hierarchy?: { nodes: ClientHierarchyNode[]; truncated?: boolean };
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
  const contracts = options.contracts ?? 'complete';
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

    if (pathname === '/api/v1/me' && method === 'GET') {
      return jsonResponse({
        usuario: {
          id: '11111111-1111-4111-8111-111111111111',
          nome: null,
          email: null,
          identity_id: '11111111-1111-4111-8111-111111111111',
        },
        permissoes_efetivas: [
          'client:client:list',
          'client:client:read',
          ...(capabilities.update ? ['client:client:update'] : []),
          ...(capabilities.deactivate ? ['client:client:deactivate'] : []),
          ...(capabilities.activate ? ['client:client:activate'] : []),
          'client:contact:manage',
          'client:unit:manage',
          'client:hierarchy:manage',
          'client:audit:read',
        ],
        escopo_ativo: null,
        escopos_disponiveis: [{ tipo: 'GLOBAL', resource_id: null, label: 'Global' }],
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

    /*
     * CUSTOMER 360 — as três leituras da ficha.
     *
     * `hierarchy` é resolvida a partir do PRÓPRIO fixture quando o teste não declara os nós: a
     * árvore mínima é o Cliente como raiz de si mesmo, que é o que o servidor devolve para um
     * cadastro sem vínculo. Assim os testes que não falam de hierarquia não precisam montá-la.
     */
    if (pathname === `/api/v1/clients/${client.id}/hierarchy` && method === 'GET') {
      const nodes = options.hierarchy?.nodes ?? [
        {
          id: client.id,
          legal_name: client.legalName,
          trade_name: client.tradeName,
          status: client.status,
          parent_client_id: client.parentClientId,
          group_id: client.groupId,
          group_name: client.groupName,
          child_count: client.childCount,
          depth: 0,
          relation: 'self' as const,
        },
      ];
      return jsonResponse({
        rootId: client.id,
        nodes,
        truncated: options.hierarchy?.truncated ?? false,
        maxDepth: 8,
      });
    }

    if (pathname === `/api/v1/clients/${client.id}/data-quality` && method === 'GET') {
      return jsonResponse(
        options.quality ?? { evaluated: true, isComplete: true, findings: [] },
      );
    }

    if (pathname === `/api/v1/clients/${client.id}/audit-trail` && method === 'GET') {
      if (options.auditTrailAccess === 'denied') {
        return clientError('CLIENT_DENIED', 403);
      }
      if (options.auditTrailAccess === 'error') {
        return clientError('CLIENT_INTERNAL', 500);
      }
      const items = options.auditTrail ?? [];
      return jsonResponse({
        items,
        limit: 20,
        offset: 0,
        total: items.length,
        totalPages: items.length > 0 ? 1 : 0,
      });
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

    if (pathname === '/api/v1/commercial/contracts') {
      if (contracts === 'denied') return clientError('COMMERCIAL_DENIED', 403);
      if (contracts === 'error') return clientError('COMMERCIAL_INTERNAL', 500);
      const items = Array.from(
        { length: contracts === 'unknown-total' ? 20 : 1 },
        (_, index) => ({
          id: `${String(index + 1).padStart(8, '0')}-7777-4777-8777-000000000001`,
          contractNumber: `CTR-2026-${String(index + 1).padStart(4, '0')}`,
          title: 'Contrato de prestação de serviços',
          status: 'ACTIVE',
        }),
      );
      return jsonResponse({ items, limit: 20, offset: 0 });
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

/**
 * ABRE UMA ABA DA FICHA — a object page passou a usar divulgação progressiva.
 *
 * O detalhe (relacionamentos, estrutura, qualidade, histórico) deixou de ficar sempre renderizado.
 * O teste abre a aba antes de afirmar sobre o painel, o que também prova o comportamento novo: o
 * painel não monta — e portanto não dispara leitura de rede — até ser pedido.
 */
async function openTab(name: RegExp): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name }));
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

    // Contratos têm contagem exata apenas quando a página do backend é comprovadamente completa.
    const contracts = screen.getByRole('link', { name: /contratos/i });
    expect(within(contracts).getByText('1')).toBeInTheDocument();
    expect(contracts).toHaveAttribute('href', `/app/contracts?clientId=${CLIENT_ID}`);

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
    await openTab(/relacionamentos/i);

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

  it('não divulga contratos de outro escopo nem inventa o total de página cheia', async () => {
    vi.stubGlobal('fetch', createClientObjectFetchMock({ contracts: 'unknown-total' }));
    renderClientPage();
    await awaitHeader();
    await openTab(/relacionamentos/i);
    const relations = await screen.findByLabelText('Relações');
    await screen.findByRole('link', { name: 'CTR-2026-0001' });
    expect(within(relations).queryByRole('link', { name: /contratos/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CTR-2026-0001' })).toHaveAttribute(
      'href', '/app/contracts/00000001-7777-4777-8777-000000000001',
    );
  });

  it('não revela sequer a existência de contratos quando o domínio retorna 403', async () => {
    vi.stubGlobal('fetch', createClientObjectFetchMock({ contracts: 'denied' }));
    renderClientPage();
    await awaitHeader();
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /solicitações/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: /contratos/i })).not.toBeInTheDocument();
    await openTab(/relacionamentos/i);
    expect(screen.queryByText('Contratos')).not.toBeInTheDocument();
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

  /*
   * O HISTÓRICO PASSOU A SER A TRILHA DE VALOR.
   *
   * Antes, esta asserção verificava "Cadastro criado"/"Cadastro atualizado" — fatos DERIVADOS da
   * comparação de `createdAt`/`updatedAt`. Isso dizia QUANDO algo mudou e nunca O QUE mudou nem
   * QUEM mudou. A seção agora lê `audit-trail`, que publica o par (antes, depois) por alteração.
   *
   * O que o teste continua protegendo, e que é o ponto: nenhum ator e nenhum evento é INVENTADO.
   * O que aparece é exatamente o que o servidor publicou.
   */
  it('mostra no histórico apenas as alterações publicadas pelo servidor, sem ator inventado', async () => {
    vi.stubGlobal(
      'fetch',
      createClientObjectFetchMock({
        client: clientFixture({ deactivatedAt: null }),
        auditTrail: [
          auditEntryFixture(1, {
            action: 'CREATE',
            before: null,
            after: { legalName: 'Amaggi Exportadora LTDA', tradeName: null },
          }),
          auditEntryFixture(2, {
            action: 'UPDATE',
            before: { tradeName: null },
            after: { tradeName: 'Amaggi' },
          }),
        ],
      }),
    );
    renderClientPage();
    await awaitHeader();
    await openTab(/histórico/i);

    const history = await screen.findByLabelText('Histórico de alterações');
    expect(within(history).getByText('Cadastro criado')).toBeInTheDocument();
    expect(within(history).getByText('Cadastro alterado')).toBeInTheDocument();
    // Exatamente as duas entradas publicadas: nenhum evento de negócio inventado.
    expect(within(history).getAllByTestId('client-audit-entry')).toHaveLength(2);
    /*
     * A CRIAÇÃO NÃO TEM ESTADO ANTERIOR, e a UI DIZ isso em vez de imprimir string vazia. A
     * asserção é por ENTRADA (não pelo texto solto na seção) porque os dois campos da criação não
     * têm valor anterior — `getByText` global encontraria dois elementos e o teste seria ambíguo.
     */
    const [createEntry, updateEntry] = within(history).getAllByTestId('client-audit-entry');
    /*
     * A CRIAÇÃO tem UM campo com valor publicado (`legalName`); `tradeName` nasceu nulo nos dois
     * lados do par, então não é alteração e não vira linha. Isso é o comportamento correto de
     * `diffAuditEntry`: ele compara o par e ignora o que não mudou, em vez de listar o snapshot.
     */
    expect(within(createEntry!).getAllByText('não havia valor')).toHaveLength(1);
    expect(within(createEntry!).getByText('Amaggi Exportadora LTDA')).toBeInTheDocument();
    // A ATUALIZAÇÃO tem valor anterior real: o nome fantasia saiu de vazio para "Amaggi".
    expect(within(updateEntry!).getByText('não havia valor')).toBeInTheDocument();
    expect(within(updateEntry!).getByText('Amaggi')).toBeInTheDocument();
    // Nenhum ator é afirmado: a trilha publica o identificador da identidade, e a seção não o
    // converte em nome de pessoa nem inventa "sistema".
    expect(history.textContent).not.toMatch(/sistema/i);
  });

  /*
   * NEGADO ≠ VAZIO na trilha. O servidor exige `client:audit:read`, separada de `client:client:read`;
   * quando ele responde 403 a seção DECLARA a restrição. Uma lista vazia afirmaria "não há
   * alterações", que é um fato diferente e falso.
   */
  it('declara a restrição do histórico quando o servidor nega a leitura da trilha', async () => {
    vi.stubGlobal(
      'fetch',
      createClientObjectFetchMock({
        client: clientFixture(),
        auditTrailAccess: 'denied',
      }),
    );
    renderClientPage();
    await awaitHeader();
    await openTab(/histórico/i);

    const history = await screen.findByLabelText('Histórico de alterações');
    expect(
      within(history).getByText(/não tem permissão para consultar o histórico/i),
    ).toBeInTheDocument();
    expect(within(history).queryByText(/nenhuma alteração registrada/i)).not.toBeInTheDocument();
  });

  it('registra a desativação como transição real e oferece a reativação quando autorizada', async () => {
    vi.stubGlobal(
      'fetch',
      createClientObjectFetchMock({
        client: clientFixture({
          status: CLIENT_STATUSES.Inactive,
          updatedAt: '2026-03-02T18:00:00.000Z',
          deactivatedAt: '2026-03-02T18:00:00.000Z',
          deactivationReason: 'Encerramento contratual',
        }),
        auditTrail: [
          auditEntryFixture(1, {
            action: 'TRANSITION',
            before: { status: 'ACTIVE' },
            after: { status: 'INACTIVE' },
          }),
        ],
      }),
    );
    renderClientPage();
    await awaitHeader();
    await openTab(/histórico/i);

    expect(screen.getByLabelText('Status: Inativo')).toBeInTheDocument();

    const history = await screen.findByLabelText('Histórico de alterações');
    expect(within(history).getByText('Situação alterada')).toBeInTheDocument();
    // O par (antes, depois) é o que a trilha acrescenta: a transição mostra de onde veio.
    expect(within(history).getByText('ACTIVE')).toBeInTheDocument();
    expect(within(history).getByText('INACTIVE')).toBeInTheDocument();
    expect(within(history).getAllByTestId('client-audit-entry')).toHaveLength(1);

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
