import { useEffect, useId, useState } from 'react';
import { formatMoneyBrl } from './format/money';
import { Field } from './Field';
import { Input } from './Input';
import { cn } from './utils/cn';

/**
 * CURRENCY FIELD — campo monetario compartilhado (BRL).
 *
 * Um valor de dinheiro em ERP nao e texto livre: ele tem moeda, formatacao, leitura natural
 * e normalizacao unica antes de virar payload. Antes cada tela guardava string crua
 * (`salePrice.trim()`), o que deixava "1.500,50", "1500.5" e "R$ 1.500,50" convivendo no
 * mesmo sistema.
 *
 * Contrato:
 * - `value` e o valor NORMALIZADO (string decimal, ex.: "1500.50") ou `null` quando vazio.
 * - `onChange` recebe sempre o valor normalizado (ou `null`), nunca a mascara digitada.
 * - Em repouso mostra BRL formatado; em edicao mostra o que o operador digitou.
 * - Entrada invalida nao vira payload: `onInvalid` avisa e o campo marca erro inline.
 */

export type CurrencyFieldProps = {
  /** Valor normalizado (ex.: "1500.50") ou null. */
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** Moeda exibida; o payload continua sendo o decimal normalizado. */
  currencyCode?: string;
  id?: string;
  className?: string;
  /** Chamado quando o texto digitado nao e um valor monetario valido. */
  onInvalid?: (invalid: boolean) => void;
  placeholder?: string;
  name?: string;
};

/**
 * Normaliza texto monetario para decimal com ponto (formato de payload).
 *
 * Aceita `1.234,56`, `1234,56`, `1234.56`, `R$ 1.234,56`. Regras explicitas:
 * - com virgula presente, ela e o separador decimal e os pontos sao milhar;
 * - sem virgula: um unico ponto seguido de EXATAMENTE 3 digitos e tratado como milhar
 *   (convencao brasileira, ex.: "1.500" = mil e quinhentos); qualquer outro caso e decimal.
 *
 * Retorna `null` para vazio e para texto que nao representa dinheiro.
 */
export function normalizeCurrencyInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const cleaned = trimmed.replace(/R\$/gi, '').replace(/\s/g, '');
  if (!/^-?[\d.,]+$/.test(cleaned)) {
    return null;
  }

  const hasComma = cleaned.includes(',');
  let normalized: string;

  if (hasComma) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    const singleDotThousands = /^-?\d{1,3}(\.\d{3})+$/.test(cleaned);
    normalized = singleDotThousands ? cleaned.replace(/\./g, '') : cleaned;
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric.toFixed(2);
}

export function CurrencyField({
  value,
  onChange,
  label,
  hint,
  error,
  required,
  disabled,
  readOnly,
  currencyCode = 'BRL',
  id,
  className,
  onInvalid,
  placeholder,
  name,
}: CurrencyFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const display = value ? formatMoneyBrl(value, currencyCode) : '';
  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);

  // Fora de edicao o campo reflete o valor normalizado que veio de fora.
  useEffect(() => {
    if (!focused) {
      setDraft(value ? formatMoneyBrl(value, currencyCode) : '');
    }
  }, [value, focused, currencyCode]);

  function commit(raw: string) {
    const normalized = normalizeCurrencyInput(raw);
    const isInvalid = raw.trim().length > 0 && normalized === null;
    setInvalid(isInvalid);
    onInvalid?.(isInvalid);
    if (!isInvalid) {
      onChange(normalized);
    }
  }

  const field = (
    <Input
      id={fieldId}
      name={name}
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder ?? 'R$ 0,00'}
      value={focused ? draft : value ? display : ''}
      invalid={Boolean(error) || invalid}
      onFocus={() => {
        setFocused(true);
        setDraft(value ?? '');
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        setFocused(false);
        commit(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit((event.target as HTMLInputElement).value);
        }
      }}
      className={cn('text-right tabular-nums', className)}
      aria-describedby={hint ? `${fieldId}-hint` : undefined}
    />
  );

  if (!label) {
    return field;
  }

  return (
    <Field
      label={label}
      htmlFor={fieldId}
      hint={hint}
      error={invalid ? 'Informe um valor monetário válido (ex.: 1.500,50).' : error}
      required={required}
    >
      {field}
    </Field>
  );
}
