import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPayable } from '../../finance/api/finance-api';
import { BackofficeApiError } from '../../financial-ui/enterprise-api';
import { SupplierReceiptFinancePanel } from './SupplierReceiptFinancePanel';

vi.mock('../../finance/api/finance-api', () => ({ getPayable: vi.fn() }));

const receipt = {
  id: '33333333-3333-4333-8333-333333333333',
  payableId: '22222222-2222-4222-8222-222222222222',
  idempotencyKey: 'rcv-test',
  status: 'POSTED',
};

function subject() {
  return render(<MemoryRouter><SupplierReceiptFinancePanel receipts={[receipt]} /></MemoryRouter>);
}

describe('Procure-to-Pay: financial consequence of supplier receipt', () => {
  beforeEach(() => vi.resetAllMocks());

  it('opens only Finance-authorized title with provenance tied to the posted receipt', async () => {
    vi.mocked(getPayable).mockResolvedValue({
      id: receipt.payableId,
      origin: { kind: 'PURCHASE', id: receipt.id, reference: 'SPO' },
      currencyCode: 'BRL', remainingBalance: '120.0000', status: 'OPEN',
    } as never);
    subject();
    const link = await screen.findByRole('link', { name: 'Abrir título no Financeiro' });
    expect(link).toHaveAttribute('href', `/app/finance/payables/${receipt.payableId}`);
    expect(screen.getByText(/BRL 120.0000 em aberto/)).toBeInTheDocument();
    expect(getPayable).toHaveBeenCalledWith(receipt.payableId, expect.any(AbortSignal));
  });

  it('does not render a title or status after Finance returns 403', async () => {
    vi.mocked(getPayable).mockRejectedValue(new BackofficeApiError(403, 'FINANCE_DENIED'));
    subject();
    await waitFor(() =>
      expect(screen.queryByText('Consultando consequência financeira…')).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('link', { name: /título no Financeiro/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/BRL 120/)).not.toBeInTheDocument();
  });

  it('does not disclose an unrelated Finance title even if a stale UUID was returned', async () => {
    vi.mocked(getPayable).mockResolvedValue({
      id: receipt.payableId,
      origin: { kind: 'PURCHASE', id: 'another-receipt', reference: 'SPO' },
      currencyCode: 'USD', remainingBalance: '999.0000', status: 'OPEN',
    } as never);
    subject();
    expect(await screen.findByText('Consulta financeira indisponível')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /título no Financeiro/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/USD 999/)).not.toBeInTheDocument();
  });
});
