import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { parseRequestPath } from '../test/request-url';
import { createShellFetchMock } from '../test/shell-fetch-mock';
import { renderWithProviders } from '../test/render-with-providers';
import { FixedAssetsPage } from './pages/FixedAssetsPage';
import type { FixedAssetRegister } from './types/accounting.types';

const UNIT = 'UN-A';
const OTHER_UNIT = 'UN-B';
const ASSET_ID = '50000000-0000-4000-8000-000000000006';
const ASSET_CODE = 'AT-001';
const ASSET_NAME = 'Escavadeira CAT 320';
const REGISTER_ID = '40000000-0000-4000-8000-000000000005';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Ativo físico como o cadastro de Recursos devolve: o rótulo humano é nome + código (e placa),
 * o identificador técnico só existe no campo `id`.
 */
function physicalAssetPayload() {
  return {
    id: ASSET_ID,
    assetCode: ASSET_CODE,
    resourceTypeId: '60000000-0000-4000-8000-000000000007',
    resourceTypeCode: 'HEAVY',
    resourceTypeClassification: 'HEAVY',
    name: ASSET_NAME,
    lifecycleStatus: 'ACTIVE',
    allocationStatus: 'AVAILABLE',
    unitId: UNIT,
    version: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    deactivatedAt: null,
    vehicle: { plate: 'ABC1D23', chassis: null, model: null },
    currentAllocation: null,
  };
}

function fixedAssetRegisterPayload(
  overrides: Partial<FixedAssetRegister> = {},
): FixedAssetRegister {
  return {
    id: REGISTER_ID,
    unitId: UNIT,
    operationalAssetId: ASSET_ID,
    currencyCode: 'BRL',
    usefulLifeMonths: 60,
    costCenterCode: 'CC-OPS',
    status: 'ACTIVE',
    rowVersion: 1,
    bookValue: '0.0000',
    acquiredOn: null,
    disposedOn: null,
    movements: [],
    ...overrides,
  };
}

type Captured = {
  registerBody?: Record<string, unknown>;
  lookupUrl?: string;
};

/**
 * A tela depende da sessao (shell), da fonte unica de unidades operacionais ja existente em
 * Requests, do cadastro de ativos fisicos (Recursos) e da consulta contabil do imobilizado.
 */
function createFixedAssetsFetchMock(captured: Captured) {
  const shellMock = createShellFetchMock();
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { url, pathname, searchParams } = parseRequestPath(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (pathname.endsWith('/operational-units')) {
      return jsonResponse({ items: [UNIT, OTHER_UNIT] });
    }

    if (pathname === '/api/v1/resources/physical-assets' && method === 'GET') {
      const term = (searchParams.get('q') ?? '').toLowerCase();
      const matches = term.length === 0 || ASSET_NAME.toLowerCase().includes(term);
      return jsonResponse({
        items: matches ? [physicalAssetPayload()] : [],
        limit: Number(searchParams.get('limit') ?? 20),
        offset: 0,
        total: matches ? 1 : 0,
      });
    }

    if (pathname === '/api/v1/accounting/fixed-assets' && method === 'GET') {
      captured.lookupUrl = url;
      return jsonResponse(fixedAssetRegisterPayload());
    }

    if (pathname === '/api/v1/accounting/fixed-assets' && method === 'POST') {
      captured.registerBody = JSON.parse(
        typeof init?.body === 'string' ? init.body : '{}',
      ) as Record<string, unknown>;
      return jsonResponse(fixedAssetRegisterPayload({ status: 'REGISTERED' }));
    }

    return shellMock(input, init);
  });
}

function renderFixedAssetsPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/accounting/fixed-assets" element={<FixedAssetsPage />} />
      <Route path="/app/accounting/fixed-assets/:registerId" element={<FixedAssetsPage />} />
    </Routes>,
    { router: { initialEntries: ['/app/accounting/fixed-assets'] } },
  );
}

function registerSection(): HTMLElement {
  return screen.getByRole('region', { name: 'Registrar ativo operacional' });
}

function lookupSection(): HTMLElement {
  return screen.getByRole('region', { name: 'Consultar por ativo operacional' });
}

// Os rotulos de `Field` recebem o sufixo sr-only " (obrigatório)"; a busca humana usa outro
// aria-label ("Buscar ativo operacional"), por isso os padroes abaixo sao ancorados no inicio.
const UNIT_LABEL = /^unidade/i;
const ASSET_SELECT_LABEL = /^ativo operacional/i;
const ASSET_SEARCH_LABEL = /^buscar ativo operacional$/i;

async function selectAssetHumanly(
  user: ReturnType<typeof userEvent.setup>,
  scope: HTMLElement,
): Promise<void> {
  await user.type(within(scope).getByLabelText(ASSET_SEARCH_LABEL), 'escavadeira');
  const option = await within(scope).findByRole('option', {
    name: /Escavadeira CAT 320/,
  });
  // O operador escolhe pelo nome/codigo exibido; o valor da opcao e o identificador interno.
  expect(option.textContent).toContain(ASSET_CODE);
  expect(option.getAttribute('value')).toBe(ASSET_ID);
  await user.selectOptions(within(scope).getByLabelText(ASSET_SELECT_LABEL), ASSET_ID);
}

describe('FixedAssetsPage — seleção humana do ativo operacional', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('registra o ativo imobilizado escolhendo ativo e unidade em listas, sem digitar identificador', async () => {
    const captured: Captured = {};
    vi.stubGlobal('fetch', createFixedAssetsFetchMock(captured));
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });

    renderFixedAssetsPage();

    const section = registerSection();
    // A unidade vem do hook compartilhado do shell: lista legivel, nunca identificador digitado.
    await waitFor(() =>
      expect(within(section).getByLabelText(UNIT_LABEL)).toHaveValue(UNIT),
    );
    expect(within(section).queryByText(ASSET_ID)).toBeNull();

    await selectAssetHumanly(user, section);
    expect(screen.queryByText(ASSET_ID)).toBeNull();

    await user.type(within(section).getByLabelText(/^vida útil/i), '60');
    await user.click(within(section).getByRole('button', { name: 'Registrar' }));

    await waitFor(() => expect(captured.registerBody).toBeDefined());
    expect(captured.registerBody).toMatchObject({
      unitId: UNIT,
      operationalAssetId: ASSET_ID,
      currencyCode: 'BRL',
      usefulLifeMonths: 60,
    });
  });

  it('consulta o registro contábil pelo ativo escolhido humanamente, enviando o identificador interno', async () => {
    const captured: Captured = {};
    vi.stubGlobal('fetch', createFixedAssetsFetchMock(captured));
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });

    renderFixedAssetsPage();

    const section = lookupSection();
    await waitFor(() =>
      expect(within(section).getByLabelText(UNIT_LABEL)).toHaveValue(UNIT),
    );

    await selectAssetHumanly(user, section);
    await user.click(within(section).getByRole('button', { name: 'Consultar ativo operacional' }));

    await waitFor(() => expect(captured.lookupUrl).toBeDefined());
    const query = new URL(String(captured.lookupUrl)).searchParams;
    expect(query.get('unitId')).toBe(UNIT);
    expect(query.get('operationalAssetId')).toBe(ASSET_ID);
  });
});
