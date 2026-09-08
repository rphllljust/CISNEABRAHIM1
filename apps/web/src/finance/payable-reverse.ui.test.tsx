import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { renderWithProviders } from '../test/render-with-providers';
import { parseRequestPath } from '../test/request-url';
import { PayableDetailPage } from './pages/PayableDetailPage';

const MOCK_PAYABLE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const PAYMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-aaaaaaaaaaa1';
const SECOND_PAYMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-aaaaaaaaaaa2';

function payableDetail(extraReversals: number): Record<string, unknown> {
  const payments: unknown[] = [
    {
      id: PAYMENT_ID,
      installmentId: null,
      kind: 'PAYMENT',
      amount: '100.0000',
      currencyCode: 'BRL',
      paidAt: '2026-08-10T12:00:00.000Z',
      idempotencyKey: 'idem-pg-1',
      paymentReference: 'PG-001',
      originKind: 'MANUAL_AUTHORIZED_EXPENSE',
      originId: 'origin-1',
      originReference: 'EXP-1',
      reversesPaymentId: null,
      actorIdentityId: 'actor-1',
      createdAt: '2026-08-10T12:00:00.000Z',
    },
    {
      id: SECOND_PAYMENT_ID,
      installmentId: null,
      kind: 'PAYMENT',
      amount: '30.0000',
      currencyCode: 'BRL',
      paidAt: '2026-08-15T12:00:00.000Z',
      idempotencyKey: 'idem-pg-2',
      paymentReference: 'PG-002',
      originKind: 'MANUAL_AUTHORIZED_EXPENSE',
      originId: 'origin-1',
      originReference: 'EXP-1',
      reversesPaymentId: null,
      actorIdentityId: 'actor-1',
      createdAt: '2026-08-15T12:00:00.000Z',
    },
  ];
  for (let index = 0; index < extraReversals; index += 1) {
    payments.push({
      id: `cccccccc-cccc-4ccc-8ccc-aaaaaaaaaaa${index + 1}`,
      installmentId: null,
      kind: 'REVERSAL',
      amount: '100.0000',
      currencyCode: 'BRL',
      paidAt: '2026-08-20T12:00:00.000Z',
      idempotencyKey: `idem-rev-${index}`,
      paymentReference: 'REV-1',
      originKind: 'MANUAL_AUTHORIZED_EXPENSE',
      originId: 'origin-1',
      originReference: 'EXP-1',
      reversesPaymentId: PAYMENT_ID,
      actorIdentityId: 'actor-1',
      createdAt: '2026-08-20T12:00:00.000Z',
    });
  }
  return {
    id: MOCK_PAYABLE_ID,
    unitId: 'unit-1',
    counterpartyId: 'vendor-1',
    origin: { kind: 'MANUAL_AUTHORIZED_EXPENSE', id: 'origin-1', reference: 'AP-001' },
    expenseCategoryId: 'cat-1',
    costCenter: { id: 'cc-1', code: 'ADM' },
    principal: '800.0000',
    currencyCode: 'BRL',
    dueDate: '2026-09-05',
    paymentTerms: 'À vista',
    externalReference: 'AP-001',
    status: 'PARTIALLY_PAID',
    agingBucket: 'CURRENT',
    remainingBalance: '670.0000',
    paidAmount: '130.0000',
    lifecycle: 'ACTIVE',
    cancelledAt: null,
    cancelReason: null,
    rowVersion: 3,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-10T12:00:00.000Z',
    installments: [],
    payments,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

type ReverseFetchOptions = {
  conflict?: boolean;
  calls?: { count: number };
  bodies?: Array<Record<string, unknown>>;
};

/**
 * Stub de fetch para a PayableDetailPage. Atende de forma resolvida a TODOS os
 * GETs/POSTs que a árvore montada pode disparar:
 * - GET /api/v1/auth/session e /api/v1/authz/probe (AuthProvider bootstrap);
 * - GET /api/v1/finance/payables/:payableId (loader do título, com payments);
 * - POST /api/v1/finance/payables/:payableId/payments/:paymentId/reverse;
 * - qualquer outro caminho devolve 404 resolvido — nenhuma promise fica pendente.
 */
function createPayableReverseFetchMock(options: ReverseFetchOptions = {}) {
  const calls = options.calls ?? { count: 0 };
  const bodies = options.bodies ?? [];
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = parseRequestPath(input);
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

    const payableMatch = pathname.match(/^\/api\/v1\/finance\/payables\/([^/]+)$/);
    if (payableMatch && method === 'GET') {
      return jsonResponse(payableDetail(0));
    }

    const reverseMatch = pathname.match(
      /^\/api\/v1\/finance\/payables\/([^/]+)\/payments\/([^/]+)\/reverse$/,
    );
    if (reverseMatch && method === 'POST') {
      calls.count += 1;
      const raw = init?.body;
      const body: Record<string, unknown> =
        typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : ((raw ?? {}) as Record<string, unknown>);
      bodies.push(body);
      if (options.conflict) {
        return jsonResponse(
          { error: { code: 'FINANCE_PAYMENT_ALREADY_REVERSED', message: 'Payment already reversed.' } },
          409,
        );
      }
      return jsonResponse(payableDetail(1));
    }

    return jsonResponse({ error: { code: 'UNKNOWN', message: `Not found: ${pathname}` } }, 404);
  });
}

function renderPayableDetailPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/finance/payables/:payableId" element={<PayableDetailPage />} />
    </Routes>,
    { router: { initialEntries: [`/app/finance/payables/${MOCK_PAYABLE_ID}`] } },
  );
}

describe('Payable detail — estorno de pagamento', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it(
    'estorna um pagamento com motivo e versão, recarregando o título',
    async () => {
      const user = userEvent.setup();
      const calls = { count: 0 };
      const bodies: Array<Record<string, unknown>> = [];
      vi.stubGlobal('fetch', createPayableReverseFetchMock({ calls, bodies }));
      renderPayableDetailPage();

      // Carregamento do título (GET) e lista de pagamentos visível.
      await screen.findByRole('table', { name: /pagamentos do título/i }, { timeout: 15000 });
      const reverseSelect = await screen.findByLabelText(/pagamento a estornar/i, undefined, { timeout: 15000 });
      await user.selectOptions(reverseSelect, PAYMENT_ID);
      await user.type(screen.getByLabelText(/referência do estorno/i), 'REV-2026-001');
      await user.type(screen.getByLabelText(/motivo/i), 'Pagamento lançado em duplicidade');

      await user.click(screen.getByRole('button', { name: 'Estornar pagamento' }));
      const dialog = await screen.findByRole('dialog', undefined, { timeout: 15000 });
      const confirm = within(dialog).getByRole('button', { name: 'Estornar pagamento' });
      await user.click(confirm);

      // O POST é disparado exatamente uma vez e com o payload do backend.
      await waitFor(() => {
        expect(calls.count).toBe(1);
      }, { timeout: 15000 });
      expect(bodies[0]).toMatchObject({
        rowVersion: 3,
        paymentReference: 'REV-2026-001',
        reason: 'Pagamento lançado em duplicidade',
      });
      expect(typeof bodies[0]?.idempotencyKey).toBe('string');
      expect(bodies[0]?.idempotencyKey).not.toHaveLength(0);

      // Reload do título: o estorno (kind REVERSAL) aparece na lista de pagamentos.
      await waitFor(() => {
        expect(screen.getAllByText('Estorno').length).toBeGreaterThan(0);
      }, { timeout: 15000 });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
    15000,
  );

  it(
    'mostra o erro do servidor quando o pagamento já foi estornado e não repete o POST',
    async () => {
      const user = userEvent.setup();
      const calls = { count: 0 };
      vi.stubGlobal('fetch', createPayableReverseFetchMock({ conflict: true, calls }));
      renderPayableDetailPage();

      const reverseSelect = await screen.findByLabelText(/pagamento a estornar/i, undefined, { timeout: 15000 });
      await user.selectOptions(reverseSelect, PAYMENT_ID);
      await user.type(screen.getByLabelText(/referência do estorno/i), 'REV-2026-002');
      await user.type(screen.getByLabelText(/motivo/i), 'Duplicidade de pagamento');

      await user.click(screen.getByRole('button', { name: 'Estornar pagamento' }));
      const dialog = await screen.findByRole('dialog', undefined, { timeout: 15000 });
      const confirm = within(dialog).getByRole('button', { name: 'Estornar pagamento' });
      await Promise.all([user.click(confirm), user.click(confirm)]);

      await waitFor(() => {
        expect(screen.getByText(/já foi estornado/i)).toBeInTheDocument();
      }, { timeout: 15000 });
      // 409: o erro real aparece e o POST NÃO é repetido.
      expect(calls.count).toBe(1);
    },
    15000,
  );
});
