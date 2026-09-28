import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonCreatePage } from './PersonCreatePage';
import { createPeopleFetchMock } from '../../test/people-fetch-mock';
import { parseRequestPath } from '../../test/request-url';
import { renderWithProviders } from '../../test/render-with-providers';
import { tokenStore, resetTokenStoreForTests } from '../../auth/storage/token-store';

function parseRequestBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== 'string') {
    return {};
  }
  return JSON.parse(body) as Record<string, unknown>;
}

function postPeopleCalls(fetchMock: ReturnType<typeof createPeopleFetchMock>) {
  return fetchMock.mock.calls.filter(([input, init]) => {
    const { pathname } = parseRequestPath(input);
    if (pathname !== '/api/v1/people' || (init?.method ?? 'GET') !== 'POST') {
      return false;
    }
    const body = parseRequestBody(init?.body);
    return typeof body.legalName === 'string' && body.legalName.length > 0;
  });
}

/**
 * O título da página agora aparece também durante a sonda de permissão (a moldura é a mesma em
 * todos os estados). O formulário só existe depois da sonda: os testes esperam o controle real
 * da ação principal em vez do título — as asserções de negócio seguem idênticas.
 */
async function waitForCreateForm() {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /cadastrar/i })).toBeInTheDocument();
  });
}

describe('PersonCreatePage', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('shows validation error for empty legal name', async () => {
    vi.stubGlobal('fetch', createPeopleFetchMock());
    const user = userEvent.setup();

    renderWithProviders(<PersonCreatePage />);

    await waitForCreateForm();

    await user.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/informe o nome legal/i);
    });
  });

  it('submits all create fields once and prevents duplicate activation', async () => {
    const fetchMock = createPeopleFetchMock({
      laborTypes: [{ code: 'DRIVER', name: 'Motorista' }],
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderWithProviders(<PersonCreatePage />);

    await waitForCreateForm();

    await user.type(screen.getByLabelText(/nome legal/i), 'Rafael Souza');
    await user.type(screen.getByLabelText(/nome de uso/i), 'Rafael');
    await user.selectOptions(screen.getByLabelText(/função operacional padrão/i), 'DRIVER');
    await user.type(screen.getByLabelText(/referência externa/i), 'ERP-123');
    await user.dblClick(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() => {
      expect(postPeopleCalls(fetchMock)).toHaveLength(1);
    });
    const [createCall] = postPeopleCalls(fetchMock);
    expect(createCall).toBeDefined();
    if (!createCall) {
      throw new Error('Expected a create person request.');
    }
    const body = parseRequestBody(createCall[1]?.body);
    expect(body).toEqual({
      legalName: 'Rafael Souza',
      preferredName: 'Rafael',
      defaultLaborTypeCode: 'DRIVER',
      externalErpId: 'ERP-123',
    });
  });

  it('keeps filled data when the API rejects create', async () => {
    vi.stubGlobal(
      'fetch',
      createPeopleFetchMock({
        personCreateError: { code: 'PERSON_EXTERNAL_ID_CONFLICT', status: 409 },
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<PersonCreatePage />);

    await waitForCreateForm();

    await user.type(screen.getByLabelText(/nome legal/i), 'Monica Lima');
    await user.type(screen.getByLabelText(/nome de uso/i), 'Monica');
    await user.type(screen.getByLabelText(/referência externa/i), 'ERP-REPETIDO');
    await user.click(screen.getByRole('button', { name: /cadastrar/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/referência externa/i);
    });
    expect(screen.getByLabelText(/nome legal/i)).toHaveValue('Monica Lima');
    expect(screen.getByLabelText(/nome de uso/i)).toHaveValue('Monica');
    expect(screen.getByLabelText(/referência externa/i)).toHaveValue('ERP-REPETIDO');
  });

  it('routes cancel back to people list', async () => {
    vi.stubGlobal('fetch', createPeopleFetchMock());
    const user = userEvent.setup();

    renderWithProviders(
      <Routes>
        <Route path="/app/people/new" element={<PersonCreatePage />} />
        <Route path="/app/people" element={<h1>Lista de pessoas</h1>} />
      </Routes>,
      { router: { initialEntries: ['/app/people/new'] } },
    );

    await waitForCreateForm();

    await user.click(screen.getByRole('link', { name: /cancelar/i }));

    expect(screen.getByRole('heading', { name: /lista de pessoas/i })).toBeInTheDocument();
  });

  it('shows permission denied when create capability is denied', async () => {
    vi.stubGlobal('fetch', createPeopleFetchMock({ personCreateAllowed: false }));
    renderWithProviders(<PersonCreatePage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não tem permissão para cadastrar pessoas/i);
    });
  });
});
