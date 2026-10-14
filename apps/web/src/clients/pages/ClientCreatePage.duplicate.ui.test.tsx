import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientCreatePage } from './ClientCreatePage';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { renderWithProviders } from '../../test/render-with-providers';

/**
 * DUPLICIDADE NO CADASTRO — O QUE O TESTE PROTEGE.
 *
 * A API `duplicate-check` existia sem consumidor. Esta ligação é o que impede o operador de criar
 * um segundo registro da mesma empresa sem aviso — e o que garante que a decisão de bloquear vs.
 * apenas avisar venha da CLASSIFICAÇÃO DO SERVIDOR, e não de heurística local.
 *
 * As três regras que não podem regredir:
 *   1. coincidência PROVADA (documento/referência) BLOQUEIA o cadastro;
 *   2. SUSPEITA (nome) NÃO bloqueia — apenas avisa, e o operador decide;
 *   3. nenhum caminho funde registros automaticamente.
 */

const PROBE_CLIENT_ID = '00000000-0000-4000-8000-000000000001';
const EXISTING_CLIENT_ID = '11111111-1111-4111-8111-111111111111';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientError(code: string, status: number): Response {
  return jsonResponse({ error: { code, message: code } }, status);
}

type DuplicateFixture = {
  matches: Array<{
    id: string;
    legalName: string;
    tradeName: string | null;
    normalizedTaxId: string;
    externalErpId: string | null;
    status: string;
    reasons: string[];
    certain: boolean;
  }>;
  certainCount: number;
  suspectedCount: number;
};

const NO_DUPLICATES: DuplicateFixture = { matches: [], certainCount: 0, suspectedCount: 0 };

const CERTAIN_DUPLICATE: DuplicateFixture = {
  certainCount: 1,
  suspectedCount: 0,
  matches: [
    {
      id: EXISTING_CLIENT_ID,
      legalName: 'Alfa Madeira LTDA',
      tradeName: 'Alfa Madeira',
      normalizedTaxId: '11222333000181',
      externalErpId: null,
      status: 'ACTIVE',
      reasons: ['TAX_ID_MATCH'],
      certain: true,
    },
  ],
};

const SUSPECTED_DUPLICATE: DuplicateFixture = {
  certainCount: 0,
  suspectedCount: 1,
  matches: [
    {
      id: EXISTING_CLIENT_ID,
      legalName: 'Alfa Madeira LTDA',
      tradeName: 'Alfa Madeira',
      normalizedTaxId: '99999999999999',
      externalErpId: null,
      status: 'ACTIVE',
      reasons: ['LEGAL_NAME_MATCH'],
      certain: false,
    },
  ],
};

