import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceOrderCreatePage } from './ServiceOrderCreatePage';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { renderWithProviders } from '../../test/render-with-providers';

/**
 * NOVA OS — O CONTRATO REAL DE CRIAÇÃO.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE TESTE PROTEGE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * O formulário anterior era um bloco inline cujo envio era RECUSADO pela própria tela, com a
 * mensagem "a ordem nasce de uma solicitação aprovada ou proposta aceita. Abra a origem e
 * converta." Lendo `validateCreateServiceOrderInput`, essa mensagem está ERRADA:
 *
 *   - `SERVICE_REQUEST` é recusada na criação (correto) — e por isso NÃO é oferecida;
 *   - `PROPOSAL` exige `proposalId`; `PURCHASE_ORDER` exige `purchaseOrderId`;
 *   - `AUTHORIZED_DIRECT` + `unitId` é criação VÁLIDA.
 *
 * Os testes abaixo prendem as três regras do SERVIDOR do lado da UI: a origem não oferecida, a
 * exigência de vínculo por origem, e o POST que de fato sai com o payload correto.
 */

const CREATED_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createFetchMock(options: { units?: string[]; createStatus?: number } = {}) {
  const units = options.units ?? ['UNIDADE-A', 'UNIDADE-B'];
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const pathname = new URL(raw, 'http://127.0.0.1').pathname;
    const method = (init?.method ?? 'GET').toUpperCase();

    if (pathname === '/api/v1/auth/session') {
      return jsonResponse({
        identityId: '11111111-1111-4111-8111-111111111111',
        session: { id: 'sid', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
      });
    }
    if (pathname === '/api/v1/me') {
      return jsonResponse({ identity_id: '11111111-1111-4111-8111-111111111111', permissoes_efetivas: [] });
    }
    if (pathname === '/api/v1/service-orders/command-catalog') {
      return jsonResponse({ comandos: [] });
    }
    // LOOKUP DE UNIDADE — a origem do dado é o servidor, não uma lista no frontend.
    if (pathname === '/api/v1/requests/service-requests/operational-units') {
      return jsonResponse({ items: units });
    }
    if (pathname === '/api/v1/service-orders' && method === 'POST') {
      if (options.createStatus && options.createStatus >= 400) {
        return jsonResponse(
          { error: { code: 'SERVICE_ORDERS_VALIDATION_FAILED', message: 'invalid' } },
          options.createStatus,
        );
      }
      return jsonResponse({ id: CREATED_ID, orderNumber: 'OS-2026-0001', status: 'DRAFT' }, 201);
    }
    return jsonResponse({ items: [], limit: 20, offset: 0, total: 0 });
  });
}

function renderCreate(options: { units?: string[]; createStatus?: number } = {}) {
  const mock = createFetchMock(options);
  vi.stubGlobal('fetch', mock);
  renderWithProviders(
    <Routes>
      <Route path="/app/service-orders/new" element={<ServiceOrderCreatePage />} />
      <Route path="/app/service-orders/:id" element={<div>Ficha da OS</div>} />
      <Route path="/app/service-orders" element={<div>Worklist de OS</div>} />
    </Routes>,
    { router: { initialEntries: ['/app/service-orders/new'] } },
  );
  return mock;
}

async function awaitForm() {
  await waitFor(() => {
    expect(screen.getByTestId('so-create-origin')).toBeInTheDocument();
  });
}

function postCalls(mock: ReturnType<typeof createFetchMock>) {
  return mock.mock.calls.filter(([url, init]) => {
    const raw = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    return raw.endsWith('/api/v1/service-orders') && init?.method === 'POST';
  });
}

/**
 * CORPO DO POST EM TIPAGEM ESTRITA.
 *
 * `JSON.parse` devolve `any`, e ler `.origin` de um `any` desliga a checagem justamente no ponto
 * em que o teste afirma o CONTRATO enviado ao servidor. O cast é declarado uma vez, aqui, com o
 * formato que o teste espera — em vez de espalhar acesso não checado por cada asserção.
 */
type CreateBody = {
  origin?: string;
  unitId?: string;
  proposalId?: string;
  purchaseOrderId?: string;
  description?: string;
};

