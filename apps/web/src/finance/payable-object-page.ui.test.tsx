import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetTokenStoreForTests, tokenStore } from '../auth/storage/token-store';
import { createFinanceFetchMock, MOCK_PAYABLE_ID } from '../test/finance-fetch-mock';
import { renderWithProviders } from '../test/render-with-providers';
import { PayableDetailPage, payableStateSteps } from './pages/PayableDetailPage';
import type { PayableDetail } from './types/finance.types';

/**
 * Conta a pagar deve adotar a MESMA gramatica do recebivel (golden reference do
 * financeiro): object page, fluxo de estado, proxima acao, contexto, historico.
 * Estes testes travam a paridade para a assimetria nao voltar.
 */

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function renderPayable() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/finance/payables/:payableId" element={<PayableDetailPage />} />
    </Routes>,
    { router: { initialEntries: [`/app/finance/payables/${MOCK_PAYABLE_ID}`] } },
  );
}

function payableFixture(overrides: Partial<PayableDetail> = {}): PayableDetail {
  return {
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
    ...overrides,
  };
}

describe('Payable detail — gramática de objeto empresarial', () => {
  beforeEach(() => {
    resetTokenStoreForTests();
    tokenStore.setTokens('access-token', 'refresh-token');
    vi.unstubAllGlobals();
  });

  it('mostra referência humana, estado e próxima ação derivada do estado real', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderPayable();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /conta a pagar/i })).toBeInTheDocument();
    });
    // Referência humana no cabeçalho — nunca o identificador tecnico.
    expect(screen.getAllByText('AP-001').length).toBeGreaterThan(0);
    // Estado visivel como contexto de processo (ObjectStateFlow usa aria-label).
    expect(screen.getByLabelText('Fluxo do título a pagar')).toBeInTheDocument();
    expect(screen.getAllByText(/em aberto/i).length).toBeGreaterThan(0);
    // Proxima acao derivada do estado (titulo em aberto aguarda pagamento).
    expect(screen.getByText(/registrar o pagamento/i)).toBeInTheDocument();
  });

  it('expõe contexto de origem e histórico de fatos persistidos', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock());
    renderPayable();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /conta a pagar/i })).toBeInTheDocument();
    });
    expect(screen.getByText('Origem')).toBeInTheDocument();
    expect(screen.getByText('Lançamento manual')).toBeInTheDocument();
    // Historico montado SOMENTE de timestamps persistidos.
    expect(screen.getByRole('heading', { name: /histórico do título/i })).toBeInTheDocument();
    expect(screen.getByText('Título criado')).toBeInTheDocument();
  });

  it('nao vaza identificador tecnico na tela', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock());
    const { container } = renderPayable();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /conta a pagar/i })).toBeInTheDocument();
    });
    const text = container.textContent ?? '';
    expect(text).not.toMatch(UUID_PATTERN);
    // Código de centro de custo é humano e pode aparecer; o id da categoria não.
    expect(text).not.toContain('cat-1');
  });

  it('marca título vencido como exceção operacional, mantendo-o em aberto', () => {
    const steps = payableStateSteps(payableFixture({ status: 'OVERDUE' }));
    expect(steps.currentId).toBe('OPEN');
    const open = steps.steps.find((step) => step.id === 'OPEN');
    expect(open?.hint).toMatch(/vencido em/i);
  });

  it('não mostra etapa de pagamento para título cancelado sem pagamento persistido', () => {
    const steps = payableStateSteps(
      payableFixture({ status: 'CANCELLED', lifecycle: 'CANCELLED', cancelledAt: '2026-09-02T10:00:00.000Z' }),
    );
    expect(steps.currentId).toBe('CANCELLED');
    expect(steps.steps.some((step) => step.id === 'PAID')).toBe(false);
    expect(steps.steps.some((step) => step.terminal)).toBe(true);
  });

  it('não afirma próxima ação quando o título está encerrado', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock({ payableSettled: true }));
    renderPayable();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /conta a pagar/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/registrar o pagamento/i)).not.toBeInTheDocument();
    const alert = screen.queryByRole('alert');
    expect(alert).toBeNull();
  });

  it('nega acesso sem vazar o título', async () => {
    vi.stubGlobal('fetch', createFinanceFetchMock({ payableListAllowed: false }));
    renderPayable();

    await waitFor(() => {
      expect(screen.getByText(/não tem permissão/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('AP-001')).not.toBeInTheDocument();
  });

  it('mostra o histórico do pagamento quando existe pagamento persistido', async () => {
    vi.stubGlobal(
      'fetch',
      createFinanceFetchMock({
        payablePaid: true,
      }),
    );
    renderPayable();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /conta a pagar/i })).toBeInTheDocument();
    });
    const body = document.body.textContent ?? '';
    expect(body).toMatch(/pagamento registrado/i);
  });
});
