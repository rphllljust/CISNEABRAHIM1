import { expect, type Page, type Route } from '@playwright/test';

/**
 * Tráfego determinístico do FISCAL (Família 5).
 *
 * A fixture é ISOLADA de propósito: registra as próprias rotas no Playwright e não depende de
 * `api-routes.ts` nem de `visual-helpers.ts`. O harness visual compartilhado é mantido pelas
 * demais famílias; o fiscal não precisa — e não deve — alterá-lo.
 *
 * O contrato devolvido é o MESMO que o servidor publica: períodos fiscais, regras tributárias
 * versionadas, apurações com linhas persistidas e documentos fiscais com itens/tributos. Nenhuma
 * alíquota, tributo ou total é inventado aqui — os valores são os que a API devolve.
 */

const UNIT = 'unit-fiscal';
const PERIOD_ID = '21000000-0000-4000-8000-000000000001';
const PERIOD_CLOSED_ID = '21000000-0000-4000-8000-000000000002';
const RULE_ID = '22000000-0000-4000-8000-000000000001';
const CALC_ID = '23000000-0000-4000-8000-000000000001';
const ASSESSMENT_ID = '24000000-0000-4000-8000-000000000001';
const FISCAL_DOCUMENT_KEY_ID = '25000000-0000-4000-8000-000000000001';

function jsonBody(body: unknown, status = 200): { status: number; contentType: string; body: string } {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill(jsonBody(body, status));
}

function hasBearerToken(route: Route): boolean {
  return route.request().headers().authorization?.startsWith('Bearer ') ?? false;
}

