import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import { ServiceRequestCreatePage } from './pages/ServiceRequestCreatePage';

/**
 * Tela de registro da solicitação na gramatica do STRUCTURED BUILDER.
 *
 * Esta tela NAO tem dinheiro nem colecao de linhas — a demanda e um registro unico. O contrato de
 * interacao que se prova aqui e o que a tela realmente carrega: resumo do que esta sendo criado,
 * secoes com nome de negocio, campos de entidade pela BUSCA HUMANA (nao por lista nativa de
 * identificadores), acao principal coerente com a validade real e nenhum controle sem nome.
 */

const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UNIT = 'UN-POA-01';
const SERVICE_DEFINITION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SERVICE_VERSION_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, status: number): Response {
  return jsonResponse({ error: { code, message: 'error' } }, status);
}

type CapturedCreate = { payloads: Array<Record<string, unknown>> };

function createServiceRequestCreateFetchMock(
  captured: CapturedCreate = { payloads: [] },
  options: { publishedServices?: boolean } = {},
) {
  const hasPublishedServices = options.publishedServices ?? true;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, 'http://127.0.0.1');
    const pathname = url.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();

    if (pathname === '/api/v1/auth/session' && method === 'GET') {
      return jsonResponse({
        identityId: '00000000-0000-4000-8000-000000000001',
        session: { id: 'sid', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
      });
    }

    if (pathname === '/api/v1/requests/service-requests/operational-units' && method === 'GET') {
      return jsonResponse({ items: [UNIT] });
    }

    if (pathname === '/api/v1/clients' && method === 'GET') {
      return jsonResponse({
        items: [
          {
            id: CLIENT_ID,
            legalName: 'Cliente Demonstração LTDA',
            tradeName: 'Demo',
            taxId: '11222333000181',
            status: 'ACTIVE',
            createdAt: '2026-01-01T12:00:00.000Z',
            updatedAt: '2026-01-01T12:00:00.000Z',
          },
        ],
        limit: 20,
        offset: 0,
        total: 1,
        totalPages: 1,
      });
    }

    if (pathname === '/api/v1/catalog/service-definitions' && method === 'GET') {
      return jsonResponse({
        items: hasPublishedServices
          ? [
              {
                id: SERVICE_DEFINITION_ID,
                code: 'SRV-001',
                status: 'ACTIVE',
                version: 2,
                createdAt: '2026-01-01T12:00:00.000Z',
                updatedAt: '2026-01-01T12:00:00.000Z',
                deactivatedAt: null,
                deactivationReason: null,
                latestPublishedVersion: 2,
                currentDraftVersion: null,
              },
            ]
          : [],
        limit: 100,
        offset: 0,
      });
    }

    if (pathname.endsWith('/versions') && method === 'GET' && pathname.includes('/catalog/')) {
      return jsonResponse([
        {
          id: SERVICE_VERSION_ID,
          serviceDefinitionId: SERVICE_DEFINITION_ID,
          code: 'SRV-001',
          version: 2,
          status: 'PUBLISHED',
        },
      ]);
    }

    if (pathname === '/api/v1/requests/service-requests' && method === 'POST') {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
        string,
        unknown
      >;
      // A sonda de capacidade envia corpo vazio; o registro real manda a unidade.
      if (typeof body['unitId'] !== 'string' || body['unitId'].length === 0) {
        return errorResponse('REQUESTS_VALIDATION_FAILED', 400);
      }
      captured.payloads.push(body);
      return jsonResponse(
        {
          serviceRequest: {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            requestCode: 'SR-2026-UI01',
            unitId: body['unitId'],
            status: 'DRAFT',
            originSource: body['originSource'],
            externalContact: body['externalContact'] ?? {},
            externalOriginReference: null,
            clientId: body['clientId'] ?? null,
            serviceDefinitionId: body['serviceDefinitionId'] ?? null,
            serviceDefinitionVersionId: body['serviceDefinitionVersionId'] ?? null,
            description: body['description'] ?? null,
            location: {},
            desiredStartAt: null,
            desiredEndAt: null,
            priority: null,
            operationalNotes: null,
            proposalId: null,
            purchaseOrderId: null,
            submittedAt: null,
            reviewStartedAt: null,
            approvedAt: null,
            rejectedAt: null,
            rejectionReason: null,
            cancelledAt: null,
            cancellationReason: null,
            convertedAt: null,
            convertedServiceOrderId: null,
            rowVersion: 1,
            createdByIdentityId: '00000000-0000-4000-8000-000000000001',
            createdAt: '2026-01-01T12:00:00.000Z',
            updatedAt: '2026-01-01T12:00:00.000Z',
          },
          documentLinks: [],
          historyEvents: [],
          related: { client: null, service: null },
          linkedChain: [],
          readiness: {
            nextStep: 'SUBMIT_REQUEST',
            nextStepTransition: 'submit',
            availableTransitions: ['submit', 'cancel'],
            blockers: [],
          },
        },
        201,
      );
    }

    // Demais caminhos da sonda de capacidade: negado/ausente, nunca "autorizado" implicito.
    return errorResponse('REQUESTS_NOT_FOUND', 404);
  });
}

