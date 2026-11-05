import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReceiptProvenanceWorkbench } from './ReceiptProvenanceWorkbench';
import { listPostedReceiptLines } from '../api/procurement-api';
import { bindReceiptProvenance, getReceiptProvenance, listInventoryItems, listWarehouses, postStockMovement } from '../../inventory/api/inventory-api';

vi.mock('../api/procurement-api', () => ({
  listPostedReceiptLines: vi.fn(),
}));
vi.mock('../../inventory/api/inventory-api', () => ({
  bindReceiptProvenance: vi.fn(),
  getReceiptProvenance: vi.fn(),
  listInventoryItems: vi.fn(),
  listWarehouses: vi.fn(),
  postStockMovement: vi.fn(),
}));

const receiptId = '11111111-1111-4111-8111-111111111111';
const skuId = '22222222-2222-4222-8222-222222222222';
const warehouseId = '33333333-3333-4333-8333-333333333333';

function renderWorkbench() {
  return render(
    <MemoryRouter>
      <ReceiptProvenanceWorkbench orderId="order-1" unitId="unit-real" />
    </MemoryRouter>,
  );
}

describe('Procure-to-Pay receipt provenance workbench', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listPostedReceiptLines).mockResolvedValue({
      items: [{
        receiptLineId: receiptId,
        receiptId: 'receipt-1',
        orderLineId: 'line-1',
        lineNumber: 1,
        description: 'Material recebido',
        receivedQuantity: '10.0000',
        canCertify: true,
      }],
      limit: 20,
      offset: 0,
      total: 1,
      hasMore: false,
    });
    vi.mocked(listInventoryItems).mockResolvedValue({
      items: [{ id: skuId, unitId: 'unit-real', sku: 'MAT-01', name: 'Material', status: 'ACTIVE' }],
      total: 1,
      limit: 50,
      offset: 0,
      totalPages: 1,
    });
    vi.mocked(listWarehouses).mockResolvedValue({
      items: [{ id: warehouseId, unitId: 'unit-real', code: 'DEP-01', name: 'Depósito', status: 'ACTIVE' }],
      total: 1,
      limit: 50,
      offset: 0,
      totalPages: 1,
    });
    vi.mocked(getReceiptProvenance).mockResolvedValue({
      receiptLineId: receiptId,
      receivedQuantity: '10.0000',
      allocatedQuantity: '0.0000',
      items: [],
    });
    vi.mocked(bindReceiptProvenance).mockResolvedValue({
      id: 'binding-1',
      receiptLineId: receiptId,
      inventoryItemId: skuId,
      warehouseId,
      unitId: 'unit-real',
      allocatedQuantity: '6.0000',
      idempotent: false,
    });
  });

  it('certifies an explicitly selected posted receipt against existing Inventory masters', async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Linha recebida' }), receiptId);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Item cadastrado' }), skuId);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Depósito cadastrado' }), warehouseId);
    await user.type(screen.getByRole('textbox', { name: /Quantidade a vincular/i }), '6');
    await user.click(screen.getByRole('button', { name: 'Certificar origem no Estoque' }));

    await waitFor(() => expect(bindReceiptProvenance).toHaveBeenCalledWith({
      receiptLineId: receiptId,
      inventoryItemId: skuId,
      warehouseId,
      unitId: 'unit-real',
      allocatedQuantity: '6',
      idempotencyKey: expect.any(String),
    }));
    expect(screen.getByText(/Nenhuma movimentação de saldo foi criada/)).toBeInTheDocument();
    expect(postStockMovement).not.toHaveBeenCalled();
    expect(listInventoryItems).toHaveBeenCalledWith(
      expect.objectContaining({ unitId: 'unit-real' }),
      expect.any(AbortSignal),
    );
  });

  it('does not offer self-certification when the same actor received the goods', async () => {
    vi.mocked(listPostedReceiptLines).mockResolvedValue({
      items: [{
        receiptLineId: receiptId,
        receiptId: 'receipt-1',
        orderLineId: 'line-1',
        lineNumber: 1,
        description: 'Material recebido',
        receivedQuantity: '10.0000',
        canCertify: false,
      }],
      total: 1,
      limit: 20,
      offset: 0,
      hasMore: false,
    });
    renderWorkbench();
    expect(await screen.findByText(/A certificação deve ser feita por outro operador autorizado/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Certificar origem no Estoque' })).not.toBeInTheDocument();
    expect(bindReceiptProvenance).not.toHaveBeenCalled();
  });

  it('never treats a failing Procurement evidence read as an empty receipt list', async () => {
    vi.mocked(listPostedReceiptLines).mockRejectedValue(new Error('unavailable'));
    renderWorkbench();
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao consultar as linhas recebidas');
    expect(screen.queryByText(/Não existem linhas de recebimento confirmado/)).not.toBeInTheDocument();
    expect(bindReceiptProvenance).not.toHaveBeenCalled();
  });
});
