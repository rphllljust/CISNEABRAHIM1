import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { parseRequestPath } from '../test/request-url';
import { renderWithProviders } from '../test/render-with-providers';
import { PhysicalAssetCreatePage } from './pages/PhysicalAssetCreatePage';
import { PhysicalAssetEditPage } from './pages/PhysicalAssetEditPage';
import {
  ASSET_ALLOCATION_STATUSES,
  ASSET_LIFECYCLE_STATUSES,
  VEHICLE_CLASSIFICATION,
  type PhysicalAsset,
} from './types/physical-asset.types';

/**
 * CADASTRO E EDIÇÃO DE ATIVO FÍSICO — contrato estruturado.
 *
 * Os testes protegem o que o contrato promete: seções de negócio, resumo com os fatos REAIS da
 * edição, escolha humana das referências, ação principal coerente com a validação real do
 * domínio (`validateAssetForm`) e nome acessível em todo controle. Nenhum fato é inventado no
 * mock: os valores esperados de payload são exatamente os de `buildCreatePayload` /
 * `buildUpdatePayload`.
 */

const PROBE_ASSET_ID = '00000000-0000-4000-8000-000000000003';
const ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TRUCK_TYPE_ID = '11111111-1111-4111-8111-111111111111';
const EXCAVATOR_TYPE_ID = '22222222-2222-4222-8222-222222222222';
const DEMO_UNIT = 'UN-DEMO';

const RESOURCE_TYPES = [
  { id: TRUCK_TYPE_ID, code: 'TRUCK', name: 'Caminhão', classification: 'VEHICLE', status: 'ACTIVE' },
  {
    id: EXCAVATOR_TYPE_ID,
    code: 'EXCAVATOR',
    name: 'Escavadeira',
    classification: 'MACHINE',
    status: 'ACTIVE',
  },
];

function demoAsset(): PhysicalAsset {
  return {
    id: ASSET_ID,
    assetCode: 'TRK-DEMO',
    resourceTypeId: TRUCK_TYPE_ID,
    resourceTypeCode: 'TRUCK',
    resourceTypeClassification: VEHICLE_CLASSIFICATION,
    name: 'Caminhão demo',
    lifecycleStatus: ASSET_LIFECYCLE_STATUSES.Active,
    allocationStatus: ASSET_ALLOCATION_STATUSES.Available,
    unitId: DEMO_UNIT,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deactivatedAt: null,
    vehicle: { plate: 'DEM-0A12', chassis: 'CH-001', model: 'Volvo' },
    currentAllocation: null,
  };
}

