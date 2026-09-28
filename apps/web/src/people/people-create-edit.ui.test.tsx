import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { createPeopleFetchMock, type PeopleFetchMockOptions } from '../test/people-fetch-mock';
import { parseRequestPath } from '../test/request-url';
import { renderWithProviders } from '../test/render-with-providers';
import { PersonCreatePage } from './pages/PersonCreatePage';
import { PersonEditPage } from './pages/PersonEditPage';
import { PERSON_STATUSES, type Person } from './types/person.types';

/**
 * CADASTRO E EDIÇÃO DE PESSOA — contrato estruturado.
 *
 * Protege o que o contrato promete: seções de negócio com nome empresarial, resumo com os fatos
 * REAIS da edição (nome, função de vínculo, situação persistida), ação principal coerente com a
 * validação real (nome legal obrigatório) e nome acessível em todo controle. O payload esperado
 * é exatamente o que `createPerson` / `updatePerson` já enviavam — nada mudou de contrato.
 */

const PERSON_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROBE_PERSON_ID = '00000000-0000-4000-8000-000000000002';

function demoPerson(): Person {
  return {
    id: PERSON_ID,
    memberCode: 'PSN-000001',
    legalName: 'Pessoa Demo Sintética',
    preferredName: 'Demo',
    defaultLaborTypeCode: 'OPERATOR',
    defaultLaborTypeName: 'Operador',
    externalErpId: null,
    status: PERSON_STATUSES.Active,
    version: 1,
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
    deactivatedAt: null,
    deactivationReason: null,
    serviceOrderAllocationSupported: false,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/**
 * Sobre o mock compartilhado de Pessoas (`createPeopleFetchMock`), apenas implementa a
 * atualização: o mock comum existe para listar/criar e responde 404 no PATCH.
 */
function createPeopleUpdateFetchMock(options: PeopleFetchMockOptions = {}) {
  const base = createPeopleFetchMock(options);
  const patchBodies: Record<string, unknown>[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = parseRequestPath(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'PATCH' && pathname === `/api/v1/people/${PERSON_ID}`) {
      const body = JSON.parse(
        typeof init?.body === 'string' ? init.body : '{}',
      ) as Record<string, unknown>;
      patchBodies.push(body);
      return jsonResponse({
        ...demoPerson(),
        legalName: typeof body['legalName'] === 'string' ? body['legalName'] : '',
        preferredName: (body['preferredName'] as string | null) ?? null,
        defaultLaborTypeCode: (body['defaultLaborTypeCode'] as string | null) ?? null,
        externalErpId: (body['externalErpId'] as string | null) ?? null,
        version: 2,
      });
    }
    return base(input, init);
  });

  return { fetchMock, patchBodies };
}

function createdPeople(
  fetchMock: ReturnType<typeof createPeopleUpdateFetchMock>['fetchMock'],
): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  for (const [input, init] of fetchMock.mock.calls) {
    const { pathname } = parseRequestPath(input);
    if (pathname !== '/api/v1/people' || (init?.method ?? 'GET') !== 'POST') {
      continue;
    }
    // A sonda de capability envia corpo vazio: não é um cadastro.
    if (typeof init?.body !== 'string' || init.body === '{}') {
      continue;
    }
    bodies.push(JSON.parse(init.body) as Record<string, unknown>);
  }
  return bodies;
}

async function renderCreatePage(mock: ReturnType<typeof createPeopleUpdateFetchMock>) {
  vi.stubGlobal('fetch', mock.fetchMock);
  renderWithProviders(<PersonCreatePage />);
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeInTheDocument();
  });
}

function renderEditPage(mock: ReturnType<typeof createPeopleUpdateFetchMock>) {
  vi.stubGlobal('fetch', mock.fetchMock);
  return renderWithProviders(
    <Routes>
      <Route path="/app/people/:personId/edit" element={<PersonEditPage />} />
      <Route path="/app/people/:personId" element={<h1>Detalhe da pessoa</h1>} />
    </Routes>,
    { router: { initialEntries: [`/app/people/${PERSON_ID}/edit`] } },
  );
}

/** P0: nenhum controle interativo sem nome acessível. */
function expectEveryControlToHaveAccessibleName() {
  const controls = [
    ...screen.queryAllByRole('button'),
    ...screen.queryAllByRole('link'),
    ...screen.queryAllByRole('combobox'),
    ...screen.queryAllByRole('textbox'),
  ];
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    expect(control).toHaveAccessibleName();
  }
}

