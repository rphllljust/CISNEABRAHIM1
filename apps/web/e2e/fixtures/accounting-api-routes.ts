import type { Route } from '@playwright/test';

/**
 * Tráfego determinístico da CONTABILIDADE (Família 4).
 *
 * O perfil `accounting` existe para a prova de browser das 11 rotas contábeis: as fixtures
 * precisam devolver o MESMO contrato que o servidor publica — período, plano, contas, ledger,
 * journal postado, balancete, DRE, balanço, imobilizado e prontidão de fechamento — porque as
 * telas não têm mock de runtime e leem tudo da API.
 *
 * Devolve `false` quando a rota não pertence a esta fixture, para o handler genérico seguir.
 */

const UNIT = 'unit-accounting';
const CHART_ID = '10000000-0000-4000-8000-000000000001';
const PERIOD_ID = '20000000-0000-4000-8000-000000000002';
const PERIOD_CLOSED_ID = '20000000-0000-4000-8000-000000000003';
const CASH_ID = '10000000-0000-4000-8000-000000000010';
const REVENUE_ID = '10000000-0000-4000-8000-000000000011';
const JOURNAL_ID = '30000000-0000-4000-8000-000000000003';
const REVERSAL_ID = '30000000-0000-4000-8000-000000000004';
const FIXED_ASSET_ID = '40000000-0000-4000-8000-000000000005';
const OPERATIONAL_ASSET_ID = '50000000-0000-4000-8000-000000000006';

function jsonBody(body: unknown, status = 200): { status: number; contentType: string; body: string } {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill(jsonBody(body, status));
}

function hasBearerToken(route: Route): boolean {
  return route.request().headers().authorization?.startsWith('Bearer ') ?? false;
}

function period(id: string, code: string, status: 'OPEN' | 'CLOSED') {
  return {
    id,
    chartId: CHART_ID,
    unitId: UNIT,
    code,
    startsOn: `${code}-01`,
    endsOn: `${code}-28`,
    status,
    reopenCount: 0,
    rowVersion: 2,
    closedAt: null,
    reopenedAt: null,
    closeChecks: [
      {
        kind: 'DEBIT_CREDIT',
        result: 'PASS',
        blocking: true,
        observedCount: 0,
        detail: 'Débito igual a crédito no período.',
      },
    ],
  };
}

function journal() {
  return {
    id: JOURNAL_ID,
    chartId: CHART_ID,
    periodId: PERIOD_ID,
    unitId: UNIT,
    status: 'POSTED',
    kind: 'ENTRY',
    description: 'Venda de serviços de manutenção',
    occurredOn: '2026-09-05',
    currencyCode: 'BRL',
    sourceKind: 'BILLING',
    sourceId: '00000000-0000-4000-8000-0000000000f1',
    sourceReference: 'FAT-2026-0001',
    idempotencyKey: 'visual-journal-1',
    reversesEntryId: null,
    reversedByEntryId: null,
    reversedByEntryNumber: null,
    entryNumber: 1,
    postedAt: '2026-09-05T10:00:00.000Z',
    postedBy: 'visual.user',
    rowVersion: 2,
    debitTotal: '1500.0000',
    creditTotal: '1500.0000',
    balanced: true,
    lines: [
      {
        id: 'line-1',
        lineNumber: 1,
        accountId: CASH_ID,
        accountCode: '1.1.01',
        accountName: 'Caixa',
        accountClass: 'ASSET',
        direction: 'DEBIT',
        amount: '1500.0000',
        description: null,
      },
      {
        id: 'line-2',
        lineNumber: 2,
        accountId: REVENUE_ID,
        accountCode: '4.1.01',
        accountName: 'Receita de serviços',
        accountClass: 'REVENUE',
        direction: 'CREDIT',
        amount: '1500.0000',
        description: null,
      },
    ],
  };
}

