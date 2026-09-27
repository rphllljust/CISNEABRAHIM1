import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { parseRequestPath } from '../test/request-url';
import { renderWithProviders } from '../test/render-with-providers';
import { ServiceDefinitionCreatePage } from './pages/ServiceDefinitionCreatePage';
import { ServiceDefinitionDraftEditPage } from './pages/ServiceDefinitionDraftEditPage';
import {
  VERSION_STATUSES,
  type ServiceDefinitionVersion,
} from './types/service-catalog.types';

/**
 * BUILDER DO CATÁLOGO — prova de interação da tela de configuração de serviço.
 *
 * O que se verifica aqui é o CONTRATO do builder (resumo da edição atual, seções com ação
 * própria, repetidor com remoção confirmada, dinheiro normalizado e ação principal coerente) e
 * não o desenho interno: as regras continuam vindo de `catalog-form-state.ts` e da API.
 */

const DEFINITION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DRAFT_VERSION = 3;
const CATEGORY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_CATEGORY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';

const DEFINITION = {
  id: DEFINITION_ID,
  code: 'LOCACAO-DEMO',
  status: 'ACTIVE',
  version: 7,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deactivatedAt: null,
  deactivationReason: null,
  latestPublishedVersion: 2,
  currentDraftVersion: DRAFT_VERSION,
};

const UNITS = [
  { id: 'u1', code: 'DAY', name: 'Dia', status: 'ACTIVE' },
  { id: 'u2', code: 'KM', name: 'Quilômetro', status: 'ACTIVE' },
];
const RESOURCE_TYPES = [{ id: 'r1', code: 'TRUCK', name: 'Caminhão', status: 'ACTIVE' }];
const LABOR_TYPES = [{ id: 'l1', code: 'DRIVER', name: 'Motorista', status: 'ACTIVE' }];
/** Catálogo real tem dezenas de categorias: é exatamente por isso que não se despeja no select. */
const CATEGORIES = [
  { id: CATEGORY_ID, code: 'LOCACAO', name: 'Locação de veículos' },
  { id: OTHER_CATEGORY_ID, code: 'PORTFOLIO', name: 'Portfólio' },
  { id: 'c3', code: 'TESTE', name: 'TESTE — categoria de teste' },
  { id: 'c4', code: 'UAT', name: 'UAT — homologação' },
  { id: 'c5', code: 'RESIDUOS', name: 'Resíduos' },
];
/** Políticas REAIS do endpoint `/commercial/pricing-models` (unidade exigida por modelo). */
const PRICING_POLICIES = [
  {
    code: 'DAILY',
    persistedCode: 'PER_PERIOD',
    requiredUnitCode: 'DAY',
    impliedUnitCode: 'DAY',
    description: null,
  },
  {
    code: 'PER_KM',
    persistedCode: 'PER_UNIT',
    requiredUnitCode: 'KM',
    impliedUnitCode: 'KM',
    description: null,
  },
];

/**
 * Códigos INTERNOS do catálogo. O valor continua sendo o do payload, mas NENHUM deles pode
 * aparecer como texto: o operador lê "Por período", "Conclusão global", "Após medição aprovada".
 */
const INTERNAL_CODES = [
  'BY_PERIOD',
  'BY_QUANTITY',
  'BY_EVENT',
  'CHECKLIST',
  'UNIT',
  'TIME',
  'DISTANCE',
  'VOLUME',
  'WEIGHT',
  'TRIP',
  'GLOBAL_COMPLETION',
  'MEASUREMENT_APPROVED',
  'FIXED_PRICE',
  'PERIODIC',
  'MILESTONE',
  'REQUIRED',
  'OPTIONAL',
  'CONDITIONAL',
  'PHOTO',
  'DOCUMENT',
  'SIGNATURE',
  'START_TIME',
  'END_TIME',
  'LOCATION',
  'MILEAGE',
  'HOUR_METER',
  'RECEIPT',
  'OBSERVATION',
  'WHEN_MEASUREMENT_BASIS_IS',
  'WHEN_ARCHETYPE_IS',
  'WHEN_RESOURCE_TYPE_IS',
  'WHEN_LABOR_TYPE_IS',
  'GLOBAL_PRICE',
  'UNIT_PRICE',
  'HOURLY',
  'DAILY',
  'MONTHLY',
  'PER_TRIP',
  'PER_KM',
  'PER_M3',
  'NEGOTIATED_PO_PRICE',
  'RENTAL',
  'TRUCK',
  'DRIVER',
  'DAY',
  'HOUR',
  'KM',
  'M2',
];

