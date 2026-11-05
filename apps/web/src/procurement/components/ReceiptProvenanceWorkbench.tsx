import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BackofficeApiError } from '../../financial-ui/enterprise-api';
import {
  bindReceiptProvenance,
  listInventoryItems,
  listWarehouses,
  type InventoryItem,
  type ReceiptProvenanceBinding,
  type Warehouse,
} from '../../inventory/api/inventory-api';
import {
  listPostedReceiptLines,
  type PostedReceiptLinePage,
} from '../api/procurement-api';

const PAGE_SIZE = 20;
const LOOKUP_SIZE = 50;

/**
 * P2P — Receipt -> Inventory provenance workbench.
 *
 * Procurement owns posted receipt lines, Inventory owns SKU/warehouse mapping,
 * authorization, idempotency, 4dp total cap and SoD (receiver != certifier).
 * This action NEVER posts a stock movement or assumes receipt is inventory.
 */
export function ReceiptProvenanceWorkbench({
  orderId,
  unitId,
}: {
  orderId: string;
  unitId: string;
}) {
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [receiptState, setReceiptState] = useState<
    | { phase: 'loading' }
    | { phase: 'denied' }
    | { phase: 'error' }
    | { phase: 'ready'; page: PostedReceiptLinePage }
  >({ phase: 'loading' });
  const [catalogState, setCatalogState] = useState<
    | { phase: 'loading' }
    | { phase: 'denied' }
    | { phase: 'error' }
    | { phase: 'ready'; items: InventoryItem[]; warehouses: Warehouse[] }
  >({ phase: 'loading' });
  const [itemSearch, setItemSearch] = useState('');
  const [warehouseSearch, setWarehouseSearch] = useState('');
  const [receiptLineId, setReceiptLineId] = useState('');
  const [inventoryItemId, setInventoryItemId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReceiptProvenanceBinding | null>(null);
  const commandKey = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setReceiptState({ phase: 'loading' });
    void listPostedReceiptLines(orderId, { limit: PAGE_SIZE, offset }, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) {
          setReceiptState({ phase: 'ready', page });
        }
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) {
          setReceiptState(
            reason instanceof BackofficeApiError && reason.kind === 'denied'
              ? { phase: 'denied' }
              : { phase: 'error' },
          );
        }
      },
    );
    return () => controller.abort();
  }, [orderId, offset, revision]);

  // Both lookups are scoped to the order's real operational unit. The selected
  // UUIDs are never invented from receipt descriptions or supplier line names.
  useEffect(() => {
    const controller = new AbortController();
    setCatalogState({ phase: 'loading' });
    const params = { limit: LOOKUP_SIZE, offset: 0, unitId };
    void Promise.all([
      listInventoryItems(
        { ...params, q: itemSearch.trim().length >= 2 ? itemSearch.trim() : undefined },
        controller.signal,
      ),
      listWarehouses(
        { ...params, q: warehouseSearch.trim().length >= 2 ? warehouseSearch.trim() : undefined },
        controller.signal,
      ),
    ]).then(
      ([items, warehouses]) => {
        if (!controller.signal.aborted) {
          setCatalogState({ phase: 'ready', items: items.items, warehouses: warehouses.items });
        }
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) {
          setCatalogState(
            reason instanceof BackofficeApiError && reason.kind === 'denied'
              ? { phase: 'denied' }
              : { phase: 'error' },
          );
        }
      },
    );
    return () => controller.abort();
  }, [unitId, itemSearch, warehouseSearch]);

  const rows = receiptState.phase === 'ready' ? receiptState.page.items : [];
  const selected = rows.find((line) => line.receiptLineId === receiptLineId) ?? null;
  const eligible = rows.filter((line) => line.canCertify);
  const items = catalogState.phase === 'ready' ? catalogState.items : [];
  const warehouses = catalogState.phase === 'ready' ? catalogState.warehouses : [];

  function resetCommand() {
    commandKey.current = null;
    setResult(null);
    setError(null);
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected?.canCertify || !inventoryItemId || !warehouseId || busy ||
        !/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(quantity) ||
        Number(quantity) <= 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    // A retry uses exactly the same key; changing any part of the request clears it.
    commandKey.current ??= crypto.randomUUID();
    try {
      const bound = await bindReceiptProvenance({
        receiptLineId: selected.receiptLineId,
        inventoryItemId,
        warehouseId,
        unitId,
        allocatedQuantity: quantity,
        idempotencyKey: commandKey.current,
      });
      setResult(bound);
      commandKey.current = null;
    } catch (reason) {
      setError(
        reason instanceof BackofficeApiError && reason.kind === 'denied'
          ? 'O servidor recusou a certificação. Verifique as permissões e a segregação de funções.'
          : 'Não foi possível certificar a origem. A quantidade e as demais regras continuam sujeitas ao servidor.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Conferência do recebimento para estoque" className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Recebimento → Estoque</h2>
          <p className="mt-1 text-sm text-gray-600">
            Certifique o vínculo entre uma linha recebida, um item existente e um depósito.
            Não movimenta estoque, não presume custo e não registra entrada automática.
          </p>
        </div>
        <Link to="/app/inventory" className="text-sm font-medium text-brand-700">
          Abrir Estoque
        </Link>
      </div>

      {receiptState.phase === 'loading' ? <p role="status">Consultando linhas recebidas…</p> : null}
      {receiptState.phase === 'denied' ? <p role="alert">Sem autorização para consultar e certificar recebimentos deste pedido.</p> : null}
      {receiptState.phase === 'error' ? (
        <div role="alert">
          Falha ao consultar as linhas recebidas.
          <button type="button" onClick={() => setRevision((value) => value + 1)}>Tentar novamente</button>
        </div>
      ) : null}
      {receiptState.phase === 'ready' && receiptState.page.total === 0 ? (
        <p>Não existem linhas de recebimento confirmado neste pedido.</p>
      ) : null}

      {receiptState.phase === 'ready' && receiptState.page.total > 0 ? (
        <>
          <p className="mb-2 text-xs text-gray-500">
            {receiptState.page.offset + 1}–{receiptState.page.offset + rows.length} de {receiptState.page.total} linhas registradas
          </p>
          <div className="mb-3 flex gap-2">
            <button type="button" disabled={offset === 0}
              onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); setReceiptLineId(''); resetCommand(); }}>
              Anteriores
            </button>
            <button type="button" disabled={!receiptState.page.hasMore}
              onClick={() => { setOffset(offset + PAGE_SIZE); setReceiptLineId(''); resetCommand(); }}>
              Próximas
            </button>
          </div>

          {eligible.length === 0 ? (
            <p role="status" className="text-sm text-amber-700">
              Você registrou estas linhas de recebimento. A certificação deve ser feita por outro operador autorizado.
            </p>
          ) : (
            <form onSubmit={(event) => void confirm(event)} className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                Linha recebida
                <select aria-label="Linha recebida" required value={receiptLineId}
                  onChange={(event) => { setReceiptLineId(event.target.value); setQuantity(''); resetCommand(); }}
                  className="rounded border border-gray-300 p-2">
                  <option value="">Selecione a linha</option>
                  {eligible.map((line) => (
                    <option key={line.receiptLineId} value={line.receiptLineId}>
                      {line.lineNumber} · {line.description} · {line.receivedQuantity} recebidos
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Quantidade a vincular (até 4 casas decimais)
                <input aria-label="Quantidade a vincular" required inputMode="decimal"
                  placeholder={selected?.receivedQuantity ?? '0.0000'} value={quantity}
                  onChange={(event) => { setQuantity(event.target.value); resetCommand(); }}
                  className="rounded border border-gray-300 p-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Buscar item de estoque
                <input aria-label="Buscar item de estoque" value={itemSearch}
                  onChange={(event) => { setItemSearch(event.target.value); setInventoryItemId(''); resetCommand(); }}
                  placeholder="SKU ou descrição" className="rounded border border-gray-300 p-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Item cadastrado
                <select aria-label="Item cadastrado" required value={inventoryItemId}
                  onChange={(event) => { setInventoryItemId(event.target.value); resetCommand(); }}
                  className="rounded border border-gray-300 p-2">
                  <option value="">Selecione o item</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Buscar depósito
                <input aria-label="Buscar depósito" value={warehouseSearch}
                  onChange={(event) => { setWarehouseSearch(event.target.value); setWarehouseId(''); resetCommand(); }}
                  placeholder="Código ou nome" className="rounded border border-gray-300 p-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Depósito cadastrado
                <select aria-label="Depósito cadastrado" required value={warehouseId}
                  onChange={(event) => { setWarehouseId(event.target.value); resetCommand(); }}
                  className="rounded border border-gray-300 p-2">
                  <option value="">Selecione o depósito</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>
                  ))}
                </select>
              </label>
              <div className="md:col-span-2">
                {catalogState.phase === 'loading' ? <p role="status">Consultando cadastros de estoque…</p> : null}
                {catalogState.phase === 'denied' ? <p role="alert">Sem autorização para consultar itens e depósitos.</p> : null}
                {catalogState.phase === 'error' ? <p role="alert">Não foi possível consultar os cadastros de estoque.</p> : null}
                <button type="submit" disabled={busy || catalogState.phase !== 'ready' || !selected?.canCertify || !inventoryItemId || !warehouseId || !quantity}
                  className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {busy ? 'Certificando…' : 'Certificar origem no Estoque'}
                </button>
              </div>
            </form>
          )}
        </>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
      {result ? (
        <p role="status" className="mt-3 text-sm text-green-800">
          Vinculação persistida pelo Estoque: {result.allocatedQuantity} unidades
          {result.idempotent ? ' (replay idempotente)' : ''}. Nenhuma movimentação de saldo foi criada.
        </p>
      ) : null}
    </section>
  );
}
