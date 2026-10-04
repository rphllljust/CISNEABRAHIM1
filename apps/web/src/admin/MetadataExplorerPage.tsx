import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import { DynamicFormBuilder } from '../engine/DynamicFormBuilder';
import { DynamicViewHost } from '../engine/DynamicViewHost';
import { readLayout } from '../engine/view-layout';
import { fetchEntityList, fetchEntitySchema } from '../engine/meta-api';
import {
  FIELD_WRITE_PATH,
  patchField,
  patchView,
  type MetadataWriteOutcome,
} from '../engine/meta-write-api';
import type { MetaEntitySchema, MetaEntitySummary } from '../engine/types';

/**
 * EXPLORADOR DE METADADOS — read-write.
 *
 * Esta é a tela que fecha a tese de "views como dados": ela lista as entidades registradas no
 * metadata store, mostra o schema CRU de cada uma (campos, views, layout) e permite EDITAR —
 * rótulo, nível de permissão, flags de superfície, layout de view.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * READ-WRITE: A METADE "WRITE" É UM GAP DECLARADO, NÃO UM BOTÃO QUE MENTE
 *
 * A leitura funciona contra a API real. A ESCRITA NÃO EXISTE no backend: o controller de
 * metadados (`apps/api/src/meta/meta.controller.ts`) publica 5 rotas, todas `GET`.
 * Verificado contra a API em execução:
 *
 *   PATCH /api/v1/meta/service-orders/fields/order_number  -> 404 NOT_FOUND
 *   PATCH /api/v1/meta/service-orders/views/calendar       -> 404 NOT_FOUND
 *
 * Como `apps/api/` é somente leitura nesta track, o canal não é criado aqui. A tela então:
 *   1. TENTA a escrita no caminho que o contrato exigiria (o cliente fala o protocolo);
 *   2. mostra o HTTP REAL devolvido;
 *   3. aplica a mudança LOCALMENTE, marcada como não persistida.
 *
 * O item 3 é deliberado. O administrador consegue montar e conferir o metadado antes de o
 * canal existir, e o selo de "não persistido" impede que ele leia a tela como "salvo".
 */

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export function MetadataExplorerPage() {
  const [entities, setEntities] = useState<MetaEntitySummary[]>([]);
  const [listState, setListState] = useState<LoadState>('loading');
  const [selected, setSelected] = useState<string | null>(null);
  const [schema, setSchema] = useState<MetaEntitySchema | null>(null);
  const [schemaState, setSchemaState] = useState<LoadState>('idle');
  const [write, setWrite] = useState<MetadataWriteOutcome | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<'fields' | 'views' | 'builder'>('fields');

  useEffect(() => {
    const controller = new AbortController();
    setListState('loading');
    fetchEntityList(controller.signal)
      .then((list) => {
        setEntities(list);
        setListState('ready');
        // Seleciona a primeira entidade para a tela nunca abrir vazia.
        setSelected((current) => current ?? list[0]?.name ?? null);
      })
      .catch(() => setListState('error'));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selected) {
      return;
    }
    const controller = new AbortController();
    setSchemaState('loading');
    setWrite(null);
    setDirty(false);
    fetchEntitySchema(selected, controller.signal)
      .then((result) => {
        setSchema(result);
        setSchemaState('ready');
      })
      .catch((error: unknown) => {
        setSchemaState('error');
        void error;
      });
    return () => controller.abort();
  }, [selected]);

  const views = useMemo(() => schema?.views ?? [], [schema]);

  /** Grava um patch de campo e registra o resultado REAL. */
  const saveField = async (fieldName: string, patch: Record<string, unknown>): Promise<void> => {
    if (!schema) {
      return;
    }
    const outcome = await patchField(schema.name, fieldName, patch);
    setWrite(outcome);
    if (outcome.status !== 'persisted') {
      // Degradado: aplica localmente e marca como não persistido.
      setSchema((current) =>
        current
          ? {
              ...current,
              fields: current.fields.map((field) =>
                field.name === fieldName ? { ...field, ...patch } : field,
              ),
            }
          : current,
      );
      setDirty(true);
    }
  };

  const saveView = async (viewType: string, patch: Record<string, unknown>): Promise<void> => {
    if (!schema) {
      return;
    }
    const outcome = await patchView(schema.name, viewType, patch);
    setWrite(outcome);
    if (outcome.status !== 'persisted') {
      setSchema((current) =>
        current
          ? {
              ...current,
              views: current.views.map((view) =>
                view.viewType === viewType ? { ...view, ...patch } : view,
              ),
            }
          : current,
      );
      setDirty(true);
    }
  };

  return (
    <div data-testid="metadata-explorer" className="p-4">
      <header className="mb-4">
        <h1 className="text-lg font-semibold text-slate-900">
          {t('explorer.title', 'Explorador de metadados')}
        </h1>
        <p className="text-sm text-slate-600">
          {t(
            'explorer.subtitle',
            'Leitura do metadata store: entidades, campos, views e layout. As views desta tela são DADOS — cada uma lê o layout que o store declara.',
          )}
        </p>
      </header>

      {/*
       * ESTADO DE ESCRITA no topo, sempre visível: é a informação que impede a leitura
       * otimista da tela. Quando o canal não existe, o bloco diz QUAL endpoint falta.
       */}
      <div
        data-testid="explorer-write-state"
        data-write-status={write?.status ?? 'idle'}
        data-write-dirty={dirty ? 'true' : 'false'}
        className={`mb-4 rounded border px-3 py-2 text-xs ${
          write?.status === 'persisted'
            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
            : dirty || write
              ? 'border-amber-300 bg-amber-50 text-amber-900'
              : 'border-slate-200 bg-slate-50 text-slate-600'
        }`}
      >
        {write === null ? (
          <p>
            {t(
              'explorer.writeIdle',
              'Nenhuma escrita tentada. A leitura funciona contra a API real.',
            )}
          </p>
        ) : write.status === 'persisted' ? (
          <p>{t('explorer.writeOk', 'Escrita persistida no servidor.')}</p>
        ) : write.status === 'denied' ? (
          <p>
            <strong>{t('explorer.writeDenied', 'Escrita recusada pelo servidor')}:</strong>{' '}
            {write.detail}
          </p>
        ) : (
          <div>
            <p className="font-semibold">
              GAP_DE_API — {t('explorer.writeGap', 'read-write é READ-ONLY no servidor hoje.')}
            </p>
            <p className="mt-1">
              {write.status === 'unsupported' ? write.detail : write.detail}
              {write.status === 'unsupported' && write.httpStatus !== null ? (
                <>
                  {' '}
                  {t('explorer.writeHttp', 'HTTP')} <strong>{write.httpStatus}</strong>.
                </>
              ) : null}
            </p>
            <p className="mt-1">
              {t('explorer.writeEndpoint', 'Endpoint que a persistência exigiria')}:{' '}
              <code data-testid="explorer-gap-endpoint">{FIELD_WRITE_PATH(schema?.name ?? ':entity', ':name')}</code>
            </p>
            <p className="mt-1">
              {t(
                'explorer.writeLocalOnly',
                'As alterações abaixo estão aplicadas SOMENTE na memória desta página e serão perdidas ao recarregar.',
              )}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded border border-slate-200 bg-white p-3">
          <h2 className="mb-2 text-xs font-semibold uppercase text-slate-600">
            {t('explorer.entities', 'Entidades')}
          </h2>
          {listState === 'loading' ? (
            <p className="text-sm text-slate-500">{t('common.loading', 'Carregando…')}</p>
          ) : listState === 'error' ? (
            <p data-testid="explorer-list-error" className="text-sm text-red-700">
              {t('common.error', 'Não foi possível concluir a operação.')}
            </p>
          ) : (
            <ul data-testid="explorer-entity-list" className="space-y-1">
              {entities.map((entity) => (
                <li key={entity.name}>
                  <button
                    type="button"
                    data-explorer-entity={entity.name}
                    aria-current={entity.name === selected ? 'true' : undefined}
                    onClick={() => setSelected(entity.name)}
                    className={`w-full rounded px-2 py-1 text-left text-sm ${
                      entity.name === selected
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {entity.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p data-testid="explorer-entity-count" className="mt-2 text-[11px] text-slate-400">
            {entities.length} {t('explorer.registered', 'entidades registradas.')}
          </p>
        </aside>

        <main className="min-w-0">
          {schemaState === 'loading' ? (
            <p className="text-sm text-slate-500">{t('common.loading', 'Carregando…')}</p>
          ) : schemaState === 'error' || !schema ? (
            <p data-testid="explorer-schema-error" className="text-sm text-red-700">
              {t('explorer.schemaError', 'Não foi possível ler o schema desta entidade.')}
            </p>
          ) : (
            <>
              <div className="mb-3 rounded border border-slate-200 bg-white p-3">
                <h2 data-testid="explorer-entity-title" className="text-sm font-semibold text-slate-900">
                  {schema.label} <code className="text-xs text-slate-400">{schema.name}</code>
                </h2>
                <p className="text-xs text-slate-500">
                  <code>
                    {schema.dataSchema}.{schema.dataTable}
                  </code>{' '}
                  · {schema.fields.length} {t('explorer.fields', 'campos')} · {views.length}{' '}
                  {t('explorer.views', 'views')} ·{' '}
                  {t('explorer.permLevels', 'níveis permitidos')}: {schema.allowedPermLevels.join(', ')}
                </p>
              </div>

              <div role="tablist" className="mb-3 flex gap-2">
                {(
                  [
                    ['fields', t('explorer.tabFields', 'Campos')],
                    ['views', t('explorer.tabViews', 'Views e layout')],
                    ['builder', t('explorer.tabBuilder', 'Construtor de formulário')],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    data-explorer-tab={key}
                    onClick={() => setTab(key)}
                    className={`rounded border px-2 py-1 text-xs ${
                      tab === key
                        ? 'border-slate-800 bg-slate-800 text-white'
                        : 'border-slate-300 bg-white text-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'fields' ? (
                <div data-testid="explorer-fields" className="overflow-x-auto rounded border border-slate-200 bg-white">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-600">
                        <th className="px-3 py-2">{t('explorer.colField', 'Campo')}</th>
                        <th className="px-3 py-2">{t('explorer.colLabel', 'Rótulo')}</th>
                        <th className="px-3 py-2">{t('explorer.colType', 'Tipo')}</th>
                        <th className="px-3 py-2">{t('explorer.colLevel', 'Nível')}</th>
                        <th className="px-3 py-2">Form</th>
                        <th className="px-3 py-2">List</th>
                        <th className="px-3 py-2">Filter</th>
                        <th className="px-3 py-2">{t('explorer.colAgg', 'Agregação')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schema.fields.map((field) => (
                        <tr key={field.name} data-explorer-field={field.name} className="border-b border-slate-100">
                          <td className="px-3 py-1">
                            <code className="text-xs text-slate-700">{field.name}</code>
                          </td>
                          <td className="px-3 py-1">
                            {/*
                              * EDIÇÃO DO RÓTULO — `onBlur` em vez de `onChange`: uma escrita
                              * por tecla digitada seria uma tempestade de PATCH quando o canal
                              * existir. O blur é a unidade natural de "terminei de editar".
                              */}
                            <input
                              data-explorer-field-label={field.name}
                              defaultValue={field.label}
                              onBlur={(event) => {
                                const next = event.target.value.trim();
                                if (next !== '' && next !== field.label) {
                                  void saveField(field.name, { label: next });
                                }
                              }}
                              className="w-full rounded border border-slate-200 px-1 py-0.5 text-sm"
                            />
                          </td>
                          <td className="px-3 py-1 text-xs text-slate-600">{field.type}</td>
                          <td className="px-3 py-1">
                            <input
                              data-explorer-field-level={field.name}
                              type="number"
                              min={0}
                              defaultValue={field.permLevel}
                              onBlur={(event) => {
                                const next = Number(event.target.value);
                                if (Number.isFinite(next) && next !== field.permLevel) {
                                  void saveField(field.name, { permLevel: next });
                                }
                              }}
                              className="w-16 rounded border border-slate-200 px-1 py-0.5 text-sm"
                            />
                          </td>
                          <td className="px-3 py-1 text-xs">{field.inForm ? '✓' : '—'}</td>
                          <td className="px-3 py-1 text-xs">{field.inList ? '✓' : '—'}</td>
                          <td className="px-3 py-1 text-xs">{field.inFilter ? '✓' : '—'}</td>
                          <td className="px-3 py-1 text-xs text-slate-600">
                            {field.aggregation ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {tab === 'views' ? (
                <div data-testid="explorer-views" className="space-y-3">
                  {views.map((view) => {
                    const layout = readLayout(schema, view.viewType);
                    return (
                      <section
                        key={view.viewType}
                        data-explorer-view={view.viewType}
                        data-explorer-view-default={view.isDefault ? 'true' : 'false'}
                        className="rounded border border-slate-200 bg-white p-3"
                      >
                        <div className="mb-2 flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-slate-800">{view.label}</h3>
                          <code className="text-xs text-slate-400">{view.viewType}</code>
                          {view.isDefault ? (
                            <span className="rounded bg-slate-100 px-1 text-[11px] text-slate-600">
                              default
                            </span>
                          ) : null}
                        </div>
                        <pre
                          data-explorer-view-layout={view.viewType}
                          className="overflow-x-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700"
                        >
                          {JSON.stringify(layout, null, 2)}
                        </pre>
                        {/*
                          * EDIÇÃO DO RÓTULO DA VIEW — a alteração que o E2E usa para provar
                          * read-write (ou a ausência dele).
                        */}
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            data-explorer-view-label={view.viewType}
                            defaultValue={view.label}
                            onBlur={(event) => {
                              const next = event.target.value.trim();
                              if (next !== '' && next !== view.label) {
                                void saveView(view.viewType, { label: next });
                              }
                            }}
                            className="rounded border border-slate-200 px-2 py-0.5 text-xs"
                          />
                          <span className="text-[11px] text-slate-400">
                            {t('explorer.viewLabelHint', 'Editar o rótulo da aba desta view.')}
                          </span>
                        </div>
                      </section>
                    );
                  })}

                  {/*
                   * PRÉ-VISUALIZAÇÃO das views de apresentação com os dados carregados seria
                   * o ideal, mas o explorador não conhece o endpoint de dados de cada entidade
                   * (isso é encanamento da tela dona). Ele mostra o LAYOUT, que é o que ele
                   * promete: o metadado cru, não o dado.
                   */}
                  <p className="text-[11px] text-slate-400">
                    {t(
                      'explorer.viewsHint',
                      'O layout acima é o dado que as views da engine consomem. Alterá-lo por SQL muda a tela renderizada sem deploy.',
                    )}
                  </p>
                </div>
              ) : null}

              {tab === 'builder' ? (
                <DynamicFormBuilder
                  schema={schema}
                  onDraftChange={(updated) => {
                    setSchema(updated);
                    setDirty(true);
                  }}
                  onPersistResult={setWrite}
                />
              ) : null}

              {/*
               * RENDERIZAÇÃO REAL dirigida pelo layout — a prova viva de que "views são dados"
               * aparece no próprio explorador: a view ativa é a primeira de `meta.views` desta
               * entidade, e o renderizador é escolhido pelo `viewType` que o store declara.
               *
               * SEM LINHAS de propósito: o explorador não conhece o endpoint de dados de cada
               * entidade (isso é encanamento da tela dona). O que ele prova aqui é o CONTRATO —
               * que a view existe, que o layout é lido e que o renderizador certo é escolhido.
               * O dado real é provado nos E2E das telas.
               */}
              <div className="mt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase text-slate-600">
                  {t('explorer.renderPreview', 'Renderização dirigida pelo layout')}
                </h3>
                <DynamicViewHost
                  schema={schema}
                  rows={[]}
                  activeViewType={
                    views.find((view) => view.viewType !== 'form')?.viewType ?? 'list'
                  }
                  emptyMessage={t(
                    'explorer.noRows',
                    'O explorador não carrega dados de negócio — abra a tela da entidade para ver registros.',
                  )}
                />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
