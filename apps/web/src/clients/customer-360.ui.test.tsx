import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientDetailPage } from './pages/ClientDetailPage';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import {
  CLIENT_STATUSES,
  CONTACT_PURPOSES,
  CONTACT_ROLES,
  PURCHASE_ORDER_REQUIREMENTS,
  type Client,
} from './types/client.types';

/**
 * CUSTOMER 360 — COMPORTAMENTO DOS PAINÉIS OPERÁVEIS.
 *
 * Estes testes cobrem a superfície NOVA desta onda: contatos com papel e principal, unidades com
 * matriz, hierarquia empresarial, qualidade do cadastro e trilha de auditoria.
 *
 * O que eles protegem, e que é o ponto da onda inteira: cada painel é um COMANDO REAL, o servidor
 * continua sendo o boundary, e a UI nunca inventa dado que o backend não publicou.
 */

const CLIENT_ID = '9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
const PROBE_CLIENT_ID = '00000000-0000-4000-8000-000000000001';
const CONTACT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UNIT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

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
    version: 7,
    createdAt: '2026-01-05T12:00:00.000Z',
    updatedAt: '2026-02-10T09:30:00.000Z',
    deactivatedAt: null,
    deactivationReason: null,
    purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.BeforeExecution,
    groupId: null,
    groupName: null,
    parentClientId: null,
    parentClientName: null,
    childCount: 0,
    contacts: [
      {
        id: CONTACT_ID,
        name: 'Operações',
        purpose: CONTACT_PURPOSES.Operational,
        role: null,
        isPrimary: false,
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

type MockOptions = {
  client?: Client;
  /** Resposta dos comandos de contato/unidade: o Cliente devolvido pelo servidor. */
  commandResult?: Client | 'denied' | 'version_conflict';
  /** `denied` prova que a seção de histórico distingue negado de vazio. */
  auditTrailAccess?: 'allowed' | 'denied';
  auditTrail?: unknown[];
  quality?: unknown;
  hierarchy?: unknown;
  updateAllowed?: boolean;
  manageContactsAllowed?: boolean;
};

/**
 * MOCK DO BACKEND com as rotas REAIS do Customer 360.
 *
 * Os comandos (`POST /contacts`, `/units`, `PATCH /hierarchy`) devolvem o CLIENTE INTEIRO, que é o
 * contrato do servidor — a UI substitui o estado pelo que voltou, e não por uma aplicação local
 * otimista. É isso que faz o teste provar que a tela respeita o servidor como fonte da verdade.
 */
function createFetchMock(options: MockOptions = {}) {
  const client = options.client ?? clientFixture();

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

    /*
     * HIDRATAÇÃO DE SESSÃO — `SessionMetaBridge` chama estas duas rotas quando há sessão
     * autenticada, e o provider faz `state.catalog.map(...)` sem guarda. Um catch-all que devolva
     * `[]` para `/command-catalog` deixa `catalog.comandos` `undefined` e o provider ESTOURA, o
     * que apareceria como "a página não renderiza" e não como o defeito real do mock.
     */
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
          ...(options.updateAllowed === false ? [] : ['client:client:update']),
          'client:client:deactivate',
          'client:client:activate',
          ...(options.manageContactsAllowed === false ? [] : ['client:contact:manage']),
          'client:unit:manage',
          'client:hierarchy:manage',
          'client:audit:read',
        ],
        escopo_ativo: null,
        escopos_disponiveis: [{ tipo: 'GLOBAL', resource_id: null, label: 'Global' }],
      });
    }
    if (pathname === '/api/v1/service-orders/command-catalog' && method === 'GET') {
      return jsonResponse({ comandos: [] });
    }

    if (pathname === '/api/v1/clients' && method === 'GET') {
      return jsonResponse({ items: [], limit: 1, offset: 0, total: 0, totalPages: 0 });
    }
    if (pathname === '/api/v1/clients' && method === 'POST') {
      return clientError('CLIENT_VALIDATION_FAILED', 400);
    }
    if (pathname === `/api/v1/clients/${PROBE_CLIENT_ID}`) {
      if (method === 'PATCH') {
        return options.updateAllowed === false
          ? clientError('CLIENT_DENIED', 403)
          : clientError('CLIENT_NOT_FOUND', 404);
      }
      return clientError('CLIENT_NOT_FOUND', 404);
    }
    if (pathname === `/api/v1/clients/${PROBE_CLIENT_ID}/deactivate`) {
      return clientError('CLIENT_NOT_FOUND', 404);
    }
    if (pathname === `/api/v1/clients/${PROBE_CLIENT_ID}/activate`) {
      return clientError('CLIENT_NOT_FOUND', 404);
    }

    if (pathname === `/api/v1/clients/${client.id}` && method === 'GET') {
      return jsonResponse(client);
    }

    /* ── comandos de contato e unidade ─────────────────────────────────────────────── */
    if (
      method !== 'GET' &&
      /^\/api\/v1\/clients\/[^/]+\/(contacts|units)/.test(pathname)
    ) {
      if (options.commandResult === 'denied') {
        return clientError('CLIENT_DENIED', 403);
      }
      if (options.commandResult === 'version_conflict') {
        return clientError('CLIENT_VERSION_CONFLICT', 409);
      }
      return jsonResponse(options.commandResult ?? client);
    }

    if (
      pathname === `/api/v1/clients/${client.id}/hierarchy` &&
      method === 'PATCH'
    ) {
      return jsonResponse(options.hierarchy ?? client);
    }

    if (pathname === `/api/v1/clients/${client.id}/hierarchy` && method === 'GET') {
      return jsonResponse({
        rootId: client.id,
        nodes: [
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
            relation: 'self',
          },
        ],
        truncated: false,
        maxDepth: 8,
      });
    }

    if (pathname === `/api/v1/clients/${client.id}/data-quality`) {
      return jsonResponse(
        options.quality ?? { evaluated: true, isComplete: true, findings: [] },
      );
    }

    if (pathname === `/api/v1/clients/${client.id}/audit-trail`) {
      if (options.auditTrailAccess === 'denied') {
        return clientError('CLIENT_DENIED', 403);
      }
      const items = options.auditTrail ?? [];
      return jsonResponse({ items, limit: 20, offset: 0, total: items.length, totalPages: 1 });
    }

    // Listagens dos módulos da cadeia comercial: vazias e autorizadas.
    if (pathname.includes('/summary')) {
      return jsonResponse({ total: 0 });
    }
    if (method === 'GET') {
      return jsonResponse({ items: [], limit: 20, offset: 0, total: 0, totalPages: 0 });
    }
    return jsonResponse({}, 200);
  });
}

