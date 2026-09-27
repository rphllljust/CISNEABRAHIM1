import { Link } from 'react-router-dom';
import type { ProposalLinked } from '../types/proposal.types';
import { formatDateTime } from '../utils/proposal-labels';
import { formatProposalLinkedKind, linkedRecordPath } from '../utils/proposal-workbench';

type ProposalCommercialChainProps = {
  chain: ProposalLinked[];
  originRequests: Array<{ id: string; requestCode: string; status: string }>;
  hasUnreadableLinks: boolean;
};

/**
 * Cadeia comercial: solicitacao -> proposta -> pedido de compra / ordem de servico.
 *
 * O backend so devolve os elos que o ator pode ler no modulo dono. Quando existe vinculo gravado
 * que o ator nao pode ler, a UI declara a existencia sem expor numero, status, valor ou link —
 * nunca cai para o identificador tecnico.
 */
export function ProposalCommercialChain({
  chain,
  originRequests,
  hasUnreadableLinks,
}: ProposalCommercialChainProps) {
  const isEmpty = chain.length === 0 && originRequests.length === 0;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
          De onde veio
        </p>
        {originRequests.length > 0 ? (
          <ul className="mt-1 space-y-1">
            {originRequests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-baseline gap-2">
                <span className="text-[10px] font-semibold tracking-wide text-gray-400 uppercase">
                  {formatProposalLinkedKind('REQUEST')}
                </span>
                <Link
                  to={`/app/requests/${request.id}`}
                  className="text-sm font-semibold text-brand-700 no-underline hover:text-brand-800"
                >
                  {request.requestCode}
                </Link>
                {request.status ? (
                  <span className="text-xs text-gray-500">{request.status}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-gray-500">
            Nenhuma solicitação de serviço vinculada a esta proposta.
          </p>
        )}
      </div>

      <div>
        <p className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">
          Para onde foi
        </p>
        {chain.length > 0 ? (
          <ol className="mt-1 border-l border-gray-200 pl-4">
            {chain.map((record) => (
              <li key={`${record.kind}-${record.id}`} className="relative pb-3 last:pb-0">
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 -left-[21px] h-2 w-2 rounded-full bg-brand-500"
                />
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-[10px] font-semibold tracking-wide text-gray-400 uppercase">
                    {formatProposalLinkedKind(record.kind)}
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
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-xs text-gray-500">
                  <span className="tabular-nums">{formatDateTime(record.occurredAt)}</span>
                  {record.viaLabel ? <span>via OS {record.viaLabel}</span> : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-1 text-sm text-gray-500">
            Nenhuma ordem de serviço ou pedido de compra vinculado a esta proposta.
          </p>
        )}
      </div>

      {isEmpty && hasUnreadableLinks ? (
        <p className="text-xs text-gray-500">
          Há vínculo registrado nesta proposta que você não tem permissão para consultar.
        </p>
      ) : null}
      {!isEmpty && hasUnreadableLinks ? (
        <p className="text-xs text-gray-500">
          Existem outros vínculos que você não tem permissão para consultar.
        </p>
      ) : null}
    </div>
  );
}
