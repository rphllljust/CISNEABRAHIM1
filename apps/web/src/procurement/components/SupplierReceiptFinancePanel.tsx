import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPayable } from '../../finance/api/finance-api';
import type { PayableDetail } from '../../finance/types/finance.types';
import { BackofficeApiError } from '../../financial-ui/enterprise-api';
import type { SupplierPurchaseOrderReceipt } from '../api/procurement-api';

function ReceiptFinancialCell({ receipt }: { receipt: SupplierPurchaseOrderReceipt }) {
  const [state, setState] = useState<
    | { phase: 'loading' | 'denied' | 'error' | 'not-linked' }
    | { phase: 'ready'; payable: PayableDetail }
  >({ phase: receipt.payableId ? 'loading' : 'not-linked' });

  useEffect(() => {
    if (!receipt.payableId) {
      setState({ phase: 'not-linked' });
      return;
    }
    const controller = new AbortController();
    setState({ phase: 'loading' });
    void getPayable(receipt.payableId, controller.signal).then(
      (payable) => {
        if (controller.signal.aborted) return;
        // Never display an unrelated title even when its UUID was returned
        // from an older snapshot. Finance remains the owner of this link.
        if (payable.origin.kind !== 'PURCHASE' ||
            payable.origin.id !== receipt.id) {
          setState({ phase: 'error' });
          return;
        }
        setState({ phase: 'ready', payable });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const denied = error instanceof BackofficeApiError &&
          (error.status === 403 || error.status === 404);
        setState({ phase: denied ? 'denied' : 'error' });
      },
    );
    return () => controller.abort();
  }, [receipt.id, receipt.payableId]);

  if (state.phase === 'ready') {
    return (
      <div className="flex flex-col gap-1">
        <Link to={`/app/finance/payables/${state.payable.id}`}
          className="font-semibold text-brand-700 underline">
          Abrir título no Financeiro
        </Link>
        <span className="text-xs text-gray-600">
          {state.payable.status} · {state.payable.currencyCode} {state.payable.remainingBalance} em aberto
        </span>
      </div>
    );
  }
  if (state.phase === 'denied') return null;
  if (state.phase === 'not-linked') return <span>Sem título vinculado</span>;
  return <span role="status">{state.phase === 'loading'
    ? 'Consultando consequência financeira…'
    : 'Consulta financeira indisponível'}</span>;
}

/** Procure-to-Pay drillback, never inferred from a receipt's technical UUID. */
export function SupplierReceiptFinancePanel({
  receipts,
}: {
  receipts: SupplierPurchaseOrderReceipt[];
}) {
  return (
    <section aria-label="Consequências financeiras dos recebimentos" className="overflow-x-auto rounded-md border border-gray-200 bg-white p-3">
      <h3 className="mb-3 text-sm font-semibold">Recebimentos e consequências no Financeiro</h3>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th scope="col" className="p-2">Recebimento</th>
            <th scope="col" className="p-2">Estado</th>
            <th scope="col" className="p-2">Título a pagar</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((receipt, index) => (
            <tr key={receipt.id} className="border-t">
              <td className="p-2">Recebimento {index + 1}</td>
              <td className="p-2">{receipt.status}</td>
              <td className="p-2"><ReceiptFinancialCell receipt={receipt} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