/** Converte o alvo do `fetch` em texto pelo MESMO caminho que o cliente HTTP usa. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.toString() : input.url;
}

function createFetchMock(options: { duplicate?: DuplicateFixture | 'denied' | 'error' } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = requestUrl(input);
    const pathname = new URL(raw, 'http://127.0.0.1').pathname;
    const method = (init?.method ?? 'GET').toUpperCase();

    if (pathname === '/api/v1/auth/session') {
      return jsonResponse({
        identityId: '11111111-1111-4111-8111-111111111111',
        session: { id: 'sid', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
      });
    }
    // Hidratação de sessão: o provider faz `catalog.comandos.map` sem guarda.
    if (pathname === '/api/v1/me') {
      return jsonResponse({ identity_id: '11111111-1111-4111-8111-111111111111', permissoes_efetivas: [] });
    }
    if (pathname === '/api/v1/service-orders/command-catalog') {
      return jsonResponse({ comandos: [] });
    }

    // DUPLICATE-CHECK — a rota sob teste. Declarada antes de `:clientId` por ordem de rota.
    if (pathname === '/api/v1/clients/duplicate-check') {
      const fixture = options.duplicate ?? NO_DUPLICATES;
      if (fixture === 'denied') {
        return clientError('CLIENT_DENIED', 403);
      }
      if (fixture === 'error') {
        return clientError('CLIENT_INTERNAL', 500);
      }
      return jsonResponse({ checked: true, ...fixture });
    }

    if (pathname === '/api/v1/clients' && method === 'GET') {
      return jsonResponse({ items: [], limit: 1, offset: 0, total: 0, totalPages: 0 });
    }
    if (pathname === '/api/v1/clients' && method === 'POST') {
      return clientError('CLIENT_VALIDATION_FAILED', 400);
    }
    if (pathname === `/api/v1/clients/${PROBE_CLIENT_ID}` && method === 'PATCH') {
      return clientError('CLIENT_NOT_FOUND', 404);
    }
    if (method === 'GET') {
      return jsonResponse({ items: [], limit: 20, offset: 0, total: 0, totalPages: 0 });
    }
    return jsonResponse({}, 200);
  });
}

function renderCreate(options: { duplicate?: DuplicateFixture | 'denied' | 'error' } = {}) {
  vi.stubGlobal('fetch', createFetchMock(options));
  return renderWithProviders(
    <Routes>
      <Route path="/app/clients/new" element={<ClientCreatePage />} />
      <Route path="/app/clients/:clientId" element={<div>Object page</div>} />
      <Route path="/app/clients" element={<div>Lista</div>} />
    </Routes>,
    { router: { initialEntries: ['/app/clients/new'] } },
  );
}

/**
 * ESPERA PELO CAMPO, NÃO PELO TÍTULO.
 *
 * A página tem DOIS estados com o mesmo `<h1>Novo Cliente</h1>`: enquanto `useClientCapabilities`
 * resolve, ela mostra "Verificando permissões…" sob o MESMO heading. Esperar pelo heading passaria
 * no estado de CARGA, e o formulário ainda não existiria — armadilha já documentada no teste
 * original da página. A espera é pelo CAMPO, que só aparece quando a tela é de fato utilizável.
 */
async function awaitForm() {
  await waitFor(() => {
    expect(screen.getByLabelText(/razão social/i)).toBeInTheDocument();
  });
}

/** Preenche CNPJ e razão social suficientes para disparar a consulta. */
async function fillIdentity(user: ReturnType<typeof userEvent.setup>, taxId = '11222333000181') {
  await user.type(screen.getByLabelText(/razão social/i), 'Alfa Madeira LTDA');
  await user.type(screen.getByLabelText(/^CNPJ/i), taxId);
}