/**
 * Nome acessivel do controle: `aria-label`, `aria-labelledby`, `<label>` associado, texto visivel
 * ou `title` — a mesma ordem que um leitor de tela usa para anunciar o controle.
 */
function accessibleName(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label')?.trim();
  if (ariaLabel) {
    return ariaLabel;
  }
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text) {
      return text;
    }
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const labels = element.labels ? Array.from(element.labels) : [];
    const text = labels
      .map((label) => label.textContent ?? '')
      .join(' ')
      .trim();
    if (text) {
      return text;
    }
  }
  const content = element.textContent?.trim();
  if (content) {
    return content;
  }
  return element.getAttribute('title')?.trim() ?? '';
}

/** Preenche o minimo que a regra da tela exige: origem, unidade, contato externo e descricao. */
async function fillDemand(user: ReturnType<typeof userEvent.setup>, description = 'Falha no painel') {
  await user.selectOptions(
    await screen.findByLabelText(/^origem/i, { selector: 'select' }),
    'PHONE',
  );
  await user.selectOptions(
    await screen.findByLabelText(/^unidade operacional/i, { selector: 'select' }),
    UNIT,
  );
  await user.type(screen.getByLabelText('Nome do contato externo'), 'Maria Souza');
  await user.type(screen.getByLabelText(/^descrição/i, { selector: 'textarea' }), description);
}

configure({ asyncUtilTimeout: 3000 });

