import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listServiceOrders, ServiceOrdersApiError } from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import { DynamicKanban, DynamicList, useEntitySchema, type MetaEntitySchema } from '../../engine';
import {
  serviceOrderEngineRows,
  type ServiceOrderEngineRow,
} from './service-order-engine-rows';

/**
 * Lista de ordens de serviço RENDERIZADA PELA ENGINE.
 *
 * Não há coluna, rótulo, ordem nem cabeçalho de tabela escritos aqui. `DynamicList` lê a view
 * `list` (`meta.views.layout.columns`) e os RÓTULOS de `meta.fields`; `DynamicKanban` lê o
 * `groupBy` da view `kanban` e os ESTADOS de `meta.workflows`. Trocar a visão de tabela para
 * quadro é um SELECT na tela, não um deploy.
 *
 * O que permanece é APENAS o encanamento de dados — qual endpoint alimenta a entidade — que a
 * engine não tem como adivinhar. Zero JSX de tabela, zero lista de colunas, zero mapa de
 * status.
 */
type ViewMode = 'list' | 'kanban';

export function ServiceOrdersEngineListPage() {
  const navigate = useNavigate();
  const { schema, status } = useEntitySchema('service-orders');
  const [rows, setRows] = useState<ServiceOrderEngineRow[]>([]);
  const [rowsStatus, setRowsStatus] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('list');

  const loadRows = useCallback(async (signal?: AbortSignal) => {
    setRowsStatus('loading');
    setErrorMessage(null);
    try {
      const response = await listServiceOrders({ limit: 50, offset: 0 }, signal);
      setRows(serviceOrderEngineRows(response.items));
      setRowsStatus('ready');
    } catch (error) {
      if (error instanceof ServiceOrdersApiError && error.kind === 'denied') {
        setRowsStatus('denied');
        return;
      }
      setErrorMessage(
        error instanceof ServiceOrdersApiError
          ? mapServiceOrdersErrorToMessage(error.code, error.status)
          : 'Não foi possível carregar as ordens de serviço.',
      );
      setRowsStatus('error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadRows(controller.signal);
    return () => controller.abort();
  }, [loadRows]);

  const openRow = (row: Record<string, unknown> & { id: string }): void => {
    void navigate(`/app/service-orders/${row.id}`);
  };

  /**
   * Rótulo humano de um estado, resolvido a partir do METADADO.
   *
   * A lista de opções do campo `status` em `meta.fields` é a mesma que alimenta o `select` do
   * formulário — não existe segunda tabela de tradução escrita em TypeScript.
   */
  function stateLabel(schemaValue: MetaEntitySchema, state: string): string {
    const statusField = schemaValue.fields.find((field) => field.name === schemaValue.workflow?.stateField);
    const option = statusField?.options?.options?.find((candidate) => candidate.value === state);
    return option?.label ?? state;
  }

  return (
    <div className="p-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">{schema?.label ?? 'Ordens de serviço'}</h1>
        <p className="mt-1 text-xs text-gray-500">
          Renderizado pela engine a partir de <code>/api/v1/meta/service-orders</code>.
        </p>
      </header>

      {status === 'loading' || rowsStatus === 'loading' ? (
        <p className="text-sm text-gray-600" aria-busy="true">
          Carregando…
        </p>
      ) : null}

      {status === 'error' ? (
        <p className="text-sm text-red-700" role="alert">
          Não foi possível carregar o schema da entidade.
        </p>
      ) : null}

      {rowsStatus === 'denied' ? (
        <p className="text-sm" role="alert">
          Você não tem permissão para listar ordens de serviço.
        </p>
      ) : null}

      {rowsStatus === 'error' ? (
        <p className="text-sm text-red-700" role="alert">
          {errorMessage ?? 'Não foi possível carregar as ordens de serviço.'}
        </p>
      ) : null}

      {schema && rowsStatus === 'ready' ? (
        <>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              data-testid="engine-view-list"
              aria-pressed={view === 'list'}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              onClick={() => setView('list')}
            >
              Tabela
            </button>
            <button
              type="button"
              data-testid="engine-view-kanban"
              aria-pressed={view === 'kanban'}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              onClick={() => setView('kanban')}
            >
              Quadro
            </button>
          </div>

          {view === 'list' ? (
            <DynamicList
              schema={schema}
              rows={rows}
              emptyMessage="Nenhuma ordem de serviço no seu escopo."
              onRowClick={openRow}
            />
          ) : (
            <DynamicKanban
              schema={schema}
              rows={rows}
              onCardClick={openRow}
              stateLabel={(state) => stateLabel(schema, state)}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

export type { ServiceOrderEngineRow };