describe('PersonCreatePage — contrato estruturado', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('organiza o cadastro em Identificação e Vínculo, sem coleção inventada', async () => {
    const mock = createPeopleUpdateFetchMock();
    await renderCreatePage(mock);

    expect(screen.getByRole('heading', { name: 'Nova pessoa' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Identificação' })).toBeInTheDocument();
    const vinculo = screen.getByRole('region', { name: 'Vínculo' });
    expect(within(vinculo).getByLabelText(/função operacional padrão/i)).toBeInTheDocument();
    expect(within(vinculo).getByLabelText(/referência externa/i)).toBeInTheDocument();
    // O contrato da Pessoa não tem linha repetida (documentos/contatos/endereços).
    expect(screen.queryByRole('button', { name: /adicionar/i })).not.toBeInTheDocument();
  });

  it('resume a própria edição com os fatos informados', async () => {
    const mock = createPeopleUpdateFetchMock({ laborTypes: [{ code: 'DRIVER', name: 'Motorista' }] });
    const user = userEvent.setup();
    await renderCreatePage(mock);

    // Nada informado ainda: o resumo não aparece.
    expect(screen.queryByLabelText('Resumo da configuração')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/nome legal/i), 'Rafael Souza');
    await user.selectOptions(screen.getByLabelText(/função operacional padrão/i), 'DRIVER');

    const summary = await screen.findByLabelText('Resumo da configuração');
    expect(within(summary).getByText('Rafael Souza')).toBeInTheDocument();
    expect(within(summary).getByText('Motorista')).toBeInTheDocument();
  });

  it('não cadastra sem nome legal e envia o payload do contrato quando válido', async () => {
    const mock = createPeopleUpdateFetchMock({ laborTypes: [{ code: 'DRIVER', name: 'Motorista' }] });
    const user = userEvent.setup();
    await renderCreatePage(mock);

    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/informe o nome legal/i);
    });
    expect(createdPeople(mock.fetchMock)).toHaveLength(0);

    await user.type(screen.getByLabelText(/nome legal/i), 'Rafael Souza');
    await user.type(screen.getByLabelText(/nome de uso/i), 'Rafael');
    await user.selectOptions(screen.getByLabelText(/função operacional padrão/i), 'DRIVER');
    await user.type(screen.getByLabelText(/referência externa/i), 'ERP-123');
    await user.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => {
      expect(createdPeople(mock.fetchMock)).toHaveLength(1);
    });
    expect(createdPeople(mock.fetchMock)[0]).toEqual({
      legalName: 'Rafael Souza',
      preferredName: 'Rafael',
      defaultLaborTypeCode: 'DRIVER',
      externalErpId: 'ERP-123',
    });
  });

  it('todo controle interativo do cadastro tem nome acessível', async () => {
    const mock = createPeopleUpdateFetchMock();
    await renderCreatePage(mock);

    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(3);
    expectEveryControlToHaveAccessibleName();
  });
});

describe('PersonEditPage — contrato estruturado', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('mostra identificação, vínculo e situação persistida do cadastro', async () => {
    const mock = createPeopleUpdateFetchMock();
    renderEditPage(mock);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Editar Demo' })).toBeInTheDocument();
    });

    expect(screen.getByRole('region', { name: 'Identificação' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Vínculo' })).toBeInTheDocument();

    const summary = screen.getByLabelText('Resumo da configuração');
    expect(within(summary).getByText('Pessoa Demo Sintética')).toBeInTheDocument();
    expect(within(summary).getByText('Ativa')).toBeInTheDocument();

    const record = screen.getByRole('region', { name: 'Situação do cadastro' });
    expect(within(record).getByText('PSN-000001')).toBeInTheDocument();
    expect(within(record).getByText('Ativa')).toBeInTheDocument();
  });

  it('não salva sem nome legal e envia o payload de atualização quando válido', async () => {
    const mock = createPeopleUpdateFetchMock();
    const user = userEvent.setup();
    renderEditPage(mock);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Editar Demo' })).toBeInTheDocument();
    });

    await user.clear(screen.getByLabelText(/nome legal/i));
    await user.click(screen.getByRole('button', { name: /salvar altera/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/informe o nome legal/i);
    });
    expect(mock.patchBodies).toHaveLength(0);

    await user.type(screen.getByLabelText(/nome legal/i), 'Rafael Souza');
    await user.clear(screen.getByLabelText(/nome de uso/i));
    await user.clear(screen.getByLabelText(/referência externa/i));
    await user.click(screen.getByRole('button', { name: /salvar altera/i }));

    await waitFor(() => {
      expect(mock.patchBodies).toHaveLength(1);
    });
    expect(mock.patchBodies[0]).toEqual({
      version: 1,
      legalName: 'Rafael Souza',
      preferredName: null,
      defaultLaborTypeCode: 'OPERATOR',
      externalErpId: null,
    });
    expect(await screen.findByRole('heading', { name: 'Detalhe da pessoa' })).toBeInTheDocument();
  });

  it('todo controle interativo da edição tem nome acessível', async () => {
    const mock = createPeopleUpdateFetchMock();
    renderEditPage(mock);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Editar Demo' })).toBeInTheDocument();
    });

    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(3);
    expectEveryControlToHaveAccessibleName();
  });

  it('não oferece edição quando a capability é negada', async () => {
    const mock = createPeopleUpdateFetchMock({ personUpdateAllowed: false });
    renderEditPage(mock);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão para editar pessoas/i);
    });
    expect(screen.queryByRole('button', { name: /salvar altera/i })).not.toBeInTheDocument();
  });
});

/** O identificador técnico da pessoa nunca aparece na tela. */
describe('PersonEditPage — nenhum identificador técnico', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('não exibe o id do servidor nem o id da sonda', async () => {
    const mock = createPeopleUpdateFetchMock();
    const { container } = renderEditPage(mock);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Editar Demo' })).toBeInTheDocument();
    });

    const text = container.textContent ?? '';
    expect(text).not.toContain(PERSON_ID);
    expect(text).not.toContain(PROBE_PERSON_ID);
  });
});
