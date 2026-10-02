import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  cancelServiceOrder,
  listServiceOrders,
  prepareServiceOrder,
  releaseServiceOrder,
  ServiceOrdersApiError,
} from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import {
  CommandPalette,
  DynamicBulkActions,
  DynamicFilterBar,
  DynamicKanban,
  DynamicList,
  DynamicSavedViewsBar,
  DynamicViewSwitcher,
  filtersToSearchParams,
  paletteActionsFromSchema,
  useCommandPaletteShortcut,
  useEntitySchema,
  useSavedViews,
  toDisplayText,
  type MetaEntitySchema,
} from '../../engine';
import { useAuth } from '../../auth/context/AuthProvider';
import { entityLabel, useLanguage } from '../../i18n';
import { serviceOrderEngineRows, type ServiceOrderEngineRow } from './service-order-engine-rows';

/**
 * Lista de ordens de serviço RENDERIZADA PELA ENGINE — a tela de referência do ERP.
 *
 * Não há coluna, rótulo, ordem, filtro nem aba escritos em JSX. Tudo vem do metadata store:
 *   - colunas  → `meta.views['list'].layout.columns`
 *   - abas     → `meta.views` (qualquer `view_type` vira aba)
 *   - filtros  → `meta.fields.in_filter`
 *   - ações    → `meta.workflow_transitions`
 *
 * O que permanece é o ENCANAMENTO: qual endpoint alimenta a entidade e como cada comando
 * chega ao backend — conhecimento que a engine não tem como adivinhar.
 */
const SUPPORTED_VIEW_TYPES = ['list', 'kanban'];

const DEFAULT_DESTINATIONS = [
  { id: 'nav-suppliers', label: 'Fornecedores', path: '/app/suppliers', group: 'Navegar' },
  { id: 'nav-billing', label: 'Faturamento interno', path: '/app/billing', group: 'Navegar' },
  { id: 'nav-service-orders', label: 'Ordens de serviço', path: '/app/service-orders', group: 'Navegar' },
];

