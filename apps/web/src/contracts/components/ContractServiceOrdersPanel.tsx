import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ObjectPanel } from '../../enterprise-object';
import { UnitScopeLabel } from '../../ui';
import { listServiceOrders, ServiceOrdersApiError, type ServiceOrderSummary } from '../../service-orders/api/service-orders-api';

type OrdersState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error' }
  | { phase: 'ready'; rows: ServiceOrderSummary[]; total: number | null; hasMore: boolean | null };

/**
 * Contract 360 — consulta o MESMO endpoint de OS da operação, sob o mesmo PDP.
 * contractId é predicado SQL parametrizado (nunca filtro client-side). Nenhuma
 * contagem é inferida de uma página incompleta; 403 não é transformado em zero.
 */
export function ContractServiceOrdersPanel({ contractId }: { contractId: string }) {
  const [state, setState] = useState<OrdersState>({ phase: 'loading' });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });
    void listServiceOrders({ contractId, limit: 5, offset: 0 }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setState({
          phase: 'ready',
          rows: response.items,
          total: typeof response.total === 'number' ? response.total : null,
          hasMore: typeof response.hasMore === 'boolean' ? response.hasMore : null,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState(error instanceof ServiceOrdersApiError && error.kind === 'denied'
          ? { phase: 'denied' } : { phase: 'error' });
      });
    return () => controller.abort();
  }, [contractId, retry]);

  const listHref = `/app/service-orders?contractId=${encodeURIComponent(contractId)}`;
  return (
    <ObjectPanel title="Ordens de serviço vinculadas">
      {state.phase === 'loading' ? (
        <p role="status" className="m-0 text-sm text-gray-600">Consultando ordens vinculadas…</p>
      ) : state.phase === 'denied' ? (
        <p className="m-0 text-sm text-gray-600">Sem permissão para consultar as ordens vinculadas.</p>
      ) : state.phase === 'error' ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-red-700">
          Não foi possível consultar as ordens vinculadas.
          <button type="button" className="underline" onClick={() => setRetry((n) => n + 1)}>Tentar novamente</button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="m-0 text-xs text-gray-600">
            {state.total === null
              ? 'Total não publicado pelo servidor.'
              : `${state.total} ${state.total === 1 ? 'ordem vinculada' : 'ordens vinculadas'}`}
          </p>
          {state.rows.length === 0 ? (
            <p className="m-0 text-sm text-gray-600">Nenhuma ordem vinculada a este contrato no escopo autorizado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table aria-label="Ordens vinculadas ao contrato" className="w-full min-w-[32rem] border-collapse text-left text-xs">
                <thead><tr className="border-b border-gray-200 text-gray-600">
                  <th scope="col" className="px-2 py-2">Ordem</th>
                  <th scope="col" className="px-2 py-2">Situação</th>
                  <th scope="col" className="px-2 py-2">Unidade</th>
                  <th scope="col" className="px-2 py-2">Prazo</th>
                </tr></thead>
                <tbody>
                  {state.rows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-100">
                      <td className="px-2 py-2">
                        <Link className="font-semibold text-brand-700 no-underline hover:underline" to={`/app/service-orders/${row.id}`}>{row.orderNumber}</Link>
                        <span className="ml-2 text-gray-500">{row.internalCode}</span>
                      </td>
                      <td className="px-2 py-2">{row.status}</td>
                      <td className="px-2 py-2"><UnitScopeLabel unitId={row.unitId} /></td>
                      <td className="px-2 py-2">{row.deadlineAt ?? 'Não publicado'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link to={listHref} className="text-sm font-semibold text-brand-700 no-underline hover:underline">
            Ver carteira deste contrato
          </Link>
          {state.hasMore && state.total === null ? (
            <span className="ml-3 text-xs text-gray-600">Há outras ordens nesta carteira.</span>
          ) : null}
        </div>
      )}
    </ObjectPanel>
  );
}