type RecordedRequest = {
  pathname: string;
  method: string;
  body: Record<string, unknown> | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function assetError(code: string, status: number): Response {
  return { ok: false, status, json: async () => ({ error: { code, message: 'error' } }) } as Response;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function createAssetBuilderFetchMock(
  options: { createAllowed?: boolean; unitsAllowed?: boolean; editLoadFails?: boolean } = {},
) {
  const store: PhysicalAsset[] = [demoAsset()];
  const requests: RecordedRequest[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = parseRequestPath(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    requests.push({ pathname, method, body });

    if (pathname === '/api/v1/auth/session' && method === 'GET') {
      return jsonResponse({
        identityId: '00000000-0000-4000-8000-000000000001',
        session: { id: 'sid', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
      });
    }

    if (
      pathname === '/api/v1/requests/service-requests/operational-units' &&
      method === 'GET'
    ) {
      if (options.unitsAllowed === false) {
        return assetError('REQUESTS_DENIED', 403);
      }
      return jsonResponse({ items: [DEMO_UNIT, 'UN-OBRA'] });
    }

    if (pathname === '/api/v1/resources/physical-resource-types' && method === 'GET') {
      return jsonResponse({ items: RESOURCE_TYPES });
    }

    if (pathname === '/api/v1/resources/physical-assets' && method === 'GET') {
      return jsonResponse({ items: store, limit: 20, offset: 0, total: store.length });
    }

    if (pathname === '/api/v1/resources/physical-assets' && method === 'POST') {
      if (options.createAllowed === false) {
        return assetError('ASSET_DENIED', 403);
      }
      // Sonda de capability envia corpo vazio: continua sendo validação, não cadastro.
      if (!body || Object.keys(body).length === 0) {
        return assetError('ASSET_VALIDATION_FAILED', 400);
      }
      const vehicle = body['vehicle'] as { plate?: string; chassis?: string; model?: string } | undefined;
      const created: PhysicalAsset = {
        ...demoAsset(),
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
        assetCode: readString(body['assetCode'], 'SEM-CODIGO'),
        resourceTypeId: readString(body['resourceTypeId'], EXCAVATOR_TYPE_ID),
        name: readString(body['name'], 'Sem nome'),
        unitId: readString(body['unitId'], DEMO_UNIT),
        allocationStatus: ASSET_ALLOCATION_STATUSES.Available,
        vehicle: vehicle
          ? { plate: vehicle.plate ?? '', chassis: vehicle.chassis ?? null, model: vehicle.model ?? null }
          : null,
        currentAllocation: null,
      };
      store.push(created);
      return jsonResponse(created, 201);
    }

    const detailMatch = pathname.match(/^\/api\/v1\/resources\/physical-assets\/([^/]+)$/);
    if (detailMatch) {
      const assetId = detailMatch[1] ?? '';
      const asset = store.find((entry) => entry.id === assetId);
      if (!asset) {
        return assetError('ASSET_NOT_FOUND', 404);
      }
      if (method === 'GET') {
        if (options.editLoadFails) {
          return assetError('ASSET_INVALID_STATE', 500);
        }
        return jsonResponse(asset);
      }
      if (method === 'PATCH') {
        // Sonda de capability envia apenas a versão: não é uma edição real.
        if (!body || body['name'] === undefined) {
          return assetError('ASSET_VALIDATION_FAILED', 400);
        }
        const updated: PhysicalAsset = {
          ...asset,
          name: readString(body['name'], asset.name),
          version: asset.version + 1,
        };
        return jsonResponse(updated);
      }
    }

    return assetError('ASSET_NOT_FOUND', 404);
  });

  return { fetchMock, requests };
}

function createdAssets(requests: RecordedRequest[]): Record<string, unknown>[] {
  return requests
    .filter(
      (request) =>
        request.pathname === '/api/v1/resources/physical-assets' &&
        request.method === 'POST' &&
        request.body !== null &&
        Object.keys(request.body).length > 0,
    )
    .map((request) => request.body as Record<string, unknown>);
}

function updatedAssets(requests: RecordedRequest[]): Record<string, unknown>[] {
  return requests
    .filter(
      (request) =>
        request.method === 'PATCH' &&
        request.pathname === `/api/v1/resources/physical-assets/${ASSET_ID}`,
      )
    .map((request) => request.body as Record<string, unknown>);
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

async function renderCreatePage(mock: ReturnType<typeof createAssetBuilderFetchMock>) {
  vi.stubGlobal('fetch', mock.fetchMock);
  renderWithProviders(<PhysicalAssetCreatePage />);
  // O título aparece também durante a sonda de permissão: o formulário só existe depois dela.
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /cadastrar ativo/i })).toBeInTheDocument();
  });
}

function renderEditPage(mock: ReturnType<typeof createAssetBuilderFetchMock>) {
  vi.stubGlobal('fetch', mock.fetchMock);
  return renderWithProviders(
    <Routes>
      <Route path="/app/assets/:assetId/edit" element={<PhysicalAssetEditPage />} />
      <Route path="/app/assets/:assetId" element={<h1>Detalhe do ativo</h1>} />
    </Routes>,
    { router: { initialEntries: [`/app/assets/${ASSET_ID}/edit`] } },
  );
}

