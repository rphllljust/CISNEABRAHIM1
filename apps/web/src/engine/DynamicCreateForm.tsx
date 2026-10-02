import { useMemo, useState } from 'react';
import { t } from '../i18n';
import { toDisplayText } from './FieldRenderer';
import type { MetaEntitySchema, MetaField } from './types';

/**
 * Formulário de criação dirigido por metadados.
 *
 * Os campos são os que o metadata store declarou com `in_form` e SEM `read_only`. Campos
 * somente-leitura (`order_number`, `created_at`, `row_version`) ficam de fora — pedir ao
 * usuário um valor que o servidor gera é ruído, e pior, um valor que seria descartado.
 *
 * A engine não sabe o que a entidade significa: ela coleta valores e entrega ao `onSubmit`.
 * QUEM grava é a tela, porque a rota de criação é conhecimento do módulo.
 */
export type DynamicCreateFormProps = {
  schema: MetaEntitySchema;
  onSubmit: (values: Record<string, unknown>) => void;
  onCancel?: () => void;
  busy?: boolean;
  errorMessage?: string | null;
};

export function DynamicCreateForm({
  schema,
  onSubmit,
  onCancel,
  busy = false,
  errorMessage = null,
}: DynamicCreateFormProps): React.ReactElement {
  const fields = useCreatableFields(schema);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [missing, setMissing] = useState<string[]>([]);

  const setValue = (name: string, value: unknown): void => {
    setValues((current) => ({ ...current, [name]: value }));
  };

  const submit = (): void => {
    /*
     * Validação de OBRIGATORIEDADE é a única que a engine faz: ela vem de `required` no
     * metadado e não exige conhecer regra de negócio. Regra de negócio é do servidor — a
     * engine não a replica, e o erro que voltar é exibido tal como veio.
     */
    const absent = fields
      .filter((field) => field.required)
      .filter((field) => {
        const value = values[field.name];
        return value === undefined || value === null || toDisplayText(value).trim() === '';
      })
      .map((field) => field.name);
    setMissing(absent);
    if (absent.length > 0) {
      return;
    }
    onSubmit(values);
  };

  return (
    <form
      data-testid="dynamic-create-form"
      data-entity={schema.name}
      className="rounded-lg border border-gray-200 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 className="mb-3 text-sm font-semibold">{t('create.title')}</h2>

      {fields.length === 0 ? (
        <p className="text-sm text-gray-500">
          Esta entidade não declara campos de criação.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {fields.map((field) => (
          <div key={field.name}>
            <label
              htmlFor={`create-${field.name}`}
              className="block text-xs font-medium text-gray-700"
            >
              {field.label}
              {field.required ? ' *' : ''}
            </label>
            <CreateControl
              field={field}
              value={values[field.name]}
              invalid={missing.includes(field.name)}
              disabled={busy}
              onChange={(next) => setValue(field.name, next)}
            />
          </div>
        ))}
      </div>

      {missing.length > 0 ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          Preencha os campos obrigatórios: {missing.join(', ')}.
        </p>
      ) : null}

      {errorMessage ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-60"
        >
          {t('create.submit')}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm"
          >
            {t('create.cancel')}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function CreateControl({
  field,
  value,
  invalid,
  disabled,
  onChange,
}: {
  field: MetaField;
  value: unknown;
  invalid: boolean;
  disabled: boolean;
  onChange: (next: unknown) => void;
}): React.ReactElement {
  const className = `mt-1 w-full rounded border px-2 py-1 text-sm disabled:bg-gray-50 ${
    invalid ? 'border-red-500' : 'border-gray-300'
  }`;

  if (field.type === 'select') {
    return (
      <select
        id={`create-${field.name}`}
        className={className}
        data-create-field={field.name}
        disabled={disabled}
        value={toDisplayText(value)}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">—</option>
        {(field.options?.options ?? []).map((option) => (
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
        id={`create-${field.name}`}
        type="checkbox"
        className="mt-1"
        data-create-field={field.name}
        disabled={disabled}
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }

  if (field.type === 'text') {
    return (
      <textarea
        id={`create-${field.name}`}
        className={className}
        rows={2}
        data-create-field={field.name}
        disabled={disabled}
        value={toDisplayText(value)}
        onChange={(event) => onChange(event.target.value)}
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
      id={`create-${field.name}`}
      type={inputType}
      className={className}
      data-create-field={field.name}
      disabled={disabled}
      value={toDisplayText(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * Campos que o formulário de criação pode coletar.
 *
 * `read_only` exclui: o servidor gera esses valores. Fora do nível do ator também exclui — o
 * servidor já os removeu do schema, e isto é a segunda barreira.
 */
export function useCreatableFields(schema: MetaEntitySchema): MetaField[] {
  return useMemo(
    () =>
      schema.fields
        .filter(
          (field) =>
            field.inForm &&
            !field.readOnly &&
            schema.allowedPermLevels.includes(field.permLevel),
        )
        .slice()
        .sort((left, right) => left.fieldOrder - right.fieldOrder),
    [schema],
  );
}