function draftVersion(): ServiceDefinitionVersion {
  return {
    id: 'vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv',
    serviceDefinitionId: DEFINITION_ID,
    code: 'LOCACAO-DEMO',
    version: DRAFT_VERSION,
    status: VERSION_STATUSES.Draft,
    categoryId: CATEGORY_ID,
    archetype: 'RENTAL',
    name: 'Locação demo',
    description: null,
    defaultUnitCode: 'DAY',
    measurementMode: 'BY_PERIOD',
    measurementBasis: 'TIME',
    billingEntitlementPolicy: 'MEASUREMENT_APPROVED',
    requiresPurchaseOrder: false,
    allowedUnits: [{ unitCode: 'DAY', isDefault: true, sortOrder: 0 }],
    resourceRequirements: [],
    laborRequirements: [],
    pricingModels: [
      {
        modelCode: 'DAILY',
        unitCode: 'DAY',
        salePrice: '100.00',
        internalCost: '80.00',
        currencyCode: 'BRL',
        sortOrder: 0,
      },
    ],
    executionRequirements: [],
    publishedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function catalogError(code: string, status: number): Response {
  return jsonResponse({ error: { code, message: 'error' } }, status);
}

type CapturedRequest = {
  method: string;
  pathname: string;
  body: Record<string, unknown> | null;
};

/**
 * Mock da API do catálogo: sessão, capabilities (todas autorizadas), dados de referência e as
 * MUTAÇÕES reais que as páginas fazem. O corpo enviado é capturado para provar o payload.
 */
function createCatalogBuilderMock(options: { version?: ServiceDefinitionVersion } = {}) {
  const captured: CapturedRequest[] = [];
  const version = options.version ?? draftVersion();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = parseRequestPath(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;

    if (pathname === '/api/v1/auth/session' && method === 'GET') {
      return jsonResponse({
        identityId: '00000000-0000-4000-8000-000000000001',
        session: { id: 'sid', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
      });
    }

    if (pathname === '/api/v1/catalog/service-definitions/categories' && method === 'GET') {
      return jsonResponse({ items: CATEGORIES });
    }
    if (pathname === '/api/v1/catalog/units-of-measure' && method === 'GET') {
      return jsonResponse({ items: UNITS });
    }
    if (pathname === '/api/v1/resources/physical-resource-types' && method === 'GET') {
      return jsonResponse({ items: RESOURCE_TYPES });
    }
    if (pathname === '/api/v1/resources/labor-types' && method === 'GET') {
      return jsonResponse({ items: LABOR_TYPES });
    }
    if (pathname === '/api/v1/commercial/pricing-models' && method === 'GET') {
      return jsonResponse({ items: PRICING_POLICIES });
    }
    if (pathname === '/api/v1/commercial/measurement-models' && method === 'GET') {
      return jsonResponse({ items: [] });
    }

    if (pathname === '/api/v1/catalog/service-definitions') {
      if (method === 'GET') {
        return jsonResponse({ items: [DEFINITION], limit: 20, offset: 0 });
      }
      if (method === 'POST') {
        // A sonda de capability usa corpo vazio; a criação real envia o payload do formulário.
        if (typeof body?.['code'] !== 'string' || body['code'].length === 0) {
          return catalogError('CATALOG_VALIDATION_FAILED', 400);
        }
        captured.push({ method, pathname, body });
        return jsonResponse({ ...version, version: 1 }, 201);
      }
    }

    if (pathname.endsWith('/publish') && method === 'POST') {
      return catalogError('CATALOG_VALIDATION_FAILED', 400);
    }
    if ((pathname.endsWith('/deactivate') || pathname.endsWith('/activate')) && method === 'POST') {
      return catalogError('CATALOG_VALIDATION_FAILED', 400);
    }

    const versionMatch = pathname.match(
      /^\/api\/v1\/catalog\/service-definitions\/[^/]+\/versions\/(\d+)$/,
    );
    if (versionMatch) {
      if (method === 'GET') {
        return jsonResponse(version);
      }
      if (method === 'PATCH') {
        // Sonda de capability envia só `lineageVersion`; o salvamento real envia o formulário.
        if (typeof body?.['name'] !== 'string') {
          return catalogError('CATALOG_VALIDATION_FAILED', 400);
        }
        captured.push({ method, pathname, body });
        return jsonResponse(version);
      }
    }

    const definitionMatch = pathname.match(
      /^\/api\/v1\/catalog\/service-definitions\/[^/]+$/,
    );
    if (definitionMatch && method === 'GET') {
      return jsonResponse(DEFINITION);
    }

    return catalogError('CATALOG_NOT_FOUND', 404);
  });

  return { fetchMock, captured };
}

function renderDraftEditor() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/catalog/:definitionId/versions/:versionNumber/edit"
        element={<ServiceDefinitionDraftEditPage />}
      />
    </Routes>,
    {
      router: {
        initialEntries: [`/app/catalog/${DEFINITION_ID}/versions/${DRAFT_VERSION}/edit`],
      },
    },
  );
}

