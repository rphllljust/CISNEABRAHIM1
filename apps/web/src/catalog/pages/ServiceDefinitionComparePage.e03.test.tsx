import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { createCatalogFetchMock } from '../../test/catalog-fetch-mock';
import { parseRequestPath } from '../../test/request-url';
import { renderWithProviders } from '../../test/render-with-providers';
import { VERSION_STATUSES, type ServiceDefinitionVersion } from '../types/service-catalog.types';
import { parseCatalogVersionNumber } from '../utils/catalog-version-number';
import { ServiceDefinitionComparePage } from './ServiceDefinitionComparePage';
import { ServiceDefinitionVersionDetailPage } from './ServiceDefinitionVersionDetailPage';

const DEFINITION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ROOT = `/app/catalog/${DEFINITION_ID}`;
const API_ROOT = `/api/v1/catalog/service-definitions/${DEFINITION_ID}`;

function version(number: number): ServiceDefinitionVersion {
  return {
    id: `service-version-${number}`,
    serviceDefinitionId: DEFINITION_ID,
    code: 'LOCACAO-DEMO',
    version: number,
    status: number === 1 ? VERSION_STATUSES.Published : VERSION_STATUSES.Draft,
    categoryId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    archetype: 'RENTAL',
    name: `Locação v${number}`,
    description: null,
    defaultUnitCode: 'DAY',
    measurementMode: 'BY_PERIOD',
    measurementBasis: 'TIME',
    billingEntitlementPolicy: 'MEASUREMENT_APPROVED',
    requiresPurchaseOrder: false,
    allowedUnits: [{ unitCode: 'DAY', isDefault: true, sortOrder: 0 }],
    resourceRequirements: [],
    laborRequirements: [],
    pricingModels: [],
    executionRequirements: [],
    publishedAt: number === 1 ? '2026-01-01T00:00:00.000Z' : null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockCatalogVersions(
  onDetail?: (number: number, signal?: AbortSignal) => Promise<Response>,
) {
  const fallback = createCatalogFetchMock();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = parseRequestPath(input);
    if (pathname === `${API_ROOT}/versions`) {
      return json([version(1), version(2)]);
    }
    const match = pathname.match(
      new RegExp(`^${API_ROOT}/versions/([0-9]+)$`),
    );
    if (match) {
      const number = Number(match[1]);
      return onDetail ? onDetail(number, init?.signal ?? undefined) : json(version(number));
    }
    return fallback(input, init);
  });
}

function ChangeComparison() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => { void navigate(`${ROOT}/compare?left=2&right=1`); }}
    >
      Inverter versões
    </button>
  );
}

describe('E03 — Catálogo 360 / navegação e versão autoritativa', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
  });

  it('aceita apenas números de versão positivos, inteiros, canônicos e seguros', () => {
    expect(parseCatalogVersionNumber('1')).toBe(1);
    expect(parseCatalogVersionNumber('24')).toBe(24);
    for (const invalid of ['', '0', '-1', '+1', '01', '1.1', '1e2', 'NaN', '9007199254740992']) {
      expect(parseCatalogVersionNumber(invalid)).toBeNull();
    }
  });

  it('rejeita deep links inválidos antes de fazer requisições para versões inexistentes', async () => {
    const fetchMock = mockCatalogVersions();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/app/catalog/:definitionId/compare" element={<ServiceDefinitionComparePage />} />
      </Routes>,
      { router: { initialEntries: [`${ROOT}/compare?left=abc&right=-1`] } },
    );

    expect(await screen.findByText('Selecione versões válidas desta definição.')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const { pathname } = parseRequestPath(input);
        return pathname.includes('/versions/NaN') || pathname.includes('/versions/-1');
      }),
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        /\/versions\/[0-9]+$/.test(parseRequestPath(input).pathname),
      ),
    ).toBe(false);
  });

  it('ignora respostas antigas quando operador muda a comparação antes do fim da leitura', async () => {
    const pending: Array<{ number: number; resolve: (response: Response) => void; signal?: AbortSignal }> = [];
    const fetchMock = mockCatalogVersions(
      (number, signal) =>
        new Promise<Response>((resolve) => pending.push({ number, resolve, signal })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    renderWithProviders(
      <>
        <Routes>
          <Route path="/app/catalog/:definitionId/compare" element={<ServiceDefinitionComparePage />} />
        </Routes>
        <ChangeComparison />
      </>,
      { router: { initialEntries: [`${ROOT}/compare?left=1&right=2`] } },
    );

    await waitFor(() => expect(pending).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Inverter versões' }));
    await waitFor(() => expect(pending).toHaveLength(4));
    expect(pending[0]!.signal?.aborted).toBe(true);

    await act(async () => {
      pending[2]!.resolve(json(version(pending[2]!.number)));
      pending[3]!.resolve(json(version(pending[3]!.number)));
    });
    expect(await screen.findByLabelText('Versão esquerda')).toHaveValue('2');
    expect(screen.getByLabelText('Versão direita')).toHaveValue('1');

    // Mesmo com uma camada de transporte que ignore AbortSignal, a resposta
    // obsoleta não pode substituir o recorte do operador.
    await act(async () => {
      pending[0]!.resolve(json(version(pending[0]!.number)));
      pending[1]!.resolve(json(version(pending[1]!.number)));
    });
    expect(screen.getByLabelText('Versão esquerda')).toHaveValue('2');
    expect(screen.getByLabelText('Versão direita')).toHaveValue('1');
  });

  it('não executa GET para uma rota de versão inválida', async () => {
    const fetchMock = mockCatalogVersions();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route
          path="/app/catalog/:definitionId/versions/:versionNumber"
          element={<ServiceDefinitionVersionDetailPage />}
        />
      </Routes>,
      { router: { initialEntries: [`${ROOT}/versions/NaN`] } },
    );

    expect(await screen.findByText('Versão não encontrada.')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        parseRequestPath(input).pathname.startsWith(API_ROOT),
      ),
    ).toBe(false);
  });
});
