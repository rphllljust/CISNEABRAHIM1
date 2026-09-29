import { Link } from 'react-router-dom';
import { SearchHighlight } from '../components/SearchHighlight';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { ENTITY_TYPE_LABELS } from '../types/search.types';
import { presentSearchStatus } from '../../reports/utils/report-cell-presenter';
import {
  EmptyState,
  ModuleErrorState,
  ModulePage,
  StatusBadge,
  WorklistField,
  worklistControlClass,
  worklistHeadCellClass,
  worklistCellClass,
  worklistRowClass,
  worklistTableCardClass,
  worklistTableClass,
  WorklistRowLink,
} from '../../ui';
import { toneForStatus } from '../../financial-ui/labels';
import '../search.css';

/**
 * BUSCA GLOBAL — mesma gramatica enterprise das worklists.
 *
 * Antes: `<main className="search-page">` proprio, `<h1>` manual, um `search-filters` local e um
 * cartao por resultado (`search-card`) com o cabecalho dentro. Alem da ilha visual, o `status` do
 * resultado era renderizado CRU — `COMPLETED`, `RELEASED`, `PREPARED` — porque a busca publica o
 * status do dominio dono sem traduzir.
 *
 * Agora: `ModulePage` (landmark unico), toolbar compacta de consulta, e a grade densa compartilhada,
 * com o status apresentado pelo dicionario do dominio da linha (`presentSearchStatus`, escolhido
 * pelo `entityType`) e o registro inteiro como alvo de clique.
 *
 * Nada da busca mudou: mesmo hook, mesmos filtros, mesma paginacao por `offset`.
 */
export function SearchResultsPage() {
  const { state, filters, setFilters } = useGlobalSearch();

  return (
    <ModulePage>
      <header className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-gray-900">Busca</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            Resultados filtrados pelas suas permissões — nada é buscado fora do seu escopo.
          </p>
        </div>
      </header>

      <section
        aria-label="Filtros de busca"
        className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5"
      >
        <WorklistField label="Consulta" htmlFor="search-query" grow>
          <input
            id="search-query"
            type="search"
            className={`${worklistControlClass} w-full`}
            value={filters.q}
            onChange={(event) => setFilters({ q: event.target.value, offset: 0 })}
          />
        </WorklistField>
      </section>

      {state.phase === 'idle' ? (
        <EmptyState
          title="Digite ao menos 2 caracteres para buscar"
          description="A busca cobre apenas os registros que as suas permissões alcançam."
        />
      ) : null}

      {state.phase === 'loading' ? (
        <p aria-busy="true" aria-live="polite" className="m-0 text-sm text-gray-500">
          Buscando…
        </p>
      ) : null}

      {state.phase === 'denied' ? (
        <p role="alert" className="m-0 text-sm text-red-700">
          Você não tem permissão para buscar.
        </p>
      ) : null}

      {state.phase === 'error' ? (
        <ModuleErrorState title="Busca" message={state.message} retryable={false} />
      ) : null}

      {state.phase === 'ready' ? (
        <>
          {state.response.groups.length === 0 ? (
            <EmptyState
              title={`Nenhum resultado para "${state.response.query.raw}"`}
              description="Refine o termo ou verifique se o registro está no seu escopo de acesso."
            />
          ) : (
            state.response.groups.map((group) => (
              <section key={group.entityType} className="mb-3" aria-label={ENTITY_TYPE_LABELS[group.entityType]}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <h2 className="text-sm font-semibold text-gray-900">
                    {ENTITY_TYPE_LABELS[group.entityType]}
                  </h2>
                  <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600 tabular-nums">
                    {group.total}
                  </span>
                </div>
                <div className={worklistTableCardClass}>
                  <table className={worklistTableClass} aria-label={`Resultados em ${ENTITY_TYPE_LABELS[group.entityType]}`}>
                    <thead>
                      <tr>
                        <th scope="col" className={worklistHeadCellClass}>Registro</th>
                        <th scope="col" className={worklistHeadCellClass}>Situação</th>
                        <th scope="col" className={worklistHeadCellClass}>Quando</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item) => {
                        const statusLabel = presentSearchStatus(group.entityType, item.status);
                        return (
                          <tr key={`${group.entityType}-${item.entityId}`} className={worklistRowClass}>
                            <td className={worklistCellClass}>
                              <div className="min-w-0">
                                <WorklistRowLink href={item.entityHref}>
                                  <SearchHighlight text={item.title} query={state.response.query.raw} />
                                </WorklistRowLink>
                                {item.subtitle ? (
                                  <p className="mt-0.5 max-w-[46ch] truncate text-xs text-gray-500">
                                    <SearchHighlight text={item.subtitle} query={state.response.query.raw} />
                                  </p>
                                ) : null}
                              </div>
                            </td>
                            <td className={worklistCellClass}>
                              {statusLabel ? (
                                <StatusBadge label={statusLabel} tone={toneForStatus(item.status)} />
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className={`${worklistCellClass} tabular-nums whitespace-nowrap`}>
                              <time dateTime={item.occurredAt}>
                                {new Date(item.occurredAt).toLocaleString('pt-BR')}
                              </time>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}
          {state.response.pagination.hasMore ? (
            <button
              type="button"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50"
              onClick={() =>
                setFilters({
                  offset: (filters.offset ?? 0) + state.response.pagination.limit,
                })
              }
            >
              Carregar mais
            </button>
          ) : null}
        </>
      ) : null}
    </ModulePage>
  );
}