describe('ServiceRequestCreatePage — structured builder', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('organiza a demanda em seções de negócio e resume o que está sendo criado', async () => {
    const captured: CapturedCreate = { payloads: [] };
    vi.stubGlobal('fetch', createServiceRequestCreateFetchMock(captured));
    const user = userEvent.setup();
    renderWithProviders(<ServiceRequestCreatePage />);

    await screen.findByRole('heading', { name: 'Origem da solicitação' });
    expect(screen.getByRole('heading', { name: 'Cliente, unidade e contato' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Detalhes da demanda' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Observações operacionais' }),
    ).toBeInTheDocument();

    await fillDemand(user, 'Substituição de painel danificado');

    // Resumo com os FATOS desta edicao — nada inventado, nada tecnico.
    const summary = screen.getByLabelText('Resumo da configuração');
    expect(within(summary).getByText('Telefone')).toBeInTheDocument();
    expect(within(summary).getByText(UNIT)).toBeInTheDocument();
    expect(within(summary).getByText('Maria Souza')).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: /registrar solicitação/i });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await user.click(submit);

    await waitFor(() => {
      expect(captured.payloads).toHaveLength(1);
    });
    expect(captured.payloads[0]).toMatchObject({
      unitId: UNIT,
      originSource: 'PHONE',
      description: 'Substituição de painel danificado',
      externalContact: { name: 'Maria Souza' },
    });
  });

  it('mantém a ação principal bloqueada até a demanda ter origem, unidade e descrição', async () => {
    const captured: CapturedCreate = { payloads: [] };
    vi.stubGlobal('fetch', createServiceRequestCreateFetchMock(captured));
    const user = userEvent.setup();
    renderWithProviders(<ServiceRequestCreatePage />);

    const submit = await screen.findByRole('button', { name: /registrar solicitação/i });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/falta preencher/i)).toBeInTheDocument();

    await fillDemand(user);

    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    expect(screen.queryByText(/falta preencher/i)).not.toBeInTheDocument();
    expect(captured.payloads).toHaveLength(0);
  });

  it('escolhe o Cliente pela busca humana do cadastro, não por lista de identificadores', async () => {
    vi.stubGlobal('fetch', createServiceRequestCreateFetchMock());
    const user = userEvent.setup();
    renderWithProviders(<ServiceRequestCreatePage />);

    const clientSelect = await screen.findByLabelText(/^cliente/i, { selector: 'select' });
    await waitFor(() => {
      expect(within(clientSelect).getAllByRole('option').length).toBeGreaterThan(1);
    });
    await user.selectOptions(clientSelect, CLIENT_ID);

    expect(within(screen.getByLabelText('Resumo da configuração')).getByText('Demo')).toBeInTheDocument();
  });

  it('vincula o serviço publicado pela busca do catálogo', async () => {
    const captured: CapturedCreate = { payloads: [] };
    vi.stubGlobal('fetch', createServiceRequestCreateFetchMock(captured));
    const user = userEvent.setup();
    renderWithProviders(<ServiceRequestCreatePage />);

    const serviceSelect = await screen.findByLabelText(/^serviço do catálogo/i, {
      selector: 'select',
    });
    await waitFor(() => {
      expect(within(serviceSelect).getAllByRole('option').length).toBeGreaterThan(1);
    });
    await user.selectOptions(serviceSelect, SERVICE_VERSION_ID);
    await fillDemand(user);

    const submit = screen.getByRole('button', { name: /registrar solicitação/i });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await user.click(submit);

    await waitFor(() => {
      expect(captured.payloads).toHaveLength(1);
    });
    expect(captured.payloads[0]).toMatchObject({
      serviceDefinitionId: SERVICE_DEFINITION_ID,
      serviceDefinitionVersionId: SERVICE_VERSION_ID,
    });
  });

  it('declara a ausência de serviço publicado sem inventar opção', async () => {
    vi.stubGlobal('fetch', createServiceRequestCreateFetchMock({ payloads: [] }, { publishedServices: false }));
    renderWithProviders(<ServiceRequestCreatePage />);

    const serviceSelect = await screen.findByLabelText(/^serviço do catálogo/i, {
      selector: 'select',
    });
    expect(serviceSelect).toBeDisabled();
    expect(
      screen.getByText(/publique um serviço no catálogo para converter a solicitação em os/i),
    ).toBeInTheDocument();
  });

  it('não deixa nenhum controle sem nome acessível', async () => {
    vi.stubGlobal('fetch', createServiceRequestCreateFetchMock());
    const { container } = renderWithProviders(<ServiceRequestCreatePage />);

    await screen.findByRole('heading', { name: 'Detalhes da demanda' });
    await screen.findByLabelText(/^cliente/i, { selector: 'select' });

    const controls = Array.from(
      container.querySelectorAll('button, a, input, select, textarea'),
    );
    expect(controls.length).toBeGreaterThan(10);

    const unnamed = controls.filter((control) => accessibleName(control) === '');
    expect(unnamed.map((control) => control.outerHTML)).toEqual([]);
  });
});

