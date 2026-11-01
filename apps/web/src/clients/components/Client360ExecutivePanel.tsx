import { Link } from 'react-router-dom';
import type { ClientRelatedModuleKey, ClientRelatedModules } from '../hooks/useClientRelatedRecords';

const MODULES: Array<{ key: ClientRelatedModuleKey; label: string; href: string }> = [
  { key: 'requests', label: 'Solicitações', href: '/app/requests' },
  { key: 'proposals', label: 'Propostas', href: '/app/proposals' },
  { key: 'purchaseOrders', label: 'Pedidos de compra', href: '/app/purchase-orders' },
  { key: 'contracts', label: 'Contratos', href: '/app/contracts' },
  { key: 'serviceOrders', label: 'Ordens de serviço', href: '/app/service-orders' },
];

/** Resumo executivo do Cliente 360: somente fatos devolvidos pelos módulos autorizados. */
export function Client360ExecutivePanel({ clientId, modules }: { clientId: string; modules: ClientRelatedModules }) {
  return (
    <section aria-labelledby="client-360-heading" className="mb-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-700">Customer 360</p>
          <h2 id="client-360-heading" className="m-0 text-base font-semibold text-gray-900">Visão executiva do Cliente</h2>
          <p className="m-0 mt-1 text-xs text-gray-500">Processos comerciais relacionados, com escopo e contagens comprovados pelo servidor.</p>
        </div>
        <Link to={`/app/clients/${clientId}/edit`} className="text-xs font-semibold text-brand-700 no-underline hover:underline">Administrar cadastro</Link>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {MODULES.filter(({ key }) => modules[key].allowed && modules[key].count !== null).map(({ key, label }) => {
          const item = modules[key];
          return (
            <div
              key={key}
              aria-label={`${label}: ${item.count}`}
              className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
            >
              <span className="block truncate text-[11px] font-medium text-gray-600">{label}</span>
              <strong className="mt-1 block text-xl font-semibold tabular-nums text-gray-900">{item.count}</strong>
              <span className="block text-[10px] text-gray-500">registros relacionados</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
