import { Link } from 'react-router-dom';
import type { ServiceRequestLinked } from '../types/service-request.types';
import { formatDateTime, formatServiceRequestLinkedKind } from '../utils/service-request-labels';

type ServiceRequestRelatedChainProps = {
  chain: ServiceRequestLinked[];
  hasUnidentifiedLinks: boolean;
};

function linkedRecordPath(record: ServiceRequestLinked): string {
  switch (record.kind) {
    case 'PROPOSAL':
      return `/app/proposals/${record.id}`;
    case 'PURCHASE_ORDER':
      return `/app/purchase-orders/${record.id}`;
    case 'SERVICE_ORDER':
      return `/app/service-orders/${record.id}/planning`;
    default:
      return '/app/requests';
  }
}

/**
 * Cadeia empresarial da solicitacao: proposta -> pedido de compra -> ordem de servico.
 *
 * O backend so devolve os elos que o ator pode ler no modulo dono. Quando existe vinculo gravado
 * que o ator nao pode ler, a UI diz que ha vinculo sem expor numero, status ou link — nunca cai
 * para o identificador tecnico.
 */
export function ServiceRequestRelatedChain({
  chain,
  hasUnidentifiedLinks,
}: ServiceRequestRelatedChainProps) {
  if (chain.length === 0 && !hasUnidentifiedLinks) {
    return (
      <p className="text-sm text-gray-500" role="status">
        Nenhuma proposta, pedido de compra ou ordem de serviço vinculada a esta solicitação.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {chain.length > 0 ? (
        <ol className="border-l border-gray-200 pl-4">
          {chain.map((record) => (
            <li key={`${record.kind}-${record.id}`} className="relative pb-4 last:pb-0">
              <span
                aria-hidden="true"
                className="absolute top-1.5 -left-[21px] h-2 w-2 rounded-full bg-brand-500"
              />
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[10px] font-semibold tracking-wide text-gray-400 uppercase">
                  {formatServiceRequestLinkedKind(record.kind)}
                </span>
                <Link
                  to={linkedRecordPath(record)}
                  className="text-sm font-semibold text-brand-700 no-underline hover:text-brand-800"
                >
                  {record.label}
                </Link>
                {record.status ? (
                  <span className="text-xs text-gray-500">{record.status}</span>
                ) : null}
              </div>
              <div className="mt-0.5 text-xs text-gray-500 tabular-nums">
                {formatDateTime(record.occurredAt)}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {hasUnidentifiedLinks ? (
        <p className="text-xs text-gray-500">
          Há vínculo registrado nesta solicitação que você não tem permissão para consultar.
        </p>
      ) : null}
    </div>
  );
}
