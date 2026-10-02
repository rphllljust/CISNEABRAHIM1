import { useMemo } from 'react';
import { FieldRenderer } from './FieldRenderer';
import type { MetaEntitySchema, MetaField } from './types';

/**
 * Kanban dirigido por metadados.
 *
 * AS COLUNAS SÃO OS ESTADOS DO WORKFLOW — não uma lista fixa em JSX. É o que substitui o
 * quadro artesanal de faturamento ("Pronto para faturar", "Em preparação", "Com
 * divergência"): adicionar uma coluna é adicionar um estado ao workflow no metadata store.
 *
 * `layout.groupBy` diz QUAL campo agrupa (normalmente o `stateField` do workflow), e
 * `layout.cardFields` diz o que aparece no cartão.
 */
export type DynamicKanbanProps = {
  schema: MetaEntitySchema;
  rows: Array<Record<string, unknown> & { id: string }>;
  onCardClick?: (row: Record<string, unknown> & { id: string }) => void;
  /** Rótulo humano de um estado (ex.: "IN_EXECUTION" -> "Em execução"). */
  stateLabel?: (state: string) => string;
};

export function DynamicKanban({
  schema,
  rows,
  onCardClick,
  stateLabel,
}: DynamicKanbanProps): React.ReactElement {
  const kanbanView = schema.views.find((view) => view.viewType === 'kanban');
  const groupBy = kanbanView?.layout.groupBy ?? schema.workflow?.stateField;
  const cardFieldNames = kanbanView?.layout.cardFields ?? [schema.labelField];

  const states = schema.workflow?.states ?? [];
  const cardFields = useMemo(
    () =>
      cardFieldNames
        .map((name) => schema.fields.find((field) => field.name === name))
        .filter((field): field is MetaField => field !== undefined),
    [cardFieldNames, schema.fields],
  );

  const byState = useMemo(() => {
    const map = new Map<string, Array<Record<string, unknown> & { id: string }>>();
    for (const state of states) {
      map.set(state, []);
    }
    for (const row of rows) {
      const key = groupBy ? String(row[groupBy] ?? '') : '';
      const bucket = map.get(key);
      if (bucket) {
        bucket.push(row);
      }
    }
    return map;
  }, [rows, states, groupBy]);

  if (!groupBy || states.length === 0) {
    return (
      <p className="text-sm text-gray-500" data-testid="dynamic-kanban-unavailable">
        Esta entidade não declara workflow com estados — o kanban não tem por onde agrupar.
      </p>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto" data-testid="dynamic-kanban" data-entity={schema.name}>
      {states.map((state) => {
        const cards = byState.get(state) ?? [];
        return (
          <section
            key={state}
            className="min-w-56 flex-1 rounded-lg border border-gray-200 bg-gray-50"
            aria-label={stateLabel ? stateLabel(state) : state}
            data-kanban-column={state}
          >
            <header className="border-b border-gray-200 px-2 py-1.5">
              <h3 className="text-xs font-semibold text-gray-700">
                {stateLabel ? stateLabel(state) : state}
              </h3>
              <p className="text-[11px] text-gray-500">{cards.length}</p>
            </header>
            <ul className="space-y-2 p-2">
              {cards.map((card) => (
                <li key={card.id}>
                  <button
                    type="button"
                    className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-left"
                    onClick={onCardClick ? () => onCardClick(card) : undefined}
                    disabled={!onCardClick}
                  >
                    {cardFields.map((field) => (
                      <span key={field.name} className="block text-xs">
                        <span className="text-gray-500">{field.label}: </span>
                        <FieldRenderer field={field} value={card[field.name]} />
                      </span>
                    ))}
                  </button>
                </li>
              ))}
              {cards.length === 0 ? (
                <li className="px-1 py-2 text-[11px] text-gray-400">Vazio</li>
              ) : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
