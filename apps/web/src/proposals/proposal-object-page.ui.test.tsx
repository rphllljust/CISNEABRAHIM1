import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import { ProposalDetailPage } from './pages/ProposalDetailPage';
import {
  PROPOSAL_PRICING_STRUCTURES,
  PROPOSAL_VERSION_STATUSES,
  type Proposal,
  type ProposalDetail,
  type ProposalLinked,
  type ProposalVersion,
  type ProposalVersionStatus,
} from './types/proposal.types';

/**
 * OBJECT PAGE CANONICA DA PROPOSTA — contrato enterprise verificado no comportamento.
 *
 * O que este arquivo prova, de forma nao negociavel:
 *  1. o header mostra a REFERENCIA humana e o NOME do cliente, nunca um uuid;
 *  2. o fluxo marca o estado real da revisao vigente (ou desaparece sem progressao real);
 *  3. a acao primaria do rascunho some quando a capability nega a transicao;
 *  4. relacao nao autorizada nao aparece por inteiro (sem rotulo, sem contagem, sem "oculto");
 *  5. custo interno nao aparece — o modulo nao possui concessao de custo/margem;
 *  6. o historico mostra apenas fatos PERSISTIDOS.
 */

const PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MOCK_IDENTITY_ID = '11111111-1111-4111-8111-111111111111';
const PROBE_PROPOSAL_ID = '00000000-0000-4000-8000-000000000003';

const CLIENT_NAME = 'Amaggi Originação';
const PROPOSAL_CODE = 'COM-2026-0042';
const PROPOSAL_TITLE = 'Manutenção de pátio logístico';
const UNIT_ID = 'Unidade Rondonópolis';
const INTERNAL_COST = '4321.0000';

type CapabilitySet = {
  read?: boolean;
  update?: boolean;
  issue?: boolean;
  accept?: boolean;
  reject?: boolean;
  expire?: boolean;
  cancel?: boolean;
};