function fiscalPeriod(id: string, periodKey: string, status: 'OPEN' | 'CLOSED') {
  // Shape de `FiscalPeriod` — o contrato do DETALHE inclui `closeChecks` persistidas.
  return {
    id,
    unitId: UNIT,
    periodKey,
    status,
    rowVersion: 2,
    closedAt: status === 'CLOSED' ? '2026-10-01T10:00:00.000Z' : null,
    reopenedAt: null,
    reopenReason: null,
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

function taxRule() {
  return {
    id: RULE_ID,
    unitId: UNIT,
    code: 'ISS-05',
    name: 'ISS Serviços Gerais',
    status: 'ACTIVE',
    versionCount: 2,
    publishedVersion: {
      id: '22000000-0000-4000-8000-000000000011',
      versionNumber: 2,
      calculationMethod: 'PERCENTAGE',
      rate: '0.05',
      fixedAmount: null,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      sourceReference: 'Lei municipal 1234/2026',
    },
  };
}

function taxAssessment() {
  return {
    id: ASSESSMENT_ID,
    unitId: UNIT,
    periodKey: '2026-09',
    taxComponent: 'ISS',
    assessedAmount: '1500.0000',
    currencyCode: 'BRL',
    status: 'DRAFT',
    rowVersion: 1,
    taxCalculationId: CALC_ID,
    obligation: null,
  };
}

function taxCalculation() {
  return {
    id: CALC_ID,
    unitId: UNIT,
    ruleCode: 'ISS-05',
    ruleName: 'ISS Serviços Gerais',
    versionNumber: 2,
    baseAmount: '30000.0000',
    rate: '0.05',
    resultAmount: '1500.0000',
    calculatedAt: '2026-09-30T12:00:00.000Z',
    sourceKind: 'FISCAL_ASSESSMENT',
    lines: [
      {
        lineNumber: 1,
        componentLabel: 'Serviços gerais',
        baseAmount: '30000.0000',
        resultAmount: '1500.0000',
      },
    ],
  };
}

function fiscalDocumentListItem() {
  // Shape de `FiscalDocumentListItem` — o que a LISTAGEM publica (sem itens/tributos).
  return {
    id: FISCAL_DOCUMENT_KEY_ID,
    unitId: UNIT,
    status: 'AUTHORIZED',
    sourceKind: 'BILLING_DOCUMENT',
    sourceId: '26000000-0000-4000-8000-000000000001',
    billingDocumentId: '26000000-0000-4000-8000-000000000001',
    establishmentId: null,
    description: 'NF de serviço',
    currencyCode: 'BRL',
    issuedOn: '2026-09-05',
    rowVersion: 2,
    submittedAt: '2026-09-05T10:00:00.000Z',
    authorizedAt: '2026-09-05T10:05:00.000Z',
    rejectedAt: null,
    cancelledAt: null,
    cancelReason: null,
    lastProtocolCode: '35260812345678000199550010000000011000000010',
    lastAuthorizationOutcome: 'AUTHORIZED',
    createdAt: '2026-09-05T09:59:00.000Z',
  };
}

function fiscalDocument() {
  // Shape de `FiscalDocument` — o detalhe, com itens e tributos PERSISTIDOS.
  return {
    id: FISCAL_DOCUMENT_KEY_ID,
    unitId: UNIT,
    status: 'AUTHORIZED',
    sourceKind: 'BILLING_DOCUMENT',
    sourceId: '26000000-0000-4000-8000-000000000001',
    billingDocumentId: '26000000-0000-4000-8000-000000000001',
    establishmentId: null,
    description: 'NF de serviço',
    currencyCode: 'BRL',
    issuedOn: '2026-09-05',
    rowVersion: 2,
    submittedAt: '2026-09-05T10:00:00.000Z',
    authorizedAt: '2026-09-05T10:05:00.000Z',
    rejectedAt: null,
    cancelledAt: null,
    cancelReason: null,
    lastProtocolCode: '35260812345678000199550010000000011000000010',
    lastAuthorizationOutcome: 'AUTHORIZED',
    createdAt: '2026-09-05T09:59:00.000Z',
    items: [
      {
        id: 'item-1',
        lineNumber: 1,
        description: 'Manutenção preventiva',
        quantity: '1',
        unitAmount: '1500.0000',
        totalAmount: '1500.0000',
      },
    ],
    taxes: [{ id: 'tax-1', taxType: 'ISS', base: '1500.0000', rate: '0.05', amount: '75.0000' }],
    events: [],
    authorizationAttempts: [],
  };
}

export async function handleFiscalApiRoute(route: Route): Promise<boolean> {
  const request = route.request();
  const url = new URL(request.url());
  const { pathname } = url;
  const method = request.method();

  if (pathname === '/api/v1/requests/service-requests/operational-units' && method === 'GET') {
    await fulfillJson(route, { items: [UNIT] });
    return true;
  }

  if (!pathname.startsWith('/api/v1/fiscal')) {
    return false;
  }

  if (!hasBearerToken(route)) {
    await fulfillJson(route, { error: { code: 'FISCAL_DENIED', message: 'Unauthorized.' } }, 401);
    return true;
  }

  // ---- períodos fiscais -----------------------------------------------------
  if (pathname === '/api/v1/fiscal/periods' && method === 'GET') {
    await fulfillJson(route, {
      items: [fiscalPeriod(PERIOD_ID, '2026-09', 'OPEN'), fiscalPeriod(PERIOD_CLOSED_ID, '2026-08', 'CLOSED')],
      page: 0,
      pageSize: 20,
      total: 2,
      totalPages: 1,
    });
    return true;
  }
  if (pathname === `/api/v1/fiscal/periods/${PERIOD_ID}` && method === 'GET') {
    await fulfillJson(route, fiscalPeriod(PERIOD_ID, '2026-09', 'OPEN'));
    return true;
  }

  // ---- tributos -------------------------------------------------------------
  if (pathname === '/api/v1/fiscal/tax/rules' && method === 'GET') {
    await fulfillJson(route, {
      items: [taxRule()],
      page: 0,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    });
    return true;
  }
  if (pathname === `/api/v1/fiscal/tax/rules/${RULE_ID}` && method === 'GET') {
    await fulfillJson(route, taxRule());
    return true;
  }

  // ---- obrigações tributárias ----------------------------------------------
  if (pathname === '/api/v1/fiscal/tax/assessments' && method === 'GET') {
    await fulfillJson(route, {
      items: [taxAssessment()],
      page: 0,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    });
    return true;
  }
  if (pathname === `/api/v1/fiscal/tax/assessments/${ASSESSMENT_ID}` && method === 'GET') {
    await fulfillJson(route, taxAssessment());
    return true;
  }

  // ---- apuração -------------------------------------------------------------
  if (pathname === '/api/v1/fiscal/tax/calculations' && method === 'GET') {
    await fulfillJson(route, {
      items: [
        {
          id: CALC_ID,
          unitId: UNIT,
          ruleCode: 'ISS-05',
          ruleName: 'ISS Serviços Gerais',
          versionNumber: 2,
          baseAmount: '30000.0000',
          resultAmount: '1500.0000',
          sourceKind: 'FISCAL_ASSESSMENT',
        },
      ],
      limit: 20,
      offset: 0,
      total: 1,
      totalPages: 1,
    });
    return true;
  }
  if (pathname === `/api/v1/fiscal/tax/calculations/${CALC_ID}` && method === 'GET') {
    await fulfillJson(route, taxCalculation());
    return true;
  }

  // ---- documentos fiscais ---------------------------------------------------
  if (pathname === '/api/v1/fiscal/documents' && method === 'GET') {
    await fulfillJson(route, {
      page: 0,
      pageSize: 20,
      total: 1,
      items: [fiscalDocumentListItem()],
    });
    return true;
  }
  if (pathname === `/api/v1/fiscal/documents/${FISCAL_DOCUMENT_KEY_ID}` && method === 'GET') {
    await fulfillJson(route, fiscalDocument());
    return true;
  }

  // Sondas de capability: 404 (e não 403) é o que faz a sonda concluir que a capability existe.
  await fulfillJson(route, { error: { code: 'FISCAL_NOT_FOUND', message: 'Not found.' } }, 404);
  return true;
}

export const FISCAL_UNIT_ID = UNIT;
export const FISCAL_PERIOD_ID = PERIOD_ID;
export const FISCAL_RULE_ID = RULE_ID;
export const FISCAL_CALC_ID = CALC_ID;
export const FISCAL_ASSESSMENT_ID = ASSESSMENT_ID;
export const FISCAL_DOCUMENT_ID = FISCAL_DOCUMENT_KEY_ID;

const TEST_LOGIN = 'visual.user';
const TEST_PASSWORD = 'Password1!';
const MOCK_IDENTITY_ID = '11111111-1111-4111-8111-111111111111';
const MOCK_SESSION_ID = '22222222-2222-4222-8222-222222222222';

/**
 * SESSÃO + FISCAL, sem tocar no harness visual compartilhado.
 *
 * Registra as MESMAS rotas de shell que a sessão exige (login, sessão, refresh, alertas, busca,
 * unidades operacionais) e delega o restante ao handler fiscal.
 */
export async function installFiscalMocks(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();

    if (pathname === '/api/v1/auth/login' && method === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}') as { password?: string };
      if (body.password === TEST_PASSWORD) {
        await fulfillJson(route, {
          accessToken: 'visual-access-token',
          refreshToken: 'visual-refresh-token',
          tokenType: 'Bearer',
          expiresIn: 900,
          session: { id: MOCK_SESSION_ID, expiresAt: '2026-08-29T12:00:00.000Z', status: 'active' },
        });
        return;
      }
      await fulfillJson(
        route,
        { error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials.' } },
        401,
      );
      return;
    }

    if (pathname === '/api/v1/auth/session' && method === 'GET') {
      if (hasBearerToken(route)) {
        await fulfillJson(route, {
          identityId: MOCK_IDENTITY_ID,
          session: { id: MOCK_SESSION_ID, expiresAt: '2026-08-29T12:00:00.000Z', status: 'active' },
        });
        return;
      }
      await fulfillJson(route, { error: { code: 'AUTH_UNAUTHORIZED', message: 'Unauthorized.' } }, 401);
      return;
    }

    if (pathname === '/api/v1/auth/refresh' && method === 'POST') {
      await fulfillJson(route, {
        accessToken: 'visual-access-token-2',
        refreshToken: 'visual-refresh-token-2',
        tokenType: 'Bearer',
        expiresIn: 900,
        session: { id: MOCK_SESSION_ID, expiresAt: '2026-08-29T12:00:00.000Z', status: 'active' },
      });
      return;
    }

    if (pathname === '/api/v1/authz/probe' && method === 'GET') {
      await fulfillJson(route, {
        status: 'ok',
        identityId: MOCK_IDENTITY_ID,
        sessionId: MOCK_SESSION_ID,
      });
      return;
    }

    if (pathname === '/api/v1/alerts/summary' && method === 'GET') {
      await fulfillJson(route, { activeCount: 0 });
      return;
    }

    if (pathname === '/api/v1/alerts' && method === 'GET') {
      await fulfillJson(route, []);
      return;
    }

    if (pathname.startsWith('/api/v1/search') && method === 'GET') {
      await fulfillJson(route, {
        query: { raw: 'test', kind: 'text' },
        groups: [],
        pagination: { limit: 20, offset: 0, hasMore: false },
        allowedTypes: ['CLIENT'],
      });
      return;
    }

    if (await handleFiscalApiRoute(route)) {
      return;
    }

    await fulfillJson(route, { error: { code: 'UNKNOWN', message: 'Not found' } }, 404);
  });
}

/** Sessão autenticada para a prova visual do fiscal. */
export async function prepareFiscalSession(page: Page): Promise<void> {
  await installFiscalMocks(page);
  await page.goto('/login');
  await page.getByLabel(/^usuário/i).fill(TEST_LOGIN);
  await page.getByLabel(/^senha/i).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: /^entrar/i }).click();
  await expect(page.getByRole('heading', { level: 1, name: /visão geral/i })).toBeVisible();
}

export async function stabilizeFiscalPage(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.evaluate(() => document.fonts.ready);
}