function renderPage(options: MockOptions = {}) {
  vi.stubGlobal('fetch', createFetchMock(options));
  return renderWithProviders(
    <Routes>
      <Route path="/app/clients/:clientId" element={<ClientDetailPage />} />
      <Route path="/app/clients/:clientId/edit" element={<div>Edição</div>} />
      <Route path="/app/clients" element={<div>Clientes</div>} />
    </Routes>,
    // `router.initialEntries` é a forma que `renderWithProviders` publica; a chave no nível de
    // cima é ignorada em silêncio e a página cai na rota padrão, sem o `:clientId`.
    { router: { initialEntries: [`/app/clients/${CLIENT_ID}`] } },
  );
}

async function awaitHeader() {
  await screen.findByRole('heading', { name: /Amaggi Exportadora LTDA/ });
}

/**
 * NAVEGAÇÃO POR ABAS — a ficha passou a usar DIVULGAÇÃO PROGRESSIVA.
 *
 * O detalhe (contatos, estrutura, qualidade, histórico) deixou de ficar sempre renderizado e
 * desceu para abas. Os testes abrem a aba correspondente antes de afirmar sobre o painel — o que
 * é exatamente o comportamento novo: o painel não monta até ser pedido, e portanto também não
 * dispara a leitura de rede correspondente.
 */