type MockOptions = {
  status: ProposalVersionStatus;
  capabilities?: CapabilitySet;
  /** Elos autorizados pelo modulo dono; `[]` = nada autorizado. */
  linkedChain?: ProposalLinked[];
  clientName?: string | null;
  revisionsCount?: number;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function denied(): Response {
  return jsonResponse({ error: { code: 'COMMERCIAL_DENIED', message: 'Denied.' } }, 403);
}

const STATUS_TIMESTAMPS: Record<ProposalVersionStatus, string | null> = {
  DRAFT: null,
  ISSUED: '2026-02-02T12:00:00.000Z',
  ACCEPTED: '2026-02-02T12:00:00.000Z',
  REJECTED: '2026-02-02T12:00:00.000Z',
  EXPIRED: '2026-02-02T12:00:00.000Z',
  CANCELLED: '2026-02-02T12:00:00.000Z',
};

function buildVersion(status: ProposalVersionStatus): ProposalVersion {
  const issuedAt = STATUS_TIMESTAMPS[status];
  return {
    id: `${PROPOSAL_ID}-v1`,
    proposalId: PROPOSAL_ID,
    versionNumber: 1,
    status,
    pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
    currencyCode: 'BRL',
    globalSalePrice: '185000.0000',
    // Custo real presente no payload: a tela NAO pode exibi-lo sem concessao propria.
    globalInternalCost: INTERNAL_COST,
    itemsSaleTotal: null,
    itemsInternalCostTotal: INTERNAL_COST,
    commercialTerms: { paymentTerms: '30 dias' },
    clientSnapshot: { tradeName: CLIENT_NAME },
    validUntil: '2026-12-20T23:59:59.000Z',
    notes: null,
    issuedAt,
    issuedByIdentityId: MOCK_IDENTITY_ID,
    supersededAt: null,
    acceptedAt: status === PROPOSAL_VERSION_STATUSES.Accepted ? '2026-03-01T12:00:00.000Z' : null,
    acceptedByIdentityId: null,
    acceptanceOriginCode: null,
    acceptanceEvidenceDocumentId: null,
    rejectedAt: status === PROPOSAL_VERSION_STATUSES.Rejected ? '2026-03-01T12:00:00.000Z' : null,
    rejectionReason: status === PROPOSAL_VERSION_STATUSES.Rejected ? 'Preço acima do orçado' : null,
    expiredAt: status === PROPOSAL_VERSION_STATUSES.Expired ? '2026-03-01T12:00:00.000Z' : null,
    cancelledAt: status === PROPOSAL_VERSION_STATUSES.Cancelled ? '2026-03-01T12:00:00.000Z' : null,
    cancellationReason: null,
    rowVersion: 1,
    items: [],
    documents: [],
  };
}

const TRANSITIONS_BY_STATUS: Record<ProposalVersionStatus, string[]> = {
  DRAFT: ['issue', 'cancel'],
  ISSUED: ['accept', 'reject', 'expire', 'cancel'],
  ACCEPTED: ['revise'],
  REJECTED: ['revise'],
  EXPIRED: ['revise'],
  CANCELLED: ['revise'],
};

/** Espelho do backend: transicoes reais do estado ∩ permissoes concedidas. */
function buildDetail(options: MockOptions): ProposalDetail {
  const status = options.status;
  const capabilities = options.capabilities ?? {};
  const permitted: Record<string, boolean> = {
    issue: capabilities.issue ?? true,
    accept: capabilities.accept ?? true,
    reject: capabilities.reject ?? true,
    expire: capabilities.expire ?? true,
    cancel: capabilities.cancel ?? true,
    revise: capabilities.update ?? true,
  };
  const availableTransitions = (TRANSITIONS_BY_STATUS[status] ?? []).filter(
    (transition) => permitted[transition] === true,
  ) as ProposalDetail['readiness']['availableTransitions'];

  const proposal: Proposal = {
    id: PROPOSAL_ID,
    proposalCode: PROPOSAL_CODE,
    clientId: CLIENT_ID,
    unitId: UNIT_ID,
    title: PROPOSAL_TITLE,
    currentVersionNumber: 1,
    rowVersion: 1,
    createdAt: '2026-02-01T09:00:00.000Z',
    updatedAt: '2026-02-01T09:00:00.000Z',
    currentVersionStatus: status,
    currencyCode: 'BRL',
    saleTotal: '185000.0000',
    validUntil: '2026-12-20T23:59:59.000Z',
  };

  const version = buildVersion(status);
  const revisionCount = options.revisionsCount ?? 1;

  return {
    proposal,
    currentVersion: version,
    // `null` = o modulo CLIENTES nao autorizou o nome do cliente para este ator.
    related: {
      client: options.clientName === null ? null : { id: CLIENT_ID, name: options.clientName ?? CLIENT_NAME },
    },
    revisions: Array.from({ length: revisionCount }, (_, index) => ({
      versionNumber: index + 1,
      status: index + 1 === revisionCount ? status : PROPOSAL_VERSION_STATUSES.Draft,
      saleTotal: '185000.0000',
      currencyCode: 'BRL',
      validUntil: '2026-12-20T23:59:59.000Z',
      createdAt: `2026-02-0${index + 1}T09:00:00.000Z`,
      issuedAt: index + 1 === revisionCount ? version.issuedAt : null,
      acceptedAt: null,
      rejectedAt: null,
      expiredAt: null,
      cancelledAt: null,
      supersededAt: null,
      isCurrent: index + 1 === revisionCount,
      supersedesVersionNumber: index === 0 ? null : index,
      itemCount: 0,
    })),
    revisionComparison: null,
    linkedChain: options.linkedChain ?? [],
    readiness: {
      nextStep:
        status === PROPOSAL_VERSION_STATUSES.Draft
          ? 'COMPLETE_AND_ISSUE'
          : status === PROPOSAL_VERSION_STATUSES.Issued
            ? 'AWAIT_CLIENT_DECISION'
            : status === PROPOSAL_VERSION_STATUSES.Accepted
              ? 'FOLLOW_COMMERCIAL_FLOW'
              : 'CREATE_NEW_REVISION',
      nextStepTransition:
        status === PROPOSAL_VERSION_STATUSES.Draft && availableTransitions.includes('issue')
          ? 'issue'
          : status === PROPOSAL_VERSION_STATUSES.Issued && availableTransitions.includes('accept')
            ? 'accept'
            : availableTransitions.includes('revise')
              ? 'revise'
              : null,
      availableTransitions,
      blockers: [],
    },
  };
}

function createProposalFetchMock(options: MockOptions) {
  const capabilities = options.capabilities ?? {};
  const detail = buildDetail(options);
  const canRead = capabilities.read ?? true;
  const canProbe = (path: string): boolean => {
    if (path.endsWith('/issue')) {
      return capabilities.issue ?? true;
    }
    if (path.endsWith('/accept')) {
      return capabilities.accept ?? true;
    }
    if (path.endsWith('/reject')) {
      return capabilities.reject ?? true;
    }
    if (path.endsWith('/expire')) {
      return capabilities.expire ?? true;
    }
    if (path.endsWith('/cancel')) {
      return capabilities.cancel ?? true;
    }
    return capabilities.update ?? true;
  };

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, 'http://127.0.0.1');
    const pathname = url.pathname;
    const method = (init?.method ?? 'GET').toUpperCase();

    if (pathname === '/api/v1/auth/session' && method === 'GET') {
      return jsonResponse({
        identityId: MOCK_IDENTITY_ID,
        session: { id: 'sid', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
      });
    }

    if (pathname.startsWith('/api/v1/commercial/proposals')) {
      const isProbe = pathname.includes(PROBE_PROPOSAL_ID);

      if (pathname === '/api/v1/commercial/proposals' && method === 'GET') {
        return jsonResponse({ items: [], limit: 1, offset: 0 });
      }
      if (pathname === '/api/v1/commercial/proposals' && method === 'POST') {
        return denied();
      }

      if (pathname.endsWith('/versions') && method === 'GET') {
        if (isProbe) {
          return denied();
        }
        return jsonResponse([detail.currentVersion]);
      }

      if (method === 'GET') {
        if (isProbe) {
          return canRead ? jsonResponse(detail) : denied();
        }
        return jsonResponse(detail);
      }

      // Sondagens de capability: `denied` marca ausencia de concessao; qualquer outro erro
      // (404/400) prova que o ator passou pela autorizacao.
      return canProbe(pathname) ? jsonResponse(detail, 400) : denied();
    }

    return jsonResponse({ error: { code: 'UNKNOWN', message: 'Not found.' } }, 404);
  });
}

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/proposals/:proposalId" element={<ProposalDetailPage />} />
    </Routes>,
    { router: { initialEntries: [`/app/proposals/${PROPOSAL_ID}`] } },
  );
}