async function waitForBuilder() {
  // A seção do repetidor de preços é o marco estável de "builder pronto".
  await screen.findByRole('button', { name: '+ Adicionar modelo de preço' });
}

/**
 * Escolhe a categoria pelo caminho humano: busca por termo e escolha na lista do lookup.
 * O catálogo de categorias não é despejado inteiro no select.
 */
async function chooseCategory(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/buscar categoria/i), 'locação');

  const categorySelect = screen.getByLabelText(/^categoria/i);
  await waitFor(() => {
    expect(within(categorySelect).getAllByRole('option').length).toBeGreaterThan(1);
  });
  await user.selectOptions(categorySelect, CATEGORY_ID);
}

/** Preenche o mínimo autoritativo para a criação (código, nome e categoria humana). */
async function fillRequiredCreateFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^código da definição/i), 'servico-teste');
  await user.type(screen.getByLabelText(/^nome/i), 'Serviço teste');
  await chooseCategory(user);
}

describe('Builder do catálogo de serviços', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('mostra o resumo da edição atual com a contagem real de itens', async () => {
    const user = userEvent.setup();
    const { fetchMock } = createCatalogBuilderMock();
    vi.stubGlobal('fetch', fetchMock);
    renderDraftEditor();
    await waitForBuilder();

    const summary = screen.getByLabelText('Resumo da configuração');
    expect(within(summary).getByText('Locação')).toBeInTheDocument();
    expect(within(summary).getByText('1 modelo de preço')).toBeInTheDocument();
    expect(within(summary).getByText('0 recursos físicos')).toBeInTheDocument();

    // O item do repetidor traz o contexto real: modelo · unidade humana, e a política do servidor.
    expect(screen.getByText('Diário · Dia')).toBeInTheDocument();
    expect(screen.getByText('O modelo Diário usa a unidade Dia.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ Adicionar modelo de preço' }));
    await user.click(screen.getByRole('button', { name: '+ Adicionar recurso físico' }));

    expect(within(summary).getByText('2 modelos de preço')).toBeInTheDocument();
    expect(within(summary).getByText('1 recurso físico')).toBeInTheDocument();

    // O requisito novo abre com contexto real (tipo humano, nível e quantidade) — não em branco.
    expect(screen.getByText(/Caminhão · Opcional · mín\. 1/)).toBeInTheDocument();
  });

  it('abre o painel de condição quando a evidência exige condição', async () => {
    const user = userEvent.setup();
    const { fetchMock } = createCatalogBuilderMock();
    vi.stubGlobal('fetch', fetchMock);
    renderDraftEditor();
    await waitForBuilder();

    await user.click(screen.getByRole('button', { name: '+ Adicionar evidência' }));

    expect(screen.queryByLabelText('Condição da evidência')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Nível da evidência'), 'CONDITIONAL');

    const condition = await screen.findByLabelText('Condição da evidência');
    expect(within(condition).getAllByRole('option')).toHaveLength(5);
    await user.selectOptions(condition, 'WHEN_MEASUREMENT_BASIS_IS');
    expect(
      screen.getByText(/Foto · Condicional · Quando a base de medição for/),
    ).toBeInTheDocument();
    // O código continua sendo o valor enviado ao servidor.
    expect(screen.getByLabelText('Nível da evidência')).toHaveValue('CONDITIONAL');
    expect(screen.getByLabelText('Condição da evidência')).toHaveValue('WHEN_MEASUREMENT_BASIS_IS');
  });

  it('não despeja o catálogo inteiro de categorias: a categoria é escolhida por busca humana', async () => {
    const user = userEvent.setup();
    const { fetchMock } = createCatalogBuilderMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ServiceDefinitionCreatePage />);
    await waitForBuilder();

    const categorySelect = screen.getByLabelText(/^categoria/i);
    // Antes de buscar, nada de lista nativa com dezenas de nomes técnicos.
    await waitFor(() => {
      expect(within(categorySelect).getAllByRole('option')).toHaveLength(1);
    });
    expect(
      await screen.findByText(/busque a categoria pelo nome ou pelo código/i),
    ).toBeInTheDocument();
    expect(within(categorySelect).queryByRole('option', { name: /portfólio/i })).toBeNull();

    await user.type(screen.getByLabelText(/buscar categoria/i), 'port');
    await waitFor(() => {
      expect(within(categorySelect).getAllByRole('option')).toHaveLength(2);
    });
    expect(within(categorySelect).getByRole('option', { name: /Portfólio/ })).toBeInTheDocument();
    expect(within(categorySelect).queryByRole('option', { name: /UAT/ })).toBeNull();

    // O identificador técnico nunca é exibido nem digitado.
    expect(document.body.textContent ?? '').not.toContain(OTHER_CATEGORY_ID);
    expect(document.body.textContent ?? '').not.toContain(CATEGORY_ID);
  });

  it('não exibe nenhum código interno de enum como texto na tela', async () => {
    const { fetchMock } = createCatalogBuilderMock({
      version: {
        ...draftVersion(),
        resourceRequirements: [
          { resourceTypeCode: 'TRUCK', requirementLevel: 'REQUIRED', minQuantity: 1, sortOrder: 0 },
        ],
        laborRequirements: [
          { laborTypeCode: 'DRIVER', requirementLevel: 'OPTIONAL', minQuantity: 1, sortOrder: 0 },
        ],
        executionRequirements: [
          {
            requirementType: 'PHOTO',
            requirementLevel: 'CONDITIONAL',
            config: { schemaVersion: 1, conditional: { conditionType: 'WHEN_MEASUREMENT_BASIS_IS' } },
            sortOrder: 0,
          },
        ],
        pricingModels: [
          {
            modelCode: 'PER_KM',
            unitCode: 'KM',
            salePrice: '3.50',
            internalCost: '1.00',
            currencyCode: 'BRL',
            sortOrder: 0,
          },
        ],
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDraftEditor();
    await waitForBuilder();

    // Tudo que o operador lê está em português de negócio.
    expect(screen.getByText(/Caminhão · Obrigatório · mín\. 1/)).toBeInTheDocument();
    expect(screen.getByText(/Motorista · Opcional · mín\. 1/)).toBeInTheDocument();
    expect(
      screen.getByText(/Foto · Condicional · Quando a base de medição for/),
    ).toBeInTheDocument();
    expect(screen.getByText('Por quilômetro · Quilômetro')).toBeInTheDocument();

    const mode = screen.getByLabelText<HTMLSelectElement>('Modo de medição');
    expect(mode).toHaveValue('BY_PERIOD');
    expect(mode.selectedOptions[0]?.textContent).toBe('Por período');
    const basis = screen.getByLabelText<HTMLSelectElement>('Base de medição');
    expect(basis).toHaveValue('TIME');
    expect(basis.selectedOptions[0]?.textContent).toBe('Tempo');
    const billing = screen.getByLabelText<HTMLSelectElement>('Política de faturamento');
    expect(billing).toHaveValue('MEASUREMENT_APPROVED');
    expect(billing.selectedOptions[0]?.textContent).toBe('Após medição aprovada');

    // TODO texto renderizado (opções de select incluídas) passa pelo crivo: nenhum código interno.
    const rendered = document.body.textContent ?? '';
    for (const code of INTERNAL_CODES) {
      expect(rendered).not.toContain(code);
    }
    // Nenhum identificador técnico de categoria visível.
    expect(rendered).not.toContain(CATEGORY_ID);
  });

  it('adiciona e remove modelo de preço pelo repetidor, com confirmação na remoção', async () => {
    const user = userEvent.setup();
    const { fetchMock } = createCatalogBuilderMock();
    vi.stubGlobal('fetch', fetchMock);
    renderDraftEditor();
    await waitForBuilder();

    expect(screen.getAllByRole('button', { name: /^Remover o modelo de preço \d+$/ })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '+ Adicionar modelo de preço' }));

    const removeButtons = screen.getAllByRole('button', { name: /^Remover o modelo de preço \d+$/ });
    expect(removeButtons).toHaveLength(2);
    // Remoção discreta: texto secundário com nome acessível explícito por item.
    expect(removeButtons[1]).toHaveTextContent('Remover');
    expect(removeButtons[1]).toHaveAccessibleName('Remover o modelo de preço 2');

    await user.click(removeButtons[1] as HTMLElement);
    expect(screen.getByText('Remover este item?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmar remoção' }));
    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: /^Remover o modelo de preço \d+$/ }),
      ).toHaveLength(1);
    });

    // Cancelar a remoção mantém a linha: nada é perdido sem confirmação.
    await user.click(screen.getByRole('button', { name: '+ Adicionar modelo de preço' }));
    await user.click(screen.getByRole('button', { name: 'Remover o modelo de preço 2' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar remoção' }));
    expect(screen.getAllByRole('button', { name: /^Remover o modelo de preço \d+$/ })).toHaveLength(
      2,
    );
  });

  it('entrada monetária inválida mostra erro inline e não vira valor no payload', async () => {
    const user = userEvent.setup();
    const { fetchMock, captured } = createCatalogBuilderMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ServiceDefinitionCreatePage />);
    await waitForBuilder();

    await fillRequiredCreateFields(user);

    const price = screen.getByLabelText('Preço de venda');
    await user.type(price, 'abc');
    await user.tab();

    expect(await screen.findByText(/informe um valor monetário válido/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Criar rascunho' }));

    await waitFor(() => {
      expect(captured).toHaveLength(1);
    });
    const body = captured[0]?.body ?? {};
    const models = body['pricingModels'] as Array<Record<string, unknown>>;
    expect(models).toHaveLength(1);
    expect(models[0]?.['salePrice']).toBeNull();
    expect(JSON.stringify(body)).not.toContain('abc');
  });

  it('normaliza "1.500,50" para "1500.50" no payload', async () => {
    const user = userEvent.setup();
    const { fetchMock, captured } = createCatalogBuilderMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ServiceDefinitionCreatePage />);
    await waitForBuilder();

    await fillRequiredCreateFields(user);

    const price = screen.getByLabelText('Preço de venda');
    await user.type(price, '1.500,50');
    await user.tab();

    // Em repouso o campo mostra BRL; o valor guardado é decimal normalizado.
    expect((price as HTMLInputElement).value.replace(/\u00a0/g, ' ')).toBe('R$ 1.500,50');

    await user.click(screen.getByRole('button', { name: 'Criar rascunho' }));

    await waitFor(() => {
      expect(captured).toHaveLength(1);
    });
    const body = captured[0]?.body ?? {};
    const models = body['pricingModels'] as Array<Record<string, unknown>>;
    expect(models[0]?.['salePrice']).toBe('1500.50');
  });

  it('mantém a ação principal visível e só habilita com a edição válida', async () => {
    const user = userEvent.setup();
    const { fetchMock } = createCatalogBuilderMock();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ServiceDefinitionCreatePage />);
    await waitForBuilder();

    const primary = screen.getByRole('button', { name: 'Criar rascunho' });
    expect(primary).toBeDisabled();
    // Desabilitada, a ação diz o que falta — a mesma validação autoritativa, com nomes humanos.
    expect(screen.getByText(/faltam: código, nome, categoria/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cancelar' })).toBeInTheDocument();

    await fillRequiredCreateFields(user);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Criar rascunho' })).toBeEnabled();
    });
  });

  it('não deixa nenhum botão ou link sem nome acessível', async () => {
    const user = userEvent.setup();
    const { fetchMock } = createCatalogBuilderMock();
    vi.stubGlobal('fetch', fetchMock);
    renderDraftEditor();
    await waitForBuilder();

    // Estado de confirmação de remoção incluído: é onde nascem os botões de texto curtos.
    await user.click(screen.getByRole('button', { name: 'Remover o modelo de preço 1' }));

    const controls = [...screen.getAllByRole('button'), ...screen.getAllByRole('link')];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control).toHaveAccessibleName();
    }
  });

  it('renderiza estado negado honesto quando a capability de edição não existe', async () => {
    const { fetchMock } = createCatalogBuilderMock();
    const deniedMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = parseRequestPath(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (pathname.startsWith('/api/v1/catalog/service-definitions') && method !== 'GET') {
        return catalogError('CATALOG_DENIED', 403);
      }
      return fetchMock(input, init);
    });
    vi.stubGlobal('fetch', deniedMock);
    renderDraftEditor();

    expect(await screen.findByText(/não tem permissão para editar rascunhos/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).not.toBeInTheDocument();
  });
});
