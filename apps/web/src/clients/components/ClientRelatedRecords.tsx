import { Link } from 'react-router-dom';
import { ObjectPanel } from '../../enterprise-object';
import type {
  ClientRelatedModuleKey,
  ClientRelatedModules,
  RelatedModule,
} from '../hooks/useClientRelatedRecords';

/**
 * Painéis "Relacionados" do Cliente.
 *
 * O Cliente é a contraparte de toda a cadeia comercial. Cada módulo que JÁ aceita `clientId` na sua
 * listagem entrega os registros reais daquele Cliente — sem contagem inventada, sem agregação no
 * frontend e sem endpoint novo. A leitura vive em `useClientRelatedRecords`; aqui só há
 * apresentação.
 *
 * REGRAS DE HONESTIDADE:
 * - Módulo NÃO autorizado não é desenhado: nem título, nem contagem, nem aviso de oculto
 *   (`read A != read B`). O painel simplesmente não existe para quem não pode lê-lo.
 * - Módulo autorizado e vazio aparece como "Nenhum registro", nunca com linha fantasma.
 * - A lista mostra no máximo `CLIENT_RECENT_LIMIT` registros por módulo (não é um dashboard).
 */

export const CLIENT_RELATED_MODULE_LABELS: Record<ClientRelatedModuleKey, string> = {
  requests: 'Solicitações',
  proposals: 'Propostas',
  purchaseOrders: 'Pedidos de compra',
  serviceOrders: 'Ordens de serviço',
};

const MODULE_ORDER: ClientRelatedModuleKey[] = [
  'requests',
  'proposals',
  'purchaseOrders',
  'serviceOrders',
];

function moduleSummary(state: RelatedModule): string {
  if (state.phase === 'loading') {
    return 'Carregando…';
  }
  if (state.phase === 'error') {
    return 'Não foi possível carregar';
  }
  if (state.rows.length === 0) {
    return 'Nenhum registro';
  }
  return `${state.rows.length} mais recente${state.rows.length === 1 ? '' : 's'}`;
}

export function ClientRelatedRecords({ modules }: { modules: ClientRelatedModules }) {
  const visible = MODULE_ORDER.filter((key) => modules[key].phase !== 'denied');

  if (visible.length === 0) {
    return null;
  }

  return (
    <>
      <p className="m-0 text-xs text-gray-500">
        Últimos registros deste Cliente na cadeia comercial. Cada item abre o documento de origem.
      </p>
      <div className="grid gap-2.5 md:grid-cols-2">
        {visible.map((key) => {
          const state = modules[key];
          return (
            <ObjectPanel
              key={key}
              title={CLIENT_RELATED_MODULE_LABELS[key]}
              actions={<span className="text-xs text-gray-500">{moduleSummary(state)}</span>}
            >
              {state.phase === 'ready' && state.rows.length > 0 ? (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {state.rows.map((row) => (
                    <li key={row.id}>
                      <Link
                        to={row.href}
                        className="text-sm font-semibold text-brand-700 no-underline hover:text-brand-800"
                      >
                        {row.label}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">{row.badge}</div>
                      {row.meta ? (
                        <p className="m-0 truncate text-xs text-gray-500" title={row.meta}>
                          {row.meta}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </ObjectPanel>
          );
        })}
      </div>
    </>
  );
}