/** Aguarda a pagina sair do carregamento: o titulo real da proposta aparece no header. */
async function waitForObjectPage() {
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: PROPOSAL_TITLE })).toBeInTheDocument();
  });
}

function objectHeader(): HTMLElement {
  const heading = screen.getByRole('heading', { name: PROPOSAL_TITLE });
  const header = heading.closest('header');
  if (!header) {
    throw new Error('o cabecalho do objeto nao foi renderizado');
  }
  return header;
}

describe('Proposta — object page canonica', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('mostra a referência humana e o NOME do cliente no header, nunca um uuid', async () => {
    vi.stubGlobal('fetch', createProposalFetchMock({ status: PROPOSAL_VERSION_STATUSES.Draft }));
    renderPage();
    await waitForObjectPage();

    const header = objectHeader();
    // Referencia de negocio (codigo humano) e nome do cliente.
    expect(within(header).getAllByText(PROPOSAL_CODE).length).toBeGreaterThan(0);
    expect(within(header).getAllByText(CLIENT_NAME).length).toBeGreaterThan(0);
    // Fatos reais do cabecalho.
    expect(within(header).getByText('Valor total')).toBeInTheDocument();
    expect(within(header).getByText('Válida até')).toBeInTheDocument();
    expect(within(header).getByText('Revisão')).toBeInTheDocument();
    // Estado real persistido, com rotulo humano.
    expect(within(header).getByLabelText(/status: rascunho/i)).toBeInTheDocument();

    // Nenhum identificador tecnico em lugar nenhum da tela.
    for (const uuid of [PROPOSAL_ID, CLIENT_ID, MOCK_IDENTITY_ID, PROBE_PROPOSAL_ID]) {
      expect(screen.queryByText(uuid)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/commercial:proposal[a-z:]*/i)).not.toBeInTheDocument();
  });

  it('marca o estado real da revisão vigente no fluxo', async () => {
    vi.stubGlobal('fetch', createProposalFetchMock({ status: PROPOSAL_VERSION_STATUSES.Issued }));
    renderPage();
    await waitForObjectPage();

    const flow = screen.getByRole('region', { name: /ciclo da revisão/i });
    // Progressao real: rascunho -> emitida, com o estado vigente marcado.
    expect(within(flow).getByText('Rascunho')).toBeInTheDocument();
    expect(within(flow).getByText('Emitida')).toHaveAttribute('aria-current', 'step');
    expect(within(flow).getByText('Rascunho')).not.toHaveAttribute('aria-current');
    // Estados que NAO aconteceram nao sao inventados como etapa.
    expect(within(flow).queryByText('Aceita')).not.toBeInTheDocument();
    expect(within(flow).queryByText('Rejeitada')).not.toBeInTheDocument();
  });

  it('não renderiza fluxo quando não existe progressão real', async () => {
    vi.stubGlobal('fetch', createProposalFetchMock({ status: PROPOSAL_VERSION_STATUSES.Draft }));
    renderPage();
    await waitForObjectPage();

    // Rascunho e a unica etapa real: sem progressao, sem fluxo — o estado continua no header.
    expect(screen.queryByRole('region', { name: /ciclo da revisão/i })).not.toBeInTheDocument();
    expect(within(objectHeader()).getByLabelText(/status: rascunho/i)).toBeInTheDocument();
  });

  it('não oferece a ação primária do rascunho quando a capability nega a emissão', async () => {
    vi.stubGlobal(
      'fetch',
      createProposalFetchMock({
        status: PROPOSAL_VERSION_STATUSES.Draft,
        capabilities: { issue: false, update: false, cancel: true },
      }),
    );
    renderPage();
    await waitForObjectPage();

    // Negativa de autorizacao: a transicao nao aparece em lugar nenhum da pagina.
    const header = objectHeader();
    expect(within(header).queryByRole('button', { name: /emitir proposta/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /emitir proposta/i })).not.toBeInTheDocument();
    // O rascunho tambem nao oferece edicao: `canUpdate` foi negado.
    expect(screen.queryByRole('menuitem', { name: /editar rascunho/i })).not.toBeInTheDocument();
    // E o rascunho nao passa a oferecer decisao do cliente no lugar.
    expect(screen.queryByRole('button', { name: /registrar aceite/i })).not.toBeInTheDocument();
  });

  it('omite por inteiro a relação de ordens de serviço quando o módulo dono não autoriza', async () => {
    vi.stubGlobal(
      'fetch',
      // Sem elos em `linkedChain`: o backend nao autorizou leitura de OS para este ator.
      createProposalFetchMock({
        status: PROPOSAL_VERSION_STATUSES.Draft,
        linkedChain: [
          // A solicitacao de origem existe na cadeia, mas nao vira relacao na barra: nao ha
          // destino filtrado real para ela.
          {
            kind: 'REQUEST',
            id: REQUEST_ID,
            label: 'SS-2026-0088',
            status: 'APROVADA',
            occurredAt: '2026-01-20T09:00:00.000Z',
            viaLabel: null,
          },
        ],
      }),
    );
    renderPage();
    await waitForObjectPage();

    const relations = screen.getByRole('region', { name: /relações/i });
    // A relacao nao existe: sem rotulo, sem contagem e sem a palavra "oculto".
    expect(within(relations).queryByText(/ordens de serviço/i)).not.toBeInTheDocument();
    expect(within(relations).queryByText(/solicitaç/i)).not.toBeInTheDocument();
    expect(within(relations).queryByText(/oculto/i)).not.toBeInTheDocument();
    expect(within(relations).queryByRole('link', { name: /ordens de serviço/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: new RegExp(`/app/service-orders\\?clientId=${CLIENT_ID}`) }),
    ).not.toBeInTheDocument();
    // A solicitacao continua legivel onde tem destino real: na cadeia comercial.
    expect(screen.getByRole('link', { name: 'SS-2026-0088' })).toBeInTheDocument();
    // Sem numero orfao.
    expect(within(relations).queryByText('0')).not.toBeInTheDocument();
  });

  it('mostra as relações reais com contagem e destino realmente filtrado quando autorizadas', async () => {
    vi.stubGlobal(
      'fetch',
      createProposalFetchMock({
        status: PROPOSAL_VERSION_STATUSES.Draft,
        linkedChain: [
          {
            kind: 'REQUEST',
            id: REQUEST_ID,
            label: 'SS-2026-0088',
            status: 'APROVADA',
            occurredAt: '2026-01-20T09:00:00.000Z',
            viaLabel: null,
          },
          {
            kind: 'SERVICE_ORDER',
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            label: 'OS-2026-0101',
            status: 'EM_EXECUCAO',
            occurredAt: '2026-01-25T09:00:00.000Z',
            viaLabel: null,
          },
        ],
      }),
    );
    renderPage();
    await waitForObjectPage();

    const relations = screen.getByRole('region', { name: /relações/i });

    // Ordens de servico: recorte de cliente, lido pela lista de OS.
    const orderLink = within(relations).getByRole('link', { name: /ordens de serviço/i });
    expect(orderLink).toHaveAttribute('href', `/app/service-orders?clientId=${CLIENT_ID}`);
    expect(within(orderLink).getAllByText('1')).toHaveLength(1);

    // Revisoes: contagem real das versoes persistidas; destino e o painel de revisoes da
    // propria pagina (o react-router resolve o fragmento contra o caminho corrente).
    const revisionsLink = within(relations).getByRole('link', { name: /revis/i });
    expect(revisionsLink).toHaveAttribute(
      'href',
      `/app/proposals/${PROPOSAL_ID}#proposal-revisions`,
    );
    expect(within(revisionsLink).getAllByText('1')).toHaveLength(1);

    // Sem numero orfao: solicitacao e pedido de compra nao entram na barra.
    expect(within(relations).queryByText(/solicitaç/i)).not.toBeInTheDocument();
    expect(within(relations).queryByText(/pedido de compra/i)).not.toBeInTheDocument();
  });

  it('nunca exibe custo interno sem concessão de custo/margem', async () => {
    vi.stubGlobal(
      'fetch',
      createProposalFetchMock({
        status: PROPOSAL_VERSION_STATUSES.Issued,
        capabilities: { update: true, issue: true, accept: true },
      }),
    );
    renderPage();
    await waitForObjectPage();

    // O payload traz custo real; a tela nao tem concessao de custo/margem, logo nao exibe.
    expect(screen.queryByText(INTERNAL_COST)).not.toBeInTheDocument();
    expect(screen.queryByText(/4321/)).not.toBeInTheDocument();
    expect(screen.queryByText(/custo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/margem/i)).not.toBeInTheDocument();
    // O que e legitimo continua visivel: valor comercial da revisao.
    expect(screen.getAllByText(/R\$\s*185\.000,00/).length).toBeGreaterThan(0);
  });

  it('mostra no histórico apenas fatos persistidos', async () => {
    vi.stubGlobal(
      'fetch',
      createProposalFetchMock({
        status: PROPOSAL_VERSION_STATUSES.Issued,
        revisionsCount: 2,
      }),
    );
    renderPage();
    await waitForObjectPage();

    const history = screen.getByRole('region', { name: /histórico/i });
    // Fato persistido em `com.proposals.created_at` e nascimento da revisao.
    expect(within(history).getByText(/proposta registrada/i)).toBeInTheDocument();
    // Fato derivado do timestamp persistido de emissao da revisao vigente.
    expect(within(history).getByText(/revisão 2 emitida/i)).toBeInTheDocument();
    // Nenhum evento que o dominio nao gravou.
    expect(within(history).queryByText(/rejeitad/i)).not.toBeInTheDocument();
    expect(within(history).queryByText(/cancelad/i)).not.toBeInTheDocument();
    expect(within(history).queryByText(/expirad/i)).not.toBeInTheDocument();
    expect(within(history).queryByText(/aceit/i)).not.toBeInTheDocument();
  });
});