function fixedAssetRegister() {
  return {
    id: FIXED_ASSET_ID,
    unitId: UNIT,
    operationalAssetId: OPERATIONAL_ASSET_ID,
    currencyCode: 'BRL',
    usefulLifeMonths: 60,
    costCenterCode: 'CC-OPS',
    status: 'ACTIVE',
    rowVersion: 2,
    bookValue: '9000.0000',
    acquiredOn: '2026-09-01',
    disposedOn: null,
    movements: [
      {
        id: 'movement-1',
        kind: 'ACQUISITION',
        status: 'POSTED',
        amount: '10000.0000',
        occurredOn: '2026-09-01',
        journalEntryId: JOURNAL_ID,
      },
      {
        id: 'movement-2',
        kind: 'DEPRECIATION',
        status: 'POSTED',
        amount: '1000.0000',
        occurredOn: '2026-10-01',
        journalEntryId: REVERSAL_ID,
      },
    ],
  };
}

export async function handleAccountingApiRoute(route: Route): Promise<boolean> {
  const request = route.request();
  const url = new URL(request.url());
  const { pathname } = url;
  const method = request.method();
  const segments = pathname.split('/').filter(Boolean); // api,v1,accounting,...

  /*
   * A fonte única de unidades operacionais vive em `/requests/*`, NÃO sob `/accounting`.
   * Por isso ela precisa ser resolvida ANTES do guard de prefixo — que existe justamente para
   * devolver `false` em qualquer rota que não pertença a esta fixture.
   */
  if (pathname === '/api/v1/requests/service-requests/operational-units' && method === 'GET') {
    await fulfillJson(route, { items: [UNIT] });
    return true;
  }

  const isClosing = pathname.startsWith('/api/v1/closing');
  if (segments[2] !== 'accounting' && !isClosing) {
    return false;
  }

  if (!hasBearerToken(route)) {
    await fulfillJson(route, { error: { code: 'ACCOUNTING_DENIED', message: 'Unauthorized.' } }, 401);
    return true;
  }

  /* ---------------------------------------------------------------- fechamento */
  if (pathname === '/api/v1/closing/readiness' && method === 'GET') {
    await fulfillJson(route, {
      unitId: UNIT,
      period: period(PERIOD_ID, '2026-09', 'OPEN'),
      closeReady: false,
      accounting: { evaluated: true, periodStatus: 'OPEN', journalCounts: { DRAFT: 2, POSTED: 1 } },
      fiscal: { evaluated: true, unauthorized: 0, rejected: 1, pendingAuthorization: 1, draft: 0 },
      blockers: [
        {
          kind: 'ACCOUNTING',
          severity: 'BLOCKING',
          observedCount: 2,
          detail: 'Existem lançamentos em rascunho no período.',
          area: 'accounting',
          drilldown: {
            path: '/app/accounting/journals',
            label: 'Ver lançamentos não postados',
          },
        },
      ],
      pending: [
        {
          kind: 'FISCAL',
          severity: 'INFORMATIONAL',
          observedCount: 1,
          detail: 'Documento fiscal aguardando autorização.',
          area: 'fiscal',
          drilldown: null,
        },
      ],
      nextActions: [
        {
          label: 'Resolver bloqueadores antes de fechar',
          kind: 'CLOSE_PERIOD',
          enabled: false,
          reason: 'Existem bloqueadores persistidos para este período.',
        },
      ],
      withheld: [],
    });
    return true;
  }

  if (pathname === '/api/v1/accounting/periods' && method === 'GET') {
    await fulfillJson(route, {
      unitId: url.searchParams.get('unitId') ?? UNIT,
      items: [period(PERIOD_ID, '2026-09', 'OPEN'), period(PERIOD_CLOSED_ID, '2026-08', 'CLOSED')],
    });
    return true;
  }

  /* ------------------------------------------------------------------- planos */
  if (pathname === '/api/v1/accounting/charts' && method === 'GET') {
    await fulfillJson(route, {
      unitId: url.searchParams.get('unitId') ?? UNIT,
      items: [
        { id: CHART_ID, unitId: UNIT, code: 'COA-2026', name: 'Plano padrão 2026', status: 'ACTIVE' },
      ],
    });
    return true;
  }

  if (pathname === `/api/v1/accounting/charts/${CHART_ID}/accounts` && method === 'GET') {
    await fulfillJson(route, {
      chartId: CHART_ID,
      items: [
        {
          id: CASH_ID,
          chartId: CHART_ID,
          parentId: null,
          code: '1.1.01',
          name: 'Caixa',
          class: 'ASSET',
          status: 'ACTIVE',
        },
        {
          id: REVENUE_ID,
          chartId: CHART_ID,
          parentId: null,
          code: '4.1.01',
          name: 'Receita de serviços',
          class: 'REVENUE',
          status: 'ACTIVE',
        },
      ],
    });
    return true;
  }

  if (pathname === `/api/v1/accounting/charts/${CHART_ID}/periods` && method === 'GET') {
    await fulfillJson(route, {
      chartId: CHART_ID,
      items: [period(PERIOD_ID, '2026-09', 'OPEN'), period(PERIOD_CLOSED_ID, '2026-08', 'CLOSED')],
    });
    return true;
  }

  if (pathname === '/api/v1/accounting/ledger' && method === 'GET') {
    await fulfillJson(route, {
      chartId: CHART_ID,
      totalDebits: '1500.0000',
      totalCredits: '1500.0000',
      balanced: true,
      accounts: [
        { accountId: CASH_ID, debits: '1500.0000', credits: '0.0000' },
        { accountId: REVENUE_ID, debits: '0.0000', credits: '1500.0000' },
      ],
    });
    return true;
  }

  /* --------------------------------------------------------------- lançamentos */
  if (pathname === `/api/v1/accounting/charts/${CHART_ID}/journals` && method === 'GET') {
    const status = url.searchParams.get('status');
    const items = status === 'DRAFT' ? [] : [journal()];
    await fulfillJson(route, {
      page: 0,
      pageSize: 50,
      total: items.length,
      totalPages: items.length > 0 ? 1 : 0,
      items,
    });
    return true;
  }

  if (pathname === `/api/v1/accounting/journals/${JOURNAL_ID}` && method === 'GET') {
    await fulfillJson(route, journal());
    return true;
  }

  if (
    segments[3] === 'journals' &&
    segments.length === 5 &&
    method === 'GET'
  ) {
    // Detalhe do lançamento: o mesmo registro da listagem, para a rota
    // `/app/accounting/journals/:journalId` ser exercitada com dado do servidor.
    await fulfillJson(route, { ...journal(), id: segments[4] });
    return true;
  }

  /* ------------------------------------------------------------ origem (rastreio) */
  if (pathname === '/api/v1/accounting/posting-requests' && method === 'GET') {
    await fulfillJson(route, {
      unitId: url.searchParams.get('unitId') ?? UNIT,
      page: 0,
      pageSize: 25,
      total: 1,
      totalPages: 1,
      statusCounts: { POSTED: 1, PENDING: 0, REJECTED: 0 },
      items: [
        {
          id: 'posting-1',
          unitId: UNIT,
          originKind: 'FINANCE',
          eventKind: 'RECEIVABLE_RECOGNIZED',
          sourceId: 'source-1',
          sourceReference: 'AR-2026-0001',
          amount: '1500.0000',
          currencyCode: 'BRL',
          occurredOn: '2026-09-05',
          status: 'POSTED',
          postingRuleId: 'rule-1',
          postingRuleVersionId: 'rule-version-1',
          actorIdentityId: 'actor-1',
          createdAt: '2026-09-05T10:00:00.000Z',
          journalEntryId: JOURNAL_ID,
          journalEntryNumber: 1,
          journalEntryStatus: 'POSTED',
          journalEntryPostedAt: '2026-09-05T10:05:00.000Z',
        },
      ],
    });
    return true;
  }

  /* ------------------------------------------------------------------ relatórios */
  if (pathname === `/api/v1/accounting/periods/${PERIOD_ID}/ledger` && method === 'GET') {
    const accountId = url.searchParams.get('accountId');
    await fulfillJson(route, {
      periodId: PERIOD_ID,
      account:
        accountId === REVENUE_ID
          ? {
              id: REVENUE_ID,
              code: '4.1.01',
              name: 'Receita de serviços',
              class: 'REVENUE',
              status: 'ACTIVE',
              normalBalance: 'CREDIT',
            }
          : {
              id: CASH_ID,
              code: '1.1.01',
              name: 'Caixa',
              class: 'ASSET',
              status: 'ACTIVE',
              normalBalance: 'DEBIT',
            },
      source: 'POSTED_JOURNAL_ENTRY',
      openingBalance: { side: 'DEBIT', amount: '0' },
      periodDebits: '1500',
      periodCredits: '0',
      closingBalance: { side: 'DEBIT', amount: '1500' },
      page: 0,
      pageSize: 30,
      total: 1,
      totalPages: 1,
      movements: [
        {
          journalEntryId: JOURNAL_ID,
          occurredOn: '2026-09-05',
          description: 'Venda de serviços de manutenção',
          sourceReference: 'FAT-2026-0001',
          kind: 'ENTRY',
          direction: 'DEBIT',
          amount: '1500',
          runningBalance: { side: 'DEBIT', amount: '1500' },
        },
      ],
    });
    return true;
  }

  if (pathname === `/api/v1/accounting/periods/${PERIOD_ID}/trial-balance` && method === 'GET') {
    await fulfillJson(route, {
      periodId: PERIOD_ID,
      source: 'POSTED_JOURNAL_ENTRY',
      accounts: [
        { accountId: CASH_ID, code: '1.1.01', name: 'Caixa', class: 'ASSET', debit: '1500', credit: '0' },
        {
          accountId: REVENUE_ID,
          code: '4.1.01',
          name: 'Receita de serviços',
          class: 'REVENUE',
          debit: '0',
          credit: '1500',
        },
      ],
      totalDebits: '1500',
      totalCredits: '1500',
      difference: '0',
      balanced: true,
    });
    return true;
  }

  if (pathname === `/api/v1/accounting/periods/${PERIOD_ID}/income-statement` && method === 'GET') {
    await fulfillJson(route, {
      periodId: PERIOD_ID,
      source: 'POSTED_JOURNAL_ENTRY',
      available: true,
      revenue: '1500',
      expense: '400',
      netIncome: '1100',
    });
    return true;
  }

  if (pathname === `/api/v1/accounting/periods/${PERIOD_ID}/balance-sheet` && method === 'GET') {
    await fulfillJson(route, {
      periodId: PERIOD_ID,
      source: 'POSTED_JOURNAL_ENTRY',
      available: true,
      assets: '1500',
      liabilities: '400',
      equity: '0',
      netIncome: '1100',
      balanced: true,
    });
    return true;
  }

  if (pathname === `/api/v1/accounting/periods/${PERIOD_ID}/close-runs` && method === 'GET') {
    await fulfillJson(route, {
      periodId: PERIOD_ID,
      runs: [
        {
          id: 'run-1',
          status: 'BLOCKED',
          createdAt: '2026-10-01T10:00:00.000Z',
          checks: [
            {
              kind: 'DEBIT_CREDIT',
              result: 'PASS',
              blocking: true,
              observedCount: 0,
              detail: 'Débito igual a crédito no período.',
            },
            {
              kind: 'DRAFT_JOURNALS',
              result: 'FAIL',
              blocking: true,
              observedCount: 2,
              detail: 'Existem lançamentos em rascunho no período.',
            },
          ],
        },
      ],
    });
    return true;
  }

  /* --------------------------------------------------------------- imobilizado */
  if (pathname === `/api/v1/accounting/fixed-assets/${FIXED_ASSET_ID}` && method === 'GET') {
    await fulfillJson(route, fixedAssetRegister());
    return true;
  }

  if (pathname === '/api/v1/accounting/fixed-assets' && method === 'GET') {
    await fulfillJson(route, fixedAssetRegister());
    return true;
  }

  // Sondas de capability e demais rotas contábeis: 404 (e não 403) é o que faz a sonda concluir
  // que a capability existe. Sem `as any`, sem mock de runtime: apenas o mesmo contrato.
  await fulfillJson(route, { error: { code: 'ACCOUNTING_NOT_FOUND', message: 'Not found.' } }, 404);
  return true;
}

export const ACCOUNTING_UNIT_ID = UNIT;
export const ACCOUNTING_CHART_ID = CHART_ID;
export const ACCOUNTING_PERIOD_ID = PERIOD_ID;
export const ACCOUNTING_ACCOUNT_ID = CASH_ID;
export const ACCOUNTING_JOURNAL_ID = JOURNAL_ID;
export const ACCOUNTING_FIXED_ASSET_ID = FIXED_ASSET_ID;