export function ServiceOrdersEngineListPage() {
  const navigate = useNavigate();
  const { identityId } = useAuth();
  const { schema, status } = useEntitySchema('service-orders');
  const [searchParams, setSearchParams] = useSearchParams();

  /*
   * ASSINATURA DE IDIOMA.
   *
   * `entityLabel()` é uma função livre e NÃO re-renderiza sozinha: quem dispara o
   * re-render é este hook. Sem esta linha, trocar o idioma no seletor atualizaria o
   * catálogo mas o `<h1>` só mudaria no próximo render por outro motivo — que é
   * exatamente o defeito que a prova de browser ("sem reload") existe para pegar.
   *
   * `language` é lido mas não usado diretamente: a dependência está no hook, não no valor.
   */
  useLanguage();

  const [rows, setRows] = useState<ServiceOrderEngineRow[]>([]);
  const [rowsStatus, setRowsStatus] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const activeViewType = searchParams.get('view') ?? 'list';

  const filters = useMemo(() => {
    const values: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      if (key !== 'view') {
        values[key] = value;
      }
    }
    return values;
  }, [searchParams]);

  const savedViews = useSavedViews(identityId ?? 'anonymous', 'service-orders');

  const loadRows = useCallback(
    async (signal?: AbortSignal) => {
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
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadRows(controller.signal);
    return () => controller.abort();
  }, [loadRows]);

  /**
   * Filtragem aplicada NO CLIENTE sobre a página carregada.
   *
   * O endpoint de listagem de OS não aceita os campos que o metadado declara como filtráveis
   * (`status`, `unit_id`, `origin`) — ele aceita `filter`/`q`/`from`/`to`. Aplicar no cliente
   * mantém o filtro HONESTO: filtra o que está na tela, sem inventar parâmetro que o backend
   * ignoraria silenciosamente. GAP_DE_CONTRATO declarado.
   */
  const visibleRows = useMemo(() => {
    const active = Object.entries(filters).filter(([, value]) => value.trim() !== '');
    if (active.length === 0) {
      return rows;
    }
    return rows.filter((row) =>
      active.every(([field, value]) =>
        toDisplayText(row[field])
          .toLowerCase()
          .includes(value.trim().toLowerCase()),
      ),
    );
  }, [rows, filters]);

  const updateFilter = (field: string, value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value.trim() === '') {
      next.delete(field);
    } else {
      next.set(field, value);
    }
    setSearchParams(next, { replace: true });
  };

  const clearFilters = (): void => {
    const next = filtersToSearchParams({});
    if (activeViewType !== 'list') {
      next.set('view', activeViewType);
    }
    setSearchParams(next, { replace: true });
  };

  const changeView = (viewType: string): void => {
    const next = new URLSearchParams(searchParams);
    next.set('view', viewType);
    setSearchParams(next, { replace: true });
  };

  const openRow = (row: Record<string, unknown> & { id: string }): void => {
    void navigate(`/app/service-orders/${row.id}`);
  };

  async function runCommand(command: string, ids: string[]): Promise<void> {
    setBulkBusy(true);
    setBulkMessage(null);
    const failures: string[] = [];
    for (const id of ids) {
      const row = rows.find((candidate) => candidate.id === id);
      const rowVersion = Number(row?.['row_version'] ?? 1);
      try {
        if (command === 'prepare') {
          await prepareServiceOrder(id, rowVersion);
        } else if (command === 'release') {
          await releaseServiceOrder(id, rowVersion);
        } else if (command === 'cancel') {
          await cancelServiceOrder(id, {
            rowVersion,
            cancellationReason: 'Cancelamento em lote solicitado na lista de ordens de serviço.',
          });
        }
      } catch (error) {
        failures.push(
          error instanceof ServiceOrdersApiError
            ? mapServiceOrdersErrorToMessage(error.code, error.status)
            : 'erro',
        );
      }
    }
    setBulkBusy(false);
    setSelectedIds([]);
    if (failures.length > 0) {
      setBulkMessage(`${failures.length} de ${ids.length} não puderam ser concluídas.`);
    }
    await loadRows();
  }

  const stateLabel = useCallback(
    (state: string): string => {
      if (!schema) {
        return state;
      }
      return resolveStateLabel(schema, state);
    },
    [schema],
  );

  /*
   * As ações da palette derivam do workflow do metadado e despacham o MESMO `runCommand` da
   * barra de lote. As dependências incluem `rows` porque `runCommand` lê `row_version` das
   * linhas carregadas — mantê-las explícitas é mais honesto que silenciar a regra.
   */
  const paletteActions = useMemo(
    () => paletteActionsFromSchema(schema, (command) => void runCommand(command, selectedIds)),
    [schema, selectedIds, rows],
  );

  useCommandPaletteShortcut(useCallback(() => setPaletteOpen(true), []));

  return (
    <div className="p-6">
      <header className="mb-4">
        {/*
          ENTITY TITLE — o rótulo da entidade, resolvido pelo i18n.

          O metadata store devolve o rótulo em português (`Ordens de serviço`). Aqui ele
          passa pelo catálogo: em pt-BR sai igual ao metadado, em en-US sai traduzido. O
          `data-testid` é o gancho da prova de browser — é este nó que precisa mudar quando
          o operador troca o idioma, SEM reload.
        */}
        <h1 className="text-xl font-semibold" data-testid="entity-title">
          {entityLabel('service-orders', schema?.label ?? 'Ordens de serviço')}
        </h1>
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
          <DynamicViewSwitcher
            schema={schema}
            activeViewType={activeViewType}
            onChange={changeView}
            supportedViewTypes={SUPPORTED_VIEW_TYPES}
          />

          <DynamicFilterBar
            schema={schema}
            values={filters}
            onChange={updateFilter}
            onClear={clearFilters}
          />

          <DynamicSavedViewsBar
            views={savedViews.views}
            persistedLocally={savedViews.persistedLocally}
            onSave={(name) => savedViews.save(name, filters, activeViewType)}
            onDelete={savedViews.remove}
            onApply={(view) => {
              const next = filtersToSearchParams(view.filters);
              next.set('view', view.viewType);
              setSearchParams(next, { replace: true });
            }}
          />

          <DynamicBulkActions
            schema={schema}
            selectedIds={selectedIds}
            busy={bulkBusy}
            errorMessage={bulkMessage}
            onApply={(command, ids) => void runCommand(command, ids)}
            onClear={() => setSelectedIds([])}
          />

          {activeViewType === 'kanban' ? (
            <DynamicKanban
              schema={schema}
              rows={visibleRows}
              ownerField="client_snapshot"
              stateLabel={stateLabel}
              onCardClick={openRow}
            />
          ) : SUPPORTED_VIEW_TYPES.includes(activeViewType) ? (
            <DynamicList
              schema={schema}
              rows={visibleRows}
              emptyMessage="Nenhuma ordem de serviço no seu escopo."
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              ownerField="client_snapshot"
              showTotals
              /*
               * AGING NO EIXO REAL DA ENTIDADE: o prazo operacional (`deadline_at`), não a
               * data de criação — que a listagem nem recebe. É a distância até o PRAZO que
               * diz se uma OS está atrasada, e é isso que a cor comunica.
               */
              agingField="deadline_at"
              onRowClick={openRow}
            />
          ) : (
            /*
             * ABA SEM RENDERIZADOR: a view EXISTE no metadata store (é por isso que a aba
             * aparece), mas a engine ainda não desenha este tipo. Dizer isso em voz alta é
             * melhor que uma tela vazia, que o usuário leria como "não há dado".
             */
            <p className="text-sm text-gray-600" data-testid="dynamic-view-unsupported">
              A visão <strong>{activeViewType}</strong> existe no metadata store, mas a engine
              ainda não possui renderizador para ela.
            </p>
          )}
        </>
      ) : null}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        destinations={DEFAULT_DESTINATIONS}
        actions={paletteActions}
        onNavigate={(path) => void navigate(path)}
      />
    </div>
  );
}

/** Rótulo humano de um estado, resolvido a partir do metadado. */
function resolveStateLabel(schema: MetaEntitySchema, state: string): string {
  const statusField = schema.fields.find(
    (field) => field.name === schema.workflow?.stateField,
  );
  const option = statusField?.options?.options?.find((candidate) => candidate.value === state);
  return option?.label ?? state;
}

export type { ServiceOrderEngineRow };
