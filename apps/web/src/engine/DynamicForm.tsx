import { useState } from 'react';
import { toDisplayText } from './FieldRenderer';
import type { MetaEntitySchema, MetaField } from './types';

/**
 * Formulário dirigido por metadados.
 *
 * NÃO conhece entidade alguma: recebe `MetaEntitySchema` e desenha. Adicionar um campo é
 * adicionar uma linha em `meta.fields`; a ordem vem de `field_order`; os grupos vêm de
 * `view.layout.sections`. Zero JSX por entidade.
 *
 * CAMPOS FORA DO NÍVEL DO ATOR NÃO EXISTEM AQUI: o servidor já os removeu do schema, e
 * `renderableFields` reaplica a checagem como segunda barreira.
 */
export type DynamicFormProps = {
  schema: MetaEntitySchema;
  /** Valores atuais, indexados por `field.name`. */
  values: Record<string, unknown>;
  onChange?: (name: string, value: unknown) => void;
  /** Somente leitura: renderiza valores sem controles. */
  readOnly?: boolean;
};

export function DynamicForm({
  schema,
  values,
  onChange,
  readOnly = false,
}: DynamicFormProps): React.ReactElement {
  const formView = schema.views.find((view) => view.viewType === 'form');
  const sections = formView?.layout.sections ?? [];

  const byName = new Map(schema.fields.map((field) => [field.name, field]));
  const renderable = (field: MetaField): boolean =>
    field.inForm && schema.allowedPermLevels.includes(field.permLevel);

  /*
   * ORDEM: quando a view declara seções, a ordem É a das seções — é o que permite mudar a
   * ordem sem deploy. Sem seções, cai para `field_order`, que vem ordenado do servidor.
   */
  const grouped = sections.length > 0
    ? sections
        .map((section) => ({
          title: section.title,
          fields: section.fields
            .map((name) => byName.get(name))
            .filter((field): field is MetaField => field !== undefined && renderable(field)),
        }))
        .filter((section) => section.fields.length > 0)
    : [
        {
          title: schema.label,
          fields: schema.fields
            .slice()
            .sort((left, right) => left.fieldOrder - right.fieldOrder)
            .filter(renderable),
        },
      ];

  return (
    <form data-testid="dynamic-form" data-entity={schema.name}>
      {grouped.map((section) => (
        <fieldset key={section.title} className="mb-4">
          <legend className="text-sm font-semibold text-gray-900">{section.title}</legend>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
            {section.fields.map((field) => (
              <DynamicField
                key={field.name}
                field={field}
                value={values[field.name]}
                readOnly={readOnly || field.readOnly}
                onChange={onChange}
              />
            ))}
          </div>
        </fieldset>
      ))}
    </form>
  );
}

function DynamicField({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: MetaField;
  value: unknown;
  readOnly: boolean;
  onChange?: (name: string, value: unknown) => void;
}): React.ReactElement {
  const controlId = `dynamic-${field.name}`;
  const disabled = readOnly || !onChange;

  return (
    <div>
      {/* O rótulo vem do METADADO, nunca de texto hardcoded no componente. */}
      <label htmlFor={controlId} className="block text-xs font-medium text-gray-700">
        {field.label}
        {field.required ? ' *' : ''}
      </label>
      <FieldControl
        field={field}
        id={controlId}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * Controle por TIPO. É o mapa tipo→componente do formulário.
 *
 * `select` usa as opções do metadado; `bool` é checkbox; `currency`/`integer` usam input
 * numérico. Nenhum tipo exige código por entidade.
 */
function FieldControl({
  field,
  id,
  value,
  disabled,
  onChange,
}: {
  field: MetaField;
  id: string;
  value: unknown;
  disabled: boolean;
  onChange?: (name: string, value: unknown) => void;
}): React.ReactElement {
  const commonClass =
    'mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50 disabled:text-gray-600';

  const emit = (next: unknown): void => {
    onChange?.(field.name, next);
  };

  if (field.type === 'select') {
    const options = field.options?.options ?? [];
    return (
      <select
        id={id}
        className={commonClass}
        disabled={disabled}
        data-field={field.name}
        data-field-type="select"
        value={toDisplayText(value)}
        onChange={(event) => emit(event.target.value)}
      >
        <option value="">—</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === 'bool') {
    return (
      <input
        id={id}
        type="checkbox"
        className="mt-1"
        disabled={disabled}
        data-field={field.name}
        data-field-type="bool"
        checked={value === true}
        onChange={(event) => emit(event.target.checked)}
      />
    );
  }

  if (field.type === 'text') {
    return (
      <textarea
        id={id}
        className={commonClass}
        rows={3}
        disabled={disabled}
        data-field={field.name}
        data-field-type="text"
        value={toDisplayText(value)}
        onChange={(event) => emit(event.target.value)}
      />
    );
  }

  const inputType =
    field.type === 'currency' || field.type === 'integer'
      ? 'number'
      : field.type === 'date'
        ? 'date'
        : field.type === 'datetime'
          ? 'datetime-local'
          : 'text';

  return (
    <input
      id={id}
      type={inputType}
      className={commonClass}
      disabled={disabled}
      data-field={field.name}
      data-field-type={field.type}
      value={toDisplayText(value)}
      onChange={(event) => emit(event.target.value)}
    />
  );
}

/**
 * Estado local de um formulário dinâmico.
 *
 * Vive na engine para que cada tela não reimplemente `useState` por campo — era exatamente
 * o que o JSX artesanal fazia.
 */
export function useDynamicFormState(
  initial: Record<string, unknown> = {},
): [Record<string, unknown>, (name: string, value: unknown) => void] {
  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const setValue = (name: string, value: unknown): void => {
    setValues((current) => ({ ...current, [name]: value }));
  };
  return [values, setValue];
}
