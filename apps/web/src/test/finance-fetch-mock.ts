import { vi } from 'vitest';
import { parseRequestPath } from './request-url';

export const MOCK_RECEIVABLE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
export const MOCK_PAYABLE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
export const MOCK_ACCOUNT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
export const MOCK_STATEMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
export const MOCK_JOURNAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
export const MOCK_PERIOD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
export const MOCK_CHART_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7';
export const MOCK_FISCAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8';
export const MOCK_CALC_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9';
export const MOCK_FISCAL_PERIOD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10';
export const MOCK_ASSESSMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11';
export const MOCK_OBLIGATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12';

export type FinanceFetchMockOptions = {
  receivableListAllowed?: boolean;
  payableListAllowed?: boolean;
  treasuryListAllowed?: boolean;
  reconciliationAllowed?: boolean;
  fiscalAllowed?: boolean;
  taxAllowed?: boolean;
  accountingAllowed?: boolean;
  networkError?: boolean;
  settleConflict?: boolean;
  closedPeriod?: boolean;
  classificationIncomplete?: boolean;
  receivableCount?: number;
  fiscalDocumentCount?: number;
  settleCalls?: { count: number };
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function denied(code: string) {
  return jsonResponse({ error: { code, message: 'Forbidden.' } }, 403);
}

export function createFinanceFetchMock(options: FinanceFetchMockOptions = {}) {
  const settleCalls = options.settleCalls ?? { count: 0 };
  const receivableCount = options.receivableCount ?? 2;

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (options.networkError) {
      throw new TypeError('Failed to fetch');
    }

    const { pathname, searchParams } = parseRequestPath(input);
    const method = init?.method ?? 'GET';

    if (pathname === '/api/v1/auth/session' && method === 'GET') {
      return jsonResponse({
        identityId: '11111111-1111-4111-8111-111111111111',
        session: {
          id: '22222222-2222-4222-8222-222222222222',
          expiresAt: new Date().toISOString(),
          status: 'active',
        },
      });
    }

    if (pathname === '/api/v1/authz/probe' && method === 'GET') {
      return jsonResponse({ status: 'ok' });
    }

    if (pathname === '/api/v1/finance/receivables' && method === 'GET') {
      if (options.receivableListAllowed === false) {
        return denied('FINANCE_DENIED');
      }
      // O servidor pagina: a resposta e o envelope canonico e honra limit/offset, como a API
      // real. Um mock que devolvesse tudo mascararia justamente o comportamento sob teste.
      const all = Array.from({ length: receivableCount }, (_, index) => ({
        id: index === 0 ? MOCK_RECEIVABLE_ID : `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, '0')}`,
        unitId: 'unit-1',
        clientId: 'client-1',
        origin: {
          kind: 'BILLING_DOCUMENT',
          billingDocumentId: 'doc-1',
          billingRecordId: 'rec-1',
          serviceOrderId: 'so-1',
          measurementId: 'm-1',
        },
        principal: '1500.0000',
        currencyCode: 'BRL',
        dueDate: '2026-09-10',
        paymentTerms: '30 DDL',
        externalReference: `AR-${String(index + 1).padStart(3, '0')}`,
        status: 'OPEN',
        remainingBalance: '1500.0000',
        settledAmount: '0.0000',
        lifecycle: 'ACTIVE',
        cancelledAt: null,
        cancelReason: null,
        rowVersion: 3,
        createdAt: '2026-08-01T12:00:00.000Z',
        updatedAt: '2026-08-01T12:00:00.000Z',
        installments: [
          { id: `inst-${index}`, installmentNumber: 1, principal: '1500.0000', dueDate: '2026-09-10' },
        ],
        settlements: [],
      }));
      const limit = Number(searchParams.get('limit') ?? '20');
      const offset = Number(searchParams.get('offset') ?? '0');
      // O servidor REAL filtra por `status` em SQL (ver
      // `apps/api/src/finance/repositories/receivables.repository.ts`, `statusPredicates`):
      // o recorte é do servidor, não uma máscara sobre a página recebida. Um mock que
      // devolvesse tudo faria a UI exibir linhas que o servidor nunca entregaria.
      const status = searchParams.get('status');
      const filtered = status ? all.filter((row) => row.status === status) : all;
      return jsonResponse({
        items: filtered.slice(offset, offset + limit),
        limit,
        offset,
        total: filtered.length,
        totalPages: limit > 0 ? Math.ceil(filtered.length / limit) : 0,
      });
    }

    if (pathname === `/api/v1/finance/receivables/${MOCK_RECEIVABLE_ID}` && method === 'GET') {
      if (options.receivableListAllowed === false) {
        return denied('FINANCE_DENIED');
      }
      return jsonResponse({
        id: MOCK_RECEIVABLE_ID,
        unitId: 'unit-1',
        clientId: 'client-1',
        origin: {
          kind: 'BILLING_DOCUMENT',
          billingDocumentId: 'doc-1',
          billingRecordId: 'rec-1',
          serviceOrderId: 'so-1',
          measurementId: 'm-1',
        },
        principal: '1500.0000',
        currencyCode: 'BRL',
        dueDate: '2026-09-10',
        paymentTerms: '30 DDL',
        externalReference: 'AR-001',
        status: 'OPEN',
        remainingBalance: '1500.0000',
        settledAmount: '0.0000',
        lifecycle: 'ACTIVE',
        cancelledAt: null,
        cancelReason: null,
        rowVersion: 3,
        createdAt: '2026-08-01T12:00:00.000Z',
        updatedAt: '2026-08-01T12:00:00.000Z',
        installments: [{ id: 'inst-1', installmentNumber: 1, principal: '1500.0000', dueDate: '2026-09-10' }],
        settlements: [],
      });
    }

    if (pathname.endsWith('/settlements') && method === 'POST') {
      settleCalls.count += 1;
      if (options.settleConflict) {
        return jsonResponse(
          { error: { code: 'FINANCE_VERSION_CONFLICT', message: 'Version conflict.' } },
          409,
        );
      }
      return jsonResponse({
        id: MOCK_RECEIVABLE_ID,
        unitId: 'unit-1',
        clientId: 'client-1',
        origin: {
          kind: 'BILLING_DOCUMENT',
          billingDocumentId: 'doc-1',
          billingRecordId: 'rec-1',
          serviceOrderId: 'so-1',
          measurementId: 'm-1',
        },
        principal: '1500.0000',
        currencyCode: 'BRL',
        dueDate: '2026-09-10',
        paymentTerms: '30 DDL',
        externalReference: 'AR-001',
        status: 'PAID',
        remainingBalance: '0.0000',
        settledAmount: '1500.0000',
        lifecycle: 'ACTIVE',
        cancelledAt: null,
        cancelReason: null,
        rowVersion: 4,
        createdAt: '2026-08-01T12:00:00.000Z',
        updatedAt: '2026-08-01T12:00:00.000Z',
        installments: [],
        settlements: [],
      });
    }

    if (pathname === '/api/v1/finance/payables' && method === 'GET') {
      if (options.payableListAllowed === false) {
        return denied('FINANCE_DENIED');
      }
      const allPayables = [
        {
          id: MOCK_PAYABLE_ID,
          unitId: 'unit-1',
          counterpartyId: 'vendor-1',
          origin: { kind: 'MANUAL', id: 'origin-1', reference: 'AP-001' },
          expenseCategoryId: 'cat-1',
          costCenter: { id: 'cc-1', code: 'ADM' },
          principal: '800.0000',
          currencyCode: 'BRL',
          dueDate: '2026-09-05',
          paymentTerms: 'À vista',
          externalReference: 'AP-001',
          status: 'OPEN',
          agingBucket: 'CURRENT',
          remainingBalance: '800.0000',
          paidAmount: '0.0000',
          lifecycle: 'ACTIVE',
          cancelledAt: null,
          cancelReason: null,
          rowVersion: 1,
          createdAt: '2026-08-01T12:00:00.000Z',
          updatedAt: '2026-08-01T12:00:00.000Z',
          installments: [],
          payments: [],
        },
      ];
      // Mesmo contrato do servidor real: `status` e `agingBucket` recortam no servidor.
      // Sem isso a visão "Aging 90+" pareceria conter títulos que o banco não devolveria.
      const payableStatus = searchParams.get('status');
      const agingBucket = searchParams.get('agingBucket');
      const items = allPayables.filter(
        (row) =>
          (!payableStatus || row.status === payableStatus) &&
          (!agingBucket || row.agingBucket === agingBucket),
      );
      return jsonResponse({
        items,
        limit: 20,
        offset: 0,
        total: items.length,
        totalPages: 1,
      });
    }

    if (pathname === '/api/v1/finance/payables/aging' && method === 'GET') {
      if (options.payableListAllowed === false) {
        return denied('FINANCE_DENIED');
      }
      return jsonResponse({
        asOf: '2026-09-01T12:00:00.000Z',
        buckets: {
          CURRENT: { count: 1, remaining: '800.0000' },
          SETTLED: { count: 0, remaining: '0.0000' },
        },
      });
    }

    if (pathname === '/api/v1/finance/treasury/accounts' && method === 'GET') {
      if (options.treasuryListAllowed === false) {
        return denied('FINANCE_DENIED');
      }
      return jsonResponse([
        {
          id: MOCK_ACCOUNT_ID,
          unitId: 'unit-1',
          kind: 'BANK',
          code: 'BB-001',
          name: 'Conta principal',
          currencyCode: 'BRL',
          overdraftAllowed: false,
          lifecycle: 'ACTIVE',
          rowVersion: 1,
          balance: '2500.0000',
          bank: { bankCode: '001', agency: '1234', accountNumber: '0001-2' },
          cash: null,
          createdAt: '2026-08-01T12:00:00.000Z',
          updatedAt: '2026-08-01T12:00:00.000Z',
        },
      ]);
    }

    if (pathname === '/api/v1/finance/bank-statements' && method === 'GET') {
      if (options.reconciliationAllowed === false) {
        return denied('FINANCE_DENIED');
      }
      return jsonResponse({
        items: [
          {
            id: MOCK_STATEMENT_ID,
            unitId: 'unit-1',
            financialAccountId: MOCK_ACCOUNT_ID,
            financialAccount: { code: 'BAN-1', name: 'Conta principal', label: 'BAN-1 — Conta principal' },
            sourceKind: 'CISNE_STATEMENT_V1',
            sourceReference: 'STMT-1',
            periodStartsOn: '2026-08-01',
            periodEndsOn: '2026-08-31',
            currencyCode: 'BRL',
            status: 'OPEN',
            lineCount: 60,
            matchedLineCount: 0,
            unreconciledLineCount: 60,
            debitTotal: '0',
            creditTotal: '600',
          },
        ],
        limit: 20,
        offset: 0,
        total: 1,
        totalPages: 1,
      });
    }

    if (pathname.startsWith('/api/v1/finance/bank-reconciliation/statements/') && method === 'GET') {
      if (options.reconciliationAllowed === false) {
        return denied('FINANCE_DENIED');
      }
      if (pathname.includes('00000000-0000-4000-8000')) {
        return jsonResponse({ error: { code: 'FINANCE_NOT_FOUND', message: 'Not found.' } }, 404);
      }
      return jsonResponse({
          id: MOCK_STATEMENT_ID,
          unitId: 'unit-1',
          financialAccountId: MOCK_ACCOUNT_ID,
          sourceKind: 'CISNE_STATEMENT_V1',
          sourceReference: 'STMT-1',
          periodStartsOn: '2026-08-01',
          periodEndsOn: '2026-08-31',
          status: 'IMPORTED',
          idempotent: false,
          lines: Array.from({ length: 60 }, (_, index) => ({
            id: `line-${index}`,
            lineNumber: index + 1,
            occurredOn: '2026-08-15',
            direction: 'CREDIT',
            amount: '10.0000',
            description: `Linha ${index + 1}`,
            sourceLineKey: `k-${index}`,
            matchStatus: 'UNMATCHED',
            duplicate: false,
          })),
        });
    }

    if (pathname === '/api/v1/requests/service-requests/operational-units' && method === 'GET') {
      return jsonResponse({ items: ['unit-1'] });
    }

    if (pathname === '/api/v1/fiscal/documents' && method === 'GET') {
      if (options.fiscalAllowed === false) {
        return denied('FISCAL_DENIED');
      }
      if (options.fiscalDocumentCount === 0) {
        return jsonResponse({ items: [], total: 0, page: 0, pageSize: 20 });
      }
      return jsonResponse({
        items: [
          {
            id: MOCK_FISCAL_ID,
            unitId: 'unit-1',
            status: 'READY',
            sourceKind: 'BILLING_DOCUMENT',
            billingDocumentId: 'doc-1',
            description: 'NF de serviço',
            currencyCode: 'BRL',
            issuedOn: '2026-08-20',
            rowVersion: 1,
            updatedAt: '2026-08-20T12:00:00.000Z',
            lastProtocolCode: '35260812345678000199550010000000011000000010',
            lastAuthorizationOutcome: 'AUTHORIZED',
          },
        ],
        total: 1,
        page: 0,
        pageSize: 20,
      });
    }

    if (pathname === '/api/v1/fiscal/periods' && method === 'GET') {
      if (options.fiscalAllowed === false) {
        return denied('FISCAL_DENIED');
      }
      return jsonResponse({
        items: [
          {
            id: MOCK_FISCAL_PERIOD_ID,
            unitId: 'unit-1',
            periodKey: '2026-08',
            status: 'OPEN',
            openedAt: '2026-08-01T00:00:00.000Z',
            closedAt: null,
            reopenedAt: null,
            reopenCount: 0,
            rowVersion: 1,
          },
        ],
        total: 1,
        page: 0,
        pageSize: 20,
      });
    }

    if (pathname === '/api/v1/fiscal/tax/assessments' && method === 'GET') {
      if (options.taxAllowed === false) {
        return denied('FISCAL_DENIED');
      }
      return jsonResponse({
        items: [
          {
            id: MOCK_ASSESSMENT_ID,
            unitId: 'unit-1',
            taxCalculationId: 'calc-1',
            taxRuleId: 'rule-1',
            taxRuleVersionId: 'ver-1',
            taxComponent: 'ISS',
            periodKey: '2026-08',
            currencyCode: 'BRL',
            assessedAmount: '5.0000',
            status: 'FINALIZED',
            supersedesAssessmentId: null,
            rowVersion: 1,
            finalizedAt: '2026-09-01T12:00:00.000Z',
            cancelledAt: null,
            cancelReason: null,
            createdAt: '2026-08-31T12:00:00.000Z',
            obligation: {
              id: MOCK_OBLIGATION_ID,
              status: 'OPEN',
              amount: '5.0000',
              payableId: MOCK_PAYABLE_ID,
            },
          },
        ],
        total: 1,
        page: 0,
        pageSize: 20,
      });
    }

    if (pathname === '/api/v1/fiscal/tax/rules' && method === 'GET') {
      if (options.taxAllowed === false) {
        return denied('FISCAL_DENIED');
      }
      return jsonResponse({
        items: [
          {
            id: 'rule-1',
            unitId: 'unit-1',
            code: 'ISS-SVC',
            name: 'ISS sobre serviços',
            status: 'ACTIVE',
            versionCount: 2,
            publishedVersion: {
              id: 'ver-1',
              versionNumber: 2,
              status: 'PUBLISHED',
              calculationMethod: 'PERCENT_OF_BASE',
              rate: '0.0500',
              fixedAmount: null,
              sourceReference: 'LC 116/2003',
              effectiveFrom: '2026-01-01',
              effectiveTo: null,
              publishedAt: '2026-01-01T12:00:00.000Z',
            },
          },
        ],
        total: 1,
        page: 0,
        pageSize: 20,
      });
    }

    if (pathname.startsWith('/api/v1/fiscal/documents/') && method === 'GET') {
      if (options.fiscalAllowed === false) {
        return denied('FISCAL_DENIED');
      }
      if (pathname.includes('00000000-0000-4000-8000')) {
        return jsonResponse({ error: { code: 'FISCAL_NOT_FOUND', message: 'Not found.' } }, 404);
      }
      return jsonResponse({
        id: MOCK_FISCAL_ID,
        unitId: 'unit-1',
        status: 'DRAFT',
        sourceKind: 'BILLING_DOCUMENT',
        sourceId: 'doc-1',
        billingDocumentId: 'doc-1',
        description: 'NF de serviço',
        currencyCode: 'BRL',
        issuedOn: '2026-08-20',
        certificateRef: null,
        idempotencyKey: 'idem-1',
        rowVersion: 1,
        parties: [{ role: 'ISSUER', legalName: 'CISNE', taxIdentifier: '00000000000000', partySnapshot: {} }],
        items: [{ lineNumber: 1, description: 'Serviço', quantity: '1.0000', unitAmount: '100.0000', lineAmount: '100.0000', itemSnapshot: {} }],
        taxDetails: [{ lineNumber: 1, componentLabel: 'ISS', amount: '5.0000', detailSnapshot: {} }],
        events: [],
        authorizations: [],
        validityLegend: 'SEM VALIDADE FISCAL',
        officialDanfe: 'BLOCKED',
      });
    }

    if (pathname.startsWith('/api/v1/fiscal/tax/calculations/') && method === 'GET') {
      if (options.taxAllowed === false) {
        return denied('FISCAL_DENIED');
      }
      if (pathname.includes('00000000-0000-4000-8000')) {
        return jsonResponse({ error: { code: 'FISCAL_NOT_FOUND', message: 'Not found.' } }, 404);
      }
      return jsonResponse({
        id: MOCK_CALC_ID,
        unitId: 'unit-1',
        taxRuleId: 'rule-1',
        ruleCode: 'ISS-SVC',
        ruleVersionId: 'ver-1',
        versionNumber: 2,
        inputs: {},
        baseAmount: '100.0000',
        rate: '0.0500',
        resultAmount: '5.0000',
        calculatedAt: '2026-08-20T12:00:00.000Z',
        idempotencyKey: 'idem-tax',
        lines: [{ lineNumber: 1, componentLabel: 'ISS', baseAmount: '100.0000', rate: '0.0500', resultAmount: '5.0000' }],
      });
    }

    if (pathname.startsWith('/api/v1/accounting/charts/') && method === 'GET') {
      if (options.accountingAllowed === false) {
        return denied('ACCOUNTING_DENIED');
      }
      if (pathname.includes('00000000-0000-4000-8000')) {
        return jsonResponse({ error: { code: 'ACCOUNTING_NOT_FOUND', message: 'Not found.' } }, 404);
      }
      return jsonResponse({
        id: MOCK_CHART_ID,
        unitId: 'unit-1',
        code: 'PLC-01',
        name: 'Plano padrão',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    }

    if (pathname === '/api/v1/accounting/ledger' && method === 'GET') {
      if (options.accountingAllowed === false) {
        return denied('ACCOUNTING_DENIED');
      }
      return jsonResponse({
        chartId: MOCK_CHART_ID,
        totalDebits: '100.0000',
        totalCredits: '100.0000',
        balanced: true,
        accounts: [{ accountId: 'acc-1', debits: '100.0000', credits: '0.0000' }],
      });
    }

    if (pathname.startsWith('/api/v1/accounting/journals/') && method === 'GET') {
      if (options.accountingAllowed === false) {
        return denied('ACCOUNTING_DENIED');
      }
      return jsonResponse({
        id: MOCK_JOURNAL_ID,
        chartId: MOCK_CHART_ID,
        periodId: MOCK_PERIOD_ID,
        unitId: 'unit-1',
        status: 'DRAFT',
        kind: 'STANDARD',
        description: 'Lançamento de teste',
        occurredOn: '2026-08-15',
        currencyCode: 'BRL',
        sourceKind: 'MANUAL',
        sourceId: 'src-1',
        sourceReference: 'MAN-1',
        idempotencyKey: 'idem-j',
        reversesEntryId: null,
        postedAt: null,
        rowVersion: 1,
        debitTotal: '50.0000',
        creditTotal: '50.0000',
        balanced: true,
        lines: [
          { id: 'l1', lineNumber: 1, accountId: 'acc-1', direction: 'DEBIT', amount: '50.0000', description: 'D' },
          { id: 'l2', lineNumber: 2, accountId: 'acc-2', direction: 'CREDIT', amount: '50.0000', description: 'C' },
        ],
      });
    }

    if (pathname.endsWith('/income-statement') && method === 'GET') {
      if (options.accountingAllowed === false) {
        return denied('ACCOUNTING_DENIED');
      }
      if (options.classificationIncomplete) {
        return jsonResponse(
          {
            error: {
              code: 'REPORT_CLASSIFICATION_INCOMPLETE',
              message: 'Classification incomplete.',
            },
          },
          409,
        );
      }
      return jsonResponse({
        periodId: MOCK_PERIOD_ID,
        source: 'POSTED_JOURNAL_ENTRY',
        available: true,
        revenue: '100.0000',
        expense: '30.0000',
        netIncome: '70.0000',
      });
    }

    if (pathname.endsWith('/balance-sheet') && method === 'GET') {
      if (options.accountingAllowed === false) {
        return denied('ACCOUNTING_DENIED');
      }
      if (options.classificationIncomplete) {
        return jsonResponse(
          {
            error: {
              code: 'REPORT_CLASSIFICATION_INCOMPLETE',
              message: 'Classification incomplete.',
            },
          },
          409,
        );
      }
      return jsonResponse({
        periodId: MOCK_PERIOD_ID,
        source: 'POSTED_JOURNAL_ENTRY',
        available: true,
        assets: '70.0000',
        liabilities: '0.0000',
        equity: '0.0000',
        netIncome: '70.0000',
        balanced: true,
      });
    }

    if (pathname.endsWith('/post') && method === 'POST') {
      if (options.closedPeriod) {
        return jsonResponse(
          { error: { code: 'ACCOUNTING_PERIOD_CLOSED', message: 'Period closed.' } },
          409,
        );
      }
      return jsonResponse({ id: MOCK_JOURNAL_ID, status: 'POSTED', rowVersion: 2 });
    }

    if (pathname.endsWith('/close') && method === 'POST') {
      return jsonResponse({
        id: MOCK_PERIOD_ID,
        chartId: MOCK_CHART_ID,
        unitId: 'unit-1',
        code: '2026-08',
        startsOn: '2026-08-01',
        endsOn: '2026-08-31',
        status: 'CLOSED',
        reopenCount: 0,
        rowVersion: 2,
        closedAt: '2026-09-01T12:00:00.000Z',
        reopenedAt: null,
        closeChecks: [{ kind: 'TRIAL_BALANCE', result: 'PASSED', blocking: true, observedCount: 0, detail: 'ok' }],
      });
    }

    return jsonResponse({ error: { code: 'UNKNOWN', message: 'Not found' } }, 404);
  });
}
