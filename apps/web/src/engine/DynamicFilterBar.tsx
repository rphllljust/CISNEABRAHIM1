import { useMemo } from 'react';
import { t } from '../i18n';
import type { MetaEntitySchema, MetaField } from './types';

/**
 * Barra de filtros dirigida por metadados.
 *
 * Os campos filtráveis são EXATAMENTE os que o metadata store declarou com `in_filter`. A
 * engine não conhece filtro algum: `status`, `unit_id` ou `overdue` só existem aqui se
 * estiverem em `meta.fields` — e o valor é publicado como query param na lista, que é o
 * contrato que os endpoints reais já aceitam.
 *
 * O controle por TIPO é o mesmo mapa do formulário: `select` vira `<select>` com as opções do
 * metadado, `date` vira `<input type="date">`, o resto vira texto.
 */
export type DynamicFilterBarProps = {
  schema: MetaEntitySchema;
  values: Record<string, string>;
  onChange: (field: string, value: string) => void;
  onClear: () => void;
};

export function DynamicFilterBar({
  schema,
  values,
  onChange,
  onClear,
}: DynamicFilterBarProps): React.ReactElement | null {
  const filterable = useFilterableFields(schema);
  const activeCount = Object.values(values).filter((value) => value.trim() !== '').length;

  if (filterable.length === 0) {
    return null;
  }

  return (
    <form
      data-testid="dynamic-filter-bar"
      data-entity={schema.name}
      className="mb-3 flex flex-wrap items-end gap-3"
      onSubmit={(event) => event.preventDefault()}
    >
      <p className="w-full text-xs font-semibold uppercase tracking-wider text-gray-500">
        {t('filters.title')}
        {activeCount > 0 ? (
          <span className="ml-2 font-normal normal-case text-gray-500">
            ({activeCount})
          </span>
        ) : null}
      </p>

      {filterable.map((field) => (
        <div key={field.name} className="min-w-40">
          <label
            htmlFor={`filter-${field.name}`}
            className="block text-xs font-medium text-gray-700"
          >
            {field.label}
          </label>
          <FilterControl
            field={field}
            value={values[field.name] ?? ''}
            onChange={(next) => onChange(field.name, next)}
          />
        </div>
      ))}

      {activeCount > 0 ? (
        <button
          type="button"
          data-testid="dynamic-filter-clear"
          className="rounded border border-slate-300 px-2 py-1 text-xs"
          onClick={onClear}
        >
          {t('filters.clear')}
        </button>
      ) : null}
    </form>
  );
}

function FilterControl({
  field,
  value,
  onChange,
}: {
  field: MetaField;
  value: string;
  onChange: (next: string) => void;
}): React.ReactElement {
  const controlClass =
    'mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm';

  if (field.type === 'select') {
    return (
      <select
        id={`filter-${field.name}`}
        className={controlClass}
        data-filter={field.name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t('filters.all')}</option>
        {(field.options?.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  const inputType = field.type === 'date' || field.type === 'datetime' ? 'date' : 'text';
  return (
    <input
      id={`filter-${field.name}`}
      type={inputType}
      className={controlClass}
      data-filter={field.name}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * Campos filtráveis, na ordem declarada.
 *
 * `in_filter` é do metadado; a checagem de `permLevel` é a segunda barreira (o servidor já
 * removeu os campos que o ator não pode ver).
 */
export function useFilterableFields(schema: MetaEntitySchema): MetaField[] {
  return useMemo(
    () =>
      schema.fields
        .filter(
          (field) => field.inFilter && schema.allowedPermLevels.includes(field.permLevel),
        )
        .slice()
        .sort((left, right) => left.fieldOrder - right.fieldOrder),
    [schema],
  );
}

/** Converte os filtros ativos em query params — o contrato que os endpoints já aceitam. */
export function filtersToSearchParams(values: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value.trim() !== '') {
      params.set(key, value.trim());
    }
  }
  return params;
}