describe('PhysicalAssetCreatePage — contrato estruturado', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('organiza o cadastro em seções de negócio', async () => {
    const mock = createAssetBuilderFetchMock();
    await renderCreatePage(mock);

    expect(screen.getByRole('heading', { name: 'Novo ativo físico' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Identificação' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Classificação' })).toBeInTheDocument();
    // Tipo ainda não escolhido: o bloco de veículo não existe (nada é inventado).
    expect(screen.queryByRole('region', { name: 'Dados do veículo' })).not.toBeInTheDocument();
    // Nada preenchido ainda: o resumo não inventa fato nenhum e, por contrato, não aparece.
    expect(screen.queryByLabelText('Resumo da configuração')).not.toBeInTheDocument();
  });

  it('escolhe o tipo de recurso na lista do catálogo e passa a exigir os campos do veículo', async () => {
    const mock = createAssetBuilderFetchMock();
    const user = userEvent.setup();
    await renderCreatePage(mock);

    await user.selectOptions(
      screen.getByLabelText(/^Tipo de recurso/),
      await screen.findByRole('option', { name: /Caminhão/ }),
    );

    expect(await screen.findByRole('region', { name: 'Dados do veículo' })).toBeInTheDocument();
    const summary = await screen.findByLabelText('Resumo da configuração');
    expect(within(summary).getByText('Caminhão (TRUCK)')).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText(/^Tipo de recurso/),
      await screen.findByRole('option', { name: /Escavadeira/ }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Dados do veículo' })).not.toBeInTheDocument();
    });
  });

  it('escolhe a unidade operacional na lista registrada', async () => {
    const mock = createAssetBuilderFetchMock();
    const user = userEvent.setup();
    await renderCreatePage(mock);

    await user.selectOptions(
      screen.getByLabelText(/^Unidade operacional/),
      await screen.findByRole('option', { name: DEMO_UNIT }),
    );

    const summary = await screen.findByLabelText('Resumo da configuração');
    expect(within(summary).getByText(DEMO_UNIT)).toBeInTheDocument();
  });

  it('não conclui o cadastro inválido e mantém a validação real do domínio', async () => {
    const mock = createAssetBuilderFetchMock();
    const user = userEvent.setup();
    await renderCreatePage(mock);

    await user.click(screen.getByRole('button', { name: /cadastrar ativo/i }));

    expect(await screen.findByText('Informe o código do ativo.')).toBeInTheDocument();
    expect(screen.getByText('Selecione o tipo de recurso.')).toBeInTheDocument();
    expect(screen.getByText('Informe a unidade operacional.')).toBeInTheDocument();
    expect(screen.getByText('Informe o nome ou descrição do ativo.')).toBeInTheDocument();
    expect(createdAssets(mock.requests)).toHaveLength(0);
  });

  it('envia exatamente o payload do contrato quando o cadastro está válido', async () => {
    const mock = createAssetBuilderFetchMock();
    const user = userEvent.setup();
    await renderCreatePage(mock);

    await user.type(screen.getByLabelText(/^Código do ativo/), 'trk-9');
    await user.type(screen.getByLabelText(/^Nome \/ descrição/), 'Caminhão novo');
    await user.selectOptions(
      screen.getByLabelText(/^Tipo de recurso/),
      await screen.findByRole('option', { name: /Caminhão/ }),
    );
    await user.selectOptions(
      screen.getByLabelText(/^Unidade operacional/),
      await screen.findByRole('option', { name: DEMO_UNIT }),
    );
    await user.type(await screen.findByLabelText(/^Placa/), 'ABC-1D23');
    await user.type(screen.getByLabelText(/^Chassi/), 'CH-9');
    await user.type(screen.getByLabelText(/^Modelo/), 'Volvo FH');

    await user.click(screen.getByRole('button', { name: /cadastrar ativo/i }));

    await waitFor(() => {
      expect(createdAssets(mock.requests)).toHaveLength(1);
    });
    expect(createdAssets(mock.requests)[0]).toEqual({
      assetCode: 'TRK-9',
      resourceTypeId: TRUCK_TYPE_ID,
      name: 'Caminhão novo',
      unitId: DEMO_UNIT,
      vehicle: { plate: 'ABC-1D23', chassis: 'CH-9', model: 'Volvo FH' },
    });
  });

  it('mantém a referência da unidade digitável quando a lista registrada não está disponível', async () => {
    const mock = createAssetBuilderFetchMock({ unitsAllowed: false });
    const user = userEvent.setup();
    await renderCreatePage(mock);

    const unitField = await screen.findByLabelText(/^Unidade operacional/);
    await waitFor(() => {
      expect(unitField.tagName).toBe('INPUT');
    });

    await user.type(unitField, 'UN-NOVA');

    const summary = screen.getByLabelText('Resumo da configuração');
    expect(within(summary).getByText('UN-NOVA')).toBeInTheDocument();
  });

  it('explica a negativa de permissão dentro da mesma moldura', async () => {
    const mock = createAssetBuilderFetchMock({ createAllowed: false });
    vi.stubGlobal('fetch', mock.fetchMock);
    renderWithProviders(<PhysicalAssetCreatePage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /não tem permissão para cadastrar ativos/i,
      );
    });
    expect(screen.getByRole('heading', { name: 'Novo ativo físico' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cadastrar ativo/i })).not.toBeInTheDocument();
  });

  it('todo controle interativo do cadastro tem nome acessível', async () => {
    const mock = createAssetBuilderFetchMock();
    const user = userEvent.setup();
    await renderCreatePage(mock);

    await user.selectOptions(
      screen.getByLabelText(/^Tipo de recurso/),
      await screen.findByRole('option', { name: /Caminhão/ }),
    );
    await screen.findByLabelText(/^Placa/);

    // Controles que o P0 cobre: botões, links, seleções e campos de texto do cadastro.
    expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('textbox').length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('link').length).toBeGreaterThanOrEqual(1);
    expectEveryControlToHaveAccessibleName();
  });
});

