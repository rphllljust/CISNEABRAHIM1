import { useMemo, useState } from 'react';
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
  const [expanded, setExpanded] = useState(false);

  if (filterable.length === 0) {
    return null;
  }

  return (
    <section
      className="border-b border-[var(--erp-border)] bg-white"
      aria-label="Filtros por metadados"
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((previous) => !previous)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-[var(--erp-text-secondary)]"
      >
        <span>
          {t('filters.title')}
          {activeCount > 0 ? ` · ${activeCount} ativos` : ''}
        </span>
        <span aria-hidden>{expanded ? '−' : '+'}</span>
      </button>
      <form
        data-testid="dynamic-filter-bar"
        data-entity={schema.name}
        /*
        SUPERFICIE DE FILTRO — uma faixa de operacao, nao um formulario de consulta.

        Antes: `mb-3 flex flex-wrap items-end gap-3` com um titulo "FILTROS (n)" em 12px uppercase
        ocupando uma linha inteira so para dizer que ali se filtra, mais um rotulo em cima de cada
        controle. O resultado era o topo da pagina com a assinatura "INPUT SELECT SELECT BUTTON" —
        o operador via um formulario antes de ver qualquer registro.

        Agora: faixa densa de uma linha, com divisores verticais separando os campos, rotulo
        compacto ACIMA do controle na mesma celula, e a acao de limpar ancorada a direita. O titulo
        da faixa deixa de ser um bloco e passa a ser um rotulo inline. Sem caixa: a faixa pertence a
        area de trabalho e e delimitada por divisor estrutural.
      */
        className="cisne-filter-surface"
        hidden={!expanded}
        onSubmit={(event) => event.preventDefault()}
      >
        <p className="cisne-meta-label m-0 mr-3 shrink-0">
          {t('filters.title')}
          {activeCount > 0 ? <span className="ml-1 font-semibold">({activeCount})</span> : null}
        </p>

        {filterable.map((field) => (
          <div
            key={field.name}
            className="min-w-36 border-l border-[color:var(--color-divider)] px-2.5 first:border-l-0 first:pl-0"
          >
            <label htmlFor={`filter-${field.name}`} className="cisne-meta-label mb-0.5 block">
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
            className="cisne-type-action ml-auto inline-flex min-h-[var(--control-height)] items-center rounded-md px-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            onClick={onClear}
          >
            {t('filters.clear')}
          </button>
        ) : null}
      </form>
    </section>
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
  /*
   * CONTROLE DA FAIXA — altura e tipografia governadas pelo token de densidade. O filtro nao
   * inventa o proprio tamanho de campo: ele usa a mesma altura de controle do resto do ERP, para
   * que a faixa inteira alinhe na mesma linha de base.
   */
  const controlClass =
    'block min-h-[var(--control-height)] w-full rounded-md border-0 bg-white px-1.5 text-[length:var(--type-body-size)] text-gray-900 ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500';

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
        .filter((field) => field.inFilter && schema.allowedPermLevels.includes(field.permLevel))
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