beforeEach(() => {
  resetTokenStoreForTests();
  tokenStore.setTokens('access-token', 'refresh-token');
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ClientCreatePage — duplicate check', () => {
  it('does not query the server before there is a usable signal', async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderCreate();
    await awaitForm();

    const user = userEvent.setup();
    // Um único caractere não é sinal: disparar aqui seria uma requisição por tecla.
    await user.type(screen.getByLabelText(/razão social/i), 'A');

    await new Promise((resolve) => setTimeout(resolve, 600));
    const calls = fetchMock.mock.calls.filter(([url]) =>
      requestUrl(url).includes('/duplicate-check'),
    );
    expect(calls).toHaveLength(0);
  });

  it('blocks creation and offers the existing client on a proven match', async () => {
    renderCreate({ duplicate: CERTAIN_DUPLICATE });
    await awaitForm();

    const user = userEvent.setup();
    await fillIdentity(user);

    const warning = await screen.findByTestId('duplicate-certain');
    expect(within(warning).getByText('Cliente já existente')).toBeInTheDocument();
    // O candidato é identificado por nome E documento — nunca só por um identificador técnico.
    expect(within(warning).getByText('Alfa Madeira LTDA')).toBeInTheDocument();
    expect(within(warning).getByText('11.222.333/0001-81')).toBeInTheDocument();
    // A razão do sinal é dita em TEXTO: o código do servidor não aparece na tela.
    expect(within(warning).getByText(/mesmo CNPJ/)).toBeInTheDocument();
    expect(warning.textContent).not.toContain('TAX_ID_MATCH');

    // O comando primário fica VISÍVEL e DESABILITADO — não desaparece.
    const submit = screen.getByRole('button', { name: /cadastrar cliente/i });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/cadastro bloqueado/i)).toBeInTheDocument();

    // O caminho oferecido é ABRIR o cadastro existente — nunca fundir.
    expect(screen.getByRole('link', { name: /abrir cliente/i })).toHaveAttribute(
      'href',
      `/app/clients/${EXISTING_CLIENT_ID}`,
    );
  });

  it('warns but does NOT block on a suspected match', async () => {
    renderCreate({ duplicate: SUSPECTED_DUPLICATE });
    await awaitForm();

    const user = userEvent.setup();
    await fillIdentity(user, '11222333000262');

    const warning = await screen.findByTestId('duplicate-suspected');
    expect(within(warning).getByText('Possível cliente já cadastrado')).toBeInTheDocument();
    expect(within(warning).getByText(/mesma razão social/)).toBeInTheDocument();

    /*
     * NÃO BLOQUEIA. Duas empresas distintas podem ter o mesmo nome, e bloquear por semelhança
     * ensinaria o operador a contornar o aviso. Ele decide.
     */
    expect(screen.getByRole('button', { name: /cadastrar cliente/i })).toBeEnabled();
    expect(screen.queryByTestId('duplicate-certain')).not.toBeInTheDocument();
  });

  it('shows no warning when the server proves there is no duplicate', async () => {
    renderCreate({ duplicate: NO_DUPLICATES });
    await awaitForm();

    const user = userEvent.setup();
    await fillIdentity(user);

    // Nada aparece — e isso é diferente de "não consultou", que tem aviso próprio.
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByTestId('duplicate-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('duplicate-check-unavailable')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cadastrar cliente/i })).toBeEnabled();
  });

  /*
   * FALHA NA CHECAGEM NÃO BLOQUEIA — mas TAMBÉM NÃO PASSA EM SILÊNCIO.
   *
   * Sem aviso, o operador não distinguiria "consultei e não há duplicidade" de "não consegui
   * consultar". O servidor continua barrando o CNPJ idêntico no INSERT.
   */
  it('declares an unavailable check without blocking creation', async () => {
    renderCreate({ duplicate: 'error' });
    await awaitForm();

    const user = userEvent.setup();
    await fillIdentity(user);

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-check-unavailable')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /cadastrar cliente/i })).toBeEnabled();
  });

  /* Negação de permissão de lista também é declarada, e também não bloqueia. */
  it('declares an unauthorized check without blocking creation', async () => {
    renderCreate({ duplicate: 'denied' });
    await awaitForm();

    const user = userEvent.setup();
    await fillIdentity(user);

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-check-unavailable')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /cadastrar cliente/i })).toBeEnabled();
  });

  /*
   * ENTER NÃO ESCAPA DO BLOQUEIO.
   *
   * Com o botão `disabled`, o navegador NÃO dispara o submit do formulário — então esta é a
   * proteção de fato, e a guarda dentro de `handleSubmit` é a segunda barreira para o caso em que
   * o botão ainda não refletiu o estado. O teste prova as duas coisas: que o Enter não produz
   * requisição de criação, e que a guarda existe e responde se o submit for forçado.
   */
  it('refuses submission by keyboard while blocked by a proven duplicate', async () => {
    const fetchMock = createFetchMock({ duplicate: CERTAIN_DUPLICATE });
    vi.stubGlobal('fetch', fetchMock);
    renderCreate({ duplicate: CERTAIN_DUPLICATE });
    await awaitForm();

    const user = userEvent.setup();
    await fillIdentity(user);
    await screen.findByTestId('duplicate-certain');

    const countPosts = () =>
      fetchMock.mock.calls.filter(
        ([url, init]) => requestUrl(url).endsWith('/api/v1/clients') && init?.method === 'POST',
      ).length;
    const postsBefore = countPosts();

    // Enter no campo de razão social: o formulário não submete com o botão desabilitado.
    await user.type(screen.getByLabelText(/razão social/i), '{Enter}');
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(countPosts()).toBe(postsBefore);

    /*
     * A GUARDA INTERNA, exercitada por submit DIRETO no formulário — o caminho que o Enter
     * percorreria se o botão ainda não tivesse sido desabilitado. O formulário é encontrado pelo
     * campo e o evento é disparado sem passar pelo controle desabilitado.
     */
    const form = screen.getByLabelText(/razão social/i).closest('form');
    expect(form).not.toBeNull();
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => {
      expect(
        screen.getByText(/abra o cadastro existente em vez de criar um novo/i),
      ).toBeInTheDocument();
    });
    // Nenhuma tentativa de criação partiu: a guarda acontece ANTES da requisição.
    expect(countPosts()).toBe(postsBefore);
  });
});
