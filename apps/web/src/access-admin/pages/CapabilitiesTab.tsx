import { AccessAdminApiError, getCatalog, type AccessAdminCatalog } from '../api/access-admin-api';
import { mapAccessAdminErrorToMessage } from '../api/access-admin-error-messages';
import { useAsyncResource } from '../hooks/useAccessAdminData';
import { Badge, EmptyState, ErrorState, LoadingState, worklistCellClass, worklistTableClass, worklistHeadCellClass, worklistRowClass, worklistTableCardClass } from '../../ui';

export function CapabilitiesTab() {
  const { state, refresh } = useAsyncResource<AccessAdminCatalog>(() => getCatalog());

  if (state.phase === 'loading') {
    return <LoadingState label="Carregando catálogo de capacidades…" />;
  }

  if (state.phase === 'error') {
    const message =
      state.error instanceof AccessAdminApiError
        ? mapAccessAdminErrorToMessage(state.error.code, state.error.status)
        : 'Não foi possível carregar o catálogo de capacidades.';
    return <ErrorState title="Capacidades" message={message} onRetry={refresh} />;
  }

  const capabilities = state.data.capabilities;

  return (
    <div>
      <p className="mb-4 max-w-3xl text-sm text-gray-500">
        Catálogo de capacidades do servidor. O cliente não pode inventar capacidades:
        somente os códigos listados aqui existem para o backend.
      </p>

      {capabilities.length === 0 ? (
        <EmptyState
          title="Nenhuma capacidade"
          description="O catálogo de capacidades retornado pelo servidor está vazio."
        />
      ) : (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Catálogo de capacidades">
            <thead className={worklistHeadCellClass}>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  Código
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Kind
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Classe
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {capabilities.map((capability) => (
                <tr key={capability.code} className={worklistRowClass}>
                  <td className={worklistCellClass}>
                    <span className="font-mono text-gray-600">{capability.code}</span>
                  </td>
                  <td className={worklistCellClass}>
                    <Badge tone="neutral">{capability.kind}</Badge>
                  </td>
                  <td className={worklistCellClass}>
                    {capability.class ? (
                      <Badge tone="info">{capability.class}</Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
