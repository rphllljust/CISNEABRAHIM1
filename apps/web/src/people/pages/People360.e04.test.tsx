import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { createPeopleFetchMock } from '../../test/people-fetch-mock';
import { parseRequestPath } from '../../test/request-url';
import { renderWithProviders } from '../../test/render-with-providers';
import { parsePeopleOffsetParam, parsePeopleStatusParam } from '../utils/people-list-params';
import { PeopleListPage } from './PeopleListPage';
import { PersonDetailPage } from './PersonDetailPage';
import type { Person } from '../types/person.types';

const FIRST_ID = 'cccccccc-cccc-4ccc-8ccc-000000000000';
const SECOND_ID = 'cccccccc-cccc-4ccc-8ccc-000000000001';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ChangePerson() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => { void navigate(`/app/people/${SECOND_ID}`); }}>
      Abrir Pessoa B
    </button>
  );
}

describe('E04 Pessoas 360 — isolamento de contexto e filtros reais', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
  });

  it('aceita apenas offset positivo seguro e status do domínio na URL', () => {
    expect(parsePeopleOffsetParam(null)).toBe(0);
    expect(parsePeopleOffsetParam('0')).toBe(0);
    expect(parsePeopleOffsetParam('20')).toBe(20);
    for (const invalid of ['-1', 'NaN', 'Infinity', '1.5', '1e2', '01', '9007199254740992']) {
      expect(parsePeopleOffsetParam(invalid)).toBe(0);
    }
    expect(parsePeopleStatusParam('ACTIVE')).toBe('ACTIVE');
    expect(parsePeopleStatusParam('INACTIVE')).toBe('INACTIVE');
    expect(parsePeopleStatusParam('PENDING')).toBe('');
  });

  it('nao envia filtros invalidos de deep link ao servidor da worklist', async () => {
    const mock = createPeopleFetchMock({
      seed: [{ legalName: 'Pessoa Recorte', memberCode: 'PSN-001' }],
    });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<PeopleListPage />, {
      router: { initialEntries: ['/app/people?status=PENDING&offset=Infinity'] },
    });
    expect(await screen.findByRole('link', { name: 'Pessoa Recorte' })).toBeInTheDocument();
    const requests = mock.mock.calls.map(([input]) => parseRequestPath(input));
    const listCall = requests.find((entry) => entry.pathname === '/api/v1/people');
    expect(listCall?.searchParams.get('status')).toBeNull();
    expect(listCall?.searchParams.get('offset')).toBe('0');
  });

  it('nao exibe Pessoa A apos mudar de ficha e receber a resposta obsoleta', async () => {
    const fallback = createPeopleFetchMock({
      seed: [
        { legalName: 'Pessoa A', memberCode: 'PSN-A' },
        { legalName: 'Pessoa B', memberCode: 'PSN-B' },
      ],
    });
    const pending: Array<{
      id: string;
      resolve: (response: Response) => void;
      signal?: AbortSignal;
    }> = [];
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = parseRequestPath(input);
      if (/^\/api\/v1\/people\/[^/]+\/history$/.test(pathname)) {
        return json({ items: [] });
      }
      const match = pathname.match(/^\/api\/v1\/people\/([^/]+)$/);
      if (match && (init?.method ?? 'GET') === 'GET') {
        return new Promise<Response>((resolve) => {
          pending.push({ id: match[1]!, resolve, signal: init?.signal ?? undefined });
        });
      }
      return fallback(input, init);
    });
    vi.stubGlobal('fetch', mock);
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <Routes>
          <Route path="/app/people/:personId" element={<PersonDetailPage />} />
        </Routes>
        <ChangePerson />
      </>,
      { router: { initialEntries: [`/app/people/${FIRST_ID}`] } },
    );

    await waitFor(() => expect(pending).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Abrir Pessoa B' }));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0]!.id).toBe(FIRST_ID);
    expect(pending[0]!.signal?.aborted).toBe(true);
    expect(pending[1]!.id).toBe(SECOND_ID);

    const secondResponse = await fallback(`/api/v1/people/${SECOND_ID}`, {
      headers: { Authorization: 'Bearer access-token' },
    });
    const second = (await secondResponse.json()) as Person;
    await act(async () => {
      pending[1]!.resolve(json(second));
    });
    expect(await screen.findByText('Pessoa B')).toBeInTheDocument();

    const firstResponse = await fallback(`/api/v1/people/${FIRST_ID}`, {
      headers: { Authorization: 'Bearer access-token' },
    });
    const first = (await firstResponse.json()) as Person;
    await act(async () => {
      pending[0]!.resolve(json(first));
    });
    expect(screen.getByText('Pessoa B')).toBeInTheDocument();
    expect(screen.queryByText('Pessoa A')).not.toBeInTheDocument();
  });
});