function firstPostBody(mock: ReturnType<typeof createFetchMock>): CreateBody {
  const call = postCalls(mock)[0];
  const body = call?.[1]?.body;
  if (typeof body !== 'string') {
    throw new Error('POST sem corpo string');
  }
  return JSON.parse(body) as CreateBody;
}

beforeEach(() => {
  resetTokenStoreForTests();
  tokenStore.setTokens('access-token', 'refresh-token');
  vi.unstubAllGlobals();
});

describe('Nova OS — contrato de criação', () => {
  /*
   * `SERVICE_REQUEST` NÃO É OFERECIDA.
   * O servidor recusa essa origem na criação; oferecê-la produziria um 400 garantido e ensinaria
   * o operador a não confiar no formulário.
   */
  it('não oferece a origem de solicitação, que o servidor recusa na criação', async () => {
    renderCreate();
    await awaitForm();

    const select = screen.getByTestId<HTMLSelectElement>('so-create-origin');
    const values = [...select.options].map((option) => option.value);
    expect(values).not.toContain('SERVICE_REQUEST');
    expect(values).toContain('AUTHORIZED_DIRECT');
    expect(values).toContain('PROPOSAL');
    expect(values).toContain('PURCHASE_ORDER');
  });

  /*
   * SEM UNIDADE AUTORIZADA — O ESTADO REAL DE PRODUÇÃO.
   *
   * `GET operational-units` devolve `{"items":[]}` em produção, porque nenhuma unidade está
   * registrada no escopo do ator. O servidor exige `unitId` e recusa unidade fora do escopo
   * (`assertUnitRegistered`), então NÃO existe valor digitável que satisfaça a regra.
   *
   * As duas provas que importam: a tela NOMEIA o bloqueio, e NÃO inventa uma saída falsa —
   * não oferece campo livre para unidade, o que trocaria um bloqueio honesto por um 400.
   */
  it('declara o bloqueio sem oferecer campo livre para a unidade', async () => {
    const mock = renderCreate({ units: [] });
    await awaitForm();

    expect(screen.getByTestId('so-create-no-unit')).toHaveTextContent(
      'Registre a unidade operacional no seu escopo e volte a esta tela.',
    );

    // O controle continua sendo um SELETOR — não vira texto livre.
    const select = screen.getByTestId<HTMLSelectElement>('so-create-unit');
    expect(select.tagName).toBe('SELECT');
    expect([...select.options].map((option) => option.value)).toEqual(['']);

    // E nenhum POST sai enquanto o bloqueio existir.
    expect(postCalls(mock)).toHaveLength(0);
  });

  /* As unidades vêm do servidor — o formulário não mantém lista própria. */
  it('oferece as unidades autorizadas publicadas pelo servidor', async () => {
    renderCreate({ units: ['UNIDADE-A', 'UNIDADE-B'] });
    await awaitForm();

    await waitFor(() => {
      const select = screen.getByTestId<HTMLSelectElement>('so-create-unit');
      expect([...select.options].map((o) => o.value)).toEqual(['UNIDADE-A', 'UNIDADE-B']);
    });
  });

  /*
   * CRIAÇÃO DIRETA AUTORIZADA — a operação que a tela anterior dizia ser impossível.
   * O POST precisa sair com `origin` e `unitId`, que são o mínimo do contrato.
   */
  it('cria a OS com origem direta e navega para a ficha com o id do servidor', async () => {
    const mock = renderCreate({ units: ['UNIDADE-A'] });
    await awaitForm();

    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId<HTMLSelectElement>('so-create-unit').value).toBe('UNIDADE-A');
    });
    await user.click(screen.getByTestId('so-create-submit'));

    await waitFor(() => {
      expect(postCalls(mock)).toHaveLength(1);
    });

    const body = firstPostBody(mock);
    expect(body.origin).toBe('AUTHORIZED_DIRECT');
    expect(body.unitId).toBe('UNIDADE-A');
    // Campo vazio NÃO é enviado: mandar `description: ""` seria enviar dado que o operador não deu.
    expect(body).not.toHaveProperty('description');
    expect(body).not.toHaveProperty('proposalId');

    // Navegou para a ficha usando o ID DEVOLVIDO PELO SERVIDOR, não um id local.
    expect(await screen.findByText('Ficha da OS')).toBeInTheDocument();
  });

  /* PROPOSAL exige o vínculo: a tela antecipa a regra do servidor antes de enviar. */
  it('exige o identificador da proposta quando a origem é proposta', async () => {
    const mock = renderCreate({ units: ['UNIDADE-A'] });
    await awaitForm();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByTestId('so-create-origin'), 'PROPOSAL');

    // O campo de vínculo aparece por causa da origem escolhida.
    expect(await screen.findByTestId('so-create-proposal')).toBeInTheDocument();

    await user.click(screen.getByTestId('so-create-submit'));

    // Sem o vínculo, NENHUM POST parte — a tela recusa antes do servidor.
    expect(await screen.findByText(/informe o identificador da proposta/i)).toBeInTheDocument();
    expect(postCalls(mock)).toHaveLength(0);
  });

  it('exige o identificador do pedido de compra quando a origem é pedido', async () => {
    const mock = renderCreate({ units: ['UNIDADE-A'] });
    await awaitForm();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByTestId('so-create-origin'), 'PURCHASE_ORDER');
    expect(await screen.findByTestId('so-create-purchase-order')).toBeInTheDocument();

    await user.click(screen.getByTestId('so-create-submit'));
    /*
     * A asserção é escopada na MENSAGEM DE ERRO, não no texto solto: "identificador do pedido de
     * compra" aparece também no RÓTULO do campo, e uma busca global casaria os dois — ambiguidade
     * do matcher, não defeito da tela.
     */
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/identificador do pedido de compra/i);
    expect(postCalls(mock)).toHaveLength(0);
  });

  /* Com o vínculo informado, o POST leva o campo da origem correta. */
  it('envia o vínculo de proposta quando informado', async () => {
    const mock = renderCreate({ units: ['UNIDADE-A'] });
    await awaitForm();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByTestId('so-create-origin'), 'PROPOSAL');
    await user.type(
      await screen.findByTestId('so-create-proposal'),
      '11111111-2222-4333-8444-555555555555',
    );
    await user.click(screen.getByTestId('so-create-submit'));

    await waitFor(() => {
      expect(postCalls(mock)).toHaveLength(1);
    });
    const body = firstPostBody(mock);
    expect(body.origin).toBe('PROPOSAL');
    expect(body.proposalId).toBe('11111111-2222-4333-8444-555555555555');
    expect(body).not.toHaveProperty('purchaseOrderId');
  });

  /*
   * SEM UNIDADE AUTORIZADA O COMANDO FICA DESABILITADO — e isso é dito, não silenciado.
   * O servidor exige `unitId`; enviar sem ele produziria um 400 garantido.
   */
  it('desabilita a criação quando não há unidade autorizada', async () => {
    renderCreate({ units: [] });
    await awaitForm();

    await waitFor(() => {
      expect(screen.getByTestId('so-create-submit')).toBeDisabled();
    });
    /*
     * Consulta pelo TESTID do painel, não por texto solto.
     *
     * `getByText(/nenhuma unidade autorizada/i)` passou a casar DOIS nós quando o painel de
     * bloqueio foi adicionado: a própria `<option>` do seletor tem esse rótulo, e o painel
     * repete a expressão no título. Ambiguidade real de tela — resolvida aqui apontando para o
     * nó que este teste quer provar, em vez de afrouxar o matcher.
     */
    expect(screen.getByTestId('so-create-no-unit')).toHaveTextContent(
      'Nenhuma unidade autorizada no seu escopo.',
    );
  });

  /* Falha do servidor vira causa legível, e não um código cru. */
  it('traduz a recusa do servidor em mensagem de causa', async () => {
    renderCreate({ units: ['UNIDADE-A'], createStatus: 400 });
    await awaitForm();

    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId<HTMLSelectElement>('so-create-unit').value).toBe('UNIDADE-A');
    });
    await user.click(screen.getByTestId('so-create-submit'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/não foram aceitos|confira a origem/i);
    // O código interno do módulo NÃO aparece na tela.
    expect(alert.textContent).not.toContain('SERVICE_ORDERS_VALIDATION_FAILED');
  });
});