describe('PhysicalAssetEditPage — contrato estruturado', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('mostra classificação, situação e disponibilidade como fatos somente leitura', async () => {
    const mock = createAssetBuilderFetchMock();
    const { container } = renderEditPage(mock);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /editar TRK-DEMO/i })).toBeInTheDocument();
    });

    const summary = screen.getByLabelText('Resumo da configuração');
    expect(within(summary).getByText('Caminhão (TRUCK)')).toBeInTheDocument();
    expect(within(summary).getByText('Ativo')).toBeInTheDocument();

    const classification = screen.getByRole('region', { name: 'Classificação' });
    expect(within(classification).getByText(DEMO_UNIT)).toBeInTheDocument();
    expect(classification).toHaveTextContent(
      /definidos no cadastro e não mudam nesta tela/i,
    );

    expect(screen.getByRole('region', { name: 'Disponibilidade' })).toHaveTextContent(
      'Disponível',
    );

    // Nenhum identificador técnico visível.
    expect(container.textContent ?? '').not.toContain(TRUCK_TYPE_ID);
    expect(container.textContent ?? '').not.toContain(ASSET_ID);
    expect(container.textContent ?? '').not.toContain(PROBE_ASSET_ID);
  });

  it('não salva sem nome e envia o payload de atualização quando válido', async () => {
    const mock = createAssetBuilderFetchMock();
    const user = userEvent.setup();
    renderEditPage(mock);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /editar TRK-DEMO/i })).toBeInTheDocument();
    });
    await screen.findByLabelText(/^Placa/);

    await user.clear(screen.getByLabelText(/^Nome \/ descrição/));
    await user.click(screen.getByRole('button', { name: /salvar altera/i }));

    expect(await screen.findByText('Informe o nome ou descrição do ativo.')).toBeInTheDocument();
    expect(updatedAssets(mock.requests)).toHaveLength(0);

    await user.type(screen.getByLabelText(/^Nome \/ descrição/), 'Caminhão atualizado');
    await user.clear(screen.getByLabelText(/^Placa/));
    await user.type(screen.getByLabelText(/^Placa/), 'DEM-9Z99');
    await user.click(screen.getByRole('button', { name: /salvar altera/i }));

    await waitFor(() => {
      expect(updatedAssets(mock.requests)).toHaveLength(1);
    });
    expect(updatedAssets(mock.requests)[0]).toEqual({
      version: 1,
      name: 'Caminhão atualizado',
      vehicle: { plate: 'DEM-9Z99', chassis: 'CH-001', model: 'Volvo' },
    });
    expect(await screen.findByRole('heading', { name: 'Detalhe do ativo' })).toBeInTheDocument();
  });

  it('trata falha de carregamento com nova tentativa dentro do builder', async () => {
    const mock = createAssetBuilderFetchMock({ editLoadFails: true });
    renderEditPage(mock);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('todo controle interativo da edição tem nome acessível', async () => {
    const mock = createAssetBuilderFetchMock();
    renderEditPage(mock);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /editar TRK-DEMO/i })).toBeInTheDocument();
    });
    await screen.findByLabelText(/^Placa/);

    expectEveryControlToHaveAccessibleName();
  });
});