async function openTab(name: RegExp): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name }));
}

beforeEach(() => {
  resetTokenStoreForTests();
  tokenStore.setTokens('access-token', 'refresh-token');
  vi.unstubAllGlobals();
});

describe('Customer 360 — contatos', () => {
  it('mostra o papel declarado e o selo de principal', async () => {
    renderPage({
      client: clientFixture({
        contacts: [
          {
            id: CONTACT_ID,
            name: 'Fulano de Tal',
            purpose: CONTACT_PURPOSES.Commercial,
            role: CONTACT_ROLES.Purchasing,
            isPrimary: true,
            deactivatedAt: null,
            email: 'compras@amaggi.invalid',
            phone: null,
          },
        ],
      }),
    });
    await awaitHeader();

    const row = screen.getByTestId('client-contact-row');
    expect(within(row).getByText('Fulano de Tal')).toBeInTheDocument();
    expect(within(row).getByText('Principal')).toBeInTheDocument();
    // O PAPEL aparece pelo rótulo humano. O valor do enum NUNCA é renderizado como texto.
    expect(within(row).getByText('Compras')).toBeInTheDocument();
    expect(row.textContent).not.toContain('purchasing');
  });

  /*
   * PAPEL NÃO DECLARADO NÃO VIRA RÓTULO. `role: null` é um estado legítimo — o backfill da
   * migration 0097 não atribuiu papel a nenhum contato histórico — e a linha simplesmente não
   * afirma nada sobre o papel.
   */
  it('não inventa rótulo de papel quando ele não foi declarado', async () => {
    renderPage();
    await awaitHeader();

    await waitFor(() => {
      expect(screen.queryByTestId('client-contact-role')).toBeInTheDocument();
    });

    const row = screen.getByTestId('client-contact-row');
    /*
     * O CONTROLE mostra o estado real de ausência (opção vazia), e nenhum TEXTO de papel é
     * afirmado ao lado do contato. A opção "Não declarado" dentro do `<select>` é o rótulo da
     * escolha de remover/ausência — ela não é uma afirmação sobre este contato, e por isso a
     * asserção olha o conteúdo FORA do controle.
     */
    const select = within(row).getByTestId<HTMLSelectElement>('client-contact-role');
    expect(select.value).toBe('');

    const summaryText = row.textContent ?? '';
    const selectText = select.textContent ?? '';
    const outsideSelect = summaryText.replace(selectText, '');
    expect(outsideSelect).not.toMatch(/não informado|não declarado/i);
  });

  it('despacha o comando de tornar principal e adota o Cliente devolvido pelo servidor', async () => {
    const serverClient = clientFixture({
      version: 8,
      contacts: [
        {
          id: CONTACT_ID,
          name: 'Operações',
          purpose: CONTACT_PURPOSES.Operational,
          role: null,
          isPrimary: true,
          deactivatedAt: null,
          email: 'ops@amaggi.invalid',
          phone: null,
        },
      ],
    });
    const fetchMock = createFetchMock({ commandResult: serverClient });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(
      <Routes>
        <Route path="/app/clients/:clientId" element={<ClientDetailPage />} />
        <Route path="/app/clients/:clientId/edit" element={<div>Edição</div>} />
        <Route path="/app/clients" element={<div>Clientes</div>} />
      </Routes>,
      { router: { initialEntries: [`/app/clients/${CLIENT_ID}`] } },
    );
    await awaitHeader();

    const user = userEvent.setup();
    /*
     * A CAPABILITY CHEGA DEPOIS DO CABEÇALHO: `useClientCapabilities` sonda o servidor em paralelo
     * com a leitura do cadastro, então o comando aparece um tick após o título. Esperar pelo
     * CONTROLE (e não por um tempo fixo) é o que torna o teste determinístico.
     */
    await waitFor(() => {
      expect(screen.queryByTestId('client-contact-set-primary')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('client-contact-set-primary'));

    await waitFor(() => {
      expect(screen.getByTestId('client-contact-row').textContent).toContain('Principal');
    });

    /*
     * A CHAMADA FOI PARA A ROTA REAL, com a versão que o Cliente publicava.
     *
     * `fetch` recebe `RequestInfo | URL`; os dois primeiros argumentos são convertidos pelo MESMO
     * helper que a rota usa, em vez de stringificação implícita — `String(input)` sobre um `Request`
     * devolveria `[object Request]` e a comparação passaria a depender do tipo que o cliente HTTP
     * escolheu usar.
     */
    const primaryCall = fetchMock.mock.calls.find(([input]) => {
      const raw =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      return raw.includes(`/contacts/${CONTACT_ID}/primary`);
    });
    expect(primaryCall).toBeDefined();
    const body = primaryCall?.[1]?.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toEqual({ version: 7 });
  });

  /*
   * INATIVAR É O CAMINHO NORMAL E PRESERVA O HISTÓRICO: o contato sai de operação mas a linha
   * continua na ficha, agrupada e esmaecida. O teste fixa as duas metades dessa regra.
   */
  it('inativa o contato sem removê-lo da ficha', async () => {
    const serverClient = clientFixture({
      version: 8,
      contacts: [
        {
          id: CONTACT_ID,
          name: 'Operações',
          purpose: CONTACT_PURPOSES.Operational,
          role: null,
          isPrimary: false,
          deactivatedAt: '2026-03-01T10:00:00.000Z',
          email: 'ops@amaggi.invalid',
          phone: null,
        },
      ],
    });
    vi.stubGlobal('fetch', createFetchMock({ commandResult: serverClient }));
    renderWithProviders(
      <Routes>
        <Route path="/app/clients/:clientId" element={<ClientDetailPage />} />
        <Route path="/app/clients" element={<div>Clientes</div>} />
      </Routes>,
      { router: { initialEntries: [`/app/clients/${CLIENT_ID}`] } },
    );
    await awaitHeader();

    const user = userEvent.setup();
    // A capability chega após o cabeçalho: espera pelo CONTROLE antes de interagir.
    await waitFor(() => {
      expect(screen.queryByTestId('client-contact-deactivate')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('client-contact-deactivate'));

    // O contato CONTINUA na ficha, agora no grupo de inativos e com o comando de reativar.
    await waitFor(() => {
      expect(screen.getByText('Inativos')).toBeInTheDocument();
    });
    expect(screen.getByText('Operações')).toBeInTheDocument();
    expect(screen.getByTestId('client-contact-reactivate')).toBeInTheDocument();
  });

  /* SEM CAPABILITY O PAINEL É SOMENTE LEITURA — nenhum comando é oferecido. */
  it('não oferece comandos de contato sem a capability', async () => {
    renderPage({ manageContactsAllowed: false });
    await awaitHeader();

    await waitFor(() => {
      expect(screen.queryByTestId('client-contact-set-primary')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('client-contact-add-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('client-contact-deactivate')).not.toBeInTheDocument();
    // A leitura continua: o painel não desaparece, apenas não é operável.
    expect(screen.getByTestId('client-contact-row')).toBeInTheDocument();
  });
});

describe('Customer 360 — unidades', () => {
  it('mostra a matriz declarada e a contagem real de endereços', async () => {
    renderPage({
      client: clientFixture({
        units: [
          {
            id: UNIT_ID,
            name: 'Matriz Cuiabá',
            isHeadquarters: true,
            city: 'Cuiabá',
            state: 'MT',
            addressCount: 2,
          },
          {
            id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            name: 'Filial Vilhena',
            isHeadquarters: false,
            city: 'Vilhena',
            state: 'RO',
            addressCount: 0,
          },
        ],
      }),
    });
    await awaitHeader();
    await openTab(/estrutura/i);
    const rows = screen.getAllByTestId('client-unit-row');
    expect(rows).toHaveLength(2);
    // MATRIZ PRIMEIRO: a ordenação respeita o dado declarado, não a ordem de cadastro.
    expect(rows[0]?.textContent).toContain('Matriz Cuiabá');
    expect(within(rows[0]!).getByText('Matriz')).toBeInTheDocument();
    expect(rows[0]?.textContent).toContain('2 endereços');
    // Zero é AFIRMADO pelo servidor e é informação útil: a unidade existe sem endereço vinculado.
    expect(rows[1]?.textContent).toContain('sem endereço vinculado');
  });

  it('declara uma unidade nova pelo comando do servidor', async () => {
    const serverClient = clientFixture({
      version: 8,
      units: [
        {
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          name: 'Filial Vilhena',
          isHeadquarters: false,
          city: 'Vilhena',
          state: 'RO',
          addressCount: 0,
        },
      ],
    });
    const fetchMock = createFetchMock({ commandResult: serverClient });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/app/clients/:clientId" element={<ClientDetailPage />} />
        <Route path="/app/clients" element={<div>Clientes</div>} />
      </Routes>,
      { router: { initialEntries: [`/app/clients/${CLIENT_ID}`] } },
    );
    await awaitHeader();
    await openTab(/estrutura/i);

    const user = userEvent.setup();
    // A capability chega após o cabeçalho: espera pelo CONTROLE antes de interagir.
    await waitFor(() => {
      expect(screen.queryByTestId('client-unit-add-toggle')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('client-unit-add-toggle'));
    await user.type(screen.getByTestId('client-unit-name'), 'Filial Vilhena');
    await user.type(screen.getByTestId('client-unit-city'), 'Vilhena');
    await user.type(screen.getByTestId('client-unit-state'), 'RO');
    await user.click(screen.getByRole('button', { name: 'Declarar unidade' }));

    await waitFor(() => {
      expect(screen.getAllByTestId('client-unit-row')).toHaveLength(1);
    });
    expect(screen.getByText('Filial Vilhena')).toBeInTheDocument();
  });
});

describe('Customer 360 — hierarquia', () => {
  it('declara que não há vínculo em vez de sugerir hierarquia provável', async () => {
    renderPage();
    await awaitHeader();
    await openTab(/estrutura/i);

    const panel = await screen.findByLabelText('Hierarquia empresarial');
    await waitFor(() => {
      expect(
        within(panel).getByText(/nenhum vínculo declarado/i),
      ).toBeInTheDocument();
    });
  });

  it('mostra o grupo econômico declarado', async () => {
    renderPage({
      client: clientFixture({ groupId: 'g-1', groupName: 'Grupo Amaggi' }),
    });
    await awaitHeader();
    await openTab(/estrutura/i);

    const panel = await screen.findByLabelText('Hierarquia empresarial');
    /*
     * O grupo declarado aparece no PAINEL, e o texto é procurado no CONTEÚDO do painel em vez de
     * por um elemento exato: o nome é renderizado em mais de um lugar (a cadeia e o par
     * rótulo/valor), e casar por `getByText` seria ambíguo por construção, não por defeito.
     */
    await waitFor(() => {
      expect(panel.textContent).toContain('Grupo Amaggi');
    });
  });
});

describe('Customer 360 — qualidade do cadastro', () => {
  it('lista os apontamentos com severidade e consequência, sem nota', async () => {
    renderPage({
      quality: {
        evaluated: true,
        isComplete: false,
        findings: [
          {
            code: 'MISSING_OPERATIONAL_CONTACT',
            severity: 'blocking',
            summary: 'Sem contato operacional utilizável.',
            consequence: 'O cadastro não pode ser atualizado.',
          },
          {
            code: 'MISSING_EXTERNAL_REFERENCE',
            severity: 'advisory',
            summary: 'Sem referência externa.',
            consequence: 'O Cliente não é correlacionável com o ERP de origem.',
          },
        ],
      },
    });
    await awaitHeader();
    await openTab(/qualidade/i);

    const panel = await screen.findByLabelText('Qualidade do cadastro');
    await waitFor(() => {
      expect(within(panel).getAllByTestId('client-quality-finding')).toHaveLength(2);
    });
    expect(within(panel).getByText('Sem contato operacional utilizável.')).toBeInTheDocument();
    expect(within(panel).getByText('Bloqueia operação')).toBeInTheDocument();
    expect(within(panel).getByText('Recomendação')).toBeInTheDocument();
    // A CONSEQUÊNCIA é o que torna o apontamento acionável.
    expect(within(panel).getByText('O cadastro não pode ser atualizado.')).toBeInTheDocument();
    // NENHUMA NOTA: o painel não publica percentual nem score.
    expect(panel.textContent).not.toMatch(/\d+\s?%/);
  });

  it('afirma completude quando o servidor diz que não há apontamento', async () => {
    renderPage({ quality: { evaluated: true, isComplete: true, findings: [] } });
    await awaitHeader();
    await openTab(/qualidade/i);

    const panel = await screen.findByLabelText('Qualidade do cadastro');
    await waitFor(() => {
      expect(within(panel).getByText('Sem pendências')).toBeInTheDocument();
    });
  });
});

describe('Customer 360 — trilha de auditoria', () => {
  it('mostra o par antes/depois de cada alteração', async () => {
    renderPage({
      auditTrail: [
        {
          id: 'a-1',
          action: 'UPDATE',
          actorIdentityId: '11111111-1111-4111-8111-111111111111',
          correlationId: 'c-1',
          occurredAt: '2026-02-10T09:30:00.000Z',
          before: { tradeName: null, status: 'ACTIVE' },
          after: { tradeName: 'Amaggi', status: 'INACTIVE' },
        },
      ],
    });
    await awaitHeader();
    await openTab(/histórico/i);

    const panel = await screen.findByLabelText('Histórico de alterações');
    await waitFor(() => {
      expect(within(panel).getAllByTestId('client-audit-entry')).toHaveLength(1);
    });
    expect(within(panel).getByText('Cadastro alterado')).toBeInTheDocument();
    // O PAR: o valor anterior e o novo, ambos visíveis. É o que a trilha acrescenta.
    expect(within(panel).getByText('não havia valor')).toBeInTheDocument();
    expect(within(panel).getByText('Amaggi')).toBeInTheDocument();
    expect(within(panel).getByText('ACTIVE')).toBeInTheDocument();
    expect(within(panel).getByText('INACTIVE')).toBeInTheDocument();
  });

  it('declara a restrição quando o servidor nega a leitura da trilha', async () => {
    renderPage({ auditTrailAccess: 'denied' });
    await awaitHeader();
    await openTab(/histórico/i);

    const panel = await screen.findByLabelText('Histórico de alterações');
    await waitFor(() => {
      expect(within(panel).getByText(/não tem permissão/i)).toBeInTheDocument();
    });
    // NEGADO ≠ VAZIO: a mensagem de "nenhuma alteração" não aparece.
    expect(within(panel).queryByText(/nenhuma alteração registrada/i)).not.toBeInTheDocument();
  });

  it('declara ausência real de alterações quando a trilha volta vazia', async () => {
    renderPage({ auditTrail: [] });
    await awaitHeader();
    await openTab(/histórico/i);

    const panel = await screen.findByLabelText('Histórico de alterações');
    await waitFor(() => {
      expect(within(panel).getByText(/nenhuma alteração registrada/i)).toBeInTheDocument();
    });
  });
});
